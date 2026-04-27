from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Response
import json
import os
import re
import requests
import uuid
import importlib
import inspect
from typing import Optional
from sqlalchemy.orm import Session
from scrapetl.database import get_db
from scrapetl.models import Scraper, ScraperVersion
from scrapetl.scrapers import load_scraper_class, list_available_scraper_modules
from scrapetl.scrapers.base import BaseScraper
from scrapetl.builder.generator import Generator

router = APIRouter(prefix="/api/scrapers", tags=["scrapers"])

SCRAPERS_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "scrapers")


# ── Helpers ───────────────────────────────────────────────────────────────────

def _normalize_url(url: str) -> Optional[str]:
    """Ensure a URL has a scheme. Returns None if empty."""
    if not url or not url.strip():
        return None
    url = url.strip()
    if url and not url.startswith("http://") and not url.startswith("https://"):
        url = "https://" + url
    return url


def _download_thumbnail(url: str, scraper_id: int) -> tuple[Optional[str], Optional[bytes]]:
    if not url or not url.strip():
        return None, None
    try:
        resp = requests.get(url.strip(), stream=True, timeout=5)
        resp.raise_for_status()
        ext = url.split(".")[-1].split("?")[0].lower()
        if ext not in ["jpg", "jpeg", "png", "webp", "gif"]:
            ext = "jpg"
        filename = f"scraper_{scraper_id}_{uuid.uuid4().hex[:6]}.{ext}"
        return filename, resp.content
    except Exception as e:
        print(f"[Thumbnail] Failed to download {url}: {e}")
        return None, None


def _scraper_dict(s: Scraper):
    # Attempt to extract the `inputs` schema
    scraper_inputs = []
    try:
        if s.scraper_type == "builder" and s.flow_data:
            from scrapetl.builder.generator import Generator
            scraper_inputs = Generator.extract_inputs(s.flow_data)
        elif s.versions:
            from scrapetl.scrapers import load_scraper_class_from_code
            cls = load_scraper_class_from_code(s.versions[0].code)
            raw = getattr(cls, 'inputs', [])
            if isinstance(raw, list):
                scraper_inputs = raw
    except Exception:
        pass

    # Filter out Builder Sync versions for UI consistency
    manual_versions = [v for v in s.versions if v.version_label != "Builder Sync"]
    latest_v = manual_versions[0] if manual_versions else None

    return {
        "id": s.id,
        "name": s.name,
        "module_path": s.module_path,
        "description": s.description,
        "homepage_url": s.homepage_url,
        "thumbnail_url": f"/thumbnails/{s.local_thumbnail_path}" if s.local_thumbnail_path else s.thumbnail_url,
        "health": s.health or "untested",
        "created_at": s.created_at.isoformat() + "Z" if s.created_at else None,
        "updated_at": s.updated_at.isoformat() + "Z" if s.updated_at else None,
        "tags": [{"id": t.id, "name": t.name, "color": t.color} for t in s.tags],
        "integrations": [{"id": i.id, "name": i.name, "type": i.type} for i in s.integrations],
        "version_count": len(manual_versions),
        "latest_version": latest_v.version_label if latest_v else None,
        "inputs": scraper_inputs,
        "scraper_type": s.scraper_type,
        "flow_data": json.loads(s.flow_data) if s.flow_data else None,
        "browser_config": json.loads(s.browser_config) if s.browser_config else {},
        "batch_throttle_seconds": s.batch_throttle_seconds,
        "wiki_content": s.wiki_content,
        "last_run": s.logs[0].run_at.isoformat() + "Z" if s.logs else None,
    }


def _snapshot_version(db: Session, scraper: Scraper, version_label: Optional[str] = None, commit_message: Optional[str] = None, code: Optional[str] = None) -> None:
    """Store code as a new ScraperVersion in the DB."""
    if code is None:
        if scraper.versions:
            code = scraper.versions[0].code
        else:
            code = ""
    db.add(ScraperVersion(
        scraper_id=scraper.id,
        version_label=version_label,
        commit_message=commit_message,
        code=code,
    ))
    db.commit()


def _validate_code_string(text: str) -> None:
    """Validate scraper code dynamically. Raises HTTPException on failure."""
    import re as _re
    if "BaseScraper" not in text:
        raise HTTPException(status_code=400, detail="File must inherit BaseScraper.")
    if not _re.search(r"def\s+scrape\s*\(\s*self", text):
        raise HTTPException(status_code=400, detail="File must implement def scrape(self).")

    try:
        namespace = {}
        exec(text, namespace)
        found = None
        for name, obj in namespace.items():
            if inspect.isclass(obj) and issubclass(obj, BaseScraper) and obj is not BaseScraper:
                found = obj
                break
        if not found:
            raise ValueError("No BaseScraper subclass found inside module.")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not load your code dynamically: {e}")


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("")
def list_scrapers(db: Session = Depends(get_db)):
    scrapers = db.query(Scraper).order_by(Scraper.position.asc(), Scraper.created_at.desc()).all()
    return [_scraper_dict(s) for s in scrapers]


@router.get("/available")
def list_available():
    return list_available_scraper_modules()


@router.post("/wizard")
async def register_scraper_wizard(
    name: str = Form(...),
    description: str = Form(""),
    homepage_url: str = Form(""),
    thumbnail_url: str = Form(""),
    version_label: str = Form("1.0.0"),
    commit_message: str = Form(""),
    scraper_file: UploadFile = File(...),
    thumbnail_file: Optional[UploadFile] = File(None),
    db: Session = Depends(get_db)
):
    """
    All-in-one wizard endpoint: uploads a .py file, generates the filename from Name,
    handles thumbnail (upload or URL), and inserts into database.
    """
    if not name.strip():
        raise HTTPException(status_code=400, detail="Name is required.")

    if not scraper_file.filename.endswith(".py"):
        raise HTTPException(status_code=400, detail="Scraper code must be a .py file.")

    contents = await scraper_file.read()
    try:
        text = contents.decode("utf-8")
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail="File must be UTF-8 encoded.")

    # Generate module name safely from Title
    slug = re.sub(r"[^a-z0-9]", "_", name.lower().strip())
    slug = re.sub(r"_+", "_", slug).strip("_")
    if not slug:
        slug = "custom_scraper"

    module_path = f"scrapetl.scrapers.{slug}"

    # Handle duplicates by appending uuid
    if db.query(Scraper).filter(Scraper.module_path == module_path).first():
        short_id = uuid.uuid4().hex[:4]
        module_path = f"scrapetl.scrapers.{slug}_{short_id}"

    _validate_code_string(text)

    # Process image upload if provided
    local_thumb_path = None
    t_contents = None
    if thumbnail_file and thumbnail_file.filename:
        ext = thumbnail_file.filename.split(".")[-1].lower()
        if ext not in ["jpg", "jpeg", "png", "webp", "gif"]:
            ext = "jpg"
        thumb_name = f"scraper_wizard_{uuid.uuid4().hex[:6]}.{ext}"
        t_contents = await thumbnail_file.read()
        local_thumb_path = thumb_name
        thumbnail_url = ""  # Clear URL if file uploaded directly

    # Normalize URLs
    homepage_url = _normalize_url(homepage_url)
    thumb_url = _normalize_url(thumbnail_url) if not local_thumb_path else None

    # Determine position
    max_pos = db.query(Scraper).order_by(Scraper.position.desc()).first()
    new_pos = (max_pos.position + 1) if max_pos else 0

    # Create Scraper
    scraper = Scraper(
        name=name.strip(),
        module_path=module_path,
        description=description.strip() or "",
        homepage_url=homepage_url,
        thumbnail_url=thumb_url,
        local_thumbnail_path=local_thumb_path,
        thumbnail_data=t_contents,
        position=new_pos
    )
    db.add(scraper)
    db.commit()
    db.refresh(scraper)

    # Snapshot initial version
    _snapshot_version(db, scraper, version_label=version_label or "1.0.0", commit_message=commit_message or "Initial commit", code=text)
    db.refresh(scraper)

    # If they provided a URL instead of a file
    if scraper.thumbnail_url and not local_thumb_path:
        dl_name, dl_bytes = _download_thumbnail(scraper.thumbnail_url, scraper.id)
        if dl_name:
            scraper.local_thumbnail_path = dl_name
            scraper.thumbnail_data = dl_bytes
            db.commit()

    return _scraper_dict(scraper)


@router.post("/builder")
async def save_builder_flow(
    name: str = Form(...),
    description: str = Form(""),
    homepage_url: Optional[str] = Form(None),
    thumbnail_url: Optional[str] = Form(None),
    flow_data: str = Form(...),  # JSON string
    browser_config: Optional[str] = Form(None), # JSON string
    batch_throttle_seconds: Optional[str] = Form(None),
    wiki_content: Optional[str] = Form(None),
    scraper_id: Optional[int] = Form(None),
    new_version: bool = Form(False),
    version_label: Optional[str] = Form(None),
    commit_message: Optional[str] = Form(None),
    thumbnail_file: Optional[UploadFile] = File(None),
    db: Session = Depends(get_db)
):
    """
    Save or update a builder-generated scraper flow.
    """
    if not name.strip():
        raise HTTPException(status_code=400, detail="Name is required.")

    if browser_config:
        try:
            config = json.loads(browser_config)
            allowed_keys = {"timezone", "browser_headless", "browser_cdp_url", "browser_stealth"}
            for key in config.keys():
                if key not in allowed_keys:
                    raise HTTPException(status_code=400, detail=f"Unknown setting key: {key}")
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="Invalid browser config JSON.")

    # Validate flow_data is valid JSON
    try:
        json.loads(flow_data)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid flow data JSON.")

    scraper = None
    if scraper_id:
        scraper = db.get(Scraper, scraper_id)
        if not scraper:
            raise HTTPException(status_code=404, detail="Scraper not found.")
    
    _batch_throttle = float(batch_throttle_seconds.strip()) if batch_throttle_seconds and batch_throttle_seconds.strip() else None

    if scraper:
        scraper.name = name.strip()
        scraper.description = description.strip()
        scraper.homepage_url = _normalize_url(homepage_url) if homepage_url else scraper.homepage_url
        scraper.flow_data = flow_data
        scraper.browser_config = browser_config
        scraper.scraper_type = "builder"
        if _batch_throttle is not None:
            scraper.batch_throttle_seconds = _batch_throttle
        if wiki_content is not None:
            scraper.wiki_content = wiki_content
    else:
        # Determine position
        max_pos = db.query(Scraper).order_by(Scraper.position.desc()).first()
        new_pos = (max_pos.position + 1) if max_pos else 0

        scraper = Scraper(
            name=name.strip(),
            description=description.strip(),
            homepage_url=_normalize_url(homepage_url),
            flow_data=flow_data,
            browser_config=browser_config,
            scraper_type="builder",
            position=new_pos,
            batch_throttle_seconds=_batch_throttle,
        )
        db.add(scraper)
    
    db.commit()
    db.refresh(scraper)

    # Handle thumbnail
    if thumbnail_file and thumbnail_file.filename:
        ext = thumbnail_file.filename.split(".")[-1].lower()
        if ext not in ["jpg", "jpeg", "png", "webp", "gif"]:
            ext = "jpg"
        thumb_name = f"scraper_{scraper.id}_{uuid.uuid4().hex[:6]}.{ext}"
        t_contents = await thumbnail_file.read()
        scraper.local_thumbnail_path = thumb_name
        scraper.thumbnail_data = t_contents
        scraper.thumbnail_url = None
    elif thumbnail_url:
        if not thumbnail_url.startswith("/thumbnails/"):
            new_thumb_url = _normalize_url(thumbnail_url)
            if new_thumb_url != scraper.thumbnail_url:
                scraper.thumbnail_url = new_thumb_url
                if new_thumb_url:
                    local_fname, local_bytes = _download_thumbnail(new_thumb_url, scraper.id)
                    scraper.local_thumbnail_path = local_fname
                    scraper.thumbnail_data = local_bytes
                else:
                    scraper.local_thumbnail_path = None
                    scraper.thumbnail_data = None

    db.commit()

    # Generate the Python code for the flow and snapshot it as a version
    generated_code = Generator.generate_code(flow_data, scraper.name, scraper.description)
    
    latest_v = scraper.versions[0] if scraper.versions else None
    
    if new_version or not latest_v or latest_v.version_label == "Builder Sync":
        # If explicit snapshot, or first time saving, or the latest is just an auto-sync version, we can snapshot/update
        if new_version:
            _snapshot_version(db, scraper, version_label, commit_message, generated_code)
        else:
            if latest_v and latest_v.version_label == "Builder Sync":
                # Update existing "Builder Sync" version
                latest_v.code = generated_code
                db.commit()
            else:
                # Create initial "Builder Sync"
                _snapshot_version(db, scraper, "Builder Sync", f"Sync flow to code: {name}", generated_code)
    else:
        # Latest version is a user-defined snapshot (e.g. v1.0.0), so we MUST create a new "Builder Sync" 
        # instance to reflect current builder code without overwriting history.
        _snapshot_version(db, scraper, "Builder Sync", f"Sync flow to code: {name}", generated_code)

    db.refresh(scraper)
    return _scraper_dict(scraper)


@router.patch("/{scraper_id}")
async def update_scraper(
    scraper_id: int,
    name: str = Form(...),
    description: str = Form(""),
    homepage_url: str = Form(""),
    thumbnail_url: str = Form(""),
    version_label: str = Form(""),
    commit_message: str = Form(""),
    browser_config: Optional[str] = Form(None),
    batch_throttle_seconds: Optional[str] = Form(None),
    wiki_content: Optional[str] = Form(None),
    scraper_file: Optional[UploadFile] = File(None),
    thumbnail_file: Optional[UploadFile] = File(None),
    db: Session = Depends(get_db)
):
    scraper = db.get(Scraper, scraper_id)
    if not scraper:
        raise HTTPException(status_code=404, detail="Scraper not found.")

    scraper.name = name.strip() or scraper.name
    scraper.description = description.strip()
    scraper.homepage_url = _normalize_url(homepage_url)
    if browser_config is not None:
        scraper.browser_config = browser_config
    if batch_throttle_seconds is not None:
        val = batch_throttle_seconds.strip()
        scraper.batch_throttle_seconds = float(val) if val else None
    if wiki_content is not None:
        scraper.wiki_content = wiki_content

    # Handle thumbnail file upload
    if thumbnail_file and thumbnail_file.filename:
        ext = thumbnail_file.filename.split(".")[-1].lower()
        if ext not in ["jpg", "jpeg", "png", "webp", "gif"]:
            ext = "jpg"
        thumb_name = f"scraper_{scraper_id}_{uuid.uuid4().hex[:6]}.{ext}"
        t_contents = await thumbnail_file.read()
        scraper.local_thumbnail_path = thumb_name
        scraper.thumbnail_data = t_contents
        scraper.thumbnail_url = None
    elif thumbnail_url is not None:
        if thumbnail_url.startswith("/thumbnails/"):
            # Frontend relies on echoing the internal thumbnail path. Do not touch DB.
            pass
        else:
            new_thumb_url = _normalize_url(thumbnail_url)
            if new_thumb_url != scraper.thumbnail_url:
                scraper.thumbnail_url = new_thumb_url
                if new_thumb_url:
                    local_fname, local_bytes = _download_thumbnail(new_thumb_url, scraper.id)
                    scraper.local_thumbnail_path = local_fname
                    scraper.thumbnail_data = local_bytes
                else:
                    scraper.local_thumbnail_path = None
                    scraper.thumbnail_data = None

    # Handle scraper code update if uploaded via UI
    new_code = None
    if scraper_file and scraper_file.filename:
        if not scraper_file.filename.endswith(".py"):
            raise HTTPException(status_code=400, detail="Scraper code must be a .py file.")
        contents = await scraper_file.read()
        try:
            text = contents.decode("utf-8")
        except UnicodeDecodeError:
            raise HTTPException(status_code=400, detail="File must be UTF-8 encoded.")

        _validate_code_string(text)
        new_code = text

    # Snapshot new code if version label changed, explicit commit uploaded, or new code uploaded
    if version_label or new_code:
        current_version = scraper.versions[0].version_label if scraper.versions else None
        if version_label != current_version or commit_message or new_code:
            _snapshot_version(db, scraper, version_label, commit_message, new_code)

    db.commit()
    db.refresh(scraper)
    return _scraper_dict(scraper)


@router.delete("/{scraper_id}")
def delete_scraper(scraper_id: int, db: Session = Depends(get_db)):
    scraper = db.get(Scraper, scraper_id)
    if not scraper:
        raise HTTPException(status_code=404, detail="Scraper not found.")
    db.delete(scraper)
    db.commit()
    return {"detail": "Deleted."}


@router.post("/{scraper_id}/duplicate")
def duplicate_scraper(scraper_id: int, db: Session = Depends(get_db)):
    original = db.get(Scraper, scraper_id)
    if not original:
        raise HTTPException(status_code=404, detail="Scraper not found.")

    # Generate unique module path
    slug = re.sub(r"[^a-z0-9]", "_", original.name.lower().strip())
    slug = re.sub(r"_+", "_", slug).strip("_")
    module_path = f"scrapetl.scrapers.{slug}_copy_{uuid.uuid4().hex[:4]}"

    # Determine position
    max_pos = db.query(Scraper).order_by(Scraper.position.desc()).first()
    new_pos = (max_pos.position + 1) if max_pos else 0

    # Create new scraper
    new_scraper = Scraper(
        name=f"{original.name} (Copy)",
        module_path=module_path,
        description=original.description,
        homepage_url=original.homepage_url,
        thumbnail_url=original.thumbnail_url,
        local_thumbnail_path=original.local_thumbnail_path,
        thumbnail_data=original.thumbnail_data,
        scraper_type=original.scraper_type,
        flow_data=original.flow_data,
        browser_config=original.browser_config,
        position=new_pos,
        health="untested"
    )

    # Copy tags
    for tag in original.tags:
        new_scraper.tags.append(tag)

    # Copy integrations
    for integration in original.integrations:
        new_scraper.integrations.append(integration)

    db.add(new_scraper)
    db.commit()
    db.refresh(new_scraper)

    # Copy latest version
    if original.versions:
        latest_v = original.versions[0] # Ordered by created_at desc
        _snapshot_version(
            db,
            new_scraper,
            version_label=latest_v.version_label or "1.0.0",
            commit_message=f"Duplicate of {original.name}",
            code=latest_v.code
        )

    return _scraper_dict(new_scraper)


@router.post("/reorder")
def reorder_scrapers(ids: list[int], db: Session = Depends(get_db)):
    for index, scraper_id in enumerate(ids):
        db.query(Scraper).filter(Scraper.id == scraper_id).update({"position": index})
    db.commit()
    return {"detail": "Scrapers reordered."}


# ── Version History ───────────────────────────────────────────────────────────

@router.get("/{scraper_id}/versions")
def list_versions(scraper_id: int, db: Session = Depends(get_db)):
    scraper = db.get(Scraper, scraper_id)
    if not scraper:
        raise HTTPException(status_code=404, detail="Scraper not found.")
    return [
        {
            "id": v.id,
            "version_label": v.version_label or "-",
            "commit_message": v.commit_message or "",
            "created_at": v.created_at.isoformat() + "Z"
        }
        for v in reversed(scraper.versions)
    ]


@router.get("/{scraper_id}/versions/{version_id}")
def get_version_code(scraper_id: int, version_id: int, db: Session = Depends(get_db)):
    version = db.get(ScraperVersion, version_id)
    if not version or version.scraper_id != scraper_id:
        raise HTTPException(status_code=404, detail="Version not found.")
    return {"version_label": version.version_label, "code": version.code, "created_at": version.created_at.isoformat() + "Z"}


@router.post("/{scraper_id}/revert/{version_id}")
def revert_version(scraper_id: int, version_id: int, db: Session = Depends(get_db)):
    scraper = db.get(Scraper, scraper_id)
    if not scraper:
        raise HTTPException(status_code=404, detail="Scraper not found.")
    version = db.get(ScraperVersion, version_id)
    if not version or version.scraper_id != scraper_id:
        raise HTTPException(status_code=404, detail="Version not found.")

    # Validate the target code
    _validate_code_string(version.code)

    # Snapshot the reverted code as the only new version entry
    _snapshot_version(db, scraper, version.version_label, f"Reverted to {version.version_label}", version.code)

    db.refresh(scraper)
    return {"detail": f"Reverted to version {version.version_label}.", "scraper": _scraper_dict(scraper)}


@router.get("/{scraper_id}/download")
def download_scraper_code(scraper_id: int, db: Session = Depends(get_db)):
    """Serve the latest version of the scraper's Python code as a file download."""
    scraper = db.get(Scraper, scraper_id)
    if not scraper or not scraper.versions:
        raise HTTPException(status_code=404, detail="Scraper not found or has no code versions.")

    # latest_version is the first in the list (ordered by created_at desc)
    latest_version = scraper.versions[0]

    # Generate a safe filename
    safe_name = re.sub(r"[^a-z0-9]", "_", scraper.name.lower().strip())
    safe_name = re.sub(r"_+", "_", safe_name).strip("_")
    filename = f"{safe_name or 'scraper'}.py"

    return Response(
        content=latest_version.code,
        media_type="text/x-python",
        headers={
            "Content-Disposition": f"attachment; filename={filename}"
        }
    )

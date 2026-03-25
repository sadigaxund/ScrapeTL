from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
import json
import os
import re
import requests
import uuid
import importlib
import inspect
from typing import Optional
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import Scraper, ScraperVersion
from app.scrapers import load_scraper_class, list_available_scraper_modules
from app.scrapers.base import BaseScraper

router = APIRouter(prefix="/api/scrapers", tags=["scrapers"])

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "data", "thumbnails")
SCRAPERS_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "scrapers")
os.makedirs(DATA_DIR, exist_ok=True)


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
    return {
        "id": s.id,
        "name": s.name,
        "module_path": s.module_path,
        "description": s.description,
        "homepage_url": s.homepage_url,
        "thumbnail_url": f"/thumbnails/{s.local_thumbnail_path}" if s.local_thumbnail_path else s.thumbnail_url,
        "enabled": s.enabled,
        "health": s.health or "untested",
        "created_at": s.created_at.isoformat() if s.created_at else None,
        "tags": [{"id": t.id, "name": t.name, "color": t.color} for t in s.tags],
        "integrations": [{"id": i.id, "name": i.name, "type": i.type} for i in s.integrations],
        "version_count": len(s.versions) if s.versions else 0,
        "latest_version": s.versions[0].version_label if s.versions else None,
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
    if "BaseScraper" not in text:
        raise HTTPException(status_code=400, detail="File must inherit BaseScraper.")
    if "def scrape(self" not in text:
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
    scrapers = db.query(Scraper).order_by(Scraper.created_at.desc()).all()
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

    module_path = f"app.scrapers.{slug}"

    # Handle duplicates by appending uuid
    if db.query(Scraper).filter(Scraper.module_path == module_path).first():
        short_id = uuid.uuid4().hex[:4]
        module_path = f"app.scrapers.{slug}_{short_id}"

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

    # Create Scraper
    scraper = Scraper(
        name=name.strip(),
        module_path=module_path,
        description=description.strip() or "",
        homepage_url=homepage_url,
        thumbnail_url=thumb_url,
        local_thumbnail_path=local_thumb_path,
        thumbnail_data=t_contents
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


@router.patch("/{scraper_id}")
async def update_scraper(
    scraper_id: int,
    name: str = Form(...),
    description: str = Form(""),
    homepage_url: str = Form(""),
    thumbnail_url: str = Form(""),
    version_label: str = Form(""),
    commit_message: str = Form(""),
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


@router.patch("/{scraper_id}/toggle")
def toggle_scraper(scraper_id: int, db: Session = Depends(get_db)):
    scraper = db.get(Scraper, scraper_id)
    if not scraper:
        raise HTTPException(status_code=404, detail="Scraper not found.")
    scraper.enabled = not scraper.enabled
    db.commit()
    return {"id": scraper.id, "enabled": scraper.enabled}


@router.delete("/{scraper_id}")
def delete_scraper(scraper_id: int, db: Session = Depends(get_db)):
    scraper = db.get(Scraper, scraper_id)
    if not scraper:
        raise HTTPException(status_code=404, detail="Scraper not found.")
    db.delete(scraper)
    db.commit()
    return {"detail": "Deleted."}


# ── Version History ───────────────────────────────────────────────────────────

@router.get("/{scraper_id}/versions")
def list_versions(scraper_id: int, db: Session = Depends(get_db)):
    scraper = db.get(Scraper, scraper_id)
    if not scraper:
        raise HTTPException(status_code=404, detail="Scraper not found.")
    return [
        {
            "id": v.id,
            "version_label": v.version_label or "—",
            "commit_message": v.commit_message or "",
            "created_at": v.created_at.isoformat()
        }
        for v in reversed(scraper.versions)
    ]


@router.get("/{scraper_id}/versions/{version_id}")
def get_version_code(scraper_id: int, version_id: int, db: Session = Depends(get_db)):
    version = db.get(ScraperVersion, version_id)
    if not version or version.scraper_id != scraper_id:
        raise HTTPException(status_code=404, detail="Version not found.")
    return {"version_label": version.version_label, "code": version.code, "created_at": version.created_at.isoformat()}


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

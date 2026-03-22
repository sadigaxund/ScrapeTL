from fastapi import APIRouter, Depends, HTTPException
import os
import requests
import uuid
from pydantic import BaseModel
from typing import Optional
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import Scraper
from app.scrapers import load_scraper_class, list_available_scraper_modules

router = APIRouter(prefix="/api/scrapers", tags=["scrapers"])

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "data", "thumbnails")
os.makedirs(DATA_DIR, exist_ok=True)


class ScraperCreate(BaseModel):
    name: str
    module_path: str
    description: str = ""
    homepage_url: Optional[str] = None
    thumbnail_url: Optional[str] = None


class ScraperUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    homepage_url: Optional[str] = None
    thumbnail_url: Optional[str] = None


def _download_thumbnail(url: str, scraper_id: int) -> Optional[str]:
    """Download the thumbnail and return the local filename. Returns None if failed or no URL."""
    if not url or not url.strip():
        return None
    try:
        resp = requests.get(url.strip(), stream=True, timeout=5)
        resp.raise_for_status()
        ext = url.split(".")[-1].split("?")[0].lower()
        if ext not in ["jpg", "jpeg", "png", "webp", "gif"]:
            ext = "jpg"
        filename = f"scraper_{scraper_id}_{uuid.uuid4().hex[:6]}.{ext}"
        filepath = os.path.join(DATA_DIR, filename)
        with open(filepath, "wb") as f:
            for chunk in resp.iter_content(chunk_size=8192):
                f.write(chunk)
        return filename
    except Exception as e:
        print(f"[Thumbnail] Failed to download {url}: {e}")
        return None


def _scraper_dict(s: Scraper):
    return {
        "id": s.id,
        "name": s.name,
        "module_path": s.module_path,
        "description": s.description,
        "homepage_url": s.homepage_url,
        # Serve the local copy if we have one, otherwise fallback to original URL
        "thumbnail_url": f"/thumbnails/{s.local_thumbnail_path}" if s.local_thumbnail_path else s.thumbnail_url,
        "enabled": s.enabled,
        "created_at": s.created_at.isoformat() if s.created_at else None,
    }


@router.get("")
def list_scrapers(db: Session = Depends(get_db)):
    scrapers = db.query(Scraper).order_by(Scraper.created_at.desc()).all()
    return [_scraper_dict(s) for s in scrapers]


@router.get("/available")
def list_available():
    """Scan the scrapers/ dir and return unregistered scraper modules."""
    return list_available_scraper_modules()


@router.post("")
def create_scraper(payload: ScraperCreate, db: Session = Depends(get_db)):
    # Validate the module path resolves to a real scraper
    try:
        cls = load_scraper_class(payload.module_path)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid module_path: {exc}")

    existing = db.query(Scraper).filter(Scraper.module_path == payload.module_path).first()
    if existing:
        raise HTTPException(status_code=409, detail="Scraper with this module_path already registered.")

    name = payload.name or cls.name
    desc = payload.description or cls.description

    scraper = Scraper(
        name=name,
        module_path=payload.module_path,
        description=desc,
        homepage_url=payload.homepage_url.strip() if payload.homepage_url else None,
        thumbnail_url=payload.thumbnail_url.strip() if payload.thumbnail_url else None,
    )
    db.add(scraper)
    db.commit()
    db.refresh(scraper)

    # Download thumb after we have an ID
    if scraper.thumbnail_url:
        local_filename = _download_thumbnail(scraper.thumbnail_url, scraper.id)
        if local_filename:
            scraper.local_thumbnail_path = local_filename
            db.commit()

    return _scraper_dict(scraper)


@router.patch("/{scraper_id}")
def update_scraper(scraper_id: int, payload: ScraperUpdate, db: Session = Depends(get_db)):
    scraper = db.get(Scraper, scraper_id)
    if not scraper:
        raise HTTPException(status_code=404, detail="Scraper not found.")
    if payload.name is not None:
        scraper.name = payload.name
    if payload.description is not None:
        scraper.description = payload.description
    if payload.homepage_url is not None:
        scraper.homepage_url = payload.homepage_url.strip() if payload.homepage_url.strip() else None

    if payload.thumbnail_url is not None:
        new_thumb_url = payload.thumbnail_url.strip() if payload.thumbnail_url.strip() else None
        # Only download if the URL actually changed
        if new_thumb_url != scraper.thumbnail_url:
            scraper.thumbnail_url = new_thumb_url
            if new_thumb_url:
                local_fname = _download_thumbnail(new_thumb_url, scraper.id)
                scraper.local_thumbnail_path = local_fname
            else:
                scraper.local_thumbnail_path = None

    db.commit()
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

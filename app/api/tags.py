"""
Tags API — create/list/delete tags and assign/remove them on scrapers.
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import Tag, Scraper, Schedule

router = APIRouter(tags=["tags"])


class TagCreate(BaseModel):
    name: str
    color: Optional[str] = "#6366f1"


def _tag_dict(t: Tag):
    return {"id": t.id, "name": t.name, "color": t.color, "created_at": t.created_at.isoformat() if t.created_at else None}


# ── Tag CRUD ──────────────────────────────────────────────────────────────────

@router.get("/api/tags")
def list_tags(db: Session = Depends(get_db)):
    return [_tag_dict(t) for t in db.query(Tag).order_by(Tag.name).all()]


@router.post("/api/tags")
def create_tag(payload: TagCreate, db: Session = Depends(get_db)):
    existing = db.query(Tag).filter(Tag.name == payload.name.strip()).first()
    if existing:
        raise HTTPException(status_code=409, detail="Tag with that name already exists.")
    tag = Tag(name=payload.name.strip(), color=payload.color or "#6366f1")
    db.add(tag)
    db.commit()
    db.refresh(tag)
    return _tag_dict(tag)


@router.delete("/api/tags/{tag_id}")
def delete_tag(tag_id: int, db: Session = Depends(get_db)):
    tag = db.get(Tag, tag_id)
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found.")
    db.delete(tag)
    db.commit()
    return {"detail": "Deleted."}


# ── Scraper ↔ Tag assignment ───────────────────────────────────────────────────

@router.post("/api/scrapers/{scraper_id}/tags/{tag_id}")
def assign_tag(scraper_id: int, tag_id: int, db: Session = Depends(get_db)):
    scraper = db.get(Scraper, scraper_id)
    if not scraper:
        raise HTTPException(status_code=404, detail="Scraper not found.")
    tag = db.get(Tag, tag_id)
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found.")
    if tag not in scraper.tags:
        scraper.tags.append(tag)
        db.commit()
    return {"detail": "Tag assigned."}


@router.delete("/api/scrapers/{scraper_id}/tags/{tag_id}")
def remove_tag(scraper_id: int, tag_id: int, db: Session = Depends(get_db)):
    scraper = db.get(Scraper, scraper_id)
    if not scraper:
        raise HTTPException(status_code=404, detail="Scraper not found.")
    tag = db.get(Tag, tag_id)
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found.")
    if tag in scraper.tags:
        scraper.tags.remove(tag)
        db.commit()
    return {"detail": "Tag removed."}


# ── Schedule ↔ Tag assignment ───────────────────────────────────────────────────

@router.post("/api/schedules/{schedule_id}/tags/{tag_id}")
def assign_schedule_tag(schedule_id: int, tag_id: int, db: Session = Depends(get_db)):
    schedule = db.get(Schedule, schedule_id)
    if not schedule:
        raise HTTPException(status_code=404, detail="Schedule not found.")
    tag = db.get(Tag, tag_id)
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found.")
    if tag not in schedule.tags:
        schedule.tags.append(tag)
        db.commit()
    return {"detail": "Tag assigned."}


@router.delete("/api/schedules/{schedule_id}/tags/{tag_id}")
def remove_schedule_tag(schedule_id: int, tag_id: int, db: Session = Depends(get_db)):
    schedule = db.get(Schedule, schedule_id)
    if not schedule:
        raise HTTPException(status_code=404, detail="Schedule not found.")
    tag = db.get(Tag, tag_id)
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found.")
    if tag in schedule.tags:
        schedule.tags.remove(tag)
        db.commit()
    return {"detail": "Tag removed."}

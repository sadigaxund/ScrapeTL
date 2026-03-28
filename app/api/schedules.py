import json
import os
import uuid
from datetime import datetime
from typing import Optional
from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException, Form, UploadFile, File
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import Schedule, Scraper
from app import scheduler as sched
import pytz

router = APIRouter(prefix="/api/schedules", tags=["schedules"])


class ScheduleCreate(BaseModel):
    scraper_id: int
    cron_expression: str
    input_values: Optional[dict] = None
    label: Optional[str] = None
    thumbnail_url: Optional[str] = None


@router.get("")
def list_schedules(db: Session = Depends(get_db)):
    schedules = db.query(Schedule).order_by(Schedule.created_at.desc()).all()
    res = []
    for s in schedules:
        # Prioritize schedule's custom thumbnail over scraper's
        if s.local_thumbnail_path:
            thumb = f"/thumbnails/{s.local_thumbnail_path}"
        elif s.thumbnail_url:
            thumb = s.thumbnail_url
        elif s.scraper:
            if s.scraper.local_thumbnail_path:
                thumb = f"/thumbnails/{s.scraper.local_thumbnail_path}"
            else:
                thumb = s.scraper.thumbnail_url
        else:
            thumb = None

        res.append({
            "id": s.id,
            "scraper_id": s.scraper_id,
            "scraper_name": s.scraper.name if s.scraper else None,
            "thumbnail_url": thumb,
            "cron_expression": s.cron_expression,
            "enabled": s.enabled,
            "last_run": s.last_run.isoformat() if s.last_run else None,
            "next_run": s.next_run.isoformat() if s.next_run else None,
            "created_at": s.created_at.isoformat() if s.created_at else None,
            "input_values": json.loads(s.input_values) if s.input_values else None,
            "label": s.label or None,
            # For editing convenience, also return the raw override values
            "custom_thumbnail_url": s.thumbnail_url,
            "custom_local_thumbnail_path": s.local_thumbnail_path,
            "tags": [{"id": t.id, "name": t.name, "color": t.color} for t in s.tags],
        })
    return res


@router.post("")
async def create_schedule(
    scraper_id: int = Form(...),
    cron_expression: str = Form(...),
    input_values: Optional[str] = Form(None),
    label: Optional[str] = Form(None),
    thumbnail_url: Optional[str] = Form(None),
    thumbnail_file: Optional[UploadFile] = File(None),
    db: Session = Depends(get_db)
):
    scraper = db.get(Scraper, scraper_id)
    if not scraper:
        raise HTTPException(status_code=404, detail="Scraper not found.")

    # Validate cron expression
    try:
        from croniter import croniter
        if not croniter.is_valid(cron_expression):
            raise ValueError("invalid")
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid cron expression.")

    inputs = None
    if input_values:
        try:
            inputs = json.loads(input_values)
        except:
            pass

    schedule = Schedule(
        scraper_id=scraper_id,
        cron_expression=cron_expression,
        enabled=True,
        input_values=json.dumps(inputs) if inputs else None,
        label=label or None,
        thumbnail_url=thumbnail_url or None
    )

    if thumbnail_file:
        content = await thumbnail_file.read()
        ext = os.path.splitext(thumbnail_file.filename)[1] or ".png"
        fname = f"sched_{uuid.uuid4()}{ext}"
        path = os.path.join("thumbnails", fname)
        os.makedirs("thumbnails", exist_ok=True)
        with open(path, "wb") as f:
            f.write(content)
        schedule.local_thumbnail_path = fname
        schedule.thumbnail_data = content

    db.add(schedule)
    db.commit()
    db.refresh(schedule)

    # Register with APScheduler and compute next_run
    sched.add_schedule_job(schedule.id, scraper.id, cron_expression,
                           input_values=inputs)
    job = sched.get_scheduler().get_job(f"schedule_{schedule.id}")
    if job and job.next_run_time:
        schedule.next_run = job.next_run_time.astimezone(pytz.utc).replace(tzinfo=None)
        db.commit()

    return {"id": schedule.id, "next_run": schedule.next_run.isoformat() if schedule.next_run else None}


@router.patch("/{schedule_id}/toggle")
def toggle_schedule(schedule_id: int, db: Session = Depends(get_db)):
    schedule = db.get(Schedule, schedule_id)
    if not schedule:
        raise HTTPException(status_code=404, detail="Schedule not found.")

    schedule.enabled = not schedule.enabled
    db.commit()

    if schedule.enabled:
        iv = json.loads(schedule.input_values) if schedule.input_values else None
        sched.add_schedule_job(schedule.id, schedule.scraper_id,
                               schedule.cron_expression, input_values=iv)
    else:
        sched.remove_schedule_job(schedule.id)

    return {"id": schedule.id, "enabled": schedule.enabled}


@router.patch("/{schedule_id}")
async def update_schedule(
    schedule_id: int,
    cron_expression: Optional[str] = Form(None),
    label: Optional[str] = Form(None),
    input_values: Optional[str] = Form(None),
    thumbnail_url: Optional[str] = Form(None),
    thumbnail_file: Optional[UploadFile] = File(None),
    db: Session = Depends(get_db)
):
    schedule = db.get(Schedule, schedule_id)
    if not schedule:
        raise HTTPException(status_code=404, detail="Schedule not found.")

    if cron_expression:
        from croniter import croniter
        if not croniter.is_valid(cron_expression):
            raise HTTPException(status_code=400, detail="Invalid cron expression.")
        schedule.cron_expression = cron_expression

    if label is not None:
        schedule.label = label.strip() or None

    if input_values is not None:
        try:
            # Validate JSON
            json.loads(input_values) if input_values else None
            schedule.input_values = input_values
        except:
            raise HTTPException(status_code=400, detail="Invalid input_values JSON.")

    # Handle thumbnail override
    if thumbnail_file and thumbnail_file.filename:
        ext = thumbnail_file.filename.split(".")[-1].lower()
        if ext not in ["jpg", "jpeg", "png", "webp", "gif"]:
            ext = "jpg"
        thumb_name = f"schedule_{schedule_id}_{uuid.uuid4().hex[:6]}.{ext}"
        t_contents = await thumbnail_file.read()
        schedule.local_thumbnail_path = thumb_name
        schedule.thumbnail_data = t_contents
        schedule.thumbnail_url = None
    elif thumbnail_url is not None:
        if thumbnail_url.startswith("/thumbnails/"):
            # Existing local thumb or scraper thumb; do not touch
            pass
        else:
            schedule.thumbnail_url = thumbnail_url.strip() or None
            # If they cleared the URL, also clear the local override
            if not schedule.thumbnail_url:
                schedule.local_thumbnail_path = None
                schedule.thumbnail_data = None

    db.commit()
    db.refresh(schedule)

    # Re-register if enabled
    if schedule.enabled:
        iv = json.loads(schedule.input_values) if schedule.input_values else None
        sched.add_schedule_job(schedule.id, schedule.scraper_id, schedule.cron_expression, input_values=iv)
        
        # Update next_run in DB
        job = sched.get_scheduler().get_job(f"schedule_{schedule.id}")
        if job and job.next_run_time:
            schedule.next_run = job.next_run_time.astimezone(pytz.utc).replace(tzinfo=None)
            db.commit()

    return {"id": schedule.id, "next_run": schedule.next_run.isoformat() if schedule.next_run else None}


@router.delete("/{schedule_id}")
def delete_schedule(schedule_id: int, db: Session = Depends(get_db)):
    schedule = db.get(Schedule, schedule_id)
    if not schedule:
        raise HTTPException(status_code=404, detail="Schedule not found.")
    sched.remove_schedule_job(schedule.id)
    db.delete(schedule)
    db.commit()
    return {"detail": "Deleted."}

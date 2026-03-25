import json
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import Schedule, Scraper
from app import scheduler as sched
import pytz

router = APIRouter(prefix="/api/schedules", tags=["schedules"])


class ScheduleCreate(BaseModel):
    scraper_id: int
    cron_expression: str        # standard 5-part cron, e.g. "0 12 * * *"
    input_values: Optional[dict] = None
    label: Optional[str] = None


@router.get("")
def list_schedules(db: Session = Depends(get_db)):
    schedules = db.query(Schedule).order_by(Schedule.created_at.desc()).all()
    return [
        {
            "id": s.id,
            "scraper_id": s.scraper_id,
            "scraper_name": s.scraper.name if s.scraper else None,
            "thumbnail_url": (
                f"/thumbnails/{s.scraper.local_thumbnail_path}" if s.scraper and s.scraper.local_thumbnail_path
                else (s.scraper.thumbnail_url if s.scraper else None)
            ),
            "cron_expression": s.cron_expression,
            "enabled": s.enabled,
            "last_run": s.last_run.isoformat() if s.last_run else None,
            "next_run": s.next_run.isoformat() if s.next_run else None,
            "created_at": s.created_at.isoformat() if s.created_at else None,
            "input_values": json.loads(s.input_values) if s.input_values else None,
            "label": s.label or None,
        }
        for s in schedules
    ]


@router.post("")
def create_schedule(payload: ScheduleCreate, db: Session = Depends(get_db)):
    scraper = db.get(Scraper, payload.scraper_id)
    if not scraper:
        raise HTTPException(status_code=404, detail="Scraper not found.")

    # Validate cron expression
    try:
        from croniter import croniter
        if not croniter.is_valid(payload.cron_expression):
            raise ValueError("invalid")
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid cron expression.")

    schedule = Schedule(
        scraper_id=payload.scraper_id,
        cron_expression=payload.cron_expression,
        enabled=True,
        input_values=json.dumps(payload.input_values) if payload.input_values else None,
        label=payload.label or None,
    )
    db.add(schedule)
    db.commit()
    db.refresh(schedule)

    # Register with APScheduler and compute next_run
    sched.add_schedule_job(schedule.id, scraper.id, payload.cron_expression,
                           input_values=payload.input_values)
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


@router.delete("/{schedule_id}")
def delete_schedule(schedule_id: int, db: Session = Depends(get_db)):
    schedule = db.get(Schedule, schedule_id)
    if not schedule:
        raise HTTPException(status_code=404, detail="Schedule not found.")
    sched.remove_schedule_job(schedule.id)
    db.delete(schedule)
    db.commit()
    return {"detail": "Deleted."}

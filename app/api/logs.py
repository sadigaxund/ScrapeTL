import csv
import io
import json
import pytz
import os
from typing import Optional
from fastapi import APIRouter, Depends, Query, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import ScrapeLog, TaskQueue, Scraper, Schedule
from datetime import datetime, timedelta

router = APIRouter(tags=["logs"])


@router.get("/api/logs")
def get_logs(
    db: Session = Depends(get_db),
    scraper_id: int = Query(None),
    tag_id: int = Query(None),
    status: str = Query(None),
    limit: int = Query(100, le=500),
    offset: int = Query(0),
):
    # 1. Fetch currently running tasks (if on first page)
    running_items = []
    if offset == 0:
        rq = db.query(TaskQueue).filter(TaskQueue.status == "running")
        if scraper_id:
            rq = rq.filter(TaskQueue.scraper_id == scraper_id)
        if tag_id:
            rq = rq.join(Scraper).filter(Scraper.tags.any(id=tag_id))
        
        # We don't filter running items by 'status' if status filter is something other than 'running'
        # but if status search is "success" or "failure", we shouldn't show running items.
        if status and status != "running":
            rq = rq.filter(False) # No matches if searching specifically for a finished status
        
        running_tasks = rq.all()
        for t in running_tasks:
            running_items.append({
                "id": f"run_{t.id}",
                "task_id": t.id,
                "scraper_id": t.scraper_id,
                "scraper_name": t.scraper.name if t.scraper else f"Scraper #{t.scraper_id}",
                "status": "running",
                "payload": None,
                "episode_count": 0,
                "error_msg": t.note or "Running...",
                "run_at": t.scheduled_for.isoformat() + "Z" if t.scheduled_for else datetime.utcnow().isoformat() + "Z",
                "triggered_by": "manual" if "Manual" in (t.note or "") else ("scheduler" if "Scheduled" in (t.note or "") else "catchup"),
                "schedule_id": None,
                "schedule_name": None,
                "retry_count": 0,
                "integration_details": None,
            })

    # 2. Fetch completed logs
    q = db.query(ScrapeLog).order_by(ScrapeLog.run_at.desc())
    if scraper_id:
        q = q.filter(ScrapeLog.scraper_id == scraper_id)
    if tag_id:
        q = q.join(Scraper).filter(Scraper.tags.any(id=tag_id))
    if status:
        if status == "running":
            # If specifically looking for running, only return running_items
            return {"total": len(running_items), "items": running_items}
        q = q.filter(ScrapeLog.status == status)

    total = q.count()
    # Correct limit to account for running items
    fetch_limit = limit - len(running_items) if offset == 0 else limit
    logs = q.offset(offset).limit(max(0, fetch_limit)).all()

    items = running_items + [
            {
                "id": log.id,
                "scraper_id": log.scraper_id,
                "scraper_name": log.scraper.name if log.scraper else None,
                "status": log.status,
                "payload": json.loads(log.payload) if log.payload else None,
                "episode_count": log.episode_count,
                "error_msg": log.error_msg,
                "run_at": log.run_at.isoformat() + "Z" if log.run_at else None,
                "triggered_by": log.triggered_by,
                "schedule_id": log.schedule_id,
                "schedule_name": log.schedule.label or f"Schedule #{log.schedule_id}" if log.schedule else None,
                "retry_count": log.retry_count,
                "integration_details": log.integration_details,
                "debug_payload": json.loads(log.debug_payload) if log.debug_payload else [],
            }
            for log in logs
        ]

    return {
        "total": total + len(running_tasks) if offset == 0 else total,
        "items": items,
    }


@router.get("/api/logs/{log_id}/download")
def download_log_payload(
    log_id: int,
    format: str = Query("json", regex="^(json|csv)$"),
    db: Session = Depends(get_db),
):
    """Download the scrape payload for a specific log entry as JSON or CSV."""
    log = db.get(ScrapeLog, log_id)
    if not log:
        raise HTTPException(status_code=404, detail="Log not found.")
    if not log.payload:
        raise HTTPException(status_code=404, detail="This log entry has no payload.")

    try:
        data = json.loads(log.payload)
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to parse payload.")

    # Normalise to list
    if isinstance(data, dict):
        data = [data]

    scraper_name = (log.scraper.name if log.scraper else f"scraper_{log.scraper_id}").replace(" ", "_")
    run_at_str = log.run_at.strftime("%Y%m%d_%H%M%S") if log.run_at else "unknown"
    base_filename = f"{scraper_name}_{run_at_str}"

    if format == "json":
        content = json.dumps(data, indent=2, ensure_ascii=False)
        return Response(
            content=content.encode("utf-8"),
            media_type="application/json",
            headers={"Content-Disposition": f'attachment; filename="{base_filename}.json"'},
        )

    # CSV — flatten all keys across all rows
    if not data:
        raise HTTPException(status_code=404, detail="Payload is empty.")

    all_keys: list = []
    for row in data:
        for k in row.keys():
            if k not in all_keys:
                all_keys.append(k)

    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=all_keys, extrasaction="ignore", lineterminator="\n")
    writer.writeheader()
    for row in data:
        writer.writerow({k: row.get(k, "") for k in all_keys})

    return Response(
        content=buf.getvalue().encode("utf-8"),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{base_filename}.csv"'},
    )


@router.get("/api/queue")
def get_queue(db: Session = Depends(get_db)):
    # 1. Real tasks from DB (catchup / one-time)
    tasks = db.query(TaskQueue).order_by(TaskQueue.scheduled_for.desc()).limit(100).all()
    items = [
        {
            "id": t.id,
            "scraper_id": t.scraper_id,
            "scraper_name": t.scraper.name if t.scraper else f"Scraper #{t.scraper_id}",
            "scheduled_for": t.scheduled_for.isoformat() + "Z" if t.scheduled_for else None,
            "status": t.status,
            "created_at": t.created_at.isoformat() + "Z" if t.created_at else None,
            "processed_at": t.processed_at.isoformat() + "Z" if t.processed_at else None,
            "input_values": json.loads(t.input_values) if t.input_values else None,
            "note": t.note,
            "is_virtual": False,
        }
        for t in tasks
    ]

    # 2. Virtual tasks (upcoming scheduler runs)
    active_schedules = db.query(Schedule).filter(Schedule.enabled == True).all()  # noqa: E712
    for s in active_schedules:
        if s.next_run:
            items.append({
                "id": None, # Signal to frontend that it's virtual
                "virt_id": f"virt_{s.id}",
                "scraper_id": s.scraper_id,
                "scraper_name": s.scraper.name if s.scraper else f"Scraper #{s.scraper_id}",
                "scheduled_for": s.next_run.astimezone(pytz.utc).isoformat() if s.next_run.tzinfo else s.next_run.isoformat() + "Z",
                "status": "scheduled",
                "created_at": s.created_at.isoformat() + "Z",
                "processed_at": None,
                "input_values": json.loads(s.input_values) if s.input_values else None,
                "note": s.label or "Cron Schedule",
                "is_virtual": True,
            })

    # Sort by scheduled_for
    items.sort(key=lambda x: x["scheduled_for"] or "", reverse=True)
    return items


class QueueCreate(BaseModel):
    scraper_id: int
    scheduled_for: Optional[datetime] = None
    input_values: Optional[dict] = None
    note: Optional[str] = None


@router.post("/api/queue")
def add_to_queue(payload: QueueCreate, db: Session = Depends(get_db)):
    if payload.scheduled_for:
        from app.scheduler import get_app_timezone
        import pytz
        tz = get_app_timezone()
        local_dt = tz.localize(payload.scheduled_for)
        scheduled_utc = local_dt.astimezone(pytz.utc).replace(tzinfo=None)
    else:
        scheduled_utc = datetime.utcnow()

    task = TaskQueue(
        scraper_id=payload.scraper_id,
        scheduled_for=scheduled_utc,
        input_values=json.dumps(payload.input_values) if payload.input_values else None,
        note=payload.note or "Manual One-Time",
        status="pending"
    )
    db.add(task)
    db.commit()
    return {"id": task.id, "status": "pending"}


@router.delete("/api/queue/{task_id}")
def remove_from_queue(task_id: int, db: Session = Depends(get_db)):
    task = db.get(TaskQueue, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found.")
    if task.status != "pending":
        raise HTTPException(status_code=400, detail="Cannot remove a task that is already running or done.")
    db.delete(task)
    db.commit()
    return {"detail": "Removed."}


@router.get("/api/logs/{log_id}/raw")
def get_raw_log(log_id: int, db: Session = Depends(get_db)):
    """Retrieve the raw stdout log file content for a given run."""
    log = db.get(ScrapeLog, log_id)
    if not log:
        raise HTTPException(status_code=404, detail="Log entry not found.")
    
    if not log.log_file_path:
        return {"content": "No system log file captured for this run.", "path": None}

    if not os.path.exists(log.log_file_path):
        return {"content": f"Log file not found on disk: {log.log_file_path}\n(It may have been purged or moved manually).", "path": log.log_file_path}

    try:
        with open(log.log_file_path, "r", encoding="utf-8") as f:
            content = f.read()
        return {
            "content": content,
            "path": os.path.abspath(log.log_file_path),
            "base_path": os.path.abspath(os.environ.get("STL_LOGS_PATH", "./logs"))
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read log file: {str(e)}")

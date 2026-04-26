import threading
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from scrapetl.database import get_db
from scrapetl.models import Scraper
from scrapetl.runner import run_scraper

from scrapetl import task_registry

router = APIRouter(prefix="/api/run", tags=["run"])


class RunPayload(BaseModel):
    input_values: Optional[dict] = None
    input_labels: Optional[dict] = None  # {name: label} for display in logs


@router.post("/{scraper_id}")
def manual_run(scraper_id: int, force: bool = False, payload: RunPayload = None, db: Session = Depends(get_db)):
    """Immediately trigger a scraper in a background thread."""
    scraper = db.get(Scraper, scraper_id)
    if not scraper:
        raise HTTPException(status_code=404, detail="Scraper not found.")

    from scrapetl.models import TaskQueue
    from datetime import datetime
    import json

    # Check for already running task of the same scraper
    if not force:
        existing = db.query(TaskQueue).filter(
            TaskQueue.scraper_id == scraper_id,
            TaskQueue.status == "running"
        ).first()
        if existing:
            raise HTTPException(
                status_code=409, 
                detail=f"Scraper '{scraper.name}' is already running. Run another instance anyway?"
            )

    input_values = (payload.input_values or {}) if payload else {}
    input_labels = (payload.input_labels or {}) if payload else {}

    task = TaskQueue(
        scraper_id=scraper_id,
        scheduled_for=datetime.utcnow(),
        status="running",
        input_values=json.dumps(input_values) if input_values else None,
        note="Manual Run"
    )
    db.add(task)
    db.commit()
    task_id = task.id

    def _run():
        from scrapetl.database import SessionLocal
        session = SessionLocal()
        try:
            run_scraper(session, scraper_id, triggered_by="manual", input_values=input_values, input_labels=input_labels, queue_task_id=task_id)
        finally:
            session.close()

    thread = threading.Thread(target=_run, daemon=True)
    thread.start()

    return {
        "detail": f"Scraper '{scraper.name}' started.",
        "scraper_id": scraper_id,
        "task_id": task_id
    }


@router.post("/stop/{task_id}")
def stop_run(task_id: int):
    """Request a graceful stop for a running task."""
    success = task_registry.request_stop(task_id)
    if not success:
        # Check if it's in the DB but not in registry (maybe stalled?)
        # We can still mark it as 'cancelled' in DB if it's 'running'
        from scrapetl.database import SessionLocal
        from scrapetl.models import TaskQueue
        db = SessionLocal()
        task = db.get(TaskQueue, task_id)
        if task and task.status == "running":
            task.status = "cancelled"
            db.commit()
            db.close()
            return {"detail": "Task marked as cancelled in database (stalled run)."}
        
        db.close()
        raise HTTPException(status_code=404, detail="Active task not found or already finished.")

    return {"detail": "Stop request sent to scraper."}


@router.get("/status/{task_id}")
def get_task_status(task_id: int, db: Session = Depends(get_db)):
    """Check the current status of a specific task."""
    from scrapetl.models import TaskQueue
    task = db.get(TaskQueue, task_id)
    if not task:
        # If the task is gone from the queue, it's either done or failed (was deleted by runner.py)
        return {"status": "finished", "id": task_id}
    
    return {
        "status": task.status, # e.g. "running" | "pending"
        "id": task_id
    }


@router.get("/{task_id}/logs/live")
def get_live_logs(task_id: int):
    """Retrieve the current content of a live log file for an active task."""
    from scrapetl.logging_manager import ACTIVE_LOG_PATHS
    import os

    path = ACTIVE_LOG_PATHS.get(task_id)
    if not path or not os.path.exists(path):
        # Could be that it just finished and was removed from ACTIVE_LOG_PATHS
        return {"content": "", "active": False}

    try:
        # Read the file. It's being written to simultaneously, 
        # but standard 'r' mode usually works for tailing.
        with open(path, "r", encoding="utf-8") as f:
            content = f.read()
        return {
            "content": content,
            "active": True,
            "path": os.path.abspath(path),
            "base_path": os.path.abspath(os.environ.get("STL_LOGS_PATH", "./logs"))
        }
    except Exception as e:
        return {"content": f"Error reading live log: {e}", "active": False}

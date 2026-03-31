import threading
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import Scraper
from app.runner import run_scraper

from app import task_registry

router = APIRouter(prefix="/api/run", tags=["run"])


class RunPayload(BaseModel):
    input_values: Optional[dict] = None


@router.post("/{scraper_id}")
def manual_run(scraper_id: int, payload: RunPayload = None, db: Session = Depends(get_db)):
    """Immediately trigger a scraper in a background thread."""
    scraper = db.get(Scraper, scraper_id)
    if not scraper:
        raise HTTPException(status_code=404, detail="Scraper not found.")

    input_values = (payload.input_values or {}) if payload else {}
    from app.models import TaskQueue
    from datetime import datetime
    import json

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
        from app.database import SessionLocal
        session = SessionLocal()
        try:
            run_scraper(session, scraper_id, triggered_by="manual", input_values=input_values, queue_task_id=task_id)
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
        from app.database import SessionLocal
        from app.models import TaskQueue
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

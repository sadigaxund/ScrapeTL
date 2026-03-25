import threading
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import Scraper
from app.runner import run_scraper

router = APIRouter(prefix="/api/run", tags=["run"])


class RunPayload(BaseModel):
    input_values: Optional[dict] = None


@router.post("/{scraper_id}")
def manual_run(scraper_id: int, payload: RunPayload = None, db: Session = Depends(get_db)):
    """Immediately trigger a scraper in a background thread."""
    scraper = db.get(Scraper, scraper_id)
    if not scraper:
        raise HTTPException(status_code=404, detail="Scraper not found.")
    if not scraper.enabled:
        raise HTTPException(status_code=400, detail="Scraper is disabled.")

    input_values = (payload.input_values or {}) if payload else {}

    def _run():
        from app.database import SessionLocal
        session = SessionLocal()
        try:
            run_scraper(session, scraper_id, triggered_by="manual", input_values=input_values)
        finally:
            session.close()

    thread = threading.Thread(target=_run, daemon=True)
    thread.start()

    return {"detail": f"Scraper '{scraper.name}' started.", "scraper_id": scraper_id}

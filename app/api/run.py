import threading
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import Scraper
from app.runner import run_scraper

router = APIRouter(prefix="/api/run", tags=["run"])


@router.post("/{scraper_id}")
def manual_run(scraper_id: int, db: Session = Depends(get_db)):
    """Immediately trigger a scraper in a background thread."""
    scraper = db.get(Scraper, scraper_id)
    if not scraper:
        raise HTTPException(status_code=404, detail="Scraper not found.")
    if not scraper.enabled:
        raise HTTPException(status_code=400, detail="Scraper is disabled.")

    def _run():
        from app.database import SessionLocal
        session = SessionLocal()
        try:
            run_scraper(session, scraper_id, triggered_by="manual")
        finally:
            session.close()

    thread = threading.Thread(target=_run, daemon=True)
    thread.start()

    return {"detail": f"Scraper '{scraper.name}' started.", "scraper_id": scraper_id}

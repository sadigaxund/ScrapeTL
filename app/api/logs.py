from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import ScrapeLog, TaskQueue

router = APIRouter(tags=["logs"])


@router.get("/api/logs")
def get_logs(
    db: Session = Depends(get_db),
    scraper_id: int = Query(None),
    status: str = Query(None),
    limit: int = Query(100, le=500),
    offset: int = Query(0),
):
    q = db.query(ScrapeLog).order_by(ScrapeLog.run_at.desc())
    if scraper_id:
        q = q.filter(ScrapeLog.scraper_id == scraper_id)
    if status:
        q = q.filter(ScrapeLog.status == status)

    total = q.count()
    logs = q.offset(offset).limit(limit).all()

    return {
        "total": total,
        "items": [
            {
                "id": log.id,
                "scraper_id": log.scraper_id,
                "scraper_name": log.scraper.name if log.scraper else None,
                "status": log.status,
                "title": log.title,
                "release_date": log.release_date,
                "website_url": log.website_url,
                "episode_count": log.episode_count,
                "error_msg": log.error_msg,
                "run_at": log.run_at.isoformat() if log.run_at else None,
                "triggered_by": log.triggered_by,
            }
            for log in logs
        ],
    }


@router.get("/api/queue")
def get_queue(db: Session = Depends(get_db)):
    tasks = db.query(TaskQueue).order_by(TaskQueue.scheduled_for.desc()).limit(200).all()
    return [
        {
            "id": t.id,
            "scraper_id": t.scraper_id,
            "scraper_name": t.scraper.name if t.scraper else None,
            "scheduled_for": t.scheduled_for.isoformat() if t.scheduled_for else None,
            "status": t.status,
            "created_at": t.created_at.isoformat() if t.created_at else None,
            "processed_at": t.processed_at.isoformat() if t.processed_at else None,
        }
        for t in tasks
    ]

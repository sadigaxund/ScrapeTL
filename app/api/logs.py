import csv
import io
import json
from fastapi import APIRouter, Depends, Query, HTTPException
from fastapi.responses import Response
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import ScrapeLog, TaskQueue, Scraper

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
    q = db.query(ScrapeLog).order_by(ScrapeLog.run_at.desc())
    if scraper_id:
        q = q.filter(ScrapeLog.scraper_id == scraper_id)
    if tag_id:
        q = q.join(Scraper).filter(Scraper.tags.any(id=tag_id))
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
                "payload": json.loads(log.payload) if log.payload else None,
                "episode_count": log.episode_count,
                "error_msg": log.error_msg,
                "run_at": log.run_at.isoformat() + "Z" if log.run_at else None,
                "triggered_by": log.triggered_by,
                "retry_count": log.retry_count,
                "integration_details": log.integration_details,
            }
            for log in logs
        ],
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

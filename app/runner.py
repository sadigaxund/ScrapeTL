"""
Scraper runner — executes a scraper plugin and persists results.
After a run it fires all integrations assigned to the scraper.
"""
import json
from datetime import datetime
from sqlalchemy.orm import Session
from app.models import Scraper, ScrapeLog, TaskQueue
from app.scrapers import load_scraper_class


def run_scraper(db: Session, scraper_id: int, triggered_by: str = "scheduler", queue_task_id: int = None):
    scraper_record: Scraper = db.get(Scraper, scraper_id)
    if not scraper_record:
        print(f"[Runner] Scraper ID {scraper_id} not found.")
        return

    # Mark queue task as running
    queue_task = None
    if queue_task_id:
        queue_task = db.get(TaskQueue, queue_task_id)
        if queue_task:
            queue_task.status = "running"
            db.commit()

    status        = "failure"
    payload_dict  = None
    episode_count = 0
    error_msg     = None
    latest        = None
    should_notify = True

    try:
        scraper_cls = load_scraper_class(scraper_record.module_path)
        scraper_instance = scraper_cls(homepage_url=scraper_record.homepage_url)
        episodes = scraper_instance.scrape()

        episode_count = len(episodes)

        if episodes:
            latest = episodes[0]
            payload_dict = dict(latest)
            # Always surface website_url from the scraper instance if episode doesn't have one
            if "website_url" not in payload_dict:
                payload_dict["website_url"] = scraper_instance.website_url

        status = "success"
        print(f"[Runner] ✅ {scraper_record.name} — {episode_count} episodes found.")

        # Duplicate detection — avoid spamming integrations
        if latest and triggered_by != "manual":
            last_log = (
                db.query(ScrapeLog)
                .filter(ScrapeLog.scraper_id == scraper_id, ScrapeLog.status == "success")
                .order_by(ScrapeLog.run_at.desc())
                .first()
            )
            if last_log and last_log.payload:
                try:
                    last_payload = json.loads(last_log.payload)
                    cur_url   = payload_dict.get("website_url")
                    cur_title = payload_dict.get("title")
                    if last_payload.get("website_url") == cur_url:
                        should_notify = False
                        print(f"[Runner] ℹ️ {scraper_record.name} — No new episodes (URL matched last log).")
                    elif last_payload.get("title") == cur_title:
                        should_notify = False
                        print(f"[Runner] ℹ️ {scraper_record.name} — No new episodes (Title matched last log).")
                except Exception:
                    pass

    except Exception as exc:
        error_msg = str(exc)
        print(f"[Runner] ❌ {scraper_record.name} failed: {error_msg}")

    # Update scraper health based on run outcome
    scraper_record.health = "ok" if status == "success" else "failing"

    # Persist log entry
    log = ScrapeLog(
        scraper_id=scraper_id,
        status=status,
        payload=json.dumps(payload_dict) if payload_dict else None,
        episode_count=episode_count,
        error_msg=error_msg,
        run_at=datetime.utcnow(),
        triggered_by=triggered_by,
    )
    db.add(log)

    if queue_task:
        queue_task.status = "done" if status == "success" else "failed"
        queue_task.processed_at = datetime.utcnow()

    db.commit()

    # Fire all assigned integrations
    if status == "failure" or (status == "success" and should_notify):
        _fire_integrations(scraper_record, status, payload_dict, error_msg, triggered_by)

    return status


def _fire_integrations(scraper_record, status, payload_dict, error_msg, triggered_by):
    """Dispatch to all integrations assigned to this scraper."""
    from app import discord as discord_notifier

    integrations = scraper_record.integrations
    if not integrations:
        # Fallback: use the legacy .env webhook if no integrations configured
        discord_notifier.send_notification(
            scraper_name=scraper_record.name,
            scraper_thumbnail=scraper_record.thumbnail_url,
            status=status,
            latest_episode=payload_dict if status == "success" else None,
            error_msg=error_msg,
            triggered_by=triggered_by,
        )
        return

    for integ in integrations:
        try:
            if integ.type == "discord_webhook":
                import json as _json
                config = _json.loads(integ.config)
                discord_notifier.send_notification(
                    scraper_name=scraper_record.name,
                    scraper_thumbnail=scraper_record.thumbnail_url,
                    status=status,
                    latest_episode=payload_dict if status == "success" else None,
                    error_msg=error_msg,
                    triggered_by=triggered_by,
                    webhook_url=config.get("webhook_url"),
                )
        except Exception as e:
            print(f"[Runner] Integration '{integ.name}' failed: {e}")

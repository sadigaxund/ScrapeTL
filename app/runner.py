"""
Scraper runner — executes a scraper plugin and persists results.
"""
from datetime import datetime
from sqlalchemy.orm import Session
from app.models import Scraper, ScrapeLog, TaskQueue
from app.scrapers import load_scraper_class
from app import discord as discord_notifier


def run_scraper(db: Session, scraper_id: int, triggered_by: str = "scheduler", queue_task_id: int = None):
    """
    Load and execute a scraper, persist results, send Discord notification.

    Args:
        db: Active SQLAlchemy session
        scraper_id: ID of the Scraper record to run
        triggered_by: "scheduler" | "manual" | "catchup"
        queue_task_id: If running from the task queue, its ID (to update status)
    """
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

    status = "failure"
    title = None
    release_date = None
    website_url = None
    episode_count = 0
    error_msg = None
    latest = None
    should_notify = True

    try:
        scraper_cls = load_scraper_class(scraper_record.module_path)
        scraper_instance = scraper_cls(homepage_url=scraper_record.homepage_url)
        episodes = scraper_instance.scrape_episodes_list()

        episode_count = len(episodes)
        website_url = scraper_instance.website_url

        if episodes:
            latest = episodes[0]
            title = latest.get("title")
            release_date = latest.get("release_date")
            episode_url = latest.get("website_url")
            if episode_url:
                website_url = episode_url

        status = "success"
        print(f"[Runner] ✅ {scraper_record.name} — {episode_count} episodes found.")

        # Check for duplicates to avoid spamming Discord
        if latest and triggered_by != "manual":
            last_log = db.query(ScrapeLog).filter(
                ScrapeLog.scraper_id == scraper_id,
                ScrapeLog.status == "success"
            ).order_by(ScrapeLog.run_at.desc()).first()

            if last_log:
                # If URL or Title is same, it's a duplicate
                current_url = website_url or latest.get("website_url")
                if last_log.website_url == current_url:
                    should_notify = False
                    print(f"[Runner] ℹ️ {scraper_record.name} — No new episodes (URL matched last log).")
                elif last_log.title == title:
                    should_notify = False
                    print(f"[Runner] ℹ️ {scraper_record.name} — No new episodes (Title matched last log).")

    except Exception as exc:
        error_msg = str(exc)
        print(f"[Runner] ❌ {scraper_record.name} failed: {error_msg}")

    # Persist log entry
    log = ScrapeLog(
        scraper_id=scraper_id,
        status=status,
        title=title,
        release_date=release_date,
        website_url=website_url,
        episode_count=episode_count,
        error_msg=error_msg,
        run_at=datetime.utcnow(),
        triggered_by=triggered_by,
    )
    db.add(log)

    # Update queue task status
    if queue_task:
        queue_task.status = "done" if status == "success" else "failed"
        queue_task.processed_at = datetime.utcnow()

    db.commit()

    # Send Discord notification (only if new or if it's a failure we want to report)
    if status == "failure" or (status == "success" and should_notify):
        discord_notifier.send_notification(
            scraper_name=scraper_record.name,
            scraper_thumbnail=scraper_record.thumbnail_url,
            status=status,
            latest_episode=latest if status == "success" else None,
            error_msg=error_msg,
            triggered_by=triggered_by,
        )

    return status

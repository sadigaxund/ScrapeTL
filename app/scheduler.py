"""
APScheduler integration — manages cron-based scraper schedules and the catch-up queue.
"""
import os
from datetime import datetime, timedelta
import pytz
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from croniter import croniter

TIMEZONE_STR = os.getenv("APP_TIMEZONE", "UTC")
APP_TZ = pytz.timezone(TIMEZONE_STR)

_scheduler = BackgroundScheduler(timezone=APP_TZ)

CATCHUP_MAX_RUNS = 3   # Maximum missed runs to catch up per scraper


def get_scheduler() -> BackgroundScheduler:
    return _scheduler


def _make_job_id(schedule_id: int) -> str:
    return f"schedule_{schedule_id}"


def _execute_scheduled_scraper(scraper_id: int, schedule_id: int):
    """Called by APScheduler — runs inside a thread."""
    from app.database import SessionLocal
    from app.models import Schedule
    from app.runner import run_scraper

    db = SessionLocal()
    try:
        schedule = db.get(Schedule, schedule_id)
        if schedule:
            schedule.last_run = datetime.utcnow()
            db.commit()
        run_scraper(db, scraper_id, triggered_by="scheduler")
    finally:
        db.close()


def add_schedule_job(schedule_id: int, scraper_id: int, cron_expression: str):
    """Register a cron job with APScheduler."""
    trigger = CronTrigger.from_crontab(cron_expression, timezone=APP_TZ)
    _scheduler.add_job(
        _execute_scheduled_scraper,
        trigger=trigger,
        id=_make_job_id(schedule_id),
        kwargs={"scraper_id": scraper_id, "schedule_id": schedule_id},
        replace_existing=True,
        misfire_grace_time=3600,
    )


def remove_schedule_job(schedule_id: int):
    """Remove a cron job if it exists."""
    job_id = _make_job_id(schedule_id)
    if _scheduler.get_job(job_id):
        _scheduler.remove_job(job_id)


def process_catchup_queue():
    """
    Immediately process all pending items in the task_queue.
    Runs in a background thread.
    """
    from app.database import SessionLocal
    from app.models import TaskQueue
    from app.runner import run_scraper

    db = SessionLocal()
    try:
        pending = (
            db.query(TaskQueue)
            .filter(TaskQueue.status == "pending")
            .order_by(TaskQueue.scheduled_for)
            .all()
        )
        for task in pending:
            task.status = "running"
            db.commit()
            run_scraper(db, task.scraper_id, triggered_by="catchup", queue_task_id=task.id)
    finally:
        db.close()


def enqueue_missed_runs(db, schedule, scraper_id: int):
    """
    Given a schedule, find missed run times since the last successful scrape
    and enqueue up to CATCHUP_MAX_RUNS tasks.
    """
    from app.models import ScrapeLog, TaskQueue

    last_success = (
        db.query(ScrapeLog)
        .filter(ScrapeLog.scraper_id == scraper_id, ScrapeLog.status == "success")
        .order_by(ScrapeLog.run_at.desc())
        .first()
    )

    now_utc = datetime.utcnow()
    since_utc = last_success.run_at if last_success else (now_utc - timedelta(days=7))

    # Convert naive UTC to aware Local for croniter
    since_local = pytz.utc.localize(since_utc).astimezone(APP_TZ)
    now_local = pytz.utc.localize(now_utc).astimezone(APP_TZ)

    cron = croniter(schedule.cron_expression, since_local)
    missed = []
    while True:
        next_time_local = cron.get_next(datetime)
        if next_time_local >= now_local:
            break
        # Convert back to naive UTC for DB storage
        missed_utc = next_time_local.astimezone(pytz.utc).replace(tzinfo=None)
        missed.append(missed_utc)

    # Limit to most recent CATCHUP_MAX_RUNS
    for missed_time in missed[-CATCHUP_MAX_RUNS:]:
        # Avoid duplicates
        existing = (
            db.query(TaskQueue)
            .filter(
                TaskQueue.scraper_id == scraper_id,
                TaskQueue.scheduled_for == missed_time,
            )
            .first()
        )
        if not existing:
            task = TaskQueue(
                scraper_id=scraper_id,
                scheduled_for=missed_time,
                status="pending",
            )
            db.add(task)
    db.commit()


def load_schedules_from_db():
    """
    On startup, reload all enabled schedules and detect missed runs.
    """
    from app.database import SessionLocal
    from app.models import Schedule

    db = SessionLocal()
    try:
        schedules = db.query(Schedule).filter(Schedule.enabled == True).all()  # noqa: E712
        for schedule in schedules:
            add_schedule_job(schedule.id, schedule.scraper_id, schedule.cron_expression)
            enqueue_missed_runs(db, schedule, schedule.scraper_id)

        # Update next_run times
        for schedule in schedules:
            job = _scheduler.get_job(_make_job_id(schedule.id))
            if job and job.next_run_time:
                # job.next_run_time is aware Local. Convert to naive UTC.
                schedule.next_run = job.next_run_time.astimezone(pytz.utc).replace(tzinfo=None)
        db.commit()
    finally:
        db.close()


def start():
    if not _scheduler.running:
        _scheduler.start()
        print(f"[Scheduler] Started. Timezone: {TIMEZONE_STR}")

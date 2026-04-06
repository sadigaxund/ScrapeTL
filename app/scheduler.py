"""
APScheduler integration — manages cron-based scraper schedules and the catch-up queue.
Timezone is read dynamically from the DB (AppSetting key="timezone"), falling back to
the APP_TIMEZONE env var or UTC.
"""
import os
from datetime import datetime, timedelta
import pytz
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from croniter import croniter


def get_app_timezone() -> pytz.BaseTzInfo:
    """Read the active timezone from DB, fall back to env / UTC."""
    try:
        from app.database import SessionLocal
        from app.models import AppSetting
        db = SessionLocal()
        row = db.get(AppSetting, "timezone")
        db.close()
        if row and row.value:
            return pytz.timezone(row.value)
    except Exception:
        pass
    return pytz.timezone(os.getenv("APP_TIMEZONE", "UTC"))


_scheduler = BackgroundScheduler(timezone=get_app_timezone())

CATCHUP_MAX_RUNS = 3


def reload_timezone(tz_str: str):
    """Hot-swap the scheduler's default timezone (called when settings change)."""
    try:
        new_tz = pytz.timezone(tz_str)
        
        # APScheduler cannot be reconfigured while running.
        # However, since our job triggers explicitly use the DB-provided timezone,
        # we can simply reload the jobs to apply the shift.
        if not _scheduler.running:
            _scheduler.configure(timezone=new_tz)
            
        print(f"[Scheduler] Hot-reloading jobs for new timezone: {tz_str}")
        load_schedules_from_db()
    except Exception as e:
        print(f"[Scheduler] Failed to update timezone: {e}")


def get_scheduler() -> BackgroundScheduler:
    return _scheduler


def _make_job_id(schedule_id: int) -> str:
    return f"schedule_{schedule_id}"


def _execute_scheduled_scraper(scraper_id: int, schedule_id: int, input_values: dict = None):
    """Called by APScheduler — runs inside a thread."""
    from app.database import SessionLocal
    from app.models import Schedule
    from app.runner import run_scraper

    db = SessionLocal()
    try:
        from app.models import TaskQueue
        import json as _json

        schedule = db.get(Schedule, schedule_id)
        if schedule:
            schedule.last_run = datetime.utcnow()
            # Get the job from the current scheduler to find the NEXT next_run_time
            job = _scheduler.get_job(_make_job_id(schedule_id))
            if job and job.next_run_time:
                schedule.next_run = job.next_run_time.astimezone(pytz.utc).replace(tzinfo=None)
            db.commit()

        # Create temporary task for tracking
        task = TaskQueue(
            scraper_id=scraper_id,
            schedule_id=schedule_id,
            scheduled_for=datetime.utcnow(),
            status="running",
            input_values=_json.dumps(input_values) if input_values else None,
            note=f"Scheduled Run ({schedule.label or f'#{schedule_id}'})" if schedule else "Scheduled Run"
        )
        db.add(task)
        db.commit()

        run_scraper(db, scraper_id, triggered_by="scheduler", input_values=input_values, schedule_id=schedule_id, queue_task_id=task.id)
    finally:
        db.close()


def add_schedule_job(schedule_id: int, scraper_id: int, cron_expression: str, input_values: dict = None):
    """Register a cron job with APScheduler using the current app timezone."""
    tz = get_app_timezone()
    trigger = CronTrigger.from_crontab(cron_expression, timezone=tz)
    _scheduler.add_job(
        _execute_scheduled_scraper,
        trigger=trigger,
        id=_make_job_id(schedule_id),
        kwargs={"scraper_id": scraper_id, "schedule_id": schedule_id, "input_values": input_values or {}},
        replace_existing=True,
        misfire_grace_time=3600,
    )


def remove_schedule_job(schedule_id: int):
    job_id = _make_job_id(schedule_id)
    if _scheduler.get_job(job_id):
        _scheduler.remove_job(job_id)


def process_catchup_queue():
    from app.database import SessionLocal
    from app.models import TaskQueue
    from app.runner import run_scraper

    db = SessionLocal()
    try:
        now_utc = datetime.utcnow()
        pending = (
            db.query(TaskQueue)
            .filter(TaskQueue.status == "pending")
            .filter(TaskQueue.scheduled_for <= now_utc)
            .order_by(TaskQueue.scheduled_for)
            .all()
        )
        for task in pending:
            task.status = "running"
            db.commit()
            import json as _json
            iv = _json.loads(task.input_values) if task.input_values else None
            # If it has a schedule_id, it is a scheduled catch-up run.
            # If not, but has a note, it was likely manual or one-time.
            if task.schedule_id:
                triggered_by = "catchup"
            else:
                triggered_by = "one-time" if task.note else "catchup"

            run_scraper(db, task.scraper_id, triggered_by=triggered_by, queue_task_id=task.id, input_values=iv, schedule_id=task.schedule_id)
    finally:
        db.close()


def enqueue_missed_runs(db, schedule, scraper_id: int):
    from app.models import ScrapeLog, TaskQueue

    last_run = (
        db.query(ScrapeLog)
        .filter(ScrapeLog.scraper_id == scraper_id)
        .filter(ScrapeLog.schedule_id == schedule.id)
        .order_by(ScrapeLog.run_at.desc())
        .first()
    )

    app_tz = get_app_timezone()
    now_utc = datetime.utcnow()
    
    # 24-hour expiration limit for missed catch-up tasks
    cutoff_utc = now_utc - timedelta(hours=24)
    since_utc = last_run.run_at if last_run else cutoff_utc
    
    # Ignore missed schedules older than our cutoff window
    if since_utc < cutoff_utc:
        since_utc = cutoff_utc

    since_local = pytz.utc.localize(since_utc).astimezone(app_tz)
    now_local   = pytz.utc.localize(now_utc).astimezone(app_tz)

    cron = croniter(schedule.cron_expression, since_local)
    missed = []
    while True:
        next_time_local = cron.get_next(datetime)
        if next_time_local >= now_local:
            break
        missed_utc = next_time_local.astimezone(pytz.utc).replace(tzinfo=None)
        missed.append(missed_utc)

    for missed_time in missed[-CATCHUP_MAX_RUNS:]:
        existing = (
            db.query(TaskQueue)
            .filter(TaskQueue.scraper_id == scraper_id, TaskQueue.scheduled_for == missed_time)
            .first()
        )
        if not existing:
            db.add(TaskQueue(
                scraper_id=scraper_id,
                schedule_id=schedule.id,
                scheduled_for=missed_time,
                status="pending",
                input_values=schedule.input_values
            ))
    db.commit()


def load_schedules_from_db():
    from app.database import SessionLocal
    from app.models import Schedule

    db = SessionLocal()
    try:
        schedules = db.query(Schedule).filter(Schedule.enabled == True).all()  # noqa: E712
        for schedule in schedules:
            import json as _json
            iv = _json.loads(schedule.input_values) if schedule.input_values else None
            add_schedule_job(schedule.id, schedule.scraper_id, schedule.cron_expression,
                             input_values=iv)
            enqueue_missed_runs(db, schedule, schedule.scraper_id)

        for schedule in schedules:
            job = _scheduler.get_job(_make_job_id(schedule.id))
            if job and job.next_run_time:
                schedule.next_run = job.next_run_time.astimezone(pytz.utc).replace(tzinfo=None)
        db.commit()
    finally:
        db.close()


def start():
    if not _scheduler.running:
        _scheduler.start()
        _scheduler.add_job(process_catchup_queue, 'interval', seconds=20, id='catchup_queue_processor', replace_existing=True)
        tz = get_app_timezone()
        print(f"[Scheduler] Started. Timezone: {tz}")

"""
Scraper runner — executes a scraper plugin and persists results.
After a run it fires all integrations assigned to the scraper.
Supports configurable retry with exponential backoff (reads from AppSetting keys
'retry_max' and 'retry_backoff_seconds'; defaults: 2 retries, 5 s backoff).
"""
import json
import time
from datetime import datetime
from sqlalchemy.orm import Session
from app.models import Scraper, ScrapeLog, TaskQueue, AppSetting, GlobalVariable, UserFunction
from app.exceptions import ScrapeSkip
from app.expressions import resolve_expressions


def _get_retry_settings(db: Session) -> tuple[int, float]:
    """Read retry configuration from AppSettings, with safe defaults."""
    max_retries = 2
    backoff_seconds = 5.0
    try:
        r = db.get(AppSetting, "retry_max")
        if r:
            max_retries = int(r.value)
    except Exception:
        pass
    try:
        b = db.get(AppSetting, "retry_backoff_seconds")
        if b:
            backoff_seconds = float(b.value)
    except Exception:
        pass
    return max_retries, backoff_seconds


from app import task_registry

def run_scraper(db: Session, scraper_id: int, triggered_by: str = "scheduler", queue_task_id: int = None, input_values: dict = None, schedule_id: int = None):
    scraper_record: Scraper = db.get(Scraper, scraper_id)
    if not scraper_record:
        print(f"[Runner] Scraper ID {scraper_id} not found.")
        return

    # 1. Register with TaskRegistry for cancellation support
    stop_event = None
    if queue_task_id:
        stop_event = task_registry.register_task(queue_task_id)

    # Mark queue task as running
    queue_task = None
    if queue_task_id:
        queue_task = db.get(TaskQueue, queue_task_id)
        if queue_task:
            queue_task.status = "running"
            db.commit()

    try:
        max_retries, backoff_seconds = _get_retry_settings(db)

        status        = "failure"
        payload_dict  = None
        payload_list  = None
        episode_count = 0
        error_msg     = None
        latest        = None
        episodes      = []
        should_notify = True
        retry_count   = 0
        skip_message  = None
        _input_values  = input_values or {}

        # 3. Load Global Variables for injection
        global_vars = {}
        db_vars = db.query(GlobalVariable).all()
        for v in db_vars:
            val = v.value
            if v.value_type == "number":
                try: val = float(val) if "." in str(val) else int(val)
                except: pass
            elif v.value_type == "boolean":
                val = str(val).lower() in ("true", "1", "yes")
            elif v.value_type == "json":
                try: val = json.loads(val)
                except: pass
            global_vars[v.key] = val
            
        # 3.5 Resolve Expressions in Input Values using current variables
        custom_funcs = {f.name: f.code for f in db.query(UserFunction).all()}
        _input_values = resolve_expressions(_input_values, global_vars, custom_funcs)

        for attempt in range(max_retries + 1):
            # Check for cancellation before execution
            if stop_event and stop_event.is_set():
                status = "cancelled"
                error_msg = "Stop requested by user."
                print(f"[Runner] 🛑 {scraper_record.name} — cancelled.")
                break

            try:
                # ── Execution Path ────────────────────────────────
                if not scraper_record.versions:
                    raise ValueError("No code version found for this scraper.")
                
                if scraper_record.scraper_type == "builder":
                    from app.builder.engine import BuilderEngine
                    # Prefer using the actual flow_data (JSON) over the code (often Python export)
                    if scraper_record.flow_data:
                        flow_data = json.loads(scraper_record.flow_data)
                    else:
                        # Fallback to versions[0].code if flow_data is missing
                        flow_data = json.loads(scraper_record.versions[0].code)
                    
                    engine = BuilderEngine(flow_data, global_vars, db_session=db)
                    # Pass stop_event to engine
                    episodes = engine.execute(_input_values, stop_event=stop_event)
                    scraper_instance = engine # For debug_payload access
                else:
                    from app.scrapers import load_scraper_class_from_code
                    scraper_cls = load_scraper_class_from_code(scraper_record.versions[0].code)
                    scraper_instance = scraper_cls(homepage_url=scraper_record.homepage_url)
                    # Support stop_event in Python scrapers if they accept it
                    kwargs = {**_input_values, "vars": global_vars, "db": db}
                    import inspect
                    if "stop_event" in inspect.signature(scraper_instance.scrape).parameters:
                        kwargs["stop_event"] = stop_event
                    episodes = scraper_instance.scrape(**kwargs)

                episode_count = len(episodes)

                if episodes:
                    latest = episodes[0]
                    payload_dict = dict(latest)
                    payload_list = [dict(ep) for ep in episodes[:50]]

                # Final check for stop signal before committing success
                if stop_event and stop_event.is_set():
                    status = "cancelled"
                    error_msg = "Stop requested by user."
                    print(f"[Runner] 🛑 {scraper_record.name} — force stopped.")
                else:
                    status = "success"
                    error_msg = None
                    print(f"[Runner] ✅ {scraper_record.name} — {episode_count} results found (attempt {attempt + 1}).")
                
                break  # Exit retry loop

            except ScrapeSkip as skip:
                # Clean skip — treat as success, no integrations, no retries
                skip_message = str(skip) or "Skipped by scraper."
                status = "skipped"
                error_msg = skip_message
                retry_count = attempt
                print(f"[Runner] ⏭  {scraper_record.name} — skipped: {skip_message}")
                break

            except Exception as exc:
                if status == "cancelled": break # Already handled stop check
                import traceback
                traceback.print_exc()
                error_msg = str(exc)
                retry_count = attempt
                if attempt < max_retries:
                    wait = backoff_seconds * (2 ** attempt)
                    print(f"[Runner] ⚠️  {scraper_record.name} attempt {attempt + 1}/{max_retries + 1} failed: {error_msg}. Retrying in {wait:.0f}s…")
                    # Check for cancellation during sleep
                    if stop_event:
                        if stop_event.wait(timeout=wait):
                            status = "cancelled"
                            error_msg = "Stop requested during retry wait."
                            break
                    else:
                        time.sleep(wait)
                else:
                    print(f"[Runner] ❌ {scraper_record.name} failed after {attempt + 1} attempt(s): {error_msg}")

        # Update health (unless cancelled)
        if status != "cancelled":
            scraper_record.health = "ok" if status in ("success", "skipped") else "failing"

        # Persist log entry
        log = ScrapeLog(
            scraper_id=scraper_id,
            status=status,
            payload=json.dumps(payload_list[:10]) if payload_list else (json.dumps([payload_dict]) if payload_dict else None),
            episode_count=episode_count,
            error_msg=error_msg,
            run_at=datetime.utcnow(),
            triggered_by=triggered_by,
            retry_count=retry_count,
            schedule_id=schedule_id,
            debug_payload=json.dumps(getattr(scraper_instance, "debug_payload", [])) if 'scraper_instance' in locals() else None
        )
        db.add(log)

        if queue_task:
            db.delete(queue_task)

        db.commit()

        # Fire assigned integrations
        if status in ("success", "failure", "skipped"):
            results = _fire_integrations(scraper_record, status, episodes, error_msg, triggered_by)
            if results:
                log.integration_details = json.dumps(results)
                db.commit()

        return status

    finally:
        # 4. Clean unregistration
        if queue_task_id:
            task_registry.unregister_task(queue_task_id)


def _fire_integrations(scraper_record, status, episodes_list, error_msg, triggered_by):
    """Dispatch to all integrations assigned to this scraper."""
    from app import discord as discord_notifier
    results = []

    integrations = scraper_record.integrations
    if not integrations:
        # Fallback: use the legacy .env webhook if no integrations configured
        # Only attempt if the environment variable is actually set to avoid noisy logs
        import os
        if os.getenv("DISCORD_WEBHOOK_URL"):
            res = discord_notifier.send_notification(
                scraper_name=scraper_record.name,
                scraper_thumbnail=scraper_record.thumbnail_url,
                status=status,
                episodes=episodes_list if status == "success" else None,
                error_msg=error_msg,
                triggered_by=triggered_by,
            )
            if res: results.append(res)
        return results

    for integ in integrations:
        try:
            import json as _json
            config = _json.loads(integ.config)
            
            # Check triggers — default to [success, failure] if missing
            triggers = config.get("triggers", ["success", "failure"])
            if status not in triggers:
                continue

            content_type = config.get("content_type", "full_data")
            eps_to_send = episodes_list if status == "success" and content_type != "state_only" else None

            if integ.type == "discord_webhook":
                res = discord_notifier.send_notification(
                    scraper_name=scraper_record.name,
                    scraper_thumbnail=scraper_record.thumbnail_url,
                    status=status,
                    episodes=eps_to_send,
                    error_msg=error_msg,
                    triggered_by=triggered_by,
                    config=config,
                    integration_name=integ.name,
                )
                if res:
                    res["name"] = integ.name
                    results.append(res)

            elif integ.type == "http_request":
                from app import http_sender
                res = http_sender.send_http(
                    scraper_name=scraper_record.name,
                    status=status,
                    episodes=eps_to_send,
                    error_msg=error_msg,
                    triggered_by=triggered_by,
                    config=config,
                )
                if res:
                    res["name"] = integ.name
                    results.append(res)

        except Exception as exc:
            print(f"[Runner] Integration {integ.name} failed: {exc}")
            results.append({"name": integ.name, "success": False, "attempts": 0, "error": str(exc)})

    return results

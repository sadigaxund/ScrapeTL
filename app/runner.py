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
from app.models import Scraper, ScrapeLog, TaskQueue, AppSetting


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

    max_retries, backoff_seconds = _get_retry_settings(db)

    status        = "failure"
    payload_dict  = None
    payload_list  = None
    episode_count = 0
    error_msg     = None
    latest        = None
    should_notify = True
    retry_count   = 0

    for attempt in range(max_retries + 1):
        try:
            scraper_type = getattr(scraper_record, "scraper_type", "python") or "python"

            if scraper_type == "recipe":
                # ── Recipe (low-code) path ──────────────────────────────────
                if not scraper_record.recipe:
                    raise ValueError("No recipe defined for this recipe scraper.")
                from app.recipe_runner import run_recipe
                episodes = run_recipe(scraper_record.recipe, homepage_url=scraper_record.homepage_url)

            else:
                # ── Python (BaseScraper) path ────────────────────────────────
                if not scraper_record.versions:
                    raise ValueError("No code version found for this scraper.")
                from app.scrapers import load_scraper_class_from_code
                scraper_cls = load_scraper_class_from_code(scraper_record.versions[0].code)
                scraper_instance = scraper_cls(homepage_url=scraper_record.homepage_url)
                episodes = scraper_instance.scrape()

            episode_count = len(episodes)

            if episodes:
                latest = episodes[0]
                payload_dict = dict(latest)
                # Always surface website_url from the scraper instance if episode doesn't have one
                if "website_url" not in payload_dict:
                    payload_dict["website_url"] = scraper_instance.website_url

                payload_list = [dict(ep) for ep in episodes[:50]]
                for ep_item in payload_list:
                    if "website_url" not in ep_item:
                        ep_item["website_url"] = scraper_instance.website_url

            status = "success"
            error_msg = None
            print(f"[Runner] ✅ {scraper_record.name} — {episode_count} episodes found (attempt {attempt + 1}).")
            break  # success — exit retry loop

        except Exception as exc:
            error_msg = str(exc)
            retry_count = attempt
            if attempt < max_retries:
                wait = backoff_seconds * (2 ** attempt)
                print(f"[Runner] ⚠️  {scraper_record.name} attempt {attempt + 1}/{max_retries + 1} failed: {error_msg}. Retrying in {wait:.0f}s…")
                time.sleep(wait)
            else:
                print(f"[Runner] ❌ {scraper_record.name} failed after {attempt + 1} attempt(s): {error_msg}")

    # Duplicate detection — avoid spamming integrations
    if status == "success" and latest and triggered_by != "manual":
        last_log = (
            db.query(ScrapeLog)
            .filter(ScrapeLog.scraper_id == scraper_id, ScrapeLog.status == "success")
            .order_by(ScrapeLog.run_at.desc())
            .first()
        )
        if last_log and last_log.payload:
            try:
                loaded_payload = json.loads(last_log.payload)
                last_payload = loaded_payload[0] if isinstance(loaded_payload, list) and len(loaded_payload) > 0 else loaded_payload
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

    # Update scraper health based on run outcome
    scraper_record.health = "ok" if status == "success" else "failing"

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
    )
    db.add(log)

    if queue_task:
        queue_task.status = "done" if status == "success" else "failed"
        queue_task.processed_at = datetime.utcnow()

    db.commit()

    # Fire all assigned integrations
    if status == "failure" or (status == "success" and should_notify):
        results = _fire_integrations(scraper_record, status, episodes, error_msg, triggered_by)
        if results:
            log.integration_details = json.dumps(results)
            db.commit()

    return status


def _fire_integrations(scraper_record, status, episodes_list, error_msg, triggered_by):
    """Dispatch to all integrations assigned to this scraper."""
    from app import discord as discord_notifier
    results = []

    integrations = scraper_record.integrations
    if not integrations:
        # Fallback: use the legacy .env webhook if no integrations configured
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
            if integ.type == "discord_webhook":
                import json as _json
                config = _json.loads(integ.config)
                res = discord_notifier.send_notification(
                    scraper_name=scraper_record.name,
                    scraper_thumbnail=scraper_record.thumbnail_url,
                    status=status,
                    episodes=episodes_list if status == "success" else None,
                    error_msg=error_msg,
                    triggered_by=triggered_by,
                    config=config,
                )
                if res:
                    res["name"] = integ.name
                    results.append(res)

            elif integ.type == "http_request":
                from app import http_sender
                import json as _json
                config = _json.loads(integ.config)
                res = http_sender.send_http(
                    scraper_name=scraper_record.name,
                    status=status,
                    episodes=episodes_list if status == "success" else None,
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

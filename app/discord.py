"""
Discord notification sender using webhooks.
Now accepts webhook_url as a parameter (no more reliance on .env only).
Falls back to DISCORD_WEBHOOK_URL env var if no webhook_url is passed,
for backwards-compat with the legacy fallback path in runner.py.
"""
import os
import json
import time
import requests
from datetime import datetime
from dotenv import load_dotenv

load_dotenv()

_ENV_WEBHOOK = os.getenv("DISCORD_WEBHOOK_URL", "")

STATUS_COLOR = {
    "success": 0x57F287,
    "failure": 0xED4245,
    "catchup": 0xFEE75C,
}

STATUS_EMOJI = {
    "success": "✅",
    "failure": "❌",
    "catchup": "⚠️",
}


def _send_with_retry(req_kwargs, max_retries=3, delay_sec=1.0) -> dict:
    for attempt in range(1, max_retries + 1):
        try:
            resp = requests.post(**req_kwargs, timeout=15)
            if resp.status_code == 429:
                wait_time = float(resp.headers.get("x-ratelimit-reset-after", delay_sec))
                print(f"[Discord] 429 Too Many Requests. Backing off for {wait_time}s")
                time.sleep(wait_time)
                # Retry logic continues
                if attempt == max_retries:
                    return {"success": False, "attempts": attempt, "error": "429 Rate Limit Exceeded"}
                continue
            resp.raise_for_status()
            return {"success": True, "attempts": attempt, "error": None}
        except Exception as exc:
            if attempt < max_retries:
                time.sleep(delay_sec * attempt)
            else:
                return {"success": False, "attempts": attempt, "error": str(exc)}
    return {"success": False, "attempts": max_retries, "error": "Max retries exceeded"}


def send_notification(
    scraper_name: str,
    status: str,
    scraper_thumbnail: str = None,
    episodes: list[dict] = None,
    error_msg: str = "",
    triggered_by: str = "scheduler",
    config: dict = None,
) -> dict:
    if config is None:
        config = {}

    url = config.get("webhook_url") or _ENV_WEBHOOK
    if not url:
        print("[Discord] No webhook URL configured — skipping notification.")
        return {"name": "Discord", "success": False, "attempts": 0, "error": "No Webhook URL configured"}

    delivery_method = config.get("delivery_method")
    if not delivery_method:
        # Fallback for old configurations
        delivery_method = "per_element_embed" if config.get("format_output", True) else "per_element_text"
        
    tag_all = config.get("tag_all", False)
    thumb_path = config.get("thumbnail_path", "")
    static_thumb = config.get("thumbnail_url", "")
    max_retries = int(config.get("retry_max", 3))
    delay_sec = float(config.get("delay_sec", 1.0))

    results = []

    def post(kwargs):
        res = _send_with_retry(kwargs, max_retries=max_retries, delay_sec=delay_sec)
        results.append(res)
        if not res["success"]:
            print(f"[Discord] Notification failed: {res['error']}")
        return res

    # Success notifications
    if status == "success" and episodes:
        if delivery_method == "all_file":
            content = "@everyone " if tag_all else ""
            content += f"**{scraper_name}** completed successfully! Retrieved {len(episodes)} items."
            file_data = json.dumps(episodes, indent=2).encode('utf-8')
            files = {"file": ("data.json", file_data, "application/json")}
            payload = {"content": content.strip()}
            post({"url": url, "data": payload, "files": files})

        elif delivery_method == "per_element_text":
            for ep in episodes:
                content = "@everyone\n" if tag_all else ""
                content += f"```json\n{json.dumps(ep, indent=2)}\n```"
                payload = {"content": content}
                post({"url": url, "json": payload})
                time.sleep(delay_sec)

        else: # per_element_embed
            for ep in episodes:
                title  = ep.get("title", "Unknown")
                ep_num = ep.get("episode_number")
                date   = ep.get("release_date")
                url_ep = ep.get("website_url")

                fields = [{"name": "📑 Episode Title", "value": title, "inline": False}]
                if ep_num:
                    fields.append({"name": "🔢 Episode Number", "value": f"#{ep_num}", "inline": True})
                if date:
                    fields.append({"name": "🗓️ Last Updated on", "value": date, "inline": True})
                if url_ep:
                    fields.append({"name": "🔗 Episode URL", "value": f"[Read Chapter]({url_ep})", "inline": False})

                known = {"title", "episode_number", "release_date", "website_url", "thumbnail"}
                for key, val in ep.items():
                    if key not in known and val:
                        label = key.replace("_", " ").title()
                        fields.append({"name": label, "value": str(val)[:256], "inline": True})

                embed = {
                    "title": scraper_name,
                    "color": STATUS_COLOR["success"],
                    "fields": fields,
                }
                if url_ep:
                    embed["url"] = url_ep

                thumb_url = static_thumb
                if not thumb_url and thumb_path:
                    keys = thumb_path.split(".")
                    val = ep
                    for k in keys:
                        if isinstance(val, dict): val = val.get(k)
                        else: val = None
                    if isinstance(val, str) and val.startswith("http"):
                        thumb_url = val
                        
                thumb_url = thumb_url or ep.get("thumbnail") or scraper_thumbnail

                if thumb_url and thumb_url.startswith("http"):
                    embed["thumbnail"] = {"url": thumb_url}

                content = "@everyone" if tag_all else ""
                payload = {"content": content, "embeds": [embed]}
                post({"url": url, "json": payload})
                time.sleep(delay_sec)

    else:
        emoji = STATUS_EMOJI.get(status, "ℹ️")
        color = STATUS_COLOR.get(status, 0x99AAB5)
        
        fields = [
            {"name": "Status",       "value": f"{emoji} {status.upper()}", "inline": True},
            {"name": "Triggered By", "value": triggered_by,                "inline": True},
        ]
        if error_msg:
            fields.append({"name": "Error Details", "value": error_msg[:1024], "inline": False})

        payload = {
            "embeds": [{
                "title":  f"🎌 {scraper_name}",
                "color":  color,
                "fields": fields,
                "footer": {"text": f"Anime Scraper Registry • {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}"},
            }]
        }
        post({"url": url, "json": payload})

    failed_any = any(not r.get("success") for r in results)
    max_att = max([r.get("attempts", 0) for r in results]) if results else 0
    first_err = next((r.get("error") for r in results if r.get("error")), None)
    
    return {
        "name": "Discord",
        "success": not failed_any if results else True, # if nothing sent, assume true or false? True.
        "attempts": max_att,
        "error": first_err
    }

"""
Discord notification sender using webhooks.
Now accepts webhook_url as a parameter (no more reliance on .env only).
Falls back to DISCORD_WEBHOOK_URL env var if no webhook_url is passed,
for backwards-compat with the legacy fallback path in runner.py.

New config shape:
  dispatch_mode:  "all_at_once" | "per_element"
  format_style:   "embed" | "text"          (per_element only)
  send_as_file:   true | false              (overrides format, sends .json attachment)
  tag_all:        true | false
  retry_max:      int
  delay_sec:      float
  thumbnail_path: str (dotted path into element dict)
  thumbnail_url:  str (static fallback)

Backward-compat: old "delivery_method" key is still honoured if the new keys are absent.
"""
import os
import json
import time
import requests
from datetime import datetime
from dotenv import load_dotenv

load_dotenv()

_ENV_WEBHOOK = os.getenv("STL_DISCORD_WEBHOOK_URL", "")

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


def _resolve_config(config: dict) -> tuple[str, str, bool]:
    """
    Returns (dispatch_mode, format_style, send_as_file) from either the
    new config keys or the legacy delivery_method key.
    """
    # New-style keys take precedence
    if "dispatch_mode" in config:
        dm = config.get("dispatch_mode", "per_element")
        fs = config.get("format_style", "embed")
        sf = bool(config.get("send_as_file", False))
        return dm, fs, sf

    # Legacy delivery_method backward-compat
    method = config.get("delivery_method", "per_element_embed")
    if method == "all_file":
        return "all_at_once", "embed", True
    elif method == "per_element_text":
        return "per_element", "text", False
    else:  # per_element_embed (default)
        return "per_element", "embed", False


def _resolve_thumb(ep: dict, thumb_path: str, static_thumb: str, scraper_thumbnail) -> str | None:
    thumb_url = static_thumb
    if not thumb_url and thumb_path:
        val = ep
        for k in thumb_path.split("."):
            if isinstance(val, dict):
                val = val.get(k)
            else:
                val = None
        if isinstance(val, str) and val.startswith("http"):
            thumb_url = val
    return thumb_url or ep.get("thumbnail") or scraper_thumbnail or None


def _build_embed(ep: dict, scraper_name: str, thumb_url, shorten_urls: bool = False, integration_name: str = None) -> dict:
    import re
    url_pattern = re.compile(r"https?://[^\s<>\"']+")

    def formatter(text):
        if not shorten_urls or not isinstance(text, str):
            return text
        return url_pattern.sub(lambda m: f"[Link]({m.group(0)})", text)

    ep_num = ep.get("episode_number")
    date = ep.get("release_date")
    url_ep = ep.get("website_url")

    fields = []
    if "title" in ep:
        fields.append({"name": "📑 Title", "value": formatter(ep.get("title")), "inline": False})
        
    if ep_num:
        fields.append({"name": "🔢 Number/ID", "value": f"#{ep_num}", "inline": True})
    if date:
        fields.append({"name": "🗓️ Last Updated on", "value": date, "inline": True})
    if url_ep:
        fields.append({"name": "🔗 URL", "value": f"[Link]({url_ep})", "inline": False})

    known = {"title", "episode_number", "release_date", "website_url", "thumbnail"}
    for key, val in ep.items():
        if key not in known and val:
            label = key.replace("_", " ").title()
            fields.append({"name": label, "value": formatter(str(val))[:1024], "inline": True})

    embed: dict = {
        "title": scraper_name,
        "color": STATUS_COLOR["success"],
        "fields": fields,
        "footer": {"text": f"{integration_name or 'ScraperHub'} • {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}"},
    }
    if url_ep and str(url_ep).startswith("http"):
        embed["url"] = url_ep
    if thumb_url and thumb_url.startswith("http"):
        embed["thumbnail"] = {"url": thumb_url}
    return embed


def send_notification(
    scraper_name: str,
    status: str,
    scraper_thumbnail=None,
    episodes=None,
    error_msg: str = "",
    triggered_by: str = "scheduler",
    config=None,
    integration_name: str = None,
):
    if config is None:
        config = {}

    url = config.get("webhook_url") or _ENV_WEBHOOK
    if not url:
        print("[Discord] No webhook URL configured - skipping notification.")
        return None

    dispatch_mode, format_style, send_as_file = _resolve_config(config)
    display_name = scraper_name
    tag_all = config.get("tag_all", False)
    thumb_path = config.get("thumbnail_path", "")
    static_thumb = config.get("thumbnail_url", "")
    max_retries = int(config.get("retry_max", 3))
    delay_sec = float(config.get("delay_sec", 1.0))
    shorten_urls = bool(config.get("shorten_urls", False))

    results = []

    def post(kwargs):
        res = _send_with_retry(kwargs, max_retries=max_retries, delay_sec=delay_sec)
        results.append(res)
        if not res["success"]:
            print(f"[Discord] Notification failed: {res['error']}")
        return res

    # ── Success path ──────────────────────────────────────────────────────────
    if status == "success" and episodes:
        mention = "@everyone " if tag_all else ""

        if send_as_file:
            if dispatch_mode == "per_element":
                for ep in episodes:
                    file_data = json.dumps(ep, indent=2).encode("utf-8")
                    files = {"file": ("element.json", file_data, "application/json")}
                    payload = {"content": (mention + f"**{display_name}** - element").strip()}
                    post({"url": url, "data": payload, "files": files})
                    time.sleep(delay_sec)
            else:  # all_at_once
                file_data = json.dumps(episodes, indent=2).encode("utf-8")
                files = {"file": ("data.json", file_data, "application/json")}
                payload = {"content": (mention + f"**{display_name}** completed! {len(episodes)} item(s).").strip()}
                post({"url": url, "data": payload, "files": files})

        elif dispatch_mode == "all_at_once":
            preview = json.dumps(episodes[:5], indent=2)
            suffix = f"\n… +{len(episodes)-5} more" if len(episodes) > 5 else ""
            content = mention + f"**{display_name}** - {len(episodes)} item(s) found\n```json\n{preview}{suffix}\n```"
            post({"url": url, "json": {"content": content.strip()}})

        elif format_style == "text":
            for ep in episodes:
                content = ("@everyone\n" if tag_all else "") + f"```json\n{json.dumps(ep, indent=2)}\n```"
                post({"url": url, "json": {"content": content}})
                time.sleep(delay_sec)

        else:  # per_element embed (default)
            for ep in episodes:
                thumb_url = _resolve_thumb(ep, thumb_path, static_thumb, scraper_thumbnail)
                embed = _build_embed(ep, display_name, thumb_url, shorten_urls=shorten_urls, integration_name=integration_name)
                content = "@everyone" if tag_all else ""
                post({"url": url, "json": {"content": content, "embeds": [embed]}})
                time.sleep(delay_sec)

    # ── Non-success path ──────────────────────────────────────────────────────
    else:
        emoji = STATUS_EMOJI.get(status, "ℹ️")
        color = STATUS_COLOR.get(status, 0x99AAB5)
        fields = [
            {"name": "Status",       "value": f"{emoji} {status.upper()}", "inline": True},
            {"name": "Triggered By", "value": triggered_by,                "inline": True},
        ]
        if error_msg:
            fields.append({"name": "Details", "value": error_msg[:1024], "inline": False})

        payload = {
            "embeds": [{
                "title":  scraper_name,
                "color":  color,
                "fields": fields,
                "thumbnail": {"url": scraper_thumbnail} if scraper_thumbnail and scraper_thumbnail.startswith("http") else None,
                "footer": {"text": f"{integration_name or 'ScraperHub'} • {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}"},
            }]
        }
        post({"url": url, "json": payload})

    failed_any = any(not r.get("success") for r in results)
    max_att = max([r.get("attempts", 0) for r in results]) if results else 0
    first_err = next((r.get("error") for r in results if r.get("error")), None)

    return {
        "name": "Discord",
        "success": not failed_any if results else True,
        "attempts": max_att,
        "error": first_err,
    }

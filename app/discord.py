"""
Discord notification sender using webhooks.
Now accepts webhook_url as a parameter (no more reliance on .env only).
Falls back to DISCORD_WEBHOOK_URL env var if no webhook_url is passed,
for backwards-compat with the legacy fallback path in runner.py.
"""
import os
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


def send_notification(
    scraper_name: str,
    status: str,
    scraper_thumbnail: str = None,
    latest_episode: dict = None,
    error_msg: str = "",
    triggered_by: str = "scheduler",
    webhook_url: str = None,
):
    url = webhook_url or _ENV_WEBHOOK
    if not url:
        print("[Discord] No webhook URL configured — skipping notification.")
        return

    payload = {}

    if status == "success" and latest_episode:
        title  = latest_episode.get("title", "Unknown")
        ep_num = latest_episode.get("episode_number")
        date   = latest_episode.get("release_date")
        url_ep = latest_episode.get("website_url")

        fields = [{"name": "📑 Episode Title", "value": title, "inline": False}]
        if ep_num:
            fields.append({"name": "🔢 Episode Number", "value": f"#{ep_num}", "inline": True})
        if date:
            fields.append({"name": "🗓️ Last Updated on", "value": date, "inline": True})
        if url_ep:
            fields.append({"name": "🔗 Episode URL", "value": f"[Read Chapter]({url_ep})", "inline": False})

        # Add any extra keys from the payload generically
        known = {"title", "episode_number", "release_date", "website_url", "thumbnail"}
        for key, val in latest_episode.items():
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

        thumb_url = latest_episode.get("thumbnail") or scraper_thumbnail
        if thumb_url and thumb_url.startswith("http"):
            embed["thumbnail"] = {"url": thumb_url}

        payload = {"content": "@everyone", "embeds": [embed]}

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

    try:
        resp = requests.post(url, json=payload, timeout=10)
        resp.raise_for_status()
    except Exception as exc:
        print(f"[Discord] Notification failed: {exc}")

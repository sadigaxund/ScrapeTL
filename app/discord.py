"""
Discord notification sender using webhooks.
No bot token required — just a webhook URL from a Discord channel.
"""
import os
import requests
from datetime import datetime
from dotenv import load_dotenv

load_dotenv()

WEBHOOK_URL = os.getenv("DISCORD_WEBHOOK_URL", "")

STATUS_COLOR = {
    "success": 0x57F287,   # green
    "failure": 0xED4245,   # red
    "catchup": 0xFEE75C,   # yellow
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
):
    """
    Send a Discord notification for a scraper run.
    """
    if not WEBHOOK_URL:
        print("[Discord] DISCORD_WEBHOOK_URL not set — skipping notification.")
        return

    payload = {}

    if status == "success" and latest_episode:
        title = latest_episode.get("title", "Unknown")
        ep_num = latest_episode.get("episode_number")
        date = latest_episode.get("release_date")
        url = latest_episode.get("website_url")

        fields = [{"name": "📑 Episode Title", "value": title, "inline": False}]
        if ep_num:
            fields.append({"name": "🔢 Episode Number", "value": f"#{ep_num}", "inline": True})
        if date:
            fields.append({"name": "🗓️ Last Updated on", "value": date, "inline": True})
        if url:
            fields.append({"name": "🔗 Episode URL", "value": f"[Read Chapter]({url})", "inline": False})

        embed = {
            "title": scraper_name,
            "color": STATUS_COLOR["success"],
            "fields": fields,
        }
        if url:
            embed["url"] = url

        # Optional thumbnail (per-episode takes priority over the scraper default)
        thumb_url = latest_episode.get("thumbnail") or scraper_thumbnail
        if thumb_url and thumb_url.startswith("http"):
            embed["thumbnail"] = {"url": thumb_url}

        payload = {
            "content": "@everyone",
            "embeds": [embed]
        }

    else:
        # Fallback embed for failures
        emoji = STATUS_EMOJI.get(status, "ℹ️")
        color = STATUS_COLOR.get(status, 0x99AAB5)
        
        fields = [
            {"name": "Status", "value": f"{emoji} {status.upper()}", "inline": True},
            {"name": "Triggered By", "value": triggered_by, "inline": True},
        ]
        if error_msg:
            fields.append({"name": "Error Details", "value": error_msg[:1024], "inline": False})

        payload = {
            "embeds": [
                {
                    "title": f"🎌 {scraper_name}",
                    "color": color,
                    "fields": fields,
                    "footer": {"text": f"Anime Scraper Registry • {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}"},
                }
            ]
        }

    try:
        resp = requests.post(WEBHOOK_URL, json=payload, timeout=10)
        resp.raise_for_status()
    except Exception as exc:
        print(f"[Discord] Notification failed: {exc}")

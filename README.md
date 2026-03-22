# Anime/Manga Scraper Hub

A lightweight, robust, and extensible web application designed to manage, schedule, and execute custom web scrapers for Anime and Manga sites. It features a clean dashboard, timezone-aware cron scheduling, local thumbnail caching, and rich integration with Discord webhooks.

## Features

- **Extensible Plugin System**: Easily add new scrapers by dropping a Python file into `app/scrapers/`. The UI automatically detects them via a smart "Module File" dropdown.
- **Smart Scheduling**: Built-in APScheduler integration allows you to run scrapers at specific intervals using standard Cron expressions. It natively supports configurable local timezones.
- **Catch-up Queue**: Missed a scheduled run because the server was down? The system automatically queues up and executes missed scrapes upon restart.
- **Discord Integration**: Sends beautifully formatted rich embeds to your Discord channel. It intelligently prevents spamming by comparing new episodes against your local database history.
- **Local Caching**: Thumbnails are securely downloaded and cached locally to prevent hotlinking issues and ensure fast UI rendering.
- **Modern UI**: A responsive, vanilla JS/CSS frontend interface to monitor logs, manage schedules, and manually trigger manual overrides.

## Technology Stack

- **Backend**: Python 3.9+, FastAPI, SQLAlchemy, APScheduler, BeautifulSoup4
- **Database**: SQLite
- **Frontend**: HTML5, CSS3, Vanilla JavaScript (No build steps required!)

## Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/sadigaxund/AnimeManga-Scraper-Hub.git
   cd AnimeManga-Scraper-Hub
   ```

2. **Create and activate a virtual environment:**
   ```bash
   python -m venv .venv
   # On Windows:
   .venv\Scripts\activate
   # On Linux/macOS:
   source .venv/bin/activate
   ```

3. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

4. **Environment Variables:**
   Create a `.env` file in the root directory and configure the following:
   ```env
   # Your Discord Webhook URL for notifications
   DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/YOUR_WEBHOOK_URL
   
   # Optional: Set your timezone for cron schedules (e.g., Asia/Dubai, UTC, Europe/London)
   APP_TIMEZONE=Asia/Dubai
   ```

5. **Run the application:**
   ```bash
   python run.py
   ```
   *The server will start on `http://127.0.0.1:8000`.*

## Writing a Custom Scraper

Writing a scraper is as simple as inheriting from `BaseScraper`. Create a new file in `app/scrapers/` (e.g., `my_custom_scraper.py`):

```python
from app.scrapers.base import BaseScraper

class MyCustomScraper(BaseScraper):
    def get_latest_episodes(self):
        # Your custom BeautifulSoup or HTTP logic here!
        return [
            {
                "title": "Episode 100",
                "episode_number": "100",
                "release_date": "2023-10-01",
                "website_url": "https://example.com/ep-100",
                "thumbnail": "https://example.com/thumb.jpg"
            }
        ]
```
The UI will automatically detect your new scraper and allow you to register it with the system!

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

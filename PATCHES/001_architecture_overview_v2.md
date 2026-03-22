# Patch 001: ScraperHub v2 Architecture Overview

## Motivation
To generalize the application beyond a simple Manhwa scraper into a robust scheduling and integration hub, the system underwent a major rewrite.

## Core Features Added
1. **Timezone Support:** Settings tab allows the user to set a global IANA timezone (e.g. `Asia/Baku`). The APScheduler instances respect this timezone globally across all scraping tasks.
2. **Tagging System:** Scrapers can be tagged/categorized with customizable colors.
3. **Integrations:** Removed hardcoded Discord notification code in favor of an Integrations model. Scrapers now define relationships with 0-to-many integrations.
4. **Scraper File Upload (Wizard):** You can now upload a `.py` file containing a `BaseScraper` class directly through the web UI instead of manually building and placing files. The API endpoint `/api/scrapers/wizard` handles `multipart/form-data`, generating a valid module filename from the provided Title UI input, handling both code and an optional thumbnail image simultaneously in a single request.
```
app/
├── api/
│   ├── integrations.py  # CRUD for Notification Integrations
│   ├── logs.py          # Log retrieval (paginated, filtered)
│   ├── run.py           # Manual manual override
│   ├── schedules.py     # APScheduler CRUD
│   ├── scrapers.py      # Registration & .py file upload logic
│   ├── settings.py      # Global config (currently: timezone)
│   ├── tags.py          # CRUD for visual tagging
│   └── __init__.py
├── scrapers/            # User-uploaded scraper modules
├── database.py          # SQLAlchemy SQLite connection
├── discord.py           # Handles payload formatting for Discord
├── main.py              # FastAPI app definition + routing
├── models.py            # SQLAlchemy Declarative Models
├── runner.py            # Executes scrapers, stores logs, fires integrations
└── scheduler.py         # Wraps APScheduler, handles timezone reloading
frontend/
├── app.js               # Vanilla JS state machine for UI
├── index.html           # Main HTML with tabbed sections
└── style.css            # Custom CSS with glassmorphism standard
```

## How a Scrape Run Works
1. `scheduler.py` registers the scrape task inside an internal APScheduler loop.
2. When the cron hits, `runner.py -> run_scraper(session, scraper_id)` triggers.
3. The scraper's `.py` file is dynamically loaded and executed.
4. If the execution is successful, a `ScrapeLog` is written and its JSON results are stored in `ScrapeLog.payload`.
5. `runner.py`: Iterate over the `Integration` elements assigned to this `Scraper` and fire off the webhook API calls (e.g. via `discord_notifier` logic) passing the payload.

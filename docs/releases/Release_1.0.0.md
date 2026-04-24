# ScrapeTL (Release 1.0.0) - AI Architect Context

This document synthesizes all initial system patches (001-011) into a single, highly-optimized master record. Use this to rapidly understand the core architecture, data structures, and feature sets natively built into ScrapeTL.

## 1. System Architecture
- **Language Stack**: Python 3.10+ (Backend), Vanilla JS / HTML5 / CSS3 (Frontend).
- **Core Libraries**: `FastAPI` (REST Web Server), `SQLAlchemy` (SQLite DB ORM), `APScheduler` (Background Cron engine), `Uvicorn` (ASGI host).
- **Control Loop**: The SPA Frontend dispatches async calls via an `apiFetch` wrapper to `/api/*` endpoints. All changes to the backend database state are reflected seamlessly on the next frontend background poll (`setInterval(refreshAll, 5000)`). Background APScheduler executors dispatch the dynamic `scraper.py` runtimes iteratively while correctly translating localized timezones to UTC internally.

## 2. Master Directory Map
- **`app/main.py`**: Initializes the FastAPI instance, mounts `/api/` routers and `/static/` frontend assets.
- **`app/models.py`**: SQLAlchemy Declarative Models (Schema defined fully below).
- **`app/api/*.py`**: The Modular REST API routers (`scrapers.py`, `settings.py`, `integrations.py`, `tags.py`, `logs.py`, `schedules.py`).
- **`app/scheduler.py`**: Wraps APScheduler runtime logic, handles global IANA timezone dynamic reloading securely dynamically.
- **`app/runner.py`**: High-availability execution pipeline. Loads arbitrary `.py` modules logically nested in `app/scrapers/` via `importlib` and captures stdout safely securely. Dispatches scraped JSON data cleanly to assigned Webhook Integrations sequentially.
- **`app/discord.py`**: Extracts native Webhooks config logic to format beautiful outbound Discord stylized embedded messages based strictly on scraped JSON payload formats.
- **`frontend/app.js`**: Pure Vanilla JS rendering logic. Rigidly relies on a globally exported `state` mapping object dynamically.
- **`frontend/index.html`**: A tabbed Single-Page Application (SPA) structure styled around natively injected CSS DOM modal layers.
- **`frontend/style.css`**: Highly customized Vanilla CSS relying on normalized CSS Variable tokens exclusively (`--bg-input`, `--accent`). (No Tailwind).

## 3. Database Schema (`app.db`)
- **`Scraper`**: Core scraping task entity. Features: `id`, `name`, `module_path` (.py file location), `description`, `homepage_url`, `thumbnail_url`.
- **`Tag`**: UI visual categorization structure. Features: `id`, `name`, `color` (HEX formatting). Associated to scrapers natively via `scraper_tags` Many-to-Many logic.
- **`Integration`**: Notification webhook targets (e.g. Discord). Features: `id`, `type`, `name`, `config` (JSON dict). Linked securely via `scraper_integrations`.
- **`Schedule`**: APScheduler mapping configs. Features: `id`, `scraper_id`, `cron_expression`, `enabled`, `last_run`, `next_run`.
- **`ScrapeLog`**: Final execution output results. Features: `id`, `scraper_id`, `status` (success/failure), `payload` (Raw JSON payload dictionary), `error_msg`, `run_at`.
- **`TaskQueue`**: Missed cron-schedules catch-up queue system. Features: `id`, `scraper_id`, `scheduled_for`, `status`.
- **`AppSetting`**: Arbitrary Global Config Key-value pairs (Significantly `timezone` = `Asia/Baku`).

## 4. Key AI Developer Constraints & System Notes
1. **Frontend State Wipes**: When radically altering DOM mapping logic in `app.js`, explicitly ensure you log boolean parameters onto the global `state` object statically (e.g. tracking open log modals natively as `state.expandedLogs = new Set()`). The background 5-second `refreshAll()` timer will wipe out and override any ad-hoc browser DOM modifications implicitly otherwise.
2. **Timezone UTC Enforcement**: While APScheduler operates smoothly on localized Timezones, you must ALWAYS convert internally computed datetimes into UTC prior to saving to the database (`job.next_run_time.astimezone(pytz.utc).replace(tzinfo=None)`). Otherwise, the frontend `new Date()` parses the local timestamps and erroneously applies the user's browser timezone offset a second time.
3. **No External Frameworks**: Do not implement OS-native `<select>` form elements, as they break the styling format. Use the application's bespoke `<div class="custom-dropdown">` z-indexed popup hierarchy. Do not rewrite CSS using `TailwindCSS`; continue strictly adhering to vanilla CSS variables defined in `style.css`.
4. **Scraper Versioning UX**: Code changes to existing scrapers can be tracked natively as new semantic versions (`v1.0.1`) straight from the UI Edit modal. You do not need to upload a fresh `.py` file to commit a bumped version if you are modifying variables.
5. **Discord Integrations Settings**: Discord endpoint variables (such as explicit webhook URLs, `@everyone` triggers, and custom JSON payload path resolutions) are persistently stored inside isolated `Integration.config` embedded JSON objects. Do not hardcode endpoint variables inside `/app/discord.py`.
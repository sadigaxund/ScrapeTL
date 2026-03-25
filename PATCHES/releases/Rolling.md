# Rolling Release Notes - March 24, 2026

## Core Implementation - No-Code Scraper Builder (v2.0)
We have pivoted the No-Code builder toward a "Component Collection" philosophy combined with a "Low-Code" escape hatch.
- **Collection Step**: Instead of a complex list parser, the UI now has a `Collect HTML Components` action. It allows selecting `outerHTML`, `innerHTML`, or `textContent` for a given CSS selector. 
- **Post-Processing Block**: Added a Python code editor in the wizard that accepts a `def process(components):` function. This allows the user to use BS4, Regex, or native Python string manipulation on the raw collected strings.
- **Recipe Runner**: The backend `recipe_runner.py` was updated to handle the new `action` types and safely execute the user's `post_process` code using `exec()`.

## Storage & Database Optimization
To prevent long-term SQLite bloat from large HTML payloads, we implemented a strict truncation policy.
- **Backend**: `runner.py` now slices `payload_list[:10]` strictly before stringifying and saving to the database.
- **UI Grace**: The Logs menu now interprets `log.episode_count` vs `log.payload.length`. If data was truncated, it displays: *"✨ Displaying 10 out of X scraped items."*

## UI Refinement & Aesthetics
A significant pass on the "Premium Look" of the dashboard:
- **Consistent Badges**: Introduced `.log-epcount` (vibrant purple pill badge) for found counts in Logs and "Next Run" times in Schedules.
- **Typography & Labels**: Standardized `.payload-download-label` and `.payload-truncation-notice` for cleaner data status reporting.
- **Layout Fixes**: Fixed alignment of Log Filters; they are now perfectly aligned with the left edge of the logs cards.
- **Schedules Beautification**: Applied the new badge and label styles to the Active Schedules list.

## Integration Maintenance
- **Ghost Errors**: Fixed a bug where logs would report "No Webhook URL configured" as a failure even if no integration was actually assigned to the scraper. Now returns `None` and skips the integration layer silently if nothing is configured.

---

## Timezone-Aware Timestamps & Scraper Input Parameters (March 25, 2026)

### 1. Timezone-Aware Timestamps
- **Client-Side Rendering**: `state.timezone` is now loaded from `/api/settings` on initialization.
- **Dynamic Formatting**: All timestamps (Logs, Schedules, Queue) are formatted using the user-configured timezone via `Intl.DateTimeFormat`.
- **Instant Sync**: Saving a new timezone in Settings instantly invalidates the frontend cache and re-renders all timestamps without a page reload.

### 2. Scraper Input Parameters
Scrapers can now declare a schema of input parameters, allowing for more flexible runtime execution.

**Architecture:**
- `BaseScraper` has an `inputs = []` class attribute. Subclasses override it.
- The `scrape()` method accepts `**kwargs` — the runner unpacks and passes inputs as keyword arguments.
- `app/api/scrapers.py` → `_scraper_dict()` uses `load_scraper_class_from_code()` to dynamically introspect the `inputs` schema from stored code and return it in the API. **Note:** `load_scraper_class_from_code()` seeds the exec namespace with the canonical `BaseScraper` to ensure `issubclass()` identity works correctly.
- `app/models.py` → `Schedule.input_values` (Text/JSON) stores per-schedule input values.
- `app/runner.py` → `run_scraper(input_values=None)` passes them as `**kwargs` to `scrape()`.
- `app/api/run.py` → `POST /api/run/{id}` accepts a JSON body `{ input_values: {...} }`.
- `app/api/schedules.py` → `POST /api/schedules` accepts and stores `input_values`.
- `app/scheduler.py` → `register_job()` forwards `input_values` to the runner on each cron trigger.

**UI Flow:**
- `runScraper(id)` in `app.js` checks `state.scrapers[id].inputs`. If non-empty, opens `#run-inputs-modal` before executing.
- `createSchedule()` same: opens modal to collect inputs before posting the schedule.
- Modal builder (`openRunInputsModal`) dynamically generates form fields from the `inputs` schema.

**Supported input types:** `text`, `number`, `boolean`, `select` (see `PATCHES/SCRAPER_INPUTS.md`).

**Example scraper definition:**
```python
class Scraper(BaseScraper):
    inputs = [
        {"name": "manhwa_name", "label": "Manhwa Name", "type": "text", "default": "My Manhwa"},
        {"name": "website_url", "label": "Website URL", "type": "text", "default": "https://..."},
    ]

    def scrape(self, **kwargs) -> list[dict]:
        manhwa_name = kwargs['manhwa_name']
        website_url = kwargs['website_url']
        ...
```

### 3. Schedule Card Redesign
The Active Schedules list received a significant UI overhaul:
- **Thumbnail**: Each schedule card now shows the scraper's thumbnail image.
- **Custom Label**: Schedules can have an optional name (`label` field in DB + API + create form). If set, displayed as main heading with scraper name as a smaller subtitle.
- **Enlarged Next Run Badge**: Prominent purple pill badge showing `⏭ Next: <date>`.
- **Expandable Inputs**: Clicking a card expands a panel showing all stored `input_values` as key-value chips (same UX pattern as Logs).
- **Files changed**: `app/models.py` (label column), `app/api/schedules.py` (accept/return label + thumbnail_url), `frontend/app.js` (rendering + `toggleSchedExpand()`), `frontend/style.css` (`.sched-card`, `.sched-thumb`, `.sched-next-badge`, etc.), `frontend/index.html` (Schedule Name input field).

---

### Context for Next Session
**Current state of the codebase (March 25, 2026):**

| Area | Status |
|---|---|
| Script-mode scrapers | ✅ Fully working. `BaseScraper` → `scrape(**kwargs)`. Inputs → kwargs. |
| Recipe-mode scrapers | ✅ Working but inputs system not integrated into Recipe builder UI yet. |
| Timezone | ✅ Frontend-only. Loaded from `/api/settings` on init. Saved via `/api/settings/timezone`. |
| Inputs system | ✅ Full stack: DB → API → scheduler → runner → modal UI. |
| Schedule labels | ✅ Optional. Stored in `schedules.label`. Falls back to scraper name. |
| Schedule thumbnails | ✅ Served from `/thumbnails/<path>` or external URL stored in `scrapers.thumbnail_url`. |

**Pending migrations needed after each server restart if DB was not updated:**
```bash
python -c "from app.database import engine; from app.models import Base; Base.metadata.create_all(bind=engine)"
```

**Known non-issues (false positives):**
- Pyre2 lint errors for `sqlalchemy`, `fastapi`, `app.*` imports — environment-related, do NOT affect runtime.

**Asset cache versions (bump when changing static files):**
- `app.js?v=9`
- `style.css?v=4`
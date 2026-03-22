# Patch 004: Full API & Code Analysis

## File: `app/api/scrapers.py`

### Endpoints
| Method   | Path                            | Description                                         |
|----------|---------------------------------|-----------------------------------------------------|
| GET      | `/api/scrapers`                 | List all scrapers (returns `_scraper_dict()`)       |
| GET      | `/api/scrapers/available`       | List raw `.py` modules in `app/scrapers/`           |
| POST     | `/api/scrapers/wizard`          | Multipart: registers a new scraper                  |
| PATCH    | `/api/scrapers/{id}`            | JSON `ScraperUpdate`: name/desc/homepage/thumb URL  |
| PATCH    | `/api/scrapers/{id}/toggle`     | Toggle `enabled` flag                               |
| DELETE   | `/api/scrapers/{id}`            | Hard-delete scraper                                 |

### `ScraperUpdate` Pydantic model (JSON PATCH)
```python
name: Optional[str]
description: Optional[str]
homepage_url: Optional[str]
thumbnail_url: Optional[str]
```

### Wizard flow (`POST /api/scrapers/wizard`)
1. Validates `.py` extension, UTF-8, has `BaseScraper` + `def scrape(self)`.
2. Generates slug from name (lowercased, non-alphanum → `_`).
3. Writes `.py` to `app/scrapers/<slug>.py`.
4. Dynamically imports & validates the class inherits `BaseScraper`.
5. Saves thumbnail file (or downloads from URL).
6. Inserts `Scraper` row.

### Key paths
```
DATA_DIR     = <project_root>/data/thumbnails/
SCRAPERS_DIR = <project_root>/app/scrapers/
```

### `_scraper_dict(s)` — serialized fields
`id, name, module_path, description, homepage_url, thumbnail_url, enabled, created_at, tags[], integrations[]`

---

## File: `app/models.py`

### Models
| Model         | Table              | Key Columns                                                    |
|---------------|--------------------|----------------------------------------------------------------|
| `Scraper`     | `scrapers`         | id, name, module_path, description, homepage_url, thumbnail_url, local_thumbnail_path, enabled, created_at |
| `Schedule`    | `schedules`        | id, scraper_id (FK), cron_expression, enabled, last_run, next_run |
| `ScrapeLog`   | `scrape_logs`      | id, scraper_id (FK), status, payload (JSON Text), episode_count, error_msg, run_at, triggered_by |
| `TaskQueue`   | `task_queue`       | id, scraper_id (FK), scheduled_for, status, created_at, processed_at |
| `Tag`         | `tags`             | id, name, color (#hex)                                         |
| `Integration` | `integrations`     | id, name, type, config (JSON Text)                             |
| `AppSetting`  | `app_settings`     | key (PK), value, updated_at                                    |

### Association Tables
- `scraper_tags` — links `Scraper ↔ Tag`
- `scraper_integrations` — links `Scraper ↔ Integration`

---

## File: `app/database.py`
- SQLite at `<project_root>/scraper_registry.db`
- `init_db()` → calls `Base.metadata.create_all()` + seeds `timezone=UTC` in `app_settings`
- `get_db()` → standard FastAPI dependency (yields session)

---

## File: `frontend/app.js` — State & Key Functions

### Global State
```javascript
state = { scrapers, tags, integrations, currentLogsPage, logsPageSize, activeTagFilter }
```

### Key Functions
| Function              | Purpose                                            |
|-----------------------|----------------------------------------------------|
| `apiFetch(url, opts)` | Generalized fetch; auto-JSON, throws on non-200    |
| `loadScrapers()`      | Fetches scrapers+tags, renders everything          |
| `renderScrapersList()`| Renders item-card HTML for each scraper            |
| `openWizardModal()`   | Opens the Setup Wizard, resets form                |
| `submitWizard(e)`     | Builds FormData, POSTs to `/api/scrapers/wizard`   |
| `openEditModal(id)`   | Populates + opens edit modal from `state.scrapers` |
| `saveEdit()`          | PATCH `/api/scrapers/{id}` with JSON body          |
| `handleWizCodeFile()` | Updates zone text/color on file select             |
| `handleWizThumbFile()`| Updates thumb preview on file select               |

### Modal IDs (DOM)
| Modal             | ID                    |
|-------------------|-----------------------|
| Setup Wizard      | `#wizard-modal`       |
| Edit Scraper      | `#edit-modal`         |
| Assign Tags       | `#assign-tags-modal`  |
| Assign Integrations | `#assign-integ-modal` |

### API constant map
```javascript
API.scrapers     = '/api/scrapers'
API.tags         = '/api/tags'
API.integrations = '/api/integrations'
API.scraperTags  = (sid, tid) => `/api/scrapers/${sid}/tags/${tid}`
API.scraperInteg = (sid, iid) => `/api/scrapers/${sid}/integrations/${iid}`
API.settings     = '/api/settings'
API.timezones    = '/api/settings/timezones'
```

---

## File: `frontend/index.html` — Modal Structure

### Wizard Modal (`#wizard-modal`)
Fields (in order): `#wiz-name`, `#wiz-desc`, `#wiz-home`, `#wiz-thumb-url`, `#wiz-thumb-file`, `#wiz-code-file` (hidden), `#wiz-code-zone` (click trigger).

### Edit Modal (`#edit-modal`)
Fields: `#edit-id` (hidden), `#edit-name`, `#edit-homepage`, `#edit-desc`, `#edit-thumb`.  
NOTE: No code upload, no thumbnail file upload (only URL). This was updated to match the wizard in v2 (see Patch 005).

### Scraper Card Actions (per row)
`▶ Run Now` | `🏷️ Tags` | `🔗 Integ` | `✏️ Edit` | `Enable/Disable` | `✕ Delete`

# Patch 005: Scraper Feature Enhancements (v1 Core Updates)

## 1. Semver Versioning (Scraper History)
- **Schema (`models.py`)**: `ScraperVersion` tracks `version_label` (String, e.g., "1.0.0") and `commit_message` (Text). *Note: The legacy `version_number` column was dropped entirely.*
- **API (`scrapers.py`)**: 
  - `POST ../wizard` & `PATCH ../{id}` accept `version_label` & `commit_message` fields, triggering `_snapshot_version()`.
  - `GET ../{id}/versions` serves historical commits.
  - `POST ../{id}/revert/{version_id}` overwrites the `.py` script with the archived code block.
- **UI (`app.js`, `index.html`)**: Setup Wizard/Edit modals now feature "Release Notes" and Major/Minor/Patch form inputs. Version History modal allows reading past code.

## 2. Dynamic Tag Management
- **UI**: Tags are fully managed directly in the Scrapers tab via `tag-manager-panel` (eliminating the need for a separate tags page).
- **Filtering**: Implemented `tag-filter-chips` to dynamically filter the `scrapers-list` DOM state without refetching.

## 3. Scraper Health Status
- **Schema**: `Scraper.health` (String) added (`"ok"`, `"failing"`, `"untested"`).
- **UI**: State mapped to visual badges (✅ Healthy, ❌ Failing, ⚙️ Untested).

## 4. Diagnostics & Logs Context
- **UI (`app.js`)**: Logs tab supports collapsible JSON drill-downs. `renderPayload()` renders nested dicts as readable tables and automatically hyperlinks values starting with `http`.

## 5. Wizard Prompting & Drag-Drop
- **UI**: Replaced static buttons with interactive Drag & Drop file zones (`wiz-code-zone`, `edit-code-zone`) with custom CSS interactions when `.py` files are queued.

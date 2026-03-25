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
- **Schema Declaration**: Subclassing `BaseScraper` and defining an `inputs` list of descriptors.
- **Dynamic UI**: 
  - **Run Now**: Opens a "Run with Inputs" modal if the scraper defines parameters.
  - **Schedule Creation**: Collects parameter values before creating a new schedule.
- **Backend Persistence**: Per-schedule input values are stored as JSON in the database and forwarded to the scraper's `scrape()` method as `**kwargs`.

#### Supported Input Types:
- `text`: Standard text input.
- `number`: Numeric field (passed as `int` or `float`).
- `boolean`: Checkbox (passed as `bool`).
- `select`: Dropdown menu (requires an `options` list).

**Example Schema:**
```python
inputs = [
    {"name": "start_chapter", "label": "Start Chapter", "type": "number", "default": 1},
    {"name": "lang",          "label": "Language",      "type": "select", "options": ["en", "jp"], "default": "en"},
]
```

---

### Context for Next Session
The scraper architecture is now highly dynamic, supporting both internal timezones and user-defined runtime parameters. The next phase should focus on expanding the "Recipe Mode" components to include these new input types, allowing low-code scrapers to benefit from the same parameterization as Python-based scrapers.
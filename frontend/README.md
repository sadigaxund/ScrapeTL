# Frontend Structure

Vanilla JS, zero build step. FastAPI serves everything in `/frontend/` as `/static/`.
All modules are classic `<script>` tags — functions are global, `onclick` handlers work as-is.

## Load Order (index.html)

```
state.js → utils.js → components.js → nav.js → builder.js → runner.js →
scrapers.js → schedules.js → logs.js → queue.js → integrations.js →
settings.js → variables.js → app.js (entry)
```

## Module Map

| File | Tab / Feature | Key Responsibilities |
|---|---|---|
| `modules/state.js` | — (shared) | `API` endpoint map, `state` object, `responseCache`, `TAB_META`, `NODE_PRESETS` |
| `modules/utils.js` | — (shared) | `apiFetch`, `toast`, `formatDate*`, `statusBadge`, drag-drop reorder, `toggleDropdown`, `filterDropdownConfig` |
| `modules/components.js` | — (shared) | Thumbnail preview helpers (`previewThumb`, `previewEditThumb`, `previewWizThumb`), file drag-drop zone setup |
| `modules/nav.js` | Sidebar nav | `switchTab`, `loadTab`, nav click wiring, `refreshAll`, 5s auto-refresh interval |
| `modules/builder.js` | Builder | Canvas pan/zoom, node placement, port connections, node config UI, `initBuilder`, `renderBuilderNodes`, `renderConnections`, save/load flow, `editInBuilder` |
| `modules/runner.js` | Run button (all tabs) | `runScraper`, `_doRunScraper`, task polling, Run Inputs modal, `runScraperFromBuilder`, `stopScraperRun` |
| `modules/scrapers.js` | Scrapers | `loadScrapers`, scraper list table, tag filter chips, New Scraper wizard, Edit modal, Versions modal, Assign Integrations modal, Assign Tags modal, scraper CRUD |
| `modules/schedules.js` | Schedules | `loadSchedules`, schedule list, New Schedule form, Edit Schedule modal, cron presets, schedule CRUD |
| `modules/logs.js` | Logs | `loadLogs`, filter dropdowns, log card expand/collapse, payload viewer, debug artifact inspector, log download |
| `modules/queue.js` | Queue | `loadQueue`, `renderQueueTasks`, sortable columns, One-Time Task modal |
| `modules/integrations.js` | Integrations | `loadIntegrations`, Connector modal (Discord + HTTP), delivery mode helpers, integration CRUD |
| `modules/settings.js` | Settings | `loadSettings`, `saveAllAppSettings`, timezone picker, browser defaults, log retention |
| `modules/variables.js` | Context Registry | `loadVariables`, variables table (inline edit, namespaces), `loadFunctions`, functions list, env vars view, `openContextRegistry` (builder expression picker), `switchContextTab` |
| `app.js` | — (entry point) | `DOMContentLoaded` bootstrap: initial data loads, drop zone wiring |

## Style System (`style.css`)

CSS custom properties in `:root` define the design tokens. Use these — don't repeat raw values inline:

```css
/* Colors */
--accent, --accent-hover, --accent-glow
--success, --success-bg
--failure, --failure-bg
--warning, --warning-bg
--pending, --pending-bg
--running, --running-bg
--cancelled, --cancelled-bg

/* Surfaces */
--bg-base, --bg-surface, --bg-card, --bg-card-hover, --bg-input

/* Borders */
--border, --border-strong

/* Text */
--text-primary, --text-secondary, --text-muted

/* Shape */
--radius-sm, --radius-md, --radius-lg

/* Misc */
--sidebar-w, --transition

/* Builder */
--builder-unit   /* 30px grid unit — port rows, snap increments */
```

## Builder Rules

These rules must be preserved when editing builder UI:

**Grid unit**: `--builder-unit: 30px` matches the canvas dot grid. Port rows must be exactly `var(--builder-unit)` tall so ports on adjacent nodes at the same row index share the same Y coordinate (straight connection lines).

**Port layout**: All non-utility nodes use `.node-ports-body` (flex row) with two equal `.node-ports-col` children — left column for inputs (stacked top-to-bottom), right column for outputs (stacked top-to-bottom). Ports still use `position: absolute; left: -7px / right: -7px` on the row to extend beyond the node edge. Utility (mini) nodes skip this wrapper and append port rows directly to the node element.

**Port color scheme**:
| Port type | Color | CSS class |
|---|---|---|
| Data (input/output) | `--accent` (purple) | `.node-port` default |
| Trigger | `#38bdf8` (sky blue) | `.node-port--trigger` |
| Error | `--failure` (red) | `.node-port--error` |
| True (boolean) | `--success` (green) | `.node-port--true` |
| False (boolean) | `--failure` (red) | `.node-port--false` |

Port label color must match port color — use `.node-port-label--trigger`, `.node-port-label--error`, `.node-port-label--true`, `.node-port-label--false`. Data port labels inherit `color: var(--accent)` from `.node-port-label`.

**Port label casing**: Title Case. No ALL CAPS abbreviations (`In 1` not `IN 1`, `Out` not `OUT`). Acronyms (HTML, CSS) stay uppercase.

**Input/Sink node width**: Both fixed at 180px (`width`, `min-width`, `max-width`) so cards are visually uniform.

**Context Registry "Pick" dropdown**:
- Input nodes: no `filter` → shows all variables, functions, built-ins, env vars
- Output/sink context node: `filter: 'writable'` → shows only non-readonly variables
- Search box at top filters all `.context-item` elements in real-time

## Adding a New Feature

1. Identify which tab it belongs to → edit that module file
2. If it's shared UI (modal shell, table, badge) → add to `components.js`
3. If it's a new API endpoint → add to `API` map in `state.js`
4. New state fields → add to `state` object in `state.js`
5. HTML structure → edit `index.html` (modals at bottom, tab panels in main)

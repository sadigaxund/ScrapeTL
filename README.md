<div align="center">
  <h1>🚀 ScrapeTL</h1>
  <p><b>The Open-Source Scraper Management & Orchestration Platform</b></p>
  <p>
    <img src="https://img.shields.io/badge/Python-3.11+-blue.svg" alt="Python 3.11+">
    <img src="https://img.shields.io/badge/FastAPI-005571?style=flat&logo=fastapi" alt="FastAPI">
    <img src="https://img.shields.io/badge/Database-SQLite-003B57?style=flat&logo=sqlite" alt="SQLite">
    <img src="https://img.shields.io/badge/Frontend-Vanilla_JS-F7DF1E?style=flat&logo=javascript" alt="Vanilla JS">
  </p>
  <p><i>A hybrid no-code/low-code engine to visually build, schedule, and orchestrate web scraping pipelines with integrated Playwright, custom Python UDFs, and robust timezone-aware task queues.</i></p>
</div>

---

## Table of Contents

- [Overview](#overview)
- [Installation](#installation)
- [Scraper Types](#scraper-types)
- [Input Parameters](#input-parameters)
- [Builder Node Reference](#builder-node-reference)
- [Context Registry & Expressions](#context-registry--expressions)
- [User-Defined Functions (UDFs)](#user-defined-functions-udfs)
- [Scheduling](#scheduling)
- [Configuration](#configuration)
- [Technology Stack](#technology-stack)

---

## Overview

**ScrapeTL** is a lightweight orchestration engine for managing web scrapers. It handles execution, scheduling, fault-recovery, and notification routing (Discord/Webhooks) from a unified dark-mode dashboard.

**Core features:**

- **Visual Scraper Builder** — Node-based flow editor. Connect Fetchers, Selectors, and Transformers on a zoomable 2D canvas.
- **Expression Engine** — Inject dynamic logic via `{{ ... }}` syntax. Call built-ins or your own Python UDFs.
- **Debug Inspector** — Tap any node with a Debug Sink to inspect raw data, HTML previews, and JSON mid-flow.
- **Cron Scheduling** — APScheduler-powered with full IANA timezone support (`Asia/Baku`, `UTC`, etc.).
- **Fault-Tolerant Queue** — Missed tasks are recovered automatically on restart via a persistent catch-up queue.
- **Integrations** — Discord webhooks and HTTP POST with custom payload templates.
- **Versioning** — Every scraper edit is snapshotted. Roll back or bump versions on demand.

---

## Installation

### PyPI (Recommended)

```bash
pip install "scrapetl[playwright]"
playwright install chromium
scrapetl run --port 8000
```

> If you only need HTTP/HTML scraping (no browser), `pip install scrapetl` is enough — skip `playwright install`.

### Docker Compose

```bash
curl -O https://raw.githubusercontent.com/sadigaxund/ScrapeTL/main/docker-compose.yml
docker-compose up -d
```

### From Source

```bash
git clone https://github.com/sadigaxund/ScrapeTL.git
cd ScrapeTL
python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[playwright]"
playwright install chromium
scrapetl run --reload
```

Access the dashboard at `http://localhost:8000`.

---

## Scraper Types

### Visual Builder (No-Code)

Open the **Builder** tab, place nodes on the canvas, and connect ports by dragging from an output dot to an input dot. Save your flow — ScrapeTL serializes and executes it when triggered.

**Typical flow:**

```
[Parameter: URL] ──► [Browser Fetch] ──► [CSS Select] ──► [Text Transform] ──► [Output]
```

See [Builder Node Reference](#builder-node-reference) for all available nodes.

### Python Class (Low-Code)

For complex extraction logic, write a standard Python class using `BaseScraper`:

```python
from scrapetl.scrapers.base import BaseScraper

class PriceMonitor(BaseScraper):
    inputs = [
        {"name": "url",      "label": "Product URL",    "type": "string"},
        {"name": "selector", "label": "Price Selector", "type": "string", "default": ".price"},
    ]

    def scrape(self, url="", selector=".price", **kwargs):
        import requests
        from bs4 import BeautifulSoup
        soup = BeautifulSoup(requests.get(url).text, "html.parser")
        el = soup.select_one(selector)
        return [{"price": el.text.strip()}] if el else []
```

Paste the code into the **Code Editor** tab when creating a scraper.

---

## Input Parameters

Both scraper types support a declarative input schema. The UI generates run forms and schedule configuration from this schema automatically.

### Supported Types

| Type | UI Control | Python type |
|---|---|---|
| `string` | Text input | `str` |
| `number` | Text input | `int` or `float` |
| `boolean` | Checkbox | `bool` |
| `select` | Dropdown | `str` |

### Field Reference

| Field | Required | Description |
|---|---|---|
| `name` | Yes | kwarg name passed to `scrape()` |
| `label` | No | Human-readable UI label |
| `type` | Yes | One of the types above |
| `default` | No | Pre-filled value |
| `options` | `select` only | List of allowed values |
| `required` | No | Enforce non-empty in the run form |

### Example

```python
inputs = [
    {"name": "chapter",  "label": "Starting Chapter", "type": "number",  "default": 1},
    {"name": "lang",     "label": "Language",          "type": "select",  "options": ["en", "jp"], "default": "en"},
    {"name": "headless", "label": "Headless Browser",  "type": "boolean", "default": True},
]
```

---

## Builder Node Reference

### Input Nodes

| Node | Description |
|---|---|
| **External Parameter** | Accepts a user-supplied value at run time (`string`, `number`, `boolean`, `select`). |
| **Get Variable** | Reads from the Context Registry or evaluates an expression. Generator UDFs here produce a `Batch`. |

### Source Nodes

| Node | Description |
|---|---|
| **HTTP Fetch** | Standard HTTP request (GET/POST) with optional custom headers. |
| **Browser Fetch** | Full Chromium execution via Playwright. Supports interactive actions (see below). |
| **Image Fetch** | Fetches an image URL and returns it as `base64`, hex bytes, or passthrough URL. |

### Action Nodes

| Node | Description |
|---|---|
| **CSS Select** | Extract elements via CSS selector. Modes: `first` / `all`. Output: `html`, `text`, `attr`. |
| **HTML Children** | Split a parent element into a list of its direct children. |
| **Regex Extract** | Extract a capture group from text using a regex pattern. |
| **Text Transform** | `prefix`, `suffix`, `replace`, or `trim` a text value. |
| **String Format** | Format a template using positional inputs: `{0}/{1}?page={2}`. Input ports are labelled `{0}`, `{1}`, … to match the template directly. |
| **Type Cast** | Convert a value to `string`, `number`, `boolean`, or `json`. |

### Logic Nodes

| Node | Outputs | Description |
|---|---|---|
| **Logic Gate** | True / False | AND, OR, NAND, NOR, XOR, NOT across N inputs. |
| **Comparison** | True / False | `>`, `<`, `==`, `!=`, `>=`, `<=` between two values. |
| **String Match** | True / False | Substring, prefix, suffix, or regex match. |
| **Status Check** | True / False | Unary checks: `is_truthy`, `is_null`, `is_empty`, etc. |
| **Custom Logic** | True / False | Calls a **comparator** UDF from the registry. |
| **NOT** | Out | Inverts a boolean signal. |
| **Math** | Result | Arithmetic on two numeric inputs: `add`, `subtract`, `multiply`, `divide`, `modulo`, `power`, `min`, `max`, `abs`, `round`, `floor`, `ceil`. |

### Utility Nodes

| Node | Description |
|---|---|
| **Split** | Duplicates a signal into N parallel paths. |
| **Merge** | Combines N inputs into one. Modes: `list`, `flatten`, `merge_object`. |
| **Relay / Tap** | Wire store — pass values across unconnected parts of the flow. |

### Sink Nodes

| Node | Description |
|---|---|
| **Output** | Collects final results. Data here appears in Logs and is forwarded to integrations. |
| **Set Variable** | Writes a value into a writable Context Registry variable. |
| **Debug** | Captures intermediate data as an inspectable artifact (viewable in log history). |
| **Raise Skip** | Aborts the current iteration with a `skipped` status (no failure logged). |

---

### Playwright Actions (Browser Fetch node)

| Action | Description |
|---|---|
| `goto` | Navigate to a URL |
| `click` | Click an element by CSS/XPath selector |
| `fill` | Type text into an input field |
| `wait` | Wait a fixed duration (ms) |
| `wait_for_selector` | Wait until an element appears in the DOM |
| `scroll_bottom` | Scroll to the bottom of the page |
| `scroll_to` | Scroll a specific element into view |
| `screenshot` | Return a PNG screenshot as base64 |
| `fetch_image` | Extract an image via canvas pixel read (bypasses CORS/referrer blocks) |

**Stealth Mode** — Enable in **Settings → Browser Stealth** to activate `playwright_stealth` fingerprint patching, realistic user agent, viewport (1920×1080), locale (`en-US`), and timezone. Each URL in a batch gets a fresh page to ensure stealth patches apply cleanly.

---

### Batch Execution & Implicit Iteration

The engine is list-aware. Connect a list output (e.g., CSS Select in `all` mode) to any node — the engine maps the operation over every item automatically without explicit loops.

**Generator UDFs** placed in a **Get Variable** node produce a `Batch`. All downstream nodes run once per yielded value:

```
[Get Variable: page_range(base_url, 1, 50)] ──► [Browser Fetch] ──► [CSS Select] ──► [Output]
```

This runs the entire downstream flow 50 times, once per page URL.

---

## Context Registry & Expressions

Use `{{ expression }}` anywhere text is accepted: scraper inputs, schedule values, String Format templates, notification payloads, node configs.

### Built-in Expressions

| Expression | Returns | Example |
|---|---|---|
| `{{today()}}` | `YYYY-MM-DD` | `2024-03-28` |
| `{{now()}}` | `YYYY-MM-DD HH:MM:SS` | `2024-03-28 14:30:05` |
| `{{yesterday()}}` | `YYYY-MM-DD` | `2024-03-27` |
| `{{env("VAR")}}` | env variable value | `{{env("API_KEY")}}` |
| `{{random(a, b)}}` | random integer | `{{random(1, 100)}}` |
| `{{uuid()}}` | UUID v4 string | `f47ac10b-...` |
| `{{json(obj)}}` | JSON string | `{{json({"id":1})}}` |
| `{{upper(s)}}` | uppercase | `{{upper("hello")}}` → `HELLO` |
| `{{lower(s)}}` | lowercase | `{{lower("HI")}}` → `hi` |
| `{{strip(s)}}` | trimmed | `{{strip(" hi ")}}` → `hi` |

Any valid Python expression works: `{{today()[:4]}}`, `{{1 + 2 * 3}}`, `{{"hello".upper()}}`.

### Shared Variables

Define global key-value pairs in **Context Registry → Shared Variables**. Access by name: `{{my_key}}`.

Types: `string`, `integer`, `float`, `boolean`, `json`, `batch`.

A `batch` variable (JSON array) automatically drives iteration — a Parameter node whose default is `{{my_urls}}` runs the flow once per item.

### Namespaces

Group related variables under a namespace:

```
Namespace: API  /  Key: token  →  {{API.token}}
```

---

## User-Defined Functions (UDFs)

Write Python functions in **Context Registry → Functions** or import `.py` files. The system auto-detects category from decorators, `yield` usage, or `-> bool` return type.

### Transformer (default)

Returns a single transformed value.

```python
def clean_title(text: str) -> str:
    return text.strip().title()
```

### Comparator

Returns `bool`. Used in the **Custom Logic** node.

```python
from scrapetl import comparator

@comparator
def is_cheap(price: float, threshold: float = 100.0) -> bool:
    return float(price) <= threshold
```

### Generator

Uses `yield`. Placed in a **Get Variable** node, outputs a `Batch` — the downstream flow runs once per yielded value.

```python
from scrapetl import generator

@generator
def page_range(base_url: str, start: int, end: int, step: int = 1):
    for i in range(start, end, step):
        yield f"{base_url}?page={i}"
```

The expression picker inserts only **required** arguments. Optional args (those with defaults) are shown in brackets — add them manually if needed:

```
Picker inserts:  {{page_range(base_url, start, end)}}
Optional step:   {{page_range(base_url, start, end, step)}}   ← add manually if needed
```

---

## Scheduling

Create schedules in the **Schedules** tab using standard cron syntax or built-in presets.

| Preset | Cron |
|---|---|
| Every hour | `0 * * * *` |
| Daily at midnight | `0 0 * * *` |
| Every Monday 9 AM | `0 9 * * 1` |

- Each schedule stores its own input parameter values.
- Timezone is configurable per schedule (full IANA timezone list).
- Missed runs (server was offline) are added to the catch-up queue on next start.

---

## Configuration

All settings are available in the **Settings** tab or as environment variables. Environment variables override database values.

| Setting | Env Variable | Default | Description |
|---|---|---|---|
| Timezone | `STL_TIMEZONE` | `UTC` | Server timezone for schedules |
| Log Directory | `STL_LOGS_PATH` | `./logs` | Where stdout log files are stored |
| Log Retention | `STL_LOG_RETENTION_DAYS` | `30` | Auto-delete logs older than N days |
| Log Max Size | `STL_LOG_MAX_SIZE_KB` | `2048` | Max size per log file (KB) |
| Log Preview Limit | `STL_LOG_PREVIEW_LIMIT` | `100` | Max log lines shown in UI |
| Browser Headless | `STL_BROWSER_HEADLESS` | `true` | Run Playwright in headless mode |
| Browser CDP URL | `STL_BROWSER_CDP_URL` | _(none)_ | Connect to a remote Chrome instance via CDP |

**Stealth Mode** and **CDP URL** can also be set per-scraper (overrides global for that scraper only).

---

## Technology Stack

| Layer | Tech |
|---|---|
| Backend | Python 3.11+, FastAPI, SQLAlchemy, APScheduler |
| Browser | Playwright (Chromium) |
| Frontend | HTML5, CSS3, Vanilla ES6+ (zero build step) |
| Database | SQLite |

---

## License

Apache License 2.0

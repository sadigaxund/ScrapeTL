# Patch 002: SQLAlchemy Database Schema

## Overview
The application uses SQLite (`scraper_registry.db`) via standard SQLAlchemy ORM models defined in `app/models.py`.

## Core Models

### `AppSetting`
Stores global application settings as key-value pairs.
*   **Columns**: `key` (String, PK), `value` (String).
*   **Usage**: The scheduler queries this table dynamically on launch and on update to configure the execution timezone.

### `Tag`
Stores visual tags that can be attached to scrapers.
*   **Columns**: `id` (PK), `name` (String), `color` (String, HEX code).
*   **Relationships**: `scrapers` (Many-to-Many through `scraper_tags`).

### `Integration`
Replaces hardcoded alert systems (like Discord). Stores external notification configs.
*   **Columns**: `id` (PK), `type` (String, e.g., "discord_webhook"), `name` (String), `config` (JSON map containing `webhook_url`, etc).
*   **Relationships**: `scrapers` (Many-to-Many through `scraper_integrations`).

### `Scraper`
The core object representing a scraping task.
*   **Columns**: `id` (PK), `name` (String), `module_path` (String path to the `.py` module), `description`, `homepage_url`, `thumbnail_url`.
*   **Relationships**: 
    - `tags` (List of `Tag`s)
    - `integrations` (List of `Integration`s)
    - `logs` (List of `ScrapeLog`s)
    - `schedules` (List of `Schedule`s)

### `Schedule`
APScheduler configuration for a specific Scraper.
*   **Columns**: `id` (PK), `scraper_id` (FK), `cron_expression` (String, e.g. "0 * * * *"), `enabled`, `next_run`, `last_run`.

### `TaskQueue`
Holds tasks that the scheduler missed (due to downtime). The system checks this upon booting.
*   **Columns**: `id` (PK), `scraper_id` (FK), `scheduled_for` (DateTime), `status`.

### `ScrapeLog`
The result of an execution.
*   **Columns**: `id` (PK), `scraper_id` (FK), `status` (String: 'success' or 'failure'), `payload` (JSON Text representing the raw data captured by the scraper), `error_msg` (Text, if applicable).

## Association Tables
1. **`scraper_tags`**: Links a `Scraper` and a `Tag`.
2. **`scraper_integrations`**: Links a `Scraper` and an `Integration`.

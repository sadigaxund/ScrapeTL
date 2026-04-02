<div align="center">
  <h1>🚀 ScrapeTL</h1>
  <p><b>The Open-Source Scraper Management & Orchestration Platform</b></p>
  <p>
    <img src="https://img.shields.io/badge/Python-3.10+-blue.svg" alt="Python 3.10+">
    <img src="https://img.shields.io/badge/FastAPI-005571?style=flat&logo=fastapi" alt="FastAPI">
    <img src="https://img.shields.io/badge/Database-SQLite-003B57?style=flat&logo=sqlite" alt="SQLite">
    <img src="https://img.shields.io/badge/Frontend-Vanilla_JS-F7DF1E?style=flat&logo=javascript" alt="Vanilla JS">
  </p>
</div>

---

**ScrapeTL** is a lightweight, robust orchestration engine designed to manage, schedule, and execute custom web scrapers. It provides a beautiful web-based interface for overseeing your data extraction pipeline, featuring native timezone support, custom webhook integrations, and a secure no-code deployment workflow.

## ✨ Core Pillars

- **🏗️ Visual Scraper Builder**: Move beyond code with the integrated node-based flow editor. Connect Fetchers, Selectors, and Transformers on a zoomable 2D canvas to build enterprise-grade scrapers visually.
- **🧩 Functional Expression Engine**: Inject dynamic logic into your flows using `{{ ... }}` syntax. Call built-in functions like `now()`, `uuid()`, and `random()` or define custom Python UDFs for complex data cleaning.
- **🔬 Granular Debug Inspector**: Troubleshoot failing scrapers with ease. Use the Debug Sink node to "tap" into any part of your flow and view raw data, HTML previews, and JSON structures in a dedicated, sandboxed inspector.
- **🕒 Precision Scheduling**: Powered by `APScheduler`, manage complex execution cycles via standard Cron expressions. Includes native IANA timezone resolution (e.g., `Asia/Baku`, `UTC`) to ensure global accuracy.
- **🔄 Fault-Tolerant Queue**: Automatically tracks and recovers missed tasks. If the server restarts, ScrapeTL identifies overdue jobs and processes them immediately via a persistent catch-up queue.
- **🔌 Flexible Integrations**: Distribute data effortlessly. Configure Discord webhooks, JSON payloads, and custom notification templates directly through the UI.
- **📦 Semantic Versioning**: Built-in system snapshots allow you to edit scraper logic and perform on-the-fly version bumps (e.g., `v2.0.0`) with clear audit trails.
- **💎 Premium Dashboard**: A high-performance, glassmorphic dark-mode SPA providing real-time log monitoring, queue management, and interactive health diagnostics.

## 🛠️ Technology Stack

- **Core**: Python 3.10+, FastAPI, SQLAlchemy, APScheduler
- **UI**: HTML5, CSS3 (Vanilla), Vanilla ES6+ JavaScript (Zero build dependencies)
- **Database**: SQLite (Production-ready out of the box)

## 🚀 Deployment

1. **Clone the repository:**
   ```bash
   git clone https://github.com/sadigaxund/ScrapeTL.git
   cd ScrapeTL
   ```

2. **Environment Setup:**
   ```bash
   python -m venv .venv
   source .venv/bin/activate  # Linux/macOS
   .venv\Scripts\activate     # Windows
   pip install -r requirements.txt
   ```

3. **Launch:**
   ```bash
   python run.py
   ```
   *Access the dashboard at `http://localhost:8000`.*

---

## 🧩 Building Your First Scraper

ScrapeTL offers a hybrid approach to development, supporting both visual flows and traditional Python scripts.

### Option A: The Scraper Builder (Visual)
Navigate to **Builder** in the dashboard to create a scraper using the node-based flow editor. This is the fastest way to get started and requires zero code for most common scraping tasks (HTML extraction, Regex, JSON parsing).

### Option B: Python-Based (Code)
For complex scraping scenarios requiring custom libraries or intricate logic, inherit from `BaseScraper` and define your rules in a `.py` file.

```python
from app.scrapers.base import BaseScraper

class WebMonitor(BaseScraper):
    def scrape(self):
        # Your extraction logic (BeautifulSoup, requests, etc.)
        return [{"title": "Data Point A", "value": "123.45"}]
```

Once written, upload this file through the **Setup Wizard** on the dashboard. ScrapeTL will securely import, version, and orchestrate the tasks according to your schedule.

## 📜 License

This project is open-source software licensed under the **MIT License**.

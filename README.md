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

- **🪄 No-Code Orchestration**: Deploy new scrapers via a drag-and-drop Setup Wizard. Upload your Python logic, and ScrapeTL handles the lifecycle, versioning, and scheduling automatically.
- **🕒 Precision Scheduling**: Powered by `APScheduler`, manage complex execution cycles via standard Cron expressions. Includes native IANA timezone resolution (e.g., `UTC`, `Europe/London`, `Asia/Baku`) to ensure global accuracy.
- **🔄 Fault-Tolerant Queue**: Automatically tracks and recovers missed tasks. If the server restarts, ScrapeTL identifies overdue jobs and processes them immediately via a persistent catch-up queue.
- **🔌 Flexible Integrations**: Distribute data effortlessly. Configure Discord webhooks, JSON payloads, and custom notification templates directly through the UI without restarting the application.
- **📦 Semantic Versioning**: Built-in system snapshots allow you to edit scraper logic and perform on-the-fly version bumps (e.g., `v1.2.0`) with clear audit trails.
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

ScrapeTL simplifies the bridge between your logic and the infrastructure. Simply inherit from `BaseScraper` and define your extraction rules.

```python
from app.scrapers.base import BaseScraper

class WebMonitor(BaseScraper):
    def scrape(self):
        # Your extraction logic (BeautifulSoup, Selectors, etc.)
        return [
            {
                "title": "Data Point A",
                "value": "123.45",
                "timestamp": "2024-01-01",
                "website_url": "https://example.com/data",
                "thumbnail": "https://example.com/preview.png"
            }
        ]
```

Once written, upload this file through the **Setup Wizard** on the dashboard. ScrapeTL will securely import, validate, and begin orchestrating your data collection according to your chosen schedule.

## 📜 License

This project is open-source software licensed under the **MIT License**.

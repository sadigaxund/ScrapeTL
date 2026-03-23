<div align="center">
  <h1>🌟 ScrapeTL</h1>
  <p><b>Your Centralized Anime & Manga Web Scraper Hub</b></p>
  <p>
    <img src="https://img.shields.io/badge/Python-3.10+-blue.svg" alt="Python 3.10+">
    <img src="https://img.shields.io/badge/FastAPI-005571?style=flat&logo=fastapi" alt="FastAPI">
    <img src="https://img.shields.io/badge/Database-SQLite-003B57?style=flat&logo=sqlite" alt="SQLite">
    <img src="https://img.shields.io/badge/Frontend-Vanilla_JS-F7DF1E?style=flat&logo=javascript" alt="Vanilla JS">
  </p>
</div>

---

**ScrapeTL** (formerly ScraperHub) is a lightweight, robust, and beautifully designed web application built to manage, schedule, and execute custom Python scrapers. Manage your schedules with robust timezone support, configure custom webhook integrations (like Discord), and deploy entirely new scrapers securely without writing a single line of frontend code.

## ✨ Features

- **🪄 Setup Wizard (No-Code Deploy)**: Deploy new scrapers via a drag-and-drop web UI. Upload your `.py` logic and the application dynamically loads, versions, and schedules the scraper securely.
- **🕒 Bulletproof Task Scheduling**: Powered by `APScheduler`, schedule recurring sweeps via standard Cron expressions (e.g., `0 */6 * * *`). The backend natively resolves user-configured IANA timezones (e.g., `Asia/Baku`) accurately against UTC boundaries.
- **🔄 Missed Task Catch-up**: Server went down? ScrapeTL logs missed cron jobs into a secondary `Queue` and rapidly catches up on restart.
- **🔌 Dynamic Integrations**: Build custom Discord notification templates. Point webhooks directly to Discord via the UI without touching environment variables. Features intelligent JSON payload parsing and rich embedded thumbnail extraction.
- **🏷️ Visual Tagging & Dashboard**: Organize scrapers with custom color-coded HEX tags. Monitor results via a clean, glassmorphic dark-mode interface spanning real-time paginated logs and queue elements.
- **📦 Version Control System**: Edit existing scrapers via the UI and perform on-the-fly semantic version bumps (e.g., `v1.0.1`) explicitly attached to internal system snapshots.

## 🛠️ Technology Stack

- **Backend**: Python 3.10+, FastAPI, SQLAlchemy (SQLite), APScheduler, BeautifulSoup4
- **Frontend**: HTML5, CSS3, Vanilla ES6 JavaScript (Zero Build Steps!)

## 🚀 Installation & Quick Start

1. **Clone the repository:**
   ```bash
   git clone https://github.com/sadigaxund/AnimeManga-Scraper-Hub.git
   cd AnimeManga-Scraper-Hub
   ```

2. **Create and activate a virtual environment:**
   ```bash
   python -m venv .venv
   
   # Windows
   .venv\Scripts\activate
   
   # Linux/macOS
   source .venv/bin/activate
   ```

3. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

4. **Launch the Server:**
   ```bash
   python run.py
   ```
   *The Single Page Application (SPA) will start locally at `http://127.0.0.1:8000`.*

> **Note**: Timezone and Integrations are no longer configured manually via `.env` files. Navigate to the **Settings** and **Integrations** tabs inside the Web UI to configure your environment natively on the fly!

## 🧩 Writing a Custom Scraper

Writing a scraper is incredibly intuitive. Inherit from the application `BaseScraper` class and simply override the isolated `scrape()` method.

```python
from app.scrapers.base import BaseScraper

class MyCustomScraper(BaseScraper):
    def scrape(self):
        # Your custom BeautifulSoup or HTTP logic goes here!
        # Return a dynamically parsed list of dictionaries. The app handles the rest.
        return [
            {
                "title": "Episode 100",
                "episode_number": "100",
                "release_date": "2023-10-01",
                "website_url": "https://example.com/ep-100",
                "thumbnail": "https://example.com/thumb.jpg"
            }
        ]
```
Upload this exact python file straight into the **Setup Wizard** on the dashboard, assign it a name and execution schedule, and the engine takes over securely.

## 📜 License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

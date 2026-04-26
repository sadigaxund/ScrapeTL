import re
import requests
from bs4 import BeautifulSoup, Tag
from scrapetl import BaseScraper
from scrapetl import ScrapeSkip
import os
import sqlite3

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/123.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
}

# Shared Cache Database
CACHE_DIR = "./tmp/scrapers_cache.db"
os.makedirs('./tmp/', exist_ok=True)

def get_db():
    # Use 5s timeout and WAL mode for better concurrency
    conn = sqlite3.connect(CACHE_DIR, timeout=5.0)
    conn.execute("PRAGMA journal_mode=WAL")
    return conn

# Initialize shared table
_conn = get_db()
_conn.execute("""
CREATE TABLE IF NOT EXISTS scraped (
    manhwa_name TEXT NOT NULL,
    episode_no INTEGER NOT NULL,
    UNIQUE (manhwa_name, episode_no)
)
""")
_conn.commit()
_conn.close()

class Scraper(BaseScraper):
    name = "AsuraScans Scraper"
    description = "Scrapes episode lists from Asura Scans (asurascanz.com)"
    
    inputs = [
        {"name": "manhwa_name", "label": "Manhwa Name", "type": "text", "required": True, "description": "Unique identifier for this series in the database"},
        {"name": "website_url", "label": "Series URL", "type": "text", "required": True, "description": "The URL of the series page (e.g. https://asurascanz.com/manga/...) "},
        {"name": "thumbnail_url", "label": "Thumbnail URL", "type": "text", "required": True, "default": "https://asura-scans.online/wp-content/uploads/2025/05/logo.webp"}
    ]

    def _fetch_soup(self, url: str) -> BeautifulSoup:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        return BeautifulSoup(resp.text, "html.parser")

    def _episode_exists(self, manhwa_name, episode_no):
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT 1 FROM scraped WHERE manhwa_name = ? AND episode_no = ?", (manhwa_name, episode_no))
        exists = cursor.fetchone() is not None
        conn.close()
        return exists

    def _record_episode(self, manhwa_name, episode_no):
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("INSERT OR IGNORE INTO scraped (manhwa_name, episode_no) VALUES (?, ?)", (manhwa_name, episode_no))
        conn.commit()
        conn.close()

    def scrape(self, **kwargs) -> list[dict]:
        url = kwargs.get("website_url") or self.website_url
        manhwa_name = kwargs.get("manhwa_name")
        
        if not url:
            raise ValueError("No Series URL provided.")
        if not manhwa_name:
            raise ValueError("No Manhwa Name provided.")

        soup = self._fetch_soup(url)
        
        # 1. overall container is this: <div class="eplister" id="chapterlist">
        container = soup.find("div", class_="eplister", id="chapterlist")
        if not container:
            container = soup # Fallback
            
        # 2. here is the list itself: <ul class="clstyle">
        ul = container.find("ul", class_="clstyle")
        if not ul:
             # Try finding ANY ul if the class is different
             ul = container.find("ul")
             if not ul:
                 raise RuntimeError("Could not find the episode list (ul.clstyle)")

        episodes = []
        # 3. individual list item: <li data-num="161">
        items = ul.find_all("li", recursive=False)
        
        for li in items:
            ep_no_raw = li.get("data-num")
            try:
                ep_no = int(ep_no_raw)
            except (TypeError, ValueError):
                continue

            # Check if already scraped
            if self._episode_exists(manhwa_name, ep_no):
                continue

            # <div class="eph-num"> <a href="..."> <span class="chapternum">Chapter 161</span> <span class="chapterdate">May 5, 2025</span> </a></div>
            a = li.find("a", href=True)
            if not a:
                continue
                
            link = a["href"]
            
            # Title
            title_span = a.find("span", class_="chapternum")
            title = title_span.get_text(strip=True) if title_span else f"Chapter {ep_no}"
                
            # Date
            date_span = a.find("span", class_="chapterdate")
            rel_date = date_span.get_text(strip=True) if date_span else ""

            episodes.append({
                "title": title,
                "release_date": rel_date,
                "website_url": link,
                "episode_number": ep_no,
                "thumbnail": kwargs['thumbnail_url']
            })
            
            # Record it
            self._record_episode(manhwa_name, ep_no)

        if not episodes:
            raise ScrapeSkip("No new episodes found.")
            
        return episodes

if __name__ == "__main__":
    import json
    # Replace with a real series URL to test
    test_url = "https://asurascans.com/comics/revenge-of-the-iron-blooded-sword-hound"
    thumbnail_url="https://cdn.asurascans.com/asura-images/covers/revenge-of-the-iron-blooded-sword-hound.41b6fb-400.webp"
    results = Scraper().scrape(website_url=test_url, manhwa_name="Revenge of the Iron-Blooded Sword Hound", thumbnail_url = thumbnail_url)
    print(json.dumps(results, indent=2))

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

# Initialize shared table (same as erascans)
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
    name = "Webtoons Scraper"
    description = "Scrapes episode lists from Webtoons.com"
    
    inputs = [
        {"name": "manhwa_name", "label": "Manhwa Name", "type": "text", "required": True, "description": "A unique ID for this series (e.g. title_no or name)"},
        {"name": "website_url", "label": "Series URL", "type": "text", "required": True, "description": "The URL of the Webtoons series page"}
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
        
        # 1. all the elements should be within: <div class="detail_lst">
        detail_lst = soup.find("div", class_="detail_lst")
        if not detail_lst:
            # Fallback to general soup if detail_lst is missing
            detail_lst = soup
            
        # 2. the list element is this: <ul id="_listUl">
        ul = detail_lst.find("ul", id="_listUl")
        if not ul:
             raise RuntimeError("Could not find the episode list (ul#_listUl)")

        episodes = []
        # 3. the element itself is this: <li class="_episodeItem" ...>
        items = ul.find_all("li", class_="_episodeItem")
        
        for li in items:
            # data-episode-no="212"
            ep_no_raw = li.get("data-episode-no")
            try:
                ep_no = int(ep_no_raw)
            except (TypeError, ValueError):
                continue

            # Check if already scraped
            if self._episode_exists(manhwa_name, ep_no):
                continue

            # Extract details
            a = li.find("a", href=True)
            if not a:
                continue
                
            link = a["href"]
            if link.startswith("/"):
                link = "https://www.webtoons.com" + link
            
            # <span class="thmb"><img src="..." ...></span>
            thumb_span = a.find("span", class_="thmb")
            thumb = ""
            if thumb_span:
                img = thumb_span.find("img")
                if img:
                    thumb = img.get("src") or img.get("data-src") or ""

            # <span class="subj"><span>(S2) Ep. 212 ...</span></span>
            subj_span = a.find("span", class_="subj")
            title = ""
            if subj_span:
                title_inner = subj_span.find("span")
                title = title_inner.get_text(strip=True) if title_inner else subj_span.get_text(strip=True)

            # <span class="date">Mar 22, 2026</span>
            date_span = a.find("span", class_="date")
            rel_date = date_span.get_text(strip=True) if date_span else ""

            episodes.append({
                "title": title or f"Episode {ep_no}",
                "release_date": rel_date,
                "website_url": link,
                "episode_number": ep_no,
                "thumbnail": thumb
            })
            
            # Record it
            self._record_episode(manhwa_name, ep_no)

        if not episodes:
            raise ScrapeSkip("No new episodes found.")
            
        return episodes


# if __name__ == "__main__":
#     # Test call
#     results = Scraper().scrape(
#         website_url="https://www.webtoons.com/en/fantasy/the-lone-necromancer/list?title_no=3690",
#         manhwa_name="The Lone Necromancer"
#     )
#     import json
#     print(json.dumps(results, indent=2))
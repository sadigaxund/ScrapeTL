"""
Scraper for "Revenge of the Iron-Blooded Sword Hound".

The homepage URL is passed in at runtime from the registered homepage_url
stored in the scraper registry - no hardcoding needed.

Resilience strategy (tried in order):
  1. Look for div with both class "bixbox" + "epcheck" (or similar), then find
     the chapter <ul> inside it by id="chapterlist" or class="eplister".
  2. Fallback: find any <ul> whose <li> elements carry a `data-num` attribute.
  3. Fallback: scan ALL <li data-num> elements on the page directly.

Within each <li>:
  - Find the first <a href> → chapter URL
  - Find span containing 'chapter' in its class or text → title
  - Find span containing 'date' in its class → release date
  - Optionally find an <img> for an episode thumbnail
"""
import re
import requests
from bs4 import BeautifulSoup, Tag
from scrapetl import BaseScraper
from scrapetl import ScrapeSkip

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/123.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
}

import os
import sqlite3

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
    # website_url = "https://erascans.com/manga/revenge-of-the-iron-blooded-sword-hound/"
    # manhwa_name = "Revenge of the Iron-Blooded Sword Hound"
    
    inputs = [
        {"name": "manhwa_name", "label": "Manhwa Name", "type": "text", "required": True,  "default": "Revenge of the Iron-Blooded Sword Hound"},
        {"name": "website_url", "label": "Website URL", "type": "text", "required": True, "default": "https://erascans.com/manga/revenge-of-the-iron-blooded-sword-hound/"},
        {"name": "website_url2", "label": "Website URL", "type": "text", "required": True, "default": "https://erascans.com/manga/revenge-of-the-iron-blooded-sword-hound/"},
        {"name": "website_url3", "label": "Website URL", "type": "text", "required": True, "default": "https://erascans.com/manga/revenge-of-the-iron-blooded-sword-hound/"},
        {"name": "website_url4", "label": "Website URL", "type": "text", "required": True, "default": "https://erascans.com/manga/revenge-of-the-iron-blooded-sword-hound/"},
        {"name": "website_url5", "label": "Website URL", "type": "text", "required": True, "default": "https://erascans.com/manga/revenge-of-the-iron-blooded-sword-hound/"},
        {"name": "website_url6", "label": "Website URL", "type": "text", "required": True, "default": "https://erascans.com/manga/revenge-of-the-iron-blooded-sword-hound/"},
        {"name": "website_url7", "label": "Website URL", "type": "text", "required": True, "default": "https://erascans.com/manga/revenge-of-the-iron-blooded-sword-hound/"},
        {"name": "website_url8", "label": "Website URL", "type": "text", "required": True, "default": "https://erascans.com/manga/revenge-of-the-iron-blooded-sword-hound/"},
        {"name": "thumbnail_url", "label": "Thumbnail URL", "type": "text", "required": True, "default": "https://erascans.com/wp-content/uploads/2026/02/Revenge-of-the-Iron-Blooded-Sword-Hound.webp"}
    ]

    
    # ── helpers ───────────────────────────────────────────────────────────────
    

    def _fetch_soup(self, website_url) -> BeautifulSoup:
        resp = requests.get(website_url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        return BeautifulSoup(resp.text, "html.parser")

    def _find_chapter_ul(self, soup: BeautifulSoup) -> Tag | None:
        """
        Multi-strategy search for the <ul> that holds chapter <li> items.
        """
        # Strategy 1: look for the outer container by class hints
        container = None
        for div in soup.find_all("div"):
            classes = " ".join(div.get("class", []))
            if "epcheck" in classes or "bxcl" in classes:
                container = div
                break

        search_root = container if container else soup

        # Within container (or whole page): id="chapterlist"
        ul = search_root.find("ul", id=re.compile(r"chapter", re.I))
        if ul:
            return ul

        # class hint "eplister"
        wrapper = search_root.find(class_=re.compile(r"eplister|episode.*list|chapter.*list", re.I))
        if wrapper:
            ul = wrapper.find("ul") if wrapper.name != "ul" else wrapper
            if ul:
                return ul

        # Strategy 2: any <ul> whose first <li> has data-num
        for ul in soup.find_all("ul"):
            first_li = ul.find("li")
            if first_li and first_li.has_attr("data-num"):
                return ul

        return None

    def _parse_li(self, thumbnail_url, li: Tag) -> dict | None:
        """Extract chapter data from a single <li> element."""
        # Chapter URL - first <a> with href
        a = li.find("a", href=True)
        if not a:
            return None
        url = a["href"].strip()

        # Title - prefer a span whose class contains "chapter" or "num"
        title_span = a.find("span", class_=re.compile(r"chapter|num", re.I))
        if not title_span:
            # Fallback: any span that looks like "Chapter NNN"
            for span in a.find_all("span"):
                if re.search(r"chapter\s*\d+", span.get_text(), re.I):
                    title_span = span
                    break
        title = title_span.get_text(strip=True) if title_span else a.get_text(strip=True)

        # Release date - span whose class contains "date"
        date_span = a.find("span", class_=re.compile(r"date|time", re.I))
        if not date_span:
            date_span = li.find("span", class_=re.compile(r"date|time", re.I))
        release_date = date_span.get_text(strip=True) if date_span else ""

        # Episode number from data-num attribute
        episode_number = li.get("data-num") or ""
        try:
            episode_number = int(episode_number)
        except (ValueError, TypeError):
            pass

        # Optional per-episode thumbnail
        img = li.find("img")

        return {
            "title": title,
            "release_date": release_date,
            "website_url": url,
            "episode_number": episode_number,
            "thumbnail": thumbnail_url,
        }

    def episode_insert(self, manhwa_name, episode):
        conn = get_db()
        cursor = conn.cursor()

        cursor.execute("""
            INSERT OR IGNORE INTO scraped (manhwa_name, episode_no)
            VALUES (?, ?)
        """, (manhwa_name, episode))

        conn.commit()
        conn.close()
    
    def episode_exists(self, manhwa_name, episode):
        conn = get_db()
        cursor = conn.cursor()

        cursor.execute("""
            SELECT 1 FROM scraped
            WHERE manhwa_name = ? AND episode_no = ?
            LIMIT 1
        """, (manhwa_name, episode))

        result = cursor.fetchone()
        conn.close()

        return result is not None

    # ── public API ────────────────────────────────────────────────────────────

    def scrape(self, **kwargs) -> list[dict]:
        website_url = kwargs['website_url']
        manhwa_name = kwargs['manhwa_name']


        if not website_url:
            raise ValueError(
                "No homepage URL configured. Set one in the scraper registry."
            )

        soup = self._fetch_soup(website_url)
        ul = self._find_chapter_ul(soup)

        if ul is None:
            raise RuntimeError(
                "Could not locate the chapter list on the page. "
                "The site layout may have changed significantly."
            )

        episodes = []
        for li in ul.find_all("li", recursive=False):
            parsed = self._parse_li(kwargs['thumbnail_url'], li)
            if parsed:
                episodes.append(parsed)

        if not episodes:
            raise RuntimeError("Chapter list found but no episodes could be parsed.")

        episodes.sort(key=lambda e: e.get("episode_number") or 0)

        retval = []

        for episode in episodes:
            if not self.episode_exists(manhwa_name, episode['episode_number']):  
                self.episode_insert(manhwa_name, episode['episode_number'])
                retval.append(episode)

        if len(retval) == 0:
            raise ScrapeSkip(f"No new episodes.")
        else:
            return retval
"""
Scraper for "Revenge of the Iron-Blooded Sword Hound".

The homepage URL is passed in at runtime from the registered homepage_url
stored in the scraper registry — no hardcoding needed.

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
from app.scrapers.base import BaseScraper
from app.exceptions import ScrapeSkip
import time

class Scraper(BaseScraper):
    def scrape(self, **kwargs) -> list[dict]:
        
        raise Exception("Manual Error")
        time.sleep(5)
        return [{
            "Hello": "World"
        }]

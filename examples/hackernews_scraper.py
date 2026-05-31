"""
Python Scraper — subclass of BaseScraper, for logic too complex for the visual Builder.

Usage:
  1. Open ScrapeTL → New Scraper → select "Python" type.
  2. Paste this code into the code editor (or the full class you write).
  3. The `inputs` list drives the run form and schedule configuration.
  4. `scrape(**kwargs)` must return a list of dicts.

BaseScraper provides:
  - self.homepage_url  — set when scraper is created
  - kwargs["vars"]     — all Context Registry variables
  - kwargs["db"]       — SQLAlchemy session (advanced use)
"""

from typing import List
from scrapetl.scrapers.base import BaseScraper


class HackerNewsScraper(BaseScraper):
    """Scrapes the front page of Hacker News for top stories."""

    inputs = [
        {
            "name": "max_results",
            "label": "Max Results",
            "type": "number",
            "default": 10,
        },
        {
            "name": "min_score",
            "label": "Minimum Score",
            "type": "number",
            "default": 100,
        },
        {
            "name": "include_comments_url",
            "label": "Include Comments URL",
            "type": "boolean",
            "default": True,
        },
    ]

    def scrape(
        self,
        max_results: int = 10,
        min_score: int = 100,
        include_comments_url: bool = True,
        **kwargs,
    ) -> List[dict]:
        import requests
        from bs4 import BeautifulSoup

        resp = requests.get("https://news.ycombinator.com/", timeout=15)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")

        results = []
        rows = soup.select("tr.athing")

        for row in rows:
            if len(results) >= int(max_results):
                break

            title_el = row.select_one(".titleline > a")
            if not title_el:
                continue

            # Score is in the next sibling row
            subtext = row.find_next_sibling("tr")
            score_el = subtext.select_one(".score") if subtext else None
            score = int(score_el.text.split()[0]) if score_el else 0

            if score < int(min_score):
                continue

            item = {
                "title": title_el.text.strip(),
                "url": title_el.get("href", ""),
                "score": score,
            }

            if include_comments_url:
                item["comments_url"] = f"https://news.ycombinator.com/item?id={row.get('id', '')}"

            results.append(item)

        return results

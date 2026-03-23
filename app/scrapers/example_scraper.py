"""
Example Scraper — Demo implementation.

This scraper simulates scraping an anime episode list.
Replace the body of scrape_episodes_list() with real HTTP scraping logic.
"""
from app.scrapers.base import BaseScraper


class ExampleScraper(BaseScraper):
    name = "Example Anime Scraper"
    website_url = "https://example-anime-site.com"
    description = "Demo scraper — returns mock episode data. Replace with real scraping logic."

    def scrape(self):
        # ------------------------------------------------------------------ #
        # REAL SCRAPER EXAMPLE (commented out):
        #
        # import requests
        # from bs4 import BeautifulSoup
        #
        # resp = requests.get(self.website_url, timeout=10)
        # resp.raise_for_status()
        # soup = BeautifulSoup(resp.text, "html.parser")
        # episodes = []
        # for row in soup.select(".episode-list .episode"):
        #     episodes.append({
        #         "title": row.select_one(".title").text.strip(),
        #         "release_date": row.select_one(".date").text.strip(),
        #         "website_url": self.website_url + row.select_one("a")["href"],
        #     })
        # return episodes
        # ------------------------------------------------------------------ #

        # Mock data for demo purposes
        from datetime import datetime, timedelta
        today = datetime.utcnow()
        return [
           {
            "title": "One Piece",
            "episode_number": "1098",
            "release_date": "2024-03-23",
            "website_url": "https://example.com/one-piece-1098",
            "thumbnail": "https://example.com/one-piece-1098.jpg"
           },
           {
            "title": "One Piece",
            "episode_number": "1098",
            "release_date": "2024-03-23",
            "website_url": "https://example.com/one-piece-1098",
            "thumbnail": "https://example.com/one-piece-1098.jpg"
           },
           {
            "title": "One Piece",
            "episode_number": "1098",
            "release_date": "2024-03-23",
            "website_url": "https://example.com/one-piece-1098",
            "thumbnail": "https://example.com/one-piece-1098.jpg"
           }
        ]

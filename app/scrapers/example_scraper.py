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

    def scrape_episodes_list(self):
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
                "title": f"Episode {i} — The Journey Begins Part {i}",
                "release_date": (today - timedelta(weeks=12 - i)).strftime("%Y-%m-%d"),
                "website_url": f"{self.website_url}/episodes/{i}",
                "episode_number": i,
            }
            for i in range(1, 13)
        ]

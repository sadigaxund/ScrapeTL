from typing import List, Optional


class BaseScraper:
    """
    Base class for all anime scrapers.

    To implement a new scraper:
    1. Create a new file in app/scrapers/
    2. Subclass BaseScraper
    3. Set `name` and `website_url`
    4. Implement `scrape_episodes_list()`
    5. Register the scraper via the UI or API using the module path
       e.g. "app.scrapers.my_scraper"
    """

    name: str = "Base Scraper"
    website_url: str = ""
    description: str = ""

    def __init__(self, homepage_url: Optional[str] = None):
        """
        Args:
            homepage_url: The homepage URL stored in the registry for this scraper.
                          Use this as the primary URL to scrape. Falls back to
                          the class-level `website_url` if not provided.
        """
        if homepage_url:
            self.website_url = homepage_url

    def scrape_episodes_list(self) -> List[dict]:
        """
        Return a list of episode dictionaries, newest first.

        Each dict must contain:
            - title (str): Episode/chapter title
            - release_date (str): Release date string, e.g. "March 8, 2026"
            - website_url (str): Direct URL to the episode/chapter page

        Optional keys:
            - episode_number (str/int)
            - thumbnail (str): URL or local path to an episode thumbnail
            - description (str)
        """
        raise NotImplementedError(
            f"{self.__class__.__name__} must implement scrape_episodes_list()"
        )

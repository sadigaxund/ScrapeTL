from typing import List, Optional
from scrapetl.exceptions import ScrapeSkip  # re-exported for scraper convenience

__all__ = ["BaseScraper", "ScrapeSkip"]



class BaseScraper:
    """
    Base class for all anime scrapers.

    To implement a new scraper:
    1. Create a new file in app/scrapers/
    2. Subclass BaseScraper
    3. Set `name` and `website_url`
    4. Optionally define `inputs` to declare runtime parameters
    5. Implement `scrape(**kwargs)` accepting the declared inputs
    6. Register the scraper via the UI or API using the module path
       e.g. "scrapetl.scrapers.my_scraper"

    --- Input Parameters ---
    Override `inputs` with a list of parameter descriptor dicts. Each dict:
      {
        "name": "chapter",          # str - kwarg name passed to scrape()
        "label": "Start Chapter",   # str - label shown in the UI
        "type": "number",           # "text" | "number" | "select" | "boolean" | "list" | "generator"
        "default": 1,               # default value (any JSON-serialisable type)
        "options": [1, 2, 3],       # list of allowed values (only for "select")
        "required": False,          # bool - if True, form enforces a value
      }

    Example:
        inputs = [
            {"name": "start_chapter", "label": "Start Chapter", "type": "number", "default": 1},
            {"name": "lang", "label": "Language", "type": "select",
             "options": ["en", "jp"], "default": "en"},
        ]

        def scrape(self, start_chapter=1, lang="en") -> List[dict]:
            ...
    """

    name: str = "Base Scraper"
    website_url: str = ""
    description: str = ""

    # Declare runtime input parameters (see class docstring for schema).
    inputs: list = []

    def __init__(self, homepage_url: Optional[str] = None):
        """
        Args:
            homepage_url: The homepage URL stored in the registry for this scraper.
                          Use this as the primary URL to scrape. Falls back to
                          the class-level `website_url` if not provided.
        """
        if homepage_url:
            self.website_url = homepage_url

    def scrape(self, **kwargs) -> List[dict]:
        """
        Return a list of episode dictionaries, newest first.

        If `inputs` is declared, the collected values are passed as **kwargs.

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
            f"{self.__class__.__name__} must implement scrape()"
        )

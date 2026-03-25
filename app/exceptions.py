"""
app/exceptions.py
═══════════════════════════════════════════════════════════════════
Public exception classes intended to be raised from scraper code.
═══════════════════════════════════════════════════════════════════

Usage inside a scraper:
    from app.exceptions import ScrapeSkip

    class MyScraper(BaseScraper):
        def scrape(self):
            if nothing_new:
                raise ScrapeSkip("No new episodes today.")
            return results
"""


class ScrapeSkip(Exception):
    """
    Raise this from your scraper's `scrape()` method to signal that the
    run completed successfully but there is nothing to dispatch to
    integrations.

    - The log entry is recorded with status "skipped".
    - No integrations are fired.
    - No retries are attempted.
    - The scraper health is set to "ok".

    The optional message is stored in the log's error_msg field so it's
    visible in the UI under the run entry.
    """

import re
import requests
from playwright.sync_api import sync_playwright
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
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
}

class Scraper(BaseScraper):
    name = "Booking.com Scraper"
    description = "Extracts hotel details from Booking.com pages"
    
    inputs = [
        {"name": "website_url", "label": "Hotel URL", "type": "text", "required": True, "description": "The URL of the Booking.com hotel page"},
    ]

    def _fetch_soup(self, url: str, headless: bool = True, browser_type: str = "chromium") -> BeautifulSoup:
        # Use Playwright to bypass bot protection
        with sync_playwright() as p:
            # Select engine: chromium, firefox, or webkit
            try:
                engine = getattr(p, browser_type)
            except AttributeError:
                print(f"Warning: Browser type '{browser_type}' not found, falling back to chromium.")
                engine = p.chromium

            browser = engine.launch(headless=headless)
            # Standard viewport to look like a real browser
            context = browser.new_context(
                viewport={'width': 1920, 'height': 1080},
                user_agent=HEADERS["User-Agent"]
            )
            page = context.new_page()
            
            # Navigate with a longer timeout
            try:
                # Use 'domcontentloaded' as it's faster and less likely to time out 
                # while waiting for every single tracking pixel to load (networkidle)
                page.goto(url, timeout=60000, wait_until="domcontentloaded")
            except Exception as e:
                print(f"Navigation warning: {e}")
            
            # Wait for the main container or some rendered content
            try:
                page.wait_for_selector("#wrap-hotelpage-top, h2", timeout=15000)
            except:
                pass 
                
            content = page.content()
            if not headless:
                # Give the user a moment to see the browser before closing if in debug mode
                import time
                time.sleep(5)
            browser.close()
            return BeautifulSoup(content, "html.parser")

    def _parse_hidden_inputs(self, soup: BeautifulSoup) -> dict:
        """Extract metadata from hidden form inputs."""
        data = {}
        form = soup.find("form", id="top-book")
        if not form:
            return data

        # Common hidden field names
        fields = ["aid", "hotel_id", "label", "sid", "hostname"]
        for field in fields:
            inp = form.find("input", {"name": field})
            if inp:
                data[f"meta_{field}"] = inp.get("value")
        
        return data

    def _parse_header(self, soup: BeautifulSoup) -> dict:
        """Extract hotel name, address, and ratings from the header container."""
        data = {}
        header = soup.find("div", id="wrap-hotelpage-top")
        if not header:
            # Fallback to broader soup if specific container ID is missing
            header = soup

        # 1. Hotel Name
        name_container = header.find(id="hp_hotel_name")
        if not name_container:
            name_container = header.find("div", id="hp_hotel_name")

        if name_container:
            name_el = name_container.find(["h2", "span"], class_=re.compile(r"title|name", re.I))
            data["hotel_name"] = name_el.get_text(strip=True) if name_el else name_container.get_text(strip=True)
        else:
            # Alternative: Search for pp-header__title directly
            name_el = header.find(class_=re.compile(r"pp-header__title|HP_HOTEL_NAME", re.I))
            if name_el:
                data["hotel_name"] = name_el.get_text(strip=True)
            else:
                # Last resort: find any H1 or H2 that might be the name
                for h in header.find_all(["h1", "h2"]):
                    text = h.get_text(strip=True)
                    if text and not any(x in text.lower() for x in ["reserve", "search", "filter"]):
                        data["hotel_name"] = text
                        break

        # 2. Address & Location
        # Use data-testid if available for high resilience
        addr_container = header.find(attrs={"data-testid": "PropertyHeaderAddressDesktop-wrapper"})
        if addr_container:
            # Look for the address text (usually inside a button or div with specific class patterns)
            addr_btn = addr_container.find("button")
            if addr_btn:
                # The address is often the main text in this button
                data["address"] = addr_btn.get_text(strip=True)
                
                # Extract specific rating if present (e.g., "Excellent location - rated 9.9/10!")
                rating_match = re.search(r"rated\s*([\d\./]+)", addr_btn.get_text())
                if rating_match:
                    data["location_rating"] = rating_match.group(1)

        # 3. Review Count
        # Search for pattern "(score from X reviews)"
        review_text = header.get_text()
        count_match = re.search(r"score\s*from\s*(\d+)\s*reviews", review_text)
        if count_match:
            data["review_count"] = count_match.group(1)

        # 4. Subway/Metro Access
        metro_match = re.search(r"(\d+\s*m\s*walking\s*from\s*.* station)", review_text, re.I)
        if metro_match:
            data["subway_access"] = metro_match.group(1)

        return data

    def scrape(self, **kwargs) -> list[dict]:
        url = kwargs.get("website_url") or self.website_url
        headless = kwargs.get("headless", True)
        browser_type = kwargs.get("browser_type", "chromium")
        
        if not url:
            raise ValueError("No Hotel URL provided.")

        # In case the user passed the URL with extra fragments, clean it
        if "booking.com" not in url:
             raise ValueError("Invalid Booking.com URL.")

        soup = self._fetch_soup(url, headless=headless, browser_type=browser_type)
        
        hotel_data = {
            "source_url": url,
            "scrape_timestamp": None, # Will be filled by runner
        }

        # Separated logic parts
        hotel_data.update(self._parse_header(soup))
        hotel_data.update(self._parse_hidden_inputs(soup))

        if not hotel_data.get("hotel_name"):
             # Debugging: print a bit of the soup to see what we got
             print(f"DEBUG: Found keys in hotel_data: {list(hotel_data.keys())}")
             raise ScrapeSkip("Failed to extract minimal hotel information (Name).")
             
        return [hotel_data]

if __name__ == "__main__":
    # Standalone Test
    import json
    test_url = "https://www.booking.com/hotel/az/nizami-deluxe-apartments-by-bahtiyar.html"
    try:
        # Try Firefox if Chromium fails
        # To use Firefox, you MUST run: playwright install firefox
        print("Testing with browser_type='chromium'...")
        results = Scraper().scrape(website_url=test_url, headless=False, browser_type="chromium")
        print(json.dumps(results, indent=2))
    except Exception as e:
        print(f"Chromium test failed: {e}")
        print("\nRetrying with browser_type='firefox' (requires: playwright install firefox)...")
        try:
             results = Scraper().scrape(website_url=test_url, headless=True, browser_type="firefox")
             print(json.dumps(results, indent=2))
        except Exception as e2:
             print(f"Firefox test also failed: {e2}")
    print("Booking.com Scraper Test Finished.")

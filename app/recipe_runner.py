"""
Recipe Runner — executes a JSON-defined step recipe using Playwright.
This is the low-code counterpart to the Python BaseScraper path.

Recipe format:
{
  "steps": [
    { "type": "navigate", "url": "https://..." },
    { "type": "wait_for_selector", "selector": ".content", "timeout_ms": 5000 },
    { "type": "scroll_to_bottom", "times": 3, "delay_ms": 800 },
    { "type": "click", "selector": ".load-more" },
    { "type": "extract", "selector": ".episode-item", "fields": [
        { "key": "title",       "source": "text" },
        { "key": "website_url", "source": "attr", "attr": "href" },
        { "key": "release_date","source": "attr", "attr": "data-date" }
    ]}
  ]
}
"""
import json
import time
from typing import Any


def run_recipe(recipe_json: str, homepage_url: str = None) -> list[dict]:
    """
    Execute a recipe and return a list of episode dicts compatible with BaseScraper.scrape().
    Raises on any critical failure.
    """
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        raise RuntimeError(
            "Playwright is not installed. Run: pip install playwright && playwright install chromium"
        )

    recipe: dict = json.loads(recipe_json)
    steps: list[dict] = recipe.get("steps", [])
    if not steps:
        raise ValueError("Recipe has no steps defined.")

    results: list[dict] = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/122.0.0.0 Safari/537.36"
            )
        )
        page = context.new_page()

        for i, step in enumerate(steps):
            step_type = step.get("type", "").lower()
            print(f"[RecipeRunner] Step {i + 1}/{len(steps)}: {step_type}")

            if step_type == "navigate":
                url = step.get("url") or homepage_url
                if not url:
                    raise ValueError(f"Step {i + 1} 'navigate' missing 'url'.")
                page.goto(url, wait_until="domcontentloaded", timeout=30_000)

            elif step_type == "wait_for_selector":
                sel = step.get("selector")
                if not sel:
                    raise ValueError(f"Step {i + 1} 'wait_for_selector' missing 'selector'.")
                timeout = int(step.get("timeout_ms", 10_000))
                page.wait_for_selector(sel, timeout=timeout)

            elif step_type == "scroll_to_bottom":
                times = int(step.get("times", 1))
                delay_ms = int(step.get("delay_ms", 600))
                for _ in range(times):
                    page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                    time.sleep(delay_ms / 1000)

            elif step_type == "click":
                sel = step.get("selector")
                if not sel:
                    raise ValueError(f"Step {i + 1} 'click' missing 'selector'.")
                try:
                    page.click(sel, timeout=int(step.get("timeout_ms", 5_000)))
                except Exception as e:
                    print(f"[RecipeRunner] ⚠️ Click on '{sel}' failed (non-fatal): {e}")

            elif step_type == "extract":
                sel = step.get("selector")
                fields: list[dict] = step.get("fields", [])
                if not sel:
                    raise ValueError(f"Step {i + 1} 'extract' missing 'selector'.")
                if not fields:
                    raise ValueError(f"Step {i + 1} 'extract' has no 'fields' defined.")

                elements = page.query_selector_all(sel)
                for el in elements:
                    row: dict[str, Any] = {}
                    for field in fields:
                        key = field.get("key", "value")
                        source = field.get("source", "text")
                        try:
                            if source == "text":
                                val = (el.inner_text() or "").strip()
                            elif source == "attr":
                                attr_name = field.get("attr", "href")
                                val = el.get_attribute(attr_name) or ""
                            elif source == "html":
                                val = el.inner_html() or ""
                            else:
                                val = ""
                        except Exception:
                            val = ""
                        row[key] = val
                    if any(v for v in row.values()):  # skip fully empty rows
                        results.append(row)

            else:
                print(f"[RecipeRunner] ⚠️ Unknown step type '{step_type}', skipping.")

        browser.close()

    return results

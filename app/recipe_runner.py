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


def run_recipe(recipe_json: str, homepage_url: str | None = None) -> list[dict]:
    """
    Execute a low-code recipe using Playwright.
    Collects HTML components and optionally runs a python post_process function to clean them.
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
    post_process_code: str = recipe.get("post_process", "").strip()

    if not steps:
        raise ValueError("Recipe has no steps defined.")

    components: list[str] = []

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
            # new UI saves it as "action", fallback to "type" for old recipes
            action = (step.get("action") or step.get("type") or "").lower()
            print(f"[RecipeRunner] Step {i + 1}/{len(steps)}: {action}")

            if action == "navigate":
                url = step.get("url") or homepage_url
                if not url:
                    raise ValueError(f"Step {i + 1} 'navigate' missing 'url'.")
                page.goto(url, wait_until="domcontentloaded", timeout=30_000)

            elif action == "wait" or action == "wait_for_selector":
                sel = step.get("selector")
                if not sel:
                    raise ValueError(f"Step {i + 1} '{action}' missing 'selector'.")
                timeout = int(step.get("timeout_ms", 10_000))
                page.wait_for_selector(sel, timeout=timeout)

            elif action == "wait_time":
                sec = float(step.get("seconds", 2))
                time.sleep(sec)

            elif action == "scroll" or action == "scroll_to_bottom":
                times = int(step.get("times", 1))
                delay_ms = int(step.get("delay_ms", 600))
                for _ in range(times):
                    page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                    time.sleep(delay_ms / 1000)

            elif action == "click":
                sel = step.get("selector")
                if not sel:
                    raise ValueError(f"Step {i + 1} 'click' missing 'selector'.")
                try:
                    page.click(sel, timeout=int(step.get("timeout_ms", 5_000)))
                except Exception as e:
                    print(f"[RecipeRunner] ⚠️ Click on '{sel}' failed (non-fatal): {e}")

            elif action == "collect_elements":
                sel = step.get("selector")
                attr = step.get("attribute", "outerHTML")
                if not sel:
                    raise ValueError(f"Step {i + 1} 'collect_elements' missing 'selector'.")

                elements = page.query_selector_all(sel)
                for el in elements:
                    try:
                        if attr == "outerHTML":
                            val = el.evaluate("node => node.outerHTML")
                        elif attr == "innerHTML":
                            val = el.inner_html()
                        else:
                            val = el.inner_text()
                        
                        if val and str(val).strip():
                            components.append(str(val).strip())
                    except Exception as e:
                        print(f"[RecipeRunner] Failed to collect element: {e}")

            else:
                print(f"[RecipeRunner] ⚠️ Unknown step action '{action}', skipping.")

        browser.close()

    # Apply Python Post-Processing if provided
    results = []
    if post_process_code:
        print("[RecipeRunner] Executing Python Post-Processor...")
        import re
        from bs4 import BeautifulSoup
        
        local_env: dict[str, Any] = {"components": components, "results": []}
        global_env: dict[str, Any] = {"re": re, "BeautifulSoup": BeautifulSoup}
        
        try:
            exec(post_process_code, global_env, local_env)
            # The user might define def process(components): returning a list
            if "process" in local_env:
                results = local_env["process"](components)
            elif "process" in global_env:
                results = global_env["process"](components)
            else:
                raise ValueError("post_process code must define a 'process(components)' function.")
        except Exception as e:
            raise RuntimeError(f"Post-processing failed: {e}")
    else:
        # If no script, wrap components as generic objects so UI and integrations don't break
        results = [{"extracted_data": c} for c in components]

    # Ensure results is always a list of dicts
    if not isinstance(results, list):
        results = [{"output": str(results)}]
    
    return [r if isinstance(r, dict) else {"extracted_data": r} for r in results]

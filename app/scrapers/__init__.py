"""
Scraper plugin loader.

Discovers and loads scraper classes from this package.
Each scraper module should contain exactly one BaseScraper subclass.
"""
import importlib
import inspect
import os
from typing import Dict, Type
from app.scrapers.base import BaseScraper


def load_scraper_class(module_path: str) -> Type[BaseScraper]:
    """
    Dynamically import and return a BaseScraper subclass from a dotted module path.

    The module_path can be:
      - A module containing a single BaseScraper subclass (auto-detected)
        e.g.  "app.scrapers.example_scraper"
      - A fully qualified class path
        e.g.  "app.scrapers.example_scraper.ExampleScraper"
    """
    # Try treating the last segment as a class name first
    parts = module_path.rsplit(".", 1)
    if len(parts) == 2:
        try:
            mod = importlib.import_module(parts[0])
            cls = getattr(mod, parts[1], None)
            if cls and inspect.isclass(cls) and issubclass(cls, BaseScraper) and cls is not BaseScraper:
                return cls
        except (ModuleNotFoundError, AttributeError):
            pass

    # Otherwise, import the whole module and find the first valid subclass
    mod = importlib.import_module(module_path)
    for _, obj in inspect.getmembers(mod, inspect.isclass):
        if issubclass(obj, BaseScraper) and obj is not BaseScraper:
            return obj

    raise ValueError(f"No BaseScraper subclass found in '{module_path}'")


def list_available_scraper_modules() -> Dict[str, str]:
    """
    Scan the scrapers/ directory and return a mapping of
    {module_path: scraper_name} for all valid scraper modules.
    """
    scrapers_dir = os.path.dirname(__file__)
    result = {}
    for fname in os.listdir(scrapers_dir):
        if fname.startswith("_") or not fname.endswith(".py") or fname == "base.py":
            continue
        module_path = f"app.scrapers.{fname[:-3]}"
        try:
            cls = load_scraper_class(module_path)
            result[module_path] = cls.name
        except Exception:
            pass
    return result

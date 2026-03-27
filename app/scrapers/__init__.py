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


def load_scraper_class_from_code(code: str) -> Type[BaseScraper]:
    """
    Dynamically compile and execute the given scraper code string,
    then return the underlying BaseScraper subclass.
    """
    # Seed the namespace with the canonical BaseScraper so that
    # `from app.scrapers.base import BaseScraper` inside the code
    # resolves to the same object used in the issubclass() check below.
    namespace = {
        "BaseScraper": BaseScraper,
    }
    exec(compile(code, "<scraper_code>", "exec"), namespace)
    for _, obj in namespace.items():
        if not inspect.isclass(obj) or obj is BaseScraper:
            continue
        # Primary check: real subclass relationship
        if issubclass(obj, BaseScraper):
            return obj
        # Fallback: check by class name in MRO (handles the case where
        # the code re-imported BaseScraper producing a parallel object)
        if any(c.__name__ == "BaseScraper" for c in obj.__mro__):
            return obj
    raise ValueError("No BaseScraper subclass found in the provided code.")


def list_available_scraper_modules() -> Dict[str, str]:
    """
    Scan the scrapers/ directory and subdirectories for valid scraper modules.
    Returns a mapping of {module_path: scraper_name}.
    """
    scrapers_dir = os.path.dirname(__file__)
    result = {}
    
    for root, _, files in os.walk(scrapers_dir):
        # Skip __pycache__ and hidden dirs
        if "__pycache__" in root or any(p.startswith(".") for p in root.split(os.sep)):
            continue
            
        for fname in files:
            if fname.startswith("_") or not fname.endswith(".py") or fname == "base.py":
                continue
            
            # Calculate the dotted module path relative to app.scrapers
            rel_path = os.path.relpath(os.path.join(root, fname), scrapers_dir)
            module_parts = rel_path[:-3].replace(os.sep, ".")
            module_path = f"app.scrapers.{module_parts}"
            
            try:
                cls = load_scraper_class(module_path)
                result[module_path] = cls.name
            except Exception:
                pass
    return result

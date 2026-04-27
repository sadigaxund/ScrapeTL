"""
Generator UDF — yields multiple values, driving batch iteration in the Builder.

Usage in Builder:
  1. Import this file via Context Registry → Functions → Import
  2. Place an "Input Expression" node and use {{paginated_urls(base_url, start, end)}} syntax.
  3. Connect base_url, start, end from Parameter or registry variable nodes.
  4. All downstream nodes run once per yielded URL.

One function per file. To add more generators, create separate files
(e.g., udf_generator_dates.py) and import them individually.

Optional args (step, per_page) have defaults — the expression picker shows them in brackets.
"""

from scrapetl import generator


@generator
def paginated_urls(base_url: str, start: int, end: int, step: int = 1, per_page: int = 20):
    """Yield paginated URLs from start to end (exclusive)."""
    for page in range(int(start), int(end), int(step)):
        yield f"{base_url}?page={page}&per_page={per_page}"

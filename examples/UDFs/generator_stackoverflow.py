"""
Generator UDF — Batch URL producer for Stack Overflow tag pages.

Yields one URL per tag. Plug into a Parameter node as a Batch source:
    Context Registry → Batch variable → Parameter node default
    or pass directly: {{stackoverflow_urls(tags, tab)}}

Category: generator (auto-detected via @generator decorator AND yield)
"""

from scrapetl import generator


@generator
def stackoverflow_urls(tags=["apache-spark", "pyspark", "pandas"], tab="votes"):
    """
    Yields Stack Overflow question-list URLs for each tag.

    Args:
        tags  — list of SO tag slugs to iterate over
        tab   — sort tab: votes | newest | active | unanswered
    """
    base = "https://stackoverflow.com/questions/tagged"
    for tag in tags:
        yield f"{base}/{tag}?tab={tab}"


@generator
def paginated_urls(base_url="https://example.com/items", start=1, end=10):
    """
    Yields paginated URLs from start to end (inclusive).

    Args:
        base_url — root URL (no trailing slash)
        start    — first page number
        end      — last page number (inclusive)

    Usage: {{paginated_urls(base_url, 1, 5)}}
    """
    for page in range(int(start), int(end) + 1):
        yield f"{base_url}?page={page}"


@generator
def sitemap_pages(base_url, count=20):
    """
    Yields simple /page/N paths for sites with numeric pagination.

    Args:
        base_url — root, e.g. https://example.com
        count    — total pages to generate

    Usage: {{sitemap_pages(base_url, 5)}}
    """
    for i in range(1, int(count) + 1):
        yield f"{base_url}/page/{i}"

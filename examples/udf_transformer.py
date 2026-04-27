"""
Transformer UDF — returns a single transformed value.

Usage in Builder:
  1. Import this file via Context Registry → Functions → Import
  2. In any expression field, use {{clean_price(price_text)}} syntax.
  3. Or select it from the {{}} expression picker on any text config field.

One function per file. To add more transformers, create separate files
(e.g., udf_transformer_slug.py) and import them individually.
"""

from scrapetl import transformer


@transformer
def clean_price(text: str) -> float:
    """Strip currency symbols, commas, and whitespace, return float."""
    import re
    cleaned = re.sub(r"[^\d.]", "", str(text).strip())
    try:
        return float(cleaned)
    except ValueError:
        return 0.0

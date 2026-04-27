"""
Comparator UDF — returns bool, used in the "Custom Logic" node.

Usage in Builder:
  1. Import this file via Context Registry → Functions → Import
  2. In a "Custom Logic" node, select this function from the picker.
  3. The node's input ports become the function's argument names.
  4. Connect data nodes to those ports. True/False output ports route downstream flow.

One function per file. To add more comparators, create separate files
(e.g., udf_comparator_keyword.py) and import them individually.
"""

from scrapetl import comparator


@comparator
def is_in_price_range(price: float, min_price: float = 0.0, max_price: float = 9999.0) -> bool:
    """True if price is between min_price and max_price (inclusive)."""
    try:
        return min_price <= float(price) <= max_price
    except (TypeError, ValueError):
        return False

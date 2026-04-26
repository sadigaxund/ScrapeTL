"""
Comparator UDFs — return bool, used in the Custom Logic node.

Wire the output of any data node → Custom Logic node, set the function here.
True/False output ports then route to different branches.

Category: comparator (auto-detected via @comparator decorator AND -> bool return)
"""

from scrapetl import comparator


@comparator
def is_non_empty(value) -> bool:
    """
    True if value is not None, empty string, or whitespace.

    Usage: {{is_non_empty(data.title)}}
    """
    return bool(str(value).strip()) if value is not None else False


@comparator
def is_price_in_range(price, min_val=0.0, max_val=999.0) -> bool:
    """
    True if price is a valid number within [min_val, max_val].

    Args:
        price   — raw price value (string like "$12.99" or number)
        min_val — lower bound (inclusive)
        max_val — upper bound (inclusive)

    Usage: {{is_price_in_range(data.price, 5, 500)}}
    """
    import re
    try:
        cleaned = re.sub(r"[^\d.]", "", str(price))
        val = float(cleaned)
        return float(min_val) <= val <= float(max_val)
    except (ValueError, TypeError):
        return False


@comparator
def has_minimum_words(text, min_words=10) -> bool:
    """
    True if text contains at least min_words words.
    Useful for filtering stub/empty article bodies.

    Args:
        text      — body text to check
        min_words — minimum word count threshold

    Usage: {{has_minimum_words(data.body, 50)}}
    """
    if not text:
        return False
    return len(str(text).split()) >= int(min_words)


@comparator
def matches_pattern(text, pattern=r"\d+") -> bool:
    """
    True if text contains a match for the given regex pattern.

    Args:
        text    — input string
        pattern — regex pattern (default: contains at least one digit)

    Usage: {{matches_pattern(data.sku, r"^[A-Z]{2}-\\d{4}$")}}
    """
    import re
    try:
        return bool(re.search(pattern, str(text)))
    except re.error:
        return False

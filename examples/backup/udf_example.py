import re
from datetime import datetime

def format_price(value, currency="$"):
    """
    Cleaner price formatter for scrapers.
    Usage: {{format_price(data.price, "€")}}
    """
    if value is None:
        return "N/A"
    
    # Extract numbers only if it's a string like "$1,200.50"
    if isinstance(value, str):
        nums = re.findall(r"[\d\.]+", value.replace(',', ''))
        if nums:
            value = float(nums[0])
        else:
            return value
            
    return f"{currency}{value:,.2f}"

def slugify(text):
    """
    Converts 'Hello World!' to 'hello-world'
    Usage: {{slugify(data.title)}}
    """
    if not text: return ""
    text = text.lower().strip()
    text = re.sub(r'[^\w\s-]', '', text)
    text = re.sub(r'[\s_-]+', '-', text)
    text = re.sub(r'^-+|-+$', '', text)
    return text

def is_weekend():
    """
    Returns True if today is Saturday or Sunday.
    Usage: {{is_weekend()}}
    """
    return datetime.now().weekday() >= 5

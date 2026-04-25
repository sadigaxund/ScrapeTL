def is_valid_price(price: float) -> bool:
    price = float(price)
    return price > 0 and price <= 100.0
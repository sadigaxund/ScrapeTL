def sitemap_walker(url: str):
    for i in range(1, 11):
        yield f"{url}?page={i}"
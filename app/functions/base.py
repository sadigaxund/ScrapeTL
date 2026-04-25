"""
Explicit type-hint decorators for Context Registry UDFs.

These decorators override automatic category detection and are the
recommended way to declare UDF types.

Usage:
    from app.functions.base import generator, comparator, transformer

    @generator
    def stackoverflow_url_generator(tags=["apache-spark", "pyspark"], tab="votes"):
        for tag in tags:
            yield f"https://stackoverflow.com/questions/tagged/{tag}?tab={tab}"

    @comparator
    def is_valid_length(text: str, min_len: int = 3) -> bool:
        return len(text.strip()) >= min_len

    @transformer
    def clean_title(text: str) -> str:
        return text.strip().title()

Categories:
    generator   — yields items; used as a Batch data source in the builder
    comparator  — returns bool; used in the Custom Logic node
    transformer — returns a single value; default for most functions
"""


def generator(func):
    """Mark UDF as a generator (yields Batch items, used as input source)."""
    func._udf_category = 'generator'
    return func


def comparator(func):
    """Mark UDF as a comparator (returns bool, used in Custom Logic node)."""
    func._udf_category = 'comparator'
    return func


def transformer(func):
    """Mark UDF as a transformer (returns a single transformed value)."""
    func._udf_category = 'transformer'
    return func

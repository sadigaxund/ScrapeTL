# Scraper Input Parameters Documentation

Scrapers can define a declarative schema of input parameters by setting the `inputs` class attribute. This schema is used by the frontend to dynamically generate forms for manual runs and scheduled tasks.

## How to Define Inputs

In your scraper class (subclass of `BaseScraper`), define `inputs` as a list of dictionaries:

```python
class MyScraper(BaseScraper):
    inputs = [
        {"name": "chapter", "label": "Starting Chapter", "type": "number", "default": 1},
        {"name": "lang",    "label": "Language",         "type": "select", "options": ["en","jp"], "default": "en"},
    ]

    def scrape(self, chapter=1, lang="en") -> List[dict]:
        # chapter and lang are passed as kwargs
        ...
```

---

## Supported Input Types

### 1. `string`
A standard single-line text input.
- **Python Type**: `str`
- **Fields**:
    - `name`: (Required) The keyword argument name for the `scrape()` method.
    - `label`: (Optional) The human-readable label shown in the UI.
    - `default`: (Optional) The initial value in the form.
    - `required`: (Optional) If `True`, the UI form enforces a non-empty value.

```python
{"name": "search_query", "label": "Search Term", "type": "string", "default": "", "required": True}
```

### 2. `number`
A numeric input field.
- **Python Type**: `int` or `float`
- **Fields**:
    - `name`: (Required)
    - `label`: (Optional)
    - `default`: (Optional)
    - `required`: (Optional)

```python
{"name": "max_results", "label": "Max Results", "type": "number", "default": 10}
```

### 3. `boolean`
A checkbox in the UI.
- **Python Type**: `bool`
- **Fields**:
    - `name`: (Required)
    - `label`: (Optional)
    - `default`: (Optional) `True` or `False`.

```python
{"name": "fetch_images", "label": "Download Images?", "type": "boolean", "default": True}
```

### 4. `select`
A dropdown menu for selecting from a predefined list of options.
- **Python Type**: Any (usually `str` or `int` matching the option values)
- **Fields**:
    - `name`: (Required)
    - `label`: (Optional)
    - `options`: (Required) A list of possible values.
    - `default`: (Optional) Must be one of the provided options.

```python
{"name": "quality", "label": "Video Quality", "type": "select", "options": ["1080p", "720p", "480p"], "default": "1080p"}
```

---

## Integration Details

- **Manual Run**: If a scraper defines `inputs`, clicking "Run Now" will open a modal for you to fill in these values before execution.
- **Schedules**: When creating a schedule, you will be prompted to set the input values. These values are stored with the schedule and used every time it triggers automatically.
- **Default Values**: If no values are provided, the `default` defined in the schema is used. If no `default` is defined in the schema, the keyword arguments in the `scrape()` method follow standard Python default behavior.

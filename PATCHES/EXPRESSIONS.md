# 🧩 Context Registry & Expressions

ScrapeTL uses a powerful Expression Engine to resolve dynamic values in scraper inputs, notification payloads, and filenames using `{{ ... }}` syntax.

## 🛠️ Built-in Expressions

| Expression | Description | Example |
| :--- | :--- | :--- |
| `{{today}}` | Current date (YYYY-MM-DD) | `{{today}}` → `2024-03-28` |
| `{{now}}` | Current date & time | `{{now}}` → `2024-03-28 14:30:05` |
| `{{yesterday}}` | Yesterday's date | `{{yesterday}}` → `2024-03-27` |
| `{{env("VAR")}}` | Environment variable | `{{env("PORT")}}` → `8000` |
| `{{random(a, b)}}` | Random integer between a and b | `{{random(1, 10)}}` → `7` |
| `{{uuid()}}` | Generate a unique UUID v4 | `{{uuid()}}` → `f47ac10b...` |
| `{{json(obj)}}` | Serialize object to JSON string | `{{json({"id":1})}}` → `{"id":1}` |
| `{{upper(txt)}}` | Convert text to UPPERCASE | `{{upper("hi")}}` → `HI` |
| `{{lower(txt)}}` | Convert text to lowercase | `{{lower("HI")}}` → `hi` |
| `{{strip(txt)}}` | Remove surrounding whitespace | `{{strip("  txt  ")}}` → `txt` |

---

## 📦 Shared Variables

You can define global variables in **Context Registry > Shared Variables**. These are available in all expressions.
- **Key**: The name to use, e.g., `api_key`.
- **Usage**: `{{api_key}}`.
- **Secret**: If marked as secret, the value is hidden in the UI but available to scrapers.

---

## 🐍 Custom functions (UDFs)

You can import your own Python logic into the database via **Context Registry > Expressive Functions**.

### How to Import
1.  **Create a `.py` file**: Write standard Python functions.
2.  **Import**: In the UI, set a **Function Name** (this is what you'll call in expressions) and upload your file.
3.  **Execute**: Your code is stored in the database and executed in a sandboxed namespace.

### Code Example (`udf_example.py`)
```python
import re

def clean_price(text):
    """Extracts digits and returns float"""
    if not text: return 0.0
    nums = re.findall(r"[\d\.]+", str(text).replace(',', ''))
    return float(nums[0]) if nums else 0.0

def slugify(text):
    return text.lower().replace(' ', '-')
```

### Calling UDFs
Once imported with the name `clean_price`, you can use it like this:
- **Input**: `{{clean_price(data.price_str)}}`
- **Math**: `{{clean_price(data.price) * 1.2}}` (Add 20% tax)

> [!IMPORTANT]
> Custom functions have access to the same environment as the main application. Ensure you only import trusted code.

---

## 🧪 Advanced Python Expressions

Since ScrapeTL uses a dynamic evaluation engine, you can perform standard Python operations directly:
- **Math**: `{{1 + 2 * 3}}` → `7`
- **String Ops**: `{{ "hello".upper() }}` → `HELLO`
- **Slicing**: `{{ today[:4] }}` → `2024`

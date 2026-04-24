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

---

## 💎 Semantic Function Contracts (UDF Upgrade)

Functions are now intelligently categorized based on their Python signature and return logic. This allows the **Scraper Builder** to adapt its UI (ports) specifically to your code.

### 1. Categories & Usage

| Type | Icon | Contract | Builder Behavior |
| :--- | :--- | :--- | :--- |
| **Comparator** | 💎 | Returns `bool` | **Transforms** Conditional Node ports to match arguments. |
| **Generator** | 📡 | Uses `yield` | Emits multiple values (for loops/streams). |
| **Transformer**| 🔧 | Generic return | Used for data mapping and calculations. |

### 2. Implementation & Auto-Detection

The system automatically detects the function type when you import or save your code:

- **Comparator**: Scan for `-> bool` type hint or `return True / False`.
  ```python
  def is_valid_price(price: float, threshold=100.0) -> bool:
      return price > 0 and price <= threshold
  ```
  *In the Builder: Selecting this automatically creates two input ports: `price` and `threshold`.*

- **Generator**: Scan for the `yield` keyword or `-> Generator` / `-> Iterable`.
  ```python
  def sitemap_walker(url: str):
      for i in range(1, 11):
          yield f"{url}?page={i}"
  ```

- **Transformer**: The default for any standard value-returning function.
  ```python
  def clean_name(name: str):
      return name.strip().title()
  ```

### 3. Named Port Mapping

When using a **Comparator** in the **Conditional Branch** node (Custom Mode):
1.  **Select the Function**: Pick your UDF from the registry.
2.  **Automatic Transformation**: The node's generic `Input A/B` ports will be replaced by the actual argument names from your Python code.
3.  **Connect & Execute**: Connect any data node to these named ports. The engine will automatically pass them as arguments to your function.

> [!TIP]
> Use **Type Hints** (like `: float` and `-> bool`) in your Python code. Not only does it make your logic clearer, but it also helps the Builder UI categorize your functions perfectly!

> [!IMPORTANT]
> If your function takes multiple arguments, ensure you connect a value to **every named port** in the builder to avoid execution errors.

---

## 🧪 Advanced Python Expressions

Since ScrapeTL uses a dynamic evaluation engine, you can perform standard Python operations directly:
- **Math**: `{{1 + 2 * 3}}` → `7`
- **String Ops**: `{{ "hello".upper() }}` → `HELLO`
- **Slicing**: `{{ today[:4] }}` → `2024`

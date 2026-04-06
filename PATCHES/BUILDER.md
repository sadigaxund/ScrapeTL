# 🏗️ Scraper Builder Manual

Welcome to the ScrapeTL Builder—a no-code visual engine for designing complex, multi-step web scrapers. This document covers every node, feature, and logic rule you need to build robust flows.

---

## 🧩 Core Concepts

### 1. The "Source/Result" Paradigm
Most nodes in the builder follow a standard naming convention for their ports:
- **Source**: The starting point (URL, HTML string, or Data object).
- **Result**: The output produced by that node for the next step.

### 2. Implicit Iteration (Map-over-List)
The engine is "list-aware." If you connect a list (e.g., from a BeautifulSoup Selector) to a node that expects a single item (e.g., Text Transform), the engine automatically **maps** that action over the entire list and emits a new list. You don't need manual "for loops."

### 3. Conditional Branching
Nearly all logic nodes emit **True** and **False** signals. You can chain these to create custom execution paths (e.g., "If Price < 100, save result; else, ignore").

---

## 📦 Node Library

### 🔼 Input Nodes
| Node | Description | Config |
| :--- | :--- | :--- |
| **External Parameter** | Accepts values when starting a manual or scheduled run. | `Name`, `Data Type` |
| **Context Registry** | Pulls a value from the global Shared Variables or System Env. | `Value` (Expression) |

### 📡 Source Nodes
| Node | Description | Config |
| :--- | :--- | :--- |
| **Fetch HTML** | Standard HTTP request to a URL. | `Method`, `Headers` |
| **Playwright Fetch** | Full browser execution with JavaScript support. | `Headless`, `Actions` |

### 🔧 Action Nodes
| Node | Description | Config |
| :--- | :--- | :--- |
| **BeautifulSoup Selector**| Extract data using CSS selectors. | `Selector`, `Match Mode` |
| **HTML Children** | Splits a parent element into a list of its children. | `Selector` |
| **Regex Extraction** | Pattern-based data extraction. | `Pattern`, `Group Index` |
| **Text Transform** | Prefix, suffix, find/replace, or trim text. | `Operation`, `Value` |
| **Type Converter** | Cast data between integer, float, string, and JSON. | `Target Type` |

### ⚖️ Logic Nodes (Conditional)
| Node | Description | Output Ports |
| :--- | :--- | :--- |
| **Logical Gate** | AND / OR logic between two inputs. | `True`, `False` |
| **Comparison** | Mathematical comparison (>, <, ==, etc.). | `True`, `False` |
| **String Match** | Regex or substring checks on text. | `True`, `False` |
| **Status Check** | Unary checks (Exists, Empty, Is Active). | `True`, `False` |
| **Custom Logic** | Executes a Python function from the registry. | `True`, `False` |

### 🛠️ Utility Nodes
| Node | Description | Usage |
| :--- | :--- | :--- |
| **Splitter** | Duplicates a signal into two separate paths. | Parallel processing. |
| **Combiner** | Merges multiple signals into a single list or object. | Flattening results. |

---

## 🖱️ Playwright Actions

The **Playwright Fetch** node supports a sequence of interactive actions:
- `goto`: Navigate to a specific URL.
- `click`: Click an element via CSS/XPath.
- `fill`: Enter text into an input field.
- `wait`: Pause for a duration or until a selector appears.
- `scroll`: Scroll into view or to bottom of page.
- `screenshot`: Capture a screenshot of a specific element or the full page.
- `fetch_image`: Specialized action that extracts an image via **Canvas (pixel extraction)** to bypass CORS and referrer blocks.

---

## 🔍 Debugging & Sinks

### 1. System Output
This is the final node for any scraper. Data connected here is what actually appears in your Dashboard Logs and gets sent to Discord/Webhooks. You can labels these (e.g., "Manga Updates").

### 2. Debug Sink & Inspector
Use the **Debug Sink** for intermediate steps. It generates "Artifacts" (HTML snippets or raw JSON) that you can view in the scraper history by clicking **🔬 Inspect Raw Data**.

### 3. Error Handling
If a node fails (e.g., a selector doesn't match):
- The `Result` port remains `None`.
- Subsequent logic nodes will usually emit a `False` signal.
- The engine logs the specific action failure to help you refine your selectors.

---

## ⚠️ Important Rules

> [!TIP]
> **Use Unique Collection Names**: If you have multiple `System Output` nodes, give them different labels to group your results logically.

> [!IMPORTANT]
> **Cardinality Matters**: If you use a node with multiple inputs (like a Selector or Splitter), ensuring that the connected results are "list-compatible" will prevent execution errors.

> [!CAUTION]
> **Headed Mode**: Only use "Headed" mode for local debugging. On the server, it may fail to launch if no graphical environment is available.

# ScrapeTL (Release 2.0.0) - The Scraper Builder & Debug Engine

This release marks the transition of ScrapeTL from a strictly code-based platform to a hybrid **No-Code / Low-Code** environment. It introduces the **Visual Scraper Builder**, a high-performance functional **Expression Engine**, and a dedicated **Debug Inspector** for granular execution tracing.

## 1. Major Feature: Visual Scraper Builder
- **Topological Flow Engine**: Build scrapers by connecting nodes on an interactive, zoomable, and pannable canvas. The `BuilderEngine` automatically resolves execution order based on a Directed Acyclic Graph (DAG) and prevents circular dependencies.
- **Node Categories**:
    - **Sources**: Fetch data via `Fetch URL` (requests) or `Fetch Playwright` (browser-based).
    - **Actions**: Transform data via `BS4 Selector`, `Regex Extract`, `Text Transform`, or `Type Convert`.
    - **Inputs**: Define flow-level parameters using `Input: Expression` or `Input: External`.
    - **Sinks**: Route final data to `System Output` (Production) or `Debug Sink` (Internal Tracing).
- **Persistent Context**: Seamlessly update database-level `Shared Variables` directly from your flow using the `Sink: Context` node.

## 2. Major Feature: Functional Expression Engine
The evaluation engine has been upgraded from static string replacement to a full functional execution model.
- **Functional Built-ins**: Call dynamic helpers like `{{now()}}`, `{{today()}}`, and `{{uuid()}}` directly within any input field.
- **Smart Helpers**:
    - `{{json(data)}}`: Intelligently detects input type to either `load` or `dump` JSON automatically.
    - `{{random(min, max)}}`: Generate random integers within a range.
    - `{{str()}}`, `{{int()}}`, `{{len()}}`: Native type casting and length resolution.
- **Expression Picker (The "Pick" Feature)**: A redesigned UI menu with icons and badges to help you insert variables and functions into fields with the correct `{{ }}` syntax and safe default arguments.

## 3. Major Feature: Debug Inspector & Sandboxing
- **Multi-Channel Log Output**: Execution results are now split into `Main` (Production table) and `Debug` (Internal traces) channels.
- **The Inspector**: A dedicated side-drawer in the Logs menu that allows you to view raw data captured by `Debug Sink` nodes without polluting your production data.
- **Security Sandboxing**: Both the dashboard and the inspector now use sandboxed `<iframe>` previews for HTML content. This prevents "layout spill," CSS conflicts, and malicious script execution from scraped content (e.g., `srcdoc` isolation).

## 4. Architectural Updates
- **`app/builder/engine.py`**: The heart of the no-code system. Implements the topological sort, results caching, and node-level execution logic.
- **`app/expressions.py`**: The centralized expression sandbox. Updated to inject a functional namespace into the `eval()` environment securely.
- **`app/runner.py`**: Refactored to handle structured `BuilderEngine` outputs, combining results from multiple iterations into a single consolidated log entry.
- **`frontend/app.js` & `style.css`**: Massive UI expansion to support the Canvas workspace, the side-drawer inspector, and the rich "Pick" menu.

## 5. Documentation References
For detailed guides on specific subsystems, refer to the following PATCH documents:

| Documentation | Focus Area |
| :--- | :--- |
| **[EXPRESSIONS.md](file:///c:/Users/sadig/Documents/DiscordAnimeScraper/PATCHES/EXPRESSIONS.md)** | Full syntax guide for functional calls, shared variables, and custom UDFs. |
| **[SCRAPER_INPUTS.md](file:///c:/Users/sadig/Documents/DiscordAnimeScraper/PATCHES/SCRAPER_INPUTS.md)** | Declaring parameter schemas for both Python and Builder scrapers. |
| **[FIXED_BUGS.md](file:///c:/Users/sadig/Documents/DiscordAnimeScraper/PATCHES/FIXED_BUGS.md)** | Tracking UI interaction fixes (Zoom, SVG layering, and Coordinate math). |

---
> [!TIP]
> Use the **`Sink: Debug`** node generously during the development of your flows. It allows you to "tap" into any connection and view its raw value in the Inspector after a run, significantly speeding up the debugging of complex selectors.

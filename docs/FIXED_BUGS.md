# Fixed Bugs Register

This file contains a record of identified and resolved bugs in the ScrapeTL Hub project, documenting the nature of each issue, the systems affected, and the specific fixes applied.

---

### 1. Rendering Pipeline Failure (Synchronous Crash)
- **Status**: ✅ SOLVED
- **File**: [app.js](file:///c:/Users/sadig/Documents/DiscordAnimeScraper/frontend/app.js)
- **Description**: The `renderBuilderNodes()` function would crash synchronously if it encountered a node with a missing preset or corrupted data structure. Because it was in a single loop, one "bad" node would prevent the entire flow (and all subsequent nodes) from rendering.
- **Fix**: Wrapped the node rendering loop in a `try...catch` block per-node and added safety checks for `NODE_PRESETS` lookups.

### 2. Interaction Blockage (SVG Layer Interception)
- **Status**: ✅ SOLVED
- **File**: [style.css](file:///c:/Users/sadig/Documents/DiscordAnimeScraper/frontend/style.css)
- **Description**: The SVG layer used for drawing connection lines was positioned on top of the node container, intercepting all mouse clicks and preventing users from placing new nodes on the canvas.
- **Fix**: Applied `pointer-events: none` to the `.builder-svg-layer` while maintaining `pointer-events: stroke` for the connection hit areas.

### 3. Global App Crash (Null Reference in switchTab)
- **Status**: ✅ SOLVED
- **File**: [app.js](file:///c:/Users/sadig/Documents/DiscordAnimeScraper/frontend/app.js) (Lines ~348-350)
- **Description**: The `switchTab()` function tried to access the `.style` property of an element with `id="main-add-btn"`. Since this button was removed or renamed in the current HTML, the script threw a "Cannot read properties of null" error, crashing the entire UI initialization.
- **Fix**: Added a null check for `addBtn` before attempting to modify its display style.

### 4. Node "Teleportation" Bug (Coordinate Space Mismatch)
- **Status**: ✅ SOLVED
- **File**: [app.js](file:///c:/Users/sadig/Documents/DiscordAnimeScraper/frontend/app.js) (Lines ~920-940)
- **Description**: When dragging a node, it would "jump" or teleport to the bottom-right. This was caused by the `mousedown` handler accounting for the viewport offset (`vRect.left/top`) while the `mousemove` handler was using raw window coordinates.
- **Fix**: Standardized the coordinate math in the global `mousemove` listener to subtract the viewport's bounding rect offset.

### 7. Missing Zoom Functionality
- **Status**: ✅ SOLVED
- **File**: [app.js](file:///c:/Users/sadig/Documents/DiscordAnimeScraper/frontend/app.js)
- **Description**: The Scraper Builder was missing a `wheel` event listener, making it impossible for users to zoom in/out with `Ctrl + Scroll`. 
- **Fix**: Implemented a unified `setZoom` engine in `app.js` and added a `wheel` listener to the builder viewport with zoom-to-cursor math.

### 8. Discord Integration - Empty Results Data
- **Status**: ✅ SOLVED
- **File**: [runner.py](file:///c:/Users/sadig/Documents/DiscordAnimeScraper/app/runner.py), [discord.py](file:///c:/Users/sadig/Documents/DiscordAnimeScraper/app/discord.py)
- **Description**: When the "Include Scraping Results" option was enabled in Discord integrations, only the execution state (Success/Failure) was being sent, even if data was successfully scraped. This was caused by `app/runner.py` passing an empty list instead of the actual results.
- **Fix**: Updated the integration dispatcher to use the correct results list and refined the Discord notification logic to handle both data and state payloads consistently, including improved visual formatting (thumbnails/footers).

### 9. Tainted Canvas Security Errors (fetch_image)
- **Status**: ✅ SOLVED
- **File**: [engine.py](file:///c:/Users/sadig/Documents/DiscordAnimeScraper/app/builder/engine.py)
- **Description**: When attempting to extract images via Canvas (`toDataURL`), the browser would frequently throw `SecurityError: Tainted canvases may not be exported` if the image was hosted on a different domain without CORS headers.
- **Fix**: Implemented a silent network-level fallback using `page.request.get` when the canvas extraction fails. Suppressed the noisy security logs to keep the execution output clean.

### 10. Implicit Iteration Propagation Logic
- **Status**: ✅ SOLVED
- **File**: [engine.py](file:///c:/Users/sadig/Documents/DiscordAnimeScraper/app/builder/engine.py)
- **Description**: The "Map-over-List" logic (implicit iteration) was failing to propagate correctly when a node was in "All" mode but received a single item, or vice versa. This caused inconsistent row counts in the final output.
- **Fix**: Refactored the `BuilderEngine` to automatically detect list inputs and wrap/unwrap them based on the node's expected cardinality, ensuring "All" mode correctly iterates through every row.

### 11. Scheduler Timezone Hot-Reload Crash
- **Status**: ✅ SOLVED
- **File**: [scheduler.py](file:///c:/Users/sadig/Documents/DiscordAnimeScraper/app/scheduler.py)
- **Description**: Updating the global timezone setting while the background scheduler was running caused a race condition and potential crash because APScheduler does not support runtime reconfiguration of its base timezone.
- **Fix**: Modified `reload_timezone` to check if the scheduler is running before attempting configuration. Instead of reconfiguring the engine, it now dynamically reloads all active jobs using the new timezone offset.
60: 
61: ### 12. Logic Port Connection Confirmation (Ghost Lines)
62: - **Status**: ✅ SOLVED
63: - **File**: [app.js](file:///c:/Users/sadig/Documents/DiscordAnimeScraper/frontend/app.js)
64: - **Description**: After dropping a connection, the line occasionally remained in a "ghost" (dashed/preview) state until a subsequent UI interaction occurred. This was caused by an undefined reference to `nodeRegistry` (instead of `NODE_PRESETS`) during the `growNode` call, which crashed the `mouseup` handler before it could clear the `activeConnection` state.
65: - **Fix**: Corrected the internal variable reference to `NODE_PRESETS` and wrapped the port expansion logic in a `try...catch` block to ensure `activeConnection = null` always executes.
66: 
67: ### 13. Logical Gate Semantic Rework
68: - **Status**: ✅ SOLVED
69: - **File**: [app.js](file:///c:/Users/sadig/Documents/DiscordAnimeScraper/frontend/app.js), [style.css](file:///c:/Users/sadig/Documents/DiscordAnimeScraper/frontend/style.css)
70: - **Description**: Logic nodes lacked clear visual identity for branching, and manual port management was tedious.
71: - **Fix**: Implemented semantic color-coding (Green for True, Red for False) for logic ports and connection paths. Added auto-expansion logic that grows or prunes ports dynamically during wiring, removing the need for manual +/- buttons.
72: 
73: ### 14. Batch Trigger Guard Abortion
74: - **Status**: ✅ SOLVED
75: - **File**: [engine.py](file:///c:/Users/sadig/Documents/DiscordAnimeScraper/app/builder/engine.py)
76: - **Description**: If a `Comparison` node output a `Batch` (list) of booleans into a `Trigger` port, the engine would abort the downstream node if ANY element in the list was `False` (treated as a global abort).
77: - **Fix**: Updated the trigger guard logic to be batch-aware. The engine now only skips a node if ALL signals in a batch are `False`. If at least one value is `True`, the node is allowed to execute (allowing vectorized processing).
78: 
79: ### 15. Synchronous Variable Update Race
80: - **Status**: ✅ SOLVED
81: - **File**: [engine.py](file:///c:/Users/sadig/Documents/DiscordAnimeScraper/app/builder/engine.py)
82: - **Description**: Writing to the Context Registry would commit to the database but fail to update the current execution's runtime state. This meant downstream nodes reading the same variable would see "stale" (pre-execution) data.
83: - **Fix**: Modified the `sink_context` node to immediately inject written values back into the `global_vars` and `__namespaces__` runtime objects after the DB commit, ensuring same-run consistency.
84: 
85: ### 16. Vectorized Context Assignment
86: - **Status**: ✅ SOLVED
87: - **File**: [engine.py](file:///c:/Users/sadig/Documents/DiscordAnimeScraper/app/builder/engine.py)
88: - **Description**: Attempting to assign a `Batch` of values to a single Context variable was ambiguous—it would either serialize the whole list as a string or pick randomly.
89: - **Fix**: Updated `sink_context` to paired-zip values with their corresponding triggers. It now filters for truthy triggers and assigns the first valid result to the variable, correctly handling the "Only update if match found" pattern used in episode tracking.


### 17. Universal Batch Filter State Override
- **Status**: ✅ SOLVED
- **File**: [engine.py](file:///c:/Users/sadig/Documents/DiscordAnimeScraper/app/builder/engine.py)
- **Description**: After implementing the Universal Batch Filter in the execution loop, nodes were still outputting unfiltered data. This was because `_execute_node` was re-fetching the raw input data from the graph at the start of its execution, completely overwriting the filtered inputs prepared by the outer loop.
- **Fix**: refactored `_execute_node` to accept the pre-calculated `node_inputs` as a parameter and removed the redundant `_get_node_inputs` call inside the function. This ensures filtering is preserved and improves performance by reducing redundant graph traversals.

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

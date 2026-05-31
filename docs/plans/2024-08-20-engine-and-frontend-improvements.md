# ScrapeTL Engine and Frontend Improvements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-tab.

**Goal:** Improve the BATCH variable handling in the engine and refactor the frontend to use modular components instead of duplicated code

**Architecture:** This plan involves two main components: 1) improving the BATCH variable system to make it more consistent and less confusing, and 2) refactoring the frontend to use modular components instead of duplicated code

**Tech Stack:** Python, JavaScript

---

## Task 1: Improve Engine for BATCH Variables

**Files:**
- Create: `scrapetl/models.py`
- Modify: `scrapetl/runner.py`
- Modify: `scrapetl/builder/engine.py`

**Step 1: Update the Batch class implementation**

```python
# In scrapetl/models.py, update the Batch class:
class Batch(list):
    """Signals that this list should be iterated over (one run per item)."""
    
    def __init__(self, items=None):
        if items is not None:
            super().__init__(items) if items else super()
        # Add clear type checking and better error handling
        self._is_batch = True
    
    def is_batch(self):
        """Explicitly identify this as a batch object"""
        return hasattr(self, '_is_batch')
```

**Step 2: Update runner.py to handle BATCH variables more clearly**

In the `scrapeetl/runner.py` file, update the batch detection logic:

```python
# Update in runner.py around line 160:
def is_iterable_input(self, v):
    """Enhanced check for iterable inputs including Batch objects"""
    import types
    is_iter = isinstance(v, (types.GeneratorType, Batch)) or (isinstance(v, list) and hasattr(v, '_is_batch'))
    return is_iter
```

**Step 3: Implement comprehensive documentation with examples**

Add clear examples for BATCH usage patterns in documentation (to be added to the project documentation):

```markdown
### BATCH Variable Usage Examples:

1. **Basic BATCH Usage:**
   - Use `Batch(list)` to explicitly mark a list as a batch
   - When a node processes a Batch, it executes once per item
   - Non-Batch lists are treated as single values

2. **Hotel Example Implementation:**
   a) Extract list of all hotels: `Batch(hotel_list)`
   b) Pass to downstream nodes that explode per hotel
   c) Each hotel processes individually with results collected
```

**Step 4: Commit**

```bash
git add scrapetl/models.py scrapetl/runner.py scrapetl/builder/engine.py
git commit -m "refactor: improve BATCH variable handling and documentation"
```

### Task 2: Refactor Frontend Components

**Files:**
- Refactor: `scrapers.js`, `schedules.js`, and other frontend modules
- Create: `components/` directory for shared components

**Step 1: Create reusable thumbnail component**

Create a new `components/` directory and move common UI elements there:

```javascript
// Create components/thumbnail.js
const createThumbnailComponent = () => {
  // Unified thumbnail handling component
  return {
    previewThumb: (url, elementId) => {
      // Implementation for thumbnail preview
    },
    handleThumbFile: (fileInput, previewElement) => {
      // Handle file input for thumbnail
    }
  };
};
```

**Step 2: Refactor scrapers list to use unified components**

Replace duplicated table rendering code with calls to the new component system:

```javascript
// In scrapers.js, replace the table rendering code with:
function renderScrapersList(scrapers) {
  const tableRows = scrapers.map(scraper => `
    <tr>
      <td>${thumbHtml}</td>
      // Use the new unified table component
    </tr>
  `).join('');
}
```

**Step 3: Implement unified table component**

```javascript
// Create unified table component
const createTableComponent = (data, columns) => {
  // Generic table rendering logic
  return `
    <table class="scrapers-table">
      <thead>
        ${columns.map(col => `<th>${col.label}</th>`).join('')}
      </thead>
      <tbody>
        ${data.map(row => `
          <tr>
            ${columns.map(col => `<td>${row[col.field]}</td>`).join('')}
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
};
```

**Step 4: Implement form handling component**

```javascript
// Create unified form handling component
const createFormComponent = (formData, formElement) => {
  // Unified form handling for all modules
  const formHandler = {
    handleSubmit: (e) => {
      e.preventDefault();
      // Form submission logic
    },
    
    handleValidation: () => {
      // Form validation logic
    }
  };
  
  return formHandler;
};
```

**Step 5: Commit**

```bash
git add .
git commit -m "refactor: frontend component modularization"
```
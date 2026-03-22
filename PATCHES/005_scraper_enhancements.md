# Patch 005: Scraper Feature Enhancements

## Overview
This patch introduces several user-requested enhancements to the scraper modules, primarily focusing on version control, UI organization, and diagnostics.

## Features Implemented

### 1. Semver Versioning & Commit Messages
- **Backend (`app/api/scrapers.py` & Models)**: 
  - Added `ScraperVersion` model to store the history of scraper code changes.
  - Implemented `version_label` (e.g., `1.0.0`) and `commit_message` fields in scraper registration and update logic.
  - Added robust snapshotting routines (`_snapshot_version`) to track modifications to `.py` scripts.
  - New endpoints: `/api/scrapers/{id}/versions`, `/api/scrapers/{id}/versions/{version_id}`, and `/api/scrapers/{id}/revert/{version_id}` support viewing and rollback.
- **Frontend (`frontend/index.html` & `frontend/app.js`)**:
  - Semantic versioning inputs (Major.Minor.Patch) and commit message fields added to the Setup Wizard.
  - Included a Version History modal for viewing code changes and history logs.

### 2. Compact Tag Manager
- **Frontend**:
  - Integrated a compact tag management panel directly into the main Scrapers tab.
  - Added active tag filter chips making it simpler to selectively view scrapers.
  - Simplified tag creation, assignment, and deletion with minimal clicks (`tag-manager-panel`).
- **Backend**: API serves tag objects associated to each Scraper model.

### 3. Scraper Health Status Indicator
- **Backend**: Emits a `health` string property (`"ok"`, `"failing"`, or `"untested"`) for each scraper.
- **Frontend**: Scraper cards dynamically display health status alongside their enabled/disabled state (using distinct badges ✅ Healthy, ❌ Failing, ⚙️ Untested).

### 4. Improved Error Diagnostics
- **Frontend**: 
  - Log entries expand to show collapsible details for in-depth diagnostics.
  - Introduced `renderPayload()` to render complex JSON outputs as a readable key-value grid, automatically hyperlinking URLs.
  - Explicit error messages (`error_msg`) shown clearly for failed tasks.

### 5. Wizard Prompting & Drag-and-Drop
- **Frontend**: 
  - Improved "Setup Wizard" placeholder texts ("Drag & Drop your .py file here").
  - Drag-and-drop file zones (`wiz-code-zone`, `edit-code-zone`) receive visual styling (green highlight) and update their corresponding file name labels on input.

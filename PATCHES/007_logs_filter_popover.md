# Logs Filter Popover & Version UI Improvements

## Versioning & Modal Editing
- **Forced UI Version Bumping**: Replaced direct numerical access to `major`, `minor`, `patch` version numbers with read-only inputs strictly modifiable via custom "▲" increment buttons (`bumpVersion()` JS function).
- **Edit Modal Validation**: The entire version/commit block is now visually disabled (`opacity: 0.4; pointer-events: none;`) by default when editing a scraper. It is dynamically enabled only when a new `.py` file payload is selected, perfectly validating that versions cannot be bumped without committing a new code artifact.
- Fixed a layout issue where the commit message input was awkwardly inline with the version buttons by moving it to an independent full-width flex row.

## Logs Tab Overhaul
- **Removed native selects**: Abandoned the legacy `<select>` tag-based dropdowns for Scrapers and Status.
- **Three-Dimensional Popovers**: Replaced the entire Logs filter panel with a single horizontal row of native `<details>` popovers.
  - Three distinct popovers: **Scraper**, **Tag**, and **Status**.
  - Dropdown pills visually mimic the UI of regular "tags", using explicit color overrides when active.
  - The `<details>` internal menus (`.custom-dropdown-menu`) are absolutely positioned, restricted to `max-height: 250px` with vertical overflow, comfortably supporting boundless numbers of scrapers or tags without breaking the app layout.
  - Global DOM click listener added to natively auto-collapse any `<details>` element clicking externally.
- **Backend Analytics Query Update (`app/api/logs.py`)**: Sided in native support for `<Tag>` filtration. The REST endpoint queries now conditionally `.join(Scraper)` and filter by `.filter(Scraper.tags.any(id=tag_id))` enabling multidimensional query logic against logs.

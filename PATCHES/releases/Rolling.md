# Rolling Release Notes - March 24, 2026

## Core Implementation - No-Code Scraper Builder (v2.0)
We have pivoted the No-Code builder toward a "Component Collection" philosophy combined with a "Low-Code" escape hatch.
- **Collection Step**: Instead of a complex list parser, the UI now has a `Collect HTML Components` action. It allows selecting `outerHTML`, `innerHTML`, or `textContent` for a given CSS selector. 
- **Post-Processing Block**: Added a Python code editor in the wizard that accepts a `def process(components):` function. This allows the user to use BeautifulSoup, Regex, or native Python string manipulation on the raw collected strings.
- **Recipe Runner**: The backend `recipe_runner.py` was updated to handle the new `action` types and safely execute the user's `post_process` code using `exec()`.

## Storage & Database Optimization
To prevent long-term SQLite bloat from large HTML payloads, we implemented a strict truncation policy.
- **Backend**: `runner.py` now slices `payload_list[:10]` strictly before stringifying and saving to the database.
- **UI Grace**: The Logs menu now interprets `log.episode_count` vs `log.payload.length`. If data was truncated, it displays: *"✨ Displaying 10 out of X scraped items."*

## UI Refinement & Aesthetics
A significant pass on the "Premium Look" of the dashboard:
- **Consistent Badges**: Introduced `.log-epcount` (vibrant purple pill badge) for found counts in Logs and "Next Run" times in Schedules.
- **Typography & Labels**: Standardized `.payload-download-label` and `.payload-truncation-notice` for cleaner data status reporting.
- **Layout Fixes**: Fixed alignment of Log Filters; they are now perfectly aligned with the left edge of the logs cards.
- **Schedules Beautification**: Applied the new badge and label styles to the Active Schedules list.

## Integration Maintenance
- **Ghost Errors**: Fixed a bug where logs would report "No Webhook URL configured" as a failure even if no integration was actually assigned to the scraper. Now returns `None` and skips the integration layer silently if nothing is configured.

---

### Context for Next Session
The No-Code builder is now feature-complete for a fundamental "Browser Automation + Python Cleaning" pipeline. The current focus is on maximizing the reliability of the "Recipe Mode" vs "Script Mode" toggle and ensuring that non-developers can still manipulate scraped data effectively via the new Python hook. 
- **Next Potential Step**: Implement "Browser Preview" within the wizard so users can see which elements they are selecting in real-time.
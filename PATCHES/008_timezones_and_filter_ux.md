# Timezones and Filter UX Enhancements

## 1. Logs Filter Refinements
- **Inline Filter Clearing**: Natively removed the "All Scrapers", "All Tags", and "All" list items from the inside of the dropdown popovers. Instead, when a filter is active, a contextual `✕` clear button is injected directly onto the summary pill, allowing users to 1-click clear filters without menus.
- **Transparency Bug Fixed**: The dropdown popover menus were inheriting a glassmorphism (semi-transparent) background, causing text to clip bizarrely when scrolling beyond the logs container. Fixed this globally by overriding `.custom-dropdown-menu` in CSS to enforce `background: var(--bg-surface)` for a deeply solid, layered look.

## 2. Settings Timezone Overhaul
- **Timezone Search Autocomplete**: Eliminated the notoriously clunky `size="6"` native HTML `<select>` box in the Settings Tab. Replaced it with a native `<input list="tz-list">` bound to a dynamic `<datalist>`, offering robust native searchable text input.
- **Python UTC Calculation**: Rewrote the backend `/api/settings/timezones` endpoint. Instead of just emitting plain text like `"Asia/Baku"`, it dynamically computes UTC offset differentials using `datetime.utcnow()` and `pytz`, returning cleanly enriched JSON: `[{"id": "Asia/Baku", "label": "(UTC+04:00) Asia/Baku"}]`. Users can now intuitively just search `+4` to instantly filter correct local time zones.
- **App logic Cleanup**: Unwired redundant filtering string-matching from `frontend/app.js` (`filterTzOptions` is gone), deferring entirely to the browser's high-performance native datalist matching.

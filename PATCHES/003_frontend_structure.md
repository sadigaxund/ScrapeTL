# Patch 003: Vanilla JS Frontend Structure

## Philosophy
The frontend (`frontend/index.html`, `frontend/app.js`, `frontend/style.css`) is written entirely without frameworks (No React, Vue, or Tailwind) to stay lightweight and easily modifiable. It implements a Tabbed Single-Page Application (SPA) feel.

## State Management
State is held in a single global `state` object inside `app.js`:
```javascript
let state = {
    scrapers:        [],
    tags:            [],
    integrations:    [],
    currentLogsPage: 0,
    logsPageSize:    50,
    activeTagFilter: '',
};
```
When API calls change the database, the relevant UI functions (e.g. `loadScrapers()`) are called to re-fetch the data and forcibly re-render the HTML content for that specific tab. There is also a 30s auto-refresh loop for the `Queue` and the Active Tab via `setInterval(refreshAll, 30_000)`.

## API Calls
All interactions with the backend are handled through a generalized `apiFetch()` utility that automatically sets headers and parses JSON, propagating `throw new Error()` on non-200 status codes.

## UI Components
1. **Modals:** Popups for Wizard Setup, Editing Scrapers, Assigning Tags, and Assigning Integrations use absolute positioning overlays. We pass the `scraperId` directly into the DOM (e.g. `#assign-tags-scraper-id`) when opening modals.
2. **Setup Wizard:** Creating a scraper is now handled via a unified multipart modal form (`#wizard-modal`). It collects "Name", "Description", "Homepage URL", "Thumbnail", and provides a large drag-and-drop zone to directly upload a `.py` text file overriding the `BaseScraper.scrape()` method. All information is posted to `/api/scrapers/wizard` concurrently to avoid state sync issues.
3. **Settings Timezone:** The timezone dropdown is populated with `api/settings/timezones` via an autocomplete/search box.
4. **Log Payloads:** The `Logs` tab uses a collapsible card system to avoid wide tables. The raw JSON stored in the `payload` database column is mapped into a vertical Grid dynamically by `renderPayload(log.payload)`. If a payload field starts with `http`, the UI auto-converts it to a target blank hyperlink.

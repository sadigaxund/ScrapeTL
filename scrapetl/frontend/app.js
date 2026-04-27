/* ════════════════════════════════════════════════
   ScrapeTL - Entry Point
   Loads after all modules. Boots the app.
════════════════════════════════════════════════ */

window.addEventListener('DOMContentLoaded', () => {
    console.log("[App] DOMContentLoaded. Initializing...");
    // Load initial settings to pick up saved timezone
    apiFetch(API.settings).then(settings => {
        if (settings.timezone) state.timezone = settings.timezone;
    }).catch(e => console.error("[App] Failed to load settings:", e));

    try {
        loadScrapers();
        loadQueue();
        loadVariables();
        loadFunctions();
    } catch (e) {
        console.error("[App] Initialization error during load:", e);
    }

    // Pre-load integrations state so assign modal works from the start
    apiFetch(API.integrations).then(i => { state.integrations = i; }).catch(() => { });

    // Wire up drag-and-drop for both code upload zones
    try {
        _setupCodeDropZone('wiz-code-zone', 'wiz-code-file', 'wiz-code-text');
        _setupCodeDropZone('edit-code-zone', 'edit-code-file', 'edit-code-text');
        _setupCodeDropZone('func-code-zone', 'func-code-file', 'func-code-text');
    } catch (e) {
        console.error("[App] Failed to setup dropzones:", e);
    }
    console.log("[App] Initialization complete.");
});

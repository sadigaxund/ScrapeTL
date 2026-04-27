/* ── Settings Tab: Timezone, Browser, Log Retention ─── */
/* ════════════════════════════════════════════════
   SETTINGS
════════════════════════════════════════════════ */
let _allTimezones = [];

async function loadSettings() {
    try {
        const [settings, timezones] = await Promise.all([
            apiFetch(API.settings),
            _allTimezones.length ? Promise.resolve(_allTimezones) : apiFetch(API.timezones),
        ]);
        if (!_allTimezones.length) _allTimezones = timezones;

        const current = settings.timezone || 'UTC';
        state.timezone = current;

        const dl = document.getElementById('tz-list');
        if (dl && (!_allTimezones.length || dl.children.length === 0)) {
            dl.innerHTML = _allTimezones.map(t => `<option value="${t.id}">${t.label}</option>`).join('');
        }

        const tzInp = document.getElementById('tz-input');
        if (tzInp && document.activeElement !== tzInp) {
            tzInp.value = current;
        }

        // Browser Defaults
        const headless = settings.browser_headless !== undefined ? settings.browser_headless : 'true';
        const cdp = settings.browser_cdp_url || '';
        if (document.getElementById('setting-browser-headless')) {
            document.getElementById('setting-browser-headless').value = String(headless);
        }
        if (document.getElementById('setting-browser-cdp')) {
            document.getElementById('setting-browser-cdp').value = cdp;
        }

        const logLimit = settings.log_preview_limit !== undefined ? settings.log_preview_limit : '10';
        if (document.getElementById('setting-log-preview-limit')) {
            document.getElementById('setting-log-preview-limit').value = logLimit;
        }

        const logDir = settings.log_directory || './logs';
        if (document.getElementById('setting-log-directory')) {
            document.getElementById('setting-log-directory').value = logDir;
        }

        const logRetention = settings.log_retention_days || '30';
        if (document.getElementById('setting-log-retention')) {
            document.getElementById('setting-log-retention').value = logRetention;
        }

        const logMaxSize = settings.log_max_size_kb || '2048';
        if (document.getElementById('setting-log-max-size')) {
            document.getElementById('setting-log-max-size').value = logMaxSize;
        }

        const batchThrottle = settings.batch_throttle_seconds !== undefined ? settings.batch_throttle_seconds : '0';
        if (document.getElementById('setting-batch-throttle')) {
            document.getElementById('setting-batch-throttle').value = batchThrottle;
        }

    } catch (e) { toast(e.message, 'error'); }
}

async function saveAppSetting(key, value) {
    try {
        await apiFetch(`${API.settings}/${key}`, {
            method: 'PUT',
            body: JSON.stringify({ value: value })
        });
    } catch (e) {
        throw new Error(`Failed to save ${key}: ${e.message}`);
    }
}

async function saveAllAppSettings() {
    const btn = document.getElementById('save-all-settings-btn');
    const tz = document.getElementById('tz-input').value.trim();
    const bHeadless = document.getElementById('setting-browser-headless').value;
    const bCDP = document.getElementById('setting-browser-cdp').value.trim();
    const logLimit = document.getElementById('setting-log-preview-limit').value;
    const logDir = document.getElementById('setting-log-directory').value.trim();
    const logRetention = document.getElementById('setting-log-retention').value;
    const logMaxSize = document.getElementById('setting-log-max-size').value;
    const batchThrottle = document.getElementById('setting-batch-throttle').value;

    if (!tz) { toast('Please enter a timezone.', 'error'); return; }

    btn.disabled = true;
    // Keep text as "Save" per user request

    try {
        // Save all in parallel
        await Promise.all([
            apiFetch(`${API.settings}/timezone`, { method: 'PUT', body: JSON.stringify({ value: tz }) }),
            saveAppSetting('browser_headless', bHeadless),
            saveAppSetting('browser_cdp_url', bCDP),
            saveAppSetting('log_preview_limit', logLimit),
            saveAppSetting('log_directory', logDir),
            saveAppSetting('log_retention_days', logRetention),
            saveAppSetting('log_max_size_kb', logMaxSize),
            saveAppSetting('batch_throttle_seconds', batchThrottle)
        ]);

        // Post-timezone update logic
        state.timezone = tz;
        Object.keys(responseCache).forEach(k => { responseCache[k] = null; });
        refreshAll();

        toast('Settings saved successfully.', 'success');
    } catch (e) {
        toast(`Error saving settings: ${e.message}`, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Save';
    }
}

async function saveTimezone() {
    // Keep for legacy/internal calls if any, but now wrapped in saveAllAppSettings for UI
    const val = document.getElementById('tz-input').value.trim();
    if (!val) { toast('Please enter a timezone.', 'error'); return; }
    try {
        await apiFetch(`${API.settings}/timezone`, { method: 'PUT', body: JSON.stringify({ value: val }) });
        state.timezone = val;
        Object.keys(responseCache).forEach(k => { responseCache[k] = null; });
        refreshAll();
        toast(`Timezone set to ${val}`, 'success');
    } catch (e) { toast(e.message, 'error'); }
}

/* ════════════════════════════════════════════════
   ScraperHub — Frontend Logic  v2
   Vanilla JS, no dependencies
════════════════════════════════════════════════ */

const API = {
    scrapers:     '/api/scrapers',
    schedules:    '/api/schedules',
    logs:         '/api/logs',
    queue:        '/api/queue',
    run:          (id) => `/api/run/${id}`,
    available:    '/api/scrapers/available',
    upload:       '/api/scrapers/upload',
    tags:         '/api/tags',
    scraperTags:  (sid, tid) => `/api/scrapers/${sid}/tags/${tid}`,
    integrations: '/api/integrations',
    scraperInteg: (sid, iid) => `/api/scrapers/${sid}/integrations/${iid}`,
    verifyInteg:  (id) => `/api/integrations/${id}/verify`,
    settings:     '/api/settings',
    timezones:    '/api/settings/timezones',
    versions:     (sid) => `/api/scrapers/${sid}/versions`,
    versionCode:  (sid, vid) => `/api/scrapers/${sid}/versions/${vid}`,
    revert:       (sid, vid) => `/api/scrapers/${sid}/revert/${vid}`,
};

/* ── State ──────────────────────────────────────────── */
let state = {
    scrapers:        [],
    tags:            [],
    integrations:    [],
    currentLogsPage: 0,
    logsPageSize:    50,
    activeTagFilter: '',   // '' = all
    logFilters: {
        scraperId: '',
        tagId: '',
        status: ''
    }
};

/* ── Utilities ──────────────────────────────────────── */
async function apiFetch(url, options = {}) {
    const headers = {};
    if (!(options.body instanceof FormData)) {
        headers['Content-Type'] = 'application/json';
    }
    const res = await fetch(url, {
        ...options,
        headers: { ...headers, ...(options.headers || {}) },
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(err.detail || `HTTP ${res.status}`);
    }
    return res.json();
}

function toast(msg, type = 'info') {
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    const icon = type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️';
    el.textContent = `${icon}  ${msg}`;
    document.getElementById('toast-container').appendChild(el);
    setTimeout(() => el.remove(), 4000);
}

function fmt(isoStr) {
    if (!isoStr) return '—';
    const d = new Date(isoStr + (isoStr.endsWith('Z') ? '' : 'Z'));
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function statusBadge(status) {
    const map = {
        success:   ['✅', 'success'],
        failure:   ['❌', 'failure'],
        pending:   ['⏳', 'pending'],
        running:   ['⚡', 'running'],
        done:      ['✅', 'done'],
        failed:    ['❌', 'failed'],
        manual:    ['🖱️', 'manual'],
        catchup:   ['⚠️', 'catchup'],
        scheduler: ['🕐', 'scheduler'],
    };
    const [icon, cls] = map[status] || ['•', 'pending'];
    return `<span class="status-badge badge-${cls}">${icon} ${status}</span>`;
}

/* ── URL helpers ────────────────────────────────────── */
function ensureHttps(url) {
    if (!url || !url.trim()) return '';
    url = url.trim();
    if (!url.startsWith('http://') && !url.startsWith('https://')) url = 'https://' + url;
    return url;
}

// Global click to close custom dropdowns
document.addEventListener('click', e => {
    document.querySelectorAll('.custom-dropdown').forEach(d => {
        if (!d.contains(e.target)) d.classList.remove('open');
    });
});

function filterDropdownConfig(inputEl) {
    const q = inputEl.value.toLowerCase();
    const items = inputEl.closest('.custom-dropdown-menu').querySelectorAll('.dropdown-item');
    items.forEach(item => {
        const text = item.textContent.toLowerCase();
        item.style.display = text.includes(q) ? 'flex' : 'none';
    });
}

/* ── Thumbnail helpers ──────────────────────────────── */
function previewThumb(url) {
    const img = document.getElementById('thumb-preview-img');
    const ph  = document.getElementById('thumb-preview-placeholder');
    const box = document.getElementById('thumb-preview');
    if (!url.trim()) {
        img.style.display = 'none'; img.src = '';
        ph.style.display = 'inline'; ph.textContent = '🎌';
        box.style.borderColor = ''; return;
    }
    img.onload  = () => { ph.style.display = 'none'; img.style.display = 'block'; box.style.borderColor = 'var(--success)'; };
    img.onerror = () => { img.style.display = 'none'; ph.style.display = 'inline'; ph.textContent = '⚠️'; box.style.borderColor = 'var(--failure)'; };
    ph.textContent = '🎌'; img.src = url;
}

function previewEditThumb(url) {
    const img = document.getElementById('edit-thumb-img');
    const ph  = document.getElementById('edit-thumb-placeholder');
    const box = document.getElementById('edit-thumb-preview');
    if (!url || !url.trim()) { img.style.display = 'none'; img.src = ''; ph.style.display = 'inline'; ph.textContent = '🎌'; if(box) box.style.borderColor = ''; return; }
    img.onload  = () => { ph.style.display = 'none'; img.style.display = 'block'; if(box) box.style.borderColor = 'var(--success)'; };
    img.onerror = () => { img.style.display = 'none'; ph.style.display = 'inline'; ph.textContent = '⚠️'; if(box) box.style.borderColor = 'var(--failure)'; };
    img.src = url;
}

/* ── Tab Navigation ─────────────────────────────────── */
const TAB_META = {
    scrapers:     { title: 'Scrapers',     subtitle: 'Manage your scraper plugins' },
    schedules:    { title: 'Schedules',    subtitle: 'Configure cron-based scrape schedules' },
    logs:         { title: 'Logs',         subtitle: 'Full history of all scrape runs' },
    queue:        { title: 'Queue',        subtitle: 'Catch-up tasks for missed scheduled runs' },
    integrations: { title: 'Integrations', subtitle: 'Manage notification integrations' },
    settings:     { title: 'Settings',     subtitle: 'App-wide configuration' },
};

function switchTab(name) {
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    document.querySelector(`[data-tab="${name}"]`).classList.add('active');
    document.getElementById(`tab-${name}`).classList.add('active');
    document.getElementById('page-title').textContent    = TAB_META[name].title;
    document.getElementById('page-subtitle').textContent = TAB_META[name].subtitle;
}

document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
        const tab = btn.getAttribute('data-tab');
        switchTab(tab);
        loadTab(tab);
    });
});

function loadTab(tab) {
    if (tab === 'scrapers')     loadScrapers();
    if (tab === 'schedules')    loadSchedules();
    if (tab === 'logs')         loadLogs();
    if (tab === 'queue')        loadQueue();
    if (tab === 'integrations') loadIntegrations();
    if (tab === 'settings')     loadSettings();
}

/* ════════════════════════════════════════════════
   SCRAPERS
════════════════════════════════════════════════ */
async function loadScrapers() {
    const [scrapers, tags] = await Promise.all([
        apiFetch(API.scrapers),
        apiFetch(API.tags).catch(() => []),
    ]);

    state.scrapers = scrapers;
    state.tags     = tags;
    document.getElementById('scraper-count').textContent = scrapers.length;

    // Render tag filter chips
    renderTagFilterChips(tags);

    // Render scrapers list (filtered)
    renderScrapersList(scrapers);

    populateScraperSelects(scrapers);
    renderLogFilters();
}

function renderTagManager(tags) {
    const el = document.getElementById('tags-list');
    if (!tags.length) {
        el.innerHTML = '<span style="color:var(--text-muted);font-size:13px">No tags yet.</span>';
        return;
    }
    el.innerHTML = tags.map(t => `
        <span class="tag-pill" style="background:${t.color}22;border-color:${t.color};color:${t.color}">
            ${t.name}
            <button onclick="deleteTag(${t.id})" title="Delete tag" style="background:none;border:none;cursor:pointer;color:${t.color};margin-left:4px;padding:0;font-size:13px;line-height:1">×</button>
        </span>
    `).join('');
}

function renderTagFilterChips(tags) {
    const container = document.getElementById('tag-filter-chips');
    let html = `<button class="tag-chip ${state.activeTagFilter === '' ? 'tag-chip--active' : ''}" data-tag-id="" onclick="filterByTag(this, '')">All</button>`;
    tags.forEach(t => {
        const active = state.activeTagFilter === String(t.id);
        html += `<button class="tag-chip ${active ? 'tag-chip--active' : ''}" data-tag-id="${t.id}" style="--chip-color:${t.color}" onclick="filterByTag(this, '${t.id}')">${t.name}</button>`;
    });
    container.innerHTML = html;
}

function filterByTag(btn, tagId) {
    state.activeTagFilter = tagId;
    document.querySelectorAll('.tag-chip').forEach(b => b.classList.remove('tag-chip--active'));
    btn.classList.add('tag-chip--active');
    renderScrapersList(state.scrapers);
}

function renderScrapersList(scrapers) {
    const list = document.getElementById('scrapers-list');
    let filtered = scrapers;
    if (state.activeTagFilter) {
        filtered = scrapers.filter(s => s.tags && s.tags.some(t => String(t.id) === String(state.activeTagFilter)));
    }

    if (!filtered.length) {
        list.innerHTML = '<div class="empty-state">No scrapers match the current filter.</div>';
        return;
    }

    list.innerHTML = filtered.map(s => {
        const thumbEl = s.thumbnail_url
            ? `<img class="item-thumb" src="${s.thumbnail_url}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'item-thumb-placeholder',textContent:'\ud83c\udf8c'}))" />`
            : `<div class="item-thumb-placeholder">🎌</div>`;

        const tagsHtml = s.tags && s.tags.length
            ? s.tags.map(t => `<span class="tag-pill-sm" style="background:${t.color}22;border-color:${t.color};color:${t.color}">${t.name}</span>`).join('')
            : '';

        const integBadges = s.integrations && s.integrations.length
            ? s.integrations.map(i => `<span class="integ-badge">${integIcon(i.type)} ${i.name}</span>`).join('')
            : '';

        const healthInfo = {
            ok:       { icon: '\u2705', label: 'Healthy',  cls: 'badge-success' },
            failing:  { icon: '\u274c', label: 'Failing',  cls: 'badge-failure' },
            untested: { icon: '\u2699\ufe0f', label: 'Untested', cls: 'badge-pending' },
        }[s.health || 'untested'];

        return `
        <div class="item-card item-card--with-thumb">
          ${thumbEl}
          <div class="item-info">
            <div class="item-name">
              ${s.name} ${s.latest_version ? `<span style="font-size:12px;color:var(--accent);font-weight:500;margin-left:6px;background:var(--accent-glow);padding:2px 6px;border-radius:12px;">v${s.latest_version}</span>` : ''}
              ${s.homepage_url ? `<a href="${s.homepage_url}" target="_blank" rel="noopener" class="btn btn-ghost" style="font-size:12px;padding:2px 6px;margin-left:8px;text-decoration:none">🔗 Visit</a>` : ''}
            </div>
            <div class="item-meta">${s.module_path}</div>
            ${s.description ? `<div class="item-meta" style="color:var(--text-secondary);margin-top:2px">${s.description}</div>` : ''}
            ${tagsHtml ? `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px">${tagsHtml}</div>` : ''}
            ${integBadges ? `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px">${integBadges}</div>` : ''}
          </div>
          <div class="item-actions">
            <div style="display:flex; gap:6px;">
              <span class="status-badge ${healthInfo.cls}" title="Health">${healthInfo.icon} ${healthInfo.label}</span>
              <span class="status-badge ${s.enabled ? 'badge-enabled' : 'badge-disabled'}">${s.enabled ? '\u25cf Active' : '\u25cb Disabled'}</span>
            </div>
            <div class="action-btn-group">
              <button class="icon-btn" onclick="openAssignTagsModal(${s.id})" title="Manage Tags">🏷️</button>
              <button class="icon-btn" onclick="openAssignModal(${s.id})" title="Manage Integrations">🔗</button>
              <button class="icon-btn" onclick="openVersionsModal(${s.id})" title="Version History">🕓${s.version_count ? ` <span class="ver-count-badge">${s.version_count}</span>` : ''}</button>
              <button class="icon-btn" onclick="openEditModal(${s.id})" title="Edit Scraper">✏️</button>
              <button class="icon-btn" onclick="toggleScraper(${s.id})" title="${s.enabled ? 'Disable' : 'Enable'}">${s.enabled ? '⏸️' : '▶️'}</button>
              <button class="icon-btn icon-btn-danger" onclick="deleteScraper(${s.id})" title="Delete">✕</button>
            </div>
            <button class="btn btn-run" onclick="runScraper(${s.id}, this)">⚡ Run</button>
          </div>
        </div>`;
    }).join('');
}

function integIcon(type) {
    return type === 'discord_webhook' ? '💬' : '🔗';
}

function populateScraperSelects(scrapers) {
    const selects = ['sched-scraper', 'log-filter-scraper'];
    selects.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        const val = el.value;
        el.innerHTML = `<option value="">— All —</option>` + scrapers.map(s =>
            `<option value="${s.id}">${s.name}</option>`
        ).join('');
        el.value = val;
    });
    const ss = document.getElementById('sched-scraper');
    if (ss) ss.options[0].text = '— Select scraper —';
}

/* ── Wizard Modal ────────────────────────────────────── */
function openWizardModal() {
    document.getElementById('wizard-form').reset();
    document.getElementById('wiz-thumb-filename').textContent = '';
    previewWizThumb('');
    const codeZone = document.getElementById('wiz-code-zone');
    codeZone.style.borderColor = '';
    document.getElementById('wiz-code-text').textContent = 'Drag & Drop your .py file here';
    document.getElementById('wizard-modal').style.display = 'flex';
}

function closeWizardModal(e) {
    if (e && e.target !== document.getElementById('wizard-modal')) return;
    document.getElementById('wizard-modal').style.display = 'none';
}

function previewWizThumb(url) {
    const img = document.getElementById('wiz-thumb-img');
    const ph  = document.getElementById('wiz-thumb-placeholder');
    const box = document.getElementById('wiz-thumb-preview');
    if (!url.trim()) {
        img.style.display = 'none'; img.src = '';
        ph.style.display = 'inline'; ph.textContent = '🎌';
        box.style.borderColor = ''; return;
    }
    img.onload  = () => { ph.style.display = 'none'; img.style.display = 'block'; box.style.borderColor = 'var(--success)'; };
    img.onerror = () => { img.style.display = 'none'; ph.style.display = 'inline'; ph.textContent = '⚠️'; box.style.borderColor = 'var(--failure)'; };
    ph.textContent = '🎌'; img.src = url;
}

function handleWizThumbFile(input) {
    const file = input.files[0];
    if (file) {
        document.getElementById('wiz-thumb-filename').textContent = file.name;
        document.getElementById('wiz-thumb-url').value = ''; // clear url if file picked
        const reader = new FileReader();
        reader.onload = e => previewWizThumb(e.target.result);
        reader.readAsDataURL(file);
    }
}

function handleWizCodeFile(input) {
    const file = input.files[0];
    if (file) {
        document.getElementById('wiz-code-text').textContent = `📄 ${file.name}`;
        document.getElementById('wiz-code-zone').style.borderColor = 'var(--success)';
        document.getElementById('wiz-code-zone').style.background = 'rgba(34, 197, 94, 0.05)';
    }
}

async function submitWizard(e) {
    e.preventDefault();
    const btn = document.getElementById('wiz-submit-btn');
    btn.disabled = true;
    btn.textContent = '\u23f3 Building\u2026';

    // Build semver label
    const major = document.getElementById('wiz-ver-major').value || '1';
    const minor = document.getElementById('wiz-ver-minor').value || '0';
    const patch = document.getElementById('wiz-ver-patch').value || '0';
    const versionLabel = `${major}.${minor}.${patch}`;
    const commitMsg = document.getElementById('wiz-commit').value.trim() || 'Initial release';

    const formData = new FormData();
    formData.append('name', document.getElementById('wiz-name').value);
    formData.append('description', document.getElementById('wiz-desc').value);
    formData.append('homepage_url', ensureHttps(document.getElementById('wiz-home').value));
    formData.append('thumbnail_url', document.getElementById('wiz-thumb-url').value);
    formData.append('version_label', versionLabel);
    formData.append('commit_message', commitMsg);

    const codeFile = document.getElementById('wiz-code-file').files[0];
    formData.append('scraper_file', codeFile);

    const thumbFile = document.getElementById('wiz-thumb-file').files[0];
    if (thumbFile) formData.append('thumbnail_file', thumbFile);

    try {
        await apiFetch(API.scrapers + '/wizard', {
            method: 'POST',
            body: formData
        });
        toast('Scraper configured and built successfully!', 'success');
        closeWizardModal();
        loadScrapers();
    } catch (err) {
        toast(err.message, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = '\u2728 Build Scraper';
    }
}

async function runScraper(id, btn) {
    btn.disabled = true; btn.textContent = '⚡ Running…';
    try {
        const res = await apiFetch(API.run(id), { method: 'POST' });
        toast(res.detail, 'success');
        setTimeout(() => loadTab('logs'), 2500);
    } catch (e) { toast(e.message, 'error'); }
    finally { btn.disabled = false; btn.textContent = '▶ Run Now'; }
}

async function toggleScraper(id) {
    try {
        const res = await apiFetch(`${API.scrapers}/${id}/toggle`, { method: 'PATCH' });
        toast(`Scraper ${res.enabled ? 'enabled' : 'disabled'}.`, 'info');
        loadScrapers();
    } catch (e) { toast(e.message, 'error'); }
}

async function deleteScraper(id) {
    if (!confirm('Delete this scraper? This will also remove its schedules and logs.')) return;
    try {
        await apiFetch(`${API.scrapers}/${id}`, { method: 'DELETE' });
        toast('Scraper deleted.', 'info');
        loadScrapers();
    } catch (e) { toast(e.message, 'error'); }
}

/* ── Assign Tags Modal ──────────────────────────────── */
function openAssignTagsModal(scraperId) {
    document.getElementById('assign-tags-scraper-id').value = scraperId;
    renderAssignTagsList();
    document.getElementById('assign-tags-modal').style.display = 'flex';
}

function renderAssignTagsList() {
    const scraperId = parseInt(document.getElementById('assign-tags-scraper-id').value);
    const scraper = state.scrapers.find(s => s.id === scraperId);
    if (!scraper) return;
    const assignedIds = new Set((scraper.tags || []).map(t => t.id));
    const container = document.getElementById('assign-tags-list');

    if (!state.tags.length) {
        container.innerHTML = '<span style="color:var(--text-muted)">No tags created yet.</span>';
    } else {
        container.innerHTML = state.tags.map(t => {
            const on = assignedIds.has(t.id);
            const style = on 
                ? `background:${t.color}22; border-color:${t.color}; color:${t.color};` 
                : `background:transparent; border-color:var(--border-strong); color:var(--text-secondary); opacity:0.8;`;
            const check = on ? '✓' : '+';
            return `
            <div class="tag-pill tag-pill-hover" style="cursor:pointer; display:flex; align-items:center; gap:6px; padding:6px 14px; transition:all 0.2s; ${style}" 
                 onclick="toggleTagAssignment(${scraperId}, ${t.id}, ${on})" title="${on ? 'Click to unassign' : 'Click to assign'}">
                <span style="font-weight:700; width:12px; text-align:center;">${check}</span>
                <span style="font-weight:600;">${t.name}</span>
                <span onclick="event.stopPropagation(); deleteTag(${t.id})" class="tag-del-btn" title="Permanently Delete Tag">✕</span>
            </div>`;
        }).join('');
    }
}

function selectCustomColor(hex) {
    document.querySelectorAll('.swatch').forEach(s => s.classList.remove('selected'));
    document.getElementById('new-tag-color').value = hex;
}

async function createTag() {
    const name  = document.getElementById('new-tag-name').value.trim();
    const color = document.getElementById('new-tag-color').value;
    if (!name) { toast('Tag name is required.', 'error'); return; }
    try {
        await apiFetch(API.tags, { method: 'POST', body: JSON.stringify({ name, color }) });
        document.getElementById('new-tag-name').value = '';
        toast('Tag created!', 'success');
        
        // Refresh state
        const [scrapers, tags] = await Promise.all([apiFetch(API.scrapers), apiFetch(API.tags)]);
        state.scrapers = scrapers; state.tags = tags;
        renderTagFilterChips(tags);
        renderScrapersList(scrapers);
        renderAssignTagsList();
    } catch (e) { toast(e.message, 'error'); }
}

async function toggleTagAssignment(scraperId, tagId, isAssigned) {
    try {
        if (isAssigned) {
            await apiFetch(API.scraperTags(scraperId, tagId), { method: 'DELETE' });
        } else {
            await apiFetch(API.scraperTags(scraperId, tagId), { method: 'POST' });
        }
        const scrapers = await apiFetch(API.scrapers);
        state.scrapers = scrapers;
        renderScrapersList(scrapers);
        renderAssignTagsList();
    } catch (e) { toast(e.message, 'error'); }
}

async function deleteTag(id) {
    if (!confirm('Globally delete this tag from all scrapers?')) return;
    try {
        await apiFetch(`${API.tags}/${id}`, { method: 'DELETE' });
        toast('Tag deleted.', 'info');
        
        const [scrapers, tags] = await Promise.all([apiFetch(API.scrapers), apiFetch(API.tags)]);
        state.scrapers = scrapers; state.tags = tags;
        renderTagFilterChips(tags);
        renderScrapersList(scrapers);
        renderAssignTagsList();
    } catch (e) { toast(e.message, 'error'); }
}

function closeAssignTagsModal(e) {
    if (e && e.target !== document.getElementById('assign-tags-modal')) return;
    document.getElementById('assign-tags-modal').style.display = 'none';
}

/* ════════════════════════════════════════════════
   SCHEDULES
════════════════════════════════════════════════ */
async function loadSchedules() {
    try {
        const schedules = await apiFetch(API.schedules);
        document.getElementById('schedule-count').textContent = schedules.length;
        const list = document.getElementById('schedules-list');
        if (!schedules.length) {
            list.innerHTML = '<div class="empty-state">No schedules configured.</div>';
            return;
        }
        list.innerHTML = schedules.map(s => `
        <div class="item-card">
          <div class="item-info">
            <div class="item-name">${s.scraper_name || 'Unknown Scraper'}</div>
            <div class="item-meta"><code style="color:#c4b5fd">${s.cron_expression}</code></div>
          </div>
          <div class="item-actions">
            ${s.next_run ? `<span class="next-run-chip">⏭ ${fmt(s.next_run)}</span>` : ''}
            ${s.last_run ? `<span style="font-size:11px;color:var(--text-muted)">Last: ${fmt(s.last_run)}</span>` : ''}
            <span class="status-badge ${s.enabled ? 'badge-enabled' : 'badge-disabled'}">${s.enabled ? '● On' : '○ Off'}</span>
            <button class="btn btn-ghost" style="font-size:12px;padding:6px 10px" onclick="toggleSchedule(${s.id})">${s.enabled ? 'Pause' : 'Resume'}</button>
            <button class="btn btn-danger" onclick="deleteSchedule(${s.id})">✕</button>
          </div>
        </div>`).join('');
    } catch (e) { toast(e.message, 'error'); }
}

function applyCronPreset(val) { if (val) document.getElementById('sched-cron').value = val; }

async function createSchedule() {
    const scraper_id = document.getElementById('sched-scraper').value;
    const cron       = document.getElementById('sched-cron').value.trim();
    if (!scraper_id) { toast('Please select a scraper.', 'error'); return; }
    if (!cron)       { toast('Please enter a cron expression.', 'error'); return; }
    try {
        const res = await apiFetch(API.schedules, {
            method: 'POST',
            body: JSON.stringify({ scraper_id: parseInt(scraper_id), cron_expression: cron }),
        });
        toast(`Schedule created! Next run: ${fmt(res.next_run)}`, 'success');
        document.getElementById('sched-cron').value = '';
        document.getElementById('sched-preset').value = '';
        loadSchedules();
    } catch (e) { toast(e.message, 'error'); }
}

async function toggleSchedule(id) {
    try {
        const res = await apiFetch(`${API.schedules}/${id}/toggle`, { method: 'PATCH' });
        toast(`Schedule ${res.enabled ? 'resumed' : 'paused'}.`, 'info');
        loadSchedules();
    } catch (e) { toast(e.message, 'error'); }
}

async function deleteSchedule(id) {
    if (!confirm('Remove this schedule?')) return;
    try {
        await apiFetch(`${API.schedules}/${id}`, { method: 'DELETE' });
        toast('Schedule removed.', 'info');
        loadSchedules();
    } catch (e) { toast(e.message, 'error'); }
}

/* ════════════════════════════════════════════════
   LOGS — collapsible card view
════════════════════════════════════════════════ */
function toggleDropdown(e, id) {
    e.stopPropagation();
    const dd = document.getElementById(id);
    const isOpen = dd.classList.contains('open');
    
    // Close other dropdowns
    document.querySelectorAll('.custom-dropdown').forEach(d => d.classList.remove('open'));
    
    // Toggle clicked
    if (!isOpen) {
        dd.classList.add('open');
        const input = dd.querySelector('.dropdown-search input');
        if (input) {
            input.value = ''; // Reset search on open
            filterDropdownConfig(input); // Reset list
            setTimeout(() => input.focus(), 50); // Small delay for animation
        }
    }
}

function renderLogFilters() {
    // Get active item instances
    const aScrap = state.scrapers.find(s => String(s.id) === state.logFilters.scraperId);
    const aTag = state.tags.find(t => String(t.id) === state.logFilters.tagId);
    const statuses = [{ id: '', label: 'All' }, { id: 'success', label: '✅ Success' }, { id: 'failure', label: '❌ Failure' }];
    const aStat = statuses.find(st => st.id === state.logFilters.status);

    // Render summaries WITH clear buttons
    let scrapLabel = `Scraper: <b style="margin-left:4px">${aScrap ? aScrap.name : 'All'}</b>`;
    if (aScrap) scrapLabel += ` <span onclick="setLogFilter('scraperId', ''); event.stopPropagation();" style="margin-left:8px; cursor:pointer;" title="Clear filter">✕</span>`;
    else scrapLabel += `<span style="font-size:10px;margin-left:6px;opacity:0.5">▼</span>`;
    document.getElementById('summary-scraper').innerHTML = scrapLabel;

    let tagLabel = `Tag: <b style="margin-left:4px">${aTag ? aTag.name : 'All'}</b>`;
    if (aTag) tagLabel += ` <span onclick="setLogFilter('tagId', ''); event.stopPropagation();" style="margin-left:8px; cursor:pointer;" title="Clear filter">✕</span>`;
    else tagLabel += `<span style="font-size:10px;margin-left:6px;opacity:0.5">▼</span>`;
    document.getElementById('summary-tag').innerHTML = tagLabel;

    let statLabel = `Status: <b style="margin-left:4px">${aStat && aStat.id ? aStat.label : 'All'}</b>`;
    if (state.logFilters.status) statLabel += ` <span onclick="setLogFilter('status', ''); event.stopPropagation();" style="margin-left:8px; cursor:pointer;" title="Clear filter">✕</span>`;
    else statLabel += `<span style="font-size:10px;margin-left:6px;opacity:0.5">▼</span>`;
    document.getElementById('summary-status').innerHTML = statLabel;

    // Active pill highlights
    document.getElementById('summary-scraper').className = aScrap ? 'tag-chip tag-chip--active' : 'tag-chip';
    document.getElementById('summary-tag').className = aTag ? 'tag-chip tag-chip--active' : 'tag-chip';
    document.getElementById('summary-status').className = state.logFilters.status ? 'tag-chip tag-chip--active' : 'tag-chip';
    
    if (aTag) document.getElementById('summary-tag').style.setProperty('--chip-color', aTag.color);
    else document.getElementById('summary-tag').style.removeProperty('--chip-color');

    // Build Scrapers menu (With Search)
    let sHtml = `
      <div class="dropdown-search">
        <input type="text" placeholder="Search scrapers..." onkeyup="filterDropdownConfig(this)" onclick="event.stopPropagation()" />
      </div>
      <div class="dropdown-scroll-area">
    `;
    (state.scrapers || []).forEach(s => {
        sHtml += `<button class="dropdown-item ${state.logFilters.scraperId === String(s.id) ? 'dropdown-item--active' : ''}" onclick="setLogFilter('scraperId', '${s.id}')">${s.name}</button>`;
    });
    sHtml += `</div>`;
    document.getElementById('log-menu-scrapers').innerHTML = sHtml;

    // Build Tags menu (With Search)
    let tHtml = `
      <div class="dropdown-search">
        <input type="text" placeholder="Search tags..." onkeyup="filterDropdownConfig(this)" onclick="event.stopPropagation()" />
      </div>
      <div class="dropdown-scroll-area">
    `;
    (state.tags || []).forEach(t => {
        tHtml += `<button class="dropdown-item ${state.logFilters.tagId === String(t.id) ? 'dropdown-item--active' : ''}" onclick="setLogFilter('tagId', '${t.id}')">
            <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${t.color}"></span> ${t.name}
        </button>`;
    });
    tHtml += `</div>`;
    document.getElementById('log-menu-tags').innerHTML = tHtml;

    // Build Status menu (No search needed)
    let stHtml = `<div class="dropdown-scroll-area" style="padding-top:4px">`;
    statuses.filter(st => st.id !== '').forEach(st => {
        stHtml += `<button class="dropdown-item ${state.logFilters.status === st.id ? 'dropdown-item--active' : ''}" onclick="setLogFilter('status', '${st.id}')">${st.label}</button>`;
    });
    stHtml += `</div>`;
    document.getElementById('log-menu-statuses').innerHTML = stHtml;
}

function setLogFilter(type, val) {
    state.logFilters[type] = val;
    state.currentLogsPage = 0;
    
    // Close dropdowns
    document.querySelectorAll('.custom-dropdown').forEach(d => d.classList.remove('open'));
    
    renderLogFilters();
    loadLogs();
}

async function loadLogs(page = null) {
    if (page !== null) state.currentLogsPage = page;
    const { scraperId, tagId, status } = state.logFilters;
    const offset = state.currentLogsPage * state.logsPageSize;

    let url = `${API.logs}?limit=${state.logsPageSize}&offset=${offset}`;
    if (scraperId) url += `&scraper_id=${scraperId}`;
    if (tagId)     url += `&tag_id=${tagId}`;
    if (status)    url += `&status=${status}`;

    try {
        const data = await apiFetch(url);
        const container = document.getElementById('logs-list');

        if (!data.items.length) {
            container.innerHTML = '<div class="empty-state">No logs found.</div>';
            document.getElementById('logs-pagination').innerHTML = '';
            return;
        }

        container.innerHTML = data.items.map((log, idx) => {
            const detailsId = `log-details-${log.id}`;
            const hasDetails = log.payload || log.error_msg;
            return `
            <div class="log-card" data-status="${log.status}">
                <div class="log-card-header" ${hasDetails ? `onclick="toggleLogDetails('${detailsId}')"` : ''} style="${hasDetails ? 'cursor:pointer' : ''}">
                    <div class="log-card-left">
                        ${statusBadge(log.status)}
                        <strong>${log.scraper_name || 'N/A'}</strong>
                        <span class="log-epcount">${log.episode_count ? `${log.episode_count} found` : ''}</span>
                    </div>
                    <div class="log-card-right">
                        ${statusBadge(log.triggered_by)}
                        <span class="log-time">${fmt(log.run_at)}</span>
                        ${hasDetails ? `<span class="log-expand-icon" id="icon-${detailsId}">▶</span>` : ''}
                    </div>
                </div>
                ${hasDetails ? `
                <div class="log-details" id="${detailsId}" style="display:none">
                    ${log.error_msg ? `<div class="log-error">❌ ${log.error_msg}</div>` : ''}
                    ${log.payload ? renderPayload(log.payload) : ''}
                </div>` : ''}
            </div>`;
        }).join('');

        // Pagination
        const totalPages = Math.ceil(data.total / state.logsPageSize);
        const pag = document.getElementById('logs-pagination');
        if (totalPages <= 1) { pag.innerHTML = ''; return; }
        let pHTML = '';
        for (let i = 0; i < totalPages; i++) {
            pHTML += `<button class="${i === state.currentLogsPage ? 'active' : ''}" onclick="loadLogs(${i})">${i + 1}</button>`;
        }
        pag.innerHTML = pHTML;
    } catch (e) { toast(e.message, 'error'); }
}

function toggleLogDetails(id) {
    const el   = document.getElementById(id);
    const icon = document.getElementById(`icon-${id}`);
    const open = el.style.display === 'block';
    el.style.display = open ? 'none' : 'block';
    if (icon) icon.textContent = open ? '▶' : '▼';
}

function renderPayload(payload) {
    if (!payload || typeof payload !== 'object') return '';
    const rows = Object.entries(payload)
        .filter(([, v]) => v !== null && v !== undefined && v !== '')
        .map(([k, v]) => {
            const label = k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
            let val = String(v);
            // Auto-link URLs
            if (val.startsWith('http')) val = `<a href="${val}" target="_blank" rel="noopener">${val}</a>`;
            return `<div class="payload-row"><span class="payload-key">${label}</span><span class="payload-val">${val}</span></div>`;
        });
    return `<div class="payload-grid">${rows.join('')}</div>`;
}

/* ════════════════════════════════════════════════
   QUEUE
════════════════════════════════════════════════ */
async function loadQueue() {
    try {
        const tasks = await apiFetch(API.queue);
        const pending = tasks.filter(t => t.status === 'pending' || t.status === 'running').length;
        const badge = document.getElementById('queue-badge');
        badge.textContent = pending;
        badge.style.display = pending ? 'inline-block' : 'none';

        const tbody = document.getElementById('queue-body');
        if (!tasks.length) {
            tbody.innerHTML = '<tr><td colspan="5" class="empty-td">Queue is empty.</td></tr>';
            return;
        }
        tbody.innerHTML = tasks.map(t => `
        <tr>
            <td><strong>${t.scraper_name || 'N/A'}</strong></td>
            <td style="white-space:nowrap">${fmt(t.scheduled_for)}</td>
            <td>${statusBadge(t.status)}</td>
            <td style="color:var(--text-secondary)">${fmt(t.created_at)}</td>
            <td style="color:var(--text-secondary)">${t.processed_at ? fmt(t.processed_at) : '—'}</td>
        </tr>`).join('');
    } catch (e) { toast(e.message, 'error'); }
}

/* ════════════════════════════════════════════════
   INTEGRATIONS
════════════════════════════════════════════════ */
function onIntegTypeChange(type) {
    document.getElementById('integ-discord-fields').style.display = type === 'discord_webhook' ? 'flex' : 'none';
}

async function loadIntegrations() {
    try {
        const integs = await apiFetch(API.integrations);
        state.integrations = integs;
        document.getElementById('integ-count').textContent = integs.length;
        const list = document.getElementById('integrations-list');
        if (!integs.length) {
            list.innerHTML = '<div class="empty-state">No integrations yet.</div>';
            return;
        }
        list.innerHTML = integs.map(i => `
        <div class="item-card">
          <div class="item-info">
            <div class="item-name">${integIcon(i.type)} ${i.name}</div>
            <div class="item-meta" style="font-size:12px;color:var(--text-muted)">${i.type} &nbsp;•&nbsp; Created ${fmt(i.created_at)}</div>
            ${i.type === 'discord_webhook' ? `<div class="item-meta" style="font-size:11px;margin-top:2px;word-break:break-all;color:var(--text-muted)">${(i.config.webhook_url || '').replace(/\/[^/]+$/, '/***')}</div>` : ''}
          </div>
          <div class="item-actions">
            <button class="btn btn-ghost" style="font-size:12px;padding:6px 12px" onclick="testIntegration(${i.id}, this)">🧪 Test</button>
            <button class="btn btn-danger" onclick="deleteIntegration(${i.id})">✕</button>
          </div>
        </div>`).join('');
    } catch (e) { toast(e.message, 'error'); }
}

async function createIntegration() {
    const name = document.getElementById('integ-name').value.trim();
    const type = document.getElementById('integ-type').value;
    if (!name) { toast('Name is required.', 'error'); return; }

    let config = {};
    if (type === 'discord_webhook') {
        const webhook = document.getElementById('integ-webhook-url').value.trim();
        if (!webhook) { toast('Webhook URL is required.', 'error'); return; }
        config = { webhook_url: webhook };
    }

    try {
        await apiFetch(API.integrations, { method: 'POST', body: JSON.stringify({ name, type, config }) });
        toast('Integration created!', 'success');
        document.getElementById('integ-name').value = '';
        document.getElementById('integ-webhook-url').value = '';
        loadIntegrations();
    } catch (e) { toast(e.message, 'error'); }
}

async function testIntegration(id, btn) {
    btn.disabled = true; btn.textContent = '⏳ Testing…';
    try {
        const res = await apiFetch(API.verifyInteg(id), { method: 'POST' });
        toast(res.detail, 'success');
    } catch (e) { toast(e.message, 'error'); }
    finally { btn.disabled = false; btn.textContent = '🧪 Test'; }
}

async function deleteIntegration(id) {
    if (!confirm('Delete this integration? It will be removed from all scrapers.')) return;
    try {
        await apiFetch(`${API.integrations}/${id}`, { method: 'DELETE' });
        toast('Integration deleted.', 'info');
        loadIntegrations();
    } catch (e) { toast(e.message, 'error'); }
}

/* ── Assign Integrations Modal ────────────────────────── */
function openAssignModal(scraperId) {
    document.getElementById('assign-scraper-id').value = scraperId;
    const scraper = state.scrapers.find(s => s.id === scraperId);
    const assignedIds = new Set((scraper?.integrations || []).map(i => i.id));
    const container = document.getElementById('assign-integ-list');

    if (!state.integrations.length) {
        container.innerHTML = '<span style="color:var(--text-muted)">No integrations yet. Create one in the Integrations tab.</span>';
    } else {
        container.innerHTML = state.integrations.map(i => {
            const on = assignedIds.has(i.id);
            return `
            <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border-light)">
                <div>
                    <span style="font-weight:500">${integIcon(i.type)} ${i.name}</span>
                    <span style="font-size:11px;color:var(--text-muted);margin-left:8px">${i.type}</span>
                </div>
                <button class="btn ${on ? 'btn-danger' : 'btn-primary'}" style="font-size:12px;padding:4px 12px"
                    onclick="toggleIntegAssignment(${scraperId}, ${i.id}, ${on}, this)">
                    ${on ? 'Remove' : 'Assign'}
                </button>
            </div>`;
        }).join('');
    }
    document.getElementById('assign-integ-modal').style.display = 'flex';
}

async function toggleIntegAssignment(scraperId, integId, isAssigned, btn) {
    try {
        if (isAssigned) {
            await apiFetch(API.scraperInteg(scraperId, integId), { method: 'DELETE' });
            btn.textContent = 'Assign'; btn.className = 'btn btn-primary';
            btn.setAttribute('onclick', `toggleIntegAssignment(${scraperId}, ${integId}, false, this)`);
        } else {
            await apiFetch(API.scraperInteg(scraperId, integId), { method: 'POST' });
            btn.textContent = 'Remove'; btn.className = 'btn btn-danger';
            btn.setAttribute('onclick', `toggleIntegAssignment(${scraperId}, ${integId}, true, this)`);
        }
        const scrapers = await apiFetch(API.scrapers);
        state.scrapers = scrapers;
        renderScrapersList(scrapers);
    } catch (e) { toast(e.message, 'error'); }
}

function closeAssignModal(e) {
    if (e && e.target !== document.getElementById('assign-integ-modal')) return;
    document.getElementById('assign-integ-modal').style.display = 'none';
}

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
        if (!_allTimezones.length) _allTimezones = timezones; // timezones is now array of objects {id, label}

        const current = settings.timezone || 'UTC';
        document.getElementById('tz-current').textContent = `Current timezone: ${current}`;
        
        const dl = document.getElementById('tz-list');
        if (dl) dl.innerHTML = _allTimezones.map(t => `<option value="${t.id}">${t.label}</option>`).join('');
        document.getElementById('tz-input').value = current;
    } catch (e) { toast(e.message, 'error'); }
}

async function saveTimezone() {
    const val = document.getElementById('tz-input').value.trim();
    if (!val) { toast('Please enter a timezone.', 'error'); return; }
    try {
        await apiFetch(`${API.settings}/timezone`, { method: 'PUT', body: JSON.stringify({ value: val }) });
        toast(`Timezone set to ${val}`, 'success');
        document.getElementById('tz-current').textContent = `Current timezone: ${val}`;
    } catch (e) { toast(e.message, 'error'); }
}

/* ════════════════════════════════════════════════
   EDIT MODAL
════════════════════════════════════════════════ */
function openEditModal(id) {
    const s = state.scrapers.find(x => x.id === id);
    if (!s) return;
    document.getElementById('edit-id').value = id;
    document.getElementById('edit-name').value = s.name;
    document.getElementById('edit-homepage').value = s.homepage_url || '';
    document.getElementById('edit-desc').value = s.description || '';
    document.getElementById('edit-thumb').value = s.thumbnail_url || '';
    document.getElementById('edit-thumb-filename').textContent = '';
    // Reset code zone
    document.getElementById('edit-code-text').textContent = 'Drag & Drop a new .py file here';
    document.getElementById('edit-code-zone').style.borderColor = '';
    document.getElementById('edit-code-zone').style.background = '';
    document.getElementById('edit-code-file').value = '';
    
    // Disable version container initially
    document.getElementById('edit-version-container').style.opacity = '0.4';
    document.getElementById('edit-version-container').style.pointerEvents = 'none';
    
    // Default version fields if we have a previous version, otherwise empty
    let nextPatch = 1;
    let mj = '', mn = '', pt = '';
    if (s.latest_version) {
        let parts = s.latest_version.split('.');
        if(parts.length === 3) {
            mj = parts[0]; mn = parts[1]; pt = parseInt(parts[2]) + 1;
        }
    }
    document.getElementById('edit-ver-major').value = mj;
    document.getElementById('edit-ver-minor').value = mn;
    document.getElementById('edit-ver-patch').value = pt;
    document.getElementById('edit-commit').value = '';

    const img = document.getElementById('edit-thumb-img');
    const ph  = document.getElementById('edit-thumb-placeholder');
    if (s.thumbnail_url) { img.src = s.thumbnail_url; img.style.display = 'block'; ph.style.display = 'none'; }
    else { img.style.display = 'none'; img.src = ''; ph.style.display = 'inline'; ph.textContent = '🎌'; }
    document.getElementById('edit-modal').style.display = 'flex';
}

function closeEditModal(e) {
    if (e && e.target !== document.getElementById('edit-modal')) return;
    document.getElementById('edit-modal').style.display = 'none';
}

function handleEditCodeFile(input) {
    const file = input.files[0];
    if (file) {
        document.getElementById('edit-code-text').textContent = `📄 ${file.name}`;
        document.getElementById('edit-code-zone').style.borderColor = 'var(--success)';
        document.getElementById('edit-code-zone').style.background = 'rgba(34, 197, 94, 0.05)';
        
        // Enable version container
        document.getElementById('edit-version-container').style.opacity = '1';
        document.getElementById('edit-version-container').style.pointerEvents = 'auto';
    } else {
        document.getElementById('edit-code-text').textContent = 'Drag & Drop a new .py file here';
        document.getElementById('edit-code-zone').style.borderColor = '';
        document.getElementById('edit-code-zone').style.background = '';
        
        // Disable version container
        document.getElementById('edit-version-container').style.opacity = '0.4';
        document.getElementById('edit-version-container').style.pointerEvents = 'none';
    }
}

function handleEditThumbFile(input) {
    const file = input.files[0];
    if (file) {
        document.getElementById('edit-thumb-filename').textContent = file.name;
        document.getElementById('edit-thumb').value = '';
        const reader = new FileReader();
        reader.onload = e => previewEditThumb(e.target.result);
        reader.readAsDataURL(file);
    }
}

async function saveEdit() {
    const id   = parseInt(document.getElementById('edit-id').value);
    const name = document.getElementById('edit-name').value.trim();
    if (!name) { toast('Name cannot be empty.', 'error'); return; }

    const btn = document.getElementById('edit-submit-btn');
    btn.disabled = true; btn.textContent = '⏳ Saving…';

    const formData = new FormData();
    formData.append('name', name);
    formData.append('description', document.getElementById('edit-desc').value.trim());
    formData.append('homepage_url', ensureHttps(document.getElementById('edit-homepage').value));
    formData.append('thumbnail_url', document.getElementById('edit-thumb').value.trim());

    const thumbFile = document.getElementById('edit-thumb-file').files[0];
    if (thumbFile) formData.append('thumbnail_file', thumbFile);

    const codeFile = document.getElementById('edit-code-file').files[0];
    if (codeFile) {
        formData.append('scraper_file', codeFile);
        
        // Append version info only if file uploaded
        const major = document.getElementById('edit-ver-major').value || '0';
        const minor = document.getElementById('edit-ver-minor').value || '0';
        const patch = document.getElementById('edit-ver-patch').value || '0';
        formData.append('version_label', `${major}.${minor}.${patch}`);
        formData.append('commit_message', document.getElementById('edit-commit').value.trim() || 'Updated script via UI');
    }

    try {
        await apiFetch(`${API.scrapers}/${id}`, {
            method: 'PATCH',
            body: formData,
        });
        toast('Scraper updated!', 'success');
        document.getElementById('edit-modal').style.display = 'none';
        loadScrapers();
    } catch (e) { toast(e.message, 'error'); }
    finally { btn.disabled = false; btn.textContent = '💾 Save Changes'; }
}

function bumpVersion(type) {
    const mj = document.getElementById('edit-ver-major');
    const mn = document.getElementById('edit-ver-minor');
    const pt = document.getElementById('edit-ver-patch');
    
    let major = parseInt(mj.value) || 0;
    let minor = parseInt(mn.value) || 0;
    let patch = parseInt(pt.value) || 0;
    
    if (type === 'major') {
        major++; minor = 0; patch = 0;
    } else if (type === 'minor') {
        minor++; patch = 0;
    } else if (type === 'patch') {
        patch++;
    }
    mj.value = major; mn.value = minor; pt.value = patch;
}

/* ════════════════════════════════════════════════
   VERSION HISTORY MODAL
════════════════════════════════════════════════ */
async function openVersionsModal(scraperId) {
    document.getElementById('versions-scraper-id').value = scraperId;
    document.getElementById('ver-code-area').style.display = 'none';
    document.getElementById('ver-code-view').textContent = '';
    const list = document.getElementById('versions-list');
    list.innerHTML = '<div style="color:var(--text-muted);font-size:13px">Loading\u2026</div>';
    document.getElementById('versions-modal').style.display = 'flex';
    try {
        const versions = await apiFetch(API.versions(scraperId));
        if (!versions.length) {
            list.innerHTML = '<div style="color:var(--text-muted);font-size:13px">No versions recorded yet.</div>';
            return;
        }
        list.innerHTML = versions.map(v => `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;border-radius:var(--radius-sm);border:1px solid var(--border-light);background:var(--bg-card)">
            <div style="flex:1;min-width:0">
                <span style="font-weight:600;color:var(--accent)">v${v.version_label || '?'}</span>
                <span style="font-size:12px;color:var(--text-muted);margin-left:10px">${fmt(v.created_at)}</span>
                ${v.commit_message ? `<div style="font-size:12px;color:var(--text-secondary);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">💬 ${v.commit_message}</div>` : ''}
            </div>
            <div style="display:flex;gap:6px;margin-left:12px">
                <button class="btn btn-ghost" style="font-size:12px;padding:4px 10px" onclick="viewVersion(${scraperId}, ${v.id}, '${v.version_label || '?'}')">👁 View</button>
                <button class="btn btn-primary" style="font-size:12px;padding:4px 10px" onclick="revertVersion(${scraperId}, ${v.id}, '${v.version_label || '?'}', this)">↩ Revert</button>
            </div>
        </div>`).join('');
    } catch (e) { list.innerHTML = `<div style="color:var(--failure)">${e.message}</div>`; }
}

async function viewVersion(scraperId, versionId, versionLabel) {
    const area  = document.getElementById('ver-code-area');
    const pre   = document.getElementById('ver-code-view');
    const label = document.getElementById('ver-code-label');
    pre.textContent = 'Loading\u2026';
    area.style.display = 'block';
    label.textContent = `v${versionLabel} \u2014 CODE`;
    try {
        const data = await apiFetch(API.versionCode(scraperId, versionId));
        pre.textContent = data.code;
    } catch (e) { pre.textContent = `Error: ${e.message}`; }
}

async function revertVersion(scraperId, versionId, versionLabel, btn) {
    if (!confirm(`Revert to v${versionLabel}? The current code will be snapshotted first.`)) return;
    btn.disabled = true; btn.textContent = '\u23f3';
    try {
        await apiFetch(API.revert(scraperId, versionId), { method: 'POST' });
        toast(`Reverted to v${versionLabel} successfully!`, 'success');
        document.getElementById('versions-modal').style.display = 'none';
        loadScrapers();
    } catch (e) { toast(e.message, 'error'); }
    finally { btn.disabled = false; btn.textContent = '\u21a9 Revert'; }
}

function closeVersionsModal(e) {
    if (e && e.target !== document.getElementById('versions-modal')) return;
    document.getElementById('versions-modal').style.display = 'none';
}

/* ════════════════════════════════════════════════
   REFRESH + INIT
════════════════════════════════════════════════ */
function refreshAll() {
    const activeTab = document.querySelector('.tab-panel.active')?.id.replace('tab-', '');
    if (activeTab) loadTab(activeTab);
    apiFetch(API.queue).then(tasks => {
        const pending = tasks.filter(t => t.status === 'pending' || t.status === 'running').length;
        const badge = document.getElementById('queue-badge');
        badge.textContent = pending;
        badge.style.display = pending ? 'inline-block' : 'none';
    }).catch(() => {});
}

setInterval(refreshAll, 30_000);

/* ── Drag-and-drop for code zones ───────────────────── */
function _setupCodeDropZone(zoneId, inputId, textId) {
    const zone = document.getElementById(zoneId);
    if (!zone) return;
    zone.addEventListener('dragover', e => {
        e.preventDefault();
        zone.style.borderColor = 'var(--accent)';
        zone.style.background  = 'rgba(99,102,241,0.06)';
    });
    zone.addEventListener('dragleave', () => {
        zone.style.borderColor = '';
        zone.style.background  = '';
    });
    zone.addEventListener('drop', e => {
        e.preventDefault();
        zone.style.borderColor = '';
        zone.style.background  = '';
        const file = e.dataTransfer.files[0];
        if (!file) return;
        if (!file.name.endsWith('.py')) { toast('Only .py files allowed.', 'error'); return; }
        // Assign the dropped file to the hidden input via DataTransfer
        const dt = new DataTransfer();
        dt.items.add(file);
        const input = document.getElementById(inputId);
        input.files = dt.files;
        // Update the text label
        const textEl = document.getElementById(textId);
        if (textEl) textEl.textContent = `📄 ${file.name}`;
        zone.style.borderColor = 'var(--success)';
        zone.style.background  = 'rgba(34,197,94,0.05)';
    });
}

window.addEventListener('DOMContentLoaded', () => {
    loadScrapers();
    loadQueue();
    // Pre-load integrations state so assign modal works from the start
    apiFetch(API.integrations).then(i => { state.integrations = i; }).catch(() => {});
    // Wire up drag-and-drop for both code upload zones
    _setupCodeDropZone('wiz-code-zone',  'wiz-code-file',  'wiz-code-text');
    _setupCodeDropZone('edit-code-zone', 'edit-code-file', 'edit-code-text');
});

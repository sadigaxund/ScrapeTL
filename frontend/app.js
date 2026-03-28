/* ════════════════════════════════════════════════
   ScrapeTL — Frontend Logic  v2
   Vanilla JS, no dependencies
════════════════════════════════════════════════ */

const API = {
    scrapers: '/api/scrapers',
    schedules: '/api/schedules',
    logs: '/api/logs',
    queue: '/api/queue',
    run: (id) => `/api/run/${id}`,
    available: '/api/scrapers/available',
    upload: '/api/scrapers/upload',
    tags: '/api/tags',
    scraperTags: (sid, tid) => `/api/scrapers/${sid}/tags/${tid}`,
    scheduleTags: (sid, tid) => `/api/schedules/${sid}/tags/${tid}`,
    integrations: '/api/integrations',
    scraperInteg: (sid, iid) => `/api/scrapers/${sid}/integrations/${iid}`,
    verifyInteg: (id) => `/api/integrations/${id}/verify`,
    settings: '/api/settings',
    timezones: '/api/settings/timezones',
    versions: (sid) => `/api/scrapers/${sid}/versions`,
    versionCode: (sid, vid) => `/api/scrapers/${sid}/versions/${vid}`,
    revert: (sid, vid) => `/api/scrapers/${sid}/revert/${vid}`,
    logDownload: (lid, fmt) => `/api/logs/${lid}/download?format=${fmt}`,
    reorderScrapers: '/api/scrapers/reorder',
    reorderSchedules: '/api/schedules/reorder',
    reorderIntegrations: '/api/integrations/reorder',
};

/* ── State ──────────────────────────────────────────── */
let responseCache = {};
let state = {
    scrapers: [],
    tags: [],
    integrations: [],
    currentLogsPage: 0,
    logsPageSize: 50,
    activeTagFilter: '',          // for scrapers
    activeScheduleTagFilter: '',  // for schedules
    logFilters: {
        scraperId: '',
        tagId: '',
        status: ''
    },
    expandedLogs: new Set(),
    timezone: 'UTC',       // kept in sync with /api/settings
    queueTasks: [],
    queueSort: { col: 'scheduled_for', order: 'asc' }
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
        let msg = err.detail || `HTTP ${res.status}`;
        if (Array.isArray(msg)) {
            // FastAPI validation errors are usually a list of {loc, msg, type}
            msg = msg.map(m => m.msg || JSON.stringify(m)).join(', ');
        } else if (typeof msg === 'object' && msg !== null) {
            msg = msg.msg || msg.detail || JSON.stringify(msg);
        }
        throw new Error(msg);
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
    return d.toLocaleString(undefined, {
        timeZone: state.timezone,
        month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
}

function statusBadge(status) {
    if (!status) return `<span class="status-badge badge-pending">• UNKNOWN</span>`;
    const map = {
        success: ['✅', 'success'],
        failure: ['❌', 'failure'],
        pending: ['⏳', 'pending'],
        running: ['⚡', 'running'],
        done: ['✅', 'done'],
        failed: ['❌', 'failed'],
        manual: ['🖱️', 'manual'],
        catchup: ['⚠️', 'catchup'],
        scheduler: ['🕐', 'scheduler'],
        skipped: ['⏭', 'skipped'],
        scheduled: ['🗓️', 'pending'],
    };
    const [icon, cls] = map[status] || ['•', 'pending'];
    return `<span class="status-badge badge-${cls}">${icon} ${status.toUpperCase()}</span>`;
}

/* ── Drag and Drop Logic ───────────────────────────── */
let _draggedItem = null;

function handleDragStart(e, type, id) {
    _draggedItem = { type, id };
    e.currentTarget.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
}

function handleDragOver(e) {
    e.preventDefault(); // allow drop
    const card = e.currentTarget;
    if (card.classList.contains('dragging')) return;
    card.classList.add('drag-over');
}

function handleDragLeave(e) {
    e.currentTarget.classList.remove('drag-over');
}

function handleDragEnd(e) {
    e.currentTarget.classList.remove('dragging');
    document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
}

async function handleDrop(e, type, targetId) {
    e.preventDefault();
    const card = e.currentTarget;
    card.classList.remove('drag-over');

    if (!_draggedItem || _draggedItem.type !== type) return;
    if (_draggedItem.id === targetId) return;

    let list;
    let apiKey;
    let refreshFn;

    if (type === 'scraper') {
        list = [...state.scrapers];
        apiKey = 'reorderScrapers';
        refreshFn = loadScrapers;
    } else if (type === 'schedule') {
        list = [...state.schedules];
        apiKey = 'reorderSchedules';
        refreshFn = loadSchedules;
    } else if (type === 'integration') {
        list = [...state.integrations];
        apiKey = 'reorderIntegrations';
        refreshFn = loadIntegrations;
    } else return;

    const fromIdx = list.findIndex(item => item.id === _draggedItem.id);
    const toIdx = list.findIndex(item => item.id === targetId);

    if (fromIdx === -1 || toIdx === -1) return;

    // Splice move
    const [moved] = list.splice(fromIdx, 1);
    list.splice(toIdx, 0, moved);

    try {
        await apiFetch(API[apiKey], {
            method: 'POST',
            body: JSON.stringify(list.map(item => item.id))
        });
        toast('Order updated', 'success');
        if (type === 'scraper') state.scrapers = list;
        else if (type === 'schedule') state.schedules = list;
        else if (type === 'integration') state.integrations = list;
        
        Object.keys(responseCache).forEach(k => { if(k.startsWith(type) || k.startsWith('integrations')) responseCache[k] = null; });
        refreshFn(type === 'schedule' ? true : undefined);
    } catch (e) {
        toast(e.message, 'error');
    }
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
    const ph = document.getElementById('thumb-preview-placeholder');
    const box = document.getElementById('thumb-preview');
    if (!url.trim()) {
        img.style.display = 'none'; img.src = '';
        ph.style.display = 'inline'; ph.textContent = '🎌';
        box.style.borderColor = ''; return;
    }
    img.onload = () => { ph.style.display = 'none'; img.style.display = 'block'; box.style.borderColor = 'var(--success)'; };
    img.onerror = () => { img.style.display = 'none'; ph.style.display = 'inline'; ph.textContent = '⚠️'; box.style.borderColor = 'var(--failure)'; };
    ph.textContent = '🎌'; img.src = url;
}

function previewEditThumb(url) {
    const img = document.getElementById('edit-thumb-img');
    const ph = document.getElementById('edit-thumb-placeholder');
    const box = document.getElementById('edit-thumb-preview');
    if (!url || !url.trim()) { img.style.display = 'none'; img.src = ''; ph.style.display = 'inline'; ph.textContent = '🎌'; if (box) box.style.borderColor = ''; return; }
    img.onload = () => { ph.style.display = 'none'; img.style.display = 'block'; if (box) box.style.borderColor = 'var(--success)'; };
    img.onerror = () => { img.style.display = 'none'; ph.style.display = 'inline'; ph.textContent = '⚠️'; if (box) box.style.borderColor = 'var(--failure)'; };
    img.src = url;
}

function previewWizThumb(url) {
    const img = document.getElementById('wiz-thumb-img');
    const ph = document.getElementById('wiz-thumb-placeholder');
    const box = document.getElementById('wiz-thumb-preview');
    if (!url || !url.trim()) {
        img.style.display = 'none'; img.src = '';
        ph.style.display = 'inline'; ph.textContent = '🎌';
        if (box) box.style.borderColor = ''; return;
    }
    img.onload = () => { ph.style.display = 'none'; img.style.display = 'block'; if (box) box.style.borderColor = 'var(--success)'; };
    img.onerror = () => { img.style.display = 'none'; ph.style.display = 'inline'; ph.textContent = '⚠️'; if (box) box.style.borderColor = 'var(--failure)'; };
    img.src = url;
}

/* ── Tab Navigation ─────────────────────────────────── */
const TAB_META = {
    scrapers: { title: 'Scrapers', subtitle: 'Manage your scraper plugins' },
    schedules: { title: 'Schedules', subtitle: 'Configure cron-based scrape schedules' },
    logs: { title: 'Logs', subtitle: 'Full history of all scrape runs' },
    queue: { title: 'Queue', subtitle: 'Catch-up tasks for missed scheduled runs' },
    integrations: { title: 'Integrations', subtitle: 'Manage notification integrations' },
    settings: { title: 'Settings', subtitle: 'App-wide configuration' },
};

function switchTab(name) {
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    document.querySelector(`[data-tab="${name}"]`).classList.add('active');
    document.getElementById(`tab-${name}`).classList.add('active');
    document.getElementById('page-title').textContent = TAB_META[name].title;
    document.getElementById('page-subtitle').textContent = TAB_META[name].subtitle;

    const addBtn = document.getElementById('main-add-btn');
    if (name === 'scrapers') { addBtn.style.display = 'inline-block'; }
    else { addBtn.style.display = 'none'; }
}

document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
        const tab = btn.getAttribute('data-tab');
        switchTab(tab);
        loadTab(tab);
    });
});

function loadTab(tab) {
    if (tab === 'scrapers') loadScrapers();
    if (tab === 'schedules') loadSchedules();
    if (tab === 'logs') loadLogs();
    if (tab === 'queue') loadQueue();
    if (tab === 'integrations') loadIntegrations();
    if (tab === 'settings') loadSettings();
}

/* ════════════════════════════════════════════════
   SCRAPERS
════════════════════════════════════════════════ */
async function loadScrapers() {
    const [scrapers, tags] = await Promise.all([
        apiFetch(API.scrapers),
        apiFetch(API.tags).catch(() => []),
    ]);

    const cacheKey = 'scrapers_' + state.activeTagFilter;
    const dataHash = JSON.stringify({ scrapers, tags, activeFilter: state.activeTagFilter });
    if (responseCache[cacheKey] === dataHash) return;
    responseCache[cacheKey] = dataHash;

    state.scrapers = scrapers;
    state.tags = tags;
    document.getElementById('scraper-count').textContent = scrapers.length;

    // Render tag filter chips
    renderTagFilterChips(tags);
    renderScheduleTagFilterChips(tags);

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
    document.querySelectorAll('#tab-scrapers .tag-chip').forEach(b => b.classList.remove('tag-chip--active'));
    btn.classList.add('tag-chip--active');
    renderScrapersList(state.scrapers);
}

function renderScheduleTagFilterChips(tags) {
    const container = document.getElementById('schedule-tag-filter-chips');
    if (!container) return;
    let html = `<button class="tag-chip ${!state.activeScheduleTagFilter ? 'tag-chip--active' : ''}" data-tag-id="" onclick="filterSchedulesByTag(this, '')">All</button>`;
    tags.forEach(t => {
        const active = String(state.activeScheduleTagFilter) === String(t.id);
        html += `<button class="tag-chip ${active ? 'tag-chip--active' : ''}" data-tag-id="${t.id}" style="--chip-color:${t.color}" onclick="filterSchedulesByTag(this, '${t.id}')">${t.name}</button>`;
    });
    container.innerHTML = html;
}

function filterSchedulesByTag(btn, tagId) {
    state.activeScheduleTagFilter = tagId;
    document.querySelectorAll('#tab-schedules .tag-chip').forEach(b => b.classList.remove('tag-chip--active'));
    btn.classList.add('tag-chip--active');
    loadSchedules(true); // pass true to skip re-fetching
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
            ? s.tags.map(t => `<span class="tag-pill-sm"><span class="tag-color-dot" style="background-color:${t.color || '#fff'}"></span>${t.name}</span>`).join('')
            : '';

        const integBadges = s.integrations && s.integrations.length
            ? s.integrations.map(i => `<span class="integ-badge">${integIcon(i.type)} ${i.name}</span>`).join('')
            : '';

        const healthInfo = {
            ok: { icon: '\u2705', label: 'Healthy', cls: 'badge-success' },
            failing: { icon: '\u274c', label: 'Failing', cls: 'badge-failure' },
            untested: { icon: '\u2699\ufe0f', label: 'Untested', cls: 'badge-pending' },
        }[s.health || 'untested'];

        return `
        <div class="item-card item-card--with-thumb" draggable="true"
             ondragstart="handleDragStart(event, 'scraper', ${s.id})"
             ondragover="handleDragOver(event)"
             ondragleave="handleDragLeave(event)"
             ondrop="handleDrop(event, 'scraper', ${s.id})"
             ondragend="handleDragEnd(event)">
          <div class="drag-handle" title="Drag to reorder">⠿</div>
          ${thumbEl}
          <div class="item-info">
            <div class="item-name">
              ${s.name} ${s.latest_version ? `<span style="font-size:12px;color:var(--accent);font-weight:500;margin-left:6px;background:var(--accent-glow);padding:2px 6px;border-radius:12px;">v${s.latest_version}</span>` : ''}
              ${s.homepage_url ? `<a href="${s.homepage_url}" target="_blank" rel="noopener" class="btn btn-ghost" style="font-size:12px;padding:2px 6px;margin-left:8px;text-decoration:none">🔗 Visit</a>` : ''}
            </div>
            ${s.description ? `<div class="item-meta" style="color:var(--text-secondary);margin-top:2px">${s.description}</div>` : ''}
            
            <div class="item-meta-group">
              <span class="status-badge ${healthInfo.cls}" title="Health">${healthInfo.icon} ${healthInfo.label}</span>
              <span class="status-badge ${s.enabled ? 'badge-enabled' : 'badge-disabled'}">${s.enabled ? '\u25cf Active' : '\u25cb Disabled'}</span>
              ${tagsHtml ? `<div style="display:flex;flex-wrap:wrap;gap:4px;">${tagsHtml}</div>` : ''}
              ${integBadges ? `<div style="display:flex;flex-wrap:wrap;gap:4px;">${integBadges}</div>` : ''}
            </div>
          </div>
          <div class="item-actions">
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
    if (type === 'discord_webhook') return '<img src="/static/discord.svg" style="width:16px;height:16px;vertical-align:middle;margin-right:2px">';
    if (type === 'http_request') return '🌐';
    return '🔗';
}

function populateScraperSelects(scrapers) {
    let schedHtml = `<div class="dropdown-scroll-area">`;
    scrapers.forEach(s => {
        const escapedName = s.name.replace(/'/g, "\\'").replace(/"/g, "&quot;");
        schedHtml += `<button class="dropdown-item" onclick="selectSchedScraper('${s.id}', '${escapedName}')">${s.name}</button>`;
    });
    schedHtml += `</div>`;
    const sm = document.getElementById('sched-menu-scrapers');
    if (sm) sm.innerHTML = schedHtml;
}

function selectSchedScraper(id, name) {
    document.getElementById('sched-scraper').value = id;
    document.getElementById('summary-sched-scraper').innerHTML = `<span>${name}</span> <span style="font-size:10px;opacity:0.5">▼</span>`;
    document.querySelectorAll('.custom-dropdown').forEach(d => d.classList.remove('open'));

    // Update thumbnail preview (Inheritance)
    const scraper = (state.scrapers || []).find(s => String(s.id) === String(id));
    if (scraper && scraper.thumbnail_url) {
        previewSchedThumb(scraper.thumbnail_url);
    } else {
        previewSchedThumb('');
    }

    // Render parameters in the left column dashboard area
    renderNewSchedParams(id);
}

function renderNewSchedParams(scraperId) {
    const scraper = (state.scrapers || []).find(s => String(s.id) === String(scraperId));
    const container = document.getElementById('sched-params-container');
    if (!container) return;

    if (!scraper || !scraper.inputs || !scraper.inputs.length) {
        container.innerHTML = '<div class="empty-state" style="padding:40px 0; opacity:0.3; font-size:13px">No input parameters for this scraper.</div>';
        return;
    }

    container.innerHTML = scraper.inputs.map(inp => {
        const id = `new-sched-ri-${inp.name}`;
        const def = inp.default !== undefined ? inp.default : '';
        const desc = inp.description ? `<p class="input-desc" style="font-size:10px; opacity:0.6; margin-top:4px">${inp.description}</p>` : '';
        let field = '';
        if (inp.type === 'select' && inp.options) {
            const opts = inp.options.map(o =>
                `<option value="${o}" ${String(o) === String(def) ? 'selected' : ''}>${o}</option>`
            ).join('');
            field = `<select id="${id}" class="form-control" style="background:var(--bg-input); color:var(--text-primary); border:1px solid var(--border); border-radius:var(--radius-sm); padding:8px; width:100%; font-size:13px">${opts}</select>`;
        } else if (inp.type === 'boolean') {
            field = `<label style="display:flex;align-items:center;gap:8px;cursor:pointer">
                <input type="checkbox" id="${id}" ${def ? 'checked' : ''} style="width:16px;height:16px">
                <span style="font-size:13px">${inp.label || inp.name}</span>
            </label>`;
        } else {
            const t = inp.type === 'number' ? 'number' : 'text';
            field = `<input type="${t}" id="${id}" class="form-control" value="${def}" placeholder="${inp.label || inp.name}" style="background:var(--bg-input); color:var(--text-primary); border:1px solid var(--border); border-radius:var(--radius-sm); padding:8px; width:100%; font-size:13px">`;
        }
        const lbl = inp.type !== 'boolean'
            ? `<label style="font-size:11px; margin-bottom:4px; display:block; opacity:0.7">${inp.label || inp.name}</label>` : '';
        return `<div class="form-group" style="margin-bottom:12px">${lbl}${field}${desc}</div>`;
    }).join('');
}

/* ── Wizard Modal ────────────────────────────────────── */
/* ── Wizard (Add Scraper) ────────────────────────────── */
async function submitWizard(e) {
    if (e) e.preventDefault();
    const btn = document.getElementById('wiz-submit-btn');
    btn.disabled = true;
    btn.textContent = '⏳ Building…';

    const formData = new FormData();
    formData.append('name', document.getElementById('wiz-name').value);
    formData.append('description', document.getElementById('wiz-desc').value);
    formData.append('homepage_url', ensureHttps(document.getElementById('wiz-home').value));
    formData.append('thumbnail_url', document.getElementById('wiz-thumb-url').value);
    formData.append('version_label', '0.0.0');
    formData.append('commit_message', document.getElementById('wiz-commit').value.trim() || 'Initial version');

    const codeFile = document.getElementById('wiz-code-file').files[0];
    if (!codeFile) {
        toast('Scraper script (.py) is required.', 'error');
        btn.disabled = false; btn.textContent = '✨ Build Scraper';
        return;
    }
    formData.append('scraper_file', codeFile);
    
    const thumbFile = document.getElementById('wiz-thumb-file').files[0];
    if (thumbFile) formData.append('thumbnail_file', thumbFile);

    try {
        await apiFetch(API.scrapers + '/wizard', { method: 'POST', body: formData });
        toast('Scraper configured and built successfully!', 'success');
        
        // Reset form
        document.getElementById('wizard-form').reset();
        document.getElementById('wiz-code-text').textContent = 'Click or Drag .py file here';
        const codeZone = document.getElementById('wiz-code-zone');
        codeZone.style.borderColor = ''; codeZone.style.background = '';
        
        const img = document.getElementById('wiz-thumb-img');
        img.src = ''; img.style.display = 'none';
        document.getElementById('wiz-thumb-placeholder').style.display = 'flex';
        
        loadScrapers();
    } catch (err) { toast(err.message, 'error'); }
    finally { btn.disabled = false; btn.textContent = '✨ Build Scraper'; }
}

function handleWizCodeFile(input) {
    const file = input.files[0];
    const textEl = document.getElementById('wiz-code-text');
    const zoneEl = document.getElementById('wiz-code-zone');
    if (file) {
        if (textEl) textEl.textContent = `📄 ${file.name}`;
        if (zoneEl) {
            zoneEl.style.borderColor = 'var(--success)';
            zoneEl.style.background = 'rgba(34, 197, 94, 0.05)';
        }
    } else {
        if (textEl) textEl.textContent = "Drag & Drop your .py file here";
        if (zoneEl) {
            zoneEl.style.borderColor = '';
            zoneEl.style.background = '';
        }
    }
}

function handleWizThumbFile(input) {
    const file = input.files[0];
    const filenameEl = document.getElementById('wiz-thumb-filename');
    const urlEl = document.getElementById('wiz-thumb-url');
    if (file) {
        if (filenameEl) filenameEl.textContent = file.name;
        if (urlEl) urlEl.value = ''; // Direct file upload clears URL input
        const reader = new FileReader();
        reader.onload = e => previewWizThumb(e.target.result);
        reader.readAsDataURL(file);
    }
}

async function runScraper(id, btn) {
    const scraper = state.scrapers.find(s => s.id === id);
    const inputs = (scraper && scraper.inputs) ? scraper.inputs : [];

    if (inputs.length > 0) {
        // Show inputs modal; it will call _doRunScraper on submit
        openRunInputsModal(id, inputs, btn);
    } else {
        await _doRunScraper(id, {}, btn);
    }
}

async function _doRunScraper(id, inputValues, btn) {
    if (btn) { btn.disabled = true; btn.textContent = '⚡ Running…'; }
    try {
        const res = await apiFetch(API.run(id), {
            method: 'POST',
            body: JSON.stringify({ input_values: inputValues }),
        });
        toast(res.detail, 'success');
        setTimeout(() => loadTab('logs'), 2500);
    } catch (e) { toast(e.message, 'error'); }
    finally { if (btn) { btn.disabled = false; btn.textContent = '▶ Run Now'; } }
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
function openAssignTagsModal(targetId, type = 'scraper') {
    document.getElementById('assign-tags-target-id').value = targetId;
    document.getElementById('assign-tags-target-type').value = type;
    document.getElementById('assign-tags-title').textContent = type === 'scraper' ? '🏷️ Assign Tags to Scraper' : '🏷️ Assign Tags to Schedule';
    renderAssignTagsList();
    document.getElementById('assign-tags-modal').style.display = 'flex';
}

function renderAssignTagsList() {
    const targetId = parseInt(document.getElementById('assign-tags-target-id').value);
    const type = document.getElementById('assign-tags-target-type').value;

    let target;
    if (type === 'scraper') {
        target = state.scrapers.find(s => s.id === targetId);
    } else {
        target = state.schedules.find(s => s.id === targetId);
    }

    if (!target) return;
    const assignedIds = new Set((target.tags || []).map(t => t.id));
    const container = document.getElementById('assign-tags-list');

    if (!state.tags.length) {
        container.innerHTML = '<span style="color:var(--text-muted)">No tags created yet.</span>';
    } else {
        container.innerHTML = state.tags.map(t => {
            const on = assignedIds.has(t.id);
            const style = on
                ? `background:var(--bg-card-hover); border-color:var(--border-strong); color:var(--text-primary);`
                : `background:transparent; border-color:var(--border); color:var(--text-secondary); opacity:0.7;`;
            const check = on ? '✓' : '+';
            return `
            <div class="tag-pill tag-pill-hover" style="cursor:pointer; display:flex; align-items:center; gap:6px; padding:6px 14px; transition:all 0.2s; ${style}" 
                 onclick="toggleTagAssignment(${targetId}, ${t.id}, ${on}, '${type}')" title="${on ? 'Click to unassign' : 'Click to assign'}">
                <span class="tag-color-dot" style="background-color:${t.color || '#fff'}"></span>
                <span style="font-weight:700; width:12px; text-align:center; color:${on ? 'var(--success)' : 'var(--text-muted)'}">${check}</span>
                <span style="font-weight:600;">${t.name}</span>
                <span onclick="event.stopPropagation(); deleteTag(${t.id})" class="tag-del-btn" title="Permanently Delete Tag">✕</span>
            </div>`;
        }).join('');
    }
}

function selectSwatch(el) {
    document.querySelectorAll('.swatch').forEach(s => s.classList.remove('selected'));
    el.classList.add('selected');
    document.getElementById('new-tag-color').value = el.dataset.color;
    document.getElementById('new-tag-color-hex').value = '';
    document.getElementById('hex-preview').style.background = 'transparent';
}

function handleHexInput(val) {
    document.querySelectorAll('.swatch').forEach(s => s.classList.remove('selected'));
    if (val.startsWith('#') && (val.length === 4 || val.length === 7)) {
        document.getElementById('new-tag-color').value = val;
        document.getElementById('hex-preview').style.background = val;
    }
}

async function createTag() {
    const name = document.getElementById('new-tag-name').value.trim();
    const color = document.getElementById('new-tag-color').value;
    if (!name) { toast('Tag name is required.', 'error'); return; }
    try {
        await apiFetch(API.tags, { method: 'POST', body: JSON.stringify({ name, color }) });
        document.getElementById('new-tag-name').value = '';
        toast('Tag created!', 'success');

        // Refresh state
        const [scrapers, tags, schedules] = await Promise.all([
            apiFetch(API.scrapers),
            apiFetch(API.tags),
            apiFetch(API.schedules)
        ]);
        state.scrapers = scrapers; state.tags = tags; state.schedules = schedules;
        renderTagFilterChips(tags);
        renderScheduleTagFilterChips(tags);
        renderScrapersList(scrapers);
        loadSchedules(true);
        renderAssignTagsList();
    } catch (e) { toast(e.message, 'error'); }
}

async function toggleTagAssignment(targetId, tagId, isAssigned, type = 'scraper') {
    try {
        const url = type === 'scraper' ? API.scraperTags(targetId, tagId) : API.scheduleTags(targetId, tagId);
        if (isAssigned) {
            await apiFetch(url, { method: 'DELETE' });
        } else {
            await apiFetch(url, { method: 'POST' });
        }
        
        // Refresh everything to be safe
        const [scrapers, schedules] = await Promise.all([
            apiFetch(API.scrapers),
            apiFetch(API.schedules)
        ]);
        state.scrapers = scrapers;
        state.schedules = schedules;
        renderScrapersList(scrapers);
        loadSchedules(true);
        renderAssignTagsList();
    } catch (e) { toast(e.message, 'error'); }
}

async function deleteTag(id) {
    if (!confirm('Globally delete this tag from all scrapers and schedules?')) return;
    try {
        await apiFetch(`${API.tags}/${id}`, { method: 'DELETE' });
        toast('Tag deleted.', 'info');

        const [scrapers, tags, schedules] = await Promise.all([
            apiFetch(API.scrapers),
            apiFetch(API.tags),
            apiFetch(API.schedules)
        ]);
        state.scrapers = scrapers; state.tags = tags; state.schedules = schedules;
        renderTagFilterChips(tags);
        renderScheduleTagFilterChips(tags);
        renderScrapersList(scrapers);
        loadSchedules(true);
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
async function loadSchedules(skipFetch = false) {
    try {
        let schedules = state.schedules;
        if (!skipFetch || !schedules || schedules.length === 0) {
            schedules = await apiFetch(API.schedules);
            state.schedules = schedules;
        }

        let filtered = schedules;
        if (state.activeScheduleTagFilter) {
            filtered = schedules.filter(s => {
                const hasTag = s.tags && s.tags.some(t => String(t.id) === String(state.activeScheduleTagFilter));
                return hasTag;
            });
        }

        const dataHash = JSON.stringify({ filtered, tags: state.tags, activeFilter: state.activeScheduleTagFilter });
        if (responseCache['schedules_rendered'] === dataHash) return;
        responseCache['schedules_rendered'] = dataHash;

        console.log(`[Schedules] Rendering ${filtered.length}/${schedules.length} items (Filter: ${state.activeScheduleTagFilter || 'None'})`);



        document.getElementById('schedule-count').textContent = filtered.length;
        const list = document.getElementById('schedules-list');
        if (!filtered.length) {
            list.innerHTML = `<div class="empty-state">${state.activeScheduleTagFilter ? 'No schedules match the current tag filter.' : 'No schedules configured.'}</div>`;
            return;
        }
        list.innerHTML = filtered.map(s => {
            const displayName = s.label || s.scraper_name || 'Unnamed Schedule';
            const subtitle = s.label ? s.scraper_name : null;
            const thumb = s.thumbnail_url
                ? `<img src="${s.thumbnail_url}" class="sched-thumb" alt="">`
                : `<div class="sched-thumb sched-thumb--placeholder">📡</div>`;
            
            const tagsHtml = s.tags && s.tags.length
                ? s.tags.map(t => `<span class="tag-pill-sm"><span class="tag-color-dot" style="background-color:${t.color || '#fff'}"></span>${t.name}</span>`).join('')
                : '';

            const inputs = s.input_values && Object.keys(s.input_values).length
                ? Object.entries(s.input_values).map(([k,v]) =>
                    `<span class="sched-param"><b>${k}</b>: ${v}</span>`
                  ).join('')
                : null;
            return `
            <div class="sched-card" draggable="true"
                 ondragstart="handleDragStart(event, 'schedule', ${s.id})"
                 ondragover="handleDragOver(event)"
                 ondragleave="handleDragLeave(event)"
                 ondrop="handleDrop(event, 'schedule', ${s.id})"
                 ondragend="handleDragEnd(event)"
                 onclick="toggleSchedExpand(event, ${s.id})">
              <div class="sched-card__main">
                <div class="drag-handle" title="Drag to reorder">⠿</div>
                ${thumb}
                <div class="sched-card__info">
                  <div class="sched-card__name">${displayName}</div>
                  ${subtitle ? `<div class="sched-card__subtitle">${subtitle}</div>` : ''}
                  <div class="sched-card__meta">
                    <span class="status-badge ${s.enabled ? 'badge-enabled' : 'badge-disabled'}" style="margin-right:8px; vertical-align:middle;">${s.enabled ? '\u25cf Active' : '\u25cb Disabled'}</span>
                    <code style="color:#c4b5fd;font-size:11px;vertical-align:middle;">${s.cron_expression}</code>
                    ${tagsHtml ? `<div style="display:inline-flex;flex-wrap:wrap;gap:4px;margin-left:8px;vertical-align:middle;">${tagsHtml}</div>` : ''}
                  </div>
                </div>
                <div class="sched-card__last-col">
                  ${s.last_run ? `<span class="sched-badge sched-badge--last">🕒 Last: ${fmt(s.last_run)}</span>` : ''}
                </div>
                <div class="sched-card__next-col">
                  ${s.next_run ? `<span class="sched-badge sched-badge--next">⏭ Next: ${fmt(s.next_run)}</span>` : '<span class="sched-badge sched-badge--none">Next: Not scheduled</span>'}
                </div>
                <div class="sched-card__actions" onclick="event.stopPropagation()">
                  <div class="action-btn-group">
                    <button class="icon-btn" onclick="openAssignTagsModal(${s.id}, 'schedule')" title="Manage Tags">🏷️</button>
                    <button class="icon-btn" onclick="openEditScheduleModal(${s.id})" title="Edit Schedule">✏️</button>
                    <button class="icon-btn" onclick="toggleSchedule(${s.id})" title="${s.enabled ? 'Disable' : 'Enable'}">${s.enabled ? '⏸️' : '▶️'}</button>
                    <button class="icon-btn icon-btn-danger" onclick="deleteSchedule(${s.id})" title="Delete">✕</button>
                  </div>
                </div>
              </div>
              ${inputs ? `<div class="sched-card__expand" id="sched-expand-${s.id}">
                <div class="sched-inputs-title">⚙ Scheduled Inputs</div>
                <div class="sched-inputs-grid">${inputs}</div>
              </div>` : ''}
            </div>`;
        }).join('');
    } catch (e) { toast(e.message, 'error'); }
}

function previewSchedThumb(url) {
    const img = document.getElementById('sched-thumb-img');
    const placeholder = document.getElementById('sched-thumb-placeholder');
    if (!img || !placeholder) return;
    if (url && url.trim().length > 0) {
        img.src = url;
        img.style.display = 'block';
        placeholder.style.display = 'none';
    } else {
        img.style.display = 'none';
        placeholder.style.display = 'flex';
    }
}

function handleSchedThumbFile(input) {
    const file = input.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = document.getElementById('sched-thumb-img');
            const placeholder = document.getElementById('sched-thumb-placeholder');
            if (img && placeholder) {
                img.src = e.target.result;
                img.style.display = 'block';
                placeholder.style.display = 'none';
            }
        };
        reader.readAsDataURL(file);
    }
}

function applyCronPreset(val, label = null, inputId = 'sched-cron', summaryId = 'summary-sched-preset') {
    const input = document.getElementById(inputId);
    const summary = document.getElementById(summaryId);
    if (input && val !== null) input.value = val;
    if (summary && label) summary.innerHTML = `<span>${label}</span> <span style="font-size:10px;opacity:0.5">▼</span>`;
}

async function createSchedule() {
    const scraper_id = document.getElementById('sched-scraper').value;
    const cron = document.getElementById('sched-cron').value.trim();
    const label = document.getElementById('sched-label').value.trim();
    if (!scraper_id) { toast('Please select a scraper.', 'error'); return; }
    if (!cron) { toast('Please enter a cron expression.', 'error'); return; }

    const scraper = state.scrapers.find(s => String(s.id) === String(scraper_id));
    
    // Collect input values from the dashboard area
    const inputValues = {};
    if (scraper && scraper.inputs) {
        scraper.inputs.forEach(inp => {
            const el = document.getElementById(`new-sched-ri-${inp.name}`);
            if (!el) return;
            if (el.type === 'checkbox') inputValues[inp.name] = el.checked;
            else if (el.type === 'number') inputValues[inp.name] = el.value !== '' ? Number(el.value) : null;
            else inputValues[inp.name] = el.value;
        });
    }

    try {
        const formData = new FormData();
        formData.append('scraper_id', scraper_id);
        formData.append('cron_expression', cron);
        formData.append('input_values', Object.keys(inputValues).length ? JSON.stringify(inputValues) : '');
        formData.append('label', label || '');

        // Handle Thumbnail (Overrides or implicitly let backend inherit)
        const customUrl = document.getElementById('sched-thumb-url').value.trim();
        const customFile = document.getElementById('sched-thumb-file').files[0];

        if (customUrl) {
            formData.append('thumbnail_url', customUrl);
        }
        if (customFile) {
            formData.append('thumbnail_file', customFile);
        }

        const res = await apiFetch(API.schedules, { method: 'POST', body: formData });
        toast(`Schedule created! Next run: ${fmt(res.next_run)}`, 'success');
        
        // Reset form
        document.getElementById('sched-cron').value = '';
        document.getElementById('sched-label').value = '';
        document.getElementById('sched-scraper').value = '';
        document.getElementById('summary-sched-scraper').innerHTML = `<span>— Select —</span> <span style="font-size:10px;opacity:0.5">▼</span>`;
        document.getElementById('summary-sched-preset').innerHTML = `<span>Presets</span> <span style="font-size:10px; opacity:0.5">▼</span>`;
        document.getElementById('sched-thumb-url').value = '';
        document.getElementById('sched-thumb-file').value = '';
        document.getElementById('sched-params-container').innerHTML = '<div class="empty-state" style="padding:40px 0; opacity:0.3; font-size:13px">Select a scraper to view available parameters.</div>';
        previewSchedThumb('');
        
        loadSchedules();
    } catch (e) { toast(e.message, 'error'); }
}

function toggleSchedExpand(event, id) {
    // Don't toggle if clicking on action buttons
    if (event.target.closest('.sched-card__actions')) return;
    const el = document.getElementById(`sched-expand-${id}`);
    if (!el) return;
    el.classList.toggle('open');
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

let currentEditSchedInputs = null;

function openEditScheduleModal(id) {
    const s = state.schedules.find(x => x.id === id);
    if (!s) return;

    document.getElementById('edit-sched-id').value = s.id;
    document.getElementById('edit-sched-scraper-id').value = s.scraper_id;
    document.getElementById('edit-sched-label').value = s.label || '';
    document.getElementById('edit-sched-cron').value = s.cron_expression;
    document.getElementById('edit-sched-thumb-url').value = s.custom_thumbnail_url || '';
    document.getElementById('edit-sched-thumb-file').value = '';
    document.getElementById('edit-sched-thumb-filename').textContent = '';
    
    currentEditSchedInputs = s.input_values || {};
    previewEditSchedThumb(s.thumbnail_url);

    const scraper = state.scrapers.find(scr => scr.id === s.scraper_id);
    renderEditSchedParams(scraper ? scraper.inputs : [], currentEditSchedInputs);

    document.getElementById('edit-schedule-modal').style.display = 'flex';
}

function renderEditSchedParams(inputs, values) {
    const container = document.getElementById('edit-sched-params-container');
    if (!inputs || inputs.length === 0) {
        container.innerHTML = '<span style="font-size:12px;color:var(--text-muted)">No parameters for this scraper.</span>';
        return;
    }

    container.innerHTML = inputs.map(inp => {
        const val = values[inp.name] !== undefined ? values[inp.name] : (inp.default || '');
        return `
            <div class="form-group" style="min-width: 0; flex: 1;">
                <label style="font-size: 11px;">${inp.label}${inp.required ? ' *' : ''}</label>
                <input type="text" class="edit-sched-input-field" data-name="${inp.name}" value="${val}" placeholder="${inp.description || ''}" />
            </div>
        `;
    }).join('');
}

function closeEditScheduleModal(e) {
    if (e && e.target !== document.getElementById('edit-schedule-modal')) return;
    document.getElementById('edit-schedule-modal').style.display = 'none';
}

function previewEditSchedThumb(url) {
    const img = document.getElementById('edit-sched-thumb-img');
    const ph = document.getElementById('edit-sched-thumb-placeholder');
    if (url) {
        img.src = url;
        img.style.display = 'block';
        ph.style.display = 'none';
    } else {
        img.style.display = 'none';
        ph.style.display = 'flex';
    }
}

function handleEditSchedThumbFile(input) {
    if (input.files && input.files[0]) {
        const file = input.files[0];
        document.getElementById('edit-sched-thumb-filename').textContent = file.name;
        const reader = new FileReader();
        reader.onload = e => previewEditSchedThumb(e.target.result);
        reader.readAsDataURL(file);
    }
}

async function saveEditSchedule() {
    const id = document.getElementById('edit-sched-id').value;
    const cron = document.getElementById('edit-sched-cron').value.trim();
    const label = document.getElementById('edit-sched-label').value.trim();
    const thumbUrl = document.getElementById('edit-sched-thumb-url').value.trim();
    const thumbFile = document.getElementById('edit-sched-thumb-file').files[0];

    // Collect inline inputs
    const inputFields = document.querySelectorAll('.edit-sched-input-field');
    const inputValues = {};
    inputFields.forEach(f => {
        inputValues[f.getAttribute('data-name')] = f.value;
    });

    if (!cron) { toast('Cron expression is required.', 'error'); return; }

    try {
        const formData = new FormData();
        formData.append('cron_expression', cron);
        formData.append('label', label);
        formData.append('input_values', JSON.stringify(inputValues));
        formData.append('thumbnail_url', thumbUrl);
        if (thumbFile) formData.append('thumbnail_file', thumbFile);

        const res = await apiFetch(`${API.schedules}/${id}`, {
            method: 'PATCH',
            body: formData
        });

        toast('Schedule updated!', 'success');
        closeEditScheduleModal();
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
    const statuses = [
        { id: '', label: 'All' },
        { id: 'running', label: '⚡ Running' },
        { id: 'success', label: '✅ Success' },
        { id: 'failure', label: '❌ Failure' },
        { id: 'skipped', label: '⏭ Skipped' }
    ];
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
    if (tagId) url += `&tag_id=${tagId}`;
    if (status) url += `&status=${status}`;

    try {
        const data = await apiFetch(url);

        const dataHash = JSON.stringify({ data, filters: state.logFilters, page: state.currentLogsPage });
        if (responseCache['logs'] === dataHash) return;
        responseCache['logs'] = dataHash;

        const container = document.getElementById('logs-list');

        if (!data.items.length) {
            container.innerHTML = '<div class="empty-state">No logs found.</div>';
            document.getElementById('logs-pagination').innerHTML = '';
            return;
        }

        container.innerHTML = data.items.map((log, idx) => {
            const detailsId = `log-details-${log.id}`;
            const isRunning = log.status === 'running';
            const hasDetails = log.payload || log.error_msg || isRunning;
            const isExpanded = state.expandedLogs.has(detailsId);
            const retryBadge = (log.retry_count && log.retry_count > 0)
                ? `<span class="status-badge badge-pending" title="Retried ${log.retry_count}x">🔄 ${log.retry_count} retr${log.retry_count === 1 ? 'y' : 'ies'}</span>`
                : '';
            
            return `
            <div class="log-card ${isRunning ? 'log-card--running' : ''}" data-status="${log.status}">
                <div class="log-card-header" ${hasDetails ? `onclick="toggleLogDetails('${detailsId}')"` : ''} style="${hasDetails ? 'cursor:pointer' : ''}">
                    <div class="log-col-status">${statusBadge(log.status)}</div>
                    <div class="log-col-scraper">
                        <strong>${log.scraper_name || 'N/A'}</strong>
                        ${log.schedule_name ? `<div style="font-size:11px;color:var(--text-muted);margin-top:2px;">📅 ${log.schedule_name}</div>` : ''}
                    </div>
                    <div class="log-col-eps">
                        <span class="log-epcount" style="display: ${log.episode_count ? 'inline-flex' : 'none'}">${log.episode_count} found</span>
                    </div>
                    <div class="log-col-retry" style="display:flex; justify-content:center;">${retryBadge}</div>
                    <div class="log-col-trigger">${statusBadge(log.triggered_by)}</div>
                    <div class="log-col-time"><span class="log-time">${fmt(log.run_at)}</span></div>
                    <div class="log-col-icon" style="text-align:right;">${hasDetails ? `<span class="log-expand-icon" id="icon-${detailsId}">${isExpanded ? '▼' : '▶'}</span>` : ''}</div>
                </div>
                ${hasDetails ? `
                <div class="log-details" id="${detailsId}" style="display:${isExpanded ? 'block' : 'none'}">
                    ${isRunning ? `<div class="log-running-msg">⚡ This scraper is currently executing. Results will appear here once finished.</div>` : ''}
                    ${log.error_msg && !isRunning ? (log.status === 'skipped' ? `<div class="log-skipped-msg">⏭ ${log.error_msg}</div>` : `<div class="log-error">❌ ${log.error_msg}</div>`) : ''}
                    ${log.payload ? `
                    <div class="payload-download-bar">
                        <span class="payload-download-label">Download payload:</span>
                        <button class="btn-dl" onclick="downloadLogPayload(${log.id}, 'json')" title="Download JSON">⬇ JSON</button>
                        <button class="btn-dl" onclick="downloadLogPayload(${log.id}, 'csv')" title="Download CSV">⬇ CSV</button>
                    </div>
                    ${renderPayload(log.payload, log.episode_count)}` : ''}
                    ${log.integration_details ? renderIntegrationDetails(log.integration_details) : ''}
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
    const el = document.getElementById(id);
    const icon = document.getElementById(`icon-${id}`);
    const open = el.style.display === 'block';
    el.style.display = open ? 'none' : 'block';
    if (icon) icon.textContent = open ? '▶' : '▼';
    if (open) {
        state.expandedLogs.delete(id);
    } else {
        state.expandedLogs.add(id);
    }
}

function renderPayload(payload, episodeCount = 0) {
    if (!payload || typeof payload !== 'object') return '';

    if (Array.isArray(payload) && payload.length > 0) {
        const keys = Array.from(new Set(payload.map(p => Object.keys(p)).flat())).filter(k => k !== null && k !== undefined);
        let thead = '<tr>' + keys.map(k => `<th>${k.replace(/_/g, ' ').replace(/\\b\\w/g, c => c.toUpperCase())}</th>`).join('') + '</tr>';

        let tbody = payload.map(obj => {
            return '<tr>' + keys.map(k => {
                let v = obj[k] !== null && obj[k] !== undefined ? String(obj[k]) : '—';
                if (v.length > 200) v = v.substring(0, 200) + '...';
                if (v.startsWith('http')) v = `<a href="${v}" target="_blank" rel="noopener">Link</a>`;
                return `<td>${v}</td>`;
            }).join('') + '</tr>';
        }).join('');

        let msg = '';
        if (episodeCount && episodeCount > payload.length) {
            msg = `<div class="payload-truncation-notice">✨ Displaying <b>${payload.length}</b> out of <b>${episodeCount}</b> scraped items.</div>`;
        }

        return `<div class="payload-table-wrapper"><table class="payload-table"><thead>${thead}</thead><tbody>${tbody}</tbody></table></div>${msg}`;
    }

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

function renderIntegrationDetails(detailsStr) {
    try {
        const details = JSON.parse(detailsStr);
        if (!details || !Array.isArray(details) || details.length === 0) return '';
        const rows = details.map(d => {
            let color = d.success ? 'var(--success)' : 'var(--failure)';
            let icon = d.success ? '✅' : '❌';
            return `
            <div style="font-size:12px; margin-top:8px; padding:8px; background:rgba(255,255,255,0.03); border-radius:4px; border-left:3px solid ${color};">
                <strong>${icon} ${d.name}</strong> • ${d.attempts} attempt(s)
                ${d.error ? `<div style="color:var(--failure);margin-top:4px;">Error: ${d.error}</div>` : ''}
            </div>`;
        });
        return `<div style="margin-top:16px;">
            <div style="font-size:11px;color:var(--text-muted);font-weight:600;letter-spacing:0.05em;">INTEGRATIONS</div>
            ${rows.join('')}
        </div>`;
    } catch {
        return '';
    }
}

function downloadLogPayload(logId, format) {
    const a = document.createElement('a');
    a.href = API.logDownload(logId, format);
    a.download = '';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

/* ════════════════════════════════════════════════
   QUEUE
════════════════════════════════════════════════ */
async function loadQueue() {
    try {
        const tasks = await apiFetch(API.queue);

        const dataHash = JSON.stringify(tasks);
        if (responseCache['queue'] === dataHash) return;
        responseCache['queue'] = dataHash;

        state.queueTasks = tasks;
        renderQueueTasks();
    } catch (e) { toast(e.message, 'error'); }
}

function sortQueue(col) {
    if (state.queueSort.col === col) {
        state.queueSort.order = state.queueSort.order === 'asc' ? 'desc' : 'asc';
    } else {
        state.queueSort.col = col;
        state.queueSort.order = 'asc';
    }
    ['scraper_name', 'scheduled_for', 'note', 'status'].forEach(c => {
        const icon = document.getElementById(`sort-icon-${c}`);
        if (icon) icon.textContent = '';
    });
    const activeIcon = document.getElementById(`sort-icon-${col}`);
    if (activeIcon) activeIcon.textContent = state.queueSort.order === 'asc' ? '▼' : '▲';
    renderQueueTasks();
}

function renderQueueTasks() {
    const tasks = [...state.queueTasks];
    const { col, order } = state.queueSort;
    
    tasks.sort((a, b) => {
        let valA = a[col] || '';
        let valB = b[col] || '';
        if (col === 'scheduled_for') {
            valA = new Date(valA).getTime() || 0;
            valB = new Date(valB).getTime() || 0;
        } else {
            valA = String(valA).toLowerCase();
            valB = String(valB).toLowerCase();
        }
        if (valA < valB) return order === 'asc' ? -1 : 1;
        if (valA > valB) return order === 'asc' ? 1 : -1;
        return 0;
    });

    const pending = state.queueTasks.filter(t => t.status === 'pending' || t.status === 'running').length;
    const badge = document.getElementById('queue-badge');
    badge.textContent = pending;
    badge.style.display = pending ? 'inline-block' : 'none';

    const tbody = document.getElementById('queue-body');
    if (!tasks.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="empty-td">Queue is empty.</td></tr>';
        return;
    }

    const now = new Date().getTime();

    tbody.innerHTML = tasks.map(t => {
        const isVirtual = !!t.is_virtual;
        const removeBtn = !isVirtual 
            ? `<button class="btn btn-ghost" style="color:var(--failure);padding:4px 8px" onclick="removeQueueTask(${t.id})">✕</button>`
            : '';
        
        // Time left calculation
        let timeLeftStr = '';
        if (t.scheduled_for) {
            const iso = t.scheduled_for + (t.scheduled_for.endsWith('Z') ? '' : 'Z');
            const schTime = new Date(iso).getTime();
            const diff = schTime - now;
            if (diff > 0) {
                const mins = Math.floor(diff / 60000);
                const hrs = Math.floor(mins / 60);
                if (hrs > 0) timeLeftStr = ` <small style="color:var(--text-muted);margin-left:4px">(${hrs}h ${mins % 60}m)</small>`;
                else if (mins > 0) timeLeftStr = ` <small style="color:var(--text-muted);margin-left:4px">(${mins}m)</small>`;
                else timeLeftStr = ` <small style="color:var(--text-muted);margin-left:4px">(< 1m)</small>`;
            } else if (t.status === 'pending') {
                timeLeftStr = ` <small style="color:var(--warning);margin-left:4px">(Overdue)</small>`;
            }
        }

        return `
        <tr>
            <td><strong>${t.scraper_name || 'N/A'}</strong></td>
            <td style="white-space:nowrap"><span class="log-epcount" style="margin:0">${fmt(t.scheduled_for)}</span>${timeLeftStr}</td>
            <td><div style="font-size:12px;color:var(--text-muted);max-width:150px;overflow:hidden;text-overflow:ellipsis">${t.note || '—'}</div></td>
            <td>${statusBadge(t.status)}</td>
            <td style="text-align:right">${removeBtn}</td>
        </tr>`;
    }).join('');
}

/* ════════════════════════════════════════════════
   INTEGRATIONS
════════════════════════════════════════════════ */
function openConnectorModal(type, id = null) {
    try {
        const setVal = (elId, val) => { const el = document.getElementById(elId); if (el) el.value = val; };
        const setChk = (elId, val) => { const el = document.getElementById(elId); if (el) el.checked = val; };
        const setText = (elId, val) => { const el = document.getElementById(elId); if (el) el.textContent = val; };

        setVal('conn-type', type);
        setVal('conn-id', id || '');

        const isDiscord = type === 'discord_webhook';
        document.getElementById('conn-discord-fields').style.display = isDiscord ? 'block' : 'none';
        document.getElementById('conn-http-fields').style.display = isDiscord ? 'none' : 'block';
        document.getElementById('connector-title').textContent = isDiscord
            ? (id ? 'Edit Discord Webhook' : 'Configure Discord Webhook')
            : (id ? 'Edit HTTP Request' : 'Configure HTTP Request');

        if (!id) {
            setVal('conn-name', '');
            setVal('conn-desc', '');
            // Discord defaults
            setVal('conn-webhook', '');
            setChk('conn-include-data', true);
            setChk('conn-http-include-data', true);
            setChk('conn-trig-success', true);
            setChk('conn-trig-failure', true);
            setChk('conn-trig-skip', false);
            setChk('conn-http-trig-success', true);
            setChk('conn-http-trig-failure', true);
            setChk('conn-http-trig-skip', false);
            setVal('conn-retry-max', '3');
            setVal('conn-delay', '1');
            setChk('conn-tag', false);
            setVal('conn-thumb-path', '');
            setVal('conn-thumb-file', '');
            setText('conn-thumb-filename', 'No file selected');
            // HTTP defaults
            setVal('conn-http-url', '');
            setHttpMethod('POST');
            setHttpDispatch('all_at_once');
            setChk('conn-http-send-as-file', false);
            setVal('conn-http-headers', '');
            setVal('conn-http-retry', '3');
            setVal('conn-http-delay', '1');
        } else {
            const integ = state.integrations.find(i => i.id === id);
            if (integ) {
                setVal('conn-name', integ.name || '');
                const cfg = integ.config || {};
                setVal('conn-desc', cfg.description || '');

                const trigs = cfg.triggers || ['success', 'failure'];
                if (integ.type === 'discord_webhook') {
                    setVal('conn-webhook', cfg.webhook_url || '');
                    const dm = cfg.dispatch_mode || (cfg.delivery_method === 'all_file' ? 'all_at_once' : 'per_element');
                    const fs = cfg.format_style || (cfg.delivery_method === 'per_element_text' ? 'text' : 'embed');
                    setDiscordDispatch(dm);
                    setDiscordStyle(fs);
                    setChk('conn-include-data', cfg.content_type !== 'state_only');
                    setChk('conn-trig-success', trigs.includes('success'));
                    setChk('conn-trig-failure', trigs.includes('failure'));
                    setChk('conn-trig-skip', trigs.includes('skipped'));
                    setChk('conn-send-as-file', !!cfg.send_as_file || cfg.delivery_method === 'all_file');
                    onDiscordFileToggle();
                    setVal('conn-retry-max', cfg.retry_max !== undefined ? cfg.retry_max : '3');
                    setVal('conn-delay', cfg.delay_sec !== undefined ? cfg.delay_sec : '1');
                    
                    setChk('conn-tag', !!cfg.tag_all);
                    setVal('conn-thumb-path', cfg.thumbnail_path || '');
                } else if (integ.type === 'http_request') {
                    setVal('conn-http-url', cfg.url || '');
                    setHttpMethod(cfg.method || 'POST');
                    const hdm = cfg.dispatch_mode || (cfg.body_mode === 'per_element' ? 'per_element' : 'all_at_once');
                    setHttpDispatch(hdm);
                    setChk('conn-http-include-data', cfg.content_type !== 'state_only');
                    setChk('conn-http-trig-success', trigs.includes('success'));
                    setChk('conn-http-trig-failure', trigs.includes('failure'));
                    setChk('conn-http-trig-skip', trigs.includes('skipped'));
                    setChk('conn-http-send-as-file', !!cfg.send_as_file);
                    setVal('conn-http-headers', cfg.headers ? JSON.stringify(cfg.headers, null, 2) : '');
                    
                    setVal('conn-http-retry', cfg.retry_max !== undefined ? cfg.retry_max : '3');
                    setVal('conn-http-delay', cfg.delay_sec !== undefined ? cfg.delay_sec : '1');
                }
            }
        }
        updateIntegrationFieldsUI();
        document.getElementById('connector-modal').style.display = 'flex';
    } catch(err) {
        console.error('openConnectorModal error:', err);
    }
}


function updateIntegrationFieldsUI() {
    try {
        const typeEl = document.getElementById('conn-type');
        if (!typeEl) return;
        const type = typeEl.value;
        
        if (type === 'discord_webhook') {
            const fullDataEl = document.getElementById('conn-include-data');
            const fullData = fullDataEl ? fullDataEl.checked : true;
            const panels = ['conn-discord-data-settings', 'conn-discord-thumb-settings'];
            panels.forEach(id => {
                const el = document.getElementById(id);
                if (el) {
                    el.style.opacity = fullData ? '1' : '0.4';
                    el.style.pointerEvents = fullData ? 'auto' : 'none';
                }
            });
        } else if (type === 'http_request') {
            const fullDataEl = document.getElementById('conn-http-include-data');
            const fullData = fullDataEl ? fullDataEl.checked : true;
            const panels = ['conn-http-data-settings', 'conn-http-data-settings-inner'];
            panels.forEach(id => {
                const el = document.getElementById(id);
                if (el) {
                    el.style.opacity = fullData ? '1' : '0.4';
                    el.style.pointerEvents = fullData ? 'auto' : 'none';
                }
            });
        }
    } catch (e) {
        console.error('Error in updateIntegrationFieldsUI:', e);
    }
}


function closeConnectorModal(e) {
    if (e && e.target !== document.getElementById('connector-modal')) return;
    document.getElementById('connector-modal').style.display = 'none';
}

// ── Discord delivery UI helpers ───────────────────────────────────────────────
function setDiscordDispatch(mode, display = null) {
    document.getElementById('conn-dispatch-mode').value = mode;
    const text = display || (mode === 'per_element' ? 'One by One' : 'All at Once');
    document.getElementById('summary-disc-dispatch').innerHTML = `<span>${text}</span> <span style="font-size:10px; opacity:0.5;">▼</span>`;
    const showStyle = mode === 'per_element' && !document.getElementById('conn-send-as-file').checked;
    document.getElementById('conn-format-style-row').style.display = showStyle ? 'block' : 'none';
    updateDiscordThumbnailVisibility();
}


function setDiscordStyle(style, display = null) {
    document.getElementById('conn-format-style').value = style;
    const text = display || (style === 'text' ? 'Raw Text' : 'Rich Embed');
    document.getElementById('summary-disc-style').innerHTML = `<span>${text}</span> <span style="font-size:10px; opacity:0.5;">▼</span>`;
    updateDiscordThumbnailVisibility();
}

function onDiscordFileToggle() {
    const fileOn = document.getElementById('conn-send-as-file').checked;
    const perOpt = document.getElementById('disc-dispatch-per-option');
    if (fileOn) {
        // Force all-at-once, disable per-element option
        setDiscordDispatch('all_at_once', 'All at Once');
        if (perOpt) { perOpt.style.opacity = '0.35'; perOpt.style.pointerEvents = 'none'; }
    } else {
        if (perOpt) { perOpt.style.opacity = ''; perOpt.style.pointerEvents = ''; }
    }
    const dm = document.getElementById('conn-dispatch-mode').value;
    document.getElementById('conn-format-style-row').style.display =
        (dm === 'per_element' && !fileOn) ? 'block' : 'none';
    updateDiscordThumbnailVisibility();
}

function stepNum(id, delta) {
    const el = document.getElementById(id);
    if (!el) return;
    const step = parseFloat(el.step) || 1;
    const min  = el.min !== '' ? parseFloat(el.min) : -Infinity;
    const max  = el.max !== '' ? parseFloat(el.max) :  Infinity;
    const val  = parseFloat(el.value) || 0;
    el.value = Math.min(max, Math.max(min, +(val + delta).toFixed(2)));
}

function updateDiscordThumbnailVisibility() {
    const fileToggle = document.getElementById('conn-send-as-file');
    const fileOn = fileToggle ? fileToggle.checked : false;
    const styleEl = document.getElementById('conn-format-style');
    const style = styleEl ? styleEl.value : 'embed';
    const show = !fileOn && style === 'embed';
    const settings = document.getElementById('conn-format-settings');
    if (settings) settings.style.display = show ? 'block' : 'none';
}

function setHttpDispatch(mode, display = null) {
    const el = document.getElementById('conn-http-dispatch-mode');
    if (el) el.value = mode;
    const text = display || (mode === 'per_element' ? 'One by One' : 'All at Once');
    const summary = document.getElementById('summary-http-dispatch');
    if (summary) summary.innerHTML = `<span>${text}</span> <span style="font-size:10px; opacity:0.5;">▼</span>`;
}


function setHttpMethod(method) {
    const el = document.getElementById('conn-http-method');
    if (el) el.value = method;
    const summary = document.getElementById('summary-http-method');
    if (summary) summary.innerHTML = `<span>${method}</span> <span style="font-size:10px; opacity:0.5;">▼</span>`;
}

function handleConnThumb(input) {
    const file = input.files[0];
    if (file) document.getElementById('conn-thumb-filename').textContent = file.name;
    else document.getElementById('conn-thumb-filename').textContent = 'No file selected';
}

async function loadIntegrations() {
    try {
        const integs = await apiFetch(API.integrations);

        const dataHash = JSON.stringify(integs);
        if (responseCache['integrations'] === dataHash) return;
        responseCache['integrations'] = dataHash;

        state.integrations = integs;
        document.getElementById('integ-count').textContent = integs.length;
        const list = document.getElementById('integrations-list');
        if (!integs.length) {
            list.innerHTML = '<div class="empty-state">No integrations yet.</div>';
            return;
        }

        list.innerHTML = integs.map(i => {
            let metaChips = '';
            let descriptionHTML = '';

            if (i.config && i.config.description) {
                descriptionHTML = `<div style="font-size:13px;color:var(--text-secondary);margin-top:6px;">${i.config.description}</div>`;
            }

            if (i.type === 'discord_webhook' && i.config) {
                const dm  = i.config.dispatch_mode || 'per_element';
                const sf  = !!i.config.send_as_file;
                const fs  = i.config.format_style || 'embed';
                const dmLabel = dm === 'all_at_once' ? 'All at Once' : 'One by One';
                metaChips += ` <span class="tag-chip tag-chip--active" style="font-size:10px;padding:2px 7px;">${dmLabel}</span>`;
                if (sf)  metaChips += ` <span class="tag-chip" style="font-size:10px;padding:2px 7px;color:var(--success)">📎 File</span>`;
                else if (fs === 'embed') metaChips += ` <span class="tag-chip" style="font-size:10px;padding:2px 7px;color:#818cf8">Embed</span>`;
                else metaChips += ` <span class="tag-chip" style="font-size:10px;padding:2px 7px;color:var(--warning)">Raw Text</span>`;
                if (i.config.tag_all) metaChips += ` <span class="tag-chip tag-chip--active" style="font-size:10px;padding:2px 6px">@everyone</span>`;
            }

            if (i.type === 'http_request' && i.config) {
                const bm = i.config.body_mode || 'json_array';
                metaChips += ` <span class="tag-chip tag-chip--active" style="font-size:10px;padding:2px 6px;color:#38bdf8">${i.config.method || 'POST'}</span>`;
                metaChips += ` <span class="tag-chip" style="font-size:10px;padding:2px 6px;color:var(--text-secondary)">${bm}</span>`;
            }

            const titleType = i.type === 'discord_webhook' ? 'Discord Webhook' : i.type === 'http_request' ? 'HTTP Request' : i.type;

            return `
            <div class="item-card" draggable="true"
                 ondragstart="handleDragStart(event, 'integration', ${i.id})"
                 ondragover="handleDragOver(event)"
                 ondragleave="handleDragLeave(event)"
                 ondrop="handleDrop(event, 'integration', ${i.id})"
                 ondragend="handleDragEnd(event)">
              <div class="drag-handle" title="Drag to reorder">⠿</div>
              <div class="item-info">
                <div class="item-name" style="font-size:16px;">${integIcon(i.type)} ${i.name} ${metaChips}</div>
                <div class="item-meta" style="font-size:12px;color:var(--text-muted)">${titleType} &nbsp;•&nbsp; Created on ${fmt(i.created_at)}</div>
                ${descriptionHTML}
              </div>
              <div class="item-actions">
                <button class="btn btn-ghost" style="font-size:12px;padding:6px 12px" onclick="openConnectorModal('${i.type}', ${i.id})">✏️ Edit</button>
                <button class="btn btn-ghost" style="font-size:12px;padding:6px 12px" onclick="testIntegration(${i.id}, this)">🧪 Test</button>
                <button class="btn btn-danger" onclick="deleteIntegration(${i.id})">✕</button>
              </div>
            </div>`;
        }).join('');
    } catch (e) { toast(e.message, 'error'); }
}

async function saveConnector() {
    const name = document.getElementById('conn-name').value.trim();
    const type = document.getElementById('conn-type').value;
    if (!name) { toast('Integration name is required.', 'error'); return; }

    let config = {};
    if (type === 'discord_webhook') {
        const webhook = document.getElementById('conn-webhook').value.trim();
        if (!webhook) { toast('Webhook URL is required.', 'error'); return; }

        const triggers = [];
        if (document.getElementById('conn-trig-success').checked) triggers.push('success');
        if (document.getElementById('conn-trig-failure').checked) triggers.push('failure');
        if (document.getElementById('conn-trig-skip').checked) triggers.push('skipped');

        config = {
            webhook_url: webhook,
            description: document.getElementById('conn-desc').value.trim(),
            dispatch_mode: document.getElementById('conn-dispatch-mode').value,
            format_style: document.getElementById('conn-format-style').value,
            content_type: document.getElementById('conn-include-data').checked ? 'full_data' : 'state_only',
            triggers: triggers,
            send_as_file: document.getElementById('conn-send-as-file').checked,
            retry_max: parseInt(document.getElementById('conn-retry-max').value, 10) || 0,
            delay_sec: parseFloat(document.getElementById('conn-delay').value) || 0,
            tag_all: document.getElementById('conn-tag').checked,
            thumbnail_path: document.getElementById('conn-thumb-path').value.trim(),
        };
    } else if (type === 'http_request') {
        const url = document.getElementById('conn-http-url').value.trim();
        if (!url) { toast('Endpoint URL is required.', 'error'); return; }
        
        const triggers = [];
        if (document.getElementById('conn-http-trig-success').checked) triggers.push('success');
        if (document.getElementById('conn-http-trig-failure').checked) triggers.push('failure');
        if (document.getElementById('conn-http-trig-skip').checked) triggers.push('skipped');

        let headers = {};
        const rawHeaders = document.getElementById('conn-http-headers').value.trim();
        if (rawHeaders) {
            try { headers = JSON.parse(rawHeaders); }
            catch { toast('Extra Headers must be valid JSON (e.g. {"Authorization":"Bearer ..."}).', 'error'); return; }
        }
        config = {
            url,
            method: document.getElementById('conn-http-method').value,
            dispatch_mode: document.getElementById('conn-http-dispatch-mode').value,
            content_type: document.getElementById('conn-http-include-data').checked ? 'full_data' : 'state_only',
            triggers: triggers,
            send_as_file: document.getElementById('conn-http-send-as-file').checked,
            headers,
            retry_max: parseInt(document.getElementById('conn-http-retry').value, 10) || 0,
            delay_sec: parseFloat(document.getElementById('conn-http-delay').value) || 0,
            description: document.getElementById('conn-desc').value.trim(),
        };
    }

    const btn = document.getElementById('conn-submit-btn');
    btn.disabled = true; btn.textContent = '⏳ Saving…';

    const connId = document.getElementById('conn-id').value;

    try {
        let createdInteg;
        if (connId) {
            createdInteg = await apiFetch(`${API.integrations}/${connId}`, { method: 'PATCH', body: JSON.stringify({ name, config }) });
        } else {
            createdInteg = await apiFetch(API.integrations, { method: 'POST', body: JSON.stringify({ name, type, config }) });
        }

        // Handle optional thumbnail file upload chaining natively
        const thumbFile = document.getElementById('conn-thumb-file').files[0];
        if (thumbFile && config.delivery_method === 'per_element_embed') {
            const formData = new FormData();
            formData.append('file', thumbFile);
            const thumbRes = await fetch(`${API.integrations}/${createdInteg.id}/thumbnail`, { method: 'POST', body: formData });
            if (!thumbRes.ok) {
                const err = await thumbRes.json();
                throw new Error(err.detail || 'Thumbnail upload failed');
            }
        }

        toast('Integration created successfully!', 'success');
        closeConnectorModal();
        loadIntegrations();
    } catch (e) { toast(e.message, 'error'); }
    finally {
        btn.disabled = false; btn.textContent = 'Save Integration';
    }
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
        state.timezone = val;
        // Bust timestamp caches so all tabs re-render with new TZ
        Object.keys(responseCache).forEach(k => { responseCache[k] = null; });
        refreshAll();
        toast(`Timezone set to ${val}`, 'success');
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

    // Container is always active now.
    // Default version fields if we have a previous version, otherwise empty
    let nextPatch = 1;
    let mj = '1', mn = '0', pt = '0';
    if (s.latest_version) {
        let parts = s.latest_version.split('.');
        if (parts.length === 3) {
            mj = parts[0]; mn = parts[1]; pt = parseInt(parts[2]) + 1;
        }
    }
    document.getElementById('edit-ver-major').value = mj;
    document.getElementById('edit-ver-minor').value = mn;
    document.getElementById('edit-ver-patch').value = pt;
    document.getElementById('edit-commit').value = '';

    const img = document.getElementById('edit-thumb-img');
    const ph = document.getElementById('edit-thumb-placeholder');
    if (s.thumbnail_url) { img.src = s.thumbnail_url; img.style.display = 'block'; ph.style.display = 'none'; }
    else { img.style.display = 'none'; img.src = ''; ph.style.display = 'flex'; ph.textContent = '🎌'; }
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
    const id = parseInt(document.getElementById('edit-id').value);
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
    }

    // Always append version info so local IDE edits can be snapshotted
    const major = document.getElementById('edit-ver-major').value || '0';
    const minor = document.getElementById('edit-ver-minor').value || '0';
    const patch = document.getElementById('edit-ver-patch').value || '0';
    formData.append('version_label', `${major}.${minor}.${patch}`);
    formData.append('commit_message', document.getElementById('edit-commit').value.trim() || 'Updated script manually');

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
    const area = document.getElementById('ver-code-area');
    const pre = document.getElementById('ver-code-view');
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
    }).catch(() => { });
}

setInterval(refreshAll, 5000);

/* ════════════════════════════════════════════════
   RUN INPUTS MODAL
════════════════════════════════════════════════ */
let _runInputsCallback = null;  // {type:'run', id, btn} or {type:'schedule', fn}

function openRunInputsModal(scraperId, inputs, btn, scheduleCb = null) {
    _runInputsCallback = scheduleCb
        ? { type: 'schedule', fn: scheduleCb }
        : { type: 'run', id: scraperId, btn };

    const title = scheduleCb ? 'Set Schedule Inputs' : 'Run with Inputs';
    document.getElementById('run-inputs-title').textContent = title;

    const submitBtn = document.getElementById('run-inputs-submit-btn');
    if (submitBtn) {
        submitBtn.innerHTML = scheduleCb ? '📅 Create Schedule' : '▶ Run';
    }

    const form = document.getElementById('run-inputs-form');
    form.innerHTML = inputs.map(inp => {
        const id = `ri-${inp.name}`;
        const def = inp.default !== undefined ? inp.default : '';
        const desc = inp.description ? `<p class="input-desc">${inp.description}</p>` : '';
        let field = '';
        if (inp.type === 'select' && inp.options) {
            const opts = inp.options.map(o =>
                `<option value="${o}" ${String(o) === String(def) ? 'selected' : ''}>${o}</option>`
            ).join('');
            field = `<select id="${id}" class="inp">${opts}</select>`;
        } else if (inp.type === 'boolean') {
            field = `<label style="display:flex;align-items:center;gap:8px;cursor:pointer">
                <input type="checkbox" id="${id}" ${def ? 'checked' : ''} style="width:16px;height:16px">
                <span style="font-size:14px">${inp.label || inp.name}</span>
            </label>`;
        } else {
            const t = inp.type === 'number' ? 'number' : 'text';
            field = `<input type="${t}" id="${id}" class="inp" value="${def}" placeholder="${inp.label || inp.name}">`;
        }
        const lbl = inp.type !== 'boolean'
            ? `<label class="form-label" for="${id}">${inp.label || inp.name}</label>` : '';
        return `<div class="form-group--modal">${lbl}${field}${desc}</div>`;
    }).join('');

    document.getElementById('run-inputs-modal').style.display = 'flex';
}

function closeRunInputsModal(e) {
    if (e && e.target !== document.getElementById('run-inputs-modal')) return;
    document.getElementById('run-inputs-modal').style.display = 'none';
    _runInputsCallback = null;
}

async function submitRunInputs() {
    const cb = _runInputsCallback;
    if (!cb) return;

    // Collect values
    const form = document.getElementById('run-inputs-form');
    const inputValues = {};
    form.querySelectorAll('[id^="ri-"]').forEach(el => {
        const name = el.id.replace('ri-', '');
        if (el.type === 'checkbox') inputValues[name] = el.checked;
        else if (el.type === 'number') inputValues[name] = el.value !== '' ? Number(el.value) : null;
        else inputValues[name] = el.value;
    });

    document.getElementById('run-inputs-modal').style.display = 'none';

    if (cb.type === 'run') {
        await _doRunScraper(cb.id, inputValues, cb.btn);
    } else if (cb.type === 'schedule') {
        await cb.fn(inputValues);
    }
    _runInputsCallback = null;
}

/* ── Drag-and-drop for code zones ───────────────────── */
function _setupCodeDropZone(zoneId, inputId, textId) {
    const zone = document.getElementById(zoneId);
    if (!zone) return;
    zone.addEventListener('dragover', e => {
        e.preventDefault();
        zone.style.borderColor = 'var(--accent)';
        zone.style.background = 'rgba(99,102,241,0.06)';
    });
    zone.addEventListener('dragleave', () => {
        zone.style.borderColor = '';
        zone.style.background = '';
    });
    zone.addEventListener('drop', e => {
        e.preventDefault();
        zone.style.borderColor = '';
        zone.style.background = '';
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
        zone.style.background = 'rgba(34,197,94,0.05)';
    });
}

/* ════════════════════════════════════════════════
   ONE-TIME TASK
   ════════════════════════════════════════════════ */
function openOneTimeModal() {
    console.log("[OneTime] Opening modal, state.scrapers:", state.scrapers);
    const sel = document.getElementById('ot-scraper');
    if (!sel) {
        console.error("[OneTime] ot-scraper element not found!");
        return;
    }
    sel.innerHTML = state.scrapers.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
    document.getElementById('ot-time').value = '';
    document.getElementById('ot-note').value = '';
    try {
        renderOneTimeParams();
    } catch (e) {
        console.error("[OneTime] renderOneTimeParams failed:", e);
    }
    const modal = document.getElementById('one-time-modal');
    if (modal) {
        modal.style.display = 'flex';
    } else {
        console.error("[OneTime] one-time-modal element not found!");
    }
}

function closeOneTimeModal(e) {
    if (e && e.target !== document.getElementById('one-time-modal')) return;
    document.getElementById('one-time-modal').style.display = 'none';
}

function renderOneTimeParams() {
    const sid = document.getElementById('ot-scraper').value;
    const scraper = state.scrapers.find(s => String(s.id) === String(sid));
    const wrapper = document.getElementById('ot-params-wrapper');
    if (!scraper || !scraper.inputs || !scraper.inputs.length) {
        wrapper.innerHTML = '';
        return;
    }
    wrapper.innerHTML = `
        <div style="background:rgba(255,255,255,0.02);border:1px solid var(--border);border-radius:var(--radius-sm);padding:14px;margin-top:4px">
            <div style="font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;margin-bottom:12px;letter-spacing:0.05em">Parameters</div>
            ${scraper.inputs.map(inp => {
                const id = `ot-ri-${inp.name}`;
                const def = inp.default !== undefined ? inp.default : '';
                let field = '';
                if (inp.type === 'select' && inp.options) {
                    const opts = inp.options.map(o => `<option value="${o}" ${String(o) === String(def) ? 'selected' : ''}>${o}</option>`).join('');
                    field = `<select id="${id}" class="form-control" style="background:var(--bg-input); color:var(--text-primary); border:1px solid var(--border); border-radius:var(--radius-sm); padding:8px; width:100%">${opts}</select>`;
                } else if (inp.type === 'boolean') {
                    field = `<label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" id="${id}" ${def ? 'checked' : ''}> <span>${inp.label || inp.name}</span></label>`;
                } else {
                    const t = inp.type === 'number' ? 'number' : 'text';
                    field = `<input type="${t}" id="${id}" class="form-control" value="${def}" style="background:var(--bg-input); color:var(--text-primary); border:1px solid var(--border); border-radius:var(--radius-sm); padding:8px; width:100%">`;
                }
                return `<div class="form-group" style="margin-bottom:10px"><label style="font-size:12px;margin-bottom:4px">${inp.type === 'boolean' ? '' : (inp.label || inp.name)}</label>${field}</div>`;
            }).join('')}
        </div>`;
}

async function submitOneTimeTask() {
    const scraperId = document.getElementById('ot-scraper').value;
    const scheduledFor = document.getElementById('ot-time').value;
    const note = document.getElementById('ot-note').value.trim();

    const inputValues = {};
    const scraper = state.scrapers.find(s => String(s.id) === String(scraperId));
    if (scraper && scraper.inputs) {
        scraper.inputs.forEach(inp => {
            const el = document.getElementById(`ot-ri-${inp.name}`);
            if (!el) return;
            if (el.type === 'checkbox') inputValues[inp.name] = el.checked;
            else if (el.type === 'number') inputValues[inp.name] = el.value !== '' ? Number(el.value) : null;
            else inputValues[inp.name] = el.value;
        });
    }

    try {
        await apiFetch(API.queue, {
            method: 'POST',
            body: JSON.stringify({
                scraper_id: parseInt(scraperId),
                scheduled_for: scheduledFor || null,
                input_values: Object.keys(inputValues).length ? inputValues : null,
                note: note || null
            })
        });
        toast('One-time task scheduled!', 'success');
        closeOneTimeModal();
        loadQueue();
    } catch (e) { toast(e.message, 'error'); }
}

async function removeQueueTask(id) {
    if (!confirm('Remove this task from queue?')) return;
    try {
        await apiFetch(`${API.queue}/${id}`, { method: 'DELETE' });
        toast('Task removed from queue.', 'info');
        loadQueue();
    } catch (e) { toast(e.message, 'error'); }
}

window.addEventListener('DOMContentLoaded', () => {
    console.log("[App] DOMContentLoaded. Initializing...");
    // Load initial settings to pick up saved timezone
    apiFetch(API.settings).then(settings => {
        if (settings.timezone) state.timezone = settings.timezone;
    }).catch(e => console.error("[App] Failed to load settings:", e));

    try {
        loadScrapers();
        loadQueue();
    } catch (e) {
        console.error("[App] Initialization error during load:", e);
    }
    
    // Pre-load integrations state so assign modal works from the start
    apiFetch(API.integrations).then(i => { state.integrations = i; }).catch(() => { });
    
    // Wire up drag-and-drop for both code upload zones
    try {
        _setupCodeDropZone('wiz-code-zone', 'wiz-code-file', 'wiz-code-text');
        _setupCodeDropZone('edit-code-zone', 'edit-code-file', 'edit-code-text');
    } catch (e) {
        console.error("[App] Failed to setup dropzones:", e);
    }
    console.log("[App] Initialization complete.");
});

/* ── Helpers for Scraper Wizard ── */
function previewWizThumb(url) {
    const img = document.getElementById('wiz-thumb-img');
    const placeholder = document.getElementById('wiz-thumb-placeholder');
    if (!img || !placeholder) return;
    if (url && url.trim().length > 0) {
        img.src = url;
        img.style.display = 'block';
        placeholder.style.display = 'none';
    } else {
        img.style.display = 'none';
        placeholder.style.display = 'flex';
    }
}

function handleWizThumbFile(input) {
    const file = input.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = document.getElementById('wiz-thumb-img');
            const placeholder = document.getElementById('wiz-thumb-placeholder');
            if (img && placeholder) {
                img.src = e.target.result;
                img.style.display = 'block';
                placeholder.style.display = 'none';
            }
        };
        reader.readAsDataURL(file);
    }
}

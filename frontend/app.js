/* ════════════════════════════════════════════════
   Anime Scraper Registry — Frontend Logic
   Vanilla JS, no dependencies
════════════════════════════════════════════════ */

const API = {
    scrapers: '/api/scrapers',
    schedules: '/api/schedules',
    logs: '/api/logs',
    queue: '/api/queue',
    run: (id) => `/api/run/${id}`,
    available: '/api/scrapers/available',
};

/* ── Thumbnail preview helpers ──────────────── */
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
    if (!url.trim()) {
        img.style.display = 'none'; img.src = '';
        ph.style.display = 'inline'; ph.textContent = '🎌'; return;
    }
    img.onload = () => { ph.style.display = 'none'; img.style.display = 'block'; };
    img.onerror = () => { img.style.display = 'none'; ph.style.display = 'inline'; ph.textContent = '⚠️'; };
    img.src = url;
}

/* ── State ──────────────────────────────────── */
let state = {
    scrapers: [],
    currentLogsPage: 0,
    logsPageSize: 50,
};

/* ── Utilities ──────────────────────────────── */
async function apiFetch(url, options = {}) {
    try {
        const res = await fetch(url, {
            headers: { 'Content-Type': 'application/json' },
            ...options,
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({ detail: res.statusText }));
            throw new Error(err.detail || `HTTP ${res.status}`);
        }
        return await res.json();
    } catch (e) {
        throw e;
    }
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
        month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
    });
}

function statusBadge(status) {
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
    };
    const [icon, cls] = map[status] || ['•', 'pending'];
    return `<span class="status-badge badge-${cls}">${icon} ${status}</span>`;
}

/* ── Tab Navigation ─────────────────────────── */
const TAB_META = {
    scrapers: { title: 'Scrapers', subtitle: 'Manage your anime scraper plugins' },
    schedules: { title: 'Schedules', subtitle: 'Configure cron-based scrape schedules' },
    logs: { title: 'Logs', subtitle: 'Full history of all scrape runs' },
    queue: { title: 'Queue', subtitle: 'Catch-up tasks for missed scheduled runs' },
};

function switchTab(name) {
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    document.querySelector(`[data-tab="${name}"]`).classList.add('active');
    document.getElementById(`tab-${name}`).classList.add('active');
    document.getElementById('page-title').textContent = TAB_META[name].title;
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
    if (tab === 'scrapers') loadScrapers();
    if (tab === 'schedules') loadSchedules();
    if (tab === 'logs') loadLogs();
    if (tab === 'queue') loadQueue();
}

/* ── Scrapers ───────────────────────────────── */
async function loadScrapers() {
    const [scrapers, available] = await Promise.all([
        apiFetch(API.scrapers),
        apiFetch(API.available).catch(() => ({})),
    ]);

    state.scrapers = scrapers;
    document.getElementById('scraper-count').textContent = scrapers.length;

    // Populate available modules dropdown
    const mods = Object.entries(available);
    const modSelect = document.getElementById('scraper-module');
    const currentVal = modSelect.value;

    let optionsHtml = '<option value="">— Select Detected Scraper —</option>';
    mods.forEach(([path, name]) => {
        optionsHtml += `<option value="${path}">${name}</option>`;
    });
    modSelect.innerHTML = optionsHtml;
    if (currentVal && mods.some(([p]) => p === currentVal)) {
        modSelect.value = currentVal;
    }

    document.getElementById('available-modules').innerHTML = '';

    window.autoFillName = function (selectElem) {
        if (!selectElem.value) return;
        const nameInput = document.getElementById('scraper-name');
        if (!nameInput.value.trim()) {
            nameInput.value = selectElem.options[selectElem.selectedIndex].text;
        }
    };

    // Render list
    const list = document.getElementById('scrapers-list');
    if (!scrapers.length) {
        list.innerHTML = '<div class="empty-state">No scrapers registered yet.</div>';
        return;
    }

    list.innerHTML = scrapers.map(s => {
        const thumbEl = s.thumbnail_url
            ? `<img class="item-thumb" src="${s.thumbnail_url}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'item-thumb-placeholder',textContent:'🎌'}))" />`
            : `<div class="item-thumb-placeholder">🎌</div>`;
        return `
    <div class="item-card item-card--with-thumb">
      ${thumbEl}
      <div class="item-info">
        <div class="item-name">
          ${s.name}
          ${s.homepage_url ? `<a href="${s.homepage_url}" target="_blank" rel="noopener" class="btn btn-ghost" style="font-size:12px;padding:2px 6px;margin-left:8px;text-decoration:none">🔗 Visit</a>` : ''}
        </div>
        <div class="item-meta">${s.module_path}</div>
        ${s.description ? `<div class="item-meta" style="color:var(--text-secondary);margin-top:2px">${s.description}</div>` : ''}
      </div>
      <div class="item-actions">
        <span class="status-badge ${s.enabled ? 'badge-enabled' : 'badge-disabled'}">${s.enabled ? '● Active' : '○ Disabled'}</span>
        <button class="btn btn-run" onclick="runScraper(${s.id}, this)">▶ Run Now</button>
        <button class="btn btn-ghost" style="font-size:12px;padding:6px 10px" onclick="openEditModal(${s.id})">✏️ Edit</button>
        <button class="btn btn-ghost" style="font-size:12px;padding:6px 10px" onclick="toggleScraper(${s.id})">${s.enabled ? 'Disable' : 'Enable'}</button>
        <button class="btn btn-danger" onclick="deleteScraper(${s.id})">✕</button>
      </div>
    </div>
  `}).join('');


    // Sync selector in schedules tab
    populateScraperSelects(scrapers);
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
    // schedules select has different placeholder
    const ss = document.getElementById('sched-scraper');
    if (ss) {
        ss.options[0].text = '— Select scraper —';
    }
}

async function registerScraper() {
    const name = document.getElementById('scraper-name').value.trim();
    const module = document.getElementById('scraper-module').value.trim();
    const desc = document.getElementById('scraper-desc').value.trim();
    const docHomepage = document.getElementById('scraper-homepage');
    const homepage = docHomepage ? docHomepage.value.trim() : "";
    const thumb = document.getElementById('scraper-thumb').value.trim();

    if (!module) { toast('Module path is required.', 'error'); return; }

    try {
        await apiFetch(API.scrapers, {
            method: 'POST',
            body: JSON.stringify({
                name: name || module,
                module_path: module,
                description: desc,
                homepage_url: homepage || null,
                thumbnail_url: thumb || null
            }),
        });
        toast('Scraper registered!', 'success');
        document.getElementById('scraper-name').value = '';
        document.getElementById('scraper-module').value = '';
        document.getElementById('scraper-desc').value = '';
        if (docHomepage) docHomepage.value = '';
        document.getElementById('scraper-thumb').value = '';
        previewThumb(''); // reset preview
        loadScrapers();
    } catch (e) {
        toast(e.message, 'error');
    }
}

async function runScraper(id, btn) {
    btn.disabled = true;
    btn.textContent = '⚡ Running…';
    try {
        const res = await apiFetch(API.run(id), { method: 'POST' });
        toast(res.detail, 'success');
        setTimeout(() => loadTab('logs'), 2500);
    } catch (e) {
        toast(e.message, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = '▶ Run Now';
    }
}

async function toggleScraper(id) {
    try {
        const res = await apiFetch(`${API.scrapers}/${id}/toggle`, { method: 'PATCH' });
        toast(`Scraper ${res.enabled ? 'enabled' : 'disabled'}.`, 'info');
        loadScrapers();
    } catch (e) {
        toast(e.message, 'error');
    }
}

async function deleteScraper(id) {
    if (!confirm('Delete this scraper? This will also remove its schedules and logs.')) return;
    try {
        await apiFetch(`${API.scrapers}/${id}`, { method: 'DELETE' });
        toast('Scraper deleted.', 'info');
        loadScrapers();
    } catch (e) {
        toast(e.message, 'error');
    }
}

/* ── Schedules ──────────────────────────────── */
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
      </div>
    `).join('');
    } catch (e) {
        toast(e.message, 'error');
    }
}

function applyCronPreset(val) {
    if (val) document.getElementById('sched-cron').value = val;
}

async function createSchedule() {
    const scraper_id = document.getElementById('sched-scraper').value;
    const cron = document.getElementById('sched-cron').value.trim();

    if (!scraper_id) { toast('Please select a scraper.', 'error'); return; }
    if (!cron) { toast('Please enter a cron expression.', 'error'); return; }

    try {
        const res = await apiFetch(API.schedules, {
            method: 'POST',
            body: JSON.stringify({ scraper_id: parseInt(scraper_id), cron_expression: cron }),
        });
        toast(`Schedule created! Next run: ${fmt(res.next_run)}`, 'success');
        document.getElementById('sched-cron').value = '';
        document.getElementById('sched-preset').value = '';
        loadSchedules();
    } catch (e) {
        toast(e.message, 'error');
    }
}

async function toggleSchedule(id) {
    try {
        const res = await apiFetch(`${API.schedules}/${id}/toggle`, { method: 'PATCH' });
        toast(`Schedule ${res.enabled ? 'resumed' : 'paused'}.`, 'info');
        loadSchedules();
    } catch (e) {
        toast(e.message, 'error');
    }
}

async function deleteSchedule(id) {
    if (!confirm('Remove this schedule?')) return;
    try {
        await apiFetch(`${API.schedules}/${id}`, { method: 'DELETE' });
        toast('Schedule removed.', 'info');
        loadSchedules();
    } catch (e) {
        toast(e.message, 'error');
    }
}

/* ── Logs ───────────────────────────────────── */
async function loadLogs(page = null) {
    if (page !== null) state.currentLogsPage = page;
    const scraperFilter = document.getElementById('log-filter-scraper').value;
    const statusFilter = document.getElementById('log-filter-status').value;
    const offset = state.currentLogsPage * state.logsPageSize;

    let url = `${API.logs}?limit=${state.logsPageSize}&offset=${offset}`;
    if (scraperFilter) url += `&scraper_id=${scraperFilter}`;
    if (statusFilter) url += `&status=${statusFilter}`;

    try {
        const data = await apiFetch(url);
        const tbody = document.getElementById('logs-body');

        if (!data.items.length) {
            tbody.innerHTML = '<tr><td colspan="8" class="empty-td">No logs found.</td></tr>';
            document.getElementById('logs-pagination').innerHTML = '';
            return;
        }

        tbody.innerHTML = data.items.map(log => `
      <tr>
        <td><strong>${log.scraper_name || 'N/A'}</strong></td>
        <td>${statusBadge(log.status)}</td>
        <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${log.title || ''}">
          ${log.title || '<span style="color:var(--text-muted)">—</span>'}
        </td>
        <td>${log.release_date || '<span style="color:var(--text-muted)">—</span>'}</td>
        <td class="url-cell">
          ${log.website_url ? `<a href="${log.website_url}" target="_blank" rel="noopener">${log.website_url}</a>` : '—'}
        </td>
        <td style="text-align:center">${log.episode_count ?? '—'}</td>
        <td>${statusBadge(log.triggered_by)}</td>
        <td style="white-space:nowrap;color:var(--text-secondary)">${fmt(log.run_at)}</td>
      </tr>
    `).join('');

        // Pagination
        const totalPages = Math.ceil(data.total / state.logsPageSize);
        const pag = document.getElementById('logs-pagination');
        if (totalPages <= 1) { pag.innerHTML = ''; return; }

        let pHTML = '';
        for (let i = 0; i < totalPages; i++) {
            pHTML += `<button class="${i === state.currentLogsPage ? 'active' : ''}" onclick="loadLogs(${i})">${i + 1}</button>`;
        }
        pag.innerHTML = pHTML;
    } catch (e) {
        toast(e.message, 'error');
    }
}

/* ── Queue ──────────────────────────────────── */
async function loadQueue() {
    try {
        const tasks = await apiFetch(API.queue);
        const pending = tasks.filter(t => t.status === 'pending' || t.status === 'running').length;

        // Update badge
        const badge = document.getElementById('queue-badge');
        if (pending > 0) {
            badge.textContent = pending;
            badge.style.display = 'inline-block';
        } else {
            badge.style.display = 'none';
        }

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
      </tr>
    `).join('');
    } catch (e) {
        toast(e.message, 'error');
    }
}

/* ── Refresh ────────────────────────────────── */
function refreshAll() {
    const activeTab = document.querySelector('.tab-panel.active')?.id.replace('tab-', '');
    if (activeTab) loadTab(activeTab);
    // Always keep queue badge up to date
    apiFetch(API.queue).then(tasks => {
        const pending = tasks.filter(t => t.status === 'pending' || t.status === 'running').length;
        const badge = document.getElementById('queue-badge');
        badge.textContent = pending;
        badge.style.display = pending ? 'inline-block' : 'none';
    }).catch(() => { });
}

/* ── Auto-refresh every 30 seconds ─────────── */
setInterval(refreshAll, 30_000);

/* ── Initial load ───────────────────────────── */
window.addEventListener('DOMContentLoaded', () => {
    loadScrapers();
    loadQueue(); // keep badge updated
});

/* ── Edit Modal ──────────────────────────── */
function openEditModal(id) {
    const s = state.scrapers.find(x => x.id === id);
    if (!s) return;
    document.getElementById('edit-id').value = id;
    document.getElementById('edit-name').value = s.name;
    const docHomepage = document.getElementById('edit-homepage');
    if (docHomepage) docHomepage.value = s.homepage_url || '';
    document.getElementById('edit-desc').value = s.description || '';
    document.getElementById('edit-thumb').value = s.thumbnail_url || '';
    const img = document.getElementById('edit-thumb-img');
    const ph = document.getElementById('edit-thumb-placeholder');
    if (s.thumbnail_url) {
        img.src = s.thumbnail_url; img.style.display = 'block'; ph.style.display = 'none';
    } else {
        img.style.display = 'none'; img.src = ''; ph.style.display = 'inline'; ph.textContent = '🎌';
    }
    document.getElementById('edit-modal').style.display = 'flex';
}

function closeEditModal(e) {
    if (e && e.target !== document.getElementById('edit-modal')) return;
    document.getElementById('edit-modal').style.display = 'none';
}

async function saveEdit() {
    const id = parseInt(document.getElementById('edit-id').value);
    const name = document.getElementById('edit-name').value.trim();
    const desc = document.getElementById('edit-desc').value.trim();
    const docHomepage = document.getElementById('edit-homepage');
    const homepage = docHomepage ? docHomepage.value.trim() : "";
    const thumb = document.getElementById('edit-thumb').value.trim();

    if (!name) { toast('Name cannot be empty.', 'error'); return; }
    try {
        await apiFetch(`${API.scrapers}/${id}`, {
            method: 'PATCH',
            body: JSON.stringify({
                name,
                description: desc,
                homepage_url: homepage || '',
                thumbnail_url: thumb || ''
            }),
        });
        toast('Scraper updated!', 'success');
        document.getElementById('edit-modal').style.display = 'none';
        loadScrapers();
    } catch (e) {
        toast(e.message, 'error');
    }
}

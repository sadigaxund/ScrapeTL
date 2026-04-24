/* ── Scrapers Tab: List, CRUD, Tags, Wizard, Edit Modal, Versions ─── */
function downloadScraper(id) {
    window.open(`/api/scrapers/${id}/download`, '_blank');
}

/* ════════════════════════════════════════════════
   SCRAPERS
════════════════════════════════════════════════ */
async function loadScrapers() {
    const [scrapers, tags, queue] = await Promise.all([
        apiFetch(API.scrapers),
        apiFetch(API.tags).catch(() => []),
        apiFetch(API.queue).catch(() => []),
    ]);

    state.queueTasks = queue; // Update global state for 'Stop' button visibility

    const cacheKey = 'scrapers_' + state.activeTagFilter;
    const dataHash = JSON.stringify({ scrapers, tags, activeFilter: state.activeTagFilter, tz: state.timezone });
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
    const container = document.getElementById('scrapers-list');
    let filtered = scrapers;
    if (state.activeTagFilter) {
        filtered = scrapers.filter(s => s.tags && s.tags.some(t => String(t.id) === String(state.activeTagFilter)));
    }

    if (!filtered.length) {
        container.innerHTML = '<div class="empty-state">No scrapers match the current filter.</div>';
        return;
    }

    const tableRows = filtered.map(s => {
        const thumbUrl = s.thumbnail_url || '';
        const thumbHtml = thumbUrl
            ? `<img class="table-thumb" src="${thumbUrl}" alt="" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2280%22>🎌</text></svg>'">`
            : `<div class="table-thumb" style="display:flex;align-items:center;justify-content:center;background:var(--bg-input);font-size:18px">🎌</div>`;

        const tagsHtml = s.tags && s.tags.length
            ? `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px">${s.tags.map(t => `<span class="tag-pill-sm"><span class="tag-color-dot" style="background-color:${t.color || '#fff'}"></span>${t.name}</span>`).join('')}</div>`
            : '';

        const typeBadge = s.scraper_type === 'builder'
            ? `<span class="status-badge" style="background:rgba(16,185,129,0.1); color:#10b981; border:1px solid rgba(16,185,129,0.2)">🏗️ Builder</span>`
            : `<span class="status-badge" style="background:rgba(59,130,246,0.1); color:#3b82f6; border:1px solid rgba(59,130,246,0.2)">🐍 Python</span>`;

        const healthInfo = {
            ok: { icon: '✅', label: 'Healthy', cls: 'badge-success' },
            failing: { icon: '❌', label: 'Failing', cls: 'badge-failure' },
            untested: { icon: '⚙️', label: 'Untested', cls: 'badge-pending' },
        }[s.health || 'untested'];

        return `
        <tr draggable="true" 
            ondragstart="handleDragStart(event, 'scraper', ${s.id})"
            ondragover="handleDragOver(event)"
            ondragleave="handleDragLeave(event)"
            ondrop="handleDrop(event, 'scraper', ${s.id})"
            ondragend="handleDragEnd(event)">
            <td><div class="drag-handle">⠿</div></td>
            <td>${thumbHtml}</td>
            <td>
                <div style="font-weight:600; font-size:14px; color:var(--text-primary); display:flex; align-items:center; gap:8px">
                    ${s.name} ${s.latest_version ? `<span style="font-size:10px; color:var(--accent); background:var(--accent-glow); padding:1px 6px; border-radius:10px;">v${s.latest_version}</span>` : ''}
                </div>
                <div style="font-size:12px; color:#d1d5db; margin-top:2px;">${s.description || 'No description provided.'}</div>
                ${tagsHtml}
            </td>
            <td>${typeBadge}</td>
            <td>
                <div style="display:flex; flex-direction:column; gap:6px">
                    <span class="status-badge ${healthInfo.cls}" style="width:fit-content">${healthInfo.icon} ${healthInfo.label}</span>
                </div>
            </td>
            <td style="color:var(--text-secondary); white-space:nowrap"><span title="${formatDate(s.created_at)}">${formatDateOnly(s.created_at)}</span></td>
            <td style="color:var(--text-secondary); white-space:nowrap"><span title="${formatDate(s.updated_at)}">${formatDateOnly(s.updated_at)}</span></td>
            <td style="color:var(--text-secondary); white-space:nowrap"><span title="${formatDate(s.last_run)}">${formatRelativeDate(s.last_run)}</span></td>
            <td class="action-cell">
                <div style="display:flex; align-items:center; gap:8px">
                    <div class="action-btn-group">
                        <button class="icon-btn" onclick="openAssignTagsModal(${s.id})" title="Manage Tags">🏷️</button>
                        <button class="icon-btn" onclick="openAssignModal(${s.id})" title="Manage Integrations">🔗</button>
                        <button class="icon-btn" onclick="openVersionsModal(${s.id})" title="Version History">🕓${s.version_count ? ` <span class="ver-count-badge">${s.version_count}</span>` : ''}</button>
                        <button class="icon-btn" onclick="${s.scraper_type === 'builder' ? `editInBuilder(${s.id})` : `openEditModal(${s.id})`}" title="Edit">✏️</button>
                        <button class="icon-btn" onclick="duplicateScraper(${s.id})" title="Duplicate Scraper">📄</button>
                        <button class="icon-btn" onclick="downloadScraper(${s.id})" title="Download Code">📥</button>
                        <button class="icon-btn icon-btn-danger" onclick="deleteScraper(${s.id})" title="Delete">✕</button>
                    </div>
                        <button class="btn btn-run" style="padding: 6px 14px; min-width: 80px; justify-content: center;" onclick="runScraper(${s.id}, this)">Run</button>
                </div>
            </td>
        </tr>`;
    }).join('');

    container.innerHTML = `
    <div class="scrapers-table-container">
        <table class="scrapers-table">
            <thead>
                <tr>
                    <th style="width:30px"></th>
                    <th style="width:80px">Photo</th>
                    <th>Scraper Plugin</th>
                    <th style="width:100px">Type</th>
                    <th style="width:100px">Status</th>
                    <th style="width:100px">Created</th>
                    <th style="width:100px">Updated</th>
                    <th style="width:100px">Last Run</th>
                    <th class="action-cell">Actions</th>
                </tr>
            </thead>
            <tbody>
                ${tableRows}
            </tbody>
        </table>
    </div>`;
}

function integIcon(type) {
    if (type === 'discord_webhook') return '<img src="/static/discord.svg" style="width:24px;height:24px;vertical-align:middle;margin-right:8px">';
    if (type === 'http_request') return '<span style="font-size:24px;vertical-align:middle;margin-right:8px">🌐</span>';
    return '<span style="font-size:24px;vertical-align:middle;margin-right:8px">🔗</span>';
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
        btn.disabled = false; btn.textContent = 'Build Scraper';
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
    finally { btn.disabled = false; btn.textContent = 'Build Scraper'; }
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


async function deleteScraper(id) {
    if (!confirm('Delete this scraper? This will also remove its schedules and logs.')) return;
    try {
        await apiFetch(`${API.scrapers}/${id}`, { method: 'DELETE' });
        toast('Scraper deleted.', 'info');
        loadScrapers();
    } catch (e) { toast(e.message, 'error'); }
}

async function duplicateScraper(id) {
    if (!confirm('Duplicate this scraper (metadata, tags, and latest code)?')) return;
    try {
        await apiFetch(API.duplicateScraper(id), { method: 'POST' });
        toast('Scraper duplicated.', 'success');
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
   EDIT MODAL
════════════════════════════════════════════════ */
function openEditModal(id) {
    const s = state.scrapers.find(x => x.id === id);
    if (!s) return;

    // Reset Tabs
    switchEditTab('general', document.querySelector('[data-edit-tab="general"]'));

    document.getElementById('edit-id').value = id;
    document.getElementById('edit-name').value = s.name;
    document.getElementById('edit-homepage').value = s.homepage_url || '';
    document.getElementById('edit-desc').value = s.description || '';
    document.getElementById('edit-thumb').value = s.thumbnail_url || '';
    document.getElementById('edit-thumb-filename').textContent = '';

    // Browser Config
    const bConf = s.browser_config ? (typeof s.browser_config === 'string' ? JSON.parse(s.browser_config) : s.browser_config) : {};
    document.getElementById('edit-browser-headless').value = bConf.browser_headless !== undefined ? String(bConf.browser_headless) : '';
    document.getElementById('edit-browser-cdp').value = bConf.browser_cdp_url || '';

    // Reset code zone
    document.getElementById('edit-code-text').textContent = 'Drag & Drop a new .py file here';
    document.getElementById('edit-code-zone').style.borderColor = '';
    document.getElementById('edit-code-zone').style.background = '';
    document.getElementById('edit-code-file').value = '';

    // Versioning
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

function switchEditTab(tabName, btn) {
    // Buttons
    document.querySelectorAll('[data-edit-tab]').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');

    // Panes
    document.querySelectorAll('#edit-modal .wizard-pane').forEach(p => p.classList.remove('active'));
    const target = document.getElementById(`edit-tab-${tabName}`);
    if (target) target.classList.add('active');
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

    // Browser Config
    const bmode = document.getElementById('edit-browser-headless').value;
    const bcdp = document.getElementById('edit-browser-cdp').value.trim();
    const bConf = {};
    if (bmode !== '') bConf.browser_headless = bmode === 'true';
    if (bcdp !== '') bConf.browser_cdp_url = bcdp;
    formData.append('browser_config', JSON.stringify(bConf));

    try {
        await apiFetch(`${API.scrapers}/${id}`, {
            method: 'PATCH',
            body: formData,
        });
        toast('Scraper updated!', 'success');
        document.getElementById('edit-modal').style.display = 'none';
        loadScrapers();
    } catch (e) { toast(e.message, 'error'); }
    finally { btn.disabled = false; btn.textContent = 'Save Changes'; }
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
        let versions = await apiFetch(API.versions(scraperId));
        // Filter out Builder Sync versions
        versions = versions.filter(v => v.version_label !== 'Builder Sync');

        if (!versions.length) {
            list.innerHTML = '<div style="color:var(--text-muted);font-size:13px">No manual versions recorded yet.</div>';
            return;
        }
        list.innerHTML = versions.map(v => `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;border-radius:var(--radius-sm);border:1px solid var(--border-light);background:var(--bg-card)">
            <div style="flex:1;min-width:0">
                <span style="font-weight:600;color:var(--accent)">v${v.version_label || '?'}</span>
                <span style="font-size:12px;color:var(--text-muted);margin-left:10px">${formatDate(v.created_at)}</span>
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


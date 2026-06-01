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
        const thumbHtml = renderThumb(s.thumbnail_url);
        const tagsHtml = renderTags(s.tags);
        const typeHtml = s.scraper_type === 'builder'
            ? `<span class="status-badge" style="background:rgba(16,185,129,0.1); color:#10b981; border:1px solid rgba(16,185,129,0.2)">🏗️ Builder</span>`
            : `<span class="status-badge" style="background:rgba(59,130,246,0.1); color:#3b82f6; border:1px solid rgba(59,130,246,0.2)">🐍 Python</span>`;

        return `
        <tr draggable="true" 
            ondragstart="handleDragStart(event, 'scraper', ${s.id})"
            ondragover="handleDragOver(event)"
            ondragleave="handleDragLeave(event)"
            ondrop="handleDrop(event, 'scraper', ${s.id})"
            ondragend="handleDragEnd(event)">
            <td><div class="drag-handle">⠿</div></td>
            <td>${thumbHtml}</td>
            <td onclick="openWikiModal(${s.id})" style="cursor:pointer;" title="Click to view Wiki">
                <div style="font-weight:600; font-size:14px; color:var(--text-primary); display:flex; align-items:center; gap:8px">
                    ${s.name} ${s.latest_version ? `<span style="font-size:10px; color:var(--accent); background:var(--accent-glow); padding:1px 6px; border-radius:10px;">v${s.latest_version}</span>` : ''}
                </div>
                <div style="font-size:12px; color:#d1d5db; margin-top:2px;">${s.description || 'No description provided.'}</div>
                ${tagsHtml}
            </td>
            <td>${typeHtml}</td>
            <td>${healthBadge(s.health)}</td>
            <td style="color:var(--text-secondary); white-space:nowrap"><span title="${formatDate(s.created_at)}">${formatDateOnly(s.created_at)}</span></td>
            <td style="color:var(--text-secondary); white-space:nowrap"><span title="${formatDate(s.updated_at)}">${formatDateOnly(s.updated_at)}</span></td>
            <td style="color:var(--text-secondary); white-space:nowrap"><span title="${formatDate(s.last_run)}">${formatRelativeDate(s.last_run)}</span></td>
            <td class="action-cell">
                <div style="display:flex; align-items:center; gap:8px">
                    ${createActionGroup([
                        { icon: '🏷️', title: 'Manage Tags', onclick: `openAssignTagsModal(${s.id})` },
                        { icon: '🔗', title: 'Manage Integrations', onclick: `openAssignModal(${s.id})` },
                        { icon: '🕓', title: 'Version History', onclick: `openVersionsModal(${s.id})`, badge: s.version_count },
                        { icon: '📖', title: 'Wiki', onclick: `openWikiModal(${s.id})` },
                        { icon: '✏️', title: 'Edit', onclick: s.scraper_type === 'builder' ? `editInBuilder(${s.id})` : `openEditModal(${s.id})` },
                        { icon: '📄', title: 'Duplicate Scraper', onclick: `duplicateScraper(${s.id})` },
                        { icon: '📥', title: 'Download Code', onclick: `downloadScraper(${s.id})` },
                        { icon: '✕', title: 'Delete', onclick: `deleteScraper(${s.id})`, danger: true },
                    ])}
                    <button class="btn btn-run" style="padding: 6px 14px; min-width: 80px; justify-content: center;" onclick="runScraper(${s.id}, this)">Run</button>
                </div>
            </td>
        </tr>`;
    }).join('');

    container.innerHTML = createTableContainer(
        [
            { label: '', style: 'width:30px' },
            { label: 'Photo', style: 'width:80px' },
            { label: 'Scraper Plugin' },
            { label: 'Type', style: 'width:100px' },
            { label: 'Status', style: 'width:100px' },
            { label: 'Created', style: 'width:100px' },
            { label: 'Updated', style: 'width:100px' },
            { label: 'Last Run', style: 'width:100px' },
            { label: 'Actions', style: 'width:1%;white-space:nowrap' },
        ],
        tableRows,
        { className: 'scrapers-table-container', tableClass: 'scrapers-table' }
    );
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

    // Batch throttle override
    const throttleEl = document.getElementById('edit-batch-throttle');
    if (throttleEl) throttleEl.value = s.batch_throttle_seconds != null ? s.batch_throttle_seconds : '';

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

    // Wiki
    const wikiEl = document.getElementById('edit-wiki-content');
    if (wikiEl) wikiEl.value = s.wiki_content || '';

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

    // Per-scraper batch throttle
    const throttleEl = document.getElementById('edit-batch-throttle');
    if (throttleEl) formData.append('batch_throttle_seconds', throttleEl.value.trim());

    // Wiki content
    const wikiEl = document.getElementById('edit-wiki-content');
    if (wikiEl) formData.append('wiki_content', wikiEl.value);

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
function closeVersionsModal(e) {
    if (e && e.target !== document.getElementById('versions-modal')) return;
    document.getElementById('versions-modal').style.display = 'none';
    const area = document.getElementById('ver-code-area');
    area.style.display = 'none';
    document.getElementById('ver-code-view').textContent = '';
    document.getElementById('ver-code-view').style.display = '';
    const flowDiv = area.querySelector('.ver-flow-canvas');
    if (flowDiv) flowDiv.remove();
}

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
        if (data.flow_data) {
            label.textContent = `v${versionLabel} \u2014 VISUAL FLOW`;
            pre.style.display = 'none';
            let flowDiv = area.querySelector('.ver-flow-canvas');
            if (!flowDiv) {
                flowDiv = document.createElement('div');
                flowDiv.className = 'ver-flow-canvas';
                flowDiv.style.cssText = 'height:380px;border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden;display:flex;flex-direction:column';
                area.appendChild(flowDiv);
            }
            flowDiv.innerHTML = '';
            const previewEl = buildFlowPreviewEl(data.flow_data);
            if (previewEl) flowDiv.appendChild(previewEl);
        } else {
            pre.style.display = '';
            const flowDiv = area.querySelector('.ver-flow-canvas');
            if (flowDiv) flowDiv.remove();
            pre.textContent = data.code;
        }
    } catch (e) { pre.textContent = `Error: ${e.message}`; }
}

function openFlowPreviewModal(flowData, title) {
    const wrap = document.getElementById('flow-preview-canvas');
    wrap.innerHTML = '';
    document.getElementById('flow-preview-title').textContent = title || 'Flow Preview';
    const el = buildFlowPreviewEl(flowData);
    if (el) wrap.appendChild(el);
    document.getElementById('flow-preview-modal').style.display = 'flex';
}

/* Build a self-contained read-only builder canvas (pan + zoom only, no editing). */
function buildFlowPreviewEl(flowData) {
    if (!flowData) return null;
    const nodes = flowData.nodes || [];
    const edges = flowData.edges || [];
    if (!nodes.length) {
        const empty = document.createElement('div');
        empty.style.cssText = 'color:var(--text-muted);padding:24px;font-size:13px';
        empty.textContent = 'No flow nodes.';
        return empty;
    }

    const pfx = `fp${Date.now().toString(36)}`;
    const svgNS = 'http://www.w3.org/2000/svg';
    const boolPresets = ['logic_gate', 'conditional', 'comparison', 'string_match', 'status_check', 'custom_logic'];

    // Root wrapper
    const root = document.createElement('div');
    root.style.cssText = 'flex:1;display:flex;flex-direction:column;min-height:0;overflow:hidden';

    // Mini toolbar
    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;align-items:center;gap:8px;padding:5px 10px;border-bottom:1px solid var(--border-light);background:var(--bg-card);flex-shrink:0;font-size:11px;color:var(--text-muted);user-select:none';
    bar.innerHTML = `<span style="opacity:.5">Read-only</span><span style="opacity:.5;margin-left:auto">Drag to pan · Scroll to zoom</span>`;
    const fitBtn = document.createElement('button');
    fitBtn.className = 'btn btn-ghost btn-sm';
    fitBtn.style.cssText = 'font-size:10px;padding:2px 8px;margin-left:8px';
    fitBtn.textContent = 'Fit';
    bar.appendChild(fitBtn);

    // Viewport
    const viewport = document.createElement('div');
    viewport.style.cssText = 'flex:1;position:relative;overflow:hidden;cursor:grab;background:var(--bg-input);background-image:radial-gradient(circle,rgba(255,255,255,.045) 1px,transparent 1px);background-size:30px 30px;min-height:0';

    // Canvas (pan/zoom target)
    const canvas = document.createElement('div');
    canvas.style.cssText = 'position:absolute;top:0;left:0;transform-origin:0 0;will-change:transform';

    // SVG for connections (infinite, behind nodes)
    const svg = document.createElementNS(svgNS, 'svg');
    svg.style.cssText = 'position:absolute;top:0;left:0;width:8000px;height:8000px;pointer-events:none;overflow:visible';
    // Arrow marker
    const defs = document.createElementNS(svgNS, 'defs');
    const marker = document.createElementNS(svgNS, 'marker');
    marker.setAttribute('id', `${pfx}-arr`);
    marker.setAttribute('markerWidth', '8');
    marker.setAttribute('markerHeight', '6');
    marker.setAttribute('refX', '8');
    marker.setAttribute('refY', '3');
    marker.setAttribute('orient', 'auto');
    const poly = document.createElementNS(svgNS, 'polygon');
    poly.setAttribute('points', '0 0, 8 3, 0 6');
    poly.setAttribute('fill', 'rgba(124,106,247,0.55)');
    marker.appendChild(poly);
    defs.appendChild(marker);
    svg.appendChild(defs);

    // Nodes container
    const nodesDiv = document.createElement('div');
    nodesDiv.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none';

    canvas.appendChild(svg);
    canvas.appendChild(nodesDiv);
    viewport.appendChild(canvas);
    root.appendChild(bar);
    root.appendChild(viewport);

    // Pan/zoom state
    const ps = { x: 0, y: 0, zoom: 0.85 };

    const applyT = () => {
        canvas.style.transform = `translate(${ps.x}px,${ps.y}px) scale(${ps.zoom})`;
    };

    // ── Render nodes (same CSS classes as real builder) ──
    nodes.forEach(node => {
        const nodeTypes = NODE_PRESETS[node.type];
        const preset = nodeTypes && node.preset ? nodeTypes[node.preset] : null;

        const el = document.createElement('div');
        el.className = `builder-node builder-node--${node.type}${node.preset ? ' builder-node--' + node.preset : ''}`;
        if (node.type === 'utility') el.classList.add('builder-node--mini');
        el.style.cssText = `position:absolute;left:${node.x}px;top:${node.y}px;pointer-events:none`;
        if (node.width) el.style.width = `${node.width}px`;

        // Title (styled as the real title input, but a div)
        const titleEl = document.createElement('div');
        titleEl.className = `builder-node__title builder-node__title--${node.type} node-title-input`;
        titleEl.style.cssText = 'cursor:default;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
        titleEl.textContent = (node.config && node.config.internalLabel) || (preset && preset.title) || node.label || node.preset || node.type;
        el.appendChild(titleEl);

        // Ports body
        const portsBody = document.createElement('div');
        portsBody.className = 'node-ports-body';
        const inputCol = document.createElement('div');
        inputCol.className = 'node-ports-col node-ports-col--input';
        const outputCol = document.createElement('div');
        outputCol.className = 'node-ports-col node-ports-col--output';

        // Inputs
        let nodeInputs = [];
        if (node.dynamic_ports && node.dynamic_ports.length > 0) {
            nodeInputs = node.dynamic_ports;
        } else if (preset && preset.logicalInputs) {
            const count = Number((node.config && node.config.logicalInputs) || preset.logicalInputs);
            for (let i = 1; i <= count; i++) nodeInputs.push(`In ${i}`);
        } else if (node.preset === 'conditional') {
            nodeInputs = ['Input A', 'Input B'];
        } else {
            nodeInputs = (preset && preset.inputs) || [];
        }

        nodeInputs.forEach((lbl, idx) => {
            const row = document.createElement('div');
            row.className = 'node-port-row node-port-row--input';
            const port = document.createElement('div');
            port.className = 'node-port node-port--input';
            port.id = `${pfx}-node-${node.id}-input-${idx}`;
            const label = document.createElement('span');
            label.className = 'node-port-label';
            label.textContent = lbl;
            row.appendChild(port);
            row.appendChild(label);
            inputCol.appendChild(row);
        });

        // Trigger port
        if (node.type !== 'input' && node.type !== 'utility' && node.preset !== 'negate') {
            const row = document.createElement('div');
            row.className = 'node-port-row node-port-row--input node-port-row--universal';
            const port = document.createElement('div');
            port.className = 'node-port node-port--input node-port--trigger';
            port.id = `${pfx}-node-${node.id}-input-trigger`;
            const label = document.createElement('span');
            label.className = 'node-port-label node-port-label--trigger';
            label.textContent = 'Trigger';
            row.appendChild(port);
            row.appendChild(label);
            inputCol.appendChild(row);
        }

        // Outputs
        let nodeOutputs = [];
        if (preset && preset.logicalOutputs) {
            const count = Number((node.config && node.config.logicalOutputs) || preset.logicalOutputs);
            for (let i = 1; i <= count; i++) nodeOutputs.push(`Out ${i}`);
        } else {
            nodeOutputs = (preset && preset.outputs) || [];
        }

        nodeOutputs.forEach((lbl, idx) => {
            const row = document.createElement('div');
            row.className = 'node-port-row node-port-row--output';
            const port = document.createElement('div');
            let portCls = 'node-port node-port--output';
            if (node.type === 'logic' && boolPresets.includes(node.preset)) {
                portCls += idx === 0 ? ' node-port--true' : ' node-port--false';
            }
            port.className = portCls;
            port.id = `${pfx}-node-${node.id}-output-${idx}`;
            const label = document.createElement('span');
            label.className = `node-port-label${node.type === 'logic' && boolPresets.includes(node.preset) ? (idx === 0 ? ' node-port-label--true' : ' node-port-label--false') : ''}`;
            label.textContent = lbl;
            row.appendChild(label);
            row.appendChild(port);
            outputCol.appendChild(row);
        });

        // Error port
        if (node.type !== 'input' && node.type !== 'sink' && node.type !== 'utility' && node.preset !== 'negate') {
            const row = document.createElement('div');
            row.className = 'node-port-row node-port-row--output node-port-row--universal';
            const port = document.createElement('div');
            port.className = 'node-port node-port--output node-port--error';
            port.id = `${pfx}-node-${node.id}-output-error`;
            const label = document.createElement('span');
            label.className = 'node-port-label node-port-label--error';
            label.textContent = 'Error';
            row.appendChild(label);
            row.appendChild(port);
            outputCol.appendChild(row);
        }

        portsBody.appendChild(inputCol);
        portsBody.appendChild(outputCol);
        el.appendChild(portsBody);
        nodesDiv.appendChild(el);
    });

    // ── Draw SVG connections ──
    const drawConnections = () => {
        // Clear existing paths (keep defs)
        Array.from(svg.children).forEach(c => { if (c.tagName !== 'defs') c.remove(); });

        const canvasRect = canvas.getBoundingClientRect();
        if (!canvasRect.width) return; // Not yet laid out

        const portPos = (nodeId, type, idx) => {
            const portEl = document.getElementById(`${pfx}-node-${nodeId}-${type}-${idx}`);
            if (portEl) {
                const r = portEl.getBoundingClientRect();
                if (r.width > 0) {
                    return {
                        x: (r.left + r.width / 2 - canvasRect.left) / ps.zoom,
                        y: (r.top + r.height / 2 - canvasRect.top) / ps.zoom,
                    };
                }
            }
            // Geometric fallback
            const n = nodes.find(n => String(n.id) === String(nodeId));
            if (!n) return { x: 0, y: 0 };
            const nw = n.width || 220;
            return {
                x: type === 'input' ? n.x : n.x + nw,
                y: n.y + 52 + (typeof idx === 'number' ? idx : 0) * 24,
            };
        };

        edges.forEach(edge => {
            if (edge.from === undefined || edge.to === undefined) return;
            const from = portPos(edge.from, 'output', edge.fromIdx);
            const to = portPos(edge.to, 'input', edge.toIdx);

            const path = document.createElementNS(svgNS, 'path');
            let cls = 'connection-path';
            if (edge.sourceHandle === 'true') cls += ' connection-path--true';
            else if (edge.sourceHandle === 'false') cls += ' connection-path--false';
            else if (edge.sourceHandle === 'trigger') cls += ' connection-path--trigger';
            else if (edge.sourceHandle === 'error') cls += ' connection-path--error';
            path.setAttribute('class', cls);
            path.setAttribute('d', getBezierPath(from.x, from.y, to.x, to.y));
            path.setAttribute('marker-end', `url(#${pfx}-arr)`);
            svg.appendChild(path);
        });
    };

    // ── Pan / Zoom ──
    viewport.addEventListener('mousedown', e => {
        if (e.button !== 0) return;
        e.preventDefault();
        const startX = e.clientX - ps.x;
        const startY = e.clientY - ps.y;
        viewport.style.cursor = 'grabbing';

        const onMove = ev => {
            ps.x = ev.clientX - startX;
            ps.y = ev.clientY - startY;
            applyT();
            requestAnimationFrame(drawConnections);
        };
        const onUp = () => {
            viewport.style.cursor = 'grab';
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });

    viewport.addEventListener('wheel', e => {
        e.preventDefault();
        const vRect = viewport.getBoundingClientRect();
        const mx = e.clientX - vRect.left;
        const my = e.clientY - vRect.top;
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        const oldZoom = ps.zoom;
        ps.zoom = Math.min(Math.max(ps.zoom * delta, 0.1), 3.0);
        ps.x = mx - (mx - ps.x) * (ps.zoom / oldZoom);
        ps.y = my - (my - ps.y) * (ps.zoom / oldZoom);
        applyT();
        requestAnimationFrame(drawConnections);
    }, { passive: false });

    // ── Fit-to-view ──
    const fitView = () => {
        const vRect = viewport.getBoundingClientRect();
        if (!vRect.width) return;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        nodes.forEach(n => {
            minX = Math.min(minX, n.x);
            minY = Math.min(minY, n.y);
            maxX = Math.max(maxX, n.x + (n.width || 220));
            maxY = Math.max(maxY, n.y + (n.height || 120));
        });
        const pad = 40;
        const fw = maxX - minX + pad * 2;
        const fh = maxY - minY + pad * 2;
        ps.zoom = Math.min(vRect.width / fw, vRect.height / fh, 1.5);
        ps.x = (vRect.width - fw * ps.zoom) / 2 - (minX - pad) * ps.zoom;
        ps.y = (vRect.height - fh * ps.zoom) / 2 - (minY - pad) * ps.zoom;
        applyT();
        requestAnimationFrame(drawConnections);
    };

    fitBtn.addEventListener('click', fitView);

    // Initial fit after layout
    requestAnimationFrame(() => requestAnimationFrame(() => {
        fitView();
    }));

    return root;
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


/* ════════════════════════════════════════════════
   WIKI MODAL
════════════════════════════════════════════════ */
let _wikiScraperId = null;
let _wikiEditMode = false;

function openWikiModal(id) {
    const s = state.scrapers.find(x => x.id === id);
    if (!s) return;
    _wikiScraperId = id;
    _wikiEditMode = false;

    document.getElementById('wiki-modal-title').textContent = s.name + ' — Wiki';
    document.getElementById('wiki-editor').value = s.wiki_content || '';
    _renderWikiView(s.wiki_content || '');

    document.getElementById('wiki-view').style.display = '';
    document.getElementById('wiki-editor').style.display = 'none';
    document.getElementById('wiki-edit-btn').textContent = 'Edit';
    document.getElementById('wiki-edit-footer').style.display = 'none';
    document.getElementById('wiki-modal').style.display = 'flex';
}

function closeWikiModal(e) {
    if (e && e.target !== document.getElementById('wiki-modal')) return;
    document.getElementById('wiki-modal').style.display = 'none';
    _wikiScraperId = null;
}

function toggleWikiEdit() {
    _wikiEditMode = !_wikiEditMode;
    document.getElementById('wiki-view').style.display = _wikiEditMode ? 'none' : '';
    document.getElementById('wiki-editor').style.display = _wikiEditMode ? '' : 'none';
    document.getElementById('wiki-edit-btn').textContent = _wikiEditMode ? 'Preview' : 'Edit';
    document.getElementById('wiki-edit-footer').style.display = _wikiEditMode ? 'flex' : 'none';
    if (!_wikiEditMode) {
        _renderWikiView(document.getElementById('wiki-editor').value);
    }
}

function cancelWikiEdit() {
    const s = state.scrapers.find(x => x.id === _wikiScraperId);
    if (s) document.getElementById('wiki-editor').value = s.wiki_content || '';
    _wikiEditMode = false;
    const s2 = state.scrapers.find(x => x.id === _wikiScraperId);
    _renderWikiView(s2 ? s2.wiki_content || '' : '');
    document.getElementById('wiki-view').style.display = '';
    document.getElementById('wiki-editor').style.display = 'none';
    document.getElementById('wiki-edit-btn').textContent = 'Edit';
    document.getElementById('wiki-edit-footer').style.display = 'none';
}

async function saveWiki() {
    if (!_wikiScraperId) return;
    const s = state.scrapers.find(x => x.id === _wikiScraperId);
    if (!s) return;
    const content = document.getElementById('wiki-editor').value;
    const fd = new FormData();
    fd.append('name', s.name);
    fd.append('wiki_content', content);
    try {
        await apiFetch(`${API.scrapers}/${_wikiScraperId}`, { method: 'PATCH', body: fd });
        if (s) s.wiki_content = content;
        toast('Wiki saved!', 'success');
        toggleWikiEdit();
    } catch (e) { toast(e.message, 'error'); }
}

function _renderWikiView(md) {
    if (!md || !md.trim()) {
        document.getElementById('wiki-view').innerHTML = '<span style="color:var(--text-muted); font-style:italic; font-size:13px">No wiki content yet. Click Edit to add documentation.</span>';
        return;
    }
    // Basic markdown → HTML (no library dependency)
    let html = md
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/^### (.+)$/gm, '<h3>$1</h3>')
        .replace(/^## (.+)$/gm, '<h2>$1</h2>')
        .replace(/^# (.+)$/gm, '<h1>$1</h1>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/`([^`]+)`/g, '<code style="background:var(--bg-input);padding:1px 5px;border-radius:3px;font-family:monospace;font-size:12px">$1</code>')
        .replace(/^- (.+)$/gm, '<li>$1</li>')
        .replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
        .replace(/\n{2,}/g, '</p><p>')
        .replace(/\n/g, '<br>');
    document.getElementById('wiki-view').innerHTML = '<p>' + html + '</p>';
}

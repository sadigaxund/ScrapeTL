/* ── Schedules Tab: List, Create, Edit, Delete ─── */
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

        const dataHash = JSON.stringify({ filtered, tags: state.tags, activeFilter: state.activeScheduleTagFilter, tz: state.timezone });
        if (responseCache['schedules_rendered'] === dataHash) return;
        responseCache['schedules_rendered'] = dataHash;

        console.log(`[Schedules] Rendering ${filtered.length}/${schedules.length} items (Filter: ${state.activeScheduleTagFilter || 'None'})`);



        document.getElementById('schedule-count').textContent = filtered.length;
        const list = document.getElementById('schedules-list');
        if (!filtered.length) {
            list.innerHTML = `<div class="empty-state">${state.activeScheduleTagFilter ? 'No schedules match the current tag filter.' : 'No schedules configured.'}</div>`;
            return;
        }

        const tableRows = filtered.map(s => {
            const displayName = s.label || s.scraper_name || 'Unnamed Schedule';
            const subtitle = s.label ? s.scraper_name : null;
            const thumbUrl = s.thumbnail_url || '';
            const thumbHtml = thumbUrl
                ? `<img class="table-thumb" src="${thumbUrl}" alt="" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2280%22>🎌</text></svg>'">`
                : `<div class="table-thumb" style="display:flex;align-items:center;justify-content:center;background:var(--bg-input);font-size:18px">🎌</div>`;

            const tagsHtml = s.tags && s.tags.length
                ? `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px">${s.tags.map(t => `<span class="tag-pill-sm"><span class="tag-color-dot" style="background-color:${t.color || '#fff'}"></span>${t.name}</span>`).join('')}</div>`
                : '';

            const inputs = s.input_values && Object.keys(s.input_values).length
                ? Object.entries(s.input_values).map(([k, v]) =>
                    `<span class="sched-param"><b>${k}</b>: ${v}</span>`
                ).join('')
                : null;

            const freqBadge = `<span class="status-badge" style="background:rgba(124, 106, 247, 0.1); color:#c4b5fd; border:1px solid rgba(124, 106, 247, 0.2); font-size:11px; font-family:monospace; padding: 2px 8px; border-radius: 4px;">${s.cron_expression}</span>`;

            return `
            <tr draggable="true" 
                ondragstart="handleDragStart(event, 'schedule', ${s.id})"
                ondragover="handleDragOver(event)"
                ondragleave="handleDragLeave(event)"
                ondrop="handleDrop(event, 'schedule', ${s.id})"
                ondragend="handleDragEnd(event)">
                <td><div class="drag-handle">⠿</div></td>
                <td>${thumbHtml}</td>
                <td>
                    <div style="font-weight:600; font-size:14px; color:var(--text-primary); display:flex; align-items:center; gap:8px">
                        ${displayName}
                        ${inputs ? `<button class="icon-btn-inline" onclick="toggleSchedExpand(event, ${s.id})" title="View Parameters" style="font-size:12px; opacity:0.6; cursor:pointer; background:none; border:none; padding:0">🔍</button>` : ''}
                    </div>
                    ${subtitle ? `<div style="font-size:12px; color:#d1d5db; margin-top:2px;">${subtitle}</div>` : ''}
                    ${tagsHtml}
                </td>
                <td>${freqBadge}</td>
                <td>
                    <span class="status-badge ${s.enabled ? 'badge-enabled' : 'badge-disabled'}" style="width:fit-content">
                        ${s.enabled ? '● Active' : '○ Disabled'}
                    </span>
                </td>
                <td style="color:var(--text-secondary); white-space:nowrap"><span title="${formatDate(s.created_at || '')}">${formatDateOnly(s.created_at || '')}</span></td>
                <td style="color:var(--text-secondary); white-space:nowrap"><span title="${s.next_run ? formatDate(s.next_run) : 'Not scheduled'}">${s.next_run ? formatDateOnly(s.next_run) : 'N/A'}</span></td>
                <td style="color:var(--text-secondary); white-space:nowrap"><span title="${s.last_run ? formatDate(s.last_run) : 'Never run'}">${s.last_run ? formatRelativeDate(s.last_run) : 'Never'}</span></td>
                <td class="action-cell">
                    <div style="display:flex; align-items:center; gap:8px" onclick="event.stopPropagation()">
                        <div class="action-btn-group">
                            <button class="icon-btn" onclick="openAssignTagsModal(${s.id}, 'schedule')" title="Manage Tags">🏷️</button>
                            <button class="icon-btn" onclick="openEditScheduleModal(${s.id})" title="Edit Schedule">✏️</button>
                            <button class="icon-btn" onclick="duplicateSchedule(${s.id})" title="Duplicate Schedule">📄</button>
                            <button class="icon-btn icon-btn-danger" onclick="deleteSchedule(${s.id})" title="Delete">✕</button>
                        </div>
                        <button class="btn ${s.enabled ? 'btn-danger' : 'btn-success'}" style="padding: 6px 14px; min-width: 100px; font-size: 12px;" onclick="toggleSchedule(${s.id})">
                            ${s.enabled ? '⏹ Disable' : '▶ Enable'}
                        </button>
                    </div>
                </td>
            </tr>
            ${inputs ? `
            <tr class="sched-expand-row" id="sched-expand-${s.id}" style="display:none; background:rgba(255,255,255,0.01)">
                <td colspan="9" style="padding: 16px 24px; border-bottom: 1px solid var(--border-light); border-left: 4px solid var(--accent)">
                    <div style="display:flex; flex-direction:column; gap:10px">
                        <div style="font-size:10px; font-weight:700; color:var(--accent); text-transform:uppercase; letter-spacing:0.05em">⚙ Scheduled Parameters</div>
                        <div class="sched-inputs-grid" style="display:flex; flex-wrap:wrap; gap:12px">${inputs}</div>
                    </div>
                </td>
            </tr>` : ''}`;
        }).join('');

        list.innerHTML = `
        <div class="scrapers-table-container">
            <table class="scrapers-table">
                <thead>
                    <tr>
                        <th style="width:30px"></th>
                        <th style="width:80px">Photo</th>
                        <th>Schedule / Scraper</th>
                        <th style="width:100px">Frequency</th>
                        <th style="width:100px">Status</th>
                        <th style="width:100px">Created</th>
                        <th style="width:100px">Next Run</th>
                        <th style="width:100px">Last Run</th>
                        <th class="action-cell">Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${tableRows}
                </tbody>
            </table>
        </div>`;
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
        toast(`Schedule created! Next run: ${formatDate(res.next_run)}`, 'success');

        // Reset form
        document.getElementById('sched-cron').value = '';
        document.getElementById('sched-label').value = '';
        document.getElementById('sched-scraper').value = '';
        document.getElementById('summary-sched-scraper').innerHTML = `<span>- Select -</span> <span style="font-size:10px;opacity:0.5">▼</span>`;
        document.getElementById('summary-sched-preset').innerHTML = `<span>Presets</span> <span style="font-size:10px; opacity:0.5">▼</span>`;
        document.getElementById('sched-thumb-url').value = '';
        document.getElementById('sched-thumb-file').value = '';
        document.getElementById('sched-params-container').innerHTML = '<div class="empty-state" style="padding:40px 0; opacity:0.3; font-size:13px">Select a scraper to view available parameters.</div>';
        previewSchedThumb('');

        loadSchedules();
    } catch (e) { toast(e.message, 'error'); }
}

function toggleSchedExpand(event, id) {
    if (event.target.closest('.action-btn-group')) return;
    const el = document.getElementById(`sched-expand-${id}`);
    if (!el) return;

    // Toggle using display style for table rows
    const isHidden = el.style.display === 'none';
    el.style.display = isHidden ? 'table-row' : 'none';
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
        const rawVal = values[inp.name] !== undefined ? values[inp.name] : (inp.default || '');
        const displayVal = formatValueForUI(rawVal);
        return `
            <div class="form-group" style="min-width: 0; flex: 1;">
                <label style="font-size: 11px;">${inp.label}${inp.required ? ' *' : ''}</label>
                <input type="text" class="edit-sched-input-field" data-name="${inp.name}" value="${displayVal}" placeholder="${inp.description || ''}" />
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
   LOGS - collapsible card view

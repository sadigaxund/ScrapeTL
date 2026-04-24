/* ── Queue Tab: Task List, Sort, One-Time Modal ─── */
/* ════════════════════════════════════════════════
   QUEUE
════════════════════════════════════════════════ */
async function loadQueue() {
    try {
        const tasks = await apiFetch(API.queue);

        const dataHash = JSON.stringify({ tasks, tz: state.timezone });
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
            ? `<button class="icon-btn icon-btn-danger" style="padding:4px 8px" onclick="removeQueueTask(${t.id})" title="Remove from Queue">✕</button>`
            : '';

        // Try to find scraper info for thumbnail
        let thumbHtml = `<div class="table-thumb" style="display:flex;align-items:center;justify-content:center;background:var(--bg-input);font-size:18px">🎌</div>`;
        if (state.scrapers) {
            const scraper = state.scrapers.find(s => s.name === t.scraper_name);
            if (scraper && scraper.thumbnail_url) {
                thumbHtml = `<img class="table-thumb" src="${scraper.thumbnail_url}" alt="" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2280%22>🎌</text></svg>'">`;
            }
        }

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
            <td></td>
            <td>${thumbHtml}</td>
            <td>
                <div style="font-weight:600; font-size:14px; color:var(--text-primary)">${t.scraper_name || 'N/A'}</div>
            </td>
            <td style="white-space:nowrap"><span style="color:var(--text-primary); font-weight:500;">${formatDateOnCondition(t.scheduled_for)}</span>${timeLeftStr}</td>
            <td><div style="font-size:12px; color:#d1d5db; max-width:200px; overflow:hidden; text-overflow:ellipsis">${t.note || '-'}</div></td>
            <td>${statusBadge(t.status)}</td>
            <td style="text-align:right">${removeBtn}</td>
        </tr>`;
    }).join('');
}

function formatDateOnCondition(isoStr) {
    if (!isoStr) return '-';
    const d = new Date(isoStr);
    const now = new Date();
    // If it's today, show only time, else show date only
    if (d.toDateString() === now.toDateString()) {
        return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    }
    return formatDateOnly(isoStr);
}

/* ════════════════════════════════════════════════
   ONE-TIME TASK
   ════════════════════════════════════════════════ */
function openOneTimeModal() {
    const sel = document.getElementById('ot-scraper');
    const menu = document.getElementById('ot-menu-scrapers');
    const summary = document.getElementById('summary-ot-scraper');

    if (!state.scrapers.length) {
        menu.innerHTML = '<div style="padding:12px;color:var(--text-muted)">No scrapers found</div>';
    } else {
        menu.innerHTML = `
            <div class="dropdown-search">
                <input type="text" placeholder="Search scrapers..." onkeyup="filterDropdownConfig(this)" onclick="event.stopPropagation()" />
            </div>
            <div class="dropdown-scroll-area">
                ${state.scrapers.map(s => `
                    <button class="dropdown-item" onclick="selectOneTimeScraper(${s.id}, '${s.name.replace(/'/g, "\\'")}')">${s.name}</button>
                `).join('')}
            </div>
        `;

        // Use existing selection or default to first scraper
        const currentSid = sel.value;
        const activeScraper = state.scrapers.find(s => String(s.id) === String(currentSid)) || state.scrapers[0];

        if (activeScraper) {
            selectOneTimeScraper(activeScraper.id, activeScraper.name);
        }
    }

    document.getElementById('ot-time').value = '';
    document.getElementById('ot-note').value = '';

    const modal = document.getElementById('one-time-modal');
    if (modal) modal.style.display = 'flex';
}

function selectOneTimeScraper(id, name) {
    const sel = document.getElementById('ot-scraper');
    const summary = document.getElementById('summary-ot-scraper');

    sel.value = id;
    summary.innerHTML = `<span>${name}</span> <span style="font-size:10px; opacity:0.5">▼</span>`;

    document.querySelectorAll('#ot-menu-scrapers .dropdown-item').forEach(item => {
        item.classList.toggle('dropdown-item--active', item.textContent === name);
    });

    // Close dropdown
    document.getElementById('dd-ot-scraper').classList.remove('open');

    // Trigger params render
    renderOneTimeParams();
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
                input_values: inputValues,
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

/* ── Logs Tab: Filter, Render, Expand/Collapse, Download ─── */
function renderLogFilters() {
    // Get active item instances
    const aScrap = state.scrapers.find(s => String(s.id) === state.logFilters.scraperId);
    const aTag = state.tags.find(t => String(t.id) === state.logFilters.tagId);
    const statuses = [
        { id: '', label: 'All', color: 'transparent' },
        { id: 'running', label: 'Running', color: 'var(--running)' },
        { id: 'success', label: 'Success', color: 'var(--success)' },
        { id: 'failure', label: 'Failure', color: 'var(--failure)' },
        { id: 'skipped', label: 'Skipped', color: 'var(--cancelled)' },
        { id: 'cancelled', label: 'Cancelled', color: 'var(--cancelled)' }
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
        stHtml += `<button class="dropdown-item ${state.logFilters.status === st.id ? 'dropdown-item--active' : ''}" onclick="setLogFilter('status', '${st.id}')">
            <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${st.color};margin-right:8px"></span> ${st.label}
        </button>`;
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

        const dataHash = JSON.stringify({ data, filters: state.logFilters, page: state.currentLogsPage, tz: state.timezone });
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
            const hasDetails = log.payload || (log.debug_payload && log.debug_payload.length > 0) || log.error_msg || isRunning || log.status !== 'pending';
            const isExpanded = state.expandedLogs.has(detailsId);
            const attempts = (log.retry_count || 0) + 1;
            const retryBadge = (attempts > 1)
                ? `<span class="status-badge badge-pending" title="${attempts} total execution attempts">🔄 ${attempts} attempts</span>`
                : '';

            return `
            <div class="log-card ${isRunning ? 'log-card--running' : ''}" data-status="${log.status}">
                <div class="log-card-header" ${hasDetails ? `onclick="toggleLogDetails('${detailsId}')"` : ''} style="${hasDetails ? 'cursor:pointer' : ''}">
                    <div class="log-col-status">${statusBadge(log.status)}</div>
                    <div class="log-col-scraper">
                        <strong>${log.scraper_name || 'N/A'}</strong>
                        ${log.input_params && Object.keys(log.input_params).length > 0 ? `<div class="log-input-params">${Object.entries(log.input_params).map(([k,v]) => {
                            const display = Array.isArray(v) ? `[...${v.length}]` : (String(v).length > 40 ? String(v).substring(0, 40) + '...' : String(v));
                            return `<span class="log-input-chip"><b>${k}:</b> ${display}</span>`;
                        }).join('')}</div>` : ''}
                    </div>
                    <div class="log-col-eps">
                        <span class="log-epcount" style="display: ${log.episode_count ? 'inline-flex' : 'none'}">${log.episode_count} found</span>
                    </div>
                    <div class="log-col-retry" style="display:flex; justify-content:center;">${retryBadge}</div>
                    <div class="log-col-trigger">${statusBadge(log.triggered_by)}</div>
                    <div class="log-col-time"><span class="log-time">${formatDate(log.run_at)}</span></div>
                    <div class="log-col-stop" style="text-align:right">
                        ${isRunning ? `<button class="btn btn-stop" style="padding:4px 10px; background:rgba(239, 68, 68, 0.1); color:var(--failure); border:1px solid rgba(239, 68, 68, 0.2); font-size:11px" onclick="event.stopPropagation(); stopScraperRun(${log.task_id || log.id})">🛑 Stop</button>` : ''}
                    </div>
                    <div class="log-col-icon" style="text-align:right;">${hasDetails ? `<span class="log-expand-icon" id="icon-${detailsId}">${isExpanded ? '▼' : '▶'}</span>` : ''}</div>
                </div>
                ${hasDetails ? `
                <div class="log-details" id="${detailsId}" style="display:${isExpanded ? 'block' : 'none'}">
                    <div class="log-tabs" style="display:flex; gap:8px; margin-bottom:12px; border-bottom:1px solid var(--border-light); padding-bottom:8px; align-items:center;">
                        <button class="log-tab-btn active" onclick="switchLogTab('${log.id}', 'results', this)">Results</button>
                        ${log.debug_payload && log.debug_payload.length > 0 ? `
                        <button class="log-tab-btn" onclick="switchLogTab('${log.id}', 'debug', this)">Debug Assets (${log.debug_payload.length})</button>
                        ` : ''}
                        <button class="log-tab-btn" onclick="switchLogTab('${log.id}', 'system', this); startLogTabStream('${log.task_id || log.id}', '${log.id}', '${(log.scraper_name || 'N/A').replace(/'/g, "\\'")}')">System Logs</button>
                        ${log.log_file_path ? `<button class="btn btn-ghost btn-sm" style="margin-left:auto; font-size:10px; padding:2px 8px;" onclick="event.stopPropagation(); downloadSystemLog(${log.id})">Download Log</button>` : ''}
                    </div>

                    ${isRunning ? `<div class="log-running-msg">Execution in progress. Results will be available after completion.</div>` : ''}
                    ${log.error_msg && !isRunning ? (log.status === 'skipped' ? `<div class="log-skipped-msg">⏭ ${log.error_msg}</div>` : `<div class="log-error">❌ ${log.error_msg}</div>`) : ''}


                    <div id="log-content-results-${log.id}">
                        ${log.payload ? `
                        <div class="payload-download-bar">
                            <span class="payload-download-label">Download payload:</span>
                            <button class="btn-dl" onclick="downloadLogPayload(${log.id}, 'json')" title="Download JSON">⬇ JSON</button>
                            <button class="btn-dl" onclick="downloadLogPayload(${log.id}, 'csv')" title="Download CSV">⬇ CSV</button>
                        </div>
                        ${renderPayload(log.payload, log.episode_count)}` : ''}
                    </div>

                    <div id="log-content-debug-${log.id}" style="display:none">
                        ${renderDebugPayload(log.debug_payload)}
                    </div>

                    <div id="log-content-system-${log.id}" style="display:none">
                        <div class="log-tab-system-content">
                            <div class="spinner-container" style="padding:24px; text-align:center; opacity:0.5;">
                                <div class="spinner" style="margin: 0 auto 12px;"></div>
                                Loading system trace...
                            </div>
                        </div>
                    </div>

                    ${renderLogContext(log)}
                </div>` : ''}
            </div>`;
        }).join('');

        // Store for inspector
        state.lastRenderedLogs = data.items;

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
        // Cleanup streaming if this log's system tab was active
        const logId = id.replace('log-details-', '');
        stopLogTabStream(logId);
    } else {
        state.expandedLogs.add(id);
    }
}

function collapseAllLogs() {
    state.expandedLogs.clear();
    responseCache['logs'] = null;
    loadLogs();
}

async function clearAllLogs() {
    if (!confirm('Delete all log entries? This cannot be undone.')) return;
    await apiFetch(API.logs, { method: 'DELETE' });
    responseCache['logs'] = null;
    state.expandedLogs.clear();
    loadLogs();
    toast('Logs cleared.', 'success');
}

function switchLogTab(logId, tab, btn) {
    const results = document.getElementById(`log-content-results-${logId}`);
    const debug = document.getElementById(`log-content-debug-${logId}`);
    const system = document.getElementById(`log-content-system-${logId}`);

    if (results) results.style.display = tab === 'results' ? 'block' : 'none';
    if (debug) debug.style.display = tab === 'debug' ? 'block' : 'none';
    if (system) system.style.display = tab === 'system' ? 'block' : 'none';

    // Cleanup streaming if moving AWAY from system tab
    if (tab !== 'system') {
        stopLogTabStream(logId);
    }

    const nav = btn.parentElement;
    nav.querySelectorAll('button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
}

function renderDebugPayload(artifacts) {
    if (!artifacts || !artifacts.length) return '<div class="empty-state">No debug artifacts found.</div>';

    return artifacts.map(a => {
        const isHtml = typeof a.data === 'string' && (a.data.trim().startsWith('<') || a.data.includes('</'));
        let content = '';
        if (isHtml) {
            // Encode HTML for srcdoc to prevent accidental breaks
            const srcdoc = a.data.replace(/"/g, '&quot;').replace(/'/g, '&apos;');
            content = `
            <div class="debug-html-wrapper">
                <div class="debug-html-actions" style="margin-bottom:8px; display:flex; gap:8px;">
                    <button class="btn btn-ghost btn-sm" onclick="toggleDebugSource(this)">👁 View Source</button>
                    <button class="btn btn-ghost btn-sm active" onclick="toggleDebugPreview(this)">🖼 Preview</button>
                </div>
                <div class="debug-html-preview" style="background:#fff; border-radius:var(--radius-sm); overflow:hidden; height:400px; border:1px solid var(--border);">
                    <iframe 
                        sandbox="allow-popups allow-popups-to-escape-sandbox" 
                        srcdoc="${srcdoc}" 
                        style="width:100%; height:100%; border:none; background:#fff;"
                        loading="lazy">
                    </iframe>
                </div>
                <pre class="debug-html-source" style="display:none; background:var(--bg-input); padding:10px; border-radius:var(--radius-sm); font-size:11px; overflow:auto; max-height:400px; white-space:pre-wrap; word-break:break-all;">${a.data.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
            </div>`;
        } else {
            const pretty = typeof a.data === 'object' ? JSON.stringify(a.data, null, 2) : String(a.data);
            content = `<pre style="background:var(--bg-input); padding:10px; border-radius:var(--radius-sm); font-size:11px; overflow:auto; max-height:400px; white-space:pre-wrap; word-break:break-all;">${pretty}</pre>`;
        }

        return `
        <div class="debug-artifact" style="margin-bottom:16px; border:1px solid var(--border); border-radius:var(--radius-sm); padding:12px; background:rgba(255,255,255,0.01);">
            <div style="font-size:11px; font-weight:700; color:var(--text-muted); text-transform:uppercase; margin-bottom:8px;">${a.label || 'Artifact'}</div>
            ${content}
        </div>`;
    }).join('');
}

function toggleDebugSource(btn) {
    const parent = btn.closest('.debug-html-wrapper');
    parent.querySelector('.debug-html-preview').style.display = 'none';
    parent.querySelector('.debug-html-source').style.display = 'block';
    btn.parentElement.querySelectorAll('button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
}

function toggleDebugPreview(btn) {
    const parent = btn.closest('.debug-html-wrapper');
    parent.querySelector('.debug-html-preview').style.display = 'block';
    parent.querySelector('.debug-html-source').style.display = 'none';
    btn.parentElement.querySelectorAll('button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
}

function renderPayload(payload, episodeCount = 0) {
    if (!payload || typeof payload !== 'object') return '';

    // Tabular View (Array of Objects)
    if (Array.isArray(payload) && payload.length > 0) {
        const keys = Array.from(new Set(payload.map(p => Object.keys(p)).flat())).filter(k => k !== null && k !== undefined);
        let thead = '<tr>' + keys.map(k => `<th>${k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</th>`).join('') + '</tr>';

        let tbody = payload.map(obj => {
            return '<tr>' + keys.map(k => {
                const rawVal = (obj[k] !== null && obj[k] !== undefined) ? obj[k] : '-';
                const isObj = typeof rawVal === 'object' && rawVal !== null;
                const strVal = isObj ? JSON.stringify(rawVal) : String(rawVal);

                const isHtml = typeof rawVal === 'string' && strVal.length > 10 && (strVal.trim().startsWith('<') || strVal.includes('</'));
                const isDataImg = typeof rawVal === 'string' && strVal.startsWith('data:image/');
                let cellContent = '';

                if (isHtml) {
                    const encoded = b64EncodeUnicode(strVal);
                    cellContent = `<button class="btn btn-ghost btn-sm" onclick="showHtmlModal('${encoded}')" style="font-size:10px; padding:4px 8px;">Preview HTML</button>`;
                } else if (isDataImg) {
                    cellContent = `
                        <div class="payload-img-wrapper" onclick="showImageModal('${strVal}')">
                            <img src="${strVal}" class="payload-img-preview" alt="Captured Image">
                            <div class="payload-img-overlay">🔍 View</div>
                        </div>`;
                } else if (isObj) {
                    const prettyJson = JSON.stringify(rawVal, null, 2);
                    const encoded = b64EncodeUnicode(prettyJson);
                    if (prettyJson.length > 100 || prettyJson.includes('\n')) {
                        cellContent = `<button class="btn btn-ghost btn-sm" onclick="showJsonModal('${encoded}')" style="font-size:10px; padding:4px 8px;">View JSON</button>`;
                    } else {
                        cellContent = `<code style="font-size:11px; color:var(--accent); background:rgba(124,106,247,0.05); padding:2px 4px; border-radius:4px">${strVal}</code>`;
                    }
                } else {
                    let v = strVal;
                    if (v.length > 200) v = v.substring(0, 200) + '...';
                    if (v.startsWith('http')) v = `<a href="${v}" target="_blank" rel="noopener">Link</a>`;
                    cellContent = v;
                }
                return `<td>${cellContent}</td>`;
            }).join('') + '</tr>';
        }).join('');

        let msg = '';
        if (episodeCount && episodeCount > payload.length) {
            msg = `<div class="payload-truncation-notice">Displaying <b>${payload.length}</b> out of <b>${episodeCount}</b> scraped items.</div>`;
        }

        return `<div class="payload-table-wrapper"><table class="payload-table"><thead>${thead}</thead><tbody>${tbody}</tbody></table></div>${msg}`;
    }

    // Grid View (Single Object)
    const rows = Object.entries(payload)
        .filter(([, v]) => v !== null && v !== undefined && v !== '')
        .map(([k, v]) => {
            const label = k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
            let val = formatValueForUI(v);
            // Auto-link URLs
            if (val.startsWith('http')) val = `<a href="${val}" target="_blank" rel="noopener">${val}</a>`;
            return `<div class="payload-row"><span class="payload-key">${label}</span><span class="payload-val">${val}</span></div>`;
        });
    return `<div class="payload-grid">${rows.join('')}</div>`;
}

function showJsonModal(encoded) {
    const json = b64DecodeUnicode(encoded);
    const modal = document.getElementById('log-context-modal');
    const body = document.getElementById('log-context-body');
    document.getElementById('log-context-title').textContent = 'JSON Data Viewer';
    modal.style.display = 'flex';

    body.innerHTML = `
        <div style="padding:24px; background:var(--bg-card); border-radius:12px; border:1px solid var(--border);">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
                <div style="font-size:12px; font-weight:700; color:var(--text-muted); text-transform:uppercase;">Formatted JSON Payload</div>
                <button class="btn btn-ghost btn-sm" onclick="downloadJsonObject('${encoded}')">Download</button>
            </div>
            <pre style="background:rgba(0,0,0,0.2); padding:20px; border-radius:8px; font-family:var(--font-mono); font-size:12px; line-height:1.6; color:var(--accent-light); overflow:auto; max-height:70vh; border:1px solid rgba(255,255,255,0.05);">${json.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
        </div>
    `;
}

function downloadJsonObject(encoded) {
    const json = b64DecodeUnicode(encoded);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `data_${new Date().getTime()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function showHtmlModal(encoded) {
    const html = b64DecodeUnicode(encoded);
    const modal = document.getElementById('log-context-modal');
    const body = document.getElementById('log-context-body');
    modal.style.display = 'flex';

    body.innerHTML = `
        <div class="debug-html-wrapper">
            <div class="debug-html-actions" style="margin-bottom:12px; display:flex; gap:8px;">
                <button class="btn btn-ghost btn-sm" onclick="toggleDebugSource(this)">👁 View Source</button>
                <button class="btn btn-ghost btn-sm active" onclick="toggleDebugPreview(this)">🖼 Preview</button>
            </div>
            <div class="debug-html-preview" style="background:#fff; color:#000; border-radius:var(--radius-sm); overflow:hidden; height:70vh; border:1px solid var(--border);">
                <iframe 
                    sandbox="allow-popups allow-popups-to-escape-sandbox" 
                    srcdoc="${html.replace(/"/g, '&quot;').replace(/'/g, '&apos;')}" 
                    style="width:100%; height:100%; border:none; background:#fff;"
                    loading="lazy">
                </iframe>
            </div>
            <pre class="debug-html-source" style="display:none; background:var(--bg-input); padding:10px; border-radius:var(--radius-sm); font-size:11px; overflow:auto; max-height:70vh; white-space:pre-wrap; word-break:break-all;">${html.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
        </div>
    `;

    document.getElementById('log-context-title').textContent = 'HTML Preview';
    modal.style.display = 'flex';
}

function showImageModal(src) {
    const modal = document.getElementById('log-context-modal');
    const body = document.getElementById('log-context-body');
    document.getElementById('log-context-title').textContent = 'High-Resolution Capture';
    modal.style.display = 'flex';

    body.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:16px; align-items:center; padding:20px;">
            <div style="background:white; border-radius:12px; overflow:hidden; box-shadow:0 20px 50px rgba(0,0,0,0.5); max-width:100%; border:1px solid var(--border-light);">
                <img src="${src}" style="display:block; max-width:100%; max-height:70vh; object-fit:contain;" alt="High Res">
            </div>
            <div style="width:100%; display:flex; justify-content:center; gap:12px; margin-top:8px;">
                <button class="btn btn-primary" onclick="const a=document.createElement('a');a.href='${src}';a.download='captured_image.png';a.click();" style="padding:8px 24px;">📥 Download Original</button>
                <button class="btn btn-ghost" onclick="document.getElementById('log-context-modal').style.display='none'" style="padding:8px 24px;">Close</button>
            </div>
        </div>
    `;
}

function b64EncodeUnicode(str) {
    return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (match, p1) => String.fromCharCode('0x' + p1)));
}

function b64DecodeUnicode(str) {
    return decodeURIComponent(atob(str).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
}

function renderLogContext(log) {
    let html = '';

    // 1. Trigger Info (Standardized item 1)
    const trigMap = {
        'scheduler': { icon: '📅', title: 'Schedule', color: 'var(--accent)', label: log.schedule_name || 'Untitled Schedule' },
        'manual': { icon: '👤', title: 'Manual', color: 'var(--accent)', label: 'Direct Trigger' },
        'one-time': { icon: '⏳', title: 'Task', color: 'var(--accent)', label: log.schedule_name || 'One-time Run' },
        'catchup': { icon: '🔄', title: 'Catch-up', color: 'var(--accent)', label: log.schedule_name || 'System Re-run' }
    };

    const t = trigMap[log.triggered_by] || trigMap['manual'];
    html += `
    <div class="log-context-item" style="border-left: 4px solid ${t.color};">
        <div class="ctx-icon">${t.icon}</div>
        <div class="ctx-main">
            <div class="ctx-label">${t.label}</div>
            <div class="ctx-subtext">Executed by ${t.title} Trigger</div>
        </div>
        <div class="ctx-meta">Active</div>
    </div>`;

    // 2. Integration Details (Standardized items 2+)
    if (log.integration_details) {
        try {
            const details = JSON.parse(log.integration_details);
            if (Array.isArray(details) && details.length > 0) {
                details.forEach(d => {
                    const color = d.success ? 'var(--success)' : 'var(--failure)';
                    const icon = d.success ? '✅' : '❌';
                    const statusText = d.success ? 'Delivered' : 'Failed';
                    html += `
                    <div class="log-context-item" style="border-left: 4px solid ${color};">
                        <div class="ctx-icon">${icon}</div>
                        <div class="ctx-main">
                            <div class="ctx-label">${d.name}</div>
                            <div class="ctx-subtext">Integration Hub ${statusText}</div>
                        </div>
                        <div class="ctx-meta">${d.attempts > 1 ? `${d.attempts} attempts` : '1 attempt'}</div>
                    </div>
                    ${d.error ? `<div class="ctx-error-msg">⚠️ ${d.error}</div>` : ''}`;
                });
            }
        } catch (e) { console.error("Error parsing integration details:", e); }
    }

    return html ? `<div class="log-footer-context">${html}</div>` : '';
}

function downloadLogPayload(logId, format) {
    const a = document.createElement('a');
    a.href = API.logDownload(logId, format);
    a.download = '';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}


function downloadSystemLog(logId) {
    const a = document.createElement('a');
    a.href = `/api/logs/${logId}/raw?download=1`;
    a.download = `run_${logId}.log`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

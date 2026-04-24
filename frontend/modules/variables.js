/* ── Context Registry: Variables, Functions, Env Vars, Namespace Management ─── */
/* ════════════════════════════════════════════════
   CONTEXT REGISTRY (Variables & Functions)
   ════════════════════════════════════════════════ */
function switchContextTab(tab, btn) {
    document.getElementById('ctx-vars-view').style.display = tab === 'vars' ? 'block' : 'none';
    document.getElementById('ctx-funcs-view').style.display = tab === 'funcs' ? 'block' : 'none';
    document.getElementById('ctx-env-view').style.display = tab === 'env' ? 'block' : 'none';

    // Toggle variable button visibility
    const addVarBtn = document.getElementById('ctx-add-var-btn');
    if (addVarBtn) {
        addVarBtn.style.display = (tab === 'vars') ? 'block' : 'none';
    }

    const nav = btn.parentElement;
    nav.querySelectorAll('button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    if (tab === 'funcs') renderFunctionsList();
    if (tab === 'env') renderEnvironmentList();
}

async function loadVariables(silent = false) {
    // Skip if editing/adding to avoid clearing local state
    if (state.variables && state.variables.some(v => v._editing || v._isNew)) return;

    try {
        const [vars, envs] = await Promise.all([
            apiFetch(API.variables),
            apiFetch(API.envVariables)
        ]);
        state.variables = vars.map(v => ({ ...v, _editing: false }));
        state.builtin_envs = envs;
        renderVariablesList();
        renderEnvironmentList();
    } catch (e) {
        if (!silent) toast(e.message, 'error');
    }
}

function renderVariablesList() {
    const list = document.getElementById('variables-list-body');
    if (!list) return;

    // Save scroll position and focused element ID to restore after render
    const focusedId = document.activeElement ? document.activeElement.id : null;
    const scrollPos = list.parentElement ? list.parentElement.scrollTop : 0;

    const vars = state.variables || [];

    // Grouping logic (Namespace)
    const groups = vars.reduce((acc, v) => {
        const ns = v.namespace || '';
        if (!acc[ns]) acc[ns] = [];
        acc[ns].push(v);
        return acc;
    }, {});

    // Include virtual namespaces (empty ones)
    (state.virtualNamespaces || []).forEach(ns => {
        if (!groups[ns]) groups[ns] = [];
    });

    // Sort: Empty namespace (Global) first, then alphabetically
    const sortedNamespaces = Object.keys(groups).sort((a, b) => {
        if (a === '') return -1;
        if (b === '') return 1;
        return a.localeCompare(b);
    });

    let html = '';
    sortedNamespaces.forEach(namespace => {
        const isEditing = state.editingNamespace === (namespace || '@@GLOBAL@@');

        // Namespace Group Header (colspan=7)
        html += `
        <tr class="group-header" style="background:rgba(255,255,255,0.015); border-bottom:1px solid var(--border-light)">
            <td colspan="7" style="padding:16px 14px 10px; font-size:11px; font-weight:800; color:#aeb9e1; text-transform:uppercase; letter-spacing:0.12em">
                <div style="display:flex; justify-content:space-between; align-items:center">
                    <div style="display:inline-flex; align-items:center; gap:8px">
                        <span>${namespace ? '🏷️ NAMESPACE:' : '📦 GLOBAL VARS'}</span>
                        ${isEditing ? `
                            <div style="display:flex; align-items:center; gap:6px">
                                <input type="text" id="rename-ns-input-${namespace || '@@GLOBAL@@'}" value="${namespace}" class="inline-input" style="height:24px; font-size:11px; width:150px; font-family:var(--font-mono); color:var(--accent)">
                                <button class="icon-btn" onclick="saveNamespaceRename('${namespace}')" style="color:var(--success); font-size:12px">✅</button>
                                <button class="icon-btn" onclick="cancelEditNamespace()" style="font-size:12px">✕</button>
                            </div>
                        ` : `
                            <div style="display:flex; align-items:center; gap:8px">
                                <span style="background:rgba(52,211,153,0.1); color:#34d399; padding:2px 8px; border-radius:4px; font-weight:800; font-size:10px; font-family:var(--font-mono); letter-spacing:0.02em">${(namespace || 'Shared Registry').toUpperCase()}</span>
                                ${namespace ? `<button class="icon-btn" onclick="editNamespace('${namespace}')" title="Rename Namespace" style="font-size:10px; opacity:0.4">✏️</button>` : ''}
                            </div>
                        `}
                    </div>
                    <button class="btn-add-var" onclick="addVariableRow('${namespace}')" title="Add variable to this namespace" style="
                        display: inline-flex;
                        align-items: center;
                        gap: 8px;
                        background: rgba(124, 106, 247, 0.12);
                        border: 1px solid rgba(124, 106, 247, 0.2);
                        color: var(--accent);
                        font-size: 11px;
                        font-weight: 800;
                        padding: 0 16px;
                        height: 30px;
                        border-radius: 8px;
                        cursor: pointer;
                        transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
                        text-transform: uppercase;
                        letter-spacing: 0.04em;
                    " onmouseover="this.style.background='var(--accent)'; this.style.color='white'; this.style.transform='translateY(-1.5px)'; this.style.boxShadow='0 5px 15px rgba(124,106,247,0.35)'" onmouseout="this.style.background='rgba(124,106,247,0.12)'; this.style.color='var(--accent)'; this.style.transform='none'; this.style.boxShadow='none'">
                        <span style="font-size: 18px; line-height: 1; font-weight: 300; margin-top: -1px">+</span>
                        <span>Add Variable</span>
                    </button>
                </div>
            </td>
        </tr>`;

        if (groups[namespace].length === 0 && !isEditing) {
            html += `<tr><td colspan="7" class="empty-td" style="padding:10px 20px; font-size:10px; opacity:0.5; font-style:italic">No variables in this namespace. Click [+ ADD VAR] to start.</td></tr>`;
        }

        groups[namespace].forEach(v => {
            const idx = state.variables.indexOf(v);
            if (v._editing || v._isNew) {
                html += `
                <tr class="editing-row" style="background:rgba(99,102,241,0.03)">
                    <td></td>
                    <td style="padding-left:14px">
                        <select id="inline-var-type-${idx}" style="height:34px; font-size:11px; padding:0 8px; font-weight:700" onchange="state.variables[${idx}].value_type = this.value; renderVariablesList()">
                            <option value="string" ${v.value_type === 'string' ? 'selected' : ''}>STRING</option>
                            <option value="number" ${v.value_type === 'number' ? 'selected' : ''}>NUMBER</option>
                            <option value="boolean" ${v.value_type === 'boolean' ? 'selected' : ''}>BOOLEAN</option>
                            <option value="json" ${v.value_type === 'json' ? 'selected' : ''}>JSON</option>
                            <option value="batch" ${v.value_type === 'batch' ? 'selected' : ''}>BATCH</option>
                        </select>
                    </td>
                    <td>
                        <input type="text" id="inline-var-key-${idx}" value="${v.key || ''}" placeholder="KEY_NAME" oninput="state.variables[${idx}].key = this.value" style="width:100%; height:34px; font-size:12.5px; padding:0 8px; font-family:var(--font-mono); font-weight:700; color:var(--accent)">
                    </td>
                    <td>
                        ${v.value_type === 'json' || v.value_type === 'batch' ? `
                            <textarea id="inline-var-value-${idx}" class="inline-json-editor" placeholder="${v.value_type === 'batch' ? 'One value per line...' : '[\"url1\", \"url2\"]'}" oninput="state.variables[${idx}].value = this.value; if(state.variables[${idx}].value_type==='json') validateInlineJson(this)">${v.value_type === 'batch' ? _formatBatchForUI(v.value) : (v.value || '')}</textarea>
                        ` : v.value_type === 'boolean' ? `
                            <label class="bool-toggle-wrap" style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:4px 0">
                                <input type="checkbox" id="inline-var-value-${idx}" class="bool-toggle-checkbox" ${String(v.value).toLowerCase() === 'true' || v.value === '1' ? 'checked' : ''} onchange="state.variables[${idx}].value = this.checked ? 'true' : 'false'; renderVariablesList()">
                                <span class="bool-toggle-track"></span>
                                <span style="font-size:11px;font-weight:700;color:${String(v.value).toLowerCase() === 'true' ? 'var(--success)' : 'var(--failure)'}">${String(v.value).toLowerCase() === 'true' ? 'TRUE' : 'FALSE'}</span>
                            </label>
                        ` : `
                            <input type="text" id="inline-var-value-${idx}" value="${v.value || ''}" placeholder="Initial Value..." oninput="state.variables[${idx}].value = this.value" style="width:100%; height:34px; font-size:12.5px; padding:0 8px">
                        `}
                    </td>
                    <td style="text-align:center">
                        <span style="font-size:9px; font-weight:800; padding:4px 8px; border-radius:4px; opacity:0.6; background:rgba(255,255,255,0.05); color:var(--text-muted); border:1px solid rgba(255,255,255,0.1)">EDITING...</span>
                    </td>
                    <td>
                        <input type="text" id="inline-var-desc-${idx}" value="${v.description || ''}" placeholder="Description..." oninput="state.variables[${idx}].description = this.value" style="width:100%; height:34px; font-size:12.5px; padding:0 8px">
                    </td>
                    <td class="action-cell" style="text-align:right">
                        <div class="action-btn-group" style="justify-content:flex-end; gap:8px">
                            <button class="icon-btn" onclick="toggleInlineVariableSecret(${idx})" title="${v.is_secret ? 'Hide' : 'Show'} Secret">${v.is_secret ? '🔒' : '👁️'}</button>
                            <button class="icon-btn" onclick="toggleInlineVariableReadonly(${idx})" title="${v.is_readonly ? 'Make Writable' : 'Make Read-Only'}" style="color:${v.is_readonly ? 'var(--failure)' : 'var(--text-muted)'}">${v.is_readonly ? '🚫' : '📝'}</button>
                            <button class="icon-btn" onclick="saveInlineVariable(${idx})" style="color:var(--success)">💾</button>
                            <button class="icon-btn" style="color:var(--failure)" onclick="cancelInlineEdit(${idx})">✕</button>
                        </div>
                    </td>
                </tr>`;
            } else {
                let valColor = 'var(--text-secondary)';
                if (v.value_type === 'number') valColor = 'var(--warning)';
                if (v.value_type === 'boolean') valColor = 'var(--success)';
                if (v.value_type === 'json') valColor = 'var(--accent)';

                html += `
                <tr>
                    <td></td>
                    <td style="text-align: center"><span class="type-pill type-${v.value_type}">${v.value_type.toUpperCase()}</span></td>
                    <td>
                        <div style="display:inline-flex; align-items:center; background:rgba(124,106,247,0.06); border:1px solid rgba(124,106,247,0.1); border-radius:4px; padding:1px 8px; font-family:var(--font-mono); font-weight:800; color:var(--accent); font-size:12px; letter-spacing:-0.2px; max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap" title="${v.key}">
                            ${v.key}
                        </div>
                    </td>
                    <td style="text-align: center"><div style="max-width:300px; margin: 0 auto; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:${valColor}; font-weight:500; font-family:var(--font-mono); font-size:12px">${renderVariableValue(v)}</div></td>
                    <td style="text-align:center">
                        <div onclick="toggleVariableReadonly(${idx})" title="Click to toggle Read-Only status" style="cursor:pointer; display:inline-flex; align-items:center; justify-content:center; width:100%">
                            <span style="font-size:9px; font-weight:800; padding:4px 10px; border-radius:4px; transition:all 0.2s; white-space:nowrap; ${v.is_readonly ? 'background:rgba(239, 68, 68, 0.1); color:#ef4444; border:1px solid rgba(239, 68, 68, 0.2)' : 'background:rgba(16, 185, 129, 0.1); color:#10b981; border:1px solid rgba(16, 185, 129, 0.2)'}">
                                ${v.is_readonly ? 'READ ONLY' : 'EDITABLE'}
                            </span>
                        </div>
                    </td>
                    <td><div style="color:#d1d5db; opacity:0.8; font-size:13px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${v.description || '-'}</div></td>
                    <td class="action-cell" style="text-align:right">
                        <div class="action-btn-group" style="justify-content:flex-end; gap:8px">
                            <button class="icon-btn" onclick="toggleVariableSecret(${idx})" title="${v.is_secret ? 'Show' : 'Hide'} value">${v.is_secret ? '👁️' : '🔒'}</button>
                            <button class="icon-btn" onclick="toggleVariableReadonly(${idx})" title="${v.is_readonly ? 'Unlock' : 'Lock (Read-Only)'}">${v.is_readonly ? '🚫' : '📝'}</button>
                            <button class="icon-btn" onclick="editInlineVariable(${idx})" title="Edit Inline">✏️</button>
                            <button class="icon-btn icon-btn-danger" onclick="deleteVariable(${v.id})" title="Delete">✕</button>
                        </div>
                    </td>
                </tr>`;
            }
        });
    });

    // Add creation row row if we are adding a NEW namespace
    if (state.editingNamespace === '@@NEW_NAMESPACE@@') {
        html += `
        <tr class="group-header" style="background:rgba(99,102,241,0.05); border-top:2px solid var(--accent)">
            <td colspan="7" style="padding:16px 14px; font-size:11px; font-weight:800; color:#aeb9e1; text-transform:uppercase">
                <div style="display:flex; flex-direction:column; gap:8px">
                    <span>Create New Namespace:</span>
                    <div style="display:flex; align-items:center; gap:10px">
                        <input type="text" id="rename-ns-input-@@NEW_NAMESPACE@@" placeholder="Enter namespace name (e.g. Selectors)..." value="${state.tempNamespaceName || ''}" oninput="state.tempNamespaceName = this.value" class="inline-input" style="height:32px; font-size:13px; flex-grow:1; font-family:var(--font-mono)">
                        <button class="btn btn-primary" style="height:32px; padding:0 12px; font-size:11px" onclick="saveNamespaceRename('@@NEW_NAMESPACE@@')">Confirm Name</button>
                        <button class="btn btn-outline" style="height:32px; padding:0 12px; font-size:11px" onclick="cancelEditNamespace()">Cancel</button>
                    </div>
                </div>
            </td>
        </tr>`;
    }

    list.innerHTML = html;

    // Restore focus and scroll
    if (focusedId) {
        const el = document.getElementById(focusedId);
        if (el) {
            el.focus();
            // If it's a text input, restore cursor to the end
            if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
                const val = el.value;
                el.value = '';
                el.value = val;
            }
        }
    }
    if (list.parentElement) list.parentElement.scrollTop = scrollPos;
}

function renderEnvironmentList() {
    const container = document.getElementById('environment-list-container');
    if (!container) return;

    if (!state.builtin_envs || state.builtin_envs.length === 0) {
        container.innerHTML = `<div style="padding:20px; text-align:center; color:var(--text-muted); font-size:13px">No environment variables detected.</div>`;
        return;
    }

    const html = `
        <div class="scrapers-table-container">
            <table class="scrapers-table">
                <thead>
                    <tr>
                        <th style="width:30px"></th>
                        <th style="width:120px; text-align:center">Type</th>
                        <th style="width:220px">Key / Variable</th>
                        <th style="width:300px; text-align:center">Current Value</th>
                        <th style="width:120px; text-align:center">Status</th>
                        <th>Description</th>
                    </tr>
                </thead>
                <tbody>
                    ${state.builtin_envs.map((v, i) => `
                    <tr class="variable-row variable-readonly">
                        <td></td>
                        <td style="text-align:center"><span class="type-pill type-string">STRING</span></td>
                        <td>
                            <div style="display:inline-flex; align-items:center; background:rgba(59,130,246,0.06); border:1px solid rgba(59,130,246,0.1); border-radius:4px; padding:2px 8px; font-family:var(--font-mono); font-weight:800; color:#3b82f6; font-size:12px; letter-spacing:-0.2px; max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap" title="${v.key}">
                                ${v.key}
                            </div>
                        </td>
                        <td style="text-align:center"><div style="max-width:300px; margin: 0 auto; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--text-secondary); opacity:0.6; font-weight:500; font-family:var(--font-mono); font-size:12px">••••••••</div></td>
                        <td style="text-align:center">
                            <div style="display:flex; justify-content:center; align-items:center;">
                                <span style="font-size:9px; font-weight:800; padding:4px 10px; border-radius:4px; opacity:0.8; background:rgba(59,130,246,0.1); color:#3b82f6; border:1px solid rgba(59,130,246,0.2); white-space:nowrap" title="This variable is locked by the system environment.">
                                    SYSTEM
                                </span>
                            </div>
                        </td>
                        <td><div style="color:#94a3b8; opacity:0.6; font-size:13px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">External environment variable</div></td>
                    </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
    container.innerHTML = html;
}

function validateInlineJson(el) {
    if (!el.value.trim()) {
        el.style.borderColor = '';
        return;
    }
    try {
        JSON.parse(el.value);
        el.style.borderColor = 'var(--success)';
    } catch (e) {
        el.style.borderColor = 'var(--failure)';
    }
}



function renderVariableValue(v) {
    if (v.is_secret) {
        return `<span style="letter-spacing:0.3em;opacity:0.5;font-family:monospace">••••••••</span>`;
    }
    if (v.value_type === 'boolean') {
        const isTrue = String(v.value).toLowerCase() === 'true' || v.value === '1';
        return `<span class="status-badge ${isTrue ? 'badge-success' : 'badge-failure'}" style="padding: 1px 8px; font-size:10px">${isTrue ? 'TRUE' : 'FALSE'}</span>`;
    }
    if (v.value_type === 'json') {
        return `<code style="font-size:11px;opacity:0.7;background:rgba(255,255,255,0.05);padding:2px 4px;border-radius:4px">{...}</code>`;
    }
    if (v.value_type === 'batch') {
        try {
            const items = JSON.parse(v.value);
            if (Array.isArray(items)) {
                return `<code style="font-size:10px; font-weight:700; color:var(--accent); background:rgba(124,106,247,0.1); padding:2px 6px; border-radius:4px; border:1px solid rgba(124,106,247,0.2)">[Batch: ${items.length} items]</code>`;
            }
        } catch (e) { }
        return `<code style="font-size:10px; font-weight:700; color:var(--accent)">[Batch]</code>`;
    }
    const displayVal = formatValueForUI(v.value);
    return `<span title="${displayVal}">${displayVal}</span>`;
}

function _formatBatchForUI(val) {
    if (!val) return '';
    try {
        const items = JSON.parse(val);
        if (Array.isArray(items)) return items.join('\n');
    } catch (e) { }
    return val;
}

function addVariableRow(initNS = null) {
    if (!state.variables) state.variables = [];

    // Check if we are already adding one in this namespace
    if (state.variables.some(v => v._isNew && v.namespace === (initNS || ''))) return;

    state.variables.unshift({
        key: '',
        value: '',
        value_type: 'string',
        description: '',
        is_secret: false,
        is_readonly: true,
        namespace: initNS || '',
        _editing: true,
        _isNew: true
    });

    // If we added to a virtual namespace, it's no longer virtual (it has a row)
    if (initNS) {
        state.virtualNamespaces = state.virtualNamespaces.filter(ns => ns !== initNS);
    }

    renderVariablesList();
}

function promptAddNamespace() {
    // Add a virtual namespace that only exists in UI until a variable is added
    state.tempNamespaceName = "";
    state.editingNamespace = "@@NEW_NAMESPACE@@";
    renderVariablesList();

    // Focus the new input
    setTimeout(() => {
        const input = document.getElementById('rename-ns-input-@@NEW_NAMESPACE@@');
        if (input) input.focus();
    }, 50);
}

function editNamespace(name) {
    state.editingNamespace = name || '@@GLOBAL@@';
    renderVariablesList();
    setTimeout(() => {
        const input = document.getElementById(`rename-ns-input-${name || '@@GLOBAL@@'}`);
        if (input) {
            input.focus();
            input.select();
        }
    }, 50);
}

function cancelEditNamespace() {
    state.editingNamespace = null;
    renderVariablesList();
}

async function saveNamespaceRename(oldName) {
    const input = document.getElementById(`rename-ns-input-${oldName || '@@GLOBAL@@'}`);
    if (!input) return;
    // Sanitize namespace at source: strip leading '@' if user provided it
    const newName = input.value.trim().replace(/^@/, '');

    if (oldName === '@@NEW_NAMESPACE@@') {
        if (!newName) { state.editingNamespace = null; renderVariablesList(); return; }
        // Create a new virtual namespace
        if (!state.virtualNamespaces.includes(newName)) {
            state.virtualNamespaces.push(newName);
        }
        state.editingNamespace = null;
        renderVariablesList();
        return;
    }

    if (newName === oldName) {
        state.editingNamespace = null;
        renderVariablesList();
        return;
    }

    try {
        await apiFetch(API.variablesBatchRename, {
            method: 'PATCH',
            body: JSON.stringify({ old_namespace: oldName || '', new_namespace: newName })
        });
        toast(`Namespace renamed to ${newName}`, 'success');
        state.editingNamespace = null;
        loadVariables(true); // reload to get updated objects
    } catch (e) {
        toast(e.message, 'error');
    }
}

function editInlineVariable(idx) {
    state.variables[idx]._editing = true;
    renderVariablesList();
}

function cancelInlineEdit(idx) {
    if (state.variables[idx]._isNew) {
        state.variables.splice(idx, 1);
    } else {
        state.variables[idx]._editing = false;
    }
    renderVariablesList();
}

async function toggleVariableSecret(idx) {
    const v = state.variables[idx];
    try {
        await apiFetch(`${API.variables}/${v.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ is_secret: !v.is_secret })
        });
        loadVariables(true);
    } catch (e) { toast(e.message, 'error'); }
}

function toggleInlineVariableSecret(idx) {
    state.variables[idx].is_secret = !state.variables[idx].is_secret;
    renderVariablesList();
}

async function toggleVariableReadonly(idx) {
    const v = state.variables[idx];
    try {
        await apiFetch(`${API.variables}/${v.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ is_readonly: !v.is_readonly })
        });
        loadVariables(true);
    } catch (e) { toast(e.message, 'error'); }
}

function toggleInlineVariableReadonly(idx) {
    state.variables[idx].is_readonly = !state.variables[idx].is_readonly;
    renderVariablesList();
}

async function saveInlineVariable(idx) {
    const v = state.variables[idx];
    const key = document.getElementById(`inline-var-key-${idx}`).value.trim();
    const type = document.getElementById(`inline-var-type-${idx}`).value;

    // Bool type reads from checkbox, others read text/textarea value
    let value;
    if (type === 'boolean') {
        const cb = document.getElementById(`inline-var-value-${idx}`);
        value = (cb && cb.checked) ? 'true' : 'false';
    } else if (type === 'batch') {
        const raw = document.getElementById(`inline-var-value-${idx}`).value.trim();
        // If it looks like a JSON array, preserve it/clean it, otherwise treat as lines
        if (raw.startsWith('[') && raw.endsWith(']')) {
            try { JSON.parse(raw); value = raw; }
            catch (e) { value = JSON.stringify(raw.split('\n').map(l => l.trim()).filter(l => l)); }
        } else {
            value = JSON.stringify(raw.split('\n').map(l => l.trim()).filter(l => l));
        }
    } else {
        value = document.getElementById(`inline-var-value-${idx}`).value.trim();
    }
    const description = document.getElementById(`inline-var-desc-${idx}`).value.trim();
    // Sanitize namespace at source: strip leading '@' if user provided it
    const namespace = (v.namespace || '').replace(/^@/, '');

    if (!key) { toast('Key is required', 'error'); return; }

    const payload = { key, value, value_type: type, is_secret: v.is_secret, is_readonly: v.is_readonly, description, namespace };

    try {
        const url = v._isNew ? API.variables : `${API.variables}/${v.id}`;
        await apiFetch(url, {
            method: v._isNew ? 'POST' : 'PATCH',
            body: JSON.stringify(payload)
        });
        toast(v._isNew ? 'Variable created' : 'Variable updated', 'success');
        v._editing = false;
        v._isNew = false;
        loadVariables(true);
    } catch (e) { toast(e.message, 'error'); }
}

async function deleteVariable(id) {
    if (!confirm('Delete this variable?')) return;
    try {
        await apiFetch(`${API.variables}/${id}`, { method: 'DELETE' });
        toast('Variable deleted.', 'info');
        loadVariables();
    } catch (e) { toast(e.message, 'error'); }
}

async function loadFunctions(silent = false) {
    try {
        state.functions = await apiFetch(API.functions);
        renderFunctionsList();
    } catch (e) {
        if (!silent) toast('Failed to load functions', 'error');
        console.error(e);
    }
}

let funcCodeText = null;
function handleFuncFile(input) {
    const file = input.files[0];
    if (!file) return;
    document.getElementById('func-code-text').textContent = file.name;
    const reader = new FileReader();
    reader.onload = (e) => {
        funcCodeText = e.target.result;
    };
    reader.readAsText(file);
}

async function submitFuncImport(event) {
    event.preventDefault();
    const name = document.getElementById('func-name').value.trim();
    const desc = document.getElementById('func-desc').value.trim();
    const doc_md = document.getElementById('func-doc-md').value.trim();
    if (!name || !funcCodeText) {
        toast('Name and file are required', 'error');
        return;
    }

    try {
        await apiFetch(API.functions, {
            method: 'POST',
            body: JSON.stringify({
                name,
                description: desc,
                code: funcCodeText,
                doc_md: doc_md
            })
        });
        toast('Function imported successfully', 'success');
        event.target.reset();
        document.getElementById('func-code-text').textContent = 'Click to Import .py';
        funcCodeText = null;
        loadFunctions();
    } catch (e) { toast(e.message, 'error'); }
}

async function deleteFunction(id) {
    if (!confirm('Delete this custom function?')) return;
    try {
        await apiFetch(`${API.functions}/${id}`, { method: 'DELETE' });
        toast('Function deleted', 'info');
        loadFunctions();
    } catch (e) { toast(e.message, 'error'); }
}

function openEditFuncModal(id) {
    const f = state.functions.find(x => x.id === id);
    if (!f) return;
    document.getElementById('edit-func-id').value = id;
    document.getElementById('edit-func-name').value = f.name;
    document.getElementById('edit-func-desc').value = f.description || '';
    document.getElementById('edit-func-doc').value = f.doc_md || '';
    document.getElementById('edit-func-modal').style.display = 'flex';
}

function closeEditFuncModal(e) {
    if (e && e.target !== document.getElementById('edit-func-modal')) return;
    document.getElementById('edit-func-modal').style.display = 'none';
}

async function saveEditFunc() {
    const id = document.getElementById('edit-func-id').value;
    const name = document.getElementById('edit-func-name').value.trim();
    const description = document.getElementById('edit-func-desc').value.trim();
    const doc_md = document.getElementById('edit-func-doc').value.trim();

    if (!name) { toast('Name is required', 'error'); return; }

    try {
        await apiFetch(`${API.functions}/${id}`, {
            method: 'PATCH',
            body: JSON.stringify({ name, description, doc_md })
        });
        toast('Function metadata updated', 'success');
        document.getElementById('edit-func-modal').style.display = 'none';
        loadFunctions();
    } catch (e) { toast(e.message, 'error'); }
}

function openVarCreateModal() {
    state.variables.unshift({
        key: '',
        value: '',
        value_type: 'string',
        is_secret: false,
        is_readonly: true,
        doc_md: '',
        _editing: true,
        _isNew: true
    });
    renderVariablesList();
}

function renderFunctionsList() {
    const list = document.getElementById('functions-list');
    if (!list) return;

    const builtins = [
        { name: 'today', desc: 'Current date (YYYY-MM-DD)', example: '{{today}}' },
        { name: 'now', desc: 'Current timestamp', example: '{{now}}' },
        { name: 'yesterday', desc: 'Yesterday\'s date', example: '{{yesterday}}' },
        { name: 'env', desc: 'Access an environment variable', example: '{{env("VAR")}}' },
        { name: 'random', desc: 'Random number between min/max', example: '{{random(1, 100)}}' },
        { name: 'random_stream', desc: '📡 Generator: n random numbers', example: '{{random_stream(10, 1, 100)}}' },
        { name: 'range', desc: '📡 Generator: numerical sequence', example: '{{range(1, 10)}}' },
        { name: 'uuid', desc: 'Generate a unique UUID v4', example: '{{uuid()}}' },
        { name: 'json', desc: 'Serialize object to JSON string', example: '{{json({"id": 1})}}' },
        { name: 'upper', desc: 'Convert string to UPPERCASE', example: '{{upper("hello")}}' },
        { name: 'lower', desc: 'Convert string to lowercase', example: '{{lower("HELLO")}}' },
        { name: 'strip', desc: 'Remove surrounding whitespace', example: '{{strip("  txt  ")}}' }
    ];

    let html = `
    <div style="margin-bottom:32px;">
        <h3 style="font-size:12px; color:var(--text-muted); margin-bottom:16px; letter-spacing:0.05em; text-transform:uppercase; font-weight:700;">Built-in Expressions</h3>
        <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(280px, 1fr)); gap:16px;">
            ${builtins.map(f => {
        const safeDesc = f.desc.replace(/'/g, "\\'");
        const safeExample = f.example.replace(/'/g, "\\'");
        return `
                <div class="ctx-item-card" onclick="openContextDrawer('builtin', '${f.name}')" style="cursor:pointer">
                    <div class="ctx-item-header" style="margin:0">
                        <div>
                            <div style="display:flex; align-items:center; gap:8px">
                                <span style="font-size:18px; color:var(--accent)">ƒ</span>
                                <code class="var-key" style="font-size:14px">${f.name}</code>
                            </div>
                            <div class="ctx-subtext" style="margin-top:4px; opacity:0.9; font-size:11px; color:var(--text-secondary);">${f.desc}</div>
                        </div>
                    </div>
                </div>`;
    }).join('')}
        </div>
    </div>`;

    if (state.functions && state.functions.length > 0) {
        html += `
        <div>
            <h3 style="font-size:12px; color:var(--text-muted); margin-bottom:16px; letter-spacing:0.05em; text-transform:uppercase; font-weight:700;">Custom User Functions</h3>
            <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(280px, 1fr)); gap:16px;">
                ${state.functions.map(f => {
            const safeDesc = (f.description || '').replace(/'/g, "\\'");
            const cat = f.category || (f.is_generator ? 'generator' : 'transformer');
            const colorMap = {
                generator: { bg: 'rgba(34, 197, 94, 0.04)', border: 'var(--success)', icon: '📡', label: 'GEN' },
                comparator: { bg: 'rgba(99, 102, 241, 0.04)', border: 'var(--accent)', icon: '💎', label: 'LOGIC' },
                transformer: { bg: 'rgba(234, 179, 8, 0.04)', border: 'var(--warning)', icon: '🔧', label: 'UDF' }
            };
            const theme = colorMap[cat] || colorMap.transformer;

            return `
                    <div class="ctx-item-card" style="border-left: 4px solid ${theme.border}; background: ${theme.bg}; padding: 12px 16px;">
                        <div class="ctx-item-header" style="margin:0; display:flex; align-items:center; gap:16px;">
                            <div style="flex:1; min-width:0; cursor:pointer;" onclick="openContextDrawer('func', ${f.id})">
                                <div style="display:flex; align-items:center; width:100%; overflow:hidden;">
                                    <span style="font-size:18px; margin-right:8px; flex-shrink:0;">${theme.icon}</span>
                                    <code class="var-key" style="font-size:13px; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; flex:1; min-width:0;">${f.name}</code>
                                    <span class="item-badge" style="background:${theme.border}; color:#000; font-size:9px; font-weight:800; padding:2px 6px; border-radius:4px; margin-left:8px; flex-shrink:0;">${theme.label}</span>
                                </div>
                                <div class="ctx-subtext" style="margin-top:4px; font-size:11px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; opacity:0.9; color:var(--text-secondary);">${f.description || 'No description.'}</div>
                            </div>
                            <div class="item-actions" style="flex-shrink:0;">
                                <div class="action-btn-group">
                                    <button class="icon-btn" onclick="openEditFuncModal(${f.id})" title="Edit Metadata & Docs">✏️</button>
                                    <button class="icon-btn" onclick="document.getElementById('func-name').value='${f.name}'; document.getElementById('func-code-file').click();" title="Replace Python Code">📄</button>
                                    <button class="icon-btn icon-btn-danger" onclick="deleteFunction(${f.id})" title="Delete Function">✕</button>
                                </div>
                            </div>
                        </div>
                    </div>`;
        }).join('')}
            </div>
        </div>`;
    } else {
        html += `
        <div style="padding:48px; border:2px dashed var(--border); border-radius:12px; text-align:center; background:rgba(255,255,255,0.01);">
             <div style="font-size:24px; opacity:0.3; margin-bottom:12px;">🛠️</div>
             <p style="color:var(--text-muted); font-size:14px; font-weight:500;">No custom functions yet.</p>
             <p style="color:var(--text-muted); font-size:12px; opacity:0.6; margin-top:4px;">Import your first .py function using the form above.</p>
        </div>`;
    }

    list.innerHTML = html;
}

function openContextDrawer(type, id) {
    const drawer = document.getElementById('ctx-drawer');
    const backdrop = document.getElementById('ctx-drawer-backdrop');

    let title = '', subtitle = '', md = '';

    if (type === 'func') {
        const f = state.functions.find(x => x.id === id);
        if (!f) return;
        title = f.name;
        subtitle = f.is_generator ? 'Custom Generator (📡 GEN)' : 'Static Value Function (📦 VAL)';
        md = f.doc_md || 'No documentation provided.';
    } else if (type === 'builtin') {
        const builtins = [
            { name: 'today', desc: 'Returns current local date in **YYYY-MM-DD** format.', example: '{{today}}' },
            { name: 'now', desc: 'Returns current timestamp in **YYYY-MM-DD HH:MM:SS** format.', example: '{{now}}' },
            { name: 'yesterday', desc: "Returns yesterday's date in **YYYY-MM-DD** format.", example: '{{yesterday}}' },
            { name: 'env', desc: 'Accesses an environment variable from the host system.', example: '{{env("DB_PASS")}}' },
            { name: 'random', desc: 'Generates a random integer between the provided min and max values (inclusive).', example: '{{random(1, 50)}}' },
            { name: 'random_stream', desc: '📡 **Generator**: Returns a stream of `n` random numbers. Useful for stress-testing or batch generation.', example: '{{random_stream(10, 1, 100)}}' },
            { name: 'range', desc: '📡 **Generator**: Returns a numerical sequence (start to stop). This is the primary way to trigger iterative batch runs.', example: '{{range(1, 10)}}' },
            { name: 'uuid', desc: 'Generates a unique version 4 UUID string.', example: '{{uuid()}}' },
            { name: 'json', desc: 'Converts a Python object into a JSON-formatted string.', example: '{{json({"key": "val"})}}' },
            { name: 'upper', desc: 'Transforms input text into all uppercase letters.', example: '{{upper("hi")}}' },
            { name: 'lower', desc: 'Transforms input text into all lowercase letters.', example: '{{lower("HI")}}' },
            { name: 'strip', desc: 'Removes all leading and trailing whitespace from the provided text.', example: '{{strip("  padded  ")}}' }
        ];
        const b = builtins.find(x => x.name === id);
        if (!b) return;
        title = b.name;
        subtitle = b.name.includes('stream') || b.name === 'range' ? 'Built-in Generator' : 'Built-in Function';
        md = `${b.desc}\n\n**Example:**\n\`${b.example}\``;
    }

    document.getElementById('drawer-title').textContent = title;
    document.getElementById('drawer-subtitle').textContent = subtitle;

    const content = (md || '').trim();
    if (!content) {
        document.getElementById('drawer-body').innerHTML = '<div class="empty-state" style="opacity:0.5; font-style:italic">No documentation provided.</div>';
    } else {
        // More robust MD-to-HTML conversion
        let html = content
            .replace(/^# (.*$)/gim, '<h1 style="font-size:20px; margin-bottom:12px; border-bottom:1px solid var(--border-light); padding-bottom:8px">$1</h1>')
            .replace(/^## (.*$)/gim, '<h2 style="font-size:17px; margin-top:20px; margin-bottom:10px; color:var(--accent-light)">$1</h2>')
            .replace(/^### (.*$)/gim, '<h3 style="font-size:15px; margin-top:16px; margin-bottom:8px; font-weight:700">$1</h3>')
            .replace(/^\* (.*$)/gim, '<li style="margin-left:20px; margin-bottom:6px; list-style-type:disc">$1</li>')
            .replace(/^- (.*$)/gim, '<li style="margin-left:20px; margin-bottom:6px; list-style-type:circle">$1</li>')
            .replace(/\*\*([^*]+)\*\*/g, '<strong style="color:var(--text-primary)">$1</strong>')
            .replace(/`([^`]+)`/g, '<code style="background:rgba(255,255,255,0.08); padding:2px 6px; border-radius:4px; font-family:var(--font-mono); font-size:0.9em; color:var(--accent-light); border:1px solid rgba(255,255,255,0.05)">$1</code>');

        // Final line break processing (only for non-tag lines)
        html = html.split('\n').map(line => {
            if (line.trim().startsWith('<')) return line;
            return line + '<br>';
        }).join('\n');

        document.getElementById('drawer-body').innerHTML = html;
    }

    drawer.classList.add('active');
    backdrop.classList.add('active');
}

function closeContextDrawer() {
    document.getElementById('ctx-drawer').classList.remove('active');
    document.getElementById('ctx-drawer-backdrop').classList.remove('active');
}

/* 📋 System Log Viewer Logic */
let _liveLogInterval = null;
const activeLogTabStreams = {};

async function startLogTabStream(logIdToFetch, uiLogId, scraperName = '') {
    const isRunning = String(logIdToFetch).startsWith('run_');
    const realId = isRunning ? parseInt(String(logIdToFetch).replace('run_', '')) : logIdToFetch;
    const container = document.querySelector(`#log-content-system-${uiLogId} .log-tab-system-content`);
    
    if (!container) return;

    const updateTabUI = (data) => {
        const content = data.content || "No log content available.";
        container.innerHTML = `<pre id="log-pre-tab-${uiLogId}">${escapeHTML(content)}</pre>`;
        const pre = document.getElementById(`log-pre-tab-${uiLogId}`);
        if (pre) pre.scrollTop = pre.scrollHeight;
    };

    const fetchLogs = async () => {
        try {
            const url = isRunning ? `/api/run/${realId}/logs/live` : `/api/logs/${realId}/raw`;
            const data = await apiFetch(url);
            updateTabUI(data);

            if (isRunning && data.active === false) {
                stopLogTabStream(uiLogId);
            }
        } catch (e) {
            container.innerHTML = `<div class="log-error" style="margin:20px">Failed to load system logs: ${e.message}</div>`;
            stopLogTabStream(uiLogId);
        }
    };

    // Initial fetch
    await fetchLogs();
    
    if (isRunning && !activeLogTabStreams[uiLogId]) {
        activeLogTabStreams[uiLogId] = setInterval(fetchLogs, 2000);
    }
}

function stopLogTabStream(uiLogId) {
    if (activeLogTabStreams[uiLogId]) {
        clearInterval(activeLogTabStreams[uiLogId]);
        delete activeLogTabStreams[uiLogId];
    }
}

async function openSystemLogViewer(logId, scraperName = '') {
    const isRunning = String(logId).startsWith('run_');
    const realId = isRunning ? parseInt(String(logId).replace('run_', '')) : logId;

    const drawer = document.getElementById('debug-inspector-drawer');
    const body = document.getElementById('debug-inspector-body');
    const title = document.getElementById('debug-inspector-title');

    // Clean up previous interval
    if (_liveLogInterval) {
        clearInterval(_liveLogInterval);
        _liveLogInterval = null;
    }

    const titleStr = scraperName ? `System Log - ${scraperName} (#${realId})` : `System Log #${realId}`;
    title.innerHTML = `${titleStr} <span style="color:var(--text-muted); font-weight:400; font-size:13px; margin-left:8px;">${isRunning ? '(Live)' : ''}</span>`;
    body.innerHTML = `
        <div style="padding:20px; text-align:center; opacity:0.5;">
            <div class="spinner" style="margin: 0 auto 12px;"></div>
            Loading log trace...
        </div>
    `;

    drawer.classList.add('active');

    const updateUI = (data) => {
        const content = data.content || "";
        const path = data.path || "";
        const basePath = data.base_path || "";

        // Abstract path for display
        let displayPath = path;
        if (path && basePath && path.toLowerCase().startsWith(basePath.toLowerCase())) {
            displayPath = '{{STL_LOGS_PATH}}' + path.substring(basePath.length);
        }

        body.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 16px; background:rgba(0,0,0,0.2); border-bottom:1px solid var(--border-light); margin:-24px -24px 16px -24px;">
                <span style="font-size:11px; font-family:monospace; color:var(--text-muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; padding-right:12px; flex:1;" title="${path}">
                    ${path ? `Path: ${displayPath}` : 'No file path'}
                </span>
                ${path ? `<button class="btn btn-ghost" style="padding:4px 8px; font-size:10px; flex-shrink:0;" onclick="copyToClipboard('${path.replace(/\\/g, '\\\\')}')">Copy Path</button>` : ''}
            </div>
            <pre id="log-pre-container" style="margin:0; font-family:'JetBrains Mono', 'Fira Code', monospace; font-size:11px; line-height:1.5; color:#e0e0e0; white-space:pre; word-break:normal; background:#0d1117; padding:16px; border-radius:8px; border:1px solid rgba(255,255,255,0.05); flex:1; overflow:auto;">${escapeHTML(content)}</pre>
            ${isRunning ? `<div style="margin-top:12px; font-size:11px; color:var(--running); display:flex; align-items:center; gap:6px;">
                <span class="pulse-dot"></span> Streaming live logs...
            </div>` : ''}
        `;

        // Auto-scroll to bottom
        const pre = document.getElementById('log-pre-container');
        if (pre) pre.scrollTop = pre.scrollHeight;
    };

    const fetchLogs = async () => {
        try {
            const url = isRunning ? `/api/run/${realId}/logs/live` : `/api/logs/${realId}/raw`;
            const data = await apiFetch(url);
            updateUI(data);

            // If it was running but is no longer "active", stop interval
            if (isRunning && data.active === false) {
                clearInterval(_liveLogInterval);
                _liveLogInterval = null;
                // Refresh title
                const titleStr = scraperName ? `System Log - ${scraperName} (#${realId})` : `System Log #${realId}`;
                title.innerHTML = `${titleStr} <span style="color:var(--text-muted); font-weight:400; font-size:13px; margin-left:8px;">(Finished)</span>`;
            }
        } catch (e) {
            body.innerHTML = `<div class="log-error">Failed to load logs: ${e.message}</div>`;
            if (_liveLogInterval) clearInterval(_liveLogInterval);
        }
    };

    await fetchLogs();

    if (isRunning) {
        _liveLogInterval = setInterval(fetchLogs, 2000);
    }
}

function closeDebugInspector() {
    const drawer = document.getElementById('debug-inspector-drawer');
    drawer.classList.remove('active');
    if (_liveLogInterval) {
        clearInterval(_liveLogInterval);
        _liveLogInterval = null;
    }
}

// Global Escape key listener for the log drawer
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const drawer = document.getElementById('debug-inspector-drawer');
        if (drawer && drawer.classList.contains('active')) {
            closeDebugInspector();
        }
    }
});

function escapeHTML(str) {
    const p = document.createElement('p');
    p.textContent = str;
    return p.innerHTML;
}

function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        toast('Path copied to clipboard', 'success');
    }).catch(err => {
        toast('Failed to copy', 'error');
    });
}

/**
 * ── Builder Focus Mode (Fullscreen) ──────────────────
 * Maximizes the builder workspace by hiding the sidebar and topbar.
 */
function toggleBuilderFullscreen(forceState) {
    const body = document.body;
    const isFS = forceState !== undefined ? forceState : !body.classList.contains('is-builder-fullscreen');
    body.classList.toggle('is-builder-fullscreen', isFS);

    // Update toggle button icon/state
    const btn = document.getElementById('toggle-fs-btn');
    if (btn) {
        // Toggle between "Maximize" (⛶) and "Restore" (❐) icons
        btn.innerHTML = isFS ? '<span style="font-size:15px; opacity:0.8;">❐</span>' : '<span style="font-size:15px; opacity:0.8;">⛶</span>';
        btn.title = isFS ? 'Exit Focus Mode' : 'Focus Mode (Maximize Workspace)';
    }

    if (isFS) {
        toast('Focus Mode Active - ESC to exit', 'info');
    }

    // Re-verify viewport dimensions after layout shift to ensure nodes/edges align
    setTimeout(() => {
        if (typeof renderBuilderNodes === 'function') renderBuilderNodes();
        if (typeof renderConnections === 'function') renderConnections();

        // Dispatch resize event to trigger internal canvas recalibrations
        window.dispatchEvent(new Event('resize'));
    }, 400);
}

// Global KeyDown listener for Focus Mode exit
window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.body.classList.contains('is-builder-fullscreen')) {
        toggleBuilderFullscreen(false);
    }
});

// ── Builder Configuration Sync Initialization ────────
// Syncs the toolbar settings with the save modal settings bidirectionally
document.addEventListener('DOMContentLoaded', () => {
    const syncFields = ['flow-browser-headless', 'flow-browser-cdp'];
    syncFields.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('input', () => syncBuilderBrowserConfig(el));
            el.addEventListener('change', () => syncBuilderBrowserConfig(el));
        }
    });
});

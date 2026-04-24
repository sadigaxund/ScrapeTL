/* ── Integrations Tab: Connector Modal, Discord & HTTP Helpers ─── */
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
            setChk('conn-shorten-urls', false);
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
                    setChk('conn-shorten-urls', !!cfg.shorten_urls);
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
    } catch (err) {
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
    const min = el.min !== '' ? parseFloat(el.min) : -Infinity;
    const max = el.max !== '' ? parseFloat(el.max) : Infinity;
    const val = parseFloat(el.value) || 0;
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
                const dm = i.config.dispatch_mode || 'per_element';
                const sf = !!i.config.send_as_file;
                const fs = i.config.format_style || 'embed';
                const dmLabel = dm === 'all_at_once' ? 'All at Once' : 'One by One';
                metaChips += ` <span class="tag-chip tag-chip--active" style="font-size:10px;padding:2px 7px;">${dmLabel}</span>`;
                if (sf) metaChips += ` <span class="tag-chip" style="font-size:10px;padding:2px 7px;color:var(--success)">📎 File</span>`;
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
                 style="padding: 12px 20px; display: flex; align-items: center; gap: 16px; min-height: 72px;"
                 ondragstart="handleDragStart(event, 'integration', ${i.id})"
                 ondragover="handleDragOver(event)"
                 ondragleave="handleDragLeave(event)"
                 ondrop="handleDrop(event, 'integration', ${i.id})"
                 ondragend="handleDragEnd(event)">
              <div class="drag-handle" style="margin:0; border:none; padding:0; flex-shrink:0;">⠿</div>
              <div style="width:40px; height:40px; display:flex; align-items:center; justify-content:center; background:var(--bg-card); border-radius:8px; border:1px solid var(--border); overflow:hidden; flex-shrink:0;">
                <div style="margin:0; padding:0; line-height:1; display:flex; align-items:center; justify-content:center;">${integIcon(i.type).replace('margin-right:8px', 'margin:0')}</div>
              </div>
              <div class="item-info" style="display: flex; align-items: center; gap: 24px; flex: 1; min-width: 0;">
                <div style="min-width: 180px; flex-shrink: 0;">
                    <div style="font-weight:600; font-size:14px; color:var(--text-primary); display:flex; align-items:center; gap:8px">
                        ${i.name}
                    </div>
                    <div style="font-size:11px; color:#aeb9e1; font-weight:500; text-transform:uppercase; letter-spacing:0.05em; margin-top:2px;">${titleType}</div>
                </div>
                <div style="flex: 1; min-width: 0; display: flex; align-items: center; gap: 12px;">
                    <div style="font-size: 13px; color: #d1d5db; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 300px;">
                        ${i.config && i.config.description ? i.config.description : `<span style="opacity:0.3; font-style:italic">No description</span>`}
                    </div>
                    <div style="display:flex; gap:6px; flex-wrap:nowrap;">${metaChips}</div>
                </div>
              </div>
              <div class="item-actions" style="margin-left:auto;">
                <div class="action-btn-group">
                    <button class="icon-btn" onclick="openConnectorModal('${i.type}', ${i.id})" title="Edit Integration">✏️</button>
                    <button class="icon-btn" onclick="testIntegration(${i.id}, this)" title="Test Connection">🧪</button>
                    <button class="icon-btn icon-btn-danger" onclick="deleteIntegration(${i.id})" title="Delete">✕</button>
                </div>
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
            shorten_urls: document.getElementById('conn-shorten-urls').checked,
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

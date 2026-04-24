/* ── Scraper Runner, Polling, Run Inputs Modal ─── */
async function runScraper(id, btn) {
    const scraper = state.scrapers.find(s => s.id === id);
    if (!scraper) {
        toast('Scraper not found in local cache.', 'error');
        return;
    }

    const inputs = (scraper && scraper.inputs) ? scraper.inputs : [];
    console.log(`[ScraperRun] ID: ${id}, Name: ${scraper.name}, Inputs Found: ${inputs.length}`, inputs);

    if (inputs.length > 0) {
        // Show inputs modal; it will call _doRunScraper on submit
        openRunInputsModal(id, inputs, btn, `Run: ${scraper.name}`);
    } else {
        await _doRunScraper(id, {}, btn);
    }
}


async function _doRunScraper(id, inputValues, btn, force = false) {
    if (btn) { btn.disabled = true; btn.textContent = 'Running…'; }
    try {
        let url = API.run(id);
        if (force) url += '?force=true';

        const res = await apiFetch(url, {
            method: 'POST',
            body: JSON.stringify({ input_values: inputValues }),
        });
        toast(res.detail, 'success');

        // Poll for task completion if task_id provided
        if (res.task_id && btn) {
            await _pollTaskStatus(res.task_id, btn);
        }

        setTimeout(() => refreshAll(), 1000);
    } catch (e) {
        // Handle concurrency conflict (already running)
        if (e.message.includes('already running')) {
            if (confirm(e.message)) {
                return _doRunScraper(id, inputValues, btn, true);
            }
        } else {
            toast(e.message, 'error');
        }
    } finally {
        // Only restore if not currently polling (polling might have finished and restored already)
        if (btn && !btn.dataset.polling) {
            btn.disabled = false;
            btn.textContent = 'Run'; // Restore button text
        }
    }
}

/**
 * Polls the backend until the task is no longer in the running/pending state.
 */
async function _pollTaskStatus(taskId, btn) {
    btn.dataset.polling = "true";
    const startTime = Date.now();
    const timeout = 10 * 60 * 1000; // 10 minute safety timeout

    return new Promise((resolve) => {
        const interval = setInterval(async () => {
            // Safety safety timeout check
            if (Date.now() - startTime > timeout) {
                console.warn("[Runner] Polling timed out.");
                clearInterval(interval);
                delete btn.dataset.polling;
                btn.disabled = false;
                btn.textContent = 'Run';
                resolve();
                return;
            }

            try {
                const res = await apiFetch(API.taskStatus(taskId));
                // 'finished' means task record was deleted (the default runner behaviour on success/fail)
                if (res.status === 'finished' || res.status === 'done' || res.status === 'failed' || res.status === 'cancelled') {
                    clearInterval(interval);
                    delete btn.dataset.polling;
                    btn.disabled = false;
                    btn.textContent = 'Run';
                    resolve();
                }
            } catch (e) {
                console.error("[Runner] Polling error:", e);
                clearInterval(interval);
                delete btn.dataset.polling;
                btn.disabled = false;
                btn.textContent = 'Run';
                resolve();
            }
        }, 1500); // Check every 1.5s
    });
}

/* ════════════════════════════════════════════════
   RUN INPUTS MODAL
════════════════════════════════════════════════ */
let _runInputsCallback = null;

function openRunInputsModal(id, inputs, btn, title = '▶ Run Scraper', scheduleCb = null) {
    _runInputsCallback = (vals) => {
        if (scheduleCb) scheduleCb(vals);
        else _doRunScraper(id, vals, btn);
    };

    document.getElementById('run-inputs-title').textContent = title;

    const submitBtn = document.getElementById('run-inputs-submit-btn');
    if (submitBtn) {
        submitBtn.innerHTML = scheduleCb ? '📅 Create Schedule' : '▶ Run';
    }

    const form = document.getElementById('run-inputs-form');
    form.innerHTML = inputs.map(inp => {
        const rid = `ri-${inp.name}`;
        const def = inp.default !== undefined && inp.default !== null ? inp.default : '';
        const desc = inp.description ? `<p class="input-desc">${inp.description}</p>` : '';
        let field = '';

        const itype = (inp.type || 'string').toLowerCase();

        if (itype === 'select' && inp.options) {
            const opts = inp.options.map(o =>
                `<option value="${o}" ${String(o) === String(def) ? 'selected' : ''}>${o}</option>`
            ).join('');
            field = `<select id="${rid}" class="inp">${opts}</select>`;
        } else if (inp.type === 'boolean' || inp.dataType === 'boolean') {
            field = `<label style="display:flex;align-items:center;gap:8px;cursor:pointer">
                <input type="checkbox" id="${rid}" ${def ? 'checked' : ''} style="width:16px;height:16px" />
                <span style="font-size:14px">${inp.label || inp.name}</span>
            </label>`;
        } else if (inp.type === 'generator') {
            const streams = state.functions.filter(f => f.is_generator);
            const statics = state.functions.filter(f => !f.is_generator);

            const builtinOpts = `
                <optgroup label="Built-in Streams">
                    <option value="{{range(1, 10)}}">range(1, 10)</option>
                    <option value="{{random_stream(10)}}">random_stream(10)</option>
                </optgroup>`;

            const streamOpts = streams.length ? `
                <optgroup label="Custom Generators (📡 GEN)">
                    ${streams.map(f => `<option value="{{${f.name}()}}" ${`{{${f.name}()}}` === String(def) ? 'selected' : ''}>${f.name}</option>`).join('')}
                </optgroup>` : '';

            const staticOpts = statics.length ? `
                <optgroup label="Static Values (📦 VAL)">
                    ${statics.map(f => `<option value="{{${f.name}()}}" ${`{{${f.name}()}}` === String(def) ? 'selected' : ''}>${f.name}</option>`).join('')}
                </optgroup>` : '';

            field = `
            <select id="${rid}" class="inp">
                <option value="">-- Select Source --</option>
                ${builtinOpts}
                ${streamOpts}
                ${staticOpts}
            </select>`;
        } else if (inp.type === 'list' || inp.dataType === 'list') {
            const varOpts = state.variables.filter(v => v.value_type === 'json').map(v =>
                `<option value="{{${v.key}}}" ${`{{${v.key}}}` === String(def) ? 'selected' : ''}>[Var] ${v.key}</option>`
            ).join('');
            const listId = `dl-${rid}`;
            field = `
            <input type="text" id="${rid}" data-ptype="list" class="inp" list="${listId}" value="${def}" placeholder='e.g. ["url1"] or {{var}}'>
            <datalist id="${listId}">${varOpts}</datalist>
            `;
        } else {
            const t = (inp.type === 'number' || inp.dataType === 'number' || inp.dataType === 'float' || inp.dataType === 'int') ? 'number' : 'text';
            field = `<input type="${t}" id="${rid}" class="inp" value="${def}" placeholder="${inp.label || inp.name}">`;
        }
        const lbl = (inp.type !== 'boolean' && inp.dataType !== 'boolean')
            ? `<label class="form-label" for="${rid}">${inp.label || inp.name}</label>` : '';
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
        else if (el.dataset.ptype === 'list') {
            const val = el.value.trim();
            if (val.startsWith('[')) {
                try { inputValues[name] = JSON.parse(val); } catch (e) { inputValues[name] = val; }
            } else {
                inputValues[name] = val;
            }
        }
        else inputValues[name] = el.value;
    });

    document.getElementById('run-inputs-modal').style.display = 'none';

    if (typeof cb === 'function') {
        await cb(inputValues);
    }
    _runInputsCallback = null;
}


/**
 * ── Builder: Run Trigger ──────────────────────────
 * Direct bridge from the builder canvas to the runner pipeline.
 */
function runScraperFromBuilder() {
    const id = state.builder.currentScraperId;
    if (!id) {
        toast('Please save your scraper flow before running.', 'warning');
        openSaveFlowModal();
        return;
    }

    const btn = document.getElementById('builder-run-btn');
    runScraper(id, btn);
}


async function stopScraperRun(taskId, btn) {
    if (!confirm('Are you sure you want to force stop this scraper run?')) return;

    // Support both direct IDs (from Scrapers list) and "run_ID" strings (from Logs list)
    let cleanId = taskId;
    if (typeof taskId === 'string') {
        cleanId = taskId.replace('run_', '');
    }

    const originalText = btn ? btn.textContent : '';
    if (btn) {
        btn.disabled = true;
        btn.textContent = '⏳ Stopping...';
    }

    try {
        await apiFetch(API.stopRun(cleanId), { method: 'POST' });
        toast('Stop signal sent to scraper.', 'success');

        // Polling refresh after a short delay
        setTimeout(() => {
            loadScrapers();
            loadLogs();
            loadQueue();
        }, 1500);
    } catch (e) {
        toast(e.message, 'error');
        if (btn) {
            btn.disabled = false;
            btn.textContent = originalText;
        }
    }
}

/* ── Reusable UI Components ─── */

/* ── Table component ──────────────────────────────── */
function createTableContainer(headers, bodyRows, options = {}) {
    const { className = '', tableClass = 'data-table', thClass = '', compact = false } = options;
    return `
    <div class="table-wrapper ${className}">
        <table class="${tableClass} ${compact ? 'data-table--compact' : ''}">
            <thead>
                <tr>
                    ${headers.map(h => `<th class="${thClass}" ${h.style ? `style="${h.style}"` : ''}>${h.label}</th>`).join('')}
                </tr>
            </thead>
            <tbody>
                ${bodyRows}
            </tbody>
        </table>
    </div>`;
}

/* ── Thumbnail rendering (unified) ──────────────── */
function renderThumb(url, options = {}) {
    const { className = 'table-thumb', fallback = '🎌', alt = '' } = options;
    if (!url || !url.trim()) {
        return `<div class="${className}" style="display:flex;align-items:center;justify-content:center;background:var(--bg-input);font-size:18px">${fallback}</div>`;
    }
    return `<img class="${className}" src="${url}" alt="${alt}" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2280%22>${encodeURIComponent(fallback)}</text></svg>'">`;
}

/* ── Tag pills rendering (unified) ──────────────── */
function renderTags(tags, options = {}) {
    const { className = 'tag-pill-sm', wrap = true } = options;
    if (!tags || !tags.length) return '';
    const html = tags.map(t =>
        `<span class="${className}">${t.color ? `<span class="tag-color-dot" style="background-color:${t.color}"></span>` : ''}${t.name}</span>`
    ).join('');
    return wrap ? `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px">${html}</div>` : html;
}

/* ── Action button group (unified) ──────────────── */
function createActionGroup(buttons) {
    const btns = buttons.map(b =>
        `<button class="icon-btn ${b.danger ? 'icon-btn-danger' : ''}" onclick="${b.onclick}" title="${b.title}">${b.icon}${b.badge ? ` <span class="ver-count-badge">${b.badge}</span>` : ''}</button>`
    ).join('');
    return `<div class="action-btn-group">${btns}</div>`;
}

/* ── Status badge (unified) ────────────────────── */
function statusBadge(label, variant, icon) {
    const cls = {
        success: 'badge-success',
        failure: 'badge-failure',
        pending: 'badge-pending',
        running: 'badge-running',
        enabled: 'badge-enabled',
        disabled: 'badge-disabled',
        cancelled: 'badge-cancelled',
    }[variant] || 'badge-pending';
    return `<span class="status-badge ${cls}" style="width:fit-content">${icon ? icon + ' ' : ''}${label}</span>`;
}

/* ── Health badge (unified) ────────────────────── */
function healthBadge(health) {
    const map = {
        ok: { icon: '✅', label: 'Healthy', cls: 'badge-success' },
        failing: { icon: '❌', label: 'Failing', cls: 'badge-failure' },
        untested: { icon: '⚙️', label: 'Untested', cls: 'badge-pending' },
    };
    const h = map[health || 'untested'];
    return `<span class="status-badge ${h.cls}" style="width:fit-content">${h.icon} ${h.label}</span>`;
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

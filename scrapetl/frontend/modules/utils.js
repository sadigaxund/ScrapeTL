/* ── Shared Utilities ─── */
/* ── Utilities ──────────────────────────────────────── */
async function apiFetch(url, options = {}) {
    const headers = {};
    if (!(options.body instanceof FormData)) {
        headers['Content-Type'] = 'application/json';
    }
    const res = await fetch(url, {
        ...options,
        headers: { ...headers, ...(options.headers || {}) },
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        let msg = err.detail || `HTTP ${res.status}`;
        if (Array.isArray(msg)) {
            // FastAPI validation errors are usually a list of {loc, msg, type}
            msg = msg.map(m => m.msg || JSON.stringify(m)).join(', ');
        } else if (typeof msg === 'object' && msg !== null) {
            msg = msg.msg || msg.detail || JSON.stringify(msg);
        }
        throw new Error(msg);
    }
    return res.json();
}

function toast(msg, type = 'info') {
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    const icon = '';
    el.textContent = `${msg}`;
    document.getElementById('toast-container').appendChild(el);
    setTimeout(() => el.remove(), 4000);
}

function formatDate(isoStr) {
    if (!isoStr) return '-';
    if (typeof isoStr === 'string' && !isoStr.includes('Z') && !isoStr.includes('+')) {
        isoStr = isoStr.replace(' ', 'T') + 'Z';
    }
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return '-';
    return d.toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZone: state.timezone || 'UTC'
    });
}

function formatDateOnly(isoStr) {
    if (!isoStr) return '-';
    if (typeof isoStr === 'string' && !isoStr.includes('Z') && !isoStr.includes('+')) {
        isoStr = isoStr.replace(' ', 'T') + 'Z';
    }
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return '-';
    return d.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        timeZone: state.timezone || 'UTC'
    });
}

function formatRelativeDate(isoStr) {
    if (!isoStr) return '-';
    if (typeof isoStr === 'string' && !isoStr.includes('Z') && !isoStr.includes('+')) {
        isoStr = isoStr.replace(' ', 'T') + 'Z';
    }
    const d = new Date(isoStr);
    const now = new Date();
    if (isNaN(d.getTime())) return '-';

    const diffMs = now - d;
    if (diffMs < 0) return formatDate(isoStr); // Future date

    const seconds = Math.floor(diffMs / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (seconds < 60) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;

    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' });
}

function statusBadge(status) {
    if (!status) return `<span class="status-badge badge-pending">UNKNOWN</span>`;
    const map = {
        success: ['success'],
        failure: ['failure'],
        pending: ['pending'],
        running: ['running'],
        done: ['done'],
        failed: ['failed'],
        manual: ['manual'],
        catchup: ['catchup'],
        scheduler: ['scheduler'],
        skipped: ['skipped'],
        scheduled: ['pending'],
        cancelled: ['cancelled'],
    };
    const [cls] = map[status] || ['pending'];
    return `<span class="status-badge badge-${cls}">${status.toUpperCase()}</span>`;
}

/** 
 * Safely formats any value for display in the UI, 
 * stringifying objects to prevent [object Object]. 
 */
function formatValueForUI(val) {
    if (val === null || val === undefined) return '-';
    if (typeof val === 'object') {
        try { return JSON.stringify(val); }
        catch (e) { return String(val); }
    }
    return String(val);
}

/* ── Drag and Drop Logic ───────────────────────────── */
let _draggedItem = null;

function handleDragStart(e, type, id) {
    _draggedItem = { type, id };
    e.currentTarget.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
}

function handleDragOver(e) {
    e.preventDefault(); // allow drop
    const card = e.currentTarget;
    if (card.classList.contains('dragging')) return;
    card.classList.add('drag-over');
}

function handleDragLeave(e) {
    e.currentTarget.classList.remove('drag-over');
}

function handleDragEnd(e) {
    e.currentTarget.classList.remove('dragging');
    document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
}

async function handleDrop(e, type, targetId) {
    e.preventDefault();
    const card = e.currentTarget;
    card.classList.remove('drag-over');

    if (!_draggedItem || _draggedItem.type !== type) return;
    if (_draggedItem.id === targetId) return;

    let list;
    let apiKey;
    let refreshFn;

    if (type === 'scraper') {
        list = [...state.scrapers];
        apiKey = 'reorderScrapers';
        refreshFn = loadScrapers;
    } else if (type === 'schedule') {
        list = [...state.schedules];
        apiKey = 'reorderSchedules';
        refreshFn = loadSchedules;
    } else if (type === 'integration') {
        list = [...state.integrations];
        apiKey = 'reorderIntegrations';
        refreshFn = loadIntegrations;
    } else return;

    const fromIdx = list.findIndex(item => item.id === _draggedItem.id);
    const toIdx = list.findIndex(item => item.id === targetId);

    if (fromIdx === -1 || toIdx === -1) return;

    // Splice move
    const [moved] = list.splice(fromIdx, 1);
    list.splice(toIdx, 0, moved);

    try {
        await apiFetch(API[apiKey], {
            method: 'POST',
            body: JSON.stringify(list.map(item => item.id))
        });
        toast('Order updated', 'success');
        if (type === 'scraper') state.scrapers = list;
        else if (type === 'schedule') state.schedules = list;
        else if (type === 'integration') state.integrations = list;

        Object.keys(responseCache).forEach(k => { if (k.startsWith(type) || k.startsWith('integrations')) responseCache[k] = null; });
        refreshFn(type === 'schedule' ? true : undefined);
    } catch (e) {
        toast(e.message, 'error');
    }
}

/* ── URL helpers ────────────────────────────────────── */
function ensureHttps(url) {
    if (!url || !url.trim()) return '';
    url = url.trim();
    if (!url.startsWith('http://') && !url.startsWith('https://')) url = 'https://' + url;
    return url;
}

// Global click to close custom dropdowns
document.addEventListener('click', e => {
    document.querySelectorAll('.custom-dropdown').forEach(d => {
        if (!d.contains(e.target)) d.classList.remove('open');
    });
});

function filterDropdownConfig(inputEl) {
    const q = inputEl.value.toLowerCase();
    const items = inputEl.closest('.custom-dropdown-menu').querySelectorAll('.dropdown-item');
    items.forEach(item => {
        const text = item.textContent.toLowerCase();
        item.style.display = text.includes(q) ? 'flex' : 'none';
    });
}

/* ── Dropdown toggle (placed here for shared access) ─── */
function toggleDropdown(e, id) {
    e.stopPropagation();
    const dd = document.getElementById(id);
    const isOpen = dd.classList.contains('open');

    // Close other dropdowns
    document.querySelectorAll('.custom-dropdown').forEach(d => d.classList.remove('open'));

    // Toggle clicked
    if (!isOpen) {
        dd.classList.add('open');
        const input = dd.querySelector('.dropdown-search input');
        if (input) {
            input.value = ''; // Reset search on open
            filterDropdownConfig(input); // Reset list
            setTimeout(() => input.focus(), 50); // Small delay for animation
        }
    }
}

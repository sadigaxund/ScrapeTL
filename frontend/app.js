/* ════════════════════════════════════════════════
   ScrapeTL — Frontend Logic  v2
   Vanilla JS, no dependencies
════════════════════════════════════════════════ */

const API = {
    scrapers: '/api/scrapers',
    schedules: '/api/schedules',
    logs: '/api/logs',
    queue: '/api/queue',
    run: (id) => `/api/run/${id}`,
    available: '/api/scrapers/available',
    upload: '/api/scrapers/upload',
    tags: '/api/tags',
    scraperTags: (sid, tid) => `/api/scrapers/${sid}/tags/${tid}`,
    scheduleTags: (sid, tid) => `/api/schedules/${sid}/tags/${tid}`,
    integrations: '/api/integrations',
    scraperInteg: (sid, iid) => `/api/scrapers/${sid}/integrations/${iid}`,
    verifyInteg: (id) => `/api/integrations/${id}/verify`,
    settings: '/api/settings',
    timezones: '/api/settings/timezones',
    versions: (sid) => `/api/scrapers/${sid}/versions`,
    versionCode: (sid, vid) => `/api/scrapers/${sid}/versions/${vid}`,
    revert: (sid, vid) => `/api/scrapers/${sid}/revert/${vid}`,
    logDownload: (lid, fmt) => `/api/logs/${lid}/download?format=${fmt}`,
    reorderScrapers: '/api/scrapers/reorder',
    reorderSchedules: '/api/schedules/reorder',
    reorderIntegrations: '/api/integrations/reorder',
    variables: '/api/variables',
    functions: '/api/functions',
};

/* ── State ──────────────────────────────────────────── */
let responseCache = {};
let state = {
    scrapers: [],
    tags: [],
    integrations: [],
    currentLogsPage: 0,
    logsPageSize: 50,
    activeTagFilter: '',          // for scrapers
    activeScheduleTagFilter: '',  // for schedules
    logFilters: {
        scraperId: '',
        tagId: '',
        status: ''
    },
    expandedLogs: new Set(),
    timezone: 'UTC',       // kept in sync with /api/settings
    queueTasks: [],
    queueSort: { col: 'scheduled_for', order: 'asc' },
    variables: [],
    functions: [],
    builder: {
        x: -2000,
        y: -2000,
        isDragging: false,
        activeTool: 'pan',
        snapToGrid: true,
        nodes: [],
        edges: [],
        startX: 0,
        startY: 0,
        draggedNode: null,
        zoom: 1.0,
        activeConnection: null,  // { fromId, fromPortType, mouseX, mouseY }
        selected: null,          // { type: 'node'|'edge', id: any }
        copyBuffer: null,        // node data
        currentScraperId: null,   // track active scraper ID
        currentScraperName: null // track active scraper name
    }
};


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
    const icon = type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️';
    el.textContent = `${icon}  ${msg}`;
    document.getElementById('toast-container').appendChild(el);
    setTimeout(() => el.remove(), 4000);
}

function formatDate(isoStr) {
    if (!isoStr) return '—';
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
}

function formatDateOnly(isoStr) {
    if (!isoStr) return '—';
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
}

function formatRelativeDate(isoStr) {
    if (!isoStr) return '—';
    const d = new Date(isoStr);
    const now = new Date();
    if (isNaN(d.getTime())) return '—';

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
    if (!status) return `<span class="status-badge badge-pending">• UNKNOWN</span>`;
    const map = {
        success: ['✅', 'success'],
        failure: ['❌', 'failure'],
        pending: ['⏳', 'pending'],
        running: ['⚡', 'running'],
        done: ['✅', 'done'],
        failed: ['❌', 'failed'],
        manual: ['🖱️', 'manual'],
        catchup: ['⚠️', 'catchup'],
        scheduler: ['🕐', 'scheduler'],
        skipped: ['⏭', 'skipped'],
        scheduled: ['🗓️', 'pending'],
    };
    const [icon, cls] = map[status] || ['•', 'pending'];
    return `<span class="status-badge badge-${cls}">${icon} ${status.toUpperCase()}</span>`;
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
    const ph = document.getElementById('wiz-thumb-placeholder');
    const box = document.getElementById('wiz-thumb-preview');
    if (!url || !url.trim()) {
        img.style.display = 'none'; img.src = '';
        ph.style.display = 'inline'; ph.textContent = '🎌';
        if (box) box.style.borderColor = ''; return;
    }
    img.onload = () => { ph.style.display = 'none'; img.style.display = 'block'; if (box) box.style.borderColor = 'var(--success)'; };
    img.onerror = () => { img.style.display = 'none'; ph.style.display = 'inline'; ph.textContent = '⚠️'; if (box) box.style.borderColor = 'var(--failure)'; };
    img.src = url;
}

/* ── Tab Navigation ─────────────────────────────────── */
const TAB_META = {
    scrapers: { title: 'Scrapers', subtitle: 'Manage your scraper plugins' },
    schedules: { title: 'Schedules', subtitle: 'Configure cron-based scrape schedules' },
    logs: { title: 'Logs', subtitle: 'Full history of all scrape runs' },
    queue: { title: 'Queue', subtitle: 'Catch-up tasks for missed scheduled runs' },
    integrations: { title: 'Integrations', subtitle: 'Manage notification integrations' },
    variables: { title: 'Variables', subtitle: 'Manage global configuration registry' },
    builder: { title: 'Builder', subtitle: 'No-code scraper editor' },
    settings: { title: 'Settings', subtitle: 'App-wide configuration' },
};

function switchTab(name) {
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    document.querySelector(`[data-tab="${name}"]`).classList.add('active');
    document.getElementById(`tab-${name}`).classList.add('active');
    document.getElementById('page-title').textContent = TAB_META[name].title;
    document.getElementById('page-subtitle').textContent = TAB_META[name].subtitle;

    const addBtn = document.getElementById('main-add-btn');
    if (name === 'scrapers') { addBtn.style.display = 'inline-block'; }
    else { addBtn.style.display = 'none'; }
}

document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
        const tab = btn.getAttribute('data-tab');
        switchTab(tab);
        loadTab(tab);
    });
});

function loadTab(tab) {
    if (tab === 'scrapers') loadScrapers();
    if (tab === 'schedules') loadSchedules();
    if (tab === 'logs') loadLogs();
    if (tab === 'queue') loadQueue();
    if (tab === 'integrations') loadIntegrations();
    if (tab === 'variables') loadVariables();
    if (tab === 'settings') loadSettings();
    if (tab === 'builder') {
        initBuilder();
        renderBuilderNodes();
        renderConnections();
    }
}

const NODE_PRESETS = {
    input: {
        external: {
            title: '⚡ External Parameter',
            inputs: [],
            outputs: ['Val Out'],
            configs: [
                { key: 'name', type: 'text', label: 'Var Name', placeholder: 'my_param' },
                { key: 'dataType', type: 'select', label: 'Type', options: ['string', 'number', 'bool', 'json'] }
            ]
        },
        expression: {
            title: '📦 Expression',
            inputs: [],
            outputs: ['Val Out'],
            configs: [
                { key: 'value', type: 'expression', label: 'Value / Registry' }
            ]
        },
    },
    action: {
        fetch_url: {
            title: '🌐 Fetch HTML',
            inputs: ['URL'],
            outputs: ['HTML'],
            configs: [
                { key: 'method', type: 'select', label: 'Method', options: ['GET', 'POST'] },
                { key: 'headers', type: 'text', label: 'Extra Headers (JSON)', placeholder: '{"User-Agent": "..."}' }
            ]
        },
        fetch_playwright: {
            title: '🎭 Playwright Fetch',
            inputs: ['URL'],
            outputs: ['HTML'],
            configs: [
                { key: 'wait_for', type: 'text', label: 'Wait Selector', placeholder: '.content-ready' },
                { key: 'timeout', type: 'text', label: 'Timeout (ms)', placeholder: '30000' }
            ]
        },
        bs4_select: {
            title: '🥣 BeautifulSoup Selector',
            inputs: ['HTML'],
            outputs: ['Result'],
            configs: [
                { key: 'selector', type: 'text', label: 'CSS Selector', placeholder: '.item-title' },
                { key: 'mode', type: 'select', label: 'Match Mode', options: ['first', 'all'] },
                { key: 'output_type', type: 'select', label: 'Output Type', options: ['html', 'text', 'attr'] },
                { key: 'attribute', type: 'text', label: 'Attribute Name', placeholder: 'href' },
                { key: 'limit', type: 'text', label: 'Result Limit', placeholder: '10' }
            ]
        },
        regex_extract: {
            title: '🔍 Regex Extraction',
            inputs: ['Text'],
            outputs: ['Match'],
            configs: [
                { key: 'pattern', type: 'text', label: 'Regex Pattern', placeholder: 'score: (\\d+)' },
                { key: 'group', type: 'text', label: 'Group Index', placeholder: '1' }
            ]
        },
        text_transform: {
            title: '📝 Text Transform',
            inputs: ['Text'],
            outputs: ['Result'],
            configs: [
                { key: 'operation', type: 'select', label: 'Operation', options: ['prefix', 'suffix', 'replace', 'trim'] },
                { key: 'value', type: 'text', label: 'Param Value', placeholder: 'https://...' },
                { key: 'replacement', type: 'text', label: 'Replacement', placeholder: '' }
            ]
        },
        type_convert: {
            title: '🔢 Type Converter',
            inputs: ['Data'],
            outputs: ['Typed'],
            configs: [
                { key: 'to_type', type: 'select', label: 'Target Type', options: ['string', 'int', 'float', 'json'] }
            ]
        },
        html_children: {
            title: '🌿 HTML Children',
            inputs: ['HTML'],
            outputs: ['List'],
            configs: [
                { key: 'selector', type: 'text', label: 'Child Selector (*)', placeholder: 'li' }
            ]
        }
    },
    sink: {
        system_output: {
            title: '🏁 System Output',
            inputs: ['Data Rows'],
            outputs: [],
            configs: [
                { key: 'label', type: 'text', label: 'Collection Name', placeholder: 'Results' }
            ]
        },
        context: {
            title: '🧩 Context Registry',
            inputs: ['Data'],
            outputs: [],
            configs: [
                { key: 'variable_key', type: 'expression', label: 'Registry Key', filter: 'writable' }
            ]
        },
        debug: {
            title: '🐛 Debug Sink',
            inputs: ['Log Data'],
            outputs: [],
            configs: [
                { key: 'label', type: 'text', label: 'Artifact Label', placeholder: 'Debug' }
            ]
        }
    }
};

/* ── Builder Logic ─────────────────────────────────── */
function initBuilder() {
    const viewport = document.getElementById('builder-viewport');
    const canvas = document.getElementById('builder-canvas');
    if (!viewport || !canvas) return;

    // Apply saved offset
    canvas.style.transform = `translate(${state.builder.x}px, ${state.builder.y}px)`;

    // Only attach events once
    if (viewport.dataset.initialized) return;
    viewport.dataset.initialized = "true";

    viewport.addEventListener('mousedown', (e) => {
        // Ignore if clicking a node or port
        if (e.target.closest('.builder-node') || e.target.closest('.node-port')) return;

        if (e.button !== 0) return; // Left click only (panning)
        state.builder.isDragging = true;
        state.builder.startX = e.clientX - state.builder.x;
        state.builder.startY = e.clientY - state.builder.y;
        viewport.style.cursor = 'grabbing';
    });

    // Mouse interaction logic (Panning/Move) moved to consolidated global handlers at bottom of file

    // Zooming logic (Ctrl + Scroll)
    viewport.addEventListener('wheel', (e) => {
        if (e.ctrlKey) {
            e.preventDefault();
            const delta = -e.deltaY;
            const factor = 1.1;
            const oldZoom = state.builder.zoom;
            const newZoom = delta > 0 ? oldZoom * factor : oldZoom / factor;

            // Limit zoom
            state.builder.zoom = Math.min(Math.max(newZoom, 0.2), 3.0);

            // Note: For true "zoom to mouse", we'd need to shift X/Y too. 
            // For now, simpler zoom is fine.
            canvas.style.transform = `translate(${state.builder.x}px, ${state.builder.y}px) scale(${state.builder.zoom})`;
            updateZoomHUD();
        }
    }, { passive: false });

    // Node Placement (Click on Viewport)
    viewport.addEventListener('mousedown', (e) => {
        if (state.builder.activeTool === 'pan') return;
        if (e.target !== viewport && e.target !== canvas) return; // Only if clicking background

        const rect = canvas.getBoundingClientRect();
        let x = (e.clientX - rect.left) / state.builder.zoom;
        let y = (e.clientY - rect.top) / state.builder.zoom;

        if (state.builder.snapToGrid) {
            x = Math.round(x / 30) * 30;
            y = Math.round(y / 30) * 30;
        }

        const newNode = {
            id: Date.now(),
            x: x - 80,
            y: y - 50,
            type: state.builder.activeTool.type,
            preset: state.builder.activeTool.preset,
            config: {}
        };

        state.builder.nodes.push(newNode);
        renderBuilderNodes();

        // Auto-switch back to pan after placement
        setBuilderTool('pan');
    });

    // Deselect on background click
    viewport.addEventListener('mousedown', (e) => {
        if (e.target === viewport || e.target === canvas) {
            deselectAll();
            renderBuilderNodes();
            renderConnections();
        }
    });

    // Keyboard Shortcuts
    window.addEventListener('keydown', (e) => {
        const isEditingInput = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.contentEditable === 'true';
        if (isEditingInput) return;

        // DELETE
        if (e.key === 'Delete' || e.key === 'Backspace') {
            deleteSelected();
        }

        // CTRL+C (Copy)
        if (e.ctrlKey && e.key === 'c') {
            if (state.builder.selected && state.builder.selected.type === 'node') {
                const node = state.builder.nodes.find(n => n.id === state.builder.selected.id);
                if (node) {
                    state.builder.copyBuffer = JSON.parse(JSON.stringify(node));
                    toast('Node copied', 'info');
                }
            }
        }

        // CTRL+V (Paste)
        if (e.ctrlKey && e.key === 'v') {
            if (state.builder.copyBuffer) {
                const newNode = JSON.parse(JSON.stringify(state.builder.copyBuffer));
                newNode.id = Date.now();
                newNode.x += 40; // Offset pasted node
                newNode.y += 40;
                state.builder.nodes.push(newNode);
                renderBuilderNodes();
                toast('Node pasted', 'info');
            }
        }
    });

    // Close dropdowns on outside click
    window.addEventListener('click', (e) => {
        if (!e.target.closest('.bt-dropdown')) {
            document.querySelectorAll('.bt-dropdown').forEach(d => d.classList.remove('open'));
        }
    });
}

function updateZoomHUD() {
    const el = document.getElementById('zoom-value');
    if (el) el.textContent = `${Math.round(state.builder.zoom * 100)}%`;
}

function resetBuilderZoom() {
    state.builder.zoom = 1.0;
    const canvas = document.getElementById('builder-canvas');
    if (canvas) canvas.style.transform = `translate(${state.builder.x}px, ${state.builder.y}px) scale(1)`;
    updateZoomHUD();
}

function deselectAll() {
    state.builder.selected = null;
    document.querySelectorAll('.builder-node').forEach(n => n.classList.remove('selected'));
    document.querySelectorAll('.connection-path').forEach(p => p.classList.remove('selected'));
}

function deleteSelected() {
    if (!state.builder.selected) return;
    const { type, id } = state.builder.selected;

    if (type === 'node') {
        state.builder.nodes = state.builder.nodes.filter(n => n.id !== id);
        // Cascading delete for edges connected to this node
        state.builder.edges = state.builder.edges.filter(e => e.from !== id && e.to !== id);
        toast('Node deleted', 'info');
    } else if (type === 'edge') {
        state.builder.edges.splice(id, 1);
        toast('Connection deleted', 'info');
    }

    state.builder.selected = null;
    renderBuilderNodes();
    renderConnections();
}

function setBuilderTool(tool) {
    state.builder.activeTool = typeof tool === 'string' ? tool : state.builder.activeTool;
    document.querySelectorAll('.builder-tool-btn').forEach(b => b.classList.remove('active'));

    // If it's just 'pan'
    if (tool === 'pan') {
        const panBtn = document.getElementById('tool-pan');
        if (panBtn) panBtn.classList.add('active');
    }

    const viewport = document.getElementById('builder-viewport');
    if (viewport) {
        viewport.style.cursor = tool === 'pan' ? 'grab' : 'crosshair';
    }
}

function toggleBuilderToolDropdown(e, toolId) {
    if (e) e.stopPropagation();
    const dropdown = document.getElementById(`dropdown-${toolId}`);
    const isOpen = dropdown.classList.contains('open');

    // Close other dropdowns
    document.querySelectorAll('.bt-dropdown').forEach(d => d.classList.remove('open'));

    // Toggle current
    if (!isOpen) {
        dropdown.classList.add('open');
    }
}

function selectBuilderPreset(type, presetKey) {
    state.builder.activeTool = { type, preset: presetKey };
    document.querySelectorAll('.bt-dropdown').forEach(d => d.classList.remove('open'));
    document.querySelectorAll('.builder-tool-btn').forEach(btn => btn.classList.remove('active'));

    const toolBtn = document.getElementById(`tool-${type}`);
    if (toolBtn) {
        toolBtn.classList.add('active');
    }

    setBuilderTool({ type, preset: presetKey });
}
function renderBuilderNodes() {
    const container = document.getElementById('nodes-container');
    if (!container) return;

    // Clear existing nodes
    container.innerHTML = '';

    state.builder.nodes.forEach(node => {
        const preset = NODE_PRESETS[node.type][node.preset];
        const el = document.createElement('div');
        el.className = `builder-node builder-node--${node.type}`;
        el.id = `node-${node.id}`;
        el.style.left = `${node.x}px`;
        el.style.top = `${node.y}px`;

        if (state.builder.selected && state.builder.selected.type === 'node' && state.builder.selected.id === node.id) {
            el.classList.add('selected');
        }

        el.addEventListener('mousedown', (e) => {
            // Prevent if clicking port or interactive elements
            if (e.target.classList.contains('node-port') || 
                ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(e.target.tagName) || 
                e.target.classList.contains('btn-node-action')) return;

            e.stopPropagation();
            
            // Standardize coordinate math for canvas space
            const mouseCanvasX = (e.clientX - state.builder.x) / state.builder.zoom;
            const mouseCanvasY = (e.clientY - state.builder.y) / state.builder.zoom;

            state.builder.draggedNode = node;
            state.builder.startX = mouseCanvasX - node.x;
            state.builder.startY = mouseCanvasY - node.y;

            el.classList.add('dragging');

            // Handle selection visually without full re-render during drag start for performance
            deselectAll();
            state.builder.selected = { type: 'node', id: node.id };
            el.classList.add('selected');
            
            renderConnections();
        });

        // Ensure config exists
        node.config = node.config || {};

        // 1. Title
        const title = document.createElement('div');
        title.className = 'builder-node__title';
        title.textContent = preset.title;
        el.appendChild(title);

        // 2. Universal Node Label (NEW) - Processors only
        if (node.type === 'node') {
            const nameGroup = document.createElement('div');
            nameGroup.className = 'node-label-container';
            const nameInput = document.createElement('input');
            nameInput.className = 'node-label-input';
            nameInput.placeholder = 'Custom Label...';
            nameInput.value = node.config.internalLabel || '';
            nameInput.oninput = (e) => updateNodeConfig(node.id, 'internalLabel', e.target.value);
            nameGroup.appendChild(nameInput);
            el.appendChild(nameGroup);
        }

        // 3. Inputs (Left)
        preset.inputs.forEach((label, idx) => {
            const row = document.createElement('div');
            row.className = 'node-port-row node-port-row--input';

            const port = document.createElement('div');
            port.className = 'node-port node-port--input';
            port.id = `node-${node.id}-input-${idx}`;
            port.onmousedown = (e) => startConnection(e, node.id, 'input', idx);

            const lbl = document.createElement('span');
            lbl.className = 'node-port-label';
            lbl.textContent = label;

            row.appendChild(port);
            row.appendChild(lbl);
            el.appendChild(row);
        });

        // 4. Outputs (Right)
        preset.outputs.forEach((label, idx) => {
            const row = document.createElement('div');
            row.className = 'node-port-row node-port-row--output';

            const port = document.createElement('div');
            port.className = 'node-port node-port--output';
            port.id = `node-${node.id}-output-${idx}`;
            port.onmousedown = (e) => startConnection(e, node.id, 'output', idx);

            const lbl = document.createElement('span');
            lbl.className = 'node-port-label';
            lbl.textContent = label;

            row.appendChild(lbl);
            row.appendChild(port);
            el.appendChild(row);
        });

        // 5. Configuration UI (Moved to bottom for stability)
        if (preset.configs) {
            const configContainer = document.createElement('div');
            configContainer.className = 'node-config-container';

            preset.configs.forEach(cfg => {
                const group = document.createElement('div');
                group.className = 'node-config-group';

                const label = document.createElement('label');
                label.className = 'node-config-label';
                label.textContent = cfg.label;
                group.appendChild(label);

                if (cfg.type === 'text') {
                    const input = document.createElement('input');
                    input.className = 'node-input';
                    input.value = node.config[cfg.key] || '';
                    input.placeholder = cfg.placeholder || '';
                    input.oninput = (e) => updateNodeConfig(node.id, cfg.key, e.target.value);
                    group.appendChild(input);
                } else if (cfg.type === 'select') {
                    const select = document.createElement('select');
                    select.className = 'node-select';
                    cfg.options.forEach(opt => {
                        const o = document.createElement('option');
                        o.value = opt;
                        o.textContent = opt.charAt(0).toUpperCase() + opt.slice(1);
                        if ((node.config[cfg.key] || cfg.options[0]) === opt) o.selected = true;
                        select.appendChild(o);
                    });
                    select.onchange = (e) => updateNodeConfig(node.id, cfg.key, e.target.value);
                    group.appendChild(select);
                } else if (cfg.type === 'expression') {
                    const row = document.createElement('div');
                    row.className = 'node-config-row';

                    const input = document.createElement('input');
                    input.className = 'node-input';
                    input.style.flex = '1';
                    input.value = node.config[cfg.key] || '';
                    input.oninput = (e) => updateNodeConfig(node.id, cfg.key, e.target.value);

                    const pickBtn = document.createElement('button');
                    pickBtn.className = 'btn-node-action';
                    pickBtn.textContent = 'Pick';
                    pickBtn.onclick = (e) => {
                        e.stopPropagation();
                        openContextRegistry(node.id, cfg.key, input, cfg.filter);
                    };

                    row.appendChild(input);
                    row.appendChild(pickBtn);
                    group.appendChild(row);
                }

                configContainer.appendChild(group);
            });
            el.appendChild(configContainer);
        }

        container.appendChild(el);
    });

    renderConnections();
}

// Global mousemove for canvas panning AND node dragging
window.addEventListener('mousemove', (e) => {
    const canvas = document.getElementById('builder-canvas');
    if (!canvas) return;

    if (state.builder.isDragging) {
        state.builder.x = e.clientX - state.builder.startX;
        state.builder.y = e.clientY - state.builder.startY;
        canvas.style.transform = `translate(${state.builder.x}px, ${state.builder.y}px) scale(${state.builder.zoom})`;
        renderConnections();
    } else if (state.builder.draggedNode) {
        // Mouse canvas-space position
        const mouseCanvasX = (e.clientX - state.builder.x) / state.builder.zoom;
        const mouseCanvasY = (e.clientY - state.builder.y) / state.builder.zoom;

        let nextX = mouseCanvasX - state.builder.startX;
        let nextY = mouseCanvasY - state.builder.startY;

        if (state.builder.snapToGrid) {
            nextX = Math.round(nextX / 30) * 30;
            nextY = Math.round(nextY / 30) * 30;
        }

        state.builder.draggedNode.x = nextX;
        state.builder.draggedNode.y = nextY;

        // Update DOM directly for smooth movement
        const el = document.getElementById(`node-${state.builder.draggedNode.id}`);
        if (el) {
            el.style.left = `${nextX}px`;
            el.style.top = `${nextY}px`;
        }

        // Refresh connections while dragging
        renderConnections();
    }
});

// Consolidate Global MouseUp
window.addEventListener('mouseup', () => {
    state.builder.isDragging = false;
    state.builder.draggedNode = null;
    document.querySelectorAll('.builder-node').forEach(n => n.classList.remove('dragging'));
    const viewport = document.getElementById('builder-viewport');
    if (viewport) {
        viewport.style.cursor = state.builder.activeTool === 'pan' ? 'grab' : 'crosshair';
    }
    renderConnections();
});


/* ── Node Config Helpers ────────────────────────── */
function updateNodeConfig(nodeId, key, value) {
    const node = state.builder.nodes.find(n => n.id === nodeId);
    if (node) {
        node.config[key] = value;
    }
}

function openContextRegistry(nodeId, configKey, inputEl) {
    // Remove any existing menu
    const existing = document.querySelector('.context-registry-menu');
    if (existing) existing.remove();

    const canvas = document.getElementById('builder-canvas');
    if (!canvas) return;

    const menu = document.createElement('div');
    menu.className = 'context-registry-menu';

    // Position near the button in canvas-space
    const canvasRect = canvas.getBoundingClientRect();
    const inputRect = inputEl.getBoundingClientRect();

    // Canvas-space coords = (Viewport-space Rect - Canvas Origin) / Zoom
    const top = (inputRect.bottom - canvasRect.top) / state.builder.zoom;
    const left = (inputRect.left - canvasRect.left) / state.builder.zoom;

    menu.style.top = `${top + 5}px`;
    menu.style.left = `${left}px`;

    // Header
    const head = document.createElement('div');
    head.style = 'font-size:10px; font-weight:700; color:var(--accent); padding:4px 8px; border-bottom:1px solid rgba(255,255,255,0.1); margin-bottom:4px;';
    head.textContent = 'Context Registry';
    menu.appendChild(head);

    // 1. External Params defined in this flow
    state.builder.nodes.forEach(n => {
        if (n.id !== nodeId && n.type === 'input' && n.preset === 'external' && n.config.name) {
            const item = document.createElement('div');
            item.className = 'context-item';
            const dtype = n.config.dataType ? `<small style="opacity:0.4; margin-left:8px">(${n.config.dataType})</small>` : '';
            item.innerHTML = `<b>{{${n.config.name}}}</b> ${dtype}`;
            item.onclick = () => {
                inputEl.value += `{{${n.config.name}}}`;
                updateNodeConfig(nodeId, configKey, inputEl.value);
                menu.remove();
            };
            menu.appendChild(item);
        }
    });

    // 2. Global Variables
    state.variables.forEach(v => {
        if (filter === 'writable' && v.is_readonly) return;
        
        const item = document.createElement('div');
        item.className = 'context-item';
        const valPreview = v.value ? `<small style="opacity:0.4; margin-left:auto; max-width:80px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${v.value}</small>` : '';
        item.innerHTML = `<b>{{${v.key}}}</b> ${valPreview}`;
        item.onclick = () => {
            inputEl.value += `{{${v.key}}}`;
            updateNodeConfig(nodeId, configKey, inputEl.value);
            menu.remove();
        };
        menu.appendChild(item);
    });

    // 3. Global Functions (UDfs)
    state.functions.forEach(f => {
        const item = document.createElement('div');
        item.className = 'context-item';
        item.innerHTML = `<b>${f.name}()</b> <small style="margin-left:auto; opacity:0.5">${f.description || ''}</small>`;
        item.onclick = () => {
            inputEl.value += `${f.name}()`;
            updateNodeConfig(nodeId, configKey, inputEl.value);
            menu.remove();
        };
        menu.appendChild(item);
    });

    // 4. Built-in Functions
    const builtins = [
        { name: 'now', desc: 'Current timestamp' },
        { name: 'today', desc: 'Current date' },
        { name: 'random', desc: 'Random number' },
        { name: 'str', desc: 'Convert to string' },
        { name: 'int', desc: 'Convert to int' },
        { name: 'json', desc: 'Parse/Stringify JSON' }
    ];

    const builtinHead = document.createElement('div');
    builtinHead.style = 'font-size:10px; font-weight:700; color:var(--text-muted); padding:4px 8px; border-bottom:1px solid rgba(255,255,255,0.1); margin:8px 0 4px 0;';
    builtinHead.textContent = 'Built-in Functions';
    menu.appendChild(builtinHead);

    builtins.forEach(b => {
        const item = document.createElement('div');
        item.className = 'context-item';
        item.innerHTML = `<b>${b.name}()</b> <small style="margin-left:auto; opacity:0.5">${b.desc}</small>`;
        item.onclick = () => {
            inputEl.value += `${b.name}()`;
            updateNodeConfig(nodeId, configKey, inputEl.value);
            menu.remove();
        };
        menu.appendChild(item);
    });

    if (menu.children.length === 1) {
        const none = document.createElement('div');
        none.style = 'padding:12px; font-size:11px; color:var(--text-muted); text-align:center;';
        none.textContent = 'No registry items available.';
        menu.appendChild(none);
    }

    canvas.appendChild(menu);

    // Global click listener to close it
    const closer = (e) => {
        if (!menu.contains(e.target)) {
            menu.remove();
            document.removeEventListener('mousedown', closer);
        }
    };
    setTimeout(() => document.addEventListener('mousedown', closer), 10);
}

// ── Graph Connectivity Logic ────────────────────────
function startConnection(e, fromId, portType, portIdx) {
    e.stopPropagation();
    e.preventDefault();

    const canvas = document.getElementById('builder-canvas');
    const rect = canvas.getBoundingClientRect();
    const mouseX = (e.clientX - rect.left) / state.builder.zoom;
    const mouseY = (e.clientY - rect.top) / state.builder.zoom;

    state.builder.activeConnection = {
        fromId,
        fromType: portType,
        fromPortIdx: portIdx,
        mouseX,
        mouseY
    };

    const onMouseMove = (moveEvent) => {
        const mx = (moveEvent.clientX - rect.left) / state.builder.zoom;
        const my = (moveEvent.clientY - rect.top) / state.builder.zoom;
        state.builder.activeConnection.mouseX = mx;
        state.builder.activeConnection.mouseY = my;
        renderConnections();
    };

    const onMouseUp = (upEvent) => {
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);

        // Check if we dropped on a port
        const targetPort = upEvent.target.closest('.node-port');
        if (targetPort) {
            const targetNodeEl = targetPort.closest('.builder-node');
            const targetId = parseInt(targetNodeEl.id.replace('node-', ''));
            const isTargetInput = targetPort.classList.contains('node-port--input');
            const targetType = isTargetInput ? 'input' : 'output';

            // Find target port index
            const portRows = Array.from(targetNodeEl.querySelectorAll('.node-port-row'));
            const filteredRows = portRows.filter(r => r.classList.contains(`node-port-row--${targetType}`));
            const targetPortIdx = filteredRows.indexOf(targetPort.parentElement);

            // Valid connection: Output to Input
            if (state.builder.activeConnection.fromType !== targetType) {
                const conn = state.builder.activeConnection;
                const fromId = conn.fromId;

                const outNodeId = conn.fromType === 'output' ? fromId : targetId;
                const outPortIdx = conn.fromType === 'output' ? conn.fromPortIdx : targetPortIdx;

                const inNodeId = conn.fromType === 'input' ? fromId : targetId;
                const inPortIdx = conn.fromType === 'input' ? conn.fromPortIdx : targetPortIdx;

                // Prevent duplicates
                const exists = state.builder.edges.some(edge =>
                    edge.from === outNodeId && edge.fromIdx === outPortIdx &&
                    edge.to === inNodeId && edge.toIdx === inPortIdx
                );

                if (!exists && outNodeId !== inNodeId) {
                    state.builder.edges.push({
                        from: outNodeId, fromIdx: outPortIdx,
                        to: inNodeId, toIdx: inPortIdx
                    });
                    toast('Connection created', 'success');
                }
            }
        }

        state.builder.activeConnection = null;
        renderConnections();
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
}

function getPortPos(nodeId, type, portIdx) {
    const portEl = document.getElementById(`node-${nodeId}-${type}-${portIdx}`);
    if (!portEl) {
        // Fallback to estimation if DOM not ready (e.g. initial load)
        const node = state.builder.nodes.find(n => n.id === nodeId);
        if (!node) return { x: 0, y: 0 };
        const x = type === 'input' ? node.x : node.x + 160;
        const y = node.y + 40 + (portIdx * 24); // 40px offset for title/label area
        return { x, y };
    }

    const rect = portEl.getBoundingClientRect();
    const canvas = document.getElementById('builder-canvas');
    const canvasRect = canvas.getBoundingClientRect();

    // Center of the port in viewport space
    const viewCenterX = rect.left + rect.width / 2;
    const viewCenterY = rect.top + rect.height / 2;

    // Convert to canvas space (account for zoom and translation)
    return {
        x: (viewCenterX - canvasRect.left) / state.builder.zoom,
        y: (viewCenterY - canvasRect.top) / state.builder.zoom
    };
}

function renderConnections() {
    const svg = document.getElementById('builder-svg-layer');
    if (!svg) return;
    svg.innerHTML = '';

    // Draw existing edges
    state.builder.edges.forEach((edge, index) => {
        const fromPos = getPortPos(edge.from, 'output', edge.fromIdx);
        const toPos = getPortPos(edge.to, 'input', edge.toIdx);

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('class', 'connection-path');
        path.setAttribute('d', getBezierPath(fromPos.x, fromPos.y, toPos.x, toPos.y));

        path.oncontextmenu = (e) => {
            e.preventDefault();
            state.builder.edges.splice(index, 1);
            renderConnections();
        };

        if (state.builder.selected && state.builder.selected.type === 'edge' && state.builder.selected.id === index) {
            path.classList.add('selected');
        }

        // Invisible fat hit-area for easier selection
        const hitArea = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        hitArea.setAttribute('class', 'connection-hit-area');
        hitArea.setAttribute('d', getBezierPath(fromPos.x, fromPos.y, toPos.x, toPos.y));

        hitArea.onclick = (e) => {
            e.stopPropagation();
            deselectAll();
            state.builder.selected = { type: 'edge', id: index };
            path.classList.add('selected');
            renderBuilderNodes(); // Refresh nodes to clear node selection UI
        };

        svg.appendChild(hitArea);
        svg.appendChild(path);
    });

    // Draw active connection (preview)
    if (state.builder.activeConnection) {
        const conn = state.builder.activeConnection;
        const startPos = getPortPos(conn.fromId, conn.fromType, conn.fromPortIdx);

        const x1 = startPos.x;
        const y1 = startPos.y;
        const x2 = conn.mouseX;
        const y2 = conn.mouseY;

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('class', 'connection-path active-connection-path');

        // Ensure directionality in preview (Output to Input)
        if (conn.fromType === 'output') {
            path.setAttribute('d', getBezierPath(x1, y1, x2, y2));
        } else {
            path.setAttribute('d', getBezierPath(x2, y2, x1, y1));
        }
        svg.appendChild(path);
    }
}

function getBezierPath(x1, y1, x2, y2) {
    const dx = Math.abs(x1 - x2) * 0.5;
    return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

// ── Persistence Logic ────────────────────────────────
function openSaveFlowModal() {
    if (state.builder.nodes.length === 0) {
        toast('Cannot save an empty flow.', 'error');
        return;
    }
    document.getElementById('save-flow-modal').style.display = 'flex';
}

function closeSaveFlowModal(e) {
    if (e && e.target !== document.getElementById('save-flow-modal')) return;
    document.getElementById('save-flow-modal').style.display = 'none';
}

function updateBuilderContextUI() {
    const nameDisplay = document.getElementById('builder-current-name');
    const typeLabel = document.getElementById('builder-context-type');
    const dot = document.getElementById('builder-context-dot');
    if (!nameDisplay || !typeLabel) return;

    if (state.builder.currentScraperId) {
        typeLabel.textContent = 'EDITING';
        typeLabel.style.color = '#34d399'; // Emerald/Green for editing
        if (dot) {
            dot.style.background = '#34d399';
            dot.style.boxShadow = '0 0 10px #34d399';
        }
        nameDisplay.textContent = state.builder.currentScraperName;
    } else {
        typeLabel.textContent = 'NEW';
        typeLabel.style.color = 'var(--primary)'; // Blue/Theme for new
        if (dot) {
            dot.style.background = 'var(--primary)';
            dot.style.boxShadow = '0 0 10px var(--primary)';
        }
        nameDisplay.textContent = 'New Scraper Flow';
    }
}

function createNewFlow() {
    if (state.builder.nodes.length > 0 && !confirm('Are you sure you want to clear the canvas and start a new scraper? Any unsaved changes will be lost.')) {
        return;
    }

    // Reset state variables
    deselectAll();
    state.builder.nodes = [];
    state.builder.edges = [];
    state.builder.currentScraperId = null;
    state.builder.currentScraperName = null;
    state.builder.x = -2000;
    state.builder.y = -2000;
    state.builder.zoom = 1;
    state.builder.activeConnection = null;

    // Reset hidden inputs
    const scraperIdInput = document.getElementById('flow-scraper-id');
    const nameInput = document.getElementById('flow-name');
    const descInput = document.getElementById('flow-desc');
    if (scraperIdInput) scraperIdInput.value = '';
    if (nameInput) nameInput.value = '';
    if (descInput) descInput.value = '';

    const canvas = document.getElementById('builder-canvas');
    const nodesContainer = document.getElementById('nodes-container');
    const svgLayer = document.getElementById('builder-svg-layer');

    // 1. Brute force DOM clearing
    if (nodesContainer) nodesContainer.innerHTML = '';
    if (svgLayer) svgLayer.innerHTML = '';

    if (canvas) {
        // 2. Break GPU optimization by slightly changing the transform
        canvas.style.transform = `translate(-1999.9px, -1999.9px) scale(1)`;

        // 3. Force layout reflow
        void canvas.offsetHeight;

        // 4. Update in next animation frame
        requestAnimationFrame(() => {
            canvas.style.transform = `translate(-2000px, -2000px) scale(1)`;

            // Final render pass (with empty arrays)
            renderBuilderNodes();
            renderConnections();
            updateBuilderContextUI();
            updateBuilderZoomHUD();

            // Clear any lingering floating menus
            const menu = document.querySelector('.builder-add-menu');
            if (menu) menu.remove();

            toast('Workspace reset. Start building your new scraper!', 'info');
        });
    }
}

async function saveFlow() {
    const name = document.getElementById('flow-name').value.trim();
    const desc = document.getElementById('flow-desc').value.trim();
    if (!name) { toast('Please enter a name for your scraper.', 'error'); return; }

    const btn = document.getElementById('save-flow-btn');
    btn.disabled = true;
    btn.textContent = '⏳ Saving...';

    const flowData = JSON.stringify({
        nodes: state.builder.nodes,
        edges: state.builder.edges,
        config: {
            viewport: { x: state.builder.x, y: state.builder.y, zoom: state.builder.zoom }
        }
    });

    const formData = new FormData();
    formData.append('name', name);
    formData.append('description', desc);
    formData.append('flow_data', flowData);

    const scraperId = document.getElementById('flow-scraper-id').value;
    if (scraperId) formData.append('scraper_id', scraperId);

    try {
        const savedScraper = await apiFetch('/api/scrapers/builder', { method: 'POST', body: formData });

        // Update context so subsequent saves update THIS scraper
        state.builder.currentScraperId = savedScraper.id;
        state.builder.currentScraperName = savedScraper.name;
        document.getElementById('flow-scraper-id').value = savedScraper.id;

        toast(scraperId ? 'Flow updated successfully!' : 'Flow saved successfully!', 'success');
        updateBuilderContextUI();
        closeSaveFlowModal();
        loadScrapers(); // Refresh scrapers list
    } catch (e) {
        toast(e.message, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = '💾 Confirm & Save';
    }
}

async function editInBuilder(id) {
    const s = state.scrapers.find(x => x.id === id);
    if (!s || s.scraper_type !== 'builder') return;

    // Update context
    state.builder.currentScraperId = s.id;
    state.builder.currentScraperName = s.name;
    updateBuilderContextUI();

    try {
        // Handle both string and already-parsed object (from API)
        const flowData = s.flow_data ? (typeof s.flow_data === 'string' ? JSON.parse(s.flow_data) : s.flow_data) : null;
        if (!flowData) {
            toast('No flow data found for this scraper.', 'error');
            return;
        }

        // Hydrate state
        deselectAll();
        state.builder.nodes = flowData.nodes || [];
        state.builder.edges = flowData.edges || [];

        // Restore viewport if available
        if (flowData.config && flowData.config.viewport) {
            state.builder.x = flowData.config.viewport.x;
            state.builder.y = flowData.config.viewport.y;
            state.builder.zoom = flowData.config.viewport.zoom;
        }

        // Setup save fields for updating
        document.getElementById('flow-scraper-id').value = s.id;
        document.getElementById('flow-name').value = s.name;
        document.getElementById('flow-desc').value = s.description || '';

        updateBuilderContextUI();

        // Switch Tab
        switchTab('builder');
        loadTab('builder');

        // Re-render
        setTimeout(() => {
            renderBuilderNodes();
            renderConnections();

            // Re-apply viewport to canvas DOM specifically for the first frame
            const canvas = document.getElementById('builder-canvas');
            if (canvas) {
                canvas.style.transform = `translate(${state.builder.x}px, ${state.builder.y}px) scale(${state.builder.zoom})`;
            }
        }, 80);

        toast(`Loaded "${s.name}" into Builder`, 'info');
    } catch (e) {
        console.error("[Builder] Load Error:", e);
        toast('Failed to load flow data.', 'error');
    }
}

function downloadScraper(id) {
    window.open(`/api/scrapers/${id}/download`, '_blank');
}

/* ════════════════════════════════════════════════
   SCRAPERS
════════════════════════════════════════════════ */
async function loadScrapers() {
    const [scrapers, tags] = await Promise.all([
        apiFetch(API.scrapers),
        apiFetch(API.tags).catch(() => []),
    ]);

    const cacheKey = 'scrapers_' + state.activeTagFilter;
    const dataHash = JSON.stringify({ scrapers, tags, activeFilter: state.activeTagFilter });
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
                <div style="font-size:12px; color:var(--text-muted); margin-top:2px;">${s.description || 'No description provided.'}</div>
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
                        <button class="icon-btn" onclick="downloadScraper(${s.id})" title="Download Code">📥</button>
                        <button class="icon-btn icon-btn-danger" onclick="deleteScraper(${s.id})" title="Delete">✕</button>
                    </div>
                    <button class="btn btn-run" style="padding: 6px 14px;" onclick="runScraper(${s.id}, this)">⚡ Run</button>
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
    if (type === 'discord_webhook') return '<img src="/static/discord.svg" style="width:16px;height:16px;vertical-align:middle;margin-right:2px">';
    if (type === 'http_request') return '🌐';
    return '🔗';
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

async function runScraper(id, btn) {
    const scraper = state.scrapers.find(s => s.id === id);
    const inputs = (scraper && scraper.inputs) ? scraper.inputs : [];

    if (inputs.length > 0) {
        // Show inputs modal; it will call _doRunScraper on submit
        openRunInputsModal(id, inputs, btn);
    } else {
        await _doRunScraper(id, {}, btn);
    }
}

async function _doRunScraper(id, inputValues, btn) {
    if (btn) { btn.disabled = true; btn.textContent = '⚡ Running…'; }
    try {
        const res = await apiFetch(API.run(id), {
            method: 'POST',
            body: JSON.stringify({ input_values: inputValues }),
        });
        toast(res.detail, 'success');
        setTimeout(() => loadTab('logs'), 2500);
    } catch (e) { toast(e.message, 'error'); }
    finally { if (btn) { btn.disabled = false; btn.textContent = '▶ Run Now'; } }
}

async function deleteScraper(id) {
    if (!confirm('Delete this scraper? This will also remove its schedules and logs.')) return;
    try {
        await apiFetch(`${API.scrapers}/${id}`, { method: 'DELETE' });
        toast('Scraper deleted.', 'info');
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

        const dataHash = JSON.stringify({ filtered, tags: state.tags, activeFilter: state.activeScheduleTagFilter });
        if (responseCache['schedules_rendered'] === dataHash) return;
        responseCache['schedules_rendered'] = dataHash;

        console.log(`[Schedules] Rendering ${filtered.length}/${schedules.length} items (Filter: ${state.activeScheduleTagFilter || 'None'})`);



        document.getElementById('schedule-count').textContent = filtered.length;
        const list = document.getElementById('schedules-list');
        if (!filtered.length) {
            list.innerHTML = `<div class="empty-state">${state.activeScheduleTagFilter ? 'No schedules match the current tag filter.' : 'No schedules configured.'}</div>`;
            return;
        }
        list.innerHTML = filtered.map(s => {
            const displayName = s.label || s.scraper_name || 'Unnamed Schedule';
            const subtitle = s.label ? s.scraper_name : null;
            const thumb = s.thumbnail_url
                ? `<img src="${s.thumbnail_url}" class="sched-thumb" alt="">`
                : `<div class="sched-thumb sched-thumb--placeholder">📡</div>`;

            const tagsHtml = s.tags && s.tags.length
                ? s.tags.map(t => `<span class="tag-pill-sm"><span class="tag-color-dot" style="background-color:${t.color || '#fff'}"></span>${t.name}</span>`).join('')
                : '';

            const inputs = s.input_values && Object.keys(s.input_values).length
                ? Object.entries(s.input_values).map(([k, v]) =>
                    `<span class="sched-param"><b>${k}</b>: ${v}</span>`
                ).join('')
                : null;
            return `
            <div class="sched-card" draggable="true"
                 ondragstart="handleDragStart(event, 'schedule', ${s.id})"
                 ondragover="handleDragOver(event)"
                 ondragleave="handleDragLeave(event)"
                 ondrop="handleDrop(event, 'schedule', ${s.id})"
                 ondragend="handleDragEnd(event)"
                 onclick="toggleSchedExpand(event, ${s.id})">
              <div class="sched-card__main">
                <div class="drag-handle" title="Drag to reorder">⠿</div>
                ${thumb}
                <div class="sched-card__info">
                  <div class="sched-card__name">${displayName}</div>
                  ${subtitle ? `<div class="sched-card__subtitle">${subtitle}</div>` : ''}
                  <div class="sched-card__meta">
                    <span class="status-badge ${s.enabled ? 'badge-enabled' : 'badge-disabled'}" style="margin-right:8px; vertical-align:middle;">${s.enabled ? '\u25cf Active' : '\u25cb Disabled'}</span>
                    <code style="color:#c4b5fd;font-size:11px;vertical-align:middle;">${s.cron_expression}</code>
                    ${tagsHtml ? `<div style="display:inline-flex;flex-wrap:wrap;gap:4px;margin-left:8px;vertical-align:middle;">${tagsHtml}</div>` : ''}
                  </div>
                </div>
                <div class="sched-card__last-col">
                  ${s.last_run ? `<span class="sched-badge sched-badge--last">🕒 Last: ${formatDate(s.last_run)}</span>` : ''}
                </div>
                <div class="sched-card__next-col">
                  ${s.next_run ? `<span class="sched-badge sched-badge--next">⏭ Next: ${formatDate(s.next_run)}</span>` : '<span class="sched-badge sched-badge--none">Next: Not scheduled</span>'}
                </div>
                <div class="sched-card__actions" onclick="event.stopPropagation()">
                  <div class="action-btn-group">
                    <button class="icon-btn" onclick="openAssignTagsModal(${s.id}, 'schedule')" title="Manage Tags">🏷️</button>
                    <button class="icon-btn" onclick="openEditScheduleModal(${s.id})" title="Edit Schedule">✏️</button>
                    <button class="icon-btn" onclick="toggleSchedule(${s.id})" title="${s.enabled ? 'Disable' : 'Enable'}">${s.enabled ? '⏸️' : '▶️'}</button>
                    <button class="icon-btn icon-btn-danger" onclick="deleteSchedule(${s.id})" title="Delete">✕</button>
                  </div>
                </div>
              </div>
              ${inputs ? `<div class="sched-card__expand" id="sched-expand-${s.id}">
                <div class="sched-inputs-title">⚙ Scheduled Inputs</div>
                <div class="sched-inputs-grid">${inputs}</div>
              </div>` : ''}
            </div>`;
        }).join('');
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
        document.getElementById('summary-sched-scraper').innerHTML = `<span>— Select —</span> <span style="font-size:10px;opacity:0.5">▼</span>`;
        document.getElementById('summary-sched-preset').innerHTML = `<span>Presets</span> <span style="font-size:10px; opacity:0.5">▼</span>`;
        document.getElementById('sched-thumb-url').value = '';
        document.getElementById('sched-thumb-file').value = '';
        document.getElementById('sched-params-container').innerHTML = '<div class="empty-state" style="padding:40px 0; opacity:0.3; font-size:13px">Select a scraper to view available parameters.</div>';
        previewSchedThumb('');

        loadSchedules();
    } catch (e) { toast(e.message, 'error'); }
}

function toggleSchedExpand(event, id) {
    // Don't toggle if clicking on action buttons
    if (event.target.closest('.sched-card__actions')) return;
    const el = document.getElementById(`sched-expand-${id}`);
    if (!el) return;
    el.classList.toggle('open');
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
        const val = values[inp.name] !== undefined ? values[inp.name] : (inp.default || '');
        return `
            <div class="form-group" style="min-width: 0; flex: 1;">
                <label style="font-size: 11px;">${inp.label}${inp.required ? ' *' : ''}</label>
                <input type="text" class="edit-sched-input-field" data-name="${inp.name}" value="${val}" placeholder="${inp.description || ''}" />
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
   LOGS — collapsible card view
════════════════════════════════════════════════ */
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

function renderLogFilters() {
    // Get active item instances
    const aScrap = state.scrapers.find(s => String(s.id) === state.logFilters.scraperId);
    const aTag = state.tags.find(t => String(t.id) === state.logFilters.tagId);
    const statuses = [
        { id: '', label: 'All' },
        { id: 'running', label: '⚡ Running' },
        { id: 'success', label: '✅ Success' },
        { id: 'failure', label: '❌ Failure' },
        { id: 'skipped', label: '⏭ Skipped' }
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
        stHtml += `<button class="dropdown-item ${state.logFilters.status === st.id ? 'dropdown-item--active' : ''}" onclick="setLogFilter('status', '${st.id}')">${st.label}</button>`;
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

        const dataHash = JSON.stringify({ data, filters: state.logFilters, page: state.currentLogsPage });
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
            const hasDetails = log.payload || log.error_msg || isRunning;
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
                    </div>
                    <div class="log-col-eps">
                        <span class="log-epcount" style="display: ${log.episode_count ? 'inline-flex' : 'none'}">${log.episode_count} found</span>
                    </div>
                    <div class="log-col-retry" style="display:flex; justify-content:center;">${retryBadge}</div>
                    <div class="log-col-trigger">${statusBadge(log.triggered_by)}</div>
                    <div class="log-col-time"><span class="log-time">${formatDate(log.run_at)}</span></div>
                    <div class="log-col-icon" style="text-align:right;">${hasDetails ? `<span class="log-expand-icon" id="icon-${detailsId}">${isExpanded ? '▼' : '▶'}</span>` : ''}</div>
                </div>
                ${hasDetails ? `
                <div class="log-details" id="${detailsId}" style="display:${isExpanded ? 'block' : 'none'}">
                    ${isRunning ? `<div class="log-running-msg">Execution in progress. Results will be available after completion.</div>` : ''}
                    ${log.error_msg && !isRunning ? (log.status === 'skipped' ? `<div class="log-skipped-msg">⏭ ${log.error_msg}</div>` : `<div class="log-error">❌ ${log.error_msg}</div>`) : ''}
                    
                    ${log.debug_payload && log.debug_payload.length > 0 ? `
                    <div class="log-tabs" style="display:flex; gap:8px; margin-bottom:12px; border-bottom:1px solid var(--border-light); padding-bottom:8px;">
                        <button class="log-tab-btn active" onclick="switchLogTab('${log.id}', 'results', this)">Results</button>
                        <button class="log-tab-btn" onclick="switchLogTab('${log.id}', 'debug', this)">Debug Assets (${log.debug_payload.length})</button>
                    </div>
                    ` : ''}

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

                    ${renderLogContext(log)}
                </div>` : ''}
            </div>`;
        }).join('');

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
    } else {
        state.expandedLogs.add(id);
    }
}

function switchLogTab(logId, tab, btn) {
    const results = document.getElementById(`log-content-results-${logId}`);
    const debug = document.getElementById(`log-content-debug-${logId}`);
    if (tab === 'results') {
        results.style.display = 'block';
        debug.style.display = 'none';
    } else {
        results.style.display = 'none';
        debug.style.display = 'block';
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
            content = `
            <div class="debug-html-wrapper">
                <div class="debug-html-actions" style="margin-bottom:8px; display:flex; gap:8px;">
                    <button class="btn btn-ghost btn-sm" onclick="toggleDebugSource(this)">👁 View Source</button>
                    <button class="btn btn-ghost btn-sm active" onclick="toggleDebugPreview(this)">🖼 Preview</button>
                </div>
                <div class="debug-html-preview" style="background:#fff; border-radius:var(--radius-sm); overflow:auto; max-height:400px; padding:10px;">
                    ${a.data}
                </div>
                <pre class="debug-html-source" style="display:none; background:var(--bg-input); padding:10px; border-radius:var(--radius-sm); font-size:11px; overflow:auto; max-height:400px;">${a.data.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
            </div>`;
        } else {
            const pretty = typeof a.data === 'object' ? JSON.stringify(a.data, null, 2) : String(a.data);
            content = `<pre style="background:var(--bg-input); padding:10px; border-radius:var(--radius-sm); font-size:11px; overflow:auto; max-height:400px;">${pretty}</pre>`;
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

    if (Array.isArray(payload) && payload.length > 0) {
        const keys = Array.from(new Set(payload.map(p => Object.keys(p)).flat())).filter(k => k !== null && k !== undefined);
        let thead = '<tr>' + keys.map(k => `<th>${k.replace(/_/g, ' ').replace(/\\b\\w/g, c => c.toUpperCase())}</th>`).join('') + '</tr>';

        let tbody = payload.map(obj => {
            return '<tr>' + keys.map(k => {
                const val = (obj[k] !== null && obj[k] !== undefined) ? String(obj[k]) : '—';
                const isHtml = val.length > 10 && (val.trim().startsWith('<') || val.includes('</'));
                let cellContent = '';
                
                if (isHtml) {
                    const encoded = b64EncodeUnicode(val);
                    cellContent = `<button class="btn btn-ghost btn-sm" onclick="showHtmlModal('${encoded}')" style="font-size:10px; padding:4px 8px;">🖼 Preview HTML</button>`;
                } else {
                    let v = val;
                    if (v.length > 200) v = v.substring(0, 200) + '...';
                    if (v.startsWith('http')) v = `<a href="${v}" target="_blank" rel="noopener">Link</a>`;
                    cellContent = v;
                }
                return `<td>${cellContent}</td>`;
            }).join('') + '</tr>';
        }).join('');

        let msg = '';
        if (episodeCount && episodeCount > payload.length) {
            msg = `<div class="payload-truncation-notice">✨ Displaying <b>${payload.length}</b> out of <b>${episodeCount}</b> scraped items.</div>`;
        }

        return `<div class="payload-table-wrapper"><table class="payload-table"><thead>${thead}</thead><tbody>${tbody}</tbody></table></div>${msg}`;
    }

    const rows = Object.entries(payload)
        .filter(([, v]) => v !== null && v !== undefined && v !== '')
        .map(([k, v]) => {
            const label = k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
            let val = String(v);
            // Auto-link URLs
            if (val.startsWith('http')) val = `<a href="${val}" target="_blank" rel="noopener">${val}</a>`;
            return `<div class="payload-row"><span class="payload-key">${label}</span><span class="payload-val">${val}</span></div>`;
        });
    return `<div class="payload-grid">${rows.join('')}</div>`;
}

function showHtmlModal(encoded) {
    const html = b64DecodeUnicode(encoded);
    const modal = document.getElementById('log-context-modal'); // Reusing log modal or creating new
    const body = document.getElementById('log-context-body');
    
    body.innerHTML = `
        <div class="debug-html-wrapper">
            <div class="debug-html-actions" style="margin-bottom:12px; display:flex; gap:8px;">
                <button class="btn btn-ghost btn-sm" onclick="toggleDebugSource(this)">👁 View Source</button>
                <button class="btn btn-ghost btn-sm active" onclick="toggleDebugPreview(this)">🖼 Preview</button>
            </div>
            <div class="debug-html-preview" style="background:#fff; color:#000; border-radius:var(--radius-sm); overflow:auto; max-height:70vh; padding:12px; border:1px solid var(--border);">
                ${html}
            </div>
            <pre class="debug-html-source" style="display:none; background:var(--bg-input); padding:10px; border-radius:var(--radius-sm); font-size:11px; overflow:auto; max-height:70vh; white-space:pre-wrap; word-break:break-all;">${html.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
        </div>
    `;
    
    document.getElementById('log-context-title').textContent = 'HTML Preview';
    modal.style.display = 'flex';
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

/* ════════════════════════════════════════════════
   QUEUE
════════════════════════════════════════════════ */
async function loadQueue() {
    try {
        const tasks = await apiFetch(API.queue);

        const dataHash = JSON.stringify(tasks);
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
            ? `<button class="btn btn-ghost" style="color:var(--failure);padding:4px 8px" onclick="removeQueueTask(${t.id})">✕</button>`
            : '';

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
            <td><strong>${t.scraper_name || 'N/A'}</strong></td>
            <td style="white-space:nowrap"><span class="log-epcount" style="margin:0">${formatDate(t.scheduled_for)}</span>${timeLeftStr}</td>
            <td><div style="font-size:12px;color:var(--text-muted);max-width:150px;overflow:hidden;text-overflow:ellipsis">${t.note || '—'}</div></td>
            <td>${statusBadge(t.status)}</td>
            <td style="text-align:right">${removeBtn}</td>
        </tr>`;
    }).join('');
}

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
                 ondragstart="handleDragStart(event, 'integration', ${i.id})"
                 ondragover="handleDragOver(event)"
                 ondragleave="handleDragLeave(event)"
                 ondrop="handleDrop(event, 'integration', ${i.id})"
                 ondragend="handleDragEnd(event)">
              <div class="drag-handle" title="Drag to reorder">⠿</div>
              <div class="item-info">
                <div class="item-name" style="font-size:16px;">${integIcon(i.type)} ${i.name} ${metaChips}</div>
                <div class="item-meta" style="font-size:12px;color:var(--text-muted)">${titleType} &nbsp;•&nbsp; Created on ${formatDate(i.created_at)}</div>
                ${descriptionHTML}
              </div>
              <div class="item-actions">
                <button class="btn btn-ghost" style="font-size:12px;padding:6px 12px" onclick="openConnectorModal('${i.type}', ${i.id})">✏️ Edit</button>
                <button class="btn btn-ghost" style="font-size:12px;padding:6px 12px" onclick="testIntegration(${i.id}, this)">🧪 Test</button>
                <button class="btn btn-danger" onclick="deleteIntegration(${i.id})">✕</button>
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
   SETTINGS
════════════════════════════════════════════════ */
let _allTimezones = [];

async function loadSettings() {
    try {
        const [settings, timezones] = await Promise.all([
            apiFetch(API.settings),
            _allTimezones.length ? Promise.resolve(_allTimezones) : apiFetch(API.timezones),
        ]);
        if (!_allTimezones.length) _allTimezones = timezones; // timezones is now array of objects {id, label}

        const current = settings.timezone || 'UTC';

        const dl = document.getElementById('tz-list');
        if (dl) dl.innerHTML = _allTimezones.map(t => `<option value="${t.id}">${t.label}</option>`).join('');
        document.getElementById('tz-input').value = current;
    } catch (e) { toast(e.message, 'error'); }
}

async function saveTimezone() {
    const val = document.getElementById('tz-input').value.trim();
    if (!val) { toast('Please enter a timezone.', 'error'); return; }
    try {
        await apiFetch(`${API.settings}/timezone`, { method: 'PUT', body: JSON.stringify({ value: val }) });
        state.timezone = val;
        // Bust timestamp caches so all tabs re-render with new TZ
        Object.keys(responseCache).forEach(k => { responseCache[k] = null; });
        refreshAll();
        toast(`Timezone set to ${val}`, 'success');
    } catch (e) { toast(e.message, 'error'); }
}

/* ════════════════════════════════════════════════
   EDIT MODAL
════════════════════════════════════════════════ */
function openEditModal(id) {
    const s = state.scrapers.find(x => x.id === id);
    if (!s) return;
    document.getElementById('edit-id').value = id;
    document.getElementById('edit-name').value = s.name;
    document.getElementById('edit-homepage').value = s.homepage_url || '';
    document.getElementById('edit-desc').value = s.description || '';
    document.getElementById('edit-thumb').value = s.thumbnail_url || '';
    document.getElementById('edit-thumb-filename').textContent = '';
    // Reset code zone
    document.getElementById('edit-code-text').textContent = 'Drag & Drop a new .py file here';
    document.getElementById('edit-code-zone').style.borderColor = '';
    document.getElementById('edit-code-zone').style.background = '';
    document.getElementById('edit-code-file').value = '';

    // Container is always active now.
    // Default version fields if we have a previous version, otherwise empty
    let nextPatch = 1;
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

    try {
        await apiFetch(`${API.scrapers}/${id}`, {
            method: 'PATCH',
            body: formData,
        });
        toast('Scraper updated!', 'success');
        document.getElementById('edit-modal').style.display = 'none';
        loadScrapers();
    } catch (e) { toast(e.message, 'error'); }
    finally { btn.disabled = false; btn.textContent = '💾 Save Changes'; }
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
        const versions = await apiFetch(API.versions(scraperId));
        if (!versions.length) {
            list.innerHTML = '<div style="color:var(--text-muted);font-size:13px">No versions recorded yet.</div>';
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

function closeVersionsModal(e) {
    if (e && e.target !== document.getElementById('versions-modal')) return;
    document.getElementById('versions-modal').style.display = 'none';
}

/* ════════════════════════════════════════════════
   REFRESH + INIT
════════════════════════════════════════════════ */
function refreshAll() {
    const activeTab = document.querySelector('.tab-panel.active')?.id.replace('tab-', '');
    if (activeTab === 'scrapers') loadScrapers();
    else if (activeTab === 'schedules') loadSchedules();
    else if (activeTab === 'logs') loadLogs();
    else if (activeTab === 'queue') loadQueue();
    else if (activeTab === 'integrations') loadIntegrations();
    else if (activeTab === 'variables') loadVariables();
    else if (activeTab === 'funcs') loadFunctions();
    else if (activeTab === 'settings') loadSettings();
    apiFetch(API.queue).then(tasks => {
        const pending = tasks.filter(t => t.status === 'pending' || t.status === 'running').length;
        const badge = document.getElementById('queue-badge');
        badge.textContent = pending;
        badge.style.display = pending ? 'inline-block' : 'none';
    }).catch(() => { });
}

setInterval(refreshAll, 5000);

/* ════════════════════════════════════════════════
   RUN INPUTS MODAL
════════════════════════════════════════════════ */
let _runInputsCallback = null;  // {type:'run', id, btn} or {type:'schedule', fn}

function openRunInputsModal(scraperId, inputs, btn, scheduleCb = null) {
    _runInputsCallback = scheduleCb
        ? { type: 'schedule', fn: scheduleCb }
        : { type: 'run', id: scraperId, btn };

    const title = scheduleCb ? 'Set Schedule Inputs' : 'Run with Inputs';
    document.getElementById('run-inputs-title').textContent = title;

    const submitBtn = document.getElementById('run-inputs-submit-btn');
    if (submitBtn) {
        submitBtn.innerHTML = scheduleCb ? '📅 Create Schedule' : '▶ Run';
    }

    const form = document.getElementById('run-inputs-form');
    form.innerHTML = inputs.map(inp => {
        const id = `ri-${inp.name}`;
        const def = inp.default !== undefined ? inp.default : '';
        const desc = inp.description ? `<p class="input-desc">${inp.description}</p>` : '';
        let field = '';
        if (inp.type === 'select' && inp.options) {
            const opts = inp.options.map(o =>
                `<option value="${o}" ${String(o) === String(def) ? 'selected' : ''}>${o}</option>`
            ).join('');
            field = `<select id="${id}" class="inp">${opts}</select>`;
        } else if (inp.type === 'boolean') {
            field = `<label style="display:flex;align-items:center;gap:8px;cursor:pointer">
                <input type="checkbox" id="${id}" ${def ? 'checked' : ''} style="width:16px;height:16px">
                <span style="font-size:14px">${inp.label || inp.name}</span>
            </label>`;
        } else {
            const t = inp.type === 'number' ? 'number' : 'text';
            field = `<input type="${t}" id="${id}" class="inp" value="${def}" placeholder="${inp.label || inp.name}">`;
        }
        const lbl = inp.type !== 'boolean'
            ? `<label class="form-label" for="${id}">${inp.label || inp.name}</label>` : '';
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
        else inputValues[name] = el.value;
    });

    document.getElementById('run-inputs-modal').style.display = 'none';

    if (cb.type === 'run') {
        await _doRunScraper(cb.id, inputValues, cb.btn);
    } else if (cb.type === 'schedule') {
        await cb.fn(inputValues);
    }
    _runInputsCallback = null;
}

/* ── Drag-and-drop for code zones ───────────────────── */
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

window.addEventListener('DOMContentLoaded', () => {
    console.log("[App] DOMContentLoaded. Initializing...");
    // Load initial settings to pick up saved timezone
    apiFetch(API.settings).then(settings => {
        if (settings.timezone) state.timezone = settings.timezone;
    }).catch(e => console.error("[App] Failed to load settings:", e));

    try {
        loadScrapers();
        loadQueue();
        loadVariables();
        loadFunctions();
    } catch (e) {
        console.error("[App] Initialization error during load:", e);
    }

    // Pre-load integrations state so assign modal works from the start
    apiFetch(API.integrations).then(i => { state.integrations = i; }).catch(() => { });

    // Wire up drag-and-drop for both code upload zones
    try {
        _setupCodeDropZone('wiz-code-zone', 'wiz-code-file', 'wiz-code-text');
        _setupCodeDropZone('edit-code-zone', 'edit-code-file', 'edit-code-text');
        _setupCodeDropZone('func-code-zone', 'func-code-file', 'func-code-text');
    } catch (e) {
        console.error("[App] Failed to setup dropzones:", e);
    }
    console.log("[App] Initialization complete.");
});

/* ── Helpers for Scraper Wizard ── */
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

/* ════════════════════════════════════════════════
   CONTEXT REGISTRY (Variables & Functions)
   ════════════════════════════════════════════════ */
function switchContextTab(tab, btn) {
    document.getElementById('ctx-vars-view').style.display = tab === 'vars' ? 'block' : 'none';
    document.getElementById('ctx-funcs-view').style.display = tab === 'funcs' ? 'block' : 'none';

    const nav = btn.parentElement;
    nav.querySelectorAll('button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    if (tab === 'funcs') renderFunctionsList();
}

async function loadVariables(silent = false) {
    // Skip if editing/adding to avoid clearing local state
    if (state.variables && state.variables.some(v => v._editing || v._isNew)) return;

    try {
        const vars = await apiFetch(API.variables);
        state.variables = vars.map(v => ({ ...v, _editing: false }));
        renderVariablesList();
    } catch (e) {
        if (!silent) toast(e.message, 'error');
    }
}

function renderVariablesList() {
    const list = document.getElementById('variables-list');
    if (!list) return;

    if (!state.variables.length) {
        list.innerHTML = '<div class="empty-state">No variables defined yet.</div>';
        return;
    }

    list.innerHTML = state.variables.map((v, idx) => {
        if (v._editing || v._isNew) {
            return `
            <div class="item-card item-card--editing" style="padding:16px; gap:12px; border-color:var(--accent); background:rgba(99,102,241,0.03)">
                <div style="flex:1; display:flex; gap:12px; align-items:center;">
                    <div style="width:180px">
                        <input type="text" id="inline-var-key-${idx}" value="${v.key || ''}" placeholder="KEY_NAME" ${v._editing && !v._isNew ? 'disabled' : ''} style="width:100%; height:38px">
                    </div>
                    <div style="width:120px">
                        <select id="inline-var-type-${idx}" style="width:100%; height:38px;">
                            <option value="string" ${v.value_type === 'string' ? 'selected' : ''}>STRING</option>
                            <option value="number" ${v.value_type === 'number' ? 'selected' : ''}>NUMBER</option>
                            <option value="boolean" ${v.value_type === 'boolean' ? 'selected' : ''}>BOOLEAN</option>
                            <option value="json" ${v.value_type === 'json' ? 'selected' : ''}>JSON</option>
                        </select>
                    </div>
                    <div style="flex:1">
                        <input type="text" id="inline-var-value-${idx}" value="${v.value || ''}" placeholder="Initial Value..." style="width:100%; height:38px">
                    </div>
                    <div style="flex:1.2">
                        <input type="text" id="inline-var-desc-${idx}" value="${v.description || ''}" placeholder="Simple description (visible in logs)..." style="width:100%; height:38px">
                    </div>
                </div>
                <div style="display:flex; gap:8px;">
                    <button class="btn btn-ghost btn-sm" onclick="toggleInlineVariableSecret(${idx})" title="${v.is_secret ? 'Hide' : 'Show'} Secret" style="padding:0 10px">
                        ${v.is_secret ? '🔒' : '👁️'}
                    </button>
                    <button class="btn btn-ghost btn-sm" onclick="toggleInlineVariableReadonly(${idx})" title="${v.is_readonly ? 'Make Writable' : 'Make Read-Only'}" style="padding:0 10px; color:${v.is_readonly ? 'var(--failure)' : 'var(--text-muted)'}">
                        ${v.is_readonly ? '🚫' : '📝'}
                    </button>
                    <button class="btn btn-primary btn-sm" onclick="saveInlineVariable(${idx})" style="min-width:64px">💾 Save</button>
                    <button class="btn btn-ghost btn-sm" style="color:var(--failure)" onclick="cancelInlineEdit(${idx})">✕</button>
                </div>
            </div>`;
        }

        return `
        <div class="item-card" style="padding:12px 16px; align-items:center;">
            <div style="flex:1; display:flex; align-items:center; gap:16px; min-width:0">
                <div style="width:180px; font-family:var(--font-mono); font-weight:700; color:var(--accent); overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${v.key}</div>
                <div style="width:100px"><span class="type-pill type-${v.value_type}">${v.value_type.toUpperCase()}</span></div>
                <div style="width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--text-secondary)">${renderVariableValue(v)}</div>
                <div style="flex:1; color:var(--text-muted); opacity:0.8; font-size:13.5px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${v.description || ''}</div>
            </div>
            <div class="item-actions">
                <div class="action-btn-group">
                    <button class="icon-btn" onclick="toggleVariableSecret(${idx})" title="${v.is_secret ? 'Show' : 'Hide'} value">${v.is_secret ? '👁️' : '🔒'}</button>
                    <button class="icon-btn" onclick="toggleVariableReadonly(${idx})" title="${v.is_readonly ? 'Unlock' : 'Lock (Read-Only)'}">${v.is_readonly ? '🚫' : '📝'}</button>
                    <button class="icon-btn" onclick="editInlineVariable(${idx})" title="Edit Inline">✏️</button>
                    <button class="icon-btn icon-btn-danger" onclick="deleteVariable(${v.id})" title="Delete">✕</button>
                </div>
            </div>
        </div>`;
    }).join('');
}

function renderVariableValue(v) {
    if (v.is_secret) {
        return `<span style="letter-spacing:0.3em;opacity:0.5;font-family:monospace">••••••••</span>`;
    }
    if (v.value_type === 'boolean') {
        const isTrue = String(v.value).toLowerCase() === 'true' || v.value === '1';
        return `<span class="status-badge ${isTrue ? 'badge-success' : 'badge-failure'}">${isTrue ? 'TRUE' : 'FALSE'}</span>`;
    }
    if (v.value_type === 'json') {
        return `<code style="font-size:11px;opacity:0.7">{...}</code>`;
    }
    return `<span class="truncate-text" title="${v.value}">${v.value || '—'}</span>`;
}

function addVariableRow() {
    // Check if we are already adding one
    if (state.variables.some(v => v._isNew)) return;

    state.variables.unshift({
        key: '',
        value: '',
        value_type: 'string',
        description: '',
        is_secret: false,
        _editing: true,
        _isNew: true
    });
    renderVariablesList();
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
    const value = document.getElementById(`inline-var-value-${idx}`).value.trim();
    const description = document.getElementById(`inline-var-desc-${idx}`).value.trim();

    if (!key) { toast('Key is required', 'error'); return; }

    const payload = { value, value_type: type, is_secret: v.is_secret, is_readonly: v.is_readonly, description };
    if (v._isNew) {
        payload.key = key;
    }

    try {
        const url = v._isNew ? API.variables : `${API.variables}/${v.id}`;
        await apiFetch(url, {
            method: v._isNew ? 'POST' : 'PATCH',
            body: JSON.stringify(payload)
        });
        toast(v._isNew ? 'Variable created' : 'Variable updated', 'success');
        v._editing = false;
        v._isNew = false;
        loadVariables(true); // Force refresh to get final state from DB
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
                            <div class="ctx-subtext" style="margin-top:4px">${f.desc}</div>
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
            return `
                    <div class="ctx-item-card">
                        <div class="ctx-item-header" style="margin:0; display:flex; align-items:center;">
                            <div style="flex:1; cursor:pointer;" onclick="openContextDrawer('func', ${f.id})">
                                <div style="display:flex; align-items:center; gap:8px">
                                    <span style="font-size:18px; color:var(--success)">ƒ</span>
                                    <code class="var-key" style="font-size:14px">${f.name}</code>
                                </div>
                                <div class="ctx-subtext" style="margin-top:4px">${f.description || 'No description.'}</div>
                            </div>
                            <div class="item-actions">
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
        subtitle = 'Custom UDF';
        md = f.doc_md || 'No documentation provided.';
    } else if (type === 'builtin') {
        const builtins = [
            { name: 'today', desc: 'Returns current local date in **YYYY-MM-DD** format.', example: '{{today}}' },
            { name: 'now', desc: 'Returns current timestamp in **YYYY-MM-DD HH:MM:SS** format.', example: '{{now}}' },
            { name: 'yesterday', desc: "Returns yesterday's date in **YYYY-MM-DD** format.", example: '{{yesterday}}' },
            { name: 'env', desc: 'Accesses an environment variable from the host system.', example: '{{env("DB_PASS")}}' },
            { name: 'random', desc: 'Generates a random integer between the provided min and max values (inclusive).', example: '{{random(1, 50)}}' },
            { name: 'uuid', desc: 'Generates a unique version 4 UUID string.', example: '{{uuid()}}' },
            { name: 'json', desc: 'Converts a Python object into a JSON-formatted string.', example: '{{json({"key": "val"})}}' },
            { name: 'upper', desc: 'Transforms input text into all uppercase letters.', example: '{{upper("hi")}}' },
            { name: 'lower', desc: 'Transforms input text into all lowercase letters.', example: '{{lower("HI")}}' },
            { name: 'strip', desc: 'Removes all leading and trailing whitespace from the provided text.', example: '{{strip("  padded  ")}}' }
        ];
        const b = builtins.find(x => x.name === id);
        if (!b) return;
        title = b.name;
        subtitle = 'Built-in Function';
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

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
    variablesBatchRename: '/api/variables/batch/rename-namespace',
    functions: '/api/functions',
    stopRun: (id) => `/api/run/stop/${id}`,
    duplicateScraper: (id) => `/api/scrapers/${id}/duplicate`,
    envVariables: '/api/variables/builtins/env',
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
    builtin_envs: [], // Built-in system environment variables
    virtualNamespaces: [],  // track namespaces with no variables yet
    editingNamespace: null, // track which namespace header is being renamed
    tempNamespaceName: '',  // buffer for typing new namespace
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
    const icon = '';
    el.textContent = `${msg}`;
    document.getElementById('toast-container').appendChild(el);
    setTimeout(() => el.remove(), 4000);
}

function formatDate(isoStr) {
    if (!isoStr) return '—';
    if (typeof isoStr === 'string' && !isoStr.includes('Z') && !isoStr.includes('+')) {
        isoStr = isoStr.replace(' ', 'T') + 'Z';
    }
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return '—';
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
    if (!isoStr) return '—';
    if (typeof isoStr === 'string' && !isoStr.includes('Z') && !isoStr.includes('+')) {
        isoStr = isoStr.replace(' ', 'T') + 'Z';
    }
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        timeZone: state.timezone || 'UTC'
    });
}

function formatRelativeDate(isoStr) {
    if (!isoStr) return '—';
    if (typeof isoStr === 'string' && !isoStr.includes('Z') && !isoStr.includes('+')) {
        isoStr = isoStr.replace(' ', 'T') + 'Z';
    }
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
        success: ['•', 'success'],
        failure: ['•', 'failure'],
        pending: ['•', 'pending'],
        running: ['•', 'running'],
        done: ['•', 'done'],
        failed: ['•', 'failed'],
        manual: ['•', 'manual'],
        catchup: ['•', 'catchup'],
        scheduler: ['•', 'scheduler'],
        skipped: ['•', 'skipped'],
        scheduled: ['•', 'pending'],
        cancelled: ['•', 'failure'],
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
    if (addBtn) {
        if (name === 'scrapers') { addBtn.style.display = 'inline-block'; }
        else { addBtn.style.display = 'none'; }
    }
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
            title: 'External Parameter',
            inputs: [],
            outputs: ['Val Out'],
            configs: [
                { key: 'name', type: 'text', label: 'Var Name', placeholder: 'my_param' },
                { key: 'dataType', type: 'select', label: 'Type', options: ['string', 'number', 'bool', 'json'] }
            ]
        },
        expression: {
            title: 'Context Registry',
            inputs: [],
            outputs: ['Val Out'],
            configs: [
                { key: 'value', type: 'expression', label: 'Registry Key / Expression' }
            ]
        },
    },
    source: {
        fetch_url: {
            title: 'Fetch HTML',
            inputs: ['URL'],
            outputs: ['HTML'],
            configs: [
                { key: 'method', type: 'select', label: 'Method', options: ['GET', 'POST'] },
                { key: 'headers', type: 'text', label: 'Extra Headers (JSON)', placeholder: '{"User-Agent": "..."}' }
            ]
        },
        fetch_playwright: {
            title: 'Playwright Fetch',
            inputs: ['URL'],
            outputs: ['HTML'],
            configs: [
                { key: 'headless', type: 'checkbox', label: 'Headless Mode (Silent)', default: true },
                { key: 'actions', type: 'action_list', label: 'Playwright Actions' },
                { key: 'auto_dismiss', type: 'string_array', label: 'Auto-Dismiss Selectors (e.g. cookie banners)' }
            ]
        }
    },
    action: {
        bs4_select: {
            title: 'BeautifulSoup Selector',
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
            title: 'Regex Extraction',
            inputs: ['Text'],
            outputs: ['Match'],
            configs: [
                { key: 'pattern', type: 'text', label: 'Regex Pattern', placeholder: 'score: (\\d+)' },
                { key: 'group', type: 'text', label: 'Group Index', placeholder: '1' }
            ]
        },
        text_transform: {
            title: 'Text Transform',
            inputs: ['Text'],
            outputs: ['Result'],
            configs: [
                { key: 'operation', type: 'select', label: 'Operation', options: ['prefix', 'suffix', 'replace', 'trim'] },
                { key: 'value', type: 'text', label: 'Param Value', placeholder: 'https://...' },
                { key: 'replacement', type: 'text', label: 'Replacement', placeholder: '' }
            ]
        },
        type_convert: {
            title: 'Type Converter',
            inputs: ['Data'],
            outputs: ['Typed'],
            configs: [
                { key: 'to_type', type: 'select', label: 'Target Type', options: ['string', 'int', 'float', 'json'] }
            ]
        },
        html_children: {
            title: 'HTML Children',
            inputs: ['HTML'],
            outputs: ['List'],
            configs: [
                { key: 'selector', type: 'text', label: 'Child Selector (*)', placeholder: 'li' }
            ]
        }
    },
    sink: {
        system_output: {
            title: 'System Output',
            inputs: ['Data Rows'],
            outputs: [],
            configs: [
                { key: 'label', type: 'text', label: 'Collection Name', placeholder: 'Results' }
            ]
        },
        context: {
            title: 'Context Registry',
            inputs: ['Data'],
            outputs: [],
            configs: [
                { key: 'variable_key', type: 'expression', label: 'Target Key', filter: 'writable' }
            ]
        },
        debug: {
            title: 'Debug Sink',
            inputs: ['Log Data'],
            outputs: [],
            configs: [
                { key: 'label', type: 'text', label: 'Artifact Label', placeholder: 'Debug' }
            ]
        }
    },
    logic: {
        logic_gate: {
            title: 'Logical Gate',
            inputs: ['IN 1', 'IN 2'],
            outputs: ['True', 'False'],
            logicalInputs: 2,
            configs: [
                { key: 'mode', type: 'hidden', value: 'logical' },
                { key: 'operation', type: 'conditional_op', label: 'Gate Type', rerender: true }
            ]
        },
        comparison: {
            title: 'Comparison',
            inputs: ['Input A', 'Input B'],
            outputs: ['True', 'False'],
            configs: [
                { key: 'mode', type: 'hidden', value: 'binary' },
                { key: 'operation', type: 'conditional_op', label: 'Comparison', rerender: true }
            ]
        },
        string_match: {
            title: 'String Match',
            inputs: ['Text'],
            outputs: ['True', 'False'],
            configs: [
                { key: 'mode', type: 'hidden', value: 'string' },
                { key: 'operation', type: 'conditional_op', label: 'Match Type', rerender: true },
                { key: 'compare_value', type: 'text', label: 'Match Pattern / Value', placeholder: 'e.g. apple or ^[0-9]+$' }
            ]
        },
        status_check: {
            title: 'Status Check',
            inputs: ['Value'],
            outputs: ['True', 'False'],
            configs: [
                { key: 'mode', type: 'hidden', value: 'unary' },
                { key: 'operation', type: 'conditional_op', label: 'Check', rerender: true }
            ]
        },
        custom_logic: {
            title: 'Custom Logic',
            inputs: [],
            outputs: ['True', 'False'],
            configs: [
                { key: 'mode', type: 'hidden', value: 'custom' },
                { key: 'custom_func', type: 'expression', label: 'Target Function', filter: 'comparator' }
            ]
        }
    }
};

/* ── Semantic Function Helper ────────────────────── */
function parseFuncArgs(code, funcName) {
    if (!code || !funcName) return [];
    // 1. Clean the code of comments
    const lines = code.split('\n');
    let args = [];

    // 2. Find the def line
    const defRegex = new RegExp(`def\\s+${funcName}\\s*\\(([^)]*)\\)`);
    const match = code.match(defRegex);
    if (match && match[1]) {
        args = match[1].split(',')
            .map(a => a.trim().split(/[:=]/)[0].trim()) // Strictly capture only the identifier
            .filter(a => a && a !== 'self' && a !== 'cls');
    }
    return args;
}

function discoverDynamicPorts(nodeId) {
    const node = state.builder.nodes.find(n => n.id === nodeId);
    if (!node) return;

    // Detect function expression based on node preset
    let funcExpr = null;
    if (node.preset === 'custom_logic') {
        funcExpr = node.config.custom_func;
    } else if (node.preset === 'expression') {
        funcExpr = node.config.value;
    }

    if (funcExpr) {
        // Extract function name from {{my_func(...)}} or just my_func
        let funcName = funcExpr.replace(/[{}]/g, '').split('(')[0].trim();
        const f = state.functions.find(x => x.name === funcName);

        if (f) {
            let args = parseFuncArgs(f.code, f.name);

            // Critical Sync: Always sanitize immediately to prevent 'dirty' state
            args = args.map(a => a.split(/[:=]/)[0].trim());

            if (JSON.stringify(node.dynamic_ports) !== JSON.stringify(args)) {
                node.dynamic_ports = args;
                console.log(`[Builder] Discovered dynamic ports for ${nodeId}:`, args);
                renderBuilderNodes();
                renderConnections();
            }
            return; // Exit early if we found a valid function
        }
    }

    // If we reach here, no valid function with args was detected -> Cleanup existing ports
    if (node.dynamic_ports && node.dynamic_ports.length > 0) {
        delete node.dynamic_ports;
        console.log(`[Builder] Cleared dynamic ports for ${nodeId}`);
        renderBuilderNodes();
        renderConnections();
    }
}

/**
 * 🧹 Project Migration / Sanitization
 * Retroactively cleans up 'dirty' port handles and edge metadata (legacy type hints)
 */
function sanitizeBuilderState() {
    if (!state.builder || !state.builder.nodes) return;

    let changed = false;

    // 1. Clean dynamic_ports on nodes
    state.builder.nodes.forEach(node => {
        if (node.dynamic_ports && node.dynamic_ports.length > 0) {
            const clean = node.dynamic_ports.map(p => p.split(/[:=]/)[0].trim());
            if (JSON.stringify(clean) !== JSON.stringify(node.dynamic_ports)) {
                node.dynamic_ports = clean;
                changed = true;
            }
        }
    });

    // 2. Clean targetHandle on edges
    state.builder.edges.forEach(edge => {
        if (edge.targetHandle && edge.targetHandle.includes(':') || edge.targetHandle && edge.targetHandle.includes(' ')) {
            const clean = edge.targetHandle.split(/[:=]/)[0].trim();
            if (clean !== edge.targetHandle) {
                edge.targetHandle = clean;
                changed = true;
            }
        }
    });

    if (changed) {
        console.log("[Builder] Sanitized legacy state (stripped type hints from ports/edges)");
        renderBuilderNodes();
        renderConnections();
    }
}

/**
 * 💡 Auto-Injection Helper
 * Replaces the N-th argument in an expression with the given variable name.
 */
function injectVariableIntoExpression(expr, portName, portIdx) {
    if (!expr) return expr;

    // Detect standard {{func(arg1, arg2)}} pattern
    const regex = /({{[a-zA-Z0-9_]+\()([^)]*)(\)}})/;
    const match = expr.match(regex);
    if (!match) return expr;

    const prefix = match[1]; // {{func(
    const argsStr = match[2]; // a, b
    const suffix = match[3]; // )}}

    let args = argsStr.split(',').map(a => a.trim());

    // Inject port name as the variable instead of a literal
    if (portIdx < args.length) {
        args[portIdx] = portName;
    } else {
        // Fallback for custom logic growth
        args[portIdx] = portName;
    }

    return `${prefix}${args.join(', ')}${suffix}`;
}

/* ── Conditional Node Helpers ───────────────────────── */
function getConditionalOps(modeOrPreset) {
    // Mapping preset keys to engine modes for convenience
    const presetToMode = {
        'logic_gate': 'logical',
        'comparison': 'binary',
        'string_match': 'string',
        'status_check': 'unary'
    };
    const mode = presetToMode[modeOrPreset] || modeOrPreset;

    const ops = {
        logical: [
            { value: 'AND', label: 'AND — All inputs truthy' },
            { value: 'OR', label: 'OR — Any input truthy' },
            { value: 'NAND', label: 'NAND — Not all truthy' },
            { value: 'NOR', label: 'NOR — None truthy' },
            { value: 'XOR', label: 'XOR — Odd count truthy' },
            { value: 'XNOR', label: 'XNOR — Even count truthy' },
            { value: 'NOT', label: 'NOT — Negate Input A' },
        ],
        unary: [
            { value: 'is_truthy', label: 'Is Truthy' },
            { value: 'is_falsy', label: 'Is Falsy' },
            { value: 'is_null', label: 'Is Null / None' },
            { value: 'is_not_null', label: 'Is Not Null' },
            { value: 'is_empty', label: 'Is Empty (str/list/dict)' },
            { value: 'is_not_empty', label: 'Is Not Empty' },
            { value: 'is_boolean', label: 'Is Boolean' },
            { value: 'is_numeric', label: 'Is Numeric' },
            { value: 'is_list', label: 'Is List' },
        ],
        string: [
            { value: 'contains', label: 'Contains' },
            { value: 'not_contains', label: 'Does Not Contain' },
            { value: 'starts_with', label: 'Starts With' },
            { value: 'ends_with', label: 'Ends With' },
            { value: 'equals', label: 'Equals (case-sensitive)' },
            { value: 'iequals', label: 'Equals (ignore case)' },
            { value: 'not_equals', label: 'Not Equals' },
            { value: 'matches_regex', label: 'Matches Regex' },
            { value: 'length_gt', label: 'Length > N' },
            { value: 'length_lt', label: 'Length < N' },
        ],
        binary: [
            { value: 'eq', label: '= Equal To' },
            { value: 'neq', label: '≠ Not Equal' },
            { value: 'gt', label: '> Greater Than' },
            { value: 'gte', label: '≥ Greater or Equal' },
            { value: 'lt', label: '< Less Than' },
            { value: 'lte', label: '≤ Less or Equal' },
            { value: 'between', label: '↔ Between (min,max)' },
        ],
        custom: [
            { value: 'custom_func', label: 'Custom Function → bool' },
        ]
    };
    return ops[mode] || ops.logical;
}

/**
 * Parse parameter names from a Python function's first line.
 * e.g. "def my_func(arg1, arg2=None):" → ['arg1', 'arg2']
 */
function parseFuncArgs(code) {
    if (!code) return [];
    const match = code.match(/^\s*def\s+\w+\s*\(([^)]*)\)/m);
    if (!match || !match[1].trim()) return [];
    return match[1].split(',')
        .map(p => p.trim().split('=')[0].trim())
        .filter(p => p && p !== 'self');
}

/* ── Builder Logic ─────────────────────────────────── */
function initBuilder() {
    const viewport = document.getElementById('builder-viewport');
    const canvas = document.getElementById('builder-canvas');
    if (!viewport || !canvas) return;

    // Apply saved offset and initial zoom
    canvas.style.transform = `translate(${state.builder.x}px, ${state.builder.y}px) scale(${state.builder.zoom})`;
    updateZoomHUD();

    // Only attach events once
    if (canvas.dataset.initialized) return;
    canvas.dataset.initialized = "true";

    // Unified Interaction Handler on viewport to ensure NO CLICKS ARE MISSED
    viewport.addEventListener('mousedown', (e) => {
        const node = e.target.closest('.builder-node');
        const port = e.target.closest('.node-port');

        // A. If clicking a node or port, let their specific listeners handle it
        if (node || port) {
            console.log("[Builder] Clicked a node or port", node, port);
            return;
        }

        // B. It's a workspace interaction (Background)
        const vRect = viewport.getBoundingClientRect();

        // Calculate canvas-space coordinates from viewport-relative click
        let x = (e.clientX - vRect.left - state.builder.x) / state.builder.zoom;
        let y = (e.clientY - vRect.top - state.builder.y) / state.builder.zoom;

        // B1. Handle Panning
        if (state.builder.activeTool === 'pan') {
            if (e.button === 0) { // Left Click
                state.builder.isDragging = true;
                state.builder.startX = e.clientX - state.builder.x;
                state.builder.startY = e.clientY - state.builder.y;
                viewport.style.cursor = 'grabbing';

                deselectAll();
                renderBuilderNodes();
                renderConnections();
            }
            return;
        }

        // B2. Handle Node Placement
        if (typeof state.builder.activeTool === 'object' && state.builder.activeTool !== null) {
            // Calculate target top-left while centering node on click
            let tx = x - 80;
            let ty = y - 50;

            if (state.builder.snapToGrid) {
                tx = Math.round(tx / 30) * 30;
                ty = Math.round(ty / 30) * 30;
            }

            const presetData = NODE_PRESETS[state.builder.activeTool.type][state.builder.activeTool.preset];
            const newNode = {
                id: Date.now(),
                x: tx,
                y: ty,
                type: state.builder.activeTool.type,
                preset: state.builder.activeTool.preset,
                config: {}
            };

            // Pre-initialize hidden config fields to avoid render-time re-renders
            if (presetData.configs) {
                presetData.configs.forEach(c => {
                    if (c.type === 'hidden') newNode.config[c.key] = c.value;
                });
            }

            state.builder.nodes.push(newNode);
            toast(`${presetData.title} Added`, 'success');

            try {
                renderBuilderNodes();
            } catch (err) {
                console.error("[Builder] Render nodes crash after placement:", err);
                toast(`Render Crash: ${err.message}`, 'error');
            }

            // Auto-switch back to pan after placement
            setBuilderTool('pan');
            return;
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

    // Ctrl + Scroll Zooming
    viewport.addEventListener('wheel', (e) => {
        if (e.ctrlKey) {
            e.preventDefault();
            const delta = e.deltaY > 0 ? 0.9 : 1.1;
            const newZoom = Math.min(Math.max(state.builder.zoom * delta, 0.1), 3.0);
            setZoom(newZoom, e.clientX, e.clientY);
        }
    }, { passive: false });

    // Sync initial visuals
    updateZoomHUD();
}

function sliderToZoom(val) {
    val = parseFloat(val);
    if (val <= 50) {
        // 0 to 50 maps to 0.1 to 1.0 (10% to 100%)
        return 0.1 + (val / 50) * 0.9;
    } else {
        // 50 to 100 maps to 1.0 to 3.0 (100% to 300%)
        return 1.0 + ((val - 50) / 50) * 2.0;
    }
}

function zoomToSlider(zoom) {
    if (zoom <= 1.0) {
        // 0.1 to 1.0 maps to 0 to 50
        return ((zoom - 0.1) / 0.9) * 50;
    } else {
        // 1.0 to 3.0 maps to 50 to 100
        return 50 + ((zoom - 1.0) / 2.0) * 50;
    }
}

function setZoom(newZoom, mouseX = null, mouseY = null) {
    const canvas = document.getElementById('builder-canvas');
    const viewport = document.getElementById('builder-viewport');
    if (!canvas || !viewport) return;

    const oldZoom = state.builder.zoom;

    if (mouseX !== null && mouseY !== null) {
        const vRect = viewport.getBoundingClientRect();
        const mx = mouseX - vRect.left;
        const my = mouseY - vRect.top;
        const cx = (mx - state.builder.x) / oldZoom;
        const cy = (my - state.builder.y) / oldZoom;

        state.builder.x = mx - cx * newZoom;
        state.builder.y = my - cy * newZoom;
    }

    state.builder.zoom = newZoom;
    canvas.style.transform = `translate(${state.builder.x}px, ${state.builder.y}px) scale(${state.builder.zoom})`;

    updateZoomHUD();
    renderConnections();
}

function updateZoomHUD() {
    const textEl = document.getElementById('zoom-value');
    const sliderEl = document.getElementById('zoom-slider');
    const bubbleEl = document.getElementById('zoom-bubble');
    const percentage = Math.round(state.builder.zoom * 100);

    if (textEl) textEl.textContent = `${percentage}%`;
    if (sliderEl) {
        sliderEl.value = zoomToSlider(state.builder.zoom);
    }
}

function resetBuilderZoom() {
    state.builder.x = -2000;
    state.builder.y = -2000;
    setZoom(1.0);
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
    state.builder.activeTool = tool;
    document.querySelectorAll('.builder-tool-btn').forEach(b => b.classList.remove('active'));

    const viewport = document.getElementById('builder-viewport');
    const canvas = document.getElementById('builder-canvas');

    // Highlight the correct tool button
    if (tool === 'pan') {
        const panBtn = document.getElementById('tool-pan');
        if (panBtn) panBtn.classList.add('active');
        if (viewport) viewport.style.cursor = 'grab';
        if (canvas) canvas.style.cursor = 'grab';
    } else if (tool && typeof tool === 'object') {
        const toolBtn = document.getElementById(`tool-${tool.type}`);
        if (toolBtn) {
            toolBtn.classList.add('active');
        }
        if (viewport) viewport.style.cursor = 'crosshair';
        if (canvas) canvas.style.cursor = 'crosshair';
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
    setBuilderTool({ type, preset: presetKey });
    document.querySelectorAll('.bt-dropdown').forEach(d => d.classList.remove('open'));
}
function renderBuilderNodes() {
    const container = document.getElementById('nodes-container');
    if (!container) return;

    // Clear existing nodes
    container.innerHTML = '';

    state.builder.nodes.forEach(node => {
        try {
            const nodeTypes = NODE_PRESETS[node.type];
            if (!nodeTypes) {
                console.warn(`[Builder] Missing node type: ${node.type}`, node);
                return;
            }
            const preset = nodeTypes[node.preset];
            if (!preset) {
                console.warn(`[Builder] Missing node preset: ${node.preset} for type ${node.type}`, node);
                return;
            }

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
                if (e.target.closest('.node-port') ||
                    ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'LABEL'].includes(e.target.tagName) ||
                    e.target.classList.contains('btn-node-action')) return;

                e.stopPropagation();

                const viewport = document.getElementById('builder-viewport');
                const vRect = viewport ? viewport.getBoundingClientRect() : { left: 0, top: 0 };

                // Standardize coordinate math for canvas space
                const mouseCanvasX = (e.clientX - vRect.left - state.builder.x) / state.builder.zoom;
                const mouseCanvasY = (e.clientY - vRect.top - state.builder.y) / state.builder.zoom;

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

            // 2. Universal Node Label - Processors only (Type 'action')
            if (node.type === 'action') {
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

            // Natural Header Control Bar for Logical nodes (STATIONARY)
            if (node.preset === 'conditional' && (node.config.mode || 'logical') === 'logical') {
                const count = Number(node.config.logicalInputs || 2);
                const controls = document.createElement('div');
                controls.className = 'node-port-controls node-port-controls--top';

                // Subtract Button
                // Subtract Button
                const subBtn = document.createElement('button');
                subBtn.className = 'btn-port-footer btn-port-footer-sub';
                subBtn.textContent = '−';
                subBtn.title = 'Remove Last Input';
                if (count <= 2) subBtn.disabled = true;

                subBtn.onmousedown = (e) => {
                    if (e.button !== 0) return;
                    e.stopPropagation();
                    const targetNode = state.builder.nodes.find(n => n.id === node.id);
                    if (!targetNode) return;

                    const curCount = Number(targetNode.config.logicalInputs || 2);
                    if (curCount <= 2) return;

                    const newVal = curCount - 1;
                    targetNode.config.logicalInputs = newVal;

                    // Cleanup connections for the removed port index (EDGES is the correct property)
                    state.builder.edges = state.builder.edges.filter(edge =>
                        !(edge.to === node.id && Number(edge.toIdx) === curCount - 1)
                    );

                    renderBuilderNodes();
                    renderConnections();
                };

                // Add Button
                const addBtn = document.createElement('button');
                addBtn.className = 'btn-port-footer btn-port-footer-add';
                addBtn.textContent = '+';
                addBtn.title = 'Add More Inputs';

                addBtn.onmousedown = (e) => {
                    if (e.button !== 0) return;
                    e.stopPropagation();
                    const targetNode = state.builder.nodes.find(n => n.id === node.id);
                    if (!targetNode) return;

                    const curCount = Number(targetNode.config.logicalInputs || 2);
                    targetNode.config.logicalInputs = curCount + 1;

                    renderBuilderNodes();
                    renderConnections();
                };

                controls.appendChild(subBtn);
                controls.appendChild(addBtn);
                el.appendChild(controls);
            }

            // 3. Inputs (Left)
            let nodeInputs = [];
            if (node.dynamic_ports && node.dynamic_ports.length > 0) {
                nodeInputs = node.dynamic_ports;
            } else if (node.preset === 'conditional') {
                const mode = node.config.mode || 'logical';
                if (mode === 'logical') {
                    const count = Number(node.config.logicalInputs || 2);
                    for (let i = 1; i <= count; i++) nodeInputs.push(`IN ${i}`);
                } else if (node.preset === 'comparison') {
                    nodeInputs = ['Input A', 'Input B'];
                } else if (node.preset === 'status_check' || node.preset === 'string_match') {
                    nodeInputs = [preset.inputs[0]];
                } else {
                    nodeInputs = ['Input A', 'Input B'];
                }
            } else {
                nodeInputs = preset.inputs || [];
            }

            nodeInputs.forEach((label, idx) => {
                const row = document.createElement('div');
                row.className = 'node-port-row node-port-row--input';

                const port = document.createElement('div');
                port.className = 'node-port node-port--input';
                port.id = `node-${node.id}-input-${idx}`;

                // Variadic/Dynamic handle mapping
                let handle = null;
                if (node.dynamic_ports) {
                    handle = node.dynamic_ports[idx];
                    port.dataset.namedHandle = handle; // Store for drop-detection
                } else if (node.preset === 'logic_gate') {
                    handle = `input_${idx}`;
                }
                port.onmousedown = (e) => startConnection(e, node.id, 'input', idx, handle);

                const lbl = document.createElement('span');
                lbl.className = 'node-port-label';
                lbl.textContent = label;

                row.appendChild(port);
                row.appendChild(lbl);

                el.appendChild(row);
            });

            // 3.1 Universal Trigger Port (Bottom of Inputs)
            // EXCLUSION: Skip for 'input' and 'sink' nodes
            if (node.type !== 'input' && node.type !== 'sink') {
                const trigRow = document.createElement('div');
                trigRow.className = 'node-port-row node-port-row--input node-port-row--universal';
                
                const trigPort = document.createElement('div');
                trigPort.className = 'node-port node-port--input node-port--trigger';
                trigPort.id = `node-${node.id}-input-trigger`;
                trigPort.onmousedown = (e) => startConnection(e, node.id, 'input', 'trigger', 'trigger');

                const trigLbl = document.createElement('span');
                trigLbl.className = 'node-port-label node-port-label--trigger';
                trigLbl.textContent = 'Trigger';

                trigRow.appendChild(trigPort);
                trigRow.appendChild(trigLbl);
                el.appendChild(trigRow);
            }

            // 4. Outputs (Right)
            (preset.outputs || []).forEach((label, idx) => {
                const row = document.createElement('div');
                row.className = 'node-port-row node-port-row--output';

                const port = document.createElement('div');
                // Colour True/False ports on conditional nodes
                let portClass = 'node-port node-port--output';
                if (node.type === 'logic') {
                    portClass += idx === 0 ? ' node-port--true' : ' node-port--false';
                }
                port.className = portClass;
                port.id = `node-${node.id}-output-${idx}`;
                port.onmousedown = (e) => startConnection(e, node.id, 'output', idx);

                const lbl = document.createElement('span');
                lbl.className = 'node-port-label';
                lbl.textContent = label;

                row.appendChild(lbl);
                row.appendChild(port);
                el.appendChild(row);
            });

            // 4.1 Universal Error Port (Bottom of Outputs)
            // EXCLUSION: Skip for 'input' and 'sink' nodes
            if (node.type !== 'input' && node.type !== 'sink') {
                const errRow = document.createElement('div');
                errRow.className = 'node-port-row node-port-row--output node-port-row--universal';

                const errPort = document.createElement('div');
                errPort.className = 'node-port node-port--output node-port--error';
                errPort.id = `node-${node.id}-output-error`;
                errPort.onmousedown = (e) => startConnection(e, node.id, 'output', 'error', 'error');

                const errLbl = document.createElement('span');
                errLbl.className = 'node-port-label node-port-label--error';
                errLbl.textContent = 'Error';

                errRow.appendChild(errLbl);
                errRow.appendChild(errPort);
                el.appendChild(errRow);
            }

            // 5. Configuration UI (Moved to bottom for stability)
            if (preset.configs) {
                const configContainer = document.createElement('div');
                configContainer.className = 'node-config-container';

                preset.configs.forEach(cfg => {
                    if (cfg.type === 'hidden') return;
                    if (cfg.visible && !cfg.visible(node)) return;

                    const group = document.createElement('div');
                    group.className = 'node-config-group';

                    const label = document.createElement('label');
                    label.className = 'node-config-label';
                    label.textContent = cfg.label;
                    group.appendChild(label);

                    if (cfg.type === 'text') {
                        const isJson = cfg.label.toLowerCase().includes('json') || cfg.label.toLowerCase().includes('headers');

                        if (isJson) {
                            const textarea = document.createElement('textarea');
                            textarea.className = 'inline-json-editor';
                            textarea.style.minHeight = '100px';
                            textarea.style.marginTop = '8px';
                            textarea.value = node.config[cfg.key] || '';
                            textarea.placeholder = cfg.placeholder || '';
                            textarea.oninput = (e) => {
                                updateNodeConfig(node.id, cfg.key, e.target.value);
                                validateInlineJson(e.target);
                            };
                            group.appendChild(textarea);
                            setTimeout(() => validateInlineJson(textarea), 0);
                        } else {
                            const input = document.createElement('input');
                            input.className = 'node-input';
                            input.value = node.config[cfg.key] || '';
                            input.placeholder = cfg.placeholder || '';
                            input.oninput = (e) => updateNodeConfig(node.id, cfg.key, e.target.value);
                            group.appendChild(input);
                        }
                    } else if (cfg.type === 'select') {
                        const select = document.createElement('select');
                        select.className = 'node-select';
                        (cfg.options || []).forEach(opt => {
                            const o = document.createElement('option');
                            o.value = opt;
                            o.textContent = opt.charAt(0).toUpperCase() + opt.slice(1);
                            if ((node.config[cfg.key] || cfg.options[0]) === opt) o.selected = true;
                            select.appendChild(o);
                        });
                        select.onchange = (e) => {
                            updateNodeConfig(node.id, cfg.key, e.target.value);
                            if (cfg.rerender) { renderBuilderNodes(); renderConnections(); }
                        };
                        group.appendChild(select);
                    } else if (cfg.type === 'conditional_op') {
                        const currentMode = node.config.mode || 'logical';
                        const ops = getConditionalOps(currentMode);
                        const currentOp = node.config[cfg.key] || ops[0].value;
                        const opSelect = document.createElement('select');
                        opSelect.className = 'node-select';
                        ops.forEach(op => {
                            const o = document.createElement('option');
                            o.value = op.value;
                            o.textContent = op.label;
                            if (currentOp === op.value) o.selected = true;
                            opSelect.appendChild(o);
                        });
                        opSelect.onchange = (e) => updateNodeConfig(node.id, cfg.key, e.target.value);
                        group.appendChild(opSelect);
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
                    } else if (cfg.type === 'checkbox') {
                        const wrap = document.createElement('label');
                        wrap.style = 'display:flex; align-items:center; gap:8px; cursor:pointer; font-size:11px; color:var(--text-secondary); margin-top:4px';

                        const cb = document.createElement('input');
                        cb.type = 'checkbox';
                        const currentVal = node.config[cfg.key];
                        cb.checked = currentVal !== undefined ? currentVal : (cfg.default !== undefined ? cfg.default : true);
                        cb.onchange = (e) => updateNodeConfig(node.id, cfg.key, e.target.checked);

                        wrap.appendChild(cb);
                        wrap.appendChild(document.createTextNode(cfg.label));
                        group.innerHTML = '';
                        group.appendChild(wrap);
                    } else if (cfg.type === 'action_list') {
                        renderActionListUI(node.id, cfg.key, group);
                    } else if (cfg.type === 'string_array') {
                        renderStringArrayUI(node.id, cfg.key, group);
                    }

                    configContainer.appendChild(group);
                });
                el.appendChild(configContainer);
            }

            container.appendChild(el);
        } catch (err) {
            console.error("[Builder] Failed to render node:", node, err);
        }
    });

    renderConnections();
}

// Global mousemove for canvas panning AND node dragging
window.addEventListener('mousemove', (e) => {
    const canvas = document.getElementById('builder-canvas');
    const viewport = document.getElementById('builder-viewport');
    if (!canvas || !viewport) return;

    if (state.builder.isDragging) {
        state.builder.x = e.clientX - state.builder.startX;
        state.builder.y = e.clientY - state.builder.startY;
        canvas.style.transform = `translate(${state.builder.x}px, ${state.builder.y}px) scale(${state.builder.zoom})`;
        renderConnections();
    } else if (state.builder.draggedNode) {
        const vRect = viewport.getBoundingClientRect();
        // Mouse canvas-space position
        const mouseCanvasX = (e.clientX - vRect.left - state.builder.x) / state.builder.zoom;
        const mouseCanvasY = (e.clientY - vRect.top - state.builder.y) / state.builder.zoom;

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

        // Semantic Contract: Trigger port discovery if relevant fields changed
        if (key === 'mode' || key === 'custom_func' || key === 'value') {
            discoverDynamicPorts(nodeId);
        }
    }
}

function renderActionListUI(nodeId, configKey, container) {
    const node = state.builder.nodes.find(n => n.id === nodeId);
    if (!node) return;

    // Initialize if empty
    if (!Array.isArray(node.config[configKey])) {
        node.config[configKey] = [];
    }

    const listContainer = document.createElement('div');
    listContainer.className = 'macro-list-container';

    const renderList = () => {
        listContainer.innerHTML = '';
        const actions = node.config[configKey];

        actions.forEach((action, idx) => {
            const row = document.createElement('div');
            row.className = 'macro-row';

            const typeSelect = document.createElement('select');
            typeSelect.className = 'node-select macro-select';
            const types = {
                'click': 'Click',
                'wait': 'Wait (ms)',
                'wait_for_selector': 'Wait For',
                'scroll_bottom': 'Scroll Bottom',
                'scroll_to': 'Scroll To Selector',
                'goto': 'Go To URL',
                'type': 'Type Text'
            };
            for (const [k, v] of Object.entries(types)) {
                const opt = document.createElement('option');
                opt.value = k;
                opt.textContent = v;
                if (action.type === k) opt.selected = true;
                typeSelect.appendChild(opt);
            }
            typeSelect.onchange = (e) => {
                actions[idx].type = e.target.value;
                updateNodeConfig(nodeId, configKey, actions);
                renderList(); // Refresh to show/hide value input if needed
            };

            row.appendChild(typeSelect);

            if (action.type !== 'scroll_bottom') {
                const valInput = document.createElement('input');
                valInput.className = 'node-input macro-input';
                valInput.placeholder = action.type === 'wait' ? '2000' : 'Selector or URL...';
                valInput.value = action.value || '';
                valInput.oninput = (e) => {
                    actions[idx].value = e.target.value;
                    updateNodeConfig(nodeId, configKey, actions);
                };
                row.appendChild(valInput);
            }

            const delBtn = document.createElement('button');
            delBtn.className = 'btn-macro-del';
            delBtn.textContent = '✕';
            delBtn.onclick = (e) => {
                e.stopPropagation();
                actions.splice(idx, 1);
                updateNodeConfig(nodeId, configKey, actions);
                renderList();
            };
            row.appendChild(delBtn);

            listContainer.appendChild(row);
        });

        const addBtn = document.createElement('button');
        addBtn.className = 'btn-macro-add';
        addBtn.textContent = '+ Add Action';
        addBtn.onclick = (e) => {
            e.stopPropagation();
            actions.push({ type: 'wait_for_selector', value: '' });
            updateNodeConfig(nodeId, configKey, actions);
            renderList();
        };
        listContainer.appendChild(addBtn);
    };

    renderList();
    container.appendChild(listContainer);
}

function renderStringArrayUI(nodeId, configKey, container) {
    const node = state.builder.nodes.find(n => n.id === nodeId);
    if (!node) return;

    if (!Array.isArray(node.config[configKey])) {
        node.config[configKey] = [];
    }

    const listContainer = document.createElement('div');
    listContainer.className = 'macro-list-container';

    const renderList = () => {
        listContainer.innerHTML = '';
        const items = node.config[configKey];

        items.forEach((item, idx) => {
            const row = document.createElement('div');
            row.className = 'macro-row';

            const valInput = document.createElement('input');
            valInput.className = 'node-input macro-input';
            valInput.placeholder = '.close-modal-btn';
            valInput.value = item || '';
            valInput.oninput = (e) => {
                items[idx] = e.target.value;
                updateNodeConfig(nodeId, configKey, items);
            };
            row.appendChild(valInput);

            const delBtn = document.createElement('button');
            delBtn.className = 'btn-macro-del';
            delBtn.textContent = '✕';
            delBtn.onclick = (e) => {
                e.stopPropagation();
                items.splice(idx, 1);
                updateNodeConfig(nodeId, configKey, items);
                renderList();
            };
            row.appendChild(delBtn);

            listContainer.appendChild(row);
        });

        const addBtn = document.createElement('button');
        addBtn.className = 'btn-macro-add';
        addBtn.textContent = '+ Add Selector';
        addBtn.onclick = (e) => {
            e.stopPropagation();
            items.push('');
            updateNodeConfig(nodeId, configKey, items);
            renderList();
        };
        listContainer.appendChild(addBtn);
    };

    renderList();
    container.appendChild(listContainer);
}

function openContextRegistry(nodeId, configKey, inputEl, filter) {
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

    const addSeparator = (title) => {
        const sep = document.createElement('div');
        sep.style = 'font-size:9px; font-weight:800; color:var(--text-muted); padding:10px 8px 4px; letter-spacing:0.08em; border-top:1px solid rgba(255,255,255,0.03); margin-top:6px; text-transform:uppercase; display:flex; align-items:center; gap:8px';
        sep.innerHTML = `<span>${title}</span><div style="flex:1; height:1px; background:rgba(255,255,255,0.03)"></div>`;
        menu.appendChild(sep);
    };

    // 1. Header
    const head = document.createElement('div');
    head.style = 'font-size:10px; font-weight:700; color:var(--accent); padding:4px 8px; border-bottom:1px solid rgba(255,255,255,0.1); margin-bottom:4px;';
    head.textContent = 'Context Registry';
    menu.appendChild(head);

    // 2. Input Parameters (External Inputs)
    if (filter !== 'comparator') {
        state.builder.nodes.forEach(n => {
        if (n.id !== nodeId && n.type === 'input' && n.preset === 'external' && n.config.name) {
            const item = document.createElement('div');
            item.className = 'context-item';
            item.innerHTML = `
                <div class="item-icon">IN</div>
                <div class="item-content">
                    <span class="item-title">${n.config.name}</span>
                    <span class="item-subtitle">${n.config.dataType || 'string'}</span>
                </div>
                <small class="item-badge" style="background:rgba(52,211,153,0.1); color:#34d399">Param</small>
            `;
            item.onclick = () => {
                inputEl.value = `{{${n.config.name}}}`;
                updateNodeConfig(nodeId, configKey, inputEl.value);
                renderBuilderNodes(); renderConnections();
                menu.remove();
            };
            menu.appendChild(item);
        }
    });
}

    // 3. Global Variables (DB Registry)
    if (state.variables && state.variables.length > 0 && filter !== 'comparator') {
        addSeparator('Global Variables');
        const sortedVars = [...state.variables].sort((a, b) => {
            const nsA = a.namespace || '';
            const nsB = b.namespace || '';
            if (nsA !== nsB) return nsA.localeCompare(nsB);
            return a.key.localeCompare(b.key);
        });

        sortedVars.forEach(v => {
            if (filter === 'writable' && v.is_readonly) return;
            const item = document.createElement('div');
            item.className = 'context-item';
            const displayKey = v.namespace ? `${v.namespace}.${v.key}` : v.key;
            item.innerHTML = `
                <div class="item-icon">VAR</div>
                <div class="item-content">
                    <div style="display:flex; align-items:center; gap:6px">
                        <span class="item-title" style="font-weight:700">${v.key}</span>
                        <span style="font-size:9px; background:rgba(124,106,247,0.1); color:var(--accent); padding:1px 4px; border-radius:3px; font-weight:800; letter-spacing:0.05em">@${(v.namespace || 'REGISTRY').toUpperCase()}</span>
                    </div>
                </div>
            `;
            item.onclick = () => {
                inputEl.value = `{{${displayKey}}}`;
                updateNodeConfig(nodeId, configKey, inputEl.value);
                renderBuilderNodes(); renderConnections();
                menu.remove();
            };
            menu.appendChild(item);
        });
    }

    // 4. Custom User Functions (With Category Filtering)
    if (filter !== 'writable') {
        const customs = state.functions || [];
        if (customs.length > 0) addSeparator('User Functions');
        customs.forEach(f => {
            // Functional Filtering
            if (filter === 'comparator' && f.category !== 'comparator') return;
            if (filter === 'generator' && f.category !== 'generator') return;
            if (filter === 'transformer' && f.category !== 'transformer') return;

            const item = document.createElement('div');
            item.className = 'context-item';
            const argNames = parseFuncArgs(f.code || '');
            const displaySig = argNames.length > 0 ? `${f.name}(${argNames.join(', ')})` : `${f.name}()`;
            item.innerHTML = `
                <div class="item-icon">ƒ</div>
                <div class="item-content">
                    <span class="item-title">${displaySig}</span>
                </div>
            `;
            item.onclick = () => {
                inputEl.value = `{{${f.name}(${argNames.join(', ')})}}`;
                updateNodeConfig(nodeId, configKey, inputEl.value);
                renderBuilderNodes(); renderConnections();
                menu.remove();
            };
            menu.appendChild(item);
        });
    }

    // 5. Built-in Expressions
    if (filter !== 'writable' && filter !== 'comparator') {
        addSeparator('Built-in Expressions');
        const builtins = [
            { name: 'today', val: 'today()' },
            { name: 'now', val: 'now()' },
            { name: 'random', val: 'random(0, 100)' },
            { name: 'json', val: 'json(Data)' },
            { name: 'upper', val: 'upper(Data)' },
            { name: 'lower', val: 'lower(Data)' },
            { name: 'strip', val: 'strip(Data)' }
        ];
        builtins.forEach(b => {
            const item = document.createElement('div');
            item.className = 'context-item';
            item.innerHTML = `
                <div class="item-icon" style="opacity:0.5">ƒ</div>
                <div class="item-content">
                    <span class="item-title">${b.name}()</span>
                </div>
            `;
            item.onclick = () => {
                inputEl.value = `{{${b.val}}}`;
                updateNodeConfig(nodeId, configKey, inputEl.value);
                renderBuilderNodes(); renderConnections();
                menu.remove();
            };
            menu.appendChild(item);
        });
    }

    // 6. System Environment Variables
    if (state.builtin_envs && state.builtin_envs.length > 0) {
        if (filter !== 'writable') {
            addSeparator('Environment');
            state.builtin_envs.forEach(v => {
                const item = document.createElement('div');
                item.className = 'context-item';
                item.innerHTML = `
                    <div class="item-icon" style="color:#3b82f6">⚙️</div>
                    <div class="item-content">
                        <span class="item-title" style="font-weight:700">${v.key}</span>
                    </div>
                `;
                item.onclick = () => {
                    inputEl.value = `{{env("${v.key}")}}`;
                    updateNodeConfig(nodeId, configKey, inputEl.value);
                    renderBuilderNodes(); renderConnections();
                    menu.remove();
                };
                menu.appendChild(item);
            });
        }
    }

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
        targetHandle: arguments[4] || null, // Optional argument for named handles
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

                // Handle special universal ports (non-numeric indices)
                const actualTargetIdx = targetPort.id.includes('trigger') ? 'trigger' : 
                                     targetPort.id.includes('error') ? 'error' : targetPortIdx;
                
                const actualSourceIdx = (conn.fromPortIdx === 'trigger' || conn.fromPortIdx === 'error') ? conn.fromPortIdx : outPortIdx;

                const finalOutIdx = conn.fromType === 'output' ? actualSourceIdx : actualTargetIdx;
                const finalInIdx = conn.fromType === 'input' ? actualSourceIdx : actualTargetIdx;

                // Prevent duplicates
                const exists = state.builder.edges.some(edge =>
                    edge.from === outNodeId && edge.fromIdx === finalOutIdx &&
                    edge.to === inNodeId && edge.toIdx === finalInIdx
                );

                if (!exists && outNodeId !== inNodeId) {
                    // Detect target handle (argument name) from DOM if it was a drop-onto-named-port
                    let targetedHandle = targetPort.dataset.namedHandle || conn.targetHandle;
                    if (actualTargetIdx === 'trigger') targetedHandle = 'trigger';
                    if (actualTargetIdx === 'error') targetedHandle = 'error';

                    // For conditional nodes, tag the edge with its branch handle
                    const srcNode = state.builder.nodes.find(n => n.id === outNodeId);
                    let sourceHandle = undefined;
                    
                    if (actualSourceIdx === 'error') sourceHandle = 'error';
                    else if (actualSourceIdx === 'trigger') sourceHandle = 'trigger';
                    // Any node in the 'logic' category has True (0) and False (1) outputs
                    else if (srcNode && srcNode.type === 'logic') {
                        sourceHandle = outPortIdx === 0 ? 'true' : 'false';
                    }

                    const edge = { from: outNodeId, fromIdx: finalOutIdx, to: inNodeId, toIdx: finalInIdx };
                    if (sourceHandle !== undefined) edge.sourceHandle = sourceHandle;
                    if (targetedHandle) edge.targetHandle = targetedHandle;

                    state.builder.edges.push(edge);
                    toast('Connection created', 'success');

                    // 💡 AUTO-INJECTION: If wiring TO an Expression node's named port, update its text value
                    const destNode = state.builder.nodes.find(n => n.id === inNodeId);
                    if (destNode && destNode.preset === 'expression' && targetedHandle) {
                        const newVal = injectVariableIntoExpression(destNode.config.value, targetedHandle, inPortIdx);
                        if (newVal !== destNode.config.value) {
                            destNode.config.value = newVal;
                            console.log(`[Builder] Auto-injected variable '${targetedHandle}' into Expression node`);
                            renderBuilderNodes(); // Re-render to show updated string in text field
                        }
                    }
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
    const rect = portEl ? portEl.getBoundingClientRect() : null;

    const node = state.builder.nodes.find(n => n.id === nodeId);
    if (!node) return { x: 0, y: 0 };

    // If element doesn't exist OR hasn't been laid out by browser yet (0 width/height)
    if (!portEl || !rect || rect.width === 0) {
        // Fallback to estimation for initial load
        const x = type === 'input' ? node.x : node.x + 200; // Estimated width
        let y = node.y + 40; 
        
        if (portIdx === 'trigger' || portIdx === 'error') {
            const preset = NODE_PRESETS[node.preset] || {};
            const inputCount = (preset.inputs || []).length;
            const outputCount = (preset.outputs || []).length;
            
            if (portIdx === 'trigger') {
                return { x: node.x, y: node.y + 40 + (inputCount * 24) + 7 }; // +7 for 14px port center
            } else {
                return { x: node.x + 200, y: node.y + 40 + (outputCount * 24) + 7 };
            }
        }
        
        y += (parseInt(portIdx) || 0) * 24;
        return { x, y };
    }

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
        if (!edge || edge.from === undefined || edge.to === undefined) return;
        const fromPos = getPortPos(edge.from, 'output', edge.fromIdx);
        const toPos = getPortPos(edge.to, 'input', edge.toIdx);

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        let pathClass = 'connection-path';
        if (edge.sourceHandle === 'true') pathClass += ' connection-path--true';
        else if (edge.sourceHandle === 'false') pathClass += ' connection-path--false';
        else if (edge.sourceHandle === 'trigger') pathClass += ' connection-path--trigger';
        else if (edge.sourceHandle === 'error') pathClass += ' connection-path--error';

        path.setAttribute('class', pathClass);
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

        hitArea.onmousedown = (e) => {
            e.stopPropagation();
            e.preventDefault();
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

        // Only update if not currently renaming (to avoid clobbering input)
        if (!document.querySelector('#builder-name-container input')) {
            nameDisplay.textContent = state.builder.currentScraperName;
        }
    } else {
        typeLabel.textContent = 'NEW';
        typeLabel.style.color = 'var(--primary)';
        if (dot) {
            dot.style.background = 'var(--primary)';
            dot.style.boxShadow = '0 0 10px var(--primary)';
        }
        nameDisplay.textContent = state.builder.currentScraperName || 'New Scraper Flow';
    }
}

function startRenameBuilderScraper() {
    const container = document.getElementById('builder-name-container');
    const nameSpan = document.getElementById('builder-current-name');
    if (!container || !nameSpan) return;

    // prevent double-init
    if (container.querySelector('input')) return;

    const currentName = nameSpan.textContent;
    const input = document.createElement('input');
    input.type = 'text';
    input.value = currentName;
    input.style.fontSize = '12px';
    input.style.fontWeight = '600';
    input.style.color = 'var(--text-primary)';
    input.style.background = 'rgba(255,255,255,0.05)';
    input.style.border = '1px solid var(--border-strong)';
    input.style.borderRadius = '4px';
    input.style.padding = '2px 8px';
    input.style.width = '200px';
    input.style.outline = 'none';

    // Swap
    nameSpan.style.display = 'none';
    const icon = document.getElementById('builder-name-edit-icon');
    if (icon) icon.style.display = 'none';
    container.appendChild(input);
    input.focus();
    input.select();

    // Event listeners
    input.onblur = () => finishRenameBuilderScraper(input, currentName);
    input.onkeydown = (e) => {
        if (e.key === 'Enter') input.blur();
        if (e.key === 'Escape') {
            input.value = currentName;
            input.blur();
        }
    };
}

async function finishRenameBuilderScraper(input, oldName) {
    const newName = input.value.trim();
    const scraperId = state.builder.currentScraperId;
    const container = document.getElementById('builder-name-container');
    const nameSpan = document.getElementById('builder-current-name');
    const icon = document.getElementById('builder-name-edit-icon');

    if (!newName || newName === oldName) {
        input.remove();
        nameSpan.style.display = 'block';
        if (icon) icon.style.display = 'inline-block';
        return;
    }

    // Natural behavior: Rename only updates the local draft and the "Save Flow" modal field.
    // The actual persist to the database happens when the user clicks the "Save Flow" button.
    state.builder.currentScraperName = newName;

    // Always sync with the Save Modal input field to avoid "double rename"
    const nameField = document.getElementById('flow-name');
    if (nameField) nameField.value = newName;

    input.remove();
    nameSpan.textContent = state.builder.currentScraperName || 'New Scraper Flow';
    nameSpan.style.display = 'block';
    if (icon) icon.style.display = 'inline-block';
    updateBuilderContextUI();
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
        edges: state.builder.edges
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
        const flowNodes = Array.isArray(flowData.nodes) ? flowData.nodes : [];
        const flowEdges = Array.isArray(flowData.edges) ? flowData.edges : [];

        state.builder.nodes = flowNodes.map(node => {
            if (!node || typeof node !== 'object') return null;
            // Backward compatibility for nodes moved from Action to Source
            if (node.type === 'action' && node.preset && ['fetch_url', 'fetch_playwright'].includes(node.preset)) {
                node.type = 'source';
            }
            return node;
        }).filter(n => n !== null);
        state.builder.edges = flowEdges.filter(e => e && typeof e === 'object');

        // Reset viewport for consistency
        state.builder.x = -2000;
        state.builder.y = -2000;
        state.builder.zoom = 1;

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

        // Force re-validation of dynamic ports for loaded flows
        state.builder.nodes.forEach(n => discoverDynamicPorts(n.id));

        // Final sanity check for legacy string artifacts
        sanitizeBuilderState();

        toast(`Loaded "${s.name}" into Builder`, 'info');
    } catch (e) {
        console.error("[Builder] Load Error:", e);
        toast(`Failed to load flow data: ${e.message}`, 'error');
    }
}

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
                        <button class="icon-btn" onclick="duplicateScraper(${s.id})" title="Duplicate Scraper">📄</button>
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

async function _doRunScraper(id, inputValues, btn, force = false) {
    if (btn) { btn.disabled = true; btn.textContent = '⚡ Running…'; }
    try {
        let url = API.run(id);
        if (force) url += '?force=true';

        const res = await apiFetch(url, {
            method: 'POST',
            body: JSON.stringify({ input_values: inputValues }),
        });
        toast(res.detail, 'success');
        setTimeout(() => loadTab('logs'), 2500);
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
        if (btn) {
            btn.disabled = false;
            btn.textContent = '⚡ Run'; // Restore button text
        }
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
                    ${subtitle ? `<div style="font-size:12px; color:var(--text-muted); margin-top:2px;">${subtitle}</div>` : ''}
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
                        <button class="btn ${s.enabled ? 'btn-danger' : 'btn-primary'}" style="padding: 6px 14px; min-width: 100px; font-size: 12px;" onclick="toggleSchedule(${s.id})">
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
        { id: 'skipped', label: '⏭ Skipped' },
        { id: 'cancelled', label: '🛑 Cancelled' }
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
                    <div class="log-col-stop" style="text-align:right">
                        ${isRunning ? `<button class="btn btn-stop" style="padding:4px 10px; background:rgba(239, 68, 68, 0.1); color:var(--failure); border:1px solid rgba(239, 68, 68, 0.2); font-size:11px" onclick="event.stopPropagation(); stopScraperRun(${log.task_id || log.id})">🛑 Stop</button>` : ''}
                    </div>
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
                        <button class="btn btn-ghost btn-sm" style="margin-left:auto; color:var(--accent); font-size:10px; display:flex; align-items:center; gap:4px; padding:2px 8px; border:1px solid var(--accent-glow);" onclick="openDebugInspector(${log.id})">🔬 Inspect Raw Data</button>
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
        state.timezone = current;

        const dl = document.getElementById('tz-list');
        if (dl && (!_allTimezones.length || dl.children.length === 0)) {
            dl.innerHTML = _allTimezones.map(t => `<option value="${t.id}">${t.label}</option>`).join('');
        }

        const tzInp = document.getElementById('tz-input');
        if (tzInp && document.activeElement !== tzInp) {
            tzInp.value = current;
        }
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
            <select id="${id}" class="inp">
                <option value="">-- Select Source --</option>
                ${builtinOpts}
                ${streamOpts}
                ${staticOpts}
            </select>`;
        } else if (inp.type === 'list') {
            const varOpts = state.variables.filter(v => v.value_type === 'json').map(v =>
                `<option value="{{${v.key}}}" ${`{{${v.key}}}` === String(def) ? 'selected' : ''}>[Var] ${v.key}</option>`
            ).join('');
            const listId = `dl-${id}`;
            field = `
            <input type="text" id="${id}" data-ptype="list" class="inp" list="${listId}" value="${def}" placeholder='e.g. ["url1"] or {{var}}'>
            <datalist id="${listId}">${varOpts}</datalist>
            `;
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

        // Namespace Group Header (colspan=6)
        html += `
        <tr class="group-header" style="background:rgba(255,255,255,0.015); border-bottom:1px solid var(--border-light)">
            <td colspan="6" style="padding:16px 14px 10px; font-size:11px; font-weight:800; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.12em">
                <div style="display:flex; justify-content:space-between; align-items:center">
                    <div style="display:inline-flex; align-items:center; gap:8px">
                        <span style="opacity:0.6">${namespace ? '🏷️ NAMESPACE:' : '📦 GLOBAL VARS'}</span>
                        ${isEditing ? `
                            <div style="display:flex; align-items:center; gap:6px">
                                <input type="text" id="rename-ns-input-${namespace || '@@GLOBAL@@'}" value="${namespace}" class="inline-input" style="height:24px; font-size:11px; width:150px; font-family:var(--font-mono); color:var(--accent)">
                                <button class="icon-btn" onclick="saveNamespaceRename('${namespace}')" style="color:var(--success); font-size:12px">✅</button>
                                <button class="icon-btn" onclick="cancelEditNamespace()" style="font-size:12px">✕</button>
                            </div>
                        ` : `
                            <div style="display:flex; align-items:center; gap:8px">
                                <span style="color:var(--accent); font-family:var(--font-mono)">${namespace || 'Shared Registry'}</span>
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
            html += `<tr><td colspan="6" class="empty-td" style="padding:10px 20px; font-size:10px; opacity:0.5; font-style:italic">No variables in this namespace. Click [+ ADD VAR] to start.</td></tr>`;
        }

        groups[namespace].forEach(v => {
            const idx = state.variables.indexOf(v);
            if (v._editing || v._isNew) {
                html += `
                <tr class="editing-row" style="background:rgba(99,102,241,0.03)">
                    <td style="padding-left:20px">
                        <select id="inline-var-type-${idx}" style="width:100px; height:34px; font-size:11px; padding:0 8px; font-weight:700" onchange="state.variables[${idx}].value_type = this.value; renderVariablesList()">
                            <option value="string" ${v.value_type === 'string' ? 'selected' : ''}>STRING</option>
                            <option value="number" ${v.value_type === 'number' ? 'selected' : ''}>NUMBER</option>
                            <option value="boolean" ${v.value_type === 'boolean' ? 'selected' : ''}>BOOLEAN</option>
                            <option value="json" ${v.value_type === 'json' ? 'selected' : ''}>JSON</option>
                        </select>
                    </td>
                    <td style="text-align:center">
                        <span style="font-size:9px; font-weight:800; padding:4px 8px; border-radius:4px; opacity:0.6; background:rgba(255,255,255,0.05); color:var(--text-muted); border:1px solid rgba(255,255,255,0.1)">EDITING...</span>
                    </td>
                    <td>
                        <input type="text" id="inline-var-key-${idx}" value="${v.key || ''}" placeholder="KEY_NAME" oninput="state.variables[${idx}].key = this.value" style="width:100%; height:34px; font-size:12.5px; padding:0 8px; font-family:var(--font-mono); font-weight:700; color:var(--accent)">
                    </td>
                    <td>
                        ${v.value_type === 'json' ? `
                            <textarea id="inline-var-value-${idx}" class="inline-json-editor" placeholder='["url1", "url2"]' oninput="state.variables[${idx}].value = this.value; validateInlineJson(this)">${v.value || ''}</textarea>
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
                    <td>
                        <input type="text" id="inline-var-desc-${idx}" value="${v.description || ''}" placeholder="Description..." oninput="state.variables[${idx}].description = this.value" style="width:100%; height:34px; font-size:12.5px; padding:0 8px">
                    </td>
                    <td style="text-align:right">
                        <div class="action-btn-group" style="justify-content:flex-end; padding-right:14px">
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
                    <td style="padding-left:20px"><span class="type-pill type-${v.value_type}">${v.value_type.toUpperCase()}</span></td>
                    <td style="text-align:center">
                        <div onclick="toggleVariableReadonly(${idx})" title="Click to toggle Read-Only status" style="cursor:pointer; display:inline-flex; align-items:center; justify-content:center; width:100%">
                            <span style="font-size:9px; font-weight:800; padding:4px 10px; border-radius:4px; transition:all 0.2s; white-space:nowrap; ${v.is_readonly ? 'background:rgba(239, 68, 68, 0.1); color:#ef4444; border:1px solid rgba(239, 68, 68, 0.2)' : 'background:rgba(16, 185, 129, 0.1); color:#10b981; border:1px solid rgba(16, 185, 129, 0.2)'}">
                                ${v.is_readonly ? 'READ ONLY' : 'EDITABLE'}
                            </span>
                        </div>
                    </td>
                    <td>
                        <div style="display:inline-flex; align-items:center; background:rgba(124,106,247,0.06); border:1px solid rgba(124,106,247,0.1); border-radius:4px; padding:1px 8px; font-family:var(--font-mono); font-weight:800; color:var(--accent); font-size:12px; letter-spacing:-0.2px; max-width:230px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap" title="${v.key}">
                            ${v.key}
                        </div>
                    </td>
                    <td><div style="max-width:300px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:${valColor}; font-weight:500; font-family:var(--font-mono); font-size:12px">${renderVariableValue(v)}</div></td>
                    <td><div style="color:var(--text-muted); opacity:0.8; font-size:13px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${v.description || '—'}</div></td>
                    <td style="text-align:right">
                        <div class="action-btn-group" style="justify-content:flex-end; padding-right:14px">
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
            <td colspan="6" style="padding:16px 14px; font-size:11px; font-weight:800; color:var(--accent); text-transform:uppercase">
                <div style="display:flex; flex-direction:column; gap:8px">
                    <span style="opacity:0.6">🆕 Create New Namespace:</span>
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
        <table class="data-table" style="table-layout: fixed;">
            <thead>
                <tr>
                    <th style="width:100px; padding-left:20px">Type</th>
                    <th style="width:100px; text-align:center">Status</th> 
                    <th style="width:250px">Name / Key</th>
                    <th style="width:300px">Value</th>
                    <th>Description</th>
                    <th style="width:120px"></th>
                </tr>
            </thead>
            <tbody>
                ${state.builtin_envs.map((v, i) => `
                <tr class="variable-row variable-readonly">
                    <td style="padding-left:20px"><span class="type-pill type-string">STRING</span></td>
                    <td style="text-align:center">
                        <span style="font-size:9px; font-weight:800; padding:4px 10px; border-radius:4px; opacity:0.8; background:rgba(59,130,246,0.1); color:#3b82f6; border:1px solid rgba(59,130,246,0.2); white-space:nowrap" title="This variable is locked by the system environment.">
                            SYSTEM
                        </span>
                    </td>
                    <td>
                        <div style="display:inline-flex; align-items:center; background:rgba(59,130,246,0.06); border:1px solid rgba(59,130,246,0.1); border-radius:4px; padding:2px 8px; font-family:var(--font-mono); font-weight:800; color:#3b82f6; font-size:12px; letter-spacing:-0.2px; max-width:230px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap" title="${v.key}">
                            ${v.key}
                        </div>
                    </td>
                    <td><div style="max-width:300px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--text-secondary); opacity:0.6; font-weight:500; font-family:var(--font-mono); font-size:12px">••••••••</div></td>
                    <td><div style="color:var(--text-muted); opacity:0.6; font-size:13px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">External environment variable</div></td>
                    <td style="text-align:right">
                        <div class="action-btn-group" style="justify-content:flex-end; padding-right:14px">
                             <span style="font-size:9px; font-weight:800; color:var(--text-muted); opacity:0.4; letter-spacing:0.1em; text-transform:uppercase">Immutable</span>
                        </div>
                    </td>
                </tr>
                `).join('')}
            </tbody>
        </table>
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
    return `<span title="${v.value}">${v.value || '—'}</span>`;
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
    const newName = input.value.trim();

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
    } else {
        value = document.getElementById(`inline-var-value-${idx}`).value.trim();
    }
    const description = document.getElementById(`inline-var-desc-${idx}`).value.trim();
    const namespace = v.namespace || '';

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

/* 🔬 Debug Inspector Drawer Logic */
function openDebugInspector(logId) {
    const log = state.lastRenderedLogs ? state.lastRenderedLogs.find(l => l.id === logId) : null;
    if (!log || !log.debug_payload) {
        toast('Log context not available.', 'error');
        return;
    }

    const drawer = document.getElementById('debug-inspector-drawer');
    const body = document.getElementById('debug-inspector-body');
    const title = document.getElementById('debug-inspector-title');

    title.innerHTML = `🔬 Debug Inspector — <span style="color:var(--text-muted); font-weight:400; font-size:13px;">#${log.id} ${log.scraper_name}</span>`;
    body.innerHTML = renderDebugPayload(log.debug_payload);

    drawer.style.right = '0px';
    drawer.classList.add('open');
}

function closeDebugInspector() {
    const drawer = document.getElementById('debug-inspector-drawer');
    drawer.style.right = '-600px';
    drawer.classList.remove('open');
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
        toast('Focus Mode Active — ESC to exit', 'info');
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

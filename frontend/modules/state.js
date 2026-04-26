/* ── State, API Endpoints, Design Tokens ─── */
/* ════════════════════════════════════════════════
   ScrapeTL - Frontend Logic  v2
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
    taskStatus: (id) => `/api/run/status/${id}`,
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
        currentScraperName: null, // track active scraper name
        browser_config: {
            headless: '',
            cdp_url: ''
        }
    }
};

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

const NODE_PRESETS = {
    input: {
        external: {
            title: 'Parameter',
            inputs: [],
            outputs: ['Value'],
            configs: [
                { key: 'label', type: 'text', label: 'Form Label', placeholder: 'Starting Chapter', rerender: true },
                { key: 'name', type: 'hidden' },
                { key: 'dataType', type: 'select', label: 'Type', options: ['string', 'number', 'boolean', 'select'], rerender: true },
                { key: 'default', type: 'text', label: 'Default Value' },
                { key: 'description', type: 'text', label: 'Description' },
                {
                    key: 'options',
                    type: 'string_array',
                    label: 'Select Options',
                    placeholder: 'Option value',
                    btnLabel: '+ Add Option',
                    visible: (n) => n.config.dataType === 'select'
                }
            ]
        },
        expression: {
            title: 'Get Variable',
            inputs: [],
            outputs: ['Value'],
            configs: [
                { key: 'value', type: 'expression', label: 'Registry Key / Expression' }
            ]
        },
    },
    source: {
        fetch_url: {
            title: 'HTTP Fetch',
            inputs: ['URL'],
            outputs: ['HTML'],
            configs: [
                { key: 'method', type: 'select', label: 'Method', options: ['GET', 'POST'] },
                { key: 'headers', type: 'text', label: 'Extra Headers (JSON)', placeholder: '{"User-Agent": "..."}' }
            ]
        },
        fetch_playwright: {
            title: 'Browser Fetch',
            inputs: ['URL'],
            outputs: ['HTML'],
            configs: [
                { key: 'headless', type: 'checkbox', label: 'Headless Mode (Silent)', default: true },
                { key: 'actions', type: 'action_list', label: 'Playwright Actions' },
                { key: 'auto_dismiss', type: 'string_array', label: 'Auto-Dismiss Selectors (e.g. cookie banners)' }
            ]
        },
        image_fetch: {
            title: 'Image Fetch',
            inputs: ['URL'],
            outputs: ['Image'],
            configs: [
                { key: 'output_type', type: 'select', label: 'Output Format', options: ['base64', 'bytes_hex', 'url'] }
            ]
        }
    },
    action: {
        bs4_select: {
            title: 'CSS Select',
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
            title: 'Regex Extract',
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
            outputs: ['Text'],
            configs: [
                { key: 'operation', type: 'select', label: 'Operation', options: ['prefix', 'suffix', 'replace', 'trim'] },
                { key: 'value', type: 'text', label: 'Param Value', placeholder: 'URL or HTML Source' },
                { key: 'replacement', type: 'text', label: 'Replacement', placeholder: '' }
            ]
        },
        string_format: {
            title: 'String Format',
            logicalInputs: 2,
            outputs: ['Text'],
            configs: [
                { key: 'template', type: 'text', label: 'Template', placeholder: '{0}_{1}' }
            ]
        },
        type_convert: {
            title: 'Type Cast',
            inputs: ['Data'],
            outputs: ['Value'],
            configs: [
                { key: 'to_type', type: 'select', label: 'Target Type', options: ['string', 'number', 'boolean', 'json'] }
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
            title: 'Output',
            inputs: ['Data'],
            outputs: [],
            configs: [
                { key: 'label', type: 'text', label: 'Collection Name', placeholder: 'Results' }
            ]
        },
        context: {
            title: 'Set Variable',
            inputs: ['Data'],
            outputs: [],
            configs: [
                { key: 'variable_key', type: 'expression', label: 'Target Key', filter: 'writable' }
            ]
        },
        debug: {
            title: 'Debug',
            inputs: ['Data'],
            outputs: [],
            configs: [
                { key: 'label', type: 'text', label: 'Artifact Label', placeholder: 'Debug' }
            ]
        },
        raise_skip: {
            title: 'Raise Skip',
            inputs: ['Data'],
            outputs: [],
            configs: [
                { key: 'message', type: 'text', label: 'Skip Message', placeholder: 'Nothing new today.' }
            ]
        }
    },
    logic: {
        logic_gate: {
            title: 'Logic Gate',
            inputs: ['In 1', 'In 2'],
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
        },
        negate: {
            title: 'NOT',
            inputs: ['In'],
            outputs: ['Out'],
            configs: []
        },
    },
    utility: {
        splitter: {
            title: 'Split',
            inputs: ['In'],
            outputs: ['Out 1', 'Out 2'],
            logicalOutputs: 2
        },
        combiner: {
            title: 'Merge',
            inputs: ['In 1', 'In 2'],
            outputs: ['Out'],
            logicalInputs: 2,
            configs: [
                { key: 'mode', type: 'merge_mode', label: 'Mode' }
            ]
        },
        relay: {
            title: 'Relay',
            inputs: ['Data'],
            outputs: [],
            compact: true,
            configs: []
        },
        tap: {
            title: 'Tap',
            inputs: [],
            outputs: ['Value'],
            compact: true,
            configs: []
        }
    }
};

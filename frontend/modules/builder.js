/* ── Visual Builder (Canvas, Nodes, Connections, Save/Load) ─── */
/* ── Semantic Function Helper ────────────────────── */
// NOTE: parseFuncArgs is a JS-side fallback only.
// The authoritative parameter list comes from f.parameters (backend AST parse).
// This handles the case where a function object isn't in state.functions yet.
function parseFuncArgs(code, funcName) {
    if (!code) return [];
    // Find the def line for funcName (or first def if no name given)
    const namePattern = funcName ? `${funcName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}` : '\\w+';
    const defRegex = new RegExp(`def\\s+${namePattern}\\s*\\(`);
    const defIdx = code.search(defRegex);
    if (defIdx === -1) return [];

    // Walk forward from the opening paren, tracking bracket depth to find the matching ')'
    const openParen = code.indexOf('(', defIdx);
    if (openParen === -1) return [];

    let depth = 0;
    let closeParen = -1;
    for (let i = openParen; i < code.length; i++) {
        const ch = code[i];
        if (ch === '(' || ch === '[' || ch === '{') depth++;
        else if (ch === ')' || ch === ']' || ch === '}') {
            depth--;
            if (depth === 0) { closeParen = i; break; }
        }
    }
    if (closeParen === -1) return [];

    const sig = code.slice(openParen + 1, closeParen);
    // Split sig by top-level commas only (depth-aware)
    const params = [];
    let current = '';
    let d = 0;
    for (const ch of sig) {
        if (ch === '(' || ch === '[' || ch === '{') { d++; current += ch; }
        else if (ch === ')' || ch === ']' || ch === '}') { d--; current += ch; }
        else if (ch === ',' && d === 0) { params.push(current.trim()); current = ''; }
        else { current += ch; }
    }
    if (current.trim()) params.push(current.trim());

    return params
        .map(p => p.split(/[:=]/)[0].trim())
        .filter(p => p && p !== 'self' && p !== 'cls' && /^\w+$/.test(p));
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
            // Use pre-parsed parameters from backend AST analysis
            const args = Array.isArray(f.parameters) ? f.parameters : [];

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
            { value: 'AND', label: 'AND - All inputs truthy' },
            { value: 'OR', label: 'OR - Any input truthy' },
            { value: 'NAND', label: 'NAND - Not all truthy' },
            { value: 'NOR', label: 'NOR - None truthy' },
            { value: 'XOR', label: 'XOR - Odd count truthy' },
            { value: 'XNOR', label: 'XNOR - Even count truthy' },
            { value: 'NOT', label: 'NOT - Negate Input A' },
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
// parseFuncArgs is defined once above (depth-aware bracket parser)

/* ── Builder Logic ─────────────────────────────────── */
function initBuilder() {
    const viewport = document.getElementById('builder-viewport');
    const canvas = document.getElementById('builder-canvas');
    if (!viewport || !canvas) return;

    // Apply saved offset and initial zoom
    canvas.style.transform = `translate(${state.builder.x}px, ${state.builder.y}px) scale(${state.builder.zoom})`;
    updateInfiniteBackground();
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
                e.preventDefault(); // Stop text selection
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

    updateInfiniteBackground();
    updateZoomHUD();
    renderConnections();
}

/**
 * Syncs the viewport background dots with the canvas translation and zoom.
 * This creates the illusion of an infinite grid.
 */
function updateInfiniteBackground() {
    const viewport = document.getElementById('builder-viewport');
    if (!viewport) return;

    const x = state.builder.x;
    const y = state.builder.y;
    const zoom = state.builder.zoom;

    // Grid dots are spaced at 30px (base)
    const gridSize = 30 * zoom;

    viewport.style.backgroundSize = `${gridSize}px ${gridSize}px`;
    viewport.style.backgroundPosition = `${x}px ${y}px`;
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
            el.className = `builder-node builder-node--${node.type} builder-node--${node.preset}`;
            if (node.type === 'utility') el.classList.add('builder-node--mini');
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

            // 1. Title — always-editable input styled as title text
            const title = document.createElement('input');
            title.className = `builder-node__title builder-node__title--${node.type} node-title-input`;
            title.value = node.config.internalLabel || preset.title;
            title.title = preset.title;
            title.spellcheck = false;
            title.autocomplete = 'off';

            title.onmousedown = (e) => e.stopPropagation();
            title.onfocus = () => {
                if (title.value === preset.title) title.value = '';
                title.select();
            };
            // Save on every keystroke so renderBuilderNodes() re-entrancy doesn't lose typed value
            title.oninput = () => updateNodeConfig(node.id, 'internalLabel', title.value);
            title.onblur = () => {
                const val = title.value.trim();
                updateNodeConfig(node.id, 'internalLabel', val);
                title.value = val || preset.title;
            };
            title.onkeydown = (ke) => {
                if (ke.key === 'Enter') ke.target.blur();
                if (ke.key === 'Escape') { title.value = node.config.internalLabel || preset.title; updateNodeConfig(node.id, 'internalLabel', node.config.internalLabel || ''); title.blur(); }
                ke.stopPropagation();
            };
            el.appendChild(title);

            // Variadic Control Bar (Add/Remove Ports)
            // EXCLUSION: Utility, Logic, and string_format nodes use Auto-Port growth instead of manual buttons
            if ((preset.logicalInputs || preset.logicalOutputs) && node.type !== 'utility' && node.type !== 'logic' && node.preset !== 'string_format') {
                const type = preset.logicalInputs ? 'Inputs' : 'Outputs';
                const configKey = preset.logicalInputs ? 'logicalInputs' : 'logicalOutputs';
                const count = Number(node.config[configKey] || (preset.logicalInputs || preset.logicalOutputs));

                const controls = document.createElement('div');
                controls.className = 'node-port-controls node-port-controls--top';

                // Subtract Button
                const subBtn = document.createElement('button');
                subBtn.className = 'btn-port-footer btn-port-footer-sub';
                subBtn.textContent = '−';
                subBtn.title = `Remove Last ${type}`;
                if (count <= 2) subBtn.disabled = true;

                subBtn.onmousedown = (e) => {
                    if (e.button !== 0) return;
                    e.stopPropagation();
                    const targetNode = state.builder.nodes.find(n => n.id === node.id);
                    if (!targetNode) return;

                    const curCount = Number(targetNode.config[configKey] || (preset.logicalInputs || preset.logicalOutputs));
                    if (curCount <= 2) return;

                    targetNode.config[configKey] = curCount - 1;

                    // Cleanup connections for removed port
                    if (type === 'Inputs') {
                        state.builder.edges = state.builder.edges.filter(edge =>
                            !(edge.to === node.id && Number(edge.toIdx) === curCount - 1)
                        );
                    } else {
                        state.builder.edges = state.builder.edges.filter(edge =>
                            !(edge.from === node.id && Number(edge.fromIdx) === curCount - 1)
                        );
                    }

                    renderBuilderNodes();
                    renderConnections();
                };

                // Add Button
                const addBtn = document.createElement('button');
                addBtn.className = 'btn-port-footer btn-port-footer-add';
                addBtn.textContent = '+';
                addBtn.title = `Add More ${type}`;

                addBtn.onmousedown = (e) => {
                    if (e.button !== 0) return;
                    e.stopPropagation();
                    const targetNode = state.builder.nodes.find(n => n.id === node.id);
                    if (!targetNode) return;

                    const curCount = Number(targetNode.config[configKey] || (preset.logicalInputs || preset.logicalOutputs));
                    targetNode.config[configKey] = curCount + 1;

                    renderBuilderNodes();
                    renderConnections();
                };

                controls.appendChild(subBtn);
                controls.appendChild(addBtn);
                el.appendChild(controls);
            }

            // 3 & 4. Ports — 2-column layout (inputs left, outputs right)
            // Utility nodes are mini EXCEPT combiner/splitter which need column layout for port clarity
            const useColumns = node.type !== 'utility' || ['combiner', 'splitter'].includes(node.preset);
            let inputCol, outputCol, portsBody;
            if (useColumns) {
                portsBody = document.createElement('div');
                portsBody.className = 'node-ports-body';
                inputCol = document.createElement('div');
                inputCol.className = 'node-ports-col node-ports-col--input';
                outputCol = document.createElement('div');
                outputCol.className = 'node-ports-col node-ports-col--output';
            }
            const inputTarget = useColumns ? inputCol : el;
            const outputTarget = useColumns ? outputCol : el;

            // 3. Build input list
            let nodeInputs = [];
            if (node.dynamic_ports && node.dynamic_ports.length > 0) {
                nodeInputs = node.dynamic_ports;
            } else if (preset.logicalInputs) {
                const count = Number(node.config.logicalInputs || preset.logicalInputs);
                for (let i = 1; i <= count; i++) nodeInputs.push(`In ${i}`);
            } else if (node.preset === 'conditional') {
                const mode = node.config.mode || 'logical';
                if (mode === 'logical') {
                    const count = Number(node.config.logicalInputs || 2);
                    for (let i = 1; i <= count; i++) nodeInputs.push(`In ${i}`);
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
                port.title = label;

                let handle = null;
                if (node.dynamic_ports) {
                    handle = node.dynamic_ports[idx];
                    port.dataset.namedHandle = handle;
                } else if (node.preset === 'logic_gate' || node.preset === 'combiner') {
                    handle = `input_${idx}`;
                }

                const lbl = document.createElement('span');
                lbl.className = 'node-port-label';
                lbl.textContent = label;

                row.appendChild(port);
                row.appendChild(lbl);
                inputTarget.appendChild(row);
            });

            // 3.1 Universal Trigger Port — skip for input and utility nodes
            if (node.type !== 'input' && node.type !== 'utility') {
                const trigRow = document.createElement('div');
                trigRow.className = 'node-port-row node-port-row--input node-port-row--universal';

                const trigPort = document.createElement('div');
                trigPort.className = 'node-port node-port--input node-port--trigger';
                trigPort.id = `node-${node.id}-input-trigger`;
                trigPort.title = 'Trigger';

                const trigLbl = document.createElement('span');
                trigLbl.className = 'node-port-label node-port-label--trigger';
                trigLbl.textContent = 'Trigger';

                trigRow.appendChild(trigPort);
                trigRow.appendChild(trigLbl);
                inputTarget.appendChild(trigRow);
            }

            // 4. Build output list
            let nodeOutputs = [];
            if (preset.logicalOutputs) {
                const count = Number(node.config.logicalOutputs || preset.logicalOutputs);
                for (let i = 1; i <= count; i++) nodeOutputs.push(`Out ${i}`);
            } else {
                nodeOutputs = preset.outputs || [];
            }

            const boolPresets = ['logic_gate', 'conditional', 'comparison', 'string_match', 'status_check', 'custom_logic'];
            nodeOutputs.forEach((label, idx) => {
                const row = document.createElement('div');
                row.className = 'node-port-row node-port-row--output';

                const port = document.createElement('div');
                let portClass = 'node-port node-port--output';
                if (node.type === 'logic' && boolPresets.includes(node.preset)) {
                    portClass += idx === 0 ? ' node-port--true' : ' node-port--false';
                }
                port.className = portClass;
                port.id = `node-${node.id}-output-${idx}`;
                port.title = label;
                port.onmousedown = (e) => startConnection(e, node.id, 'output', idx);

                const lbl = document.createElement('span');
                if (node.type === 'logic' && boolPresets.includes(node.preset)) {
                    lbl.className = 'node-port-label ' + (idx === 0 ? 'node-port-label--true' : 'node-port-label--false');
                } else {
                    lbl.className = 'node-port-label';
                }
                lbl.textContent = label;

                row.appendChild(lbl);
                row.appendChild(port);
                outputTarget.appendChild(row);
            });

            // 4.1 Universal Error Port — skip for input, sink, and utility nodes
            if (node.type !== 'input' && node.type !== 'sink' && node.type !== 'utility') {
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
                outputTarget.appendChild(errRow);
            }

            if (useColumns) {
                portsBody.appendChild(inputCol);
                portsBody.appendChild(outputCol);
                el.appendChild(portsBody);
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

                    if (cfg.label) {
                        const label = document.createElement('label');
                        label.className = 'node-config-label';
                        label.textContent = cfg.label;
                        group.appendChild(label);
                    }

                    if (cfg.type === 'merge_mode') {
                        const modes = [
                            { value: 'list', label: 'Array of Arrays' },
                            { value: 'concat', label: 'Concatenate' },
                            { value: 'zip', label: 'Zip Pairs' },
                            { value: 'flatten', label: 'Flatten' },
                            { value: 'merge_object', label: 'Deep Merge (Objects)' },
                        ];
                        const sel = document.createElement('select');
                        sel.className = 'node-select';
                        const cur = node.config[cfg.key] || 'list';
                        modes.forEach(m => {
                            const o = document.createElement('option');
                            o.value = m.value;
                            o.textContent = m.label;
                            if (cur === m.value) o.selected = true;
                            sel.appendChild(o);
                        });
                        sel.onchange = (e) => updateNodeConfig(node.id, cfg.key, e.target.value);
                        group.appendChild(sel);
                    } else if (cfg.type === 'text') {
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
                            const wrap = document.createElement('div');
                            wrap.className = 'node-input-expr-wrap';

                            const input = document.createElement('input');
                            input.className = 'node-input';
                            input.value = node.config[cfg.key] || '';
                            input.placeholder = cfg.placeholder || '';
                            input.oninput = (e) => {
                                const val = e.target.value;
                                updateNodeConfig(node.id, cfg.key, val);

                                // ONE-TIME AUTO-SLUGIFY for External Parameter: label -> name
                                if (node.preset === 'external' && cfg.key === 'label' && !node.config.name) {
                                    let newSlug = val.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

                                    if (newSlug) {
                                        // COLLISION CHECK: Ensure this slug is unique among other external params
                                        let finalSlug = newSlug;
                                        let counter = 1;
                                        const otherNames = state.builder.nodes
                                            .filter(n => n.id !== node.id && n.preset === 'external')
                                            .map(n => n.config.name);

                                        while (otherNames.includes(finalSlug)) {
                                            finalSlug = `${newSlug}_${counter++}`;
                                        }

                                        updateNodeConfig(node.id, 'name', finalSlug);
                                    }
                                }
                            };

                            // Expression picker {{}} button — appears on hover
                            const exprBtn = document.createElement('button');
                            exprBtn.className = 'btn-expr-picker';
                            exprBtn.textContent = '{{}}';
                            exprBtn.title = 'Insert expression';
                            exprBtn.onclick = (e) => {
                                e.stopPropagation();
                                openContextRegistry(node.id, cfg.key, input);
                            };

                            wrap.appendChild(input);
                            wrap.appendChild(exprBtn);
                            group.appendChild(wrap);
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
                        renderStringArrayUI(node.id, cfg, group);
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
        updateInfiniteBackground();
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
                'type': 'Type Text',
                'fetch_image': 'Capture Image',
                'screenshot': 'Screenshot'
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
                const isImg = action.type === 'fetch_image' || action.type === 'screenshot';
                valInput.placeholder = action.type === 'wait' ? '2000' : (isImg ? 'Image Source Selector...' : 'Selector or URL...');
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

function renderStringArrayUI(nodeId, cfg, container) {
    const configKey = cfg.key;
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
            valInput.placeholder = cfg.placeholder || '.close-modal-btn';
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
        addBtn.textContent = cfg.btnLabel || '+ Add Selector';
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

function getTypeIndicator(type) {
    const t = (type || 'string').toLowerCase();
    if (t === 'string' || t === 'str' || t === 'text') return { text: 'STR', cls: 'type-icon--str' };
    if (t === 'number' || t === 'num' || t === 'float' || t === 'int' || t === 'integer') return { text: 'NUM', cls: 'type-icon--num' };
    if (t === 'boolean' || t === 'bool') return { text: 'BOL', cls: 'type-icon--bol' };
    if (t === 'object' || t === 'dict' || t === 'json') return { text: 'OBJ', cls: 'type-icon--obj' };
    if (t === 'batch' || t === 'list' || t === 'array' || t === 'arr') return { text: 'ARR', cls: 'type-icon--arr' };
    if (t === 'null' || t === 'none') return { text: 'NUL', cls: 'type-icon--nul' };
    return { text: 'VAR', cls: '' };
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
        sep.className = 'ctx-separator';
        sep.textContent = title;
        menu.appendChild(sep);
    };

    // 1. Header
    const head = document.createElement('div');
    head.style = 'font-size:10px; font-weight:700; color:var(--accent); padding:4px 8px; border-bottom:1px solid rgba(255,255,255,0.1); margin-bottom:4px;';
    head.textContent = 'Context Registry';
    menu.appendChild(head);

    // 1.5. Search input
    const searchInput = document.createElement('input');
    searchInput.className = 'ctx-search';
    searchInput.placeholder = 'Search...';
    searchInput.setAttribute('autocomplete', 'off');
    searchInput.oninput = () => {
        const q = searchInput.value.toLowerCase();
        menu.querySelectorAll('.context-item').forEach(item => {
            const text = item.textContent.toLowerCase();
            item.style.display = text.includes(q) ? '' : 'none';
        });
        menu.querySelectorAll('.ctx-separator').forEach(sep => {
            const next = sep.nextElementSibling;
            const hasVisible = next && !next.classList.contains('ctx-separator') && next.style.display !== 'none';
            sep.style.display = hasVisible ? '' : 'none';
        });
    };
    menu.appendChild(searchInput);
    setTimeout(() => searchInput.focus(), 20);

    // 2. Input Parameters (Skipped: Now using direct connections or Registry)


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
            const type = getTypeIndicator(v.value_type || 'string');
            const item = document.createElement('div');
            item.className = 'context-item';
            const displayKey = v.namespace ? `${v.namespace}.${v.key}` : v.key;

            item.innerHTML = `
                <div class="item-icon ${type.cls}">${type.text}</div>
                <div class="item-content">
                    <div style="display:flex; align-items:center; width:100%">
                        <span class="item-title" style="font-weight:700">${v.key}</span>
                        <span style="margin-left:auto; font-size:9px; background:rgba(52,211,153,0.1); color:#34d399; padding:1px 6px; border-radius:3px; font-weight:800; letter-spacing:0.05em">${(v.namespace || 'REGISTRY').toUpperCase()}</span>
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
            const argNames = Array.isArray(f.parameters) ? f.parameters : [];
            const displaySig = argNames.length > 0 ? `${f.name}(${argNames.join(', ')})` : `${f.name}()`;
            item.innerHTML = `
                <div class="item-icon type-icon--func">ƒ</div>
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
                <div class="item-icon type-icon--func">ƒ</div>
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
                <div class="item-icon type-icon--env">ENV</div>
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

                    // ⚡ SINGLE CONNECTION PER INPUT: Remove any existing edge that targets the same input port
                    state.builder.edges = state.builder.edges.filter(e =>
                        !(e.to === inNodeId && e.toIdx === finalInIdx)
                    );

                    state.builder.edges.push(edge);
                    toast('Connection updated', 'success');

                    // 💡 AUTO-INJECTION logic (existing) ...

                    // ⚡ AUTO-PORT GROWTH: If wiring TO/FROM a Utility/Logic/string_format node's last port, expand it
                    const growNode = (id, key) => {
                        try {
                            const target = state.builder.nodes.find(n => n.id == id);
                            if (!target) return;
                            const p = NODE_PRESETS[target.type][target.preset];
                            const isAutoGrow = target.type === 'utility' || target.type === 'logic' || target.preset === 'string_format';
                            if (isAutoGrow && (p.logicalInputs || p.logicalOutputs)) {
                                const curCount = Number(target.config[key] || (p.logicalInputs || p.logicalOutputs));
                                const portIdx = key === 'logicalInputs' ? finalInIdx : finalOutIdx;

                                // If we connected the last port (even if numeric index is handled as string), add one more
                                if (portIdx !== 'trigger' && portIdx !== 'error' && parseInt(portIdx) === curCount - 1) {
                                    target.config[key] = curCount + 1;
                                    renderBuilderNodes();
                                    renderConnections();
                                }
                            }
                        } catch (e) { console.error("[Builder] growNode failed:", e); }
                    };

                    if (conn.fromType === 'output') {
                        growNode(outNodeId, 'logicalOutputs');
                        growNode(inNodeId, 'logicalInputs');
                    } else {
                        growNode(inNodeId, 'logicalOutputs');
                        growNode(outNodeId, 'logicalInputs');
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
            const edge = state.builder.edges[index];
            state.builder.edges.splice(index, 1);

            // ⚡ AUTO-PORT PRUNING: Shrink nodes if they have empty trailing ports
            const pruneNode = (id, key, isInput) => {
                try {
                    const target = state.builder.nodes.find(n => n.id == id);
                    if (!target || (target.type !== 'utility' && target.type !== 'logic' && target.preset !== 'string_format')) return;
                    const p = NODE_PRESETS[target.type][target.preset];
                    const min = p.logicalInputs || p.logicalOutputs || 2;
                    let curCount = Number(target.config[key] || min);

                    if (target.preset === 'string_format' && isInput) {
                        // Exact-removal: remove disconnected port and shift higher indices down
                        const removedIdx = Number(edge.toIdx);
                        if (curCount <= min) return; // keep minimum
                        // Shift all edges targeting this node with index > removedIdx
                        state.builder.edges.forEach(eg => {
                            if (eg.to == id && typeof eg.toIdx === 'number' && eg.toIdx > removedIdx) {
                                eg.toIdx--;
                            }
                        });
                        target.config[key] = curCount - 1;
                    } else {
                        // Standard trailing-prune for utility/logic nodes
                        while (curCount > min) {
                            const lastIdx = curCount - 1;
                            const isLastBusy = state.builder.edges.some(eg =>
                                isInput ? (eg.to == id && eg.toIdx === lastIdx) : (eg.from == id && eg.fromIdx === lastIdx)
                            );
                            if (!isLastBusy) {
                                curCount--;
                                target.config[key] = curCount;
                            } else {
                                break;
                            }
                        }
                    }
                    renderBuilderNodes();
                } catch (e) { console.error("[Builder] pruneNode failed:", e); }
            };

            pruneNode(edge.from, 'logicalOutputs', false);
            pruneNode(edge.to, 'logicalInputs', true);

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
function syncBuilderBrowserConfig(source) {
    const headless = source.id.includes('headless') ? source.value : null;
    const cdp = source.id.includes('cdp') ? source.value.trim() : null;

    if (headless !== null) state.builder.browser_config.headless = headless;
    if (cdp !== null) state.builder.browser_config.cdp_url = cdp;
}

function openSaveFlowModal() {
    if (state.builder.nodes.length === 0) {
        toast('Cannot save an empty flow.', 'error');
        return;
    }

    // Force finish rename if in progress
    const renameInp = document.querySelector('#builder-name-container input');
    if (renameInp) {
        finishRenameBuilderScraper(renameInp, state.builder.currentScraperName);
    }

    const nameField = document.getElementById('flow-name');
    const descField = document.getElementById('flow-desc');
    const homeField = document.getElementById('flow-homepage');
    const thumbUrlField = document.getElementById('flow-thumb-url');
    const snapToggle = document.getElementById('flow-new-version');
    const scraperId = state.builder.currentScraperId;

    if (scraperId) {
        const s = state.scrapers.find(x => x.id === scraperId);
        if (s) {
            if (nameField) nameField.value = state.builder.currentScraperName || s.name || '';
            if (descField) descField.value = s.description || '';
            if (homeField) homeField.value = s.homepage_url || '';

            // Thumbnail logic
            const isLocal = s.thumbnail_url && s.thumbnail_url.startsWith('/thumbnails/');
            if (thumbUrlField) thumbUrlField.value = isLocal ? '' : (s.thumbnail_url || '');
            previewFlowThumb(s.thumbnail_url || '');

            // Version suggestion
            const latestVer = s.latest_version || '1.0.0';
            const parts = latestVer.replace(/^v/, '').split('.').map(Number);
            if (parts.length === 3) {
                document.getElementById('flow-ver-major').value = parts[0];
                document.getElementById('flow-ver-minor').value = parts[1];
                document.getElementById('flow-ver-patch').value = parts[2] + 1; // Suggest patch bump
            }
        }
    } else {
        // Reset for new scraper
        if (nameField) nameField.value = state.builder.currentScraperName || '';
        if (descField) descField.value = '';
        if (homeField) homeField.value = '';
        if (thumbUrlField) thumbUrlField.value = '';
        previewFlowThumb('');

        document.getElementById('flow-ver-major').value = 1;
        document.getElementById('flow-ver-minor').value = 0;
        document.getElementById('flow-ver-patch').value = 0;
    }

    // Reset Snapshot toggle
    if (snapToggle) {
        snapToggle.checked = false;
        document.getElementById('flow-version-settings').style.display = 'none';
        document.getElementById('flow-commit').value = '';
    }

    // Ensure modal is synced with current builder state/toolbar for browser config
    const modalHeadless = document.getElementById('flow-browser-headless');
    const modalCDP = document.getElementById('flow-browser-cdp');
    const modalStealth = document.getElementById('flow-browser-stealth');
    if (modalHeadless) modalHeadless.value = state.builder.browser_config.headless;
    if (modalCDP) modalCDP.value = state.builder.browser_config.cdp_url;
    if (modalStealth) modalStealth.checked = !!state.builder.browser_config.stealth;
    const modalThrottle = document.getElementById('flow-batch-throttle');
    if (modalThrottle) {
        const scraper = state.scrapers ? state.scrapers.find(s => s.id === scraperId) : null;
        modalThrottle.value = scraper && scraper.batch_throttle_seconds != null ? scraper.batch_throttle_seconds : '';
    }

    // Always sync hidden ID field with current builder state to prevent stale-ID 404s
    const scraperIdInput = document.getElementById('flow-scraper-id');
    if (scraperIdInput) scraperIdInput.value = scraperId || '';

    document.getElementById('save-flow-modal').style.display = 'flex';
}

function previewFlowThumb(url) {
    const img = document.getElementById('flow-thumb-img');
    const placeholder = document.getElementById('flow-thumb-placeholder');
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

function handleFlowThumbFile(input) {
    const file = input.files[0];
    const filenameEl = document.getElementById('flow-thumb-filename');
    const urlEl = document.getElementById('flow-thumb-url');
    if (file) {
        if (filenameEl) filenameEl.textContent = file.name;
        if (urlEl) urlEl.value = ''; // Direct file upload clears URL input
        const reader = new FileReader();
        reader.onload = e => previewFlowThumb(e.target.result);
        reader.readAsDataURL(file);
    }
}

function bumpFlowVersion(type) {
    const maj = document.getElementById('flow-ver-major');
    const min = document.getElementById('flow-ver-minor');
    const pat = document.getElementById('flow-ver-patch');
    let v_maj = parseInt(maj.value) || 0;
    let v_min = parseInt(min.value) || 0;
    let v_pat = parseInt(pat.value) || 0;

    if (type === 'major') { v_maj++; v_min = 0; v_pat = 0; }
    else if (type === 'minor') { v_min++; v_pat = 0; }
    else if (type === 'patch') { v_pat++; }

    maj.value = v_maj;
    min.value = v_min;
    pat.value = v_pat;
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

    // Clear Browser Overrides
    state.builder.browser_config = { headless: '', cdp_url: '', stealth: false };
    if (document.getElementById('flow-browser-headless')) document.getElementById('flow-browser-headless').value = '';
    if (document.getElementById('flow-browser-cdp')) document.getElementById('flow-browser-cdp').value = '';
    if (document.getElementById('flow-browser-stealth')) document.getElementById('flow-browser-stealth').checked = false;
    if (document.getElementById('flow-batch-throttle')) document.getElementById('flow-batch-throttle').value = '';

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
    formData.append('homepage_url', document.getElementById('flow-homepage').value.trim());
    formData.append('thumbnail_url', document.getElementById('flow-thumb-url').value.trim());
    formData.append('flow_data', flowData);

    const scraperId = document.getElementById('flow-scraper-id').value;
    if (scraperId) formData.append('scraper_id', scraperId);

    // Versioning
    const isSnap = document.getElementById('flow-new-version').checked;
    formData.append('new_version', isSnap);
    if (isSnap) {
        const v = `${document.getElementById('flow-ver-major').value}.${document.getElementById('flow-ver-minor').value}.${document.getElementById('flow-ver-patch').value}`;
        formData.append('version_label', v);
        formData.append('commit_message', document.getElementById('flow-commit').value.trim() || 'Manual builder snapshot');
    }

    // Image Upload
    const thumbFile = document.getElementById('flow-thumb-file').files[0];
    if (thumbFile) formData.append('thumbnail_file', thumbFile);

    // Browser Config Overrides
    const bmode = document.getElementById('flow-browser-headless').value;
    const bcdp = document.getElementById('flow-browser-cdp').value.trim();
    const bstealth = document.getElementById('flow-browser-stealth').checked;
    const bConf = {};
    if (bmode !== '') bConf.browser_headless = bmode === 'true';
    if (bcdp !== '') bConf.browser_cdp_url = bcdp;
    if (bstealth) bConf.browser_stealth = true;
    formData.append('browser_config', JSON.stringify(bConf));

    const throttleEl = document.getElementById('flow-batch-throttle');
    if (throttleEl) formData.append('batch_throttle_seconds', throttleEl.value.trim());

    try {
        const savedScraper = await apiFetch('/api/scrapers/builder', { method: 'POST', body: formData });

        // Update context so subsequent saves update THIS scraper
        state.builder.currentScraperId = savedScraper.id;
        state.builder.currentScraperName = savedScraper.name;
        document.getElementById('flow-scraper-id').value = savedScraper.id;

        const idx = state.scrapers.findIndex(s => s.id === savedScraper.id);
        if (idx !== -1) {
            state.scrapers[idx] = savedScraper;
        } else {
            state.scrapers.push(savedScraper);
        }

        toast(scraperId ? (isSnap ? 'Snapshot created successfully!' : 'Flow updated successfully!') : 'Flow saved successfully!', 'success');
        updateBuilderContextUI();
        closeSaveFlowModal();
        loadScrapers(); // Refresh scrapers list in background
    } catch (e) {
        toast(e.message, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Confirm & Save';
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
        const scraperIdField = document.getElementById('flow-scraper-id');
        const nameField = document.getElementById('flow-name');
        const descField = document.getElementById('flow-desc');
        if (scraperIdField) scraperIdField.value = s.id;
        if (nameField) nameField.value = s.name;
        if (descField) descField.value = s.description || '';

        // Browser Config
        const bConf = s.browser_config ? (typeof s.browser_config === 'string' ? JSON.parse(s.browser_config) : s.browser_config) : {};
        const headlessStr = bConf.browser_headless !== undefined ? String(bConf.browser_headless) : '';
        const cdpVal = bConf.browser_cdp_url || '';
        const stealthVal = !!bConf.browser_stealth;

        state.builder.browser_config = {
            headless: headlessStr,
            cdp_url: cdpVal,
            stealth: stealthVal
        };

        // Populate Modal
        const fHeadless = document.getElementById('flow-browser-headless');
        const fCDP = document.getElementById('flow-browser-cdp');
        const fStealth = document.getElementById('flow-browser-stealth');
        if (fHeadless) fHeadless.value = headlessStr;
        if (fCDP) fCDP.value = cdpVal;
        if (fStealth) fStealth.checked = stealthVal;

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

// ── Flow Export / Import (.stlflow) ──────────────────
function exportFlow() {
    if (state.builder.nodes.length === 0) {
        toast('Nothing to export — canvas is empty.', 'error');
        return;
    }
    const payload = {
        version: 1,
        name: state.builder.currentScraperName || 'Untitled',
        nodes: state.builder.nodes,
        edges: state.builder.edges,
        viewport: { x: state.builder.x, y: state.builder.y, zoom: state.builder.zoom }
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(state.builder.currentScraperName || 'flow').replace(/[^a-z0-9_-]/gi, '_')}.stlflow`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast('Flow exported.', 'success');
}

function importFlow() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.stlflow,.json';
    input.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            try {
                const data = JSON.parse(ev.target.result);
                if (!Array.isArray(data.nodes) || !Array.isArray(data.edges)) {
                    toast('Invalid .stlflow file.', 'error');
                    return;
                }
                if (state.builder.nodes.length > 0 && !confirm('Replace current canvas with imported flow?')) return;

                deselectAll();
                state.builder.nodes = data.nodes;
                state.builder.edges = data.edges;
                if (data.viewport) {
                    state.builder.x = data.viewport.x ?? -2000;
                    state.builder.y = data.viewport.y ?? -2000;
                    state.builder.zoom = data.viewport.zoom ?? 1;
                }
                if (data.name && !state.builder.currentScraperId) {
                    state.builder.currentScraperName = data.name;
                    updateBuilderContextUI();
                }
                renderBuilderNodes();
                renderConnections();
                const canvas = document.getElementById('builder-canvas');
                if (canvas) canvas.style.transform = `translate(${state.builder.x}px, ${state.builder.y}px) scale(${state.builder.zoom})`;
                toast(`Imported "${data.name || 'flow'}".`, 'success');
            } catch (err) {
                toast('Failed to parse file: ' + err.message, 'error');
            }
        };
        reader.readAsText(file);
    };
    document.body.appendChild(input);
    input.click();
    document.body.removeChild(input);
}

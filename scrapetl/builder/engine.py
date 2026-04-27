import json
import re
import concurrent.futures
import threading
from typing import Dict, Any, List, Optional
import requests
from playwright.sync_api import sync_playwright
from bs4 import BeautifulSoup
from scrapetl.expressions import resolve_expressions
from scrapetl.models import GlobalVariable, Batch

class BuilderEngine:
    """
    Executes a visual builder flow (DAG).
    Handles node caching, parallel branching, multiple output merging,
    and conditional branching (True/False paths).
    """

    def __init__(self, flow_data: Dict[str, Any], global_vars: Dict[str, Any], db_session=None, custom_funcs: Dict[str, str] = None, browser_config: Dict[str, Any] = None):
        self.nodes = {str(n["id"]): n for n in flow_data.get("nodes", [])}
        self.edges = flow_data.get("edges", [])
        self.global_vars = global_vars
        self.db = db_session
        self.custom_funcs = custom_funcs or {}
        self.browser_config = browser_config or {}
        # Internal cache for node results to prevent redundant execution
        self.results_cache: Dict[str, Any] = {}
        # Named wire store: wire_relay nodes write here, wire (tap) nodes read from here
        self.wire_store: Dict[str, Any] = {}

        # Adjacency list for DAG traversal
        self.adj = {}
        self.in_degree = {str(nid): 0 for nid in self.nodes}
        for edge in self.edges:
            src = str(edge.get("source") or edge.get("from"))
            tgt = str(edge.get("target") or edge.get("to"))

            if src not in self.adj: self.adj[src] = []
            self.adj[src].append(tgt)
            self.in_degree[tgt] += 1

        # Synthetic ordering: tap nodes depend on their relay node.
        # No canvas edge exists between them, so we inject a virtual dependency
        # to ensure relay executes (and writes wire_store) before tap reads it.
        # The synthetic edge must also be appended to self.edges because
        # in_degree[neighbor] -= 1 lives inside the `for edge in matching_edges` loop
        # and will never fire for a neighbor that has no real edge entry.
        for nid, node in self.nodes.items():
            if node.get("preset") == "tap":
                relay_id = str(node.get("config", {}).get("relay_id") or "").strip()
                if relay_id and relay_id in self.nodes:
                    if relay_id not in self.adj: self.adj[relay_id] = []
                    if nid not in self.adj[relay_id]:
                        self.adj[relay_id].append(nid)
                        self.edges.append({
                            "source": relay_id,
                            "target": nid,
                            "sourceHandle": "data",
                            "targetHandle": "data",
                            "_synthetic": True
                        })
                    self.in_degree[nid] += 1

        # 🧪 STATE RESET: We keep a copy of the original in-degree map
        # so we can reset it before every execute() call.
        self._orig_in_degree = self.in_degree.copy()
        self.initial_nodes = [nid for nid, deg in self.in_degree.items() if deg == 0]

    def _get_full_type(self, node: Dict[str, Any]) -> str:
        """Resolves the combined type_preset string for a node."""
        ntype = str(node.get("type", "")).strip()
        preset = str(node.get("preset", "")).strip()
        if preset and preset not in ntype:
            return f"{ntype}_{preset}"
        return ntype

    def setup(self):
        """Lifecycle hook called by Runner before batch execution to share browser context."""
        # 1. SCAN: See if any node in the flow actually requires Playwright.
        # This prevents unnecessary browser launches when executing simple logic flows.
        node_types = {self._get_full_type(n) for n in self.nodes.values()}
        needs_playwright = any("playwright" in nt.lower() for nt in node_types)
        
        if not needs_playwright:
            # We don't print anything here to keep the log clean for simple flows
            return

        try:
            from playwright.sync_api import sync_playwright
            self._p = sync_playwright().start()
            
            cdp_url = self.browser_config.get("browser_cdp_url")
            headless = str(self.browser_config.get("browser_headless", "true")).lower() == "true"

            if cdp_url:
                print(f"[BuilderEngine] Connecting to remote CDP: {cdp_url}")
                self._browser = self._p.chromium.connect_over_cdp(cdp_url)
            else:
                print(f"[BuilderEngine] Launching local browser (headless={headless})")
                self._browser = self._p.chromium.launch(headless=headless)
            
            stealth_on = str(self.browser_config.get("browser_stealth", "false")).lower() == "true"
            if stealth_on:
                ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                self._context = self._browser.new_context(
                    user_agent=ua,
                    viewport={"width": 1920, "height": 1080},
                    locale="en-US",
                    timezone_id="America/New_York",
                    java_script_enabled=True,
                )
            else:
                self._context = self._browser.new_context()

            self._page = self._context.new_page()

            if stealth_on:
                try:
                    from playwright_stealth import stealth_sync
                    stealth_sync(self._page)
                except ImportError:
                    pass
            self._page.on('dialog', lambda dialog: dialog.accept())
        except Exception as e:
            print(f"[BuilderEngine] Playwright setup failed: {e}")
            if hasattr(self, '_p'): self._p.stop()

    def teardown(self):
        """Lifecycle hook called by Runner after batch execution."""
        # 1. Close browser if it was actually initialized
        if hasattr(self, '_browser'):
            try:
                self._browser.close()
            except:
                pass
            try: 
                self._browser.close()
            except: 
                pass
        
        # 2. Stop playwright if it was actually started
        if hasattr(self, '_p'):
            try: 
                self._p.stop()
                if hasattr(self, '_browser'):
                    # Only log closure if a browser session was actually active
                    print("[BuilderEngine] Playwright session closed.")
            except: 
                pass
            try: 
                self._p.stop()
            except: 
                pass

    def execute(self, runtime_inputs: Dict[str, Any], stop_event: Optional[threading.Event] = None) -> List[Dict[str, Any]]:
        """Main entry point for execution."""
        # 🛤️ RESET ENGINE STATE FOR EACH RUN
        self.in_degree = self._orig_in_degree.copy()
        self.active_edges = set() 
        self.results_cache = {}
        self.execution_statuses = {}

        queue = self.initial_nodes.copy()
        combined_results = []
        debug_artifacts = []
        processed_nodes = set()

        while queue:
            if stop_event and stop_event.is_set():
                print("[BuilderEngine] 🛑 Execution cancelled by stop signal.")
                break

            current_id = queue.pop(0)
            node = self.nodes[current_id]
            node_inputs = self._get_node_inputs(current_id)
            
            # --- 1. Trigger Guard (Skip Check) ---
            # EXCLUSION: 'input' nodes never have a trigger guard.
            skip_node = False
            
            # A. Check if a trigger PORT is connected (even if no signal arrived due to upstream skip)
            # We check the raw editor edges to see if the user intended a dependency here.
            has_trigger_connection = any(
                str(e.get("target") or e.get("to")) == str(current_id) and e.get("targetHandle") == "trigger"
                for e in self.edges
            )

            if node.get("type") not in ["input"]:
                if "trigger" in node_inputs:
                    t_vals = node_inputs.get("trigger")
                    if not isinstance(t_vals, list):
                        t_vals = [t_vals]
                    
                    # Logic: We only skip if all signals explicitly abort, OR if there's an error.
                    # If a trigger is a Batch, we consider it valid if AT LEAST ONE element is True.
                    has_valid_signal = False
                    for t in t_vals:
                        if isinstance(t, dict) and "__error__" in t:
                            skip_node = True
                            has_valid_signal = False
                            break
                        
                        # Use bool() for robust truthiness (0, None, "", etc = False)
                        if isinstance(t, list):
                            if any(bool(x) for x in t):
                                has_valid_signal = True
                        elif bool(t):
                            has_valid_signal = True

                    if not has_valid_signal and not skip_node:
                        skip_node = True
                
                elif has_trigger_connection:
                    # Connection exists but NO signal arrived -> Upstream was skipped
                    print(f"[BuilderEngine] Skipping node {current_id} ({node['type']}) - Source triggered nodes were skipped.")
                    skip_node = True

            if skip_node:
                print(f"[BuilderEngine] Skipping node {current_id} ({node['type']}) - Trigger Guard active.")
                # We record the skipped state and let it fall through to neighbor propagation
                self.results_cache[current_id] = None
                
            # 🔪 UNIVERSAL BATCH FILTERING: If the node is allowed to run,
            # filter ANY incoming Batch lists according to the boolean trigger Batch!
            if not skip_node and "trigger" in node_inputs:
                t_input = node_inputs.get("trigger")
                
                # Check if t_input is a flat array of booleans/values, or a nested array
                trigger_mask = None
                if isinstance(t_input, list):
                    # If it contains lists (multi-edge), try to find the first list
                    if any(isinstance(t, list) for t in t_input):
                        for t in t_input:
                            if isinstance(t, list):
                                trigger_mask = t
                                break
                    else:
                        # It is a flat list (e.g. Batch of booleans), use it directly
                        trigger_mask = t_input
                
                if trigger_mask:
                    for key, val in node_inputs.items():
                        if key == "trigger": continue
                        if isinstance(val, list):
                            filtered_val = []
                            for idx, item in enumerate(val):
                                t_val = trigger_mask[idx] if idx < len(trigger_mask) else trigger_mask[-1] if trigger_mask else False
                                if bool(t_val):
                                    filtered_val.append(item)
                            node_inputs[key] = Batch(filtered_val)

            # --- 2. Node Execution ---
            status = "success"
            res = None
            
            if not skip_node:
                try:
                    res = self._execute_node(node, node_inputs, runtime_inputs)
                    
                    # Global check: If a node returns an error string, escalate it as a failure
                    if isinstance(res, str) and res.startswith("[Error: "):
                        raise ValueError(res[8:-1])

                    self.results_cache[current_id] = res
                    print(f"[BuilderEngine] Ran node {current_id} ({node['type']}) -> result type: {type(res).__name__}")

                    nt = self._get_full_type(node)
                    if nt == "sink_debug":
                        debug_artifacts.append({
                            "node_id": current_id,
                            "label": node.get("config", {}).get("label", "Debug"),
                            "data": res
                        })

                except Exception as e:
                    from scrapetl.exceptions import ScrapeSkip
                    if isinstance(e, ScrapeSkip):
                        raise  # propagate skip to the runner unchanged
                    print(f"[BuilderEngine] ❌ Error in node {current_id} ({node['type']}): {e}")
                    # EXCLUSION: Utility nodes do not propagate errors via dedicated ports
                    if node.get("type") in ["input", "sink", "utility"]:
                        status = "failed"
                        self.results_cache[current_id] = {"__error__": str(e)}
                    else:
                        status = "failed"
                        res = {"__error__": str(e), "node_id": current_id, "type": node['type']}
                        self.results_cache[current_id] = res
            else:
                status = "skipped"
                # For skipped nodes, we pass along the trigger signal (or None) if subsequent nodes are triggered
                self.results_cache[current_id] = node_inputs.get("trigger")
            
            self.execution_statuses[current_id] = status

            # --- 3. Neighbor Propagation (Branching) ---
            for neighbor in self.adj.get(current_id, []):
                # Find matching edges to determine handles
                matching_edges = [
                    e for e in self.edges
                    if str(e.get("source") or e.get("from")) == str(current_id)
                    and str(e.get("target") or e.get("to")) == str(neighbor)
                ]
                
                should_trigger_neighbor = False
                for edge in matching_edges:
                    # Resolve handles consistently
                    src_handle = edge.get("sourceHandle")
                    if not src_handle and "fromIdx" in edge:
                        src_handle = self._map_port_to_handle(current_id, edge["fromIdx"])
                    if not src_handle: src_handle = "data"

                    handle = src_handle # Local alias for the logic below
                    
                    if status == "success":
                        # 🛤️ VALUE-BASED LOGICAL ROUTING:
                        # Logical branches ('True', 'False', 'Data') are ALWAYS followed on success.
                        # Downstream nodes use their 'Trigger' guard to abort if they receive a 'False' value.
                        if handle != "error": should_trigger_neighbor = True
                    elif status == "failed":
                        # Failure: ONLY follow 'error' path
                        if handle == "error": should_trigger_neighbor = True
                
                    # 🛠️ ALWAYS decrement in_degree to prevent "stuck DAG" deadlocks.
                    # But only mark it as "active" if it was actually triggered.
                    if should_trigger_neighbor:
                        edge_key = (str(current_id), str(neighbor), str(src_handle))
                        self.active_edges.add(edge_key)
                    
                    self.in_degree[neighbor] -= 1
                    if self.in_degree[neighbor] == 0:
                        queue.append(neighbor)
                
                # Cleanup: logging
                # if not any(edge_key for edge_key in self.active_edges if edge_key[0] == current_id):
                #     print(f"[BuilderEngine] ⎇ Skipping all paths from {current_id}")

            processed_nodes.add(current_id)

        # Aggregation
        main_outputs = []
        for n_id, node in self.nodes.items():
            nt = self._get_full_type(node)
            if nt == "sink_system_output":
                # Final guard: Only include output nodes that were actually reached and processed.
                # Nodes that were never reached (stuck in in_degree waitlist) or skipped should be ignored.
                status = self.execution_statuses.get(n_id)
                if n_id in processed_nodes and status in ["success", "failed"]:
                    res = self.results_cache.get(n_id)
                    if res: main_outputs.append(res)

        # We need a predictable way to name columns if multiple sinks use the same label
        label_counts = {}
        columns = {}

        for res in main_outputs:
            if not isinstance(res, list) or not res: 
                continue
            
            # Identify the node's label and generate a unique key
            # Since sink_system_output returns [{label: val}, ...], we inspect the first item
            first_item = res[0]
            if isinstance(first_item, dict):
                label = list(first_item.keys())[0]
                label_counts[label] = label_counts.get(label, 0) + 1
                unique_key = f"{label} #{label_counts[label]}" if label_counts[label] > 1 else label
                
                # Extract all values for this specific column
                col_values = []
                for item in res:
                    if isinstance(item, dict):
                        col_values.append(item.get(label))
                
                columns[unique_key] = col_values

        # Final Zipping: Create rows based on the maximum length of any single column
        if not columns:
            return {"main": [], "debug": debug_artifacts}

        max_len = max(len(col) for col in columns.values())

        # Expand columns whose length evenly divides max_len by repeating each
        # value proportionally. This handles page_number (5 items) vs results
        # (250 items = 5 pages × 50 rows): each page_number repeats 50 times.
        expanded = {}
        for k, col in columns.items():
            n = len(col)
            if n == max_len or n == 0:
                expanded[k] = col
            elif n == 1:
                expanded[k] = col * max_len
            elif max_len % n == 0:
                factor = max_len // n
                exp = []
                for v in col:
                    exp.extend([v] * factor)
                expanded[k] = exp
            else:
                expanded[k] = col

        final_results = []
        for i in range(max_len):
            row = {}
            for k, col in expanded.items():
                row[k] = col[i] if i < len(col) else None
            final_results.append(row)

        print(f"[BuilderEngine] Flow Finished. Extracted {len(final_results)} items. Captured {len(debug_artifacts)} debug points.")
        return {
            "main": final_results,
            "debug": debug_artifacts
        }

    def _ensure_single_str(self, val):
        if val is None: return ""
        if isinstance(val, list):
            # Take the first non-empty string or element
            for item in val:
                if item: return str(item).strip()
            return ""
        return str(val).strip()

    def _execute_node(self, node: Dict[str, Any], node_inputs: Dict[str, Any], runtime_inputs: Dict[str, Any]) -> Any:
        ntype = self._get_full_type(node)
        data = node.get("config", {})

        print(f"[BuilderEngine] Executing {node['id']} (Resolved Type: '{ntype}')")

        # ── Inputs ──────────────────────────────────────────────────────
        if ntype == "input_external":
            name = data.get("name")
            val = runtime_inputs.get(name, data.get("default"))
            dtype = data.get("dataType", "string")

            # Batch passthrough: if val is already a list, preserve it
            if isinstance(val, list):
                return Batch(val)

            if dtype == "number":
                try:
                    return float(str(val).replace(",", "")) if "." in str(val) else int(str(val).replace(",", ""))
                except: return 0
            elif dtype == "bool":
                return str(val).lower().strip() in ("true", "1", "yes", "on")
            elif dtype == "json":
                try: return json.loads(val) if isinstance(val, str) else val
                except: return val
            return str(val) if val is not None else ""

        elif ntype == "input_expression":
            import types as _types
            expr = (data.get("value") or data.get("expression", "")).strip()
            context = self._get_execution_context(node_inputs)
            print(f"[BuilderEngine] Resolving expression: '{expr}' | context keys: {list(context.keys())}")
            res = resolve_expressions(expr, context, custom_funcs=self.custom_funcs)
            if isinstance(res, str) and res.startswith("[Error: "):
                raise ValueError(f"Expression evaluation failed: {res[8:-1]}")
            # Convert generators, range, and other iterables to Batch for proper engine propagation
            if isinstance(res, (_types.GeneratorType, range)) or (
                hasattr(res, '__iter__') and not isinstance(res, (str, bytes, list, dict, Batch))
            ):
                res = Batch(list(res))
            return res

        # ── Sources & Actions ────────────────────────────────────────────
        elif ntype in ["action_fetch_url", "source_fetch_url", "source_fetch_html"]:
            url_input = data.get("url") or node_inputs.get("url")
            if not url_input:
                print("[BuilderEngine] Warning: Fetcher node has no URL input! Skipping.")
                return None

            headers_raw = data.get("headers") or {}
            
            def _fetch_single(u):
                u = self._ensure_single_str(resolve_expressions(u, self._get_execution_context(node_inputs)))
                if not u: return ""
                print(f"[BuilderEngine] Fetcher resolved URL: {u}")
                
                headers = {}
                if isinstance(headers_raw, str):
                    try: headers = json.loads(headers_raw.strip() or "{}")
                    except:
                        try:
                            import ast
                            headers = ast.literal_eval(headers_raw.strip() or "{}")
                        except: pass
                else: headers = headers_raw
                
                resp = requests.get(u, headers=headers, timeout=30)
                resp.raise_for_status()
                return resp.text

            if isinstance(url_input, list):
                return Batch([_fetch_single(u) for u in url_input])
            return _fetch_single(url_input)

        elif ntype in ["action_fetch_playwright", "source_fetch_playwright"]:
            url_input = data.get("url") or node_inputs.get("url")
            if not url_input: return None

            headless = data.get("headless", True)
            actions = data.get("actions", [])
            auto_dismiss = data.get("auto_dismiss", [])
            wait_sel = data.get("wait_for_selector") or data.get("wait_for")
            if not actions and wait_sel:
                actions = [{"type": "wait_for_selector", "value": wait_sel}]

            def _run_playwright_logic(page, url):
                if auto_dismiss:
                    script = f"""
                    setInterval(() => {{
                        const selectors = {json.dumps(auto_dismiss)};
                        selectors.forEach(sel => {{
                            try {{ document.querySelectorAll(sel).forEach(el => el.click()); }} catch(e) {{}}
                        }});
                    }}, 1500);
                    """
                    page.add_init_script(script)

                def _is_bot_challenge(html):
                    markers = [
                        "Enable JavaScript and cookies to continue",
                        "cf-browser-verification",
                        "Just a moment",
                        "Checking your browser",
                        "Please Wait... | Cloudflare",
                        "DDoS protection by Cloudflare",
                        "_cf_chl_opt",
                    ]
                    return any(m in html for m in markers)

                if url.strip().startswith("<"):
                    page.set_content(url)
                else:
                    page.goto(url, wait_until="domcontentloaded", timeout=60000)
                    # If Cloudflare JS challenge detected, wait for it to resolve
                    if _is_bot_challenge(page.content()):
                        import time as _t, random as _r
                        print(f"[BuilderEngine] Bot challenge detected for {url}, waiting for JS resolution…")
                        try:
                            page.wait_for_load_state("networkidle", timeout=12000)
                        except Exception:
                            pass
                        if _is_bot_challenge(page.content()):
                            _t.sleep(_r.uniform(3.0, 6.0))
                            try:
                                page.reload(wait_until="networkidle", timeout=20000)
                            except Exception:
                                pass

                for action in actions:
                    atype = action.get("type", "")
                    aval = str(action.get("value", ""))

                    try:
                        if atype == "wait_for_selector" and aval:
                            page.wait_for_selector(aval, timeout=10000)
                        elif atype == "click" and aval:
                            page.locator(aval).first.click(timeout=10000)
                        elif atype == "wait_for_timeout" or atype == "wait":
                            page.wait_for_timeout(int(aval) if aval.isdigit() else 2000)
                        elif atype == "scroll_bottom":
                            page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                            page.wait_for_timeout(1000)
                        elif atype == "scroll_to":
                            page.locator(aval).first.scroll_into_view_if_needed(timeout=10000)
                        elif atype == "goto":
                            page.goto(aval, wait_until="domcontentloaded", timeout=30000)
                        elif atype == "type":
                            page.keyboard.type(aval)
                        elif atype == "screenshot":
                            # Snapshot the element as an image
                            if aval:
                                bytes = page.locator(aval).first.screenshot(type="png")
                            else:
                                bytes = page.screenshot(type="png")
                            import base64
                            return f"data:image/png;base64,{base64.b64encode(bytes).decode()}"
                        elif atype == "fetch_image":
                            # Use canvas-based extraction to bypass CORS (reads from visible DOM)
                            if not aval:
                                raise Exception("fetch_image requires a selector to find the image src.")
                            
                            try:
                                data_url = page.evaluate("""
                                    async (selector) => {
                                        const img = document.querySelector(selector);
                                        if (!img) throw new Error(`Selector "${selector}" matches no element`);
                                        
                                        // Wait for load
                                        if (!img.complete) {
                                            await new Promise(r => {
                                                img.onload = () => r();
                                                img.onerror = () => r();
                                            });
                                        }

                                        const canvas = document.createElement('canvas');
                                        canvas.width = img.naturalWidth || img.width;
                                        canvas.height = img.naturalHeight || img.height;
                                        const ctx = canvas.getContext('2d');
                                        ctx.drawImage(img, 0, 0);
                                        return canvas.toDataURL('image/jpeg', 0.9);
                                    }
                                """, aval)
                                return data_url
                            except Exception as canvas_err:
                                # Fallback: page.request.get (bypasses browser CORS at the engine level)
                                # Silence "Tainted Canvas" security errors as we have a working fallback
                                if "SecurityError" not in str(canvas_err) and "Tainted canvases" not in str(canvas_err):
                                    print(f"[BuilderEngine] Canvas fetch_image failed: {canvas_err}")
                                
                                src = page.locator(aval).first.get_attribute("src")
                                if src:
                                    if not src.startswith("http") and not src.startswith("data:"):
                                        from urllib.parse import urljoin
                                        src = urljoin(page.url, src)
                                    
                                    response = page.request.get(src)
                                    if response.status == 200:
                                        import base64
                                        content_type = response.headers.get("content-type", "image/jpeg")
                                        return f"data:{content_type};base64,{base64.b64encode(response.body()).decode()}"
                                    raise Exception(f"Failed to fetch image via network: HTTP {response.status}")
                                raise canvas_err
                    except Exception as e:
                        print(f"[BuilderEngine] Playwright Action Failed ({atype}): {e}")
                        # Important: Do NOT return page.content() if a critical action failed
                        # return f"[Error: Action {atype} failed: {e}]"

                return page.content()

            _pw_map_call_count = [0]

            def _pw_map(u):
                import time as _time, random as _random
                u = self._ensure_single_str(resolve_expressions(u, self._get_execution_context(node_inputs)))
                if not u: return ""
                _stealth_on = str(self.browser_config.get("browser_stealth", "false")).lower() == "true"
                # Human-like delay between sequential fetches (skip first call)
                if _stealth_on and _pw_map_call_count[0] > 0:
                    _time.sleep(_random.uniform(1.5, 4.0))
                _pw_map_call_count[0] += 1
                if hasattr(self, '_context'):
                    # Fresh page per URL — stealth applied cleanly each time.
                    # Pages share context cookies (cf_clearance carries over between URLs).
                    pg = self._context.new_page()
                    if _stealth_on:
                        try:
                            from playwright_stealth import stealth_sync
                            stealth_sync(pg)
                        except ImportError:
                            pass
                    pg.on('dialog', lambda dialog: dialog.accept())
                    try:
                        return _run_playwright_logic(pg, u)
                    finally:
                        try: pg.close()
                        except: pass
                elif hasattr(self, '_page'):
                    return _run_playwright_logic(self._page, u)
                else:
                    from scrapetl.models import AppSetting
                    from playwright.sync_api import sync_playwright
                    db = self.db
                    gh = db.get(AppSetting, "browser_headless").value if db and db.get(AppSetting, "browser_headless") else "true"
                    gcdp = db.get(AppSetting, "browser_cdp_url").value if db and db.get(AppSetting, "browser_cdp_url") else ""
                    sc = self.browser_config
                    h = str(sc.get("browser_headless") or gh).lower() == "true"
                    c = sc.get("browser_cdp_url") or gcdp
                    with sync_playwright() as p:
                        browser = p.chromium.connect_over_cdp(c) if c else p.chromium.launch(headless=h)
                        _stealth = str(sc.get("browser_stealth", "false")).lower() == "true"
                        if _stealth:
                            ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                            ctx = browser.new_context(
                                user_agent=ua,
                                viewport={"width": 1920, "height": 1080},
                                locale="en-US",
                                timezone_id="America/New_York",
                                java_script_enabled=True,
                            )
                        else:
                            ctx = browser.new_context()

                        pg = ctx.new_page()

                        if _stealth:
                            try:
                                from playwright_stealth import stealth_sync
                                stealth_sync(pg)
                            except ImportError:
                                pass
                        pg.on('dialog', lambda dialog: dialog.accept())
                        result = _run_playwright_logic(pg, u)
                        browser.close()
                        return result

            if isinstance(url_input, list):
                return Batch([_pw_map(u) for u in url_input])
            return _pw_map(url_input)

        # ── Actions ──────────────────────────────────────────────────────
        elif ntype == "action_bs4_select":
            html_input = data.get("html") or node_inputs.get("html")
            if not html_input:
                print("[BuilderEngine] Warning: BS4 node has no HTML input! Skipping.")
                return None

            selector = data.get("selector")
            mode = data.get("mode", "first")
            out_type = data.get("output_type", "html")
            attr_name = data.get("attribute")
            limit = data.get("limit")

            if not selector:
                return html_input

            def _extract_val(el):
                if out_type == "text":
                    return el.get_text(strip=True)
                if out_type == "attr" and attr_name:
                    return el.get(attr_name, "")
                return str(el)

            def _process_html(h_str):
                soup = BeautifulSoup(str(h_str), "html.parser")
                if mode == "all":
                    results = soup.select(selector)
                    if limit and str(limit).isdigit():
                        results = results[:int(limit)]
                    return Batch([_extract_val(r) for r in results])
                else:
                    result = soup.select_one(selector)
                    if not result:
                        return None
                    return _extract_val(result)

            if isinstance(html_input, list):
                mapped = [_process_html(h) for h in html_input]
                # Always group mode=all: return Batch([Batch([...]), ...]) so Merge can
                # zip per-row sub-elements. _get_node_inputs flattens this for all other
                # node types so they always receive flat Level-1 input.
                return Batch(mapped)
            else:
                return _process_html(html_input)

        elif ntype == "action_regex_extract":
            text_input = node_inputs.get("text") or node_inputs.get("data") or ""
            pattern = data.get("pattern", "")
            group_idx = int(data.get("group", 0))

            if not pattern: return text_input

            # Performance Optimization: Resolve static config parameters once
            ctx = self._get_execution_context(node_inputs)
            p = str(resolve_expressions(pattern, ctx, custom_funcs=self.custom_funcs))

            def _extract(txt):
                match = re.search(p, str(txt), re.I | re.S)
                if match:
                    try:
                        return match.group(group_idx)
                    except IndexError:
                        return match.group(0)
                return None

            if isinstance(text_input, list):
                return Batch([_extract(t) for t in text_input])
            return _extract(text_input)

        elif ntype == "action_text_transform":
            text_input = node_inputs.get("text") or node_inputs.get("data") or ""
            op = data.get("operation", "none")
            val = data.get("value", "")
            repl = data.get("replacement", "")

            # Performance Optimization: Resolve static config parameters once, not for every item in a list
            ctx = self._get_execution_context(node_inputs)
            v = resolve_expressions(val, ctx, custom_funcs=self.custom_funcs)
            r = resolve_expressions(repl, ctx, custom_funcs=self.custom_funcs)

            # Default to 'prefix' if operation is missing but value is provided (fixes UI default mismatch)
            if op == "none" and (v or r): 
                op = "prefix"

            def _transform(txt):
                t = str(txt or "")
                if op == "prefix":
                    return f"{v}{t}"
                elif op == "suffix":
                    return f"{t}{v}"
                elif op == "replace":
                    return t.replace(v, r)
                elif op == "trim":
                    return t.strip()
                return t

            if isinstance(text_input, list):
                return Batch([_transform(t) for t in text_input])
            return _transform(text_input)

        elif ntype == "action_string_format":
            template = data.get("template", "")

            # Build index→value dict from input handles (input_0, input_1, ...)
            indexed_inputs = {}
            for k, v in node_inputs.items():
                if k.startswith('input_') and k[6:].isdigit():
                    indexed_inputs[int(k[6:])] = v

            # Determine expected slot count from template placeholders {0}, {1}, ...
            import re as _re_sf
            indices = [int(m) for m in _re_sf.findall(r'\{(\d+)[^}]*\}', template)]
            expected_count = (max(indices) + 1) if indices else len(indexed_inputs)

            # Fill list with "" for any missing/failed upstream inputs
            inputs_list = [indexed_inputs.get(i, "") for i in range(expected_count)]

            def _format(*vals):
                try:
                    return template.format(*[str(v) if v is not None else "" for v in vals])
                except (IndexError, KeyError):
                    return template

            # If any input is a Batch, expand element-wise
            batch_inputs = [v for v in inputs_list if isinstance(v, list)]
            if batch_inputs:
                length = max(len(b) for b in batch_inputs)
                expanded = [
                    v if isinstance(v, list) else [v] * length
                    for v in inputs_list
                ]
                return Batch([_format(*row) for row in zip(*expanded)])
            return _format(*inputs_list)

        elif ntype == "action_type_convert":
            val_input = node_inputs.get("value") or node_inputs.get("data")
            to_type = data.get("to_type", "string")

            def _convert(v):
                if to_type == "int":
                    try: return int(re.sub(r"[^\d-]", "", str(v)))
                    except: return 0
                elif to_type == "float":
                    try: return float(re.sub(r"[^\d\.-]", "", str(v)))
                    except: return 0.0
                elif to_type == "json":
                    try: return json.loads(v) if isinstance(v, str) else v
                    except: return v
                return str(v)

            if isinstance(val_input, list):
                return Batch([_convert(v) for v in val_input])
            return _convert(val_input)

        elif ntype == "action_html_children":
            html = node_inputs.get("html") or ""
            selector = data.get("selector", "*")

            if not html: return []

            soup = BeautifulSoup(html, "html.parser")
            children = soup.find_all(recursive=False)
            results = []
            for child in children:
                if selector == "*" or child.select_one(selector) or child.name == selector:
                    results.append(str(child))
            return Batch(results)

        elif ntype in ["logic_splitter", "utility_splitter"]:
            # Returns its only input; the engine handles duplication to multiple neighbors
            return node_inputs.get("data") or node_inputs.get("input_0") or next(iter(node_inputs.values()), None)

        elif ntype in ["logic_combiner", "utility_combiner"]:
            import json as _json_c
            mode = data.get("mode", "csv")
            sorted_keys = sorted(node_inputs.keys(), key=lambda k: int(k.split('_')[1]) if '_' in k and k.split('_')[1].isdigit() else 0)
            input_list = [node_inputs[k] for k in sorted_keys]

            raw_keys = [k.strip() for k in data.get("keys", "").split(",") if k.strip()]

            def _apply_mode(vals):
                if mode == "csv":
                    return ", ".join(str(v) for v in vals)
                elif mode == "json_array":
                    return _json_c.dumps(vals, default=str)
                elif mode == "json_object":
                    pairs = {(raw_keys[j] if j < len(raw_keys) else f"value_{j}"): v for j, v in enumerate(vals)}
                    return _json_c.dumps(pairs, default=str)
                return ", ".join(str(v) for v in vals)

            has_batch = any(isinstance(v, (Batch, list)) for v in input_list)
            if not has_batch:
                return _apply_mode(input_list)

            # ZIP: align batch ports row-by-row; scalars repeat for every row.
            # Each row's sub-list elements expand inline. Output is Batch of strings
            # so row count matches other batch columns and broadcast doesn't occur.
            row_count = max(len(v) if isinstance(v, (Batch, list)) else 1 for v in input_list)
            rows = []
            for i in range(row_count):
                row_vals = []
                for v in input_list:
                    if isinstance(v, (Batch, list)):
                        elem = v[i] if i < len(v) else (v[-1] if v else None)
                    else:
                        elem = v
                    if isinstance(elem, (list, Batch)):
                        row_vals.extend(elem)
                    else:
                        row_vals.append(elem)
                rows.append(_apply_mode(row_vals))
            return Batch(rows)

        # ── Conditional Logic ─────────────────────────────────────────────
        elif ntype in ["logic_conditional", "logic_logic_gate", "logic_comparison", "logic_string_match", "logic_status_check", "logic_custom_logic"]:
            mode = data.get("mode", "logical")
            operation = data.get("operation", "AND")

            # Collect all connected inputs, ensuring sorted order for binary/unary fallback
            sorted_handles = sorted(node_inputs.keys(), key=lambda x: int(x.split('_')[1]) if '_' in x and x.split('_')[1].isdigit() else 0)
            input_vals = [node_inputs[h] for h in sorted_handles]
            
            a = input_vals[0] if len(input_vals) > 0 else None
            # For non-indexed handles (custom mode), node_inputs contains named args
            if mode == "custom":
                a = node_inputs.get("input_a", a)
            
            compare_val = data.get("compare_value", "")

            def _is_truthy(v):
                """Consistent truth evaluation: None, '', 0, False, [], {} all falsy."""
                if v is None: return False
                if isinstance(v, bool): return v
                if isinstance(v, (int, float)): return v != 0
                if isinstance(v, str): return v.strip().lower() not in ("", "false", "0", "null", "none")
                if isinstance(v, (list, dict)): return len(v) > 0
                return bool(v)

            if mode == "logical":
                bool_vals = [_is_truthy(v) for v in input_vals]
                if not bool_vals:
                    return False
                if operation == "AND":
                    return all(bool_vals)
                elif operation == "OR":
                    return any(bool_vals)
                elif operation == "NAND":
                    return not all(bool_vals)
                elif operation == "NOR":
                    return not any(bool_vals)
                elif operation == "XOR":
                    return sum(bool_vals) % 2 == 1
                elif operation == "XNOR":
                    return sum(bool_vals) % 2 == 0
                elif operation == "NOT":
                    return not _is_truthy(a)

            elif mode == "unary":
                if operation == "is_truthy":
                    return _is_truthy(a)
                elif operation == "is_falsy":
                    return not _is_truthy(a)
                elif operation == "is_null":
                    return a is None
                elif operation == "is_not_null":
                    return a is not None
                elif operation == "is_empty":
                    if isinstance(a, (list, dict, str)):
                        return len(a) == 0
                    return a is None
                elif operation == "is_not_empty":
                    if isinstance(a, (list, dict, str)):
                        return len(a) > 0
                    return a is not None
                elif operation == "is_boolean":
                    return isinstance(a, bool) or str(a).lower() in ("true", "false", "1", "0")
                elif operation == "is_numeric":
                    try: float(str(a).replace(",", "")); return True
                    except: return False
                elif operation == "is_list":
                    return isinstance(a, list)

            elif mode == "string":
                s = str(a) if a is not None else ""
                cv = str(compare_val)
                if operation == "contains":
                    return cv in s
                elif operation == "not_contains":
                    return cv not in s
                elif operation == "starts_with":
                    return s.startswith(cv)
                elif operation == "ends_with":
                    return s.endswith(cv)
                elif operation == "equals":
                    return s == cv
                elif operation == "not_equals":
                    return s != cv
                elif operation == "matches_regex":
                    try: return bool(re.search(cv, s))
                    except: return False
                elif operation == "iequals":
                    return s.lower() == cv.lower()
                elif operation == "length_gt":
                    try: return len(s) > int(cv)
                    except: return False
                elif operation == "length_lt":
                    try: return len(s) < int(cv)
                    except: return False

            elif mode == "binary":
                # Binary comparison between Input A and Input B (or static compare_value)
                b = input_vals[1] if len(input_vals) > 1 else compare_val
                
                def _compare_single(va, vb):
                    raw_a = str(va).strip() if va is not None else ""
                    raw_b = str(vb).strip() if vb is not None else ""
                    
                    # Try numeric comparison
                    try:
                        # Strip commas for standard numeric parsing
                        av = float(raw_a.replace(",", ""))
                        bv = float(raw_b.replace(",", ""))
                        numeric = True
                    except (ValueError, TypeError):
                        av, bv = raw_a, raw_b
                        numeric = False

                    if operation == "eq": return av == bv
                    elif operation == "neq": return av != bv
                    elif operation == "gt": return av > bv
                    elif operation == "gte": return av >= bv
                    elif operation == "lt": return av < bv
                    elif operation == "lte": return av <= bv
                    elif operation == "between":
                        try:
                            parts = [float(x.strip()) for x in raw_b.split(",")]
                            return parts[0] <= float(raw_a.replace(",", "")) <= parts[1]
                        except: return False
                    return False

                # Vectorized Evaluation:
                if isinstance(a, list) and not isinstance(b, list):
                    return Batch([_compare_single(va, b) for va in a])
                elif isinstance(b, list) and not isinstance(a, list):
                    return Batch([_compare_single(a, vb) for vb in b])
                elif isinstance(a, list) and isinstance(b, list):
                    max_len = max(len(a), len(b))
                    res = []
                    for i in range(max_len):
                        va = a[i] if i < len(a) else None
                        vb = b[i] if i < len(b) else None
                        res.append(_compare_single(va, vb))
                    return Batch(res)
                
                return _compare_single(a, b)

            elif mode == "custom":
                func_expr = data.get("custom_func", "").strip()
                if func_expr and self.custom_funcs:
                    # func_expr may be like "my_func" or "my_func(arg1)"
                    # If no parens, inject a as first arg
                    # Improved context: use all connected ports as named variables
                    context = self._get_execution_context(node_inputs)
                    # For legacy/simple mode, still support input_a/input_b
                    if "input_a" not in context: context["input_a"] = a
                    if "input_b" not in context: context["input_b"] = b

                    try:
                        result = resolve_expressions(f"{{{{{func_expr}}}}}", context, custom_funcs=self.custom_funcs)
                        return bool(result)
                    except Exception as e:
                        print(f"[BuilderEngine] Custom func eval error: {e}")
                        return False

            return False

        # ── Sinks ─────────────────────────────────────────────────────────
        elif ntype == "sink_context":
            var_key = data.get("variable_key", "")
            if isinstance(var_key, str) and var_key.startswith("{{") and var_key.endswith("}}"):
                var_key = var_key[2:-2].strip()

            actual_key = var_key.split('.')[-1] if '.' in var_key else var_key
            namespace = var_key.split('.')[0] if '.' in var_key else None

            # Map both 'data' and 'value' depending on how the frontend passes the port
            value = node_inputs.get("data") if "data" in node_inputs else node_inputs.get("value")
            trigger = node_inputs.get("trigger")

            if self.db:
                # 🔍 NAMESPACED RESOLUTION: Handle 'Namespace.Key' splitting
                var = None
                if "." in var_key:
                    ns, k = var_key.split(".", 1)
                    var = self.db.query(GlobalVariable).filter(
                        GlobalVariable.namespace == ns,
                        GlobalVariable.key == k
                    ).first()
                
                # 🔍 FALLBACK: Exact key match or slug match
                if not var:
                    var = self.db.query(GlobalVariable).filter(GlobalVariable.key == var_key).first()
                if not var and actual_key:
                    var = self.db.query(GlobalVariable).filter(GlobalVariable.key == actual_key).first()
                
                if not var:
                    print(f"[BuilderEngine] ❌ Context Setup Error: Variable '{var_key}' not found in registry.")
                    return value

                if var.is_readonly:
                    print(f"[BuilderEngine] ⚠️ Context Update Skipped: Variable '{var.key}' is marked as READ-ONLY.")
                    return value

                final_value = value
                
                # 📊 BATCH LOGIC: The values are already filtered by the generic Trigger Guard.
                # We just pick the maximum numeric value among all valid incoming items.
                if isinstance(value, list):
                    candidates = []
                    for v in value:
                        try:
                            num = float(str(v).replace(",",""))
                            candidates.append((num, v))
                        except:
                            candidates.append((0, v))
                    
                    if not candidates:
                        return None
                    
                    try:
                        best_pair = max(candidates, key=lambda x: x[0])
                        final_value = best_pair[1]
                    except:
                        if candidates: final_value = candidates[0][1]
                
                # 📝 WRITE & SYNC
                import json
                if final_value is None:
                    save_str = None
                elif isinstance(final_value, (list, dict)):
                    save_str = json.dumps(final_value)
                else:
                    save_str = str(final_value)

                var.value = save_str
                self.db.commit()
                print(f"[BuilderEngine] ✅ Context Update: '{var.namespace + '.' if var.namespace else ''}{var.key}' set to '{save_str}'")

                # Local runtime sync (Standard + Namespace)
                self.global_vars[var.key] = final_value
                if var.namespace:
                    if "__namespaces__" not in self.global_vars: self.global_vars["__namespaces__"] = {}
                    if var.namespace not in self.global_vars["__namespaces__"]: self.global_vars["__namespaces__"][var.namespace] = {}
                    self.global_vars["__namespaces__"][var.namespace][var.key] = final_value
                
                return final_value

        elif ntype == "sink_system_output":
            # Strict Resolution: Use "data", "data rows", or "error". 
            sink_data = node_inputs.get("data") or node_inputs.get("data rows") or node_inputs.get("error")
            trigger = node_inputs.get("trigger")
            
            # If nothing found, but port is connected, use None
            # If not connected at all, it's a flow error but we'll return empty list
            if sink_data is None:
                return []

            import types
            if isinstance(sink_data, (types.GeneratorType, range)) or (
                hasattr(sink_data, '__iter__') and not isinstance(sink_data, (str, bytes, list, dict, Batch))
            ):
                sink_data = list(sink_data)
                
            # (Note: Universal batch filtering handles the Trigger array slicing off-node)

            label = str(node.get("config", {}).get("label") or "Results")

            # 🛠️ ERROR FORMATTING: If we received an internal error object, format it using the node's label
            if isinstance(sink_data, dict) and "__error__" in sink_data:
                return [{label: sink_data["__error__"]}]

            # 🛠️ DATA SHAPING (Sink Output)
            # We want to provide a list of dicts for the tabular UI.
            # If the user passed a list or specialized Batch/Generator, handle each item.
            if isinstance(sink_data, (types.GeneratorType, Batch)) or isinstance(sink_data, list):
                # If each item is a dict, return as-is (tabular formatting). 
                # Otherwise, wrap each item under the label.
                return [(item if isinstance(item, dict) else {label: item}) for item in sink_data]
            
            # For SINGLE items:
            return [{label: sink_data}]


        elif ntype == "sink_debug":
            val = node_inputs.get("data") or node_inputs.get("log data") or node_inputs.get("error")
            if val is not None:
                print(f"[BuilderEngine] DEBUG [{node['id']}]: {val}")
            return val

        elif ntype in ("sink_wire_relay", "utility_relay"):
            val = node_inputs.get("data") or next(iter(node_inputs.values()), None)
            self.wire_store[str(node['id'])] = val
            wire_name = str(data.get("wire_name") or "").strip()
            if wire_name:
                self.wire_store[wire_name] = val  # backwards compat
            return val

        elif ntype in ("input_wire", "utility_tap"):
            relay_id = str(data.get("relay_id") or "").strip()
            if relay_id:
                return self.wire_store.get(relay_id)
            wire_name = str(data.get("wire_name") or "").strip()
            return self.wire_store.get(wire_name)

        elif ntype == "sink_raise_skip":
            from scrapetl.exceptions import ScrapeSkip
            val = node_inputs.get("data") or next(iter(node_inputs.values()), None)
            # Only raise if input is explicitly truthy (falsy = pass through silently)
            def _is_truthy(v):
                if v is None or v is False: return False
                if isinstance(v, str): return v.strip().lower() not in ('', 'false', '0', 'none', 'null')
                if isinstance(v, (int, float)): return v != 0
                if isinstance(v, list): return len(v) > 0
                return bool(v)
            if not _is_truthy(val):
                return None
            msg = data.get("message", "").strip() or "Skipped by flow."
            raise ScrapeSkip(msg)

        elif ntype == "source_image_fetch":
            url = node_inputs.get("url") or node_inputs.get("data") or data.get("url")
            if not url:
                return None
            output_type = data.get("output_type", "base64")

            def _fetch_one_image(u):
                if u is None:
                    return None
                u = str(u).strip()
                if not u or u.lower() == "none":
                    return None
                try:
                    resp = requests.get(u, timeout=30)
                    resp.raise_for_status()
                    img_bytes = resp.content
                    if output_type == "base64":
                        import base64
                        ct = resp.headers.get("content-type", "image/jpeg").split(";")[0]
                        b64 = base64.b64encode(img_bytes).decode()
                        return f"data:{ct};base64,{b64}"
                    elif output_type == "bytes_hex":
                        return img_bytes.hex()
                    return u
                except Exception as e:
                    return {"__error__": str(e)}

            if isinstance(url, (list, Batch)):
                return Batch([_fetch_one_image(u) for u in url])
            return _fetch_one_image(url)

        elif ntype in ("logic_negate", "utility_negate"):
            val = node_inputs.get("in") or node_inputs.get("bool") or node_inputs.get("data") or next(iter(node_inputs.values()), None)
            if isinstance(val, list):
                return Batch([not bool(v) for v in val])
            return not bool(val)

        elif ntype == "logic_math_op":
            import math as _math_mod
            sorted_handles = sorted(
                [k for k in node_inputs if k not in ('trigger', 'error')],
                key=lambda x: int(x.split('_')[1]) if '_' in x and x.split('_')[1].isdigit() else 0
            )
            vals = [node_inputs[h] for h in sorted_handles]
            a = vals[0] if len(vals) > 0 else 0
            b = vals[1] if len(vals) > 1 else 0
            op = data.get("operation", "add")

            def _to_num(v):
                try: return float(v)
                except: return 0.0

            def _math(av, bv):
                an, bn = _to_num(av), _to_num(bv)
                if op == "add":      return an + bn
                if op == "subtract": return an - bn
                if op == "multiply": return an * bn
                if op == "divide":   return an / bn if bn != 0 else 0.0
                if op == "modulo":   return an % bn if bn != 0 else 0.0
                if op == "power":    return an ** bn
                if op == "min":      return min(an, bn)
                if op == "max":      return max(an, bn)
                if op == "abs":      return abs(an)
                if op == "round":    return round(an, int(bn))
                if op == "floor":    return float(_math_mod.floor(an))
                if op == "ceil":     return float(_math_mod.ceil(an))
                return an

            if isinstance(a, list) or isinstance(b, list):
                a_l = a if isinstance(a, list) else [a] * len(b if isinstance(b, list) else [])
                b_l = b if isinstance(b, list) else [b] * len(a if isinstance(a, list) else [])
                return Batch([_math(av, bv) for av, bv in zip(a_l, b_l)])
            return _math(a, b)

        return None

    def _get_node_inputs(self, node_id: str) -> Dict[str, Any]:
        """Collects outputs from all nodes that flow INTO this node."""
        node_id = str(node_id)
        inputs = {}
        for edge in self.edges:
            target_id = str(edge.get("target") or edge.get("to"))
            if target_id == node_id:
                src_id = str(edge.get("source") or edge.get("from"))
                src_output = self.results_cache.get(src_id)

                # Resolve standard source handle (from node perspective)
                src_handle = edge.get("sourceHandle")
                if not src_handle and "fromIdx" in edge:
                    src_handle = self._map_port_to_handle(src_id, edge["fromIdx"])
                if not src_handle: src_handle = "data"

                # 🛤️ BRANCHING FILTER: If this edge was not "activated" by the source node,
                # we do NOT provide its output to the target node.
                edge_key = (src_id, str(node_id), str(src_handle))
                if edge_key not in self.active_edges:
                    continue

                # ☯️ VALUE-BASED LOGICAL ROUTING: 
                # If a condition returned a boolean (or Batch of booleans), the "False" port explicitly carries the inverted boolean.
                if str(src_handle).lower() == "false":
                    if isinstance(src_output, bool):
                        src_output = not src_output
                    elif isinstance(src_output, list) and all(isinstance(x, bool) for x in src_output):
                        src_output = Batch([not x for x in src_output])

                # Target handle (to node perspective)
                handle = edge.get("targetHandle")
                if not handle and "toIdx" in edge:
                    handle = self._map_port_to_handle(node_id, edge["toIdx"])

                if not handle:
                    handle = "data"

                # Level-2 auto-flatten: CSS selector mode=all on a Batch input returns
                # Batch([Batch([...]), ...]) to preserve per-row grouping for Merge.
                # All other nodes (text_transform, image_fetch, regex, etc.) need flat
                # Level-1 input, so flatten here before delivery.
                target_node = self.nodes.get(node_id)
                target_type = self._get_full_type(target_node) if target_node else ""
                _merge_types = {"logic_combiner", "utility_combiner"}
                if target_type not in _merge_types:
                    if (isinstance(src_output, (list, Batch)) and src_output
                            and all(isinstance(x, (list, Batch)) for x in src_output)):
                        src_output = Batch([item for inner in src_output for item in inner])

                # Multi-edge support: Collect results into a list if multiple nodes connect to the same port
                if handle in inputs:
                    if type(inputs[handle]) is not list:
                        inputs[handle] = [inputs[handle]]
                    inputs[handle].append(src_output)
                else:
                    inputs[handle] = src_output
        return inputs

    def _get_execution_context(self, node_inputs: Dict[str, Any]) -> Dict[str, Any]:
        """Builds a structured, namespaced context for expression evaluation."""
        # Pre-process Global Registry (including the new schema metadata)
        # Note: self.global_vars is a dict of {key: value} passed from Runner
        # We also want to provide access to the raw model data if needed?
        # For now, let's keep it simple as requested.
        
        # Nodes by label/ID
        nodes_context = {}
        for nid, res in self.results_cache.items():
            node = self.nodes.get(nid)
            # Default to ID if label is missing
            label = node.get("config", {}).get("label") if node else None
            if label:
                nodes_context[label] = res
            nodes_context[nid] = res

        # Organize Global Registry into Namespaces (Handled by resolve_expressions)
        # We just provide the root vars and inputs.
        
        context = {
            "vars": self.global_vars,
            "v": self.global_vars,
            "inputs": node_inputs,
            "nodes": nodes_context,
            # Fallback for backward compatibility
            **self.global_vars,
            **node_inputs
        }
        
        # Log active namespaces for diagnostics
        ns_count = len(self.global_vars.get("__namespaces__", {}))
        if ns_count:
            print(f"[BuilderEngine] Active Namespaces: {list(self.global_vars['__namespaces__'].keys())}")
            
        return context

    def _map_port_to_handle(self, node_id: str, port_idx: Any) -> str:
        """Maps a numeric port index or string handle to a descriptive handle name."""
        if port_idx == "trigger": return "trigger"
        if port_idx == "error": return "error"
        
        node = self.nodes.get(node_id)
        if not node: return "data"
        ntype = node.get("type", "")
        preset = node.get("preset", "")
        if preset:
            ntype = f"{ntype}_{preset}"

        if ntype in ["action_fetch_url", "source_fetch_url", "action_fetch_playwright", "source_fetch_playwright", "source_fetch_html", "source_image_fetch"]:
            return "url" if port_idx == 0 else "data"

        if ntype in ["action_bs4_select", "action_html_children"]:
            return "html" if port_idx == 0 else "data"

        if ntype in ["action_regex_extract", "action_text_transform"]:
            return "text" if port_idx == 0 else "data"

        if ntype in ["action_type_convert", "sink_context"]:
            return "value" if port_idx == 0 else "data"

        if ntype in ["sink_system_output", "sink_debug"]:
            return "data"

        # Conditional: inputs are labeled by index
        if ntype == "logic_conditional":
            return f"input_{port_idx}"

        try:
            p_idx = int(port_idx)
            return f"input_{p_idx}"
        except:
            return str(port_idx)

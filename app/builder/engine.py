import json
import re
import concurrent.futures
import threading
from typing import Dict, Any, List, Optional
import requests
from playwright.sync_api import sync_playwright
from bs4 import BeautifulSoup
from app.expressions import resolve_expressions
from app.models import GlobalVariable

class BuilderEngine:
    """
    Executes a visual builder flow (DAG).
    Handles node caching, parallel branching, multiple output merging,
    and conditional branching (True/False paths).
    """

    def __init__(self, flow_data: Dict[str, Any], global_vars: Dict[str, Any], db_session=None, custom_funcs: Dict[str, str] = None):
        self.nodes = {str(n["id"]): n for n in flow_data.get("nodes", [])}
        self.edges = flow_data.get("edges", [])
        self.global_vars = global_vars
        self.db = db_session
        self.custom_funcs = custom_funcs or {}
        # Internal cache for node results to prevent redundant execution
        self.results_cache: Dict[str, Any] = {}

        # Adjacency list for DAG traversal
        self.adj = {}
        self.in_degree = {str(nid): 0 for nid in self.nodes}
        for edge in self.edges:
            src = str(edge.get("source") or edge.get("from"))
            tgt = str(edge.get("target") or edge.get("to"))

            if src not in self.adj: self.adj[src] = []
            self.adj[src].append(tgt)
            self.in_degree[tgt] += 1

    def _get_full_type(self, node: Dict[str, Any]) -> str:
        """Resolves the combined type_preset string for a node."""
        ntype = str(node.get("type", "")).strip()
        preset = str(node.get("preset", "")).strip()
        if preset and preset not in ntype:
            return f"{ntype}_{preset}"
        return ntype

    def setup(self):
        """Lifecycle hook called by Runner before batch execution to share browser context."""
        try:
            from playwright.sync_api import sync_playwright
            self._p = sync_playwright().start()
            self._browser = self._p.chromium.launch(headless=True)
            self._page = self._browser.new_page()
            self._page.on('dialog', lambda dialog: dialog.accept())
        except Exception as e:
            print(f"[BuilderEngine] Playwright setup failed: {e}")

    def teardown(self):
        """Lifecycle hook called by Runner after batch execution."""
        if hasattr(self, '_browser'):
            try: self._browser.close()
            except: pass
        if hasattr(self, '_p'):
            try: self._p.stop()
            except: pass

    def execute(self, runtime_inputs: Dict[str, Any], stop_event: Optional[threading.Event] = None) -> List[Dict[str, Any]]:
        """Main entry point for execution."""
        queue = [nid for nid, deg in self.in_degree.items() if deg == 0]

        combined_results = []
        debug_artifacts = []
        processed_nodes = set()
        self.execution_statuses = {} # Track success/failed/skipped for each node

        while queue:
            if stop_event and stop_event.is_set():
                print("[BuilderEngine] 🛑 Execution cancelled by stop signal.")
                break

            current_id = queue.pop(0)
            node = self.nodes[current_id]
            node_inputs = self._get_node_inputs(current_id)
            
            # --- 1. Trigger Guard (Skip Check) ---
            # EXCLUSION: 'input' and 'sink' nodes never have a trigger guard.
            skip_node = False
            if node.get("type") not in ["input", "sink"] and "trigger" in node_inputs:
                t_vals = node_inputs.get("trigger")
                if not isinstance(t_vals, list):
                    t_vals = [t_vals]
                
                # Logic: Skip if NO signals are satisfied (None) 
                # OR if ANY signal specifically received a False/Error that should abort this path.
                # However, many users use Trigger as an OR gate. 
                # But here, we follow the user's specific request: "skip if error or false".
                for t in t_vals:
                    if t is None or t is False or (isinstance(t, dict) and "__error__" in t):
                        skip_node = True
                        break
                
                if skip_node:
                    print(f"[BuilderEngine] ⏩ Skipping node {current_id} ({node['type']}) - Trigger Guard active.")

            # --- 2. Node Execution ---
            status = "success"
            res = None
            
            if not skip_node:
                try:
                    res = self._execute_node(node, runtime_inputs)
                    
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
                    # Resolve handle from source perspective
                    handle = edge.get("sourceHandle")
                    if not handle and "fromIdx" in edge:
                        handle = self._map_port_to_handle(current_id, edge["fromIdx"])
                    
                    if not handle: handle = "data"
                    
                    if status == "success":
                        # Success: follow standard (non-error) paths
                        if handle != "error": should_trigger_neighbor = True
                    elif status == "failed":
                        # Failure: ONLY follow 'error' path
                        if handle == "error": should_trigger_neighbor = True
                    elif status == "skipped":
                        # Skipped nodes usually don't trigger anything unless we want to propagate failure?
                        # User: "if it receives error/null, it should not execute". 
                        # We stay silent on the success path, but maybe allow error path to propagate skip?
                        # For now, let's keep it simple: skip means total silence for this node's children.
                        pass
                
                if should_trigger_neighbor:
                    self.in_degree[neighbor] -= 1
                    if self.in_degree[neighbor] == 0:
                        queue.append(neighbor)
                else:
                    print(f"[BuilderEngine] ⎇ Skipping path {current_id} -> {neighbor} (status={status})")

            processed_nodes.add(current_id)

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
        final_results = []
        for i in range(max_len):
            row = {}
            for k, col in columns.items():
                if i < len(col):
                    row[k] = col[i]
                else:
                    row[k] = None
            final_results.append(row)

        print(f"[BuilderEngine] Flow Finished. Extracted {len(final_results)} items. Captured {len(debug_artifacts)} debug points.")
        return {
            "main": final_results,
            "debug": debug_artifacts
        }

    def _execute_node(self, node: Dict[str, Any], runtime_inputs: Dict[str, Any]) -> Any:
        ntype = str(node.get("type", "")).strip()
        preset = str(node.get("preset", "")).strip()
        if preset and preset not in ntype:
            ntype = f"{ntype}_{preset}"

        data = node.get("config") or node.get("data", {})

        print(f"[BuilderEngine] Executing {node['id']} (Resolved Type: '{ntype}')")

        node_inputs = self._get_node_inputs(node["id"])

        # ── Inputs ──────────────────────────────────────────────────────
        if ntype == "input_external":
            name = data.get("name")
            val = runtime_inputs.get(name, data.get("default"))
            dtype = data.get("dataType", "string")

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
            expr = (data.get("value") or data.get("expression", "")).strip()
            context = self._get_execution_context(node_inputs)
            print(f"[BuilderEngine] Resolving expression: '{expr}' | context keys: {list(context.keys())}")
            res = resolve_expressions(expr, context, custom_funcs=self.custom_funcs)
            if isinstance(res, str) and res.startswith("[Error: "):
                raise ValueError(f"Expression evaluation failed: {res[8:-1]}")
            return res

        # ── Sources & Actions ────────────────────────────────────────────
        elif ntype in ["action_fetch_url", "source_fetch_url", "source_fetch_html"]:
            url = data.get("url") or node_inputs.get("url")
            if not url:
                print("[BuilderEngine] Warning: Fetcher node has no URL input! Skipping.")
                return None

            url = resolve_expressions(url, self._get_execution_context(node_inputs)).strip()
            print(f"[BuilderEngine] Fetcher resolved URL: {url}")

            headers_raw = data.get("headers") or {}
            headers = {}
            if isinstance(headers_raw, str):
                try:
                    headers = json.loads(headers_raw.strip() or "{}")
                except:
                    try:
                        import ast
                        headers = ast.literal_eval(headers_raw.strip() or "{}")
                    except:
                        print(f"[BuilderEngine] Warning: Failed to parse headers: {headers_raw}")
            else:
                headers = headers_raw

            resp = requests.get(url, headers=headers, timeout=30)
            resp.raise_for_status()
            return resp.text

        elif ntype in ["action_fetch_playwright", "source_fetch_playwright"]:
            url = data.get("url") or node_inputs.get("url")
            if not url: return None

            url = resolve_expressions(url, self._get_execution_context(node_inputs))
            headless = data.get("headless", True)
            cdp_url = data.get("cdp_url")

            actions = data.get("actions", [])
            auto_dismiss = data.get("auto_dismiss", [])
            wait_sel = data.get("wait_for_selector") or data.get("wait_for")
            if not actions and wait_sel:
                actions = [{"type": "wait_for_selector", "value": wait_sel}]

            def _run_playwright_logic(page):
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

                if url.strip().startswith("<"):
                    page.set_content(url)
                else:
                    page.goto(url, wait_until="domcontentloaded", timeout=60000)

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
                            # Use browser-side fetch to extract high-res original (bypasses CORS)
                            if not aval:
                                raise Exception("fetch_image requires a selector to find the image src.")
                            
                            src = page.locator(aval).first.get_attribute("src")
                            if not src:
                                raise Exception(f"No src found for image selector: {aval}")
                            
                            if not src.startswith("http") and not src.startswith("data:"):
                                from urllib.parse import urljoin
                                src = urljoin(page.url, src)

                            # Execute fetch in browser context to get original bytes/quality
                            data_url = page.evaluate("""
                                async (url) => {
                                    const response = await fetch(url);
                                    if (!response.ok) throw new Error(`HTTP ${response.status} failed to fetch ${url}`);
                                    const blob = await response.blob();
                                    return new Promise((resolve, reject) => {
                                        const reader = new FileReader();
                                        reader.onloadend = () => resolve(reader.result);
                                        reader.onerror = reject;
                                        reader.readAsDataURL(blob);
                                    });
                                }
                            """, src)
                            return data_url
                    except Exception as e:
                        print(f"[BuilderEngine] Playwright Action Failed ({atype}): {e}")

                return page.content()

            if hasattr(self, '_page'):
                print("[BuilderEngine] Reusing shared Playwright session.")
                return _run_playwright_logic(self._page)
            else:
                with sync_playwright() as p:
                    if cdp_url:
                        browser = p.chromium.connect_over_cdp(cdp_url)
                    else:
                        browser = p.chromium.launch(headless=headless)

                    page = browser.new_page()
                    page.on('dialog', lambda dialog: dialog.accept())
                    return _run_playwright_logic(page)

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
                    return [_extract_val(r) for r in results]
                else:
                    result = soup.select_one(selector)
                    if not result:
                        return None
                    return _extract_val(result)

            if isinstance(html_input, list):
                mapped = [_process_html(h) for h in html_input]
                if mode == "all":
                    return [item for sublist in mapped if sublist for item in sublist]
                return mapped
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
                return [_extract(t) for t in text_input]
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
                return [_transform(t) for t in text_input]
            return _transform(text_input)

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
                return [_convert(v) for v in val_input]
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
            return results

        elif ntype in ["logic_splitter", "utility_splitter"]:
            # Returns its only input; the engine handles duplication to multiple neighbors
            return node_inputs.get("data") or node_inputs.get("input_0") or next(iter(node_inputs.values()), None)

        elif ntype in ["logic_combiner", "utility_combiner"]:
            mode = data.get("mode", "list")
            # Sort inputs by their numeric handle index (input_0, input_1, etc.)
            sorted_keys = sorted(node_inputs.keys(), key=lambda k: int(k.split('_')[1]) if '_' in k and k.split('_')[1].isdigit() else 0)
            input_list = [node_inputs[k] for k in sorted_keys]

            if mode == "flatten":
                result = []
                for item in input_list:
                    if isinstance(item, list): result.extend(item)
                    else: result.append(item)
                return result
            elif mode == "merge_object":
                result = {}
                for item in input_list:
                    if isinstance(item, dict): result.update(item)
                return result
            
            return input_list # Default: list

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
                # Numeric or string comparison between input A and compare_value
                raw_a = str(a).strip() if a is not None else ""
                raw_b = str(compare_val).strip()
                # Try numeric
                try:
                    av = float(raw_a.replace(",", ""))
                    bv = float(raw_b.replace(",", ""))
                    numeric = True
                except ValueError:
                    av, bv = raw_a, raw_b
                    numeric = False

                if operation == "eq":
                    return av == bv
                elif operation == "neq":
                    return av != bv
                elif operation == "gt":
                    return av > bv
                elif operation == "gte":
                    return av >= bv
                elif operation == "lt":
                    return av < bv
                elif operation == "lte":
                    return av <= bv
                elif operation == "between":
                    # compare_value format: "10,20"
                    try:
                        parts = [float(x.strip()) for x in raw_b.split(",")]
                        return parts[0] <= float(raw_a.replace(",", "")) <= parts[1]
                    except: return False

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

            # Handle namespaced keys (e.g. auth.token)
            actual_key = var_key.split('.')[-1] if '.' in var_key else var_key

            value = node_inputs.get("value")
            if self.db and actual_key:
                var = self.db.query(GlobalVariable).filter(GlobalVariable.key == actual_key).first()
                if var and not var.is_readonly:
                    var.value = str(value)
                    self.db.commit()
            return value

        elif ntype == "sink_system_output":
            sink_data = node_inputs.get("data") or node_inputs.get("error") or next(iter(node_inputs.values()), None)
            import types
            if isinstance(sink_data, types.GeneratorType):
                sink_data = list(sink_data)

            label = str(node.get("config", {}).get("label") or "Results")

            # 🛠️ ERROR FORMATTING: If we received an internal error object, format it using the node's label
            if isinstance(sink_data, dict) and "__error__" in sink_data:
                return {label: sink_data["__error__"]}

            if isinstance(sink_data, list):
                return [(d if isinstance(d, dict) else {label: str(d)}) for d in sink_data]
            elif isinstance(sink_data, str) or not isinstance(sink_data, dict):
                return {label: sink_data}
            return sink_data

        elif ntype == "sink_debug":
            val = node_inputs.get("data") or node_inputs.get("error") or next(iter(node_inputs.values()), None)
            print(f"[BuilderEngine] DEBUG [{node['id']}]: {val}")
            return val

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

                handle = edge.get("targetHandle")
                if not handle and "toIdx" in edge:
                    handle = self._map_port_to_handle(node_id, edge["toIdx"])

                if not handle:
                    handle = "data"
                
                # Multi-edge support: Collect results into a list if multiple nodes connect to the same port
                if handle in inputs:
                    if not isinstance(inputs[handle], list):
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

        # Organize Global Registry into Namespaces
        namespaces = {}
        ns_metadata = self.global_vars.get("__namespaces__", {})
        
        for k, v in self.global_vars.items():
            if k == "__namespaces__": continue
            ns = ns_metadata.get(k)
            if ns:
                if ns not in namespaces: namespaces[ns] = {}
                namespaces[ns][k] = v

        context = {
            "vars": self.global_vars,
            "v": self.global_vars,
            "namespaces": namespaces,
            "ns": namespaces,
            "inputs": node_inputs,
            "nodes": nodes_context,
            # Fallback for backward compatibility
            **self.global_vars,
            **node_inputs
        }
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

        if ntype in ["action_fetch_url", "source_fetch_url", "action_fetch_playwright", "source_fetch_playwright", "source_fetch_html"]:
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

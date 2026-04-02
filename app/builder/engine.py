import json
import concurrent.futures
import threading
from typing import Dict, Any, List, Optional
import requests
from playwright.sync_api import sync_playwright
import re
from bs4 import BeautifulSoup
from app.expressions import resolve_expressions
from app.models import GlobalVariable

class BuilderEngine:
    """
    Executes a visual builder flow (DAG).
    Handles node caching, parallel branching, and multiple output merging.
    """

    def __init__(self, flow_data: Dict[str, Any], global_vars: Dict[str, Any], db_session=None, custom_funcs: Dict[str, str] = None):
        self.nodes = {n["id"]: n for n in flow_data.get("nodes", [])}
        self.edges = flow_data.get("edges", [])
        self.global_vars = global_vars
        self.db = db_session
        self.custom_funcs = custom_funcs or {}        
        # Internal cache for node results to prevent redundant execution
        self.results_cache: Dict[str, Any] = {}
        
        # Adjacency list for DAG traversal
        self.adj = {}
        self.in_degree = {nid: 0 for nid in self.nodes}
        for edge in self.edges:
            # Handle both terminology: (Reat Flow: source/target) and (Custom: from/to)
            src = edge.get("source") or edge.get("from")
            tgt = edge.get("target") or edge.get("to")
            
            if src not in self.adj: self.adj[src] = []
            self.adj[src].append(tgt)
            self.in_degree[tgt] += 1
            
    def setup(self):
        """Lifecycle hook called by Runner before batch execution to share browser context."""
        try:
            from playwright.sync_api import sync_playwright
            self._p = sync_playwright().start()
            self._browser = self._p.chromium.launch(headless=True)
            self._page = self._browser.new_page()
            self._page.on('dialog', lambda dialog: dialog.accept()) # Auto-accept alerts
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
        """
        Main entry point for execution.
        """
        # 1. Resolve initial "Expression" nodes that don't depend on others
        # (Though technically the topological sort will handle this)
        
        # 2. Topological Sort / Execution
        queue = [nid for nid, deg in self.in_degree.items() if deg == 0]
        
        # We store final results from all 'sink_system_output' nodes here
        combined_results = []
        debug_artifacts = []

        # Using a ThreadPoolExecutor for parallel-ready branches (specifically I/O nodes)
        # Note: Playwright sync_api is thread-safe if initialized per-thread, 
        # but for simplicity in this first version, we'll run nodes sequentially 
        # while respecting the DAG.
        
        # Simple sequential execution respecting dependencies
        processed_nodes = set()
        debug_artifacts = []
        
        while queue:
            # Check for cancellation signal
            if stop_event and stop_event.is_set():
                print("[BuilderEngine] 🛑 Execution cancelled by stop signal.")
                break

            current_id = queue.pop(0)
            node = self.nodes[current_id]
            
            # Execute node logic
            try:
                res = self._execute_node(node, runtime_inputs)
                self.results_cache[current_id] = res
                print(f"[BuilderEngine] Ran node {current_id} ({node['type']}) -> result type: {type(res).__name__}")
                
                # Normalize ntype to match _execute_node logic
                nt_raw = str(node.get("type", "")).strip()
                pr_raw = str(node.get("preset", "")).strip()
                nt = f"{nt_raw}_{pr_raw}" if pr_raw and pr_raw not in nt_raw else nt_raw

                if nt == "sink_debug":
                    debug_artifacts.append({
                        "node_id": current_id,
                        "label": node.get("config", {}).get("label", "Debug"),
                        "data": res
                    })

            except Exception as e:
                print(f"[BuilderEngine] Error in node {current_id} ({node['type']}): {e}")
                # Optional: allow flow to continue if node is not critical?
                # For now, we propagate or log.
                raise

            # Update neighbors
            for neighbor in self.adj.get(current_id, []):
                self.in_degree[neighbor] -= 1
                if self.in_degree[neighbor] == 0:
                    queue.append(neighbor)
            
            processed_nodes.add(current_id)

        # Store debug artifacts in a special key if they exist
        # We can pass this back to the runner later
        # 4. Aggregation
        main_outputs = []
        for n_id, node in self.nodes.items():
            nt_raw = str(node.get("type", "")).strip()
            pr_raw = str(node.get("preset", "")).strip()
            nt = f"{nt_raw}_{pr_raw}" if pr_raw and pr_raw not in nt_raw else nt_raw
            if nt == "sink_system_output":
                res = self.results_cache.get(n_id)
                if res: main_outputs.append(res)
        
        columns = {}
        for res in main_outputs:
            if isinstance(res, list):
                for item in res:
                    if isinstance(item, dict):
                        for k, v in item.items(): columns.setdefault(k, []).append(v)
            elif isinstance(res, dict):
                for k, v in res.items(): columns.setdefault(k, []).append(v)
        
        merged = []
        if columns:
            max_len = max(len(col) for col in columns.values())
            for i in range(max_len):
                row = {}
                for k, col in columns.items():
                    if len(col) == 1: row[k] = col[0]
                    elif i < len(col): row[k] = col[i]
                    else: row[k] = None
                merged.append(row)

        print(f"[BuilderEngine] Flow Finished. Extracted {len(merged)} items. Captured {len(debug_artifacts)} debug points.")
        return {
            "main": merged,
            "debug": debug_artifacts
        }

    def _execute_node(self, node: Dict[str, Any], runtime_inputs: Dict[str, Any]) -> Any:
        ntype = str(node.get("type", "")).strip()
        preset = str(node.get("preset", "")).strip()
        if preset and preset not in ntype:
            ntype = f"{ntype}_{preset}"
            
        # The frontend saves settings in 'config', but some standards use 'data'
        data = node.get("config") or node.get("data", {})
        
        print(f"[BuilderEngine] Executing {node['id']} (Resolved Type: '{ntype}')")
        
        # Helper to get inputs from connected nodes
        node_inputs = self._get_node_inputs(node["id"])

        if ntype == "input_external":
            # Direct runtime kwarg
            name = data.get("name")
            return runtime_inputs.get(name, data.get("default"))

        elif ntype == "input_expression":
            # The frontend saves this as "value", previously it was "expression"
            expr = (data.get("value") or data.get("expression", "")).strip()
            
            # Merge global vars with results from parent nodes for expansion
            context = {**self.global_vars, **node_inputs}

            print(f"[BuilderEngine] Resolving expression: '{expr}'")
            return resolve_expressions(expr, context, custom_funcs=self.custom_funcs)

        elif ntype == "action_fetch_url":
            url = data.get("url") or node_inputs.get("url")
            if not url: 
                print("[BuilderEngine] Warning: Fetcher node has no URL input! Skipping.")
                return None
            
            # Resolve if it contains expressions
            url = resolve_expressions(url, {**self.global_vars, **node_inputs}).strip()
            print(f"[BuilderEngine] Fetcher resolved URL: {url}")
            
            headers_raw = data.get("headers") or {}
            headers = {}
            if isinstance(headers_raw, str):
                try:
                    import json
                    headers = json.loads(headers_raw.strip() or "{}")
                except:
                    try:
                        import ast
                        # Support Python dict literal copy-paste (e.g. from user context)
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
            
            url = resolve_expressions(url, {**self.global_vars, **node_inputs})
            headless = data.get("headless", True)
            cdp_url = data.get("cdp_url") # For scaling/parallel grid
            
            actions = data.get("actions", [])
            auto_dismiss = data.get("auto_dismiss", [])
                      # Legacy fallback
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

                page.goto(url, wait_until="domcontentloaded", timeout=60000)
                
                # Execute actions
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

        elif ntype == "action_bs4_select":
            html_input = data.get("html") or node_inputs.get("html")
            if not html_input:
                print("[BuilderEngine] Warning: BS4 node has no HTML input! Skipping.")
                return None
            
            selector = data.get("selector")
            mode = data.get("mode", "first") # "first" or "all"
            out_type = data.get("output_type", "html") # "html", "text", or "attr"
            attr_name = data.get("attribute") # Optional: "src", "href", "data-num", etc.
            limit = data.get("limit") # Optional: limit result count
            
            if not selector:
                print("[BuilderEngine] Warning: BS4 node has no selector! Returning raw HTML.")
                return html_input
                
            print(f"[BuilderEngine] BS4 Selector: {selector} (Mode: {mode}, Output: {out_type})")
            
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
                    # Flatten list of lists
                    return [item for sublist in mapped if sublist for item in sublist]
                return mapped
            else:
                return _process_html(html_input)

        elif ntype == "action_regex_extract":
            text_input = node_inputs.get("text") or node_inputs.get("data") or ""
            pattern = data.get("pattern", "")
            group_idx = int(data.get("group", 0))
            
            if not pattern: return text_input
            
            def _extract(txt):
                match = re.search(pattern, str(txt), re.I | re.S)
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
            op = data.get("operation", "none") # "prefix", "replace", "trim"
            val = data.get("value", "")
            repl = data.get("replacement", "")
            
            def _transform(txt):
                t = str(txt or "")
                if op == "prefix":
                    return f"{val}{t}"
                elif op == "suffix":
                    return f"{t}{val}"
                elif op == "replace":
                    return t.replace(val, repl)
                elif op == "trim":
                    return t.strip()
                return t
                
            if isinstance(text_input, list):
                return [_transform(t) for t in text_input]
            return _transform(text_input)

        elif ntype == "action_type_convert":
            val_input = node_inputs.get("value") or node_inputs.get("data")
            to_type = data.get("to_type", "string") # "int", "float", "json"
            
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
            # If the input is already a fragment/tag, we find children
            # select() with recursive=False isn't a direct BS4 method, 
            # we use find_all(recursive=False)
            children = soup.find_all(recursive=False)
            results = []
            for child in children:
                # Basic selector match if provided
                if selector == "*" or child.select_one(selector) or child.name == selector:
                    results.append(str(child))
            return results

        elif ntype == "sink_context":
            var_key = data.get("variable_key", "")
            # Sanitize: Strip {{ }} if present (frontend Pick appends them)
            if isinstance(var_key, str) and var_key.startswith("{{") and var_key.endswith("}}"):
                var_key = var_key[2:-2].strip()

            # Only update if we have a DB session and variable is not readonly
            value = node_inputs.get("value")
            if self.db and var_key:
                var = self.db.query(GlobalVariable).filter(GlobalVariable.key == var_key).first()
                if var and not var.is_readonly:
                    var.value = str(value)
                    self.db.commit()
            return value

        elif ntype == "sink_system_output":
            # Pass through but wrap in dictionary if raw
            data = node_inputs.get("data")
            import types
            if isinstance(data, types.GeneratorType):
                data = list(data)
                
            label = data.get("label") if isinstance(data, dict) else (data.get("internalLabel") if isinstance(data, dict) else None)
            # Fallback to config label
            if not label:
                label = data.get("label") if isinstance(data, dict) else str(node.get("config", {}).get("label") or "result")
            
            if isinstance(data, list):
                # Ensure every item in the list is a dict (standard scraper format)
                return [ (d if isinstance(d, dict) else {label: str(d)}) for d in data ]
            elif isinstance(data, str) or not isinstance(data, dict):
                return {label: data}
            return data

        elif ntype == "sink_debug":
            # Simply pass through its input
            val = node_inputs.get("data")
            print(f"[BuilderEngine] DEBUG [{node['id']}]: {val}")
            return val

        return None

    def _get_node_inputs(self, node_id: str) -> Dict[str, Any]:
        """
        Collects outputs from all nodes that flow INTO this node.
        """
        inputs = {}
        for edge in self.edges:
            target_id = edge.get("target") or edge.get("to")
            if target_id == node_id:
                src_id = edge.get("source") or edge.get("from")
                src_output = self.results_cache.get(src_id)
                
                # If the target handle has a name, we use it as a key
                # Otherwise, use the port index (toIdx) and map it based on node type
                handle = edge.get("targetHandle")
                if not handle and "toIdx" in edge:
                    handle = self._map_port_to_handle(node_id, edge["toIdx"])
                
                if not handle:
                    handle = "data" # Final fallback
                    
                print(f"[BuilderEngine] Found edge: {src_id} -> {node_id} (Mapped to handle '{handle}')")
                inputs[handle] = src_output
        return inputs

    def _map_port_to_handle(self, node_id: str, port_idx: int) -> str:
        """
        Maps a numeric port index to a descriptive handle name based on node type.
        """
        node = self.nodes.get(node_id)
        if not node: return "data"
        ntype = node.get("type", "")
        preset = node.get("preset", "")
        if preset:
            ntype = f"{ntype}_{preset}"
        
        # Mapping logic based on presets
        if ntype in ["action_fetch_url", "action_fetch_playwright", "source_fetch_playwright", "source_fetch_html"]:
            return "url" if port_idx == 0 else "data"
            
        if ntype in ["action_bs4_select", "action_html_children"]:
            return "html" if port_idx == 0 else "data"
        
        if ntype in ["action_regex_extract", "action_text_transform"]:
            return "text" if port_idx == 0 else "data"
            
        if ntype in ["action_type_convert", "sink_context"]:
            return "value" if port_idx == 0 else "data"
            
        if ntype in ["sink_system_output", "sink_debug"]:
            return "data"
            
        return f"input_{port_idx}"

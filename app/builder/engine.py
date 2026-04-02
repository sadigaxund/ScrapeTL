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
            src = edge.get("source") or edge.get("from")
            tgt = edge.get("target") or edge.get("to")

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

        while queue:
            if stop_event and stop_event.is_set():
                print("[BuilderEngine] 🛑 Execution cancelled by stop signal.")
                break

            current_id = queue.pop(0)
            node = self.nodes[current_id]

            try:
                res = self._execute_node(node, runtime_inputs)
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
                print(f"[BuilderEngine] Error in node {current_id} ({node['type']}): {e}")
                raise

            # Update neighbors — with conditional branch-aware skipping
            for neighbor in self.adj.get(current_id, []):
                node_type = self._get_full_type(node)

                if node_type == "logic_conditional":
                    # Find the specific edge(s) from current to this neighbor
                    matching_edges = [
                        e for e in self.edges
                        if (e.get("source") or e.get("from")) == current_id
                        and (e.get("target") or e.get("to")) == neighbor
                    ]
                    cond_result = bool(self.results_cache.get(current_id, False))
                    skip = False
                    for edge in matching_edges:
                        handle = edge.get("sourceHandle", "true")
                        if handle == "true" and not cond_result:
                            skip = True
                        elif handle == "false" and cond_result:
                            skip = True
                    if skip:
                        # Don't decrement in_degree — downstream node stays blocked
                        print(f"[BuilderEngine] ⎇ Skipping node {neighbor} (branch={handle}, result={cond_result})")
                        continue

                self.in_degree[neighbor] -= 1
                if self.in_degree[neighbor] == 0:
                    queue.append(neighbor)

            processed_nodes.add(current_id)

        # Aggregation
        main_outputs = []
        for n_id, node in self.nodes.items():
            nt = self._get_full_type(node)
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

        data = node.get("config") or node.get("data", {})

        print(f"[BuilderEngine] Executing {node['id']} (Resolved Type: '{ntype}')")

        node_inputs = self._get_node_inputs(node["id"])

        # ── Inputs ──────────────────────────────────────────────────────
        if ntype == "input_external":
            name = data.get("name")
            return runtime_inputs.get(name, data.get("default"))

        elif ntype == "input_expression":
            expr = (data.get("value") or data.get("expression", "")).strip()
            context = {**self.global_vars, **node_inputs}
            print(f"[BuilderEngine] Resolving expression: '{expr}'")
            return resolve_expressions(expr, context, custom_funcs=self.custom_funcs)

        # ── Sources ──────────────────────────────────────────────────────
        elif ntype == "action_fetch_url":
            url = data.get("url") or node_inputs.get("url")
            if not url:
                print("[BuilderEngine] Warning: Fetcher node has no URL input! Skipping.")
                return None

            url = resolve_expressions(url, {**self.global_vars, **node_inputs}).strip()
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

            url = resolve_expressions(url, {**self.global_vars, **node_inputs})
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
            op = data.get("operation", "none")
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

        # ── Conditional Logic ─────────────────────────────────────────────
        elif ntype == "logic_conditional":
            mode = data.get("mode", "logical")
            operation = data.get("operation", "AND")

            # Collect all connected inputs
            input_vals = list(node_inputs.values())
            a = input_vals[0] if len(input_vals) > 0 else None
            b = input_vals[1] if len(input_vals) > 1 else None

            compare_val = data.get("compare_value", "")

            def _is_truthy(v):
                """Consistent truth evaluation: None, '', 0, False, [], {} all falsy."""
                if v is None: return False
                if isinstance(v, bool): return v
                if isinstance(v, (int, float)): return v != 0
                if isinstance(v, str): return v.strip() not in ("", "false", "0", "null", "none")
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
                    context = {**self.global_vars, **node_inputs}
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

            value = node_inputs.get("value")
            if self.db and var_key:
                var = self.db.query(GlobalVariable).filter(GlobalVariable.key == var_key).first()
                if var and not var.is_readonly:
                    var.value = str(value)
                    self.db.commit()
            return value

        elif ntype == "sink_system_output":
            sink_data = node_inputs.get("data")
            import types
            if isinstance(sink_data, types.GeneratorType):
                sink_data = list(sink_data)

            label = None
            if isinstance(sink_data, dict):
                label = sink_data.get("label") or sink_data.get("internalLabel")
            if not label:
                label = str(node.get("config", {}).get("label") or "result")

            if isinstance(sink_data, list):
                return [(d if isinstance(d, dict) else {label: str(d)}) for d in sink_data]
            elif isinstance(sink_data, str) or not isinstance(sink_data, dict):
                return {label: sink_data}
            return sink_data

        elif ntype == "sink_debug":
            val = node_inputs.get("data")
            print(f"[BuilderEngine] DEBUG [{node['id']}]: {val}")
            return val

        return None

    def _get_node_inputs(self, node_id: str) -> Dict[str, Any]:
        """Collects outputs from all nodes that flow INTO this node."""
        inputs = {}
        for edge in self.edges:
            target_id = edge.get("target") or edge.get("to")
            if target_id == node_id:
                src_id = edge.get("source") or edge.get("from")
                src_output = self.results_cache.get(src_id)

                handle = edge.get("targetHandle")
                if not handle and "toIdx" in edge:
                    handle = self._map_port_to_handle(node_id, edge["toIdx"])

                if not handle:
                    handle = "data"

                print(f"[BuilderEngine] Found edge: {src_id} -> {node_id} (Mapped to handle '{handle}')")
                inputs[handle] = src_output
        return inputs

    def _map_port_to_handle(self, node_id: str, port_idx: int) -> str:
        """Maps a numeric port index to a descriptive handle name based on node type."""
        node = self.nodes.get(node_id)
        if not node: return "data"
        ntype = node.get("type", "")
        preset = node.get("preset", "")
        if preset:
            ntype = f"{ntype}_{preset}"

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

        # Conditional: inputs are labeled by index
        if ntype == "logic_conditional":
            return f"input_{port_idx}"

        return f"input_{port_idx}"

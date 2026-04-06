import re
import os
import json
from datetime import datetime, timedelta

import inspect
from app.models import UserFunction

def _detect_func_name(code):
    """Extracts the first 'def name(' identifier from a code block."""
    if not code: return None
    match = re.search(r"def\s+([a-zA-Z0-9_]+)\s*\(", code)
    return match.group(1) if match else None

def _wrap_with_type_casting(func):
    """Wraps a function to automatically cast arguments based on its type hints."""
    if not callable(func): return func
    sig = inspect.signature(func)
    
    import functools
    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        bound = sig.bind(*args, **kwargs)
        bound.apply_defaults()
        for name, value in bound.arguments.items():
            param = sig.parameters[name]
            if param.annotation is not inspect._empty:
                # Try to cast value to the annotated type
                try:
                    target_type = param.annotation
                    if target_type in (int, float):
                        # Force numeric casting for strings
                        if isinstance(value, str):
                            v = re.sub(r"[^\d\.-]", "", value)
                            bound.arguments[name] = target_type(v) if v else 0
                        else:
                            bound.arguments[name] = target_type(value)
                    elif target_type is bool:
                        if isinstance(value, str):
                            bound.arguments[name] = value.lower().strip() not in ("0", "false", "", "null")
                        else:
                            bound.arguments[name] = bool(value)
                except:
                    # Fallback to 0 for numeric types if casting fails
                    if param.annotation in (int, float):
                        bound.arguments[name] = 0
        return func(*bound.args, **bound.kwargs)
    return wrapper

class ObjectDict(dict):
    """A dictionary that also supports dot-access for expressions."""
    def __getattr__(self, name):
        try: return self[name]
        except KeyError: raise AttributeError(f"'ObjectDict' object has no attribute '{name}'")
    def __setattr__(self, name, value):
        self[name] = value

def to_dot_accessible(obj):
    if isinstance(obj, dict):
        return ObjectDict({str(k): to_dot_accessible(v) for k, v in obj.items()})
    elif isinstance(obj, list):
        return [to_dot_accessible(x) for x in obj]
    return obj

def resolve_expressions(payload, context_vars, custom_funcs=None):
    """
    Resolves {{expression}} patterns in a string or nested JSON object.
    context_vars: dict of static variables from DB.
    custom_funcs: dict of {name: code_string} from DB.
    """
    # 1. Prepare base namespace for evaluation
    import random as py_random
    import uuid as py_uuid

    def py_random_stream(n=10, min_val=0, max_val=100):
        """A built-in generator for random numbers."""
        for _ in range(n):
            yield py_random.randint(min_val, max_val)

    ns = {
        "today": lambda: datetime.now().strftime("%Y-%m-%d"),
        "now": lambda: datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "yesterday": lambda: (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d"),
        "env": lambda key, default="": os.environ.get(key, default),
        "random": lambda min_val=0, max_val=100: py_random.randint(min_val, max_val),
        "random_stream": py_random_stream,
        "range": range,
        "uuid": lambda: str(py_uuid.uuid4()),
        "json": lambda x=None: (json.dumps(x, indent=2) if not isinstance(x, str) else json.loads(x)) if x is not None else "",
        "str": str,
        "int": int,
        "len": lambda x="": len(x),
        "upper": lambda s: str(s).upper(),
        "lower": lambda s: str(s).lower(),
        "strip": lambda s: str(s).strip(),
        "datetime": datetime,
        "timedelta": timedelta,
        "true": True,
        "false": False,
    }
    
    # 2. Process variable registry and namespaces (Dot-Accessible)
    # 2.1 Start with isolated namespaces for priority
    registry_namespaces = context_vars.get("__namespaces__", {})
    for ns_name, ns_dict in registry_namespaces.items():
        ns[ns_name] = to_dot_accessible(ns_dict)

    # 2.2 Inject top-level variables (Merging if namespace exists)
    for k, v in context_vars.items():
        if k == "__namespaces__": continue
        
        # If it's a dict (from a JSON variable)
        if isinstance(v, dict):
            dot_v = to_dot_accessible(v)
            if k in ns and isinstance(ns[k], ObjectDict):
                # MERGE: allow access to both the JSON content and other variables in this namespace
                ns[k].update(dot_v)
            else:
                ns[k] = dot_v
        elif isinstance(v, str):
            # Numeric Casting
            try:
                if '.' in v: ns[k] = float(v)
                else: ns[k] = int(v)
            except: ns[k] = v
        else:
            ns[k] = v

    if custom_funcs:
        for fname, fcode in custom_funcs.items():
            try:
                # Isolated namespace per-UDF prevents cross-contamination
                func_ns = {"__builtins__": __builtins__}
                exec(fcode, func_ns)

                # Extract all callables defined in this code block
                new_funcs = {k: v for k, v in func_ns.items()
                             if callable(v) and not k.startswith("_")}

                # Register them into the main namespace by their def-name
                # and wrap them with automatic type casting
                casted_funcs = {k: _wrap_with_type_casting(v) for k, v in new_funcs.items()}
                ns.update(casted_funcs)

                # Also register under the registry name if it differs
                if fname not in ns and casted_funcs:
                    primary_func = list(casted_funcs.values())[0]
                    ns[fname] = primary_func
                    # print(f"[Expressions] Aliased UDF '{fname}' -> '{list(casted_funcs.keys())[0]}' (with type-casting)")

            except Exception as e:
                print(f"[Expressions] Error compiling UDF '{fname}': {e}")

    return _resolve_recursive(payload, ns)

def _resolve_recursive(payload, ns):
    if isinstance(payload, str):
        return _resolve_string(payload, ns)
    elif isinstance(payload, list):
        return [_resolve_recursive(item, ns) for item in payload]
    elif isinstance(payload, dict):
        return {k: _resolve_recursive(v, ns) for k, v in payload.items()}
    return payload

def _resolve_string(text, ns):
    pattern = r"\{\{\s*(.*?)\s*\}\}"
    
    # Optimization: If the entire string is exactly one expression {{ ... }},
    # return the raw object instead of stringifying it. This preserves Generators/Lists.
    match = re.fullmatch(pattern, text.strip())
    if match:
        expr = match.group(1).strip()
        try:
            return eval(expr, ns)
        except Exception as e:
            if expr in ns: return ns[expr]
            print(f"[Expressions] Direct eval failed for '{expr}': {e}")
            return f"[Error: {str(e)}]"

    def replace(match):
        expr = match.group(1).strip()
        try:
            # Use eval for complex expressions within the populated namespace
            result = eval(expr, ns)
            
            if isinstance(result, (dict, list)):
                return json.dumps(result)
            return str(result)
        except Exception as e:
            # Fallback for simple key matching if eval fails
            if expr in ns:
                val = ns[expr]
                if isinstance(val, (dict, list)):
                    return json.dumps(val)
                return str(val)
            
            # Help user debug by checking for name existence
            suggestion = ""
            if fname_match := re.match(r"([a-zA-Z0-9_]+)\(", expr):
                name = fname_match.group(1)
                if name not in ns:
                    suggestion = f" (Function '{name}' not found in Registry or Built-ins)"
            
            print(f"[Expressions] Eval failed for '{expr}': {e}{suggestion}")
            return f"[Error: {str(e)}]"

    return re.sub(pattern, replace, text)

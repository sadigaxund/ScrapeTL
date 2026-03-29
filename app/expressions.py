import re
import os
import json
from datetime import datetime, timedelta

from app.models import UserFunction

def resolve_expressions(payload, context_vars, custom_funcs=None):
    """
    Resolves {{expression}} patterns in a string or nested JSON object.
    context_vars: dict of static variables from DB.
    custom_funcs: dict of {name: code_string} from DB.
    """
    # 1. Prepare base namespace for evaluation
    import random as py_random
    import uuid as py_uuid

    ns = {
        "today": datetime.now().strftime("%Y-%m-%d"),
        "now": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "yesterday": (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d"),
        "env": lambda key, default="": os.environ.get(key, default),
        "random": lambda min_val, max_val: py_random.randint(min_val, max_val),
        "uuid": lambda: str(py_uuid.uuid4()),
        "json": json.dumps,
        "upper": lambda s: str(s).upper(),
        "lower": lambda s: str(s).lower(),
        "strip": lambda s: str(s).strip(),
        "datetime": datetime,
        "timedelta": timedelta,
    }
    
    # 2. Inject static variables
    ns.update(context_vars)

    # 3. Compile and inject custom UDFs
    if custom_funcs:
        for fname, fcode in custom_funcs.items():
            try:
                exec(fcode, ns)
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
    
    def replace(match):
        expr = match.group(1).strip()
        try:
            # Use eval for complex expressions within the populated namespace
            result = eval(expr, {"__builtins__": {}}, ns)
            
            if isinstance(result, (dict, list)):
                return json.dumps(result)
            return str(result)
        except Exception:
            # Fallback for simple key matching if eval fails
            if expr in ns:
                val = ns[expr]
                if isinstance(val, (dict, list)):
                    return json.dumps(val)
                return str(val)
            return match.group(0)

    return re.sub(pattern, replace, text)

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
            # Fall through to standard substitution if direct eval fails

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
            print(f"[Expressions] Eval failed for '{expr}': {e}")
            return match.group(0)

    return re.sub(pattern, replace, text)

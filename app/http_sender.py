"""
HTTP Request Integration Sender.

New config shape:
  url:            str
  method:         "POST" | "PUT" | "PATCH" | "GET"
  dispatch_mode:  "all_at_once" | "per_element"
  send_as_file:   bool  — when true, sends multipart/form-data with a .json file
  headers:        dict  — extra HTTP headers
  retry_max:      int
  delay_sec:      float
  description:    str
"""
import json
import time
import requests
from typing import Any


def _send_with_retry(
    method: str,
    url: str,
    headers: dict,
    body: Any = None,
    files=None,
    data=None,
    max_retries: int = 3,
    delay_sec: float = 1.0,
) -> dict:
    for attempt in range(1, max_retries + 1):
        try:
            req_kwargs: dict = {"url": url, "headers": headers, "timeout": 20}
            if files:
                # multipart — don't pass Content-Type (requests sets boundary automatically)
                h = {k: v for k, v in headers.items() if k.lower() != "content-type"}
                req_kwargs["headers"] = h
                req_kwargs["files"] = files
                if data:
                    req_kwargs["data"] = data
            elif body is not None and method.upper() != "GET":
                req_kwargs["json"] = body

            resp = requests.request(method.upper(), **req_kwargs)
            if resp.status_code == 429:
                wait = float(resp.headers.get("Retry-After", delay_sec))
                print(f"[HTTP] 429 Rate-limited. Backing off {wait}s (attempt {attempt})")
                time.sleep(wait)
                if attempt == max_retries:
                    return {"success": False, "attempts": attempt, "error": "429 Rate Limit"}
                continue
            resp.raise_for_status()
            return {"success": True, "attempts": attempt, "error": None}
        except Exception as exc:
            if attempt < max_retries:
                time.sleep(delay_sec * attempt)
            else:
                return {"success": False, "attempts": attempt, "error": str(exc)}
    return {"success": False, "attempts": max_retries, "error": "Max retries exceeded"}


def send_http(
    scraper_name: str,
    status: str,
    episodes=None,
    error_msg: str = "",
    triggered_by: str = "scheduler",
    config=None,
):
    if config is None:
        config = {}

    url = config.get("url", "").strip()
    if not url:
        print("[HTTP] No URL configured — skipping.")
        return None

    method = config.get("method", "POST").upper()
    extra_headers = config.get("headers", {}) or {}
    dispatch_mode = config.get("dispatch_mode", config.get("body_mode", "all_at_once"))
    # Normalise legacy body_mode values
    if dispatch_mode in ("json_array", "json_object"):
        dispatch_mode = "all_at_once"
    elif dispatch_mode == "per_element":
        dispatch_mode = "per_element"

    send_as_file = bool(config.get("send_as_file", False))
    max_retries = int(config.get("retry_max", 3))
    delay_sec = float(config.get("delay_sec", 1.0))

    headers: dict = {"Content-Type": "application/json", **extra_headers}
    payload = episodes or []

    meta = {
        "scraper_name": scraper_name,
        "status": status,
        "triggered_by": triggered_by,
        "error_msg": error_msg,
        "count": len(payload),
    }

    results = []

    if send_as_file:
        if dispatch_mode == "per_element":
            for item in payload:
                file_data = json.dumps(item, indent=2).encode("utf-8")
                files = {"file": ("element.json", file_data, "application/json")}
                r = _send_with_retry(method, url, headers, files=files,
                                     data={"meta": json.dumps(meta)},
                                     max_retries=max_retries, delay_sec=delay_sec)
                results.append(r)
                if not r["success"]:
                    break
                time.sleep(delay_sec)
        else:
            file_data = json.dumps(payload, indent=2).encode("utf-8")
            files = {"file": ("data.json", file_data, "application/json")}
            r = _send_with_retry(method, url, headers, files=files,
                                 data={"meta": json.dumps(meta)},
                                 max_retries=max_retries, delay_sec=delay_sec)
            results.append(r)

    elif dispatch_mode == "per_element":
        for item in payload:
            body = {**meta, "item": item}
            r = _send_with_retry(method, url, headers, body=body,
                                 max_retries=max_retries, delay_sec=delay_sec)
            results.append(r)
            if not r["success"]:
                break
            time.sleep(delay_sec)

    else:  # all_at_once
        body = {"meta": meta, "data": payload}
        r = _send_with_retry(method, url, headers, body=body,
                             max_retries=max_retries, delay_sec=delay_sec)
        results.append(r)

    success = all(r["success"] for r in results)
    total_attempts = sum(r["attempts"] for r in results)
    errors = [r["error"] for r in results if r["error"]]
    return {
        "success": success,
        "attempts": total_attempts,
        "error": "; ".join(errors) if errors else None,
    }

"""
App Settings API — read/write key-value app configuration (e.g. timezone).
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import AppSetting
import pytz

router = APIRouter(prefix="/api/settings", tags=["settings"])

# All valid IANA timezone strings pytz knows about (used for validation)
VALID_TIMEZONES = sorted(pytz.all_timezones)


class SettingUpdate(BaseModel):
    value: str


@router.get("")
def get_settings(db: Session = Depends(get_db)):
    rows = db.query(AppSetting).all()
    return {r.key: r.value for r in rows}


@router.get("/timezones")
def list_timezones():
    """Return all valid IANA timezone names with UTC offset formatting."""
    import datetime
    now = datetime.datetime.utcnow()
    res = []
    for tz in VALID_TIMEZONES:
        try:
            z = pytz.timezone(tz)
            offset_delta = z.utcoffset(now)
            if offset_delta is None: continue
            total_mins = int(offset_delta.total_seconds() / 60)
            h = abs(total_mins) // 60
            m = abs(total_mins) % 60
            sign = "+" if total_mins >= 0 else "-"
            res.append({"id": tz, "label": f"(UTC{sign}{h:02d}:{m:02d}) {tz}"})
        except:
            pass
    return res


@router.put("/{key}")
def update_setting(key: str, payload: SettingUpdate, db: Session = Depends(get_db)):
    allowed_keys = {"timezone", "browser_headless", "browser_cdp_url", "log_preview_limit"}
    if key not in allowed_keys:
        raise HTTPException(status_code=400, detail=f"Unknown setting key: {key}")

    if key == "timezone":
        if payload.value not in VALID_TIMEZONES:
            raise HTTPException(status_code=400, detail=f"Invalid timezone: {payload.value}")

    row = db.get(AppSetting, key)
    if row:
        row.value = payload.value
    else:
        db.add(AppSetting(key=key, value=payload.value))
    db.commit()

    # Hot-reload the scheduler timezone so new schedules pick it up immediately
    if key == "timezone":
        from app import scheduler as sched
        sched.reload_timezone(payload.value)

    return {"key": key, "value": payload.value}

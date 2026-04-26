"""
Integrations API - create/list/update/delete integrations and assign them to scrapers.
Currently supports type: "discord_webhook".
"""
import json
import requests
import os
import secrets
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from pydantic import BaseModel
from typing import Optional
from sqlalchemy.orm import Session
from scrapetl.database import get_db
from scrapetl.models import Integration, Scraper

router = APIRouter(tags=["integrations"])


class IntegrationCreate(BaseModel):
    name: str
    type: str          # "discord_webhook"
    config: dict       # type-specific config fields


class IntegrationUpdate(BaseModel):
    name: Optional[str] = None
    config: Optional[dict] = None


def _integ_dict(i: Integration):
    return {
        "id": i.id,
        "name": i.name,
        "type": i.type,
        "config": json.loads(i.config),
        "created_at": i.created_at.isoformat() if i.created_at else None,
    }


# ── Integration CRUD ──────────────────────────────────────────────────────────

@router.get("/api/integrations")
def list_integrations(db: Session = Depends(get_db)):
    return [_integ_dict(i) for i in db.query(Integration).order_by(Integration.position.asc(), Integration.created_at.desc()).all()]


@router.post("/api/integrations")
def create_integration(payload: IntegrationCreate, db: Session = Depends(get_db)):
    supported = {"discord_webhook", "http_request"}
    if payload.type not in supported:
        raise HTTPException(status_code=400, detail=f"Unsupported integration type. Supported: {supported}")
    if payload.type == "discord_webhook" and not payload.config.get("webhook_url"):
        raise HTTPException(status_code=400, detail="discord_webhook requires 'webhook_url' in config.")
    if payload.type == "http_request" and not payload.config.get("url"):
        raise HTTPException(status_code=400, detail="http_request requires 'url' in config.")
    # Determine position
    max_pos = db.query(Integration).order_by(Integration.position.desc()).first()
    new_pos = (max_pos.position + 1) if max_pos else 0

    integ = Integration(
        name=payload.name.strip(),
        type=payload.type,
        config=json.dumps(payload.config),
        position=new_pos
    )
    db.add(integ)
    db.commit()
    db.refresh(integ)
    return _integ_dict(integ)


@router.patch("/api/integrations/{integ_id}")
def update_integration(integ_id: int, payload: IntegrationUpdate, db: Session = Depends(get_db)):
    integ = db.get(Integration, integ_id)
    if not integ:
        raise HTTPException(status_code=404, detail="Integration not found.")
    if payload.name is not None:
        integ.name = payload.name.strip()
    if payload.config is not None:
        integ.config = json.dumps(payload.config)
    db.commit()
    return _integ_dict(integ)


@router.delete("/api/integrations/{integ_id}")
def delete_integration(integ_id: int, db: Session = Depends(get_db)):
    integ = db.get(Integration, integ_id)
    if not integ:
        raise HTTPException(status_code=404, detail="Integration not found.")
    db.delete(integ)
    db.commit()
    return {"detail": "Deleted."}


@router.post("/api/integrations/{integ_id}/thumbnail")
def upload_integration_thumbnail(integ_id: int, file: UploadFile = File(...), db: Session = Depends(get_db)):
    integ = db.get(Integration, integ_id)
    if not integ:
        raise HTTPException(status_code=404, detail="Integration not found.")
        
    ext = file.filename.split(".")[-1].lower()
    thumb_name = f"integ_{integ_id}_{secrets.token_hex(3)}.{ext}"
    
    t_contents = file.file.read()
    integ.thumbnail_data = t_contents

    config = json.loads(integ.config)
    config["thumbnail_url"] = f"/thumbnails/{thumb_name}"
    integ.config = json.dumps(config)
    db.commit()
    return _integ_dict(integ)


@router.post("/api/integrations/{integ_id}/verify")
def verify_integration(integ_id: int, db: Session = Depends(get_db)):
    """Send a test ping to verify the integration config works."""
    integ = db.get(Integration, integ_id)
    if not integ:
        raise HTTPException(status_code=404, detail="Integration not found.")

    config = json.loads(integ.config)

    if integ.type == "discord_webhook":
        webhook_url = config.get("webhook_url", "")
        if not webhook_url:
            raise HTTPException(status_code=400, detail="No webhook_url in config.")
        try:
            resp = requests.post(
                webhook_url,
                json={"content": f"🔔 **ScrapeTL** - Test ping from integration **{integ.name}**. It works!"},
                timeout=10,
            )
            resp.raise_for_status()
            return {"detail": "Test message sent successfully."}
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"Webhook failed: {exc}")

    if integ.type == "http_request":
        url = config.get("url", "").strip()
        if not url:
            raise HTTPException(status_code=400, detail="No URL in config.")
        method = config.get("method", "POST").upper()
        extra_headers = config.get("headers", {}) or {}
        headers = {"Content-Type": "application/json", **extra_headers}
        body = {"meta": {"test": True, "source": "ScrapeTL"}, "data": []}
        try:
            resp = requests.request(method, url, headers=headers, json=body, timeout=10)
            resp.raise_for_status()
            return {"detail": f"Test {method} to {url} succeeded (HTTP {resp.status_code})."}
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"HTTP request failed: {exc}")

    raise HTTPException(status_code=400, detail="Verification not supported for this type.")


# ── Scraper ↔ Integration assignment ─────────────────────────────────────────

@router.post("/api/scrapers/{scraper_id}/integrations/{integ_id}")
def assign_integration(scraper_id: int, integ_id: int, db: Session = Depends(get_db)):
    scraper = db.get(Scraper, scraper_id)
    if not scraper:
        raise HTTPException(status_code=404, detail="Scraper not found.")
    integ = db.get(Integration, integ_id)
    if not integ:
        raise HTTPException(status_code=404, detail="Integration not found.")
    if integ not in scraper.integrations:
        scraper.integrations.append(integ)
        db.commit()
    return {"detail": "Integration assigned."}


@router.delete("/api/scrapers/{scraper_id}/integrations/{integ_id}")
def remove_integration(scraper_id: int, integ_id: int, db: Session = Depends(get_db)):
    scraper = db.get(Scraper, scraper_id)
    if not scraper:
        raise HTTPException(status_code=404, detail="Scraper not found.")
    integ = db.get(Integration, integ_id)
    if not integ:
        raise HTTPException(status_code=404, detail="Integration not found.")
    if integ in scraper.integrations:
        scraper.integrations.remove(integ)
        db.commit()
    return {"detail": "Integration removed."}
@router.post("/api/integrations/reorder")
def reorder_integrations(ids: list[int], db: Session = Depends(get_db)):
    for index, integ_id in enumerate(ids):
        db.query(Integration).filter(Integration.id == integ_id).update({"position": index})
    db.commit()
    return {"detail": "Integrations reordered."}

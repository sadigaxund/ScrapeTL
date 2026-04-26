import os
from typing import Optional, List
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session
from scrapetl.database import get_db
from scrapetl.models import GlobalVariable

router = APIRouter(prefix="/api/variables", tags=["variables"])

class VariableBase(BaseModel):
    key: str
    value: Optional[str] = None
    value_type: str = "string"
    description: Optional[str] = None
    is_secret: bool = False
    is_readonly: bool = True
    doc_md: Optional[str] = None
    namespace: Optional[str] = None

class NamespaceRenameRequest(BaseModel):
    old_namespace: str
    new_namespace: str

class VariableCreate(VariableBase):
    pass

class VariableUpdate(BaseModel):
    key: Optional[str] = None
    value: Optional[str] = None
    value_type: Optional[str] = None
    description: Optional[str] = None
    is_secret: Optional[bool] = None
    is_readonly: Optional[bool] = None
    doc_md: Optional[str] = None
    namespace: Optional[str] = None

class VariableResponse(VariableBase):
    id: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

@router.get("", response_model=List[VariableResponse])
def list_variables(db: Session = Depends(get_db)):
    """List all global variables."""
    return db.query(GlobalVariable).order_by(GlobalVariable.key.asc()).all()

@router.post("", response_model=VariableResponse)
def create_variable(payload: VariableCreate, db: Session = Depends(get_db)):
    """Create a new global variable."""
    # Check if key already exists
    existing = db.query(GlobalVariable).filter(GlobalVariable.key == payload.key).first()
    if existing:
        raise HTTPException(status_code=400, detail=f"Variable with key '{payload.key}' already exists.")
    
    var = GlobalVariable(
        key=payload.key,
        value=payload.value,
        value_type=payload.value_type,
        description=payload.description,
        is_secret=payload.is_secret,
        is_readonly=payload.is_readonly,
        doc_md=payload.doc_md,
        namespace=payload.namespace
    )
    db.add(var)
    db.commit()
    db.refresh(var)
    return var

@router.patch("/{var_id}", response_model=VariableResponse)
def update_variable(var_id: int, payload: VariableUpdate, db: Session = Depends(get_db)):
    """Update an existing variable."""
    var = db.get(GlobalVariable, var_id)
    if not var:
        raise HTTPException(status_code=404, detail="Variable not found.")
    if payload.key is not None and payload.key != var.key:
        # Ensure new key is unique
        existing = db.query(GlobalVariable).filter(GlobalVariable.key == payload.key).first()
        if existing:
            raise HTTPException(status_code=400, detail=f"Variable with key '{payload.key}' already exists.")
        var.key = payload.key

    if payload.value is not None:
        var.value = payload.value
    if payload.value_type is not None:
        var.value_type = payload.value_type
    if payload.description is not None:
        var.description = payload.description
    if payload.is_secret is not None:
        var.is_secret = payload.is_secret
    if payload.is_readonly is not None:
        var.is_readonly = payload.is_readonly
    if payload.doc_md is not None:
        var.doc_md = payload.doc_md
    if payload.namespace is not None:
        var.namespace = payload.namespace
    
    db.commit()
    db.refresh(var)
    return var

@router.delete("/{var_id}")
def delete_variable(var_id: int, db: Session = Depends(get_db)):
    """Delete a global variable."""
    var = db.get(GlobalVariable, var_id)
    if not var:
        raise HTTPException(status_code=404, detail="Variable not found.")
    
    db.delete(var)
    db.commit()
    return {"detail": "Variable deleted."}

@router.patch("/batch/rename-namespace")
def rename_namespace(payload: NamespaceRenameRequest, db: Session = Depends(get_db)):
    """Batch rename a namespace across all variables."""
    # Find all variables with old namespace
    # Treat empty strings and nulls as the same (Shared Registry)
    if not payload.old_namespace:
        vars = db.query(GlobalVariable).filter((GlobalVariable.namespace == None) | (GlobalVariable.namespace == "")).all()
    else:
        vars = db.query(GlobalVariable).filter(GlobalVariable.namespace == payload.old_namespace).all()
    
    if not vars:
        # It's possible there are no variables but the namespace existed virtually in frontend
        return {"detail": f"Renamed 0 variables from '{payload.old_namespace}' to '{payload.new_namespace}'."}
    
    for v in vars:
        v.namespace = payload.new_namespace
        
    db.commit()
    return {"detail": f"Renamed {len(vars)} variables from '{payload.old_namespace}' to '{payload.new_namespace}'."}


@router.get("/builtins/env")
def list_env_variables():
    """List system environment variables (masked). Filtered for custom/docker variables."""
    envs = []
    for key, value in os.environ.items():
        # Do not expose any part of the value in the UI API for security
        envs.append({
            "id": -1, # Virtual ID
            "key": key,
            "value": "(hidden)",
            "value_type": "string",
            "namespace": "env",
            "is_readonly": True,
            "is_secret": True, # Triggers UI masking
            "created_at": datetime.now(),
            "updated_at": datetime.now()
        })
    return sorted(envs, key=lambda x: x["key"])

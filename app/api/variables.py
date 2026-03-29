from typing import Optional, List
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import GlobalVariable

router = APIRouter(prefix="/api/variables", tags=["variables"])

class VariableBase(BaseModel):
    key: str
    value: Optional[str] = None
    value_type: str = "string"
    description: Optional[str] = None
    is_secret: bool = False
    doc_md: Optional[str] = None

class VariableCreate(VariableBase):
    pass

class VariableUpdate(BaseModel):
    value: Optional[str] = None
    value_type: Optional[str] = None
    description: Optional[str] = None
    is_secret: Optional[bool] = None
    doc_md: Optional[str] = None

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
        doc_md=payload.doc_md
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
    
    if payload.value is not None:
        var.value = payload.value
    if payload.value_type is not None:
        var.value_type = payload.value_type
    if payload.description is not None:
        var.description = payload.description
    if payload.is_secret is not None:
        var.is_secret = payload.is_secret
    if payload.doc_md is not None:
        var.doc_md = payload.doc_md
    
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

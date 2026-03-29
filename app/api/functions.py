from typing import Optional, List
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import UserFunction

router = APIRouter(prefix="/api/functions", tags=["functions"])

class FunctionBase(BaseModel):
    name: str
    description: Optional[str] = None
    code: Optional[str] = None
    doc_md: Optional[str] = None

class FunctionCreate(FunctionBase):
    pass

class FunctionUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    code: Optional[str] = None
    doc_md: Optional[str] = None

class FunctionResponse(FunctionBase):
    id: int
    name: str
    description: Optional[str]
    code: Optional[str]
    doc_md: Optional[str]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

@router.get("", response_model=List[FunctionResponse])
def list_functions(db: Session = Depends(get_db)):
    """List all custom user functions."""
    return db.query(UserFunction).order_by(UserFunction.name.asc()).all()

@router.post("", response_model=FunctionResponse)
def create_function(payload: FunctionCreate, db: Session = Depends(get_db)):
    """Create or overwrite a custom user function."""
    # Check for name collision
    existing = db.query(UserFunction).filter(UserFunction.name == payload.name).first()
    if existing:
        # Overwrite if exists
        existing.description = payload.description
        existing.code = payload.code
        existing.doc_md = payload.doc_md
        db.commit()
        db.refresh(existing)
        return existing
    
    func = UserFunction(
        name=payload.name,
        description=payload.description,
        code=payload.code,
        doc_md=payload.doc_md
    )
    db.add(func)
    db.commit()
    db.refresh(func)
    return func

@router.patch("/{func_id}", response_model=FunctionResponse)
def update_function(func_id: int, payload: FunctionUpdate, db: Session = Depends(get_db)):
    """Update custom function metadata or documentation."""
    func = db.get(UserFunction, func_id)
    if not func:
        raise HTTPException(status_code=404, detail="Function not found.")
    
    if payload.name is not None:
        if payload.name != func.name:
            existing = db.query(UserFunction).filter(UserFunction.name == payload.name).first()
            if existing:
                raise HTTPException(status_code=400, detail="Function name already taken.")
        func.name = payload.name
        
    if payload.description is not None:
        func.description = payload.description
    if payload.code is not None:
        func.code = payload.code
    if payload.doc_md is not None:
        func.doc_md = payload.doc_md
        
    func.updated_at = datetime.now()
    db.commit()
    db.refresh(func)
    return func

@router.delete("/{func_id}")
def delete_function(func_id: int, db: Session = Depends(get_db)):
    """Delete a custom function."""
    func = db.get(UserFunction, func_id)
    if not func:
        raise HTTPException(status_code=404, detail="Function not found.")
    db.delete(func)
    db.commit()
    return {"message": "Function deleted successfully."}

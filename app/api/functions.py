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
    category: Optional[str] = "transformer"

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
    is_generator: bool
    category: str
    doc_md: Optional[str]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

@router.get("", response_model=List[FunctionResponse])
def list_functions(db: Session = Depends(get_db)):
    """List all custom user functions."""
    return db.query(UserFunction).order_by(UserFunction.name.asc()).all()

def _infer_category(code: str) -> str:
    """Intelligently detects function type from signature and content."""
    if not code: return "transformer"
    # 1. Detect Generators (yield or explicit hint)
    if "yield " in code or "yield(" in code or "-> Generator" in code or "-> Iterable" in code:
        return "generator"
    # 2. Detect Comparators (-> bool or returns boolean literals)
    lower_code = code.lower()
    if "-> bool" in code or "return true" in lower_code or "return false" in lower_code:
        return "comparator"
    return "transformer"

@router.post("", response_model=FunctionResponse)
def create_function(payload: FunctionCreate, db: Session = Depends(get_db)):
    """Create or overwrite a custom user function."""
    existing = db.query(UserFunction).filter(UserFunction.name == payload.name).first()
    category = _infer_category(payload.code)
    
    if existing:
        existing.description = payload.description
        existing.code = payload.code
        existing.category = category
        existing.is_generator = (category == "generator")
        existing.doc_md = payload.doc_md
        db.commit()
        db.refresh(existing)
        return existing
    
    func = UserFunction(
        name=payload.name,
        description=payload.description,
        code=payload.code,
        category=category,
        is_generator=(category == "generator"),
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
        func.category = _infer_category(payload.code)
        func.is_generator = (func.category == "generator")
        
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


# Re-run detection for all functions (Migration)
@router.post("/migrate_categories")
def migrate_categories(db: Session = Depends(get_db)):
    """Scans all existing functions to update the category and is_generator flag."""
    funcs = db.query(UserFunction).all()
    count = 0
    for f in funcs:
        new_cat = _infer_category(f.code)
        is_gen = (new_cat == "generator")
        if f.category != new_cat or f.is_generator != is_gen:
            f.category = new_cat
            f.is_generator = is_gen
            count += 1
    db.commit()
    return {"message": f"Updated {count} functions."}

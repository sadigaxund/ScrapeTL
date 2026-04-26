import ast
from typing import Optional, List
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from scrapetl.database import get_db
from scrapetl.models import UserFunction

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
    parameters: List[str] = []
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


def _analyze_function_ast(code: str) -> dict:
    """Parse function code with AST. Returns {'category': str, 'parameters': list[str]}.

    Priority order for category:
      1. Explicit decorator (@generator / @comparator / @transformer from scrapetl.functions.base)
      2. Return type annotation -> bool
      3. yield / yield from in function body
      4. return True / return False literal
      5. Fallback: 'transformer'
    """
    result = {"category": "transformer", "parameters": []}
    if not code:
        return result

    try:
        tree = ast.parse(code)
    except SyntaxError:
        return result

    for node in ast.walk(tree):
        if not isinstance(node, ast.FunctionDef):
            continue

        # 1. Parameters (positional args, excluding self/cls)
        result["parameters"] = [
            arg.arg for arg in node.args.args
            if arg.arg not in ("self", "cls")
        ]

        # 2. Explicit decorator (@generator / @comparator / @transformer)
        for dec in node.decorator_list:
            dec_name = (
                dec.id if isinstance(dec, ast.Name) else
                dec.attr if isinstance(dec, ast.Attribute) else
                None
            )
            if dec_name in ("generator", "comparator", "transformer"):
                result["category"] = dec_name
                return result

        # 3. Return type annotation -> bool
        if isinstance(node.returns, ast.Name) and node.returns.id == "bool":
            result["category"] = "comparator"
            return result

        # 4. yield / yield from anywhere in function body
        for child in ast.walk(node):
            if isinstance(child, (ast.Yield, ast.YieldFrom)):
                result["category"] = "generator"
                return result

        # 5. return True / return False literal
        for child in ast.walk(node):
            if (
                isinstance(child, ast.Return)
                and isinstance(getattr(child, "value", None), ast.Constant)
                and isinstance(child.value.value, bool)
            ):
                result["category"] = "comparator"
                return result

        break  # Only analyse the first function definition

    return result


def _func_to_dict(f: UserFunction) -> dict:
    """Serialize a UserFunction ORM object, adding computed parameters."""
    analysis = _analyze_function_ast(f.code or "")
    return {
        "id": f.id,
        "name": f.name,
        "description": f.description,
        "code": f.code,
        "is_generator": f.is_generator,
        "category": f.category,
        "doc_md": f.doc_md,
        "parameters": analysis["parameters"],
        "created_at": f.created_at,
        "updated_at": f.updated_at,
    }


@router.get("")
def list_functions(db: Session = Depends(get_db)):
    """List all custom user functions."""
    return [_func_to_dict(f) for f in db.query(UserFunction).order_by(UserFunction.name.asc()).all()]

@router.post("")
def create_function(payload: FunctionCreate, db: Session = Depends(get_db)):
    """Create or overwrite a custom user function."""
    existing = db.query(UserFunction).filter(UserFunction.name == payload.name).first()
    analysis = _analyze_function_ast(payload.code)
    category = analysis["category"]

    if existing:
        existing.description = payload.description
        existing.code = payload.code
        existing.category = category
        existing.is_generator = (category == "generator")
        existing.doc_md = payload.doc_md
        db.commit()
        db.refresh(existing)
        return _func_to_dict(existing)

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
    return _func_to_dict(func)

@router.patch("/{func_id}")
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
        analysis = _analyze_function_ast(payload.code)
        func.category = analysis["category"]
        func.is_generator = (func.category == "generator")

    if payload.doc_md is not None:
        func.doc_md = payload.doc_md

    func.updated_at = datetime.now()
    db.commit()
    db.refresh(func)
    return _func_to_dict(func)

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
        new_cat = _analyze_function_ast(f.code or "")["category"]
        is_gen = (new_cat == "generator")
        if f.category != new_cat or f.is_generator != is_gen:
            f.category = new_cat
            f.is_generator = is_gen
            count += 1
    db.commit()
    return {"message": f"Updated {count} functions."}

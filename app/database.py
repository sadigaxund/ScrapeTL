import os
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, declarative_base

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATABASE_URL = f"sqlite:///{os.path.join(BASE_DIR, 'scraper_registry.db')}"

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    from app import models  # noqa: F401 — ensure all models are registered
    Base.metadata.create_all(bind=engine)
    _seed_defaults()


def _seed_defaults():
    """Seed default values into app_settings if they don't exist."""
    db = SessionLocal()
    try:
        from app.models import AppSetting
        if not db.get(AppSetting, "timezone"):
            db.add(AppSetting(key="timezone", value="UTC"))
            db.commit()
            print("[DB] Seeded default timezone = UTC")
    finally:
        db.close()

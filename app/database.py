import os
from sqlalchemy import create_engine
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
    from app import models  # noqa: F401 — ensure models are registered
    Base.metadata.create_all(bind=engine)
    _run_migrations()


def _run_migrations():
    """Apply schema changes that create_all won't handle on existing DBs."""
    from sqlalchemy import text
    with engine.connect() as conn:
        result = conn.execute(text("PRAGMA table_info(scrapers)"))
        columns = [row[1] for row in result]
        
        if "thumbnail_url" not in columns:
            conn.execute(text("ALTER TABLE scrapers ADD COLUMN thumbnail_url VARCHAR"))
            print("[DB] Migration: added thumbnail_url column to scrapers.")
            
        if "homepage_url" not in columns:
            conn.execute(text("ALTER TABLE scrapers ADD COLUMN homepage_url VARCHAR"))
            print("[DB] Migration: added homepage_url column to scrapers.")
            
        if "local_thumbnail_path" not in columns:
            conn.execute(text("ALTER TABLE scrapers ADD COLUMN local_thumbnail_path VARCHAR"))
            print("[DB] Migration: added local_thumbnail_path column to scrapers.")
            
        conn.commit()


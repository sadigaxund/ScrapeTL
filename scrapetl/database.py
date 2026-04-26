import os
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, declarative_base

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{os.path.join(BASE_DIR, 'scraper_registry.db')}")

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
    from scrapetl import models  # noqa: F401 - ensure all models are registered
    Base.metadata.create_all(bind=engine)
    _ensure_schema_columns()
    _seed_defaults()


def _ensure_schema_columns():
    """Proactively add missing columns if they don't exist (since use asked for no migration)."""
    with engine.connect() as conn:
        # Check scrape_logs
        res = conn.execute(text("PRAGMA table_info(scrape_logs)"))
        cols = [r[1] for r in res]
        if "schedule_id" not in cols:
            conn.execute(text("ALTER TABLE scrape_logs ADD COLUMN schedule_id INTEGER REFERENCES schedules(id)"))
            conn.commit()
            print("[DB] Added schedule_id to scrape_logs")
        if "debug_payload" not in cols:
            conn.execute(text("ALTER TABLE scrape_logs ADD COLUMN debug_payload TEXT"))
            conn.commit()
            print("[DB] Added debug_payload to scrape_logs")

        # Check task_queue
        res = conn.execute(text("PRAGMA table_info(task_queue)"))
        cols = [r[1] for r in res]
        if "input_values" not in cols:
            conn.execute(text("ALTER TABLE task_queue ADD COLUMN input_values TEXT"))
            conn.commit()
            print("[DB] Added input_values to task_queue")
        if "note" not in cols:
            conn.execute(text("ALTER TABLE task_queue ADD COLUMN note TEXT"))
            conn.commit()
            print("[DB] Added note to task_queue")
        if "schedule_id" not in cols:
            conn.execute(text("ALTER TABLE task_queue ADD COLUMN schedule_id INTEGER REFERENCES schedules(id)"))
            conn.commit()
            print("[DB] Added schedule_id to task_queue")

        # Check schedules
        res = conn.execute(text("PRAGMA table_info(schedules)"))
        cols = [r[1] for r in res]
        if "position" not in cols:
            conn.execute(text("ALTER TABLE schedules ADD COLUMN position INTEGER DEFAULT 0"))
            conn.commit()
            print("[DB] Added position to schedules")
        if "thumbnail_url" not in cols:
            conn.execute(text("ALTER TABLE schedules ADD COLUMN thumbnail_url TEXT"))
            conn.commit()
            print("[DB] Added thumbnail_url to schedules")
        if "local_thumbnail_path" not in cols:
            conn.execute(text("ALTER TABLE schedules ADD COLUMN local_thumbnail_path TEXT"))
            conn.commit()
            print("[DB] Added local_thumbnail_path to schedules")
        if "thumbnail_data" not in cols:
            conn.execute(text("ALTER TABLE schedules ADD COLUMN thumbnail_data BLOB"))
            conn.commit()
            print("[DB] Added thumbnail_data to schedules")

        # Check scrapers
        res = conn.execute(text("PRAGMA table_info(scrapers)"))
        cols = [r[1] for r in res]
        if "position" not in cols:
            conn.execute(text("ALTER TABLE scrapers ADD COLUMN position INTEGER DEFAULT 0"))
            conn.commit()
            print("[DB] Added position to scrapers")
            conn.execute(text("UPDATE scrapers SET updated_at = created_at WHERE updated_at IS NULL"))
            conn.commit()
            print("[DB] Added updated_at to scrapers")
        if "browser_config" not in cols:
            conn.execute(text("ALTER TABLE scrapers ADD COLUMN browser_config TEXT"))
            conn.commit()
            print("[DB] Added browser_config to scrapers")
        if "batch_throttle_seconds" not in cols:
            conn.execute(text("ALTER TABLE scrapers ADD COLUMN batch_throttle_seconds REAL"))
            conn.commit()
            print("[DB] Added batch_throttle_seconds to scrapers")

        # Check global_variables
        res = conn.execute(text("PRAGMA table_info(global_variables)"))
        cols = [r[1] for r in res]
        if cols and "is_readonly" not in cols:
            conn.execute(text("ALTER TABLE global_variables ADD COLUMN is_readonly BOOLEAN DEFAULT 0"))
            conn.commit()
            print("[DB] Added is_readonly to global_variables")
        if cols and "namespace" not in cols:
            conn.execute(text("ALTER TABLE global_variables ADD COLUMN namespace TEXT"))
            conn.commit()
            print("[DB] Added namespace to global_variables")
        
            if "schema" in cols:
                conn.execute(text("UPDATE global_variables SET namespace = schema WHERE namespace IS NULL"))
                conn.commit()
                print("[DB] Ported data from schema to namespace")

        # Check integrations
        res = conn.execute(text("PRAGMA table_info(integrations)"))
        cols = [r[1] for r in res]
        if "position" not in cols:
            conn.execute(text("ALTER TABLE integrations ADD COLUMN position INTEGER DEFAULT 0"))
            conn.commit()
            print("[DB] Added position to integrations")

        # Check user_functions
        res = conn.execute(text("PRAGMA table_info(user_functions)"))
        cols = [r[1] for r in res]
        if cols and "is_generator" not in cols:
            conn.execute(text("ALTER TABLE user_functions ADD COLUMN is_generator BOOLEAN DEFAULT 0"))
            conn.commit()
            print("[DB] Added is_generator to user_functions")


def _seed_defaults():
    """Seed default values into app_settings if they don't exist."""
    db = SessionLocal()
    try:
        from scrapetl.models import AppSetting
        if not db.get(AppSetting, "timezone"):
            # Detect local timezone
            initial_tz = "UTC"
            try:
                import tzlocal
                initial_tz = tzlocal.get_localzone_name()
            except Exception:
                pass
            
            db.add(AppSetting(key="timezone", value=initial_tz))
            db.commit()
            print(f"[DB] Seeded default timezone = {initial_tz}")

        # Seed Browser Defaults
        if not db.get(AppSetting, "browser_headless"):
            db.add(AppSetting(key="browser_headless", value="true"))
        if not db.get(AppSetting, "browser_cdp_url"):
            db.add(AppSetting(key="browser_cdp_url", value=""))
        db.commit()
    finally:
        db.close()

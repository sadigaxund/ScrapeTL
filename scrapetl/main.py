from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, Response
import os
import threading
import builtins

# Global alias injection for no-code builder compatibility
setattr(builtins, "true", True)
setattr(builtins, "false", False)

from scrapetl.database import init_db
from scrapetl.api import scrapers, schedules, logs, run
from scrapetl.api import settings, tags, integrations, variables, functions

app = FastAPI(title="ScrapeTL", version="2.0.0")

# Include all API routers
app.include_router(scrapers.router)
app.include_router(schedules.router)
app.include_router(logs.router)
app.include_router(run.router)
app.include_router(settings.router)
app.include_router(tags.router)
app.include_router(integrations.router)
app.include_router(variables.router)
app.include_router(functions.router)

# Serve frontend static files
FRONTEND_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "frontend")
app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")

# Note: /thumbnails API is now dynamic, see router below. No static mount needed.


@app.get("/", include_in_schema=False)
def serve_index():
    return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))

@app.get("/thumbnails/{filename}", tags=["thumbnails"])
def get_thumbnail(filename: str):
    from scrapetl.database import SessionLocal
    from scrapetl.models import Scraper, Integration
    import json
    
    db = SessionLocal()
    try:
        # Check Scrapers
        scraper = db.query(Scraper).filter(Scraper.local_thumbnail_path == filename).first()
        if scraper and scraper.thumbnail_data:
            ext = filename.split('.')[-1].lower()
            return Response(content=scraper.thumbnail_data, media_type=f"image/{ext}")
        
        # Check Integrations
        # Integrations store filename in config["thumbnail_url"] which is "/thumbnails/filename"
        search_path = f"/thumbnails/{filename}"
        integrations = db.query(Integration).filter(Integration.thumbnail_data != None).all()
        for integ in integrations:
            try:
                conf = json.loads(integ.config)
                if conf.get("thumbnail_url") == search_path:
                    ext = filename.split('.')[-1].lower()
                    return Response(content=integ.thumbnail_data, media_type=f"image/{ext}")
            except Exception:
                pass
                
        # Return empty 404 or default fallback? 
        return Response(status_code=404)
    finally:
        db.close()


@app.on_event("startup")
def startup_event():
    init_db()
    
    from scrapetl.database import SessionLocal
    db = SessionLocal()

    # Column Migration: log_file_path
    from sqlalchemy import text
    try:
        db.execute(text("ALTER TABLE scrape_logs ADD COLUMN log_file_path VARCHAR"))
        db.commit()
        print("[Migration] Added 'log_file_path' column to 'scrape_logs' table.")
    except Exception:
        # Expected to fail if column already exists
        db.rollback()

    # Initialise Log Settings
    import os
    from scrapetl.models import AppSetting
    
    # Prioritise environment variable for logs path
    env_logs_path = os.environ.get("STL_LOGS_PATH", "./logs")
    if "STL_LOGS_PATH" not in os.environ:
        os.environ["STL_LOGS_PATH"] = env_logs_path

    defaults = {
        "log_retention_days": "30",
        "log_max_size_kb": "2048",
        "log_directory": env_logs_path
    }
    try:
        updated = False
        for key, val in defaults.items():
            existing = db.query(AppSetting).filter(AppSetting.key == key).first()
            if not existing:
                db.add(AppSetting(key=key, value=val))
                updated = True
            elif key == "log_directory" and existing.value != env_logs_path:
                # Always sync setting with environment variable if it changed
                existing.value = env_logs_path
                updated = True
                
        if updated:
            db.commit()
            print(f"[Settings] Synchronised log defaults (Directory: {env_logs_path}).")
    except Exception as e:
        print(f"[Settings] Error initializing log defaults: {e}")
        db.rollback()
    finally:
        db.close()

    from scrapetl import scheduler as sched
    sched.start()
    sched.load_schedules_from_db()

    thread = threading.Thread(target=sched.process_catchup_queue, daemon=True)
    thread.start()
    print("[App] Startup complete. Catch-up queue processing.")

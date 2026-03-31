from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, Response
import os
import threading

from app.database import init_db
from app.api import scrapers, schedules, logs, run
from app.api import settings, tags, integrations, variables, functions

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
    from app.database import SessionLocal
    from app.models import Scraper, Integration
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
    from app import scheduler as sched
    sched.start()
    sched.load_schedules_from_db()

    thread = threading.Thread(target=sched.process_catchup_queue, daemon=True)
    thread.start()
    print("[App] Startup complete. Catch-up queue processing.")

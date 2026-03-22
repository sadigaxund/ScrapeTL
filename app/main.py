from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import os
import threading

from app.database import init_db
from app.api import scrapers, schedules, logs, run

app = FastAPI(title="Anime Scraper Registry", version="1.0.0")

# Include all API routers
app.include_router(scrapers.router)
app.include_router(schedules.router)
app.include_router(logs.router)
app.include_router(run.router)

# Serve frontend static files
FRONTEND_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "frontend")
app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")

# Create and serve locally cached thumbnails
THUMBNAILS_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "thumbnails")
os.makedirs(THUMBNAILS_DIR, exist_ok=True)
app.mount("/thumbnails", StaticFiles(directory=THUMBNAILS_DIR), name="thumbnails")


@app.get("/", include_in_schema=False)
def serve_index():
    return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))


@app.on_event("startup")
def startup_event():
    init_db()
    from app import scheduler as sched
    sched.start()
    sched.load_schedules_from_db()

    # Process any pending catch-up tasks in a background thread
    thread = threading.Thread(target=sched.process_catchup_queue, daemon=True)
    thread.start()
    print("[App] Startup complete. Catch-up queue processing.")

# Docker Deployment Guide

This application is ready to be run as a containerized service. 

## 1. Using Docker Compose (Recommended)
The easiest way to run the application with persistent storage and correct environment variables.

```bash
# Build and start the container in the background
docker compose up --build -d

# View logs
docker compose logs -f

# Stop the container
docker compose down
```

## 2. Manual Docker Build & Run
If you prefer managing the container manually:

### Build the image
```bash
docker build -t scrapetl .
```

### Run the container
Ensure you mount a local folder for the database to persist between restarts.
```bash
# Windows (PowerShell)
docker run -d -p 8000:8000 -v ${PWD}/data:/app/data --name scrapetl scrapetl

# Linux / macOS
docker run -d -p 8000:8000 -v $(pwd)/data:/app/data --name scrapetl scrapetl
```

## Environment Variables
You can customize the following in `docker-compose.yml`:
- `APP_TIMEZONE`: Set your local timezone (e.g., `Asia/Baku`, `UTC`, `Europe/London`).
- `DATABASE_URL`: Location of the SQLite file inside the container (default is `/app/data/scraper_registry.db`).

## Accessing the App
Once running, the dashboard will be available at:
**http://localhost:8000**

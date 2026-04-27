FROM mcr.microsoft.com/playwright/python:v1.49.1-jammy

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV APP_HOME=/app
ENV STL_DATABASE_URL=sqlite:////app/data/scraper_registry.db
ENV STL_LOGS_PATH=/app/data/logs
ENV STL_TIMEZONE=UTC
ENV STL_LOG_RETENTION_DAYS=30
ENV STL_LOG_MAX_SIZE_KB=2048
ENV STL_LOG_PREVIEW_LIMIT=100
ENV STL_BROWSER_HEADLESS=true
ENV STL_BROWSER_CDP_URL=
ENV STL_DISCORD_WEBHOOK_URL=

# Create and set working directory
WORKDIR $APP_HOME

# Install system dependencies (build-essential just in case)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Ensure playwright browsers are installed (though the image has them, this ensures the right ones for our version)
RUN playwright install chromium

# Copy application code
COPY . .

# Create data directory for SQLite and other persistent files
RUN mkdir -p /app/data

# Volume for data
VOLUME /app/data

# Expose port
EXPOSE 8000

# Start application
CMD ["python", "run.py"]

FROM mcr.microsoft.com/playwright/python:v1.49.1-jammy

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV APP_HOME=/app

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

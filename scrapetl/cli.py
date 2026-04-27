"""CLI entry point: `scrapetl run` starts the web application."""
import sys


def main():
    if len(sys.argv) < 2 or sys.argv[1] != "run":
        print("Usage: scrapetl run [--host HOST] [--port PORT]")
        sys.exit(1)

    import argparse
    parser = argparse.ArgumentParser(
        prog="scrapetl run",
        description="Start the ScrapeTL web application.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Environment Variables:
  STL_DATABASE_URL         Database connection string (default: sqlite:///scraper_registry.db)
  STL_LOGS_PATH            Directory for scraper logs (default: ./logs)
  STL_TIMEZONE             Application timezone (default: UTC)
  STL_LOG_RETENTION_DAYS   Days to keep logs before deletion (default: 30)
  STL_LOG_MAX_SIZE_KB      Maximum size of a single log file (default: 2048)
  STL_LOG_PREVIEW_LIMIT    Max lines shown in log preview (default: 100)
  STL_BROWSER_HEADLESS     Run browsers in headless mode (default: true)
  STL_BROWSER_CDP_URL      Remote Chrome DevTools Protocol URL
  STL_DISCORD_WEBHOOK_URL  Optional webhook for global notifications
        """
    )
    parser.add_argument("--host", default="0.0.0.0", help="Host to bind the server to")
    parser.add_argument("--port", type=int, default=8000, help="Port to bind the server to")
    parser.add_argument("--reload", action="store_true", default=False, help="Enable auto-reload for development")
    args = parser.parse_args(sys.argv[2:])

    from dotenv import load_dotenv
    load_dotenv()

    import uvicorn
    uvicorn.run(
        "scrapetl.main:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
    )

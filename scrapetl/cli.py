"""CLI entry point: `scrapetl run` starts the web application."""
import sys


def main():
    if len(sys.argv) < 2 or sys.argv[1] != "run":
        print("Usage: scrapetl run [--host HOST] [--port PORT]")
        sys.exit(1)

    import argparse
    parser = argparse.ArgumentParser(prog="scrapetl run")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--reload", action="store_true", default=False)
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

"""Entry point - start the FastAPI development server."""
import uvicorn
from dotenv import load_dotenv

if __name__ == "__main__":
    load_dotenv() # Load variables from .env if it exists
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=True
    )

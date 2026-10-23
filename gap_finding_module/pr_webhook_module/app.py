"""
PR Webhook Service — FastAPI entry point

Runs as a standalone service on port 8011.
Receives GitHub webhook events and enqueues Celery tasks.

Usage:
    uvicorn pr_webhook_module.app:app --host 0.0.0.0 --port 8011
"""

import logging
import os

from dotenv import load_dotenv
from fastapi import FastAPI
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from slowapi.util import get_remote_address

from pr_webhook_module.routes.webhook_routes import create_webhook_routes

load_dotenv(dotenv_path=".env", override=False)

logging.basicConfig(
    level=getattr(logging, os.getenv("LOG_LEVEL", "INFO").upper()),
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)

limiter = Limiter(key_func=get_remote_address)

app = FastAPI(title="PR Webhook Service")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)


@app.on_event("startup")
async def startup():
    # Initialise gap-finding module DB (creates tables if not exist)
    from pr_webhook_module.db.database import init_db
    init_db()


@app.get("/health")
async def health():
    return {"status": "ok"}


app.include_router(create_webhook_routes(limiter=limiter))

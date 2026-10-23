"""
Gap-finding module database setup.

Uses SQLAlchemy with a dedicated Postgres database (GAPFINDING_DATABASE_URL).
Tables are created on startup via init_db().
"""

import logging
import os

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

logger = logging.getLogger(__name__)

DATABASE_URL = os.getenv("GAPFINDING_DATABASE_URL", "")

engine = create_engine(DATABASE_URL, pool_pre_ping=True) if DATABASE_URL else None
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine) if engine else None


class Base(DeclarativeBase):
    pass


def init_db() -> None:
    """Create all tables if they don't exist. No-op if DATABASE_URL is not set."""
    if not engine:
        logger.warning("[DB] GAPFINDING_DATABASE_URL not set — DB features disabled")
        return
    from pr_webhook_module.db import models  # noqa: F401 — registers models with Base
    Base.metadata.create_all(bind=engine)
    logger.info("[DB] Tables ensured")


def get_session():
    """Return a new DB session. Caller is responsible for closing."""
    if not SessionLocal:
        raise RuntimeError("DB not configured. Set GAPFINDING_DATABASE_URL.")
    return SessionLocal()

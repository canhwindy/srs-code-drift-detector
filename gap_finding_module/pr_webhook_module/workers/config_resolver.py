"""
Config Resolver — resolve pipeline config for a given repo.

Reads from gap-finding module's own DB (GithubConfig table).
Falls back to Outline API when DB is empty (bootstrap fallback).

Extracted from claude_runner.py so it can be used by webhook_routes
without importing the now-deleted claude_runner module.
"""

import logging
import os
from typing import Optional

import httpx
from dotenv import load_dotenv

load_dotenv(dotenv_path=".env", override=False)

logger = logging.getLogger(__name__)

_OUTLINE_URL = os.getenv("OUTLINE_URL", "http://localhost:3000").rstrip("/")
_PIPELINE_API_KEY = os.getenv("PIPELINE_API_KEY", "")


def _get_config_from_db(repo: str) -> Optional[dict]:
    """
    Read pipeline config from gap-finding module's own DB.
    Looks up the active config whose repositories list includes the given repo.
    Falls back to first active config when no exact repo match is found.
    Returns None if DB is not configured or empty.
    """
    try:
        from pr_webhook_module.db.database import get_session
        from pr_webhook_module.db.models import GithubConfig, ConfigStatus

        session = get_session()
        try:
            configs = (
                session.query(GithubConfig)
                .filter(GithubConfig.status == ConfigStatus.active)
                .all()
            )
            for cfg in configs:
                for r in (cfg.repositories or []):
                    owner_repo = f"{r.get('owner', '')}/{r.get('repo', '')}"
                    if owner_repo == repo or r.get("url", "").rstrip("/").endswith(repo):
                        return {
                            "github_token": cfg.github_token,
                            "repositories": cfg.repositories,
                            "team_id": cfg.team_id,
                        }
            if configs:
                cfg = configs[0]
                return {
                    "github_token": cfg.github_token,
                    "repositories": cfg.repositories,
                    "team_id": cfg.team_id,
                }
            return None
        finally:
            session.close()
    except Exception as exc:
        logger.warning(f"[ConfigResolver] DB config read failed: {exc}")
        return None


def _fetch_pipeline_config() -> dict:
    """
    Bootstrap fallback: fetch config from Outline API when own DB is empty.
    Used only on first startup before the queue consumer has synced any config.
    """
    url = f"{_OUTLINE_URL}/api/github.pipelineConfig"
    resp = httpx.post(
        url,
        json={},
        headers={
            "X-Pipeline-Api-Key": _PIPELINE_API_KEY,
            "Content-Type": "application/json",
        },
        timeout=10,
    )
    resp.raise_for_status()
    data = resp.json()
    if not data.get("ok"):
        raise RuntimeError(data.get("error", "Failed to fetch pipeline config"))
    return data["data"]


def resolve_config(repo: str) -> dict:
    """
    Resolve pipeline config: own DB first, Outline API as bootstrap fallback.
    Raises RuntimeError if config cannot be resolved from either source.
    """
    config = _get_config_from_db(repo)
    if config:
        logger.info("[ConfigResolver] Config loaded from own DB")
        return config

    logger.warning("[ConfigResolver] Own DB empty — falling back to Outline API (bootstrap)")
    return _fetch_pipeline_config()

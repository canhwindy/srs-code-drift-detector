"""
GitHub Webhook Routes

Receives GitHub pull request webhook events, validates the signature,
and enqueues a Celery task to publish the event to pr_events queue.

Endpoints:
    POST /webhooks/github         — Receive GitHub webhook (publishes to pr_events)
    GET  /webhooks/github/status  — Check integration status
"""

import hashlib
import hmac
import json
import logging
import os
from typing import Optional

from fastapi import APIRouter, Header, HTTPException, Request, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from dotenv import load_dotenv
from slowapi import Limiter

load_dotenv(dotenv_path=".env", override=False)

logger = logging.getLogger(__name__)


# =============================================================================
# Models
# =============================================================================

class WebhookResponse(BaseModel):
    status: str = Field(..., description="Status of webhook processing")
    message: str = Field(..., description="Descriptive message")
    task_id: Optional[str] = Field(None, description="Celery task ID if enqueued")
    pr_number: Optional[int] = Field(None, description="Pull request number")
    repo: Optional[str] = Field(None, description="Repository full name")


class WebhookStatusResponse(BaseModel):
    celery_connected: bool
    supported_events: list[str] = ["pull_request"]
    supported_actions: list[str] = ["opened", "synchronize", "reopened"]


# =============================================================================
# Signature verification
# =============================================================================

def verify_github_signature(payload_body: bytes, signature_header: str, secret: str) -> bool:
    """Verify X-Hub-Signature-256 HMAC signature from GitHub."""
    if not signature_header or not signature_header.startswith("sha256="):
        return False
    expected = signature_header[7:]
    mac = hmac.new(key=secret.encode("utf-8"), msg=payload_body, digestmod=hashlib.sha256)
    return hmac.compare_digest(mac.hexdigest(), expected)


def _get_webhook_secret_for_repo(repo_full_name: str) -> Optional[str]:
    """
    Look up the webhook secret for the given repo from the gap-finding module's own DB.
    Returns None if DB is not configured or no matching config found.
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
                secret = cfg.get_webhook_secret_for_repo(repo_full_name)
                if secret:
                    return secret
            return None
        finally:
            session.close()
    except Exception as exc:
        logger.warning(f"[Webhook] DB secret lookup failed: {exc}")
        return None


def _verify_signature_from_db(body: bytes, signature_header: str, repo_full_name: str) -> bool:
    """
    Verify webhook signature using per-repo secret from DB.
    Falls back to GITHUB_WEBHOOK_SECRET env var if DB has no secret for this repo.
    """
    db_secret = _get_webhook_secret_for_repo(repo_full_name)
    if db_secret and verify_github_signature(body, signature_header, db_secret):
        return True

    env_secret = os.getenv("GITHUB_WEBHOOK_SECRET", "")
    if env_secret and verify_github_signature(body, signature_header, env_secret):
        return True

    return False


# =============================================================================
# Router factory
# =============================================================================

def create_webhook_routes(
    webhook_secret: Optional[str] = None,
    limiter: Optional[Limiter] = None,
) -> APIRouter:
    """
    Create webhook router.

    Args:
        webhook_secret: Deprecated — secrets are now read from DB per-repo.
                        Kept for API compatibility; passed to env fallback if set.
        limiter: slowapi Limiter instance for rate limiting.
    """
    router = APIRouter(prefix="/webhooks", tags=["Webhooks"])

    _fallback_secret = webhook_secret or os.getenv("GITHUB_WEBHOOK_SECRET", "")

    SUPPORTED_EVENTS = {"pull_request"}
    # "closed" được pass-through CHỈ KHI merged=true để trigger gitnexus re-pull
    # (xem filter trong handler bên dưới). PR closed-not-merged bị drop vì code
    # không vào base branch → không cần re-index, cũng không cần gap-finding.
    SUPPORTED_ACTIONS = {"opened", "synchronize", "reopened", "closed"}

    @router.post(
        "/github",
        response_model=WebhookResponse,
        summary="Receive GitHub Webhook",
        responses={
            202: {"description": "Task enqueued"},
            200: {"description": "Event ignored (filtered)"},
            400: {"description": "Invalid payload"},
            401: {"description": "Invalid signature"},
            429: {"description": "Rate limit exceeded"},
        },
    )
    @limiter.limit("30/minute")
    async def receive_github_webhook(
        request: Request,
        x_hub_signature_256: Optional[str] = Header(None),
        x_github_event: Optional[str] = Header(None),
        x_github_delivery: Optional[str] = Header(None),
    ) -> JSONResponse:
        body = await request.body()

        try:
            payload = json.loads(body)
        except json.JSONDecodeError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid JSON payload")

        repo_full_name = payload.get("repository", {}).get("full_name", "")

        if not _verify_signature_from_db(body, x_hub_signature_256 or "", repo_full_name):
            if not (_fallback_secret and verify_github_signature(body, x_hub_signature_256 or "", _fallback_secret)):
                logger.warning(f"Invalid webhook signature. Delivery: {x_github_delivery}")
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid webhook signature")

        if x_github_event not in SUPPORTED_EVENTS:
            logger.info(f"Ignoring event: {x_github_event}")
            return JSONResponse(
                status_code=status.HTTP_200_OK,
                content=WebhookResponse(
                    status="ignored", message=f"Event '{x_github_event}' not supported").model_dump(),
            )

        action = payload.get("action", "")
        if action not in SUPPORTED_ACTIONS:
            logger.info(f"Ignoring action: {action}")
            return JSONResponse(
                status_code=status.HTTP_200_OK,
                content=WebhookResponse(
                    status="ignored", message=f"Action '{action}' not supported").model_dump(),
            )

        # closed + merged=false (PR rejected/abandoned) → drop sớm: code không
        # vào base branch nên không cần re-pull; gap-finding cũng không relevant.
        if action == "closed" and not payload.get("pull_request", {}).get("merged", False):
            logger.info("Ignoring closed PR (not merged)")
            return JSONResponse(
                status_code=status.HTTP_200_OK,
                content=WebhookResponse(
                    status="ignored", message="Closed PR not merged").model_dump(),
            )

        pr_number = payload.get("pull_request", {}).get("number")
        logger.info(
            f"Received PR #{pr_number} ({action}) from {repo_full_name}. Delivery: {x_github_delivery}")

        try:
            from pr_webhook_module.workers.config_resolver import resolve_config
            try:
                pipeline_config = resolve_config(repo_full_name)
            except Exception as exc:
                logger.error(f"Failed to resolve pipeline config: {exc}")
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="Pipeline config unavailable, try again later")
            payload["pipeline_config"] = pipeline_config

            from pr_webhook_module.workers.pr_worker import process_pull_request
            task = process_pull_request.delay(payload)
            logger.info(f"Enqueued task {task.id} for PR #{pr_number}")
            return JSONResponse(
                status_code=status.HTTP_202_ACCEPTED,
                content=WebhookResponse(
                    status="accepted",
                    message="PR event enqueued for processing",
                    task_id=task.id,
                    pr_number=pr_number,
                    repo=repo_full_name,
                ).model_dump(),
            )
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Failed to enqueue task: {e}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))

    @router.get(
        "/github/status",
        response_model=WebhookStatusResponse,
        summary="Webhook Status",
    )
    async def get_webhook_status() -> WebhookStatusResponse:
        """Check Celery broker connectivity."""
        celery_connected = False
        try:
            from pr_webhook_module.workers.celery_app import celery_app
            celery_app.control.ping(timeout=2.0)
            celery_connected = True
        except Exception as e:
            logger.debug(f"Celery ping failed: {e}")

        return WebhookStatusResponse(
            celery_connected=celery_connected,
            supported_events=list(SUPPORTED_EVENTS),
            supported_actions=list(SUPPORTED_ACTIONS),
        )

    return router

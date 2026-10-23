"""
Pull Request Publisher — Publishes PR events to pr_events queue for Python backend.

Flow:
    GitHub webhook → validate → Celery task → pr_events queue → Python backend consumer

The Python backend (backend/) consumes pr_events, runs gap-finding via LightRAG,
and publishes results to gap_results queue for the Node.js backend.

Retry/DLQ pattern reused from the original pr_worker.py template.
"""

import json
import logging
import os
import random
from datetime import datetime, timezone
from typing import Any

import httpx
from celery import shared_task
from celery.exceptions import SoftTimeLimitExceeded
from dotenv import load_dotenv

load_dotenv(dotenv_path=".env", override=False)

logger = logging.getLogger(__name__)

_BACKEND_URL = os.getenv("BACKEND_URL", "http://outline-backend:8000").rstrip("/")
_OUTLINE_URL = os.getenv("OUTLINE_URL", "http://host.docker.internal:3000").rstrip("/")
_PIPELINE_API_KEY = os.getenv("PIPELINE_API_KEY", "")
# Timeout cho gap-finding: dài vì Claude gọi nhiều bước (GitNexus + LightRAG + 2x Claude)
_GAP_FINDING_TIMEOUT = int(os.getenv("GAP_FINDING_TIMEOUT", "1200"))


# =============================================================================
# Queue publish helpers
# =============================================================================

def _publish_pr_event(event: dict[str, Any]) -> None:
    """Publish a PR event to the pr_events RabbitMQ queue."""
    from kombu import Connection, Exchange, Queue as KombuQueue, Producer

    broker_url = os.getenv("CELERY_BROKER_URL", "amqp://guest:guest@localhost:5672//")
    exchange = Exchange("pr_events", type="direct", durable=True)
    queue = KombuQueue("pr_events", exchange=exchange, routing_key="pr_events", durable=True)

    with Connection(broker_url) as conn:
        queue.bind(conn).declare()
        with conn.channel() as channel:
            producer = Producer(channel, exchange=exchange)
            producer.publish(
                event,
                routing_key="pr_events",
                delivery_mode=2,
                serializer="json",
            )


def _publish_to_dlq(
    payload: dict[str, Any],
    task_id: str,
    error: str,
    retry_count: int,
) -> None:
    from kombu import Connection, Exchange, Producer
    broker_url = os.getenv("CELERY_BROKER_URL", "amqp://guest:guest@localhost:5672//")
    dlq_message = {
        "original_payload": payload,
        "task_id": task_id,
        "failed_at": datetime.now(timezone.utc).isoformat(),
        "error": error,
        "retry_count": retry_count,
    }
    with Connection(broker_url) as conn:
        exchange = Exchange("pr_webhook.dlx", type="direct", durable=True)
        with conn.channel() as channel:
            from kombu import Producer
            producer = Producer(channel, exchange=exchange)
            producer.publish(
                dlq_message,
                routing_key="pr_webhook.dead",
                delivery_mode=2,
            )
    logger.info("Payload published to pr_webhook.dlq")


# =============================================================================
# Pipeline log push (streaming status to BA Dashboard)
# =============================================================================

def _push_log(payload: dict) -> None:
    """POST claude log to Outline backend for socket.io broadcast."""
    url = f"{_OUTLINE_URL}/api/badashboard.pushClaudeLogs"
    try:
        resp = httpx.post(
            url,
            json=payload,
            headers={
                "X-Pipeline-Api-Key": _PIPELINE_API_KEY,
                "Content-Type": "application/json",
            },
            timeout=10,
        )
        resp.raise_for_status()
        logger.info(f"[PRWorker] Pushed log: status={payload.get('status')}")
    except Exception as exc:
        logger.warning(f"[PRWorker] Failed to push log: {exc}")


# =============================================================================
# Gap-finding API call
# =============================================================================

def _call_gap_finding_api(
    pr_number: int,
    repo: str,
    pr_title: str,
    workspace_id: str = "",
) -> dict | None:
    """
    Gọi Python backend /api/gap-finding via pipeline auth.
    Backend dùng CLIProxy + ~/.claude/.credentials.json để gọi Claude.

    workspace_id: teamId từ pipeline_config — xác định LightRAG workspace chứa SRS.
    Returns drift report dict (gap_rows format), hoặc None nếu lỗi.
    """
    logger.info(
        f"[PRWorker] Calling gap-finding API — PR#{pr_number} repo={repo!r} workspace={workspace_id!r}"
    )
    try:
        with httpx.Client(timeout=_GAP_FINDING_TIMEOUT) as client:
            resp = client.post(
                f"{_BACKEND_URL}/api/gap-finding",
                headers={
                    "X-Pipeline-Api-Key": _PIPELINE_API_KEY,
                    "Content-Type": "application/json",
                },
                json={
                    "pr_number": pr_number,
                    "repo": repo,
                    "feature_name": pr_title,
                    "workspace_id": workspace_id,
                },
            )
            resp.raise_for_status()
            return resp.json()
    except httpx.HTTPStatusError as exc:
        logger.error(
            f"[PRWorker] Gap-finding API HTTP {exc.response.status_code}: "
            f"{exc.response.text[:300]}"
        )
        return None
    except httpx.TimeoutException:
        logger.error(
            f"[PRWorker] Gap-finding API timed out after {_GAP_FINDING_TIMEOUT}s"
        )
        return None
    except Exception as exc:
        logger.error(f"[PRWorker] Gap-finding API error: {exc}", exc_info=True)
        return None


# =============================================================================
# Transform gap_rows → importPipelineResult payload
# =============================================================================

def _drift_report_to_pipeline_payload(
    drift_report: dict,
    pr_number: int,
    repo: str,
    pr_title: str,
) -> dict:
    """
    Chuyển đổi drift report (gap_rows format từ Python backend)
    sang format mà /api/badashboard.importPipelineResult chấp nhận.

    gap_rows → test_verdicts:
        step N → 1 verdict
        tag: matching/mismatch/missing (giữ nguyên)
        name: srs.action hoặc "Step N"
        requirement_id: {uc_id}-step{N}
        requirement_description: SRS action + guard_br
        error_message: drift_detail
        tag_reason: drift_label
    """
    uc_id = drift_report.get("uc_id", "UC")
    gap_rows = drift_report.get("gap_rows", [])
    surplus_items = drift_report.get("surplus_items", [])

    test_verdicts = []
    for row in gap_rows:
        srs = row.get("srs") or {}
        code = row.get("code") or {}
        step = row.get("step", 0)
        tag = row.get("tag", "missing")

        # Title: ưu tiên SRS action (mô tả nghiệp vụ), fallback step number
        # Truncate 255 — giới hạn TestResult.title column (STRING 255)
        name = (srs.get("action") or srs.get("event") or f"Step {step}").strip()[:255]

        # Description: ghép SRS action + guard/BR
        desc_parts = []
        if srs.get("action"):
            desc_parts.append(srs["action"])
        if srs.get("guard_br"):
            desc_parts.append(f"[Guard/BR] {srs['guard_br']}")
        if row.get("drift_detail"):
            desc_parts.append(f"[Drift] {row['drift_detail']}")
        requirement_description = "\n".join(desc_parts)

        # assertion_logic: mô tả code side
        code_parts = []
        if code.get("action"):
            code_parts.append(code["action"])
        if code.get("guard"):
            code_parts.append(f"Guard: {code['guard']}")
        assertion_logic = " | ".join(code_parts)

        test_verdicts.append({
            "name": name,
            "tag": tag,
            "requirement_id": f"{uc_id}-step{step}"[:100],
            "requirement_description": requirement_description,
            "srs_section": drift_report.get("repo_type", "backend"),
            "error_message": row.get("drift_detail", ""),
            "assertion_logic": assertion_logic,
            "tag_reason": row.get("drift_label", ""),
            "duration_ms": 0,
            "test_code": "",
            # EAS row fields — để FE hiển thị bảng có cấu trúc
            "step": step,
            "srs": srs,
            "code": code,
            "srs_references": row.get("srs_references") or [],
            "code_references": row.get("code_references") or [],
        })

    matching = sum(1 for v in test_verdicts if v["tag"] == "matching")
    mismatch = sum(1 for v in test_verdicts if v["tag"] == "mismatch")
    missing = sum(1 for v in test_verdicts if v["tag"] == "missing")

    surplus_payload = [
        {
            "id": s.get("id", f"SURPLUS-{i + 1}"),
            "title": (s.get("action") or s.get("id") or f"Surplus {i + 1}")[:255],
            "reason": s.get("reason", ""),
            "confidence": s.get("confidence", "medium"),
            "actor": s.get("actor"),
            "event": s.get("event"),
            "action": s.get("action"),
            "code_references": s.get("code_references") or [],
        }
        for i, s in enumerate(surplus_items)
    ]

    return {
        "pr_id": pr_number,
        "repo": repo,
        "repo_type": drift_report.get("repo_type", "backend"),
        "pr_title": pr_title,
        "verdict_summary": {
            "total": len(test_verdicts),
            "matching": matching,
            "mismatch": mismatch,
            "missing": missing,
        },
        "surplus_count": len(surplus_items),
        "error_summary": drift_report.get("error_summary", ""),
        "llm_cost_usd": 0,
        "run_at": datetime.now(timezone.utc).isoformat(),
        "test_verdicts": test_verdicts,
        "surplus_items": surplus_payload,
    }


def _push_to_dashboard(pipeline_payload: dict) -> str | None:
    """
    POST pipeline result lên Outline Node.js /api/badashboard.importPipelineResult.
    Returns gapFindingId nếu thành công, None nếu thất bại.
    """
    url = f"{_OUTLINE_URL}/api/badashboard.importPipelineResult"
    try:
        resp = httpx.post(
            url,
            json=pipeline_payload,
            headers={
                "X-Pipeline-Api-Key": _PIPELINE_API_KEY,
                "Content-Type": "application/json",
            },
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()
        gap_finding_id = data.get("data", {}).get("gapFindingId")
        logger.info(f"[PRWorker] Dashboard push OK — gapFindingId={gap_finding_id}")
        return gap_finding_id
    except httpx.HTTPStatusError as exc:
        logger.error(
            f"[PRWorker] Dashboard push HTTP {exc.response.status_code}: "
            f"{exc.response.text[:300]}"
        )
        return None
    except Exception as exc:
        logger.error(f"[PRWorker] Dashboard push failed: {exc}")
        return None


# =============================================================================
# Celery task
# =============================================================================

@shared_task(
    bind=True,
    name="pr_webhook_module.workers.pr_worker.process_pull_request",
    max_retries=4,
)
def process_pull_request(self, payload: dict[str, Any]) -> dict[str, Any]:
    """
    Celery task: publish PR event to pr_events queue for the Python backend.

    Extracts PR info and team_id from payload (pre-filled by webhook route)
    then publishes a lean event message to the pr_events RabbitMQ queue.
    The Python backend consumer picks it up and runs gap-finding via LightRAG.
    """
    logger.info(f"Publishing PR event. Task ID: {self.request.id}")
    try:
        pr_data = payload.get("pull_request", {})
        repo_data = payload.get("repository", {})
        pipeline_config = payload.get("pipeline_config", {})

        event = {
            "pr_id": pr_data.get("number"),
            "repo": repo_data.get("full_name", ""),
            "pr_title": pr_data.get("title", ""),
            "team_id": pipeline_config.get("team_id", ""),
            "action": payload.get("action", ""),
            # GitHub webhook: pull_request.merged = true khi PR được merge vào base branch.
            # Backend dùng (action=="closed" AND merged==True) để trigger gitnexus pull.
            "merged": bool(pr_data.get("merged", False)),
            "published_at": datetime.now(timezone.utc).isoformat(),
        }

        _publish_pr_event(event)
        logger.info(
            f"PR event published for PR #{event['pr_id']} "
            f"({event['repo']}, team={event['team_id']})"
        )
        return {"status": "published", "pr_id": event["pr_id"]}

    except Exception as e:
        logger.error(f"Task failed: {e}", exc_info=True)
        if self.request.retries >= self.max_retries:
            logger.error(
                f"Task exhausted all retries, routing to DLQ. Task ID: {self.request.id}"
            )
            _publish_to_dlq(
                payload=payload,
                task_id=self.request.id,
                error=str(e),
                retry_count=self.request.retries,
            )
            return
        base_delay = 60 * (2 ** self.request.retries)
        jitter = random.uniform(0, base_delay * 0.3)
        countdown = base_delay + jitter
        logger.info(
            f"Retrying in {countdown:.1f}s "
            f"(attempt {self.request.retries + 1}/{self.max_retries})"
        )
        raise self.retry(exc=e, countdown=countdown)

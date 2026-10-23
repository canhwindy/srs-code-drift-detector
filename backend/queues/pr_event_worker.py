"""
PR Event Worker — async RabbitMQ consumer for pr_events queue.

Chạy trong cùng event loop với FastAPI (asyncio.create_task).
Consume từ [pr_events], gọi run_gap_finding(), lưu kết quả vào
gap_result_outbox để gap_result_outbox_relay publish lên [gap_results].

Pattern tái sử dụng từ kanban_worker.py:
  - aio_pika consumer với reconnect loop
  - prefetch_count=1 (một PR tại một thời điểm — phân tích tốn kém)
  - x-retry-count header tracking: requeue với counter tăng dần khi lỗi transient
  - Sau MAX_RETRIES: route sang pr_events.dlq + gửi email alert
"""

import asyncio
import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path

import aio_pika
import aio_pika.abc
import httpx
from sqlalchemy import text

from database import AsyncSessionLocal
from skills.gap_finding.gap_finding import GapFindingRequest, run_gap_finding
from queues.pr_event_translator import PrEventTranslateError, translate_pr_event
from queues.dlq_notifier import send_dlq_alert
from rag_state import _pipeline_usage_log, format_pipeline_usage_summary

logger = logging.getLogger(__name__)

QUEUE_PR_EVENTS = "pr_events"
QUEUE_DLQ        = "pr_events.dlq"
EXCHANGE_DLQ     = "pr_events.dlx"

MAX_RETRIES = int(os.getenv("PR_EVENT_MAX_RETRIES", "4"))

_RECONNECT_DELAY_BASE = 5   # giây
_RECONNECT_DELAY_MAX  = 60  # giây

# Pipeline usage log — JSONL append-only, 1 dòng / pipeline run.
# Path mặc định nằm trong /app volume (bind-mount ./backend từ host) để persist qua restart.
_PIPELINE_USAGE_LOG_PATH = Path(
    os.getenv("PIPELINE_USAGE_LOG_PATH", "/app/logs/pipeline_usage.jsonl")
)


def _append_pipeline_usage_record(record: dict) -> None:
    """Append 1 record vào JSONL file. Best-effort, không crash pipeline nếu IO lỗi."""
    try:
        _PIPELINE_USAGE_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        with _PIPELINE_USAGE_LOG_PATH.open("a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
    except Exception as exc:
        logger.warning("[PREventWorker] Failed to write pipeline_usage.jsonl: %s", exc)


# Pricing Claude Sonnet 4.6 (USD / 1M tokens) — mirror của rag_state._CLAUDE_SONNET_4_6_PRICING.
_PRICING_IN_PER_M = 3.0
_PRICING_OUT_PER_M = 15.0
_PRICING_CACHE_CREATE_PER_M = 3.75
_PRICING_CACHE_READ_PER_M = 0.30


def _compute_usage_totals(records: list[dict]) -> dict:
    """Aggregate token counts + USD cost từ per-call records."""
    total_in = sum(int(r.get("input_tokens") or 0) for r in records)
    total_out = sum(int(r.get("output_tokens") or 0) for r in records)
    total_cc = sum(int(r.get("cache_creation") or 0) for r in records)
    total_cr = sum(int(r.get("cache_read") or 0) for r in records)
    total_dur = sum(float(r.get("duration_s") or 0.0) for r in records)
    cost = (
        total_in * _PRICING_IN_PER_M / 1_000_000
        + total_out * _PRICING_OUT_PER_M / 1_000_000
        + total_cc * _PRICING_CACHE_CREATE_PER_M / 1_000_000
        + total_cr * _PRICING_CACHE_READ_PER_M / 1_000_000
    )
    return {
        "input_tokens": total_in,
        "output_tokens": total_out,
        "cache_creation_tokens": total_cc,
        "cache_read_tokens": total_cr,
        "duration_s": round(total_dur, 2),
        "cost_usd": round(cost, 4),
    }


# Gitnexus service — dùng cho async pull trigger khi PR được merge.
# Default trỏ vào Docker service name; override qua env khi chạy local.
_GITNEXUS_SERVICE_URL = os.getenv("GITNEXUS_SERVICE_URL", "http://gitnexus:4747")
_GITNEXUS_PULL_TIMEOUT = float(os.getenv("GITNEXUS_PULL_TIMEOUT", "30"))


def _derive_gitnexus_repo_name(repo: str) -> str:
    """
    GitHub full_name "owner/outline-edited" → "outline-edited".
    Khớp với logic `deriveRepoName` trong gitnexus-service/server.js (last segment).
    """
    if not repo:
        return ""
    return repo.rsplit("/", 1)[-1]


async def _trigger_gitnexus_pull(repo: str, pr_id: int) -> None:
    """
    Fire-and-forget: gọi POST /api/repos/:name/pull lên gitnexus-service.
    Không await được trong flow chính — chạy bằng asyncio.create_task().
    Best-effort: lỗi network / 404 (repo chưa register) chỉ log warning.
    """
    repo_name = _derive_gitnexus_repo_name(repo)
    if not repo_name:
        logger.warning("[PREventWorker] Cannot derive gitnexus repo name from %r", repo)
        return

    url = f"{_GITNEXUS_SERVICE_URL}/api/repos/{repo_name}/pull"
    try:
        async with httpx.AsyncClient(timeout=_GITNEXUS_PULL_TIMEOUT) as client:
            resp = await client.post(url, json={})
        if resp.status_code == 404:
            logger.info(
                "[PREventWorker] Gitnexus repo %r not registered (PR #%s) — skip pull",
                repo_name, pr_id,
            )
            return
        if resp.status_code >= 400:
            logger.warning(
                "[PREventWorker] Gitnexus pull HTTP %d for %r (PR #%s): %s",
                resp.status_code, repo_name, pr_id, resp.text[:200],
            )
            return
        logger.info(
            "[PREventWorker] Gitnexus pull queued for %r (PR #%s merged)",
            repo_name, pr_id,
        )
    except Exception as exc:
        logger.warning(
            "[PREventWorker] Gitnexus pull failed for %r (PR #%s): %s",
            repo_name, pr_id, exc,
        )


# =============================================================================
# Entry point
# =============================================================================

async def start_pr_event_worker() -> None:
    """
    Entry point — được gọi bằng asyncio.create_task() trong main.py lifespan.
    Tự reconnect vô hạn khi mất kết nối RabbitMQ.
    """
    rabbitmq_url = os.getenv("RABBITMQ_URL", "amqp://guest:guest@localhost:5672/")
    delay = _RECONNECT_DELAY_BASE

    while True:
        try:
            await _run_consumer(rabbitmq_url)
        except asyncio.CancelledError:
            logger.info("[PREventWorker] Cancelled — shutting down")
            return
        except Exception as exc:
            logger.error(
                "[PREventWorker] Connection lost: %s — reconnecting in %ds", exc, delay
            )
            await asyncio.sleep(delay)
            delay = min(delay * 2, _RECONNECT_DELAY_MAX)
        else:
            delay = _RECONNECT_DELAY_BASE


# =============================================================================
# Consumer loop
# =============================================================================

async def _run_consumer(rabbitmq_url: str) -> None:
    """Kết nối RabbitMQ và bắt đầu consume. Block cho đến khi mất kết nối."""
    logger.info("[PREventWorker] Connecting to RabbitMQ: %s", rabbitmq_url)

    connection: aio_pika.abc.AbstractConnection = await asyncio.wait_for(
        aio_pika.connect(rabbitmq_url, heartbeat=60),
        timeout=30.0,
    )

    async with connection:
        channel: aio_pika.abc.AbstractChannel = await connection.channel()

        # prefetch_count=1: gap-finding tốn 1-5 phút + nhiều token → chỉ xử lý 1 PR tại một lúc
        await channel.set_qos(prefetch_count=1)

        queue: aio_pika.abc.AbstractQueue = await channel.declare_queue(
            QUEUE_PR_EVENTS, durable=True
        )

        logger.info("[PREventWorker] Ready — consuming from %s", QUEUE_PR_EVENTS)

        async with queue.iterator() as queue_iter:
            async for message in queue_iter:
                await _handle_message(message, channel)


# =============================================================================
# Message handler
# =============================================================================

async def _handle_message(
    message: aio_pika.abc.AbstractIncomingMessage,
    channel: aio_pika.abc.AbstractChannel,
) -> None:
    """Xử lý một PR event message."""
    async with message.process(ignore_processed=True):
        # ── Parse & validate ──────────────────────────────────────────────────
        try:
            raw = json.loads(message.body.decode())
            event = translate_pr_event(raw)
        except PrEventTranslateError as exc:
            logger.error("[PREventWorker] Invalid pr_events message: %s", exc)
            await message.reject(requeue=False)
            return
        except Exception as exc:
            logger.error("[PREventWorker] Failed to decode message: %s", exc)
            await message.reject(requeue=False)
            return

        retry_count: int = int((message.headers or {}).get("x-retry-count", 0))

        logger.info(
            "[PREventWorker] Received PR event — pr_id=%r, repo=%r, team=%r, action=%r, merged=%s, retry=%d",
            event.pr_id, event.repo, event.team_id, event.action, event.merged, retry_count,
        )

        # ── Gitnexus refresh trigger ──────────────────────────────────────────
        # PR closed AND merged=True → queue re-pull + re-analyze asynchronously.
        # Fire-and-forget; chỉ skip retry (retry_count=0) để tránh trigger pull
        # nhiều lần cho cùng 1 PR.
        # Sau khi trigger pull, ack message và return — KHÔNG chạy gap-finding
        # cho merge event vì PR đã land vào base branch, không có drift mới
        # so với chính nó. Webhook receiver đã filter closed-not-merged ra,
        # nên action=="closed" tới đây luôn là merge event.
        if event.action == "closed":
            if event.merged and retry_count == 0:
                asyncio.create_task(_trigger_gitnexus_pull(event.repo, event.pr_id))
            return  # context manager auto-acks on clean exit

        # ── Credentials ───────────────────────────────────────────────────────
        credentials_json = _load_pipeline_credentials()
        user_id = os.getenv("PIPELINE_USER_ID", "pipeline")

        if not credentials_json:
            logger.error(
                "[PREventWorker] Pipeline credentials not found — "
                "set PIPELINE_CREDENTIALS_JSON env var or mount ~/.claude into container"
            )
            await _handle_failure(
                channel=channel,
                message=message,
                event_dict=raw,
                error="Pipeline credentials not found",
                retry_count=retry_count,
                transient=False,
            )
            return

        # ── Run gap finding ───────────────────────────────────────────────────
        gap_request = GapFindingRequest(
            pr_number=event.pr_id,
            repo=event.repo,
            feature_name=event.pr_title or None,
            workspace_id=event.team_id,
            credentials_json=credentials_json,
            user_id=user_id,
        )

        # Collect Claude usage per call cho summary cuối run.
        # rag_state._call_claude_cli_async append 1 record / call khi ContextVar được set.
        usage_collector: list[dict] = []
        _usage_token = _pipeline_usage_log.set(usage_collector)
        try:
            try:
                result = await run_gap_finding(gap_request)
            except Exception as exc:
                logger.error(
                    "[PREventWorker] run_gap_finding raised exception — pr_id=%r: %s",
                    event.pr_id, exc,
                    exc_info=True,
                )
                # Lỗi transient (network, LightRAG timeout) → retry với counter
                await _handle_failure(
                    channel=channel,
                    message=message,
                    event_dict=raw,
                    error=str(exc),
                    retry_count=retry_count,
                    transient=True,
                )
                return
        finally:
            _pipeline_usage_log.reset(_usage_token)

        if not result.success:
            logger.error(
                "[PREventWorker] Gap finding failed — pr_id=%r: %s", event.pr_id, result.error
            )
            # Lỗi logic (thiếu SRS, parse error) → DLQ ngay, không retry
            await _handle_failure(
                channel=channel,
                message=message,
                event_dict=raw,
                error=result.error or "gap finding returned success=False",
                retry_count=retry_count,
                transient=False,
            )
            return

        # ── Save result ───────────────────────────────────────────────────────
        drift = result.drift_report or {}
        outbox_payload = _build_gap_result_payload(
            pr_id=event.pr_id,
            repo=event.repo,
            pr_title=event.pr_title,
            team_id=event.team_id,
            drift=drift,
        )

        await _save_to_outbox(outbox_payload)
        logger.info(
            "[PREventWorker] Gap result saved to outbox for PR #%s (team=%s)",
            event.pr_id, event.team_id,
        )

        # Summary text (human-readable) — vẫn log ra backend stdout cho debug.
        summary_text = format_pipeline_usage_summary(
            pr_id=event.pr_id,
            repo=event.repo,
            records=usage_collector,
            uc_id=drift.get("uc_id"),
            gap_rows=len(drift.get("gap_rows", []) or []),
        )
        logger.info("\n%s", summary_text)

        # Persist structured JSON record cho endpoint /api/pipeline-usage query sau này.
        totals = _compute_usage_totals(usage_collector)
        _append_pipeline_usage_record({
            "pr_id": event.pr_id,
            "repo": event.repo,
            "pr_title": event.pr_title or "",
            "team_id": event.team_id,
            "status": "completed",
            "finished_at": datetime.now(timezone.utc).isoformat(),
            "uc_id": drift.get("uc_id"),
            "gap_rows": len(drift.get("gap_rows", []) or []),
            "calls": usage_collector,
            "total": totals,
        })


# =============================================================================
# Failure handler — retry / DLQ
# =============================================================================

async def _handle_failure(
    channel: aio_pika.abc.AbstractChannel,
    message: aio_pika.abc.AbstractIncomingMessage,
    event_dict: dict,
    error: str,
    retry_count: int,
    transient: bool,
) -> None:
    """
    Quyết định retry hoặc route sang DLQ dựa trên retry_count và loại lỗi.

    - transient=True và retry_count < MAX_RETRIES  → republish với x-retry-count+1
    - transient=False hoặc retry_count >= MAX_RETRIES → DLQ + email alert
    """
    if transient and retry_count < MAX_RETRIES:
        # Republish với header tăng dần thay vì dùng requeue=True
        # (requeue=True không tăng counter và đưa về đầu queue)
        new_headers = dict(message.headers or {})
        new_headers["x-retry-count"] = retry_count + 1
        await channel.default_exchange.publish(
            aio_pika.Message(
                body=message.body,
                headers=new_headers,
                delivery_mode=aio_pika.DeliveryMode.PERSISTENT,
                content_type="application/json",
            ),
            routing_key=QUEUE_PR_EVENTS,
        )
        logger.warning(
            "[PREventWorker] Transient error — requeued PR #%s (attempt %d/%d): %s",
            event_dict.get("pr_id"), retry_count + 1, MAX_RETRIES, error,
        )
        await message.reject(requeue=False)  # ack original
        return

    # Max retries exhausted hoặc lỗi logic → DLQ
    await _publish_to_dlq(channel, event_dict, error, retry_count)
    await message.reject(requeue=False)

    # Email alert (fire-and-forget, không block)
    asyncio.create_task(send_dlq_alert(
        pr_id=event_dict.get("pr_id") or 0,
        repo=event_dict.get("repo") or "",
        pr_title=event_dict.get("pr_title") or "",
        error=error,
        retry_count=retry_count,
    ))


# =============================================================================
# DLQ publish
# =============================================================================

async def _publish_to_dlq(
    channel: aio_pika.abc.AbstractChannel,
    event_dict: dict,
    error: str,
    retry_count: int,
) -> None:
    """Publish message thất bại vào pr_events.dlq."""
    await channel.declare_exchange(EXCHANGE_DLQ, aio_pika.ExchangeType.DIRECT, durable=True)
    dlq: aio_pika.abc.AbstractQueue = await channel.declare_queue(QUEUE_DLQ, durable=True)
    await dlq.bind(EXCHANGE_DLQ, routing_key=QUEUE_DLQ)

    dlq_payload = {
        "original": event_dict,
        "failed_at": datetime.now(timezone.utc).isoformat(),
        "error": error,
        "retry_count": retry_count,
    }
    exchange = await channel.get_exchange(EXCHANGE_DLQ)
    await exchange.publish(
        aio_pika.Message(
            body=json.dumps(dlq_payload, ensure_ascii=False).encode(),
            delivery_mode=aio_pika.DeliveryMode.PERSISTENT,
            content_type="application/json",
        ),
        routing_key=QUEUE_DLQ,
    )
    logger.warning(
        "[PREventWorker] PR #%s moved to DLQ after %d retries: %s",
        event_dict.get("pr_id"), retry_count, error,
    )


# =============================================================================
# Credentials helper
# =============================================================================

def _load_pipeline_credentials() -> str:
    """
    Đọc pipeline credentials theo thứ tự ưu tiên:
    1. PIPELINE_CREDENTIALS_JSON env var (explicit JSON string)
    2. File tại PIPELINE_CRED_PATH (mặc định /root/.claude/.credentials.json)
    Trả về "" nếu không có nguồn nào.
    """
    cred_json = os.getenv("PIPELINE_CREDENTIALS_JSON", "")
    if cred_json:
        return cred_json

    cred_path = Path(os.getenv("PIPELINE_CRED_PATH", "/root/.claude/.credentials.json"))
    if cred_path.exists():
        return cred_path.read_text(encoding="utf-8")

    return ""


# =============================================================================
# Payload builder
# =============================================================================

def _classify_repo_type(raw: str | None) -> str:
    """
    Chuẩn hoá repo_type từ LLM output về 4 giá trị: frontend/backend/fullstack/unknown.

    Order of checks:
      1. Exact-string match cho 4 giá trị canonical → trả ngay (fix bug "fullstack"
         literal trước đây bị rơi vào unknown vì substring "frontend"/"backend"
         không có trong "fullstack")
      2. Substring fallback cho LLM trả format placeholder ("backend | frontend",
         "fe", "be", "BackendService", v.v.)
    """
    s = (raw or "").lower().strip()
    if s in ("fullstack", "frontend", "backend", "unknown"):
        return s
    has_fe = "frontend" in s or s == "fe"
    has_be = "backend"  in s or s == "be"
    if has_fe and has_be:
        return "fullstack"
    if has_fe:
        return "frontend"
    if has_be:
        return "backend"
    return "unknown"


def _is_frontend_ref(ref: dict) -> bool:
    """Đoán reference thuộc FE dựa vào file_path/url."""
    path = (ref.get("file_path") or ref.get("url") or "").lower()
    return any(t in path for t in (
        "angular", "react", ".ts", ".tsx", ".vue", ".jsx",
        "component", "frontend", "src/app",
    ))


def _build_gap_item(row: dict, uc_id: str, uc_name: str) -> dict:
    """Build gap item từ một drift row, giữ đầy đủ EAS + references."""
    srs  = row.get("srs")  if isinstance(row.get("srs"),  dict) else {}
    code = row.get("code") if isinstance(row.get("code"), dict) else {}

    # Ưu tiên SRS action làm "name" cho dễ đọc, fallback code.action
    name = srs.get("action") or code.get("action") or row.get("name") or ""

    drift_detail = row.get("drift_detail") or ""
    tag = _normalize_tag(row.get("tag") or row.get("drift_label") or "missing")

    return {
        # Human-readable identity
        "name":                   name,
        "step_number":            row.get("step"),
        "tag":                    tag,
        "drift_label":            row.get("drift_label") or "",
        "drift_detail":           drift_detail,
        # UC context
        "requirement_id":         uc_id,
        "requirement_description": uc_name,
        "srs_section":            row.get("srs_section") or "",
        # Drift reason / error
        "error_message":          drift_detail or row.get("error_message") or "",
        "tag_reason":             drift_detail or row.get("tag_reason") or "",
        "assertion_logic":        code.get("action") or row.get("assertion_logic") or "",
        "duration_ms":            row.get("duration_ms") or 0,
        # EAS — SRS side
        "srs_actor":              srs.get("actor")     or "",
        "srs_event":              srs.get("event")     or "",
        "srs_action":             srs.get("action")    or "",
        "srs_state":              srs.get("state")     or "",
        "srs_guard_br":           srs.get("guard_br")  or srs.get("guard") or "",
        # EAS — Code side
        "code_actor":             code.get("actor")    or "",
        "code_event":             code.get("event")    or "",
        "code_action":            code.get("action")   or "",
        "code_state":             code.get("state")    or "",
        "code_guard":             code.get("guard")    or "",
        # Reference arrays (giữ nguyên cấu trúc)
        "srs_references":         row.get("srs_references")  or [],
        "code_references":        row.get("code_references") or [],
    }


def _build_surplus_item(s: dict) -> dict:
    """Build surplus item. title ưu tiên action/id để không rỗng khi LLM không set."""
    return {
        "id":               s.get("id") or "",
        "title":            s.get("title") or s.get("action") or s.get("name") or s.get("id") or "",
        "reason":           s.get("reason") or "",
        "confidence":       s.get("confidence") or "",
        "actor":            s.get("actor")  or "",
        "event":            s.get("event")  or "",
        "action":           s.get("action") or "",
        "state":            s.get("state")  or "",
        "guard":            s.get("guard")  or "",
        "code_references":  s.get("code_references") or [],
    }


def _root_cause_signature(row: dict) -> frozenset[str]:
    """
    Trích "signal tokens" structural khỏi drift_detail/tag_reason để nhận diện
    cùng root cause. Universal patterns (không hardcode theo ngôn ngữ):

      - Business Rule IDs:    BR-1, BR-35, BR-42, ...
      - Exception markers:    [E1], [E2], E1, E2, ...
      - HTTP status codes:    401, 403, 404, 500, 503, ...
      - Use Case IDs:         UC-46, UC-7, ...

    Trả về frozenset rỗng nếu row không có pattern nào → row sẽ giữ nguyên,
    không tham gia dedup (tránh collapse oan rows khác biệt mà text na ná).
    """
    import re
    text = ((row.get("drift_detail") or "") + " "
            + (row.get("tag_reason") or "")).lower()

    tokens: set[str] = set()
    for m in re.findall(r"br-\d+", text):
        tokens.add(m)
    for m in re.findall(r"\[?e\d+\]?", text):
        tokens.add(m.strip("[]"))
    for m in re.findall(r"\b(40[0-4]|409|500|502|503)\b", text):
        tokens.add(f"http-{m}")
    for m in re.findall(r"uc-\d+", text):
        tokens.add(m)
    return frozenset(tokens)


def _dedupe_gap_rows_by_root_cause(gap_rows: list[dict]) -> list[dict]:
    """
    Group gap_rows có cùng root cause thành 1 representative entry, loại bỏ
    inflation từ EAS step-by-step decomposition (1 conceptual defect → nhiều rows).

    Strategy:
      1. Skip rows tag=="matching" (mỗi match là evidence riêng biệt)
      2. Compute structural signature (BR IDs, exception markers, HTTP codes)
      3. Group bằng SUBSET MATCHING: row A và row B cùng group nếu signature
         của một bên là subset của bên kia (e.g., {BR-35} ⊆ {BR-35,E2,401})
      4. Representative = row có drift_detail dài nhất trong group (info richest)
      5. Annotate representative với merged_step_numbers + suffix in drift_detail

    Rows không có signature (no BR/E/HTTP token) được giữ nguyên — không dedup
    để tránh collapse oan những finding khác biệt mà text nhìn na ná.
    """
    if not gap_rows:
        return gap_rows

    # Step 1: tách matching rows ra (giữ nguyên thứ tự gốc), còn lại đem dedup
    output: list[dict] = []
    candidates: list[tuple[int, dict, frozenset[str]]] = []
    for idx, row in enumerate(gap_rows):
        tag = (row.get("tag") or "").lower()
        sig = _root_cause_signature(row) if tag != "matching" else frozenset()
        if tag == "matching" or not sig:
            output.append(row)
        else:
            candidates.append((idx, row, sig))

    # Step 2: greedy grouping bằng subset matching
    # groups[i] = list of (idx, row, sig) sharing root cause
    groups: list[list[tuple[int, dict, frozenset[str]]]] = []
    for cand in candidates:
        _, _, sig = cand
        merged = False
        for grp in groups:
            grp_sigs = [s for _, _, s in grp]
            if any(sig.issubset(gs) or gs.issubset(sig) for gs in grp_sigs):
                grp.append(cand)
                merged = True
                break
        if not merged:
            groups.append([cand])

    # Step 3: collapse mỗi group thành 1 representative
    total_merged = 0
    for grp in groups:
        if len(grp) == 1:
            output.append(grp[0][1])
            continue

        # Representative = row có drift_detail dài nhất (nhiều info nhất)
        rep = max(grp, key=lambda c: len(c[1].get("drift_detail") or ""))
        rep_row = dict(rep[1])  # shallow copy để không mutate original

        steps = sorted({
            c[1].get("step")
            for c in grp
            if c[1].get("step") is not None
        })
        rep_row["merged_step_numbers"] = steps

        if len(steps) > 1:
            steps_str = ", ".join(str(s) for s in steps)
            original_detail = rep_row.get("drift_detail") or ""
            rep_row["drift_detail"] = (
                f"{original_detail} "
                f"(Vấn đề tương tự xuất hiện ở các bước SRS: {steps_str})"
            ).strip()

        output.append(rep_row)
        total_merged += len(grp) - 1

    if total_merged > 0:
        logger.info(
            f"[Dedup] Collapsed {total_merged} redundant gap_rows by root cause; "
            f"{len(gap_rows)} → {len(output)}"
        )
    return output


def _build_gap_result_payload(
    pr_id: int | None,
    repo: str,
    pr_title: str,
    team_id: str,
    drift: dict,
) -> dict:
    """
    Chuyển GapFindingResult.drift_report sang gap_results wire format.
    Wire format phải khớp với GapResultMessage trong server/services/gapResultTranslator.ts.

    Apply dedupe trước khi build wire format để giảm verbosity từ EAS
    step-by-step decomposition (1 conceptual defect → nhiều rows).
    """
    gap_rows: list[dict] = _dedupe_gap_rows_by_root_cause(
        drift.get("gap_rows", []) or []
    )
    surplus_items_src: list[dict] = drift.get("surplus_items", [])

    uc_id     = drift.get("uc_id")   or ""
    uc_name   = drift.get("uc_name") or ""
    repo_type = _classify_repo_type(drift.get("repo_type"))

    # Build gap items với EAS + references đầy đủ
    all_gaps = [_build_gap_item(row, uc_id, uc_name) for row in gap_rows]

    # Phân loại theo repo_type (thay cho row.layer vốn luôn rỗng).
    # Với fullstack: dò file_path trong code_references.
    frontend_gaps: list[dict] = []
    backend_gaps:  list[dict] = []
    business_gaps: list[dict] = []
    for g in all_gaps:
        if repo_type == "frontend":
            frontend_gaps.append(g)
        elif repo_type == "backend":
            backend_gaps.append(g)
        elif repo_type == "fullstack":
            is_fe = any(_is_frontend_ref(r) for r in g.get("code_references") or [])
            (frontend_gaps if is_fe else backend_gaps).append(g)
        else:
            business_gaps.append(g)

    matching = sum(1 for g in all_gaps if g["tag"] == "matching")
    mismatch = sum(1 for g in all_gaps if g["tag"] == "mismatch")
    missing  = sum(1 for g in all_gaps if g["tag"] == "missing")

    return {
        "pr_id": pr_id,
        "team_id": team_id,
        "repo": repo,
        "repo_type": repo_type,
        "pr_title": pr_title,
        "verdict_summary": {
            "total":    len(all_gaps),
            "matching": matching,
            "mismatch": mismatch,
            "missing":  missing,
        },
        "surplus_count": len(surplus_items_src),
        "error_summary": drift.get("error_summary") or "",
        "llm_cost_usd": 0,
        "run_at": datetime.now(timezone.utc).isoformat(),
        "source": "python_backend",
        "business_gaps": business_gaps,
        "frontend_gaps": frontend_gaps,
        "backend_gaps":  backend_gaps,
        "surplus_items": [_build_surplus_item(s) for s in surplus_items_src],
    }


def _normalize_tag(tag: str) -> str:
    tag = (tag or "").lower()
    if tag in ("match", "matching", "ok", "pass", "passed"):
        return "matching"
    if tag in ("mismatch", "drift", "changed", "fail", "failed"):
        return "mismatch"
    return "missing"


# =============================================================================
# Outbox write
# =============================================================================

async def _save_to_outbox(payload: dict) -> None:
    """
    Ghi gap result vào gap_result_outbox table.
    gap_result_outbox_relay.py sẽ đọc và publish lên RabbitMQ gap_results queue.
    """
    async with AsyncSessionLocal() as session:
        await session.execute(
            text(
                "INSERT INTO gap_result_outbox (payload, status, retry_count, created_at) "
                "VALUES (CAST(:payload AS jsonb), 'pending', 0, :created_at)"
            ),
            {
                "payload": json.dumps(payload, ensure_ascii=False),
                "created_at": datetime.now(timezone.utc),
            },
        )
        await session.commit()

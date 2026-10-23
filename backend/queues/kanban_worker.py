"""
Kanban Implement Worker — async RabbitMQ consumer.

Chạy trong cùng event loop với FastAPI (asyncio.create_task).
Consume từ [kanban.implement.requests], gọi _run_kanban_workflow(),
publish kết quả về [kanban.implement.results].
"""

import asyncio
import hashlib
import json
import logging
import os

import aio_pika
import aio_pika.abc
from sqlalchemy import select, text

from database import AsyncSessionLocal
from models.claude_credential import ClaudeCredential
from routers.kanban.kanban_implement import (
    KanbanImplementRequest,
    _run_kanban_workflow,
    _acquire_slot,
    _release_slot,
)
from rag_state import _request_credentials, _request_user_id, decrypt_credentials

logger = logging.getLogger(__name__)

QUEUE_REQUESTS = "kanban.implement.requests"
QUEUE_RESULTS = "kanban.implement.results"

_RECONNECT_DELAY_BASE = 5   # giây
_RECONNECT_DELAY_MAX = 60   # giây


async def start_kanban_worker() -> None:
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
            logger.info("[KanbanWorker] Cancelled — shutting down")
            return
        except Exception as exc:
            logger.error(
                "[KanbanWorker] Connection lost: %s — reconnecting in %ds", exc, delay
            )
            await asyncio.sleep(delay)
            delay = min(delay * 2, _RECONNECT_DELAY_MAX)
        else:
            # _run_consumer trả về bình thường → không nên xảy ra, nhưng vẫn reconnect
            delay = _RECONNECT_DELAY_BASE


async def _run_consumer(rabbitmq_url: str) -> None:
    """Kết nối RabbitMQ và bắt đầu consume. Block cho đến khi mất kết nối."""
    logger.info("[KanbanWorker] Connecting to RabbitMQ: %s", rabbitmq_url)

    connection: aio_pika.abc.AbstractConnection = await asyncio.wait_for(
        aio_pika.connect(rabbitmq_url, heartbeat=60),
        timeout=30.0,
    )

    async with connection:
        channel: aio_pika.abc.AbstractChannel = await connection.channel()

        # prefetch_count=1: chỉ nhận 1 message tại một thời điểm per worker instance.
        # Rate limiting thực sự được xử lý bởi _acquire_slot (max 3 concurrent per user).
        await channel.set_qos(prefetch_count=1)

        # Khai báo queue requests — idempotent, safe khi restart
        # QUEUE_RESULTS không cần khai báo ở đây: kanban_result_outbox_relay publish trực tiếp
        request_queue: aio_pika.abc.AbstractQueue = await channel.declare_queue(
            QUEUE_REQUESTS, durable=True
        )

        logger.info("[KanbanWorker] Ready — consuming from %s", QUEUE_REQUESTS)

        async with request_queue.iterator() as queue_iter:
            async for message in queue_iter:
                await _handle_message(channel, message)


async def _handle_message(
    channel: aio_pika.abc.AbstractChannel,
    message: aio_pika.abc.AbstractIncomingMessage,
) -> None:
    """Xử lý một message từ kanban.implement.requests."""
    async with message.process(ignore_processed=True):
        try:
            payload = json.loads(message.body.decode())
        except Exception as exc:
            logger.error("[KanbanWorker] Invalid JSON payload: %s", exc)
            await message.reject(requeue=False)
            return

        card_id: str = payload.get("cardId", "")
        user_id: str = payload.get("userId", "")

        logger.info(
            "[KanbanWorker] Received task — cardId=%r, userId=%r", card_id, user_id
        )

        # Lấy credentials từ DB theo userId (giống get_claude_credentials dependency)
        credentials_json = await _fetch_credentials(user_id)
        if credentials_json is None:
            logger.error(
                "[KanbanWorker] Credentials not found for userId=%r — rejecting", user_id
            )
            result_payload = {
                "cardId": card_id,
                "userId": user_id,
                "ip": payload.get("ip", ""),
                "success": False,
                "error": "Claude credentials missing. Please connect your Claude account.",
            }
            await _write_result_outbox(result_payload)
            await message.reject(requeue=False)
            return

        # Set context vars để _call_claude_cli_async có thể đọc credentials
        token_creds = _request_credentials.set(credentials_json)
        token_user = _request_user_id.set(user_id)

        slot_acquired = await _acquire_slot(user_id)
        if not slot_acquired:
            # Quá giới hạn concurrent — requeue để xử lý sau
            logger.warning(
                "[KanbanWorker] Rate limit hit for userId=%r — requeuing", user_id
            )
            await message.reject(requeue=True)
            _request_credentials.reset(token_creds)
            _request_user_id.reset(token_user)
            return

        try:
            request = KanbanImplementRequest(
                card_id=card_id,
                card_title=payload.get("cardTitle", ""),
                card_description=payload.get("cardDescription"),
                related_documents=payload.get("relatedDocuments", []),
                related_documents_with_content=payload.get(
                    "relatedDocumentsWithContent", []
                ),
                impact_analysis_items=payload.get("impactAnalysisItems", []),
            )

            ai_result = await _run_kanban_workflow(request)

            result_payload = {
                "cardId": card_id,
                "userId": user_id,
                "ip": payload.get("ip", ""),
                "success": True,
                "action": ai_result.action,
                "reasoning": ai_result.reasoning,
                "documentsToCreate": (
                    [d.model_dump() for d in ai_result.documents_to_create]
                    if ai_result.documents_to_create
                    else None
                ),
                "targetDocumentId": ai_result.target_document_id,
                "documentChanges": (
                    [_serialize_document_change(c) for c in ai_result.document_changes]
                    if ai_result.document_changes
                    else None
                ),
                "deleteDocumentIds": ai_result.delete_document_ids,
                "deleteDocumentTitles": ai_result.delete_document_titles,
            }

            logger.info(
                "[KanbanWorker] Workflow done — cardId=%r, action=%r",
                card_id,
                ai_result.action,
            )

        except Exception as exc:
            logger.error(
                "[KanbanWorker] Workflow failed — cardId=%r: %s", card_id, exc,
                exc_info=True,
            )
            result_payload = {
                "cardId": card_id,
                "userId": user_id,
                "ip": payload.get("ip", ""),
                "success": False,
                "error": str(exc),
            }

        finally:
            await _release_slot(user_id)
            _request_credentials.reset(token_creds)
            _request_user_id.reset(token_user)

        # Ghi kết quả vào outbox — kanban_result_outbox_relay publish lên RabbitMQ
        await _write_result_outbox(result_payload)

        logger.info(
            "[KanbanWorker] Result written to outbox — cardId=%r, success=%s",
            card_id,
            result_payload.get("success"),
        )


async def _write_result_outbox(result_payload: dict) -> None:
    """Ghi kết quả vào kanban_result_outbox để relay publish lên RabbitMQ."""
    async with AsyncSessionLocal() as session:
        await session.execute(
            text(
                "INSERT INTO kanban_result_outbox (payload) "
                "VALUES (CAST(:payload AS jsonb))"
            ),
            {"payload": json.dumps(result_payload, ensure_ascii=False)},
        )
        await session.commit()

    logger.debug(
        "[KanbanWorker] Outbox record created for cardId=%r",
        result_payload.get("cardId"),
    )


async def _fetch_credentials(user_id: str) -> str | None:
    """Query DB để lấy Claude credentials theo userId (same logic as get_claude_credentials)."""
    user_key_hash = hashlib.sha256(user_id.encode()).hexdigest()
    try:
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(ClaudeCredential).where(ClaudeCredential.user_key == user_key_hash)
            )
            cred = result.scalar_one_or_none()
            if not cred:
                return None
            credentials_dict = json.loads(decrypt_credentials(cred.credentials_encrypted))
            return json.dumps(credentials_dict)
    except Exception as exc:
        logger.error("[KanbanWorker] Failed to fetch credentials: %s", exc)
        return None


def _serialize_document_change(change) -> dict:
    return {
        "documentId": change.document_id,
        "documentTitle": change.document_title,
        "changesSummary": change.changes_summary,
        "isUserProvided": change.is_user_provided,
        "textEdits": [
            {
                "oldString": e.old_string,
                "newString": e.new_string,
                "description": e.description,
            }
            for e in (change.text_edits or [])
        ],
    }

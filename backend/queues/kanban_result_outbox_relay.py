"""
Kanban Result Outbox Relay — publishes pending kanban results from DB to RabbitMQ.

Chạy như asyncio background task được start từ main.py lifespan.

Flow:
    1. Poll kanban_result_outbox mỗi POLL_INTERVAL_S giây
    2. Với mỗi record status='pending': publish payload lên kanban.implement.results queue
    3. Thành công → set status='published', published_at=now()
    4. Thất bại  → tăng retry_count
                 → nếu retry_count >= MAX_RETRIES → set status='failed'
                 → ngược lại giữ 'pending' cho lần poll tiếp theo

Design notes:
    - FOR UPDATE SKIP LOCKED: tránh nhiều relay instance xử lý cùng record
    - Kết nối RabbitMQ per-publish (stateless): đơn giản, chịu được restart RabbitMQ
    - Pattern port từ gap_result_outbox_relay.py
"""

import asyncio
import json
import logging
import os
from datetime import datetime, timezone

import aio_pika
from sqlalchemy import text

from database import AsyncSessionLocal

logger = logging.getLogger(__name__)

POLL_INTERVAL_S = int(os.getenv("OUTBOX_RELAY_POLL_INTERVAL_S", "5"))
MAX_RETRIES = int(os.getenv("OUTBOX_RELAY_MAX_RETRIES", "10"))
BATCH_SIZE = int(os.getenv("OUTBOX_RELAY_BATCH_SIZE", "20"))

QUEUE_RESULTS = "kanban.implement.results"


# =============================================================================
# Entry point
# =============================================================================

async def start_kanban_result_outbox_relay() -> None:
    """
    Entry point — được gọi bằng asyncio.create_task() trong main.py lifespan.
    """
    rabbitmq_url = os.getenv("RABBITMQ_URL", "amqp://guest:guest@localhost:5672/")
    logger.info(
        "[KanbanResultRelay] Started — poll_interval=%ds batch=%d max_retries=%d",
        POLL_INTERVAL_S, BATCH_SIZE, MAX_RETRIES,
    )
    while True:
        try:
            await _run_once(rabbitmq_url)
        except asyncio.CancelledError:
            logger.info("[KanbanResultRelay] Cancelled — shutting down")
            return
        except Exception as exc:
            logger.error("[KanbanResultRelay] Unexpected error in poll cycle: %s", exc)
        await asyncio.sleep(POLL_INTERVAL_S)


# =============================================================================
# Single poll cycle
# =============================================================================

async def _run_once(rabbitmq_url: str) -> None:
    """Xử lý một batch pending outbox records."""
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            text(
                "SELECT id, payload FROM kanban_result_outbox "
                "WHERE status = 'pending' "
                "ORDER BY created_at "
                "LIMIT :batch_size "
                "FOR UPDATE SKIP LOCKED"
            ),
            {"batch_size": BATCH_SIZE},
        )
        rows = result.fetchall()

        if not rows:
            return

        for row in rows:
            record_id: int = row[0]
            payload_raw = row[1]
            payload: dict = payload_raw if isinstance(payload_raw, dict) else json.loads(payload_raw)

            try:
                await _publish(payload, rabbitmq_url)

                await session.execute(
                    text(
                        "UPDATE kanban_result_outbox "
                        "SET status='published', published_at=:published_at "
                        "WHERE id=:id"
                    ),
                    {"published_at": datetime.now(timezone.utc), "id": record_id},
                )
                await session.commit()

                logger.info(
                    "[KanbanResultRelay] Published outbox id=%s cardId=%s",
                    record_id, payload.get("cardId"),
                )

            except Exception as exc:
                await session.rollback()

                await session.execute(
                    text(
                        "UPDATE kanban_result_outbox "
                        "SET retry_count = retry_count + 1, "
                        "    status = CASE "
                        "        WHEN retry_count + 1 >= :max_retries THEN 'failed' "
                        "        ELSE 'pending' "
                        "    END "
                        "WHERE id = :id"
                    ),
                    {"max_retries": MAX_RETRIES, "id": record_id},
                )
                await session.commit()

                logger.warning(
                    "[KanbanResultRelay] Outbox id=%s publish failed: %s", record_id, exc
                )


# =============================================================================
# Publish helper
# =============================================================================

async def _publish(payload: dict, rabbitmq_url: str) -> None:
    """Publish một payload lên kanban.implement.results RabbitMQ queue."""
    connection = await asyncio.wait_for(
        aio_pika.connect(rabbitmq_url, heartbeat=60),
        timeout=15.0,
    )
    async with connection:
        channel = await connection.channel()
        await channel.declare_queue(QUEUE_RESULTS, durable=True)
        await channel.default_exchange.publish(
            aio_pika.Message(
                body=json.dumps(payload, ensure_ascii=False).encode(),
                delivery_mode=aio_pika.DeliveryMode.PERSISTENT,
                content_type="application/json",
            ),
            routing_key=QUEUE_RESULTS,
        )

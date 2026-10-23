"""
Team Event Consumer

Consumes 'team_events' from RabbitMQ published by Outline when a team's
lifecycle state changes. Updates the status field in the gap-finding module's
own github_configs table so the pipeline respects suspended/deleted teams.

Events handled:
    team.deleted     → status = deleted
    team.suspended   → status = suspended
    team.reactivated → status = active

Resilience:
    - Retries up to MAX_RETRIES times before routing to DLQ
    - Reconnects automatically on connection loss
"""

import json
import logging
import os
import time

import pika

from pr_webhook_module.workers.translators.team_event_translator import translate_team_event

logger = logging.getLogger(__name__)

EXCHANGE_NAME = "team_events"
QUEUE_NAME = "team_events"
DLQ_EXCHANGE = "team_events.dlx"
DLQ_NAME = "team_events.dlq"

MAX_RETRIES = 3
RECONNECT_DELAY = 5  # seconds

# =============================================================================
# Handler
# =============================================================================

def _handle(msg: dict, session) -> None:
    from pr_webhook_module.db.models import GithubConfig, ConfigStatus

    team_id = msg["team_id"]
    rows = (
        session.query(GithubConfig)
        .filter_by(team_id=team_id)
        .update({"status": ConfigStatus(msg["status"])})
    )
    session.commit()
    logger.info(f"[TeamEventConsumer] Team {team_id} → {msg['event']} (rows={rows})")


# =============================================================================
# DLQ
# =============================================================================

def _publish_to_dlq(channel, body: bytes, error: str, retry_count: int) -> None:
    try:
        channel.exchange_declare(exchange=DLQ_EXCHANGE, exchange_type="direct", durable=True)
        channel.queue_declare(queue=DLQ_NAME, durable=True)
        channel.queue_bind(queue=DLQ_NAME, exchange=DLQ_EXCHANGE, routing_key=DLQ_NAME)

        try:
            original = json.loads(body)
        except Exception:
            original = body.decode(errors="replace")

        dlq_payload = json.dumps({
            "original": original,
            "failed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "error": error,
            "retry_count": retry_count,
        }).encode()

        channel.basic_publish(
            exchange=DLQ_EXCHANGE,
            routing_key=DLQ_NAME,
            body=dlq_payload,
            properties=pika.BasicProperties(delivery_mode=2),
        )
        logger.error(
            f"[TeamEventConsumer] Message moved to DLQ after {retry_count} retries. Error: {error}")
    except Exception as exc:
        logger.error(f"[TeamEventConsumer] Failed to publish to DLQ: {exc}")


# =============================================================================
# Message handler
# =============================================================================

def _on_message(ch, method, properties, body, session) -> None:
    try:
        raw = json.loads(body)
        try:
            msg = translate_team_event(raw)
        except ValueError as e:
            logger.debug(f"[TeamEventConsumer] Skipping message: {e}")
            ch.basic_ack(delivery_tag=method.delivery_tag)
            return
        _handle(msg, session)
        ch.basic_ack(delivery_tag=method.delivery_tag)

    except Exception as exc:
        logger.error(f"[TeamEventConsumer] Failed to process: {exc}", exc_info=True)
        session.rollback()

        # Ack first to prevent auto-requeue, then decide retry vs DLQ
        ch.basic_ack(delivery_tag=method.delivery_tag)

        headers = properties.headers or {}
        retry_count = headers.get("x-retry-count", 0) + 1

        if retry_count <= MAX_RETRIES:
            logger.warning(f"[TeamEventConsumer] Retry {retry_count}/{MAX_RETRIES}")
            ch.basic_publish(
                exchange=EXCHANGE_NAME,
                routing_key=QUEUE_NAME,
                body=body,
                properties=pika.BasicProperties(
                    delivery_mode=2,
                    headers={"x-retry-count": retry_count},
                ),
            )
        else:
            _publish_to_dlq(ch, body, str(exc), retry_count)


# =============================================================================
# Entry point
# =============================================================================

def run() -> None:
    from pr_webhook_module.db.database import init_db, get_session

    broker_url = os.getenv("CELERY_BROKER_URL", "amqp://guest:guest@localhost:5672//")
    init_db()

    while True:
        session = None
        try:
            params = pika.URLParameters(broker_url)
            connection = pika.BlockingConnection(params)
            channel = connection.channel()

            channel.exchange_declare(exchange=EXCHANGE_NAME, exchange_type="direct", durable=True)
            channel.queue_declare(queue=QUEUE_NAME, durable=True)
            channel.queue_bind(queue=QUEUE_NAME, exchange=EXCHANGE_NAME, routing_key=QUEUE_NAME)
            channel.basic_qos(prefetch_count=1)

            session = get_session()
            channel.basic_consume(
                queue=QUEUE_NAME,
                on_message_callback=lambda ch, m, p, b: _on_message(ch, m, p, b, session),
            )

            logger.info(f"[TeamEventConsumer] Listening on '{QUEUE_NAME}'")
            channel.start_consuming()

        except Exception as exc:
            logger.error(
                f"[TeamEventConsumer] Connection error: {exc}. Reconnecting in {RECONNECT_DELAY}s...")
            if session:
                try:
                    session.close()
                except Exception:
                    pass
            time.sleep(RECONNECT_DELAY)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    run()

"""
GitHub Config Consumer (EIP: Content Filter)

Consumes 'github_config_events' from RabbitMQ.
Outline publishes the full github config payload; this consumer extracts
only the fields the gap-finding module needs and upserts into its own DB.

Events handled:
    config.upserted  — create or update config for a team
    config.deleted   — remove config for a team

Resilience:
    - Retries up to MAX_RETRIES times before routing to DLQ
    - Reconnects automatically on connection loss
"""

import json
import logging
import os
import time

import pika

from pr_webhook_module.workers.translators.config_event_translator import translate_config_event

logger = logging.getLogger(__name__)

EXCHANGE_NAME = "github_config_events"
QUEUE_NAME = "github_config_events"
DLQ_EXCHANGE = "github_config_events.dlx"
DLQ_NAME = "github_config_events.dlq"

MAX_RETRIES = 3
RECONNECT_DELAY = 5  # seconds


# =============================================================================
# Handlers
# =============================================================================

def _handle_upserted(config: dict, session) -> None:
    """Receives already-translated dict from _on_message (matches _handle_deleted)."""
    from pr_webhook_module.db.models import GithubConfig, ConfigStatus

    existing = session.query(GithubConfig).filter_by(team_id=config["team_id"]).first()
    if existing:
        existing.github_token = config["github_token"]
        existing.repositories = config["repositories"]
        existing.claude_project_dir = config["claude_project_dir"]
        existing.status = ConfigStatus.active
        logger.info(f"[ConfigConsumer] Updated config for team {config['team_id']}")
    else:
        session.add(GithubConfig(
            team_id=config["team_id"],
            github_token=config["github_token"],
            repositories=config["repositories"],
            claude_project_dir=config["claude_project_dir"],
        ))
        logger.info(f"[ConfigConsumer] Inserted config for team {config['team_id']}")

    session.commit()


def _handle_deleted(config: dict, session) -> None:
    from pr_webhook_module.db.models import GithubConfig
    team_id = config["team_id"]
    rows = session.query(GithubConfig).filter_by(team_id=team_id).delete()
    session.commit()
    logger.info(f"[ConfigConsumer] Deleted config for team {team_id} (rows={rows})")


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
            f"[ConfigConsumer] Message moved to DLQ after {retry_count} retries. Error: {error}")
    except Exception as exc:
        logger.error(f"[ConfigConsumer] Failed to publish to DLQ: {exc}")


# =============================================================================
# Message handler
# =============================================================================

def _on_message(ch, method, properties, body, session) -> None:
    try:
        raw = json.loads(body)
        event = raw.get("event")

        if event == "config.upserted":
            _handle_upserted(translate_config_event(raw), session)
        elif event == "config.deleted":
            _handle_deleted(translate_config_event(raw), session)
        else:
            logger.debug(f"[ConfigConsumer] Ignoring unknown event: {event}")
        ch.basic_ack(delivery_tag=method.delivery_tag)

    except Exception as exc:
        logger.error(f"[ConfigConsumer] Failed to process message: {exc}", exc_info=True)
        session.rollback()

        # Ack first to prevent auto-requeue, then decide retry vs DLQ
        ch.basic_ack(delivery_tag=method.delivery_tag)

        headers = properties.headers or {}
        retry_count = headers.get("x-retry-count", 0) + 1

        if retry_count <= MAX_RETRIES:
            logger.warning(f"[ConfigConsumer] Retry {retry_count}/{MAX_RETRIES}")
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

            logger.info(f"[ConfigConsumer] Listening on '{QUEUE_NAME}'")
            channel.start_consuming()

        except Exception as exc:
            logger.error(
                f"[ConfigConsumer] Connection error: {exc}. Reconnecting in {RECONNECT_DELAY}s...")
            if session:
                try:
                    session.close()
                except Exception:
                    pass
            time.sleep(RECONNECT_DELAY)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    run()

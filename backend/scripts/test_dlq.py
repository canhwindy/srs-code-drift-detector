"""
Test script — kích hoạt DLQ flow của pr_event_worker.

Publish một message hợp lệ vào pr_events queue với x-retry-count = MAX_RETRIES
để worker route thẳng sang DLQ + gửi email alert mà không cần chờ 4 lần retry.

Chạy trong container:
    docker exec -it outline-backend python /app/scripts/test_dlq.py
"""

import asyncio
import json
import os
from datetime import datetime, timezone

import aio_pika

RABBITMQ_URL = os.getenv("RABBITMQ_URL", "amqp://guest:guest@localhost:5672/")
QUEUE_NAME   = "pr_events"
MAX_RETRIES  = int(os.getenv("PR_EVENT_MAX_RETRIES", "4"))

TEST_EVENT = {
    "pr_id":        9999,
    "repo":         "test-org/test-repo",
    "pr_title":     "DLQ test PR",
    "team_id":      "test-team-id",
    "action":       "opened",
    "published_at": datetime.now(timezone.utc).isoformat(),
}


async def main() -> None:
    connection = await aio_pika.connect(RABBITMQ_URL)
    async with connection:
        channel = await connection.channel()
        await channel.declare_queue(QUEUE_NAME, durable=True)

        await channel.default_exchange.publish(
            aio_pika.Message(
                body=json.dumps(TEST_EVENT).encode(),
                delivery_mode=aio_pika.DeliveryMode.PERSISTENT,
                content_type="application/json",
                headers={"x-retry-count": MAX_RETRIES},
            ),
            routing_key=QUEUE_NAME,
        )

    print(f"[test_dlq] Published to '{QUEUE_NAME}' with x-retry-count={MAX_RETRIES}")
    print(f"[test_dlq] Payload: {json.dumps(TEST_EVENT, indent=2)}")
    print()
    print("Kỳ vọng:")
    print(f"  - backend log: '[PREventWorker] PR #9999 moved to DLQ after {MAX_RETRIES} retries'")
    print(f"  - RabbitMQ UI: queue 'pr_events.dlq' xuất hiện với 1 message")
    print(f"  - Email alert gửi đến DLQ_ALERT_EMAIL")


if __name__ == "__main__":
    asyncio.run(main())

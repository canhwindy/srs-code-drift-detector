"""
Test script: publish a valid gap_results message to RabbitMQ.
Dùng để kiểm tra gapFindingConsumer trên server có đọc và lưu DB không.

Usage:
    python test_gap_queue.py
    python test_gap_queue.py amqp://guest:guest@localhost:5672//
"""

import json
import sys
from datetime import datetime, timezone

from kombu import Connection, Exchange, Queue, Producer

BROKER_URL = sys.argv[1] if len(sys.argv) > 1 else "amqp://guest:guest@localhost:5672//"

PAYLOAD = {
    "pr_id": 9999,
    "repo": "org/test-repo",
    "repo_type": "backend",
    "pr_title": "[TEST] Queue consumer verification",
    "verdict_summary": {
        "total": 2,
        "matching": 1,
        "mismatch": 1,
        "missing": 0,
    },
    "surplus_count": 1,
    "error_summary": "",
    "llm_cost_usd": 0,
    "run_at": datetime.now(timezone.utc).isoformat(),
    "source": "test_script",
    "business_gaps": [],
    "frontend_gaps": [],
    "backend_gaps": [
        {
            "name": "User authentication check",
            "tag": "matching",
            "requirement_id": "REQ-001",
            "requirement_description": "System must authenticate users before granting access",
            "srs_section": "Backend",
            "error_message": "",
            "assertion_logic": "assert response.status_code == 200",
            "tag_reason": "Implementation matches requirement",
            "duration_ms": 120,
        },
        {
            "name": "Password complexity validation",
            "tag": "mismatch",
            "requirement_id": "REQ-002",
            "requirement_description": "Password must be at least 12 characters",
            "srs_section": "Backend",
            "error_message": "Current implementation only requires 8 characters",
            "assertion_logic": "assert len(password) >= 12",
            "tag_reason": "Minimum length differs from SRS",
            "duration_ms": 80,
        },
    ],
    "surplus_items": [
        {
            "id": "SURPLUS-001",
            "title": "Rate limiting middleware",
            "reason": "Not mentioned in SRS but implemented in code",
            "confidence": "high",
        }
    ],
}


def main():
    exchange = Exchange("gap_results", type="direct", durable=True)
    queue = Queue("gap_results", exchange=exchange, routing_key="gap_results", durable=True)

    print(f"Connecting to {BROKER_URL}...")
    with Connection(BROKER_URL) as conn:
        queue.bind(conn).declare()
        with conn.channel() as channel:
            producer = Producer(channel, exchange=exchange)
            producer.publish(
                PAYLOAD,
                routing_key="gap_results",
                delivery_mode=2,
                serializer="json",
            )
    print(f"✓ Message published to queue 'gap_results'")
    print(f"  PR: #{PAYLOAD['pr_id']} — {PAYLOAD['pr_title']}")
    print(f"  Repo: {PAYLOAD['repo']} ({PAYLOAD['repo_type']})")
    print(f"  Gaps: {PAYLOAD['verdict_summary']}")
    print()
    print("Kiểm tra DB: GapFinding với title '[BE] PR #9999 — org/test-repo' phải được tạo.")


if __name__ == "__main__":
    main()

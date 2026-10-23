"""
Test script: kiểm tra Outbox Pattern cho gap results.

Chạy từng scenario độc lập, không cần Celery hay Claude CLI.

Usage:
    python test_outbox.py                  # chạy tất cả scenarios
    python test_outbox.py save             # chỉ test _save_to_outbox
    python test_outbox.py relay            # chỉ test relay publish thành công
    python test_outbox.py retry            # chỉ test retry khi RabbitMQ down
    python test_outbox.py full             # save → relay → kiểm tra queue nhận được

Prerequisites:
    - GAPFINDING_DATABASE_URL  phải set (DB đang chạy, table đã tạo)
    - CELERY_BROKER_URL        phải set cho scenario relay/full (RabbitMQ đang chạy)

Ví dụ:
    GAPFINDING_DATABASE_URL=postgresql://user:pass@localhost:5432/gapfinding \
    CELERY_BROKER_URL=amqp://guest:guest@localhost:5672// \
    python test_outbox.py
"""

import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from dotenv import load_dotenv
load_dotenv(dotenv_path="../.env.local", override=False)

import logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Sample payload — giống format output của Claude CLI
# ---------------------------------------------------------------------------

SAMPLE_PAYLOAD = {
    "pr_id": 8888,
    "repo": "org/test-outbox-repo",
    "repo_type": "backend",
    "pr_title": "[TEST] Outbox pattern verification",
    "verdict_summary": {"total": 2, "matching": 1, "mismatch": 1, "missing": 0},
    "surplus_count": 0,
    "error_summary": "1 mismatch phát hiện trong authentication module",
    "llm_cost_usd": 0.0,
    "run_at": datetime.now(timezone.utc).isoformat(),
    "source": "test_outbox_script",
    "business_gaps": [],
    "frontend_gaps": [],
    "backend_gaps": [
        {
            "name": "Token expiry validation",
            "tag": "matching",
            "requirement_id": "REQ-AUTH-01",
            "requirement_description": "Token phải expire sau 24h",
            "srs_section": "Backend",
            "error_message": "",
            "assertion_logic": "assert token.expires_in == 86400",
            "tag_reason": "Implementation khớp SRS",
            "duration_ms": 100,
        },
        {
            "name": "Refresh token rotation",
            "tag": "mismatch",
            "requirement_id": "REQ-AUTH-02",
            "requirement_description": "Refresh token phải rotate sau mỗi lần dùng",
            "srs_section": "Backend",
            "error_message": "Refresh token không rotate — dùng lại được nhiều lần",
            "assertion_logic": "assert old_token != new_token",
            "tag_reason": "Code không implement rotation",
            "duration_ms": 90,
        },
    ],
    "surplus_items": [],
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_session():
    from pr_webhook_module.db.database import get_session
    return get_session()


def _cleanup(record_id: int) -> None:
    """Xoá record test khỏi DB sau khi test xong."""
    from pr_webhook_module.db.models import GapResultOutbox
    session = _get_session()
    try:
        session.query(GapResultOutbox).filter(GapResultOutbox.id == record_id).delete()
        session.commit()
        logger.info(f"[Cleanup] Deleted outbox id={record_id}")
    finally:
        session.close()


# ---------------------------------------------------------------------------
# Scenario 1: _save_to_outbox ghi đúng vào DB
# ---------------------------------------------------------------------------

def test_save_to_outbox() -> int:
    """
    Gọi _save_to_outbox() và kiểm tra record trong DB.
    Trả về id của record vừa tạo.
    """
    print("\n═══ Scenario 1: _save_to_outbox() ═══")

    from pr_webhook_module.workers.claude_runner import _save_to_outbox
    from pr_webhook_module.db.models import GapResultOutbox, OutboxStatus

    _save_to_outbox(SAMPLE_PAYLOAD)

    session = _get_session()
    try:
        record = (
            session.query(GapResultOutbox)
            .order_by(GapResultOutbox.created_at.desc())
            .first()
        )
        assert record is not None, "FAIL: record không tồn tại trong DB"
        assert record.payload.get("pr_id") == 8888, \
            f"FAIL: pr_id={record.payload.get('pr_id')}, expected 8888"
        assert record.status == OutboxStatus.pending, f"FAIL: status={record.status}, expected pending"
        assert record.retry_count == 0, f"FAIL: retry_count={record.retry_count}, expected 0"
        assert record.published_at is None, "FAIL: published_at phải là None"
        print(f"  ✓ Record id={record.id} lưu thành công — status=pending retry_count=0")
        return record.id
    finally:
        session.close()


# ---------------------------------------------------------------------------
# Scenario 2: relay publish thành công → status = published
# ---------------------------------------------------------------------------

def test_relay_publish(record_id: int) -> None:
    """
    Gọi _run_once() và kiểm tra record được đổi sang published.
    Yêu cầu RabbitMQ đang chạy.
    """
    print("\n═══ Scenario 2: relay publish thành công ═══")

    from pr_webhook_module.workers.outbox_relay import _run_once
    from pr_webhook_module.db.models import GapResultOutbox, OutboxStatus

    _run_once()

    session = _get_session()
    try:
        record = session.get(GapResultOutbox, record_id)
        assert record is not None, "FAIL: record không tìm thấy"
        assert record.status == OutboxStatus.published, \
            f"FAIL: status={record.status}, expected published"
        assert record.published_at is not None, "FAIL: published_at không được set"
        print(f"  ✓ Record id={record.id} published tại {record.published_at.isoformat()}")
        print(f"  ✓ Kiểm tra queue 'gap_results' trên RabbitMQ Management để xác nhận message.")
    finally:
        session.close()


# ---------------------------------------------------------------------------
# Scenario 3: relay retry khi RabbitMQ down
# ---------------------------------------------------------------------------

def test_relay_retry() -> None:
    """
    Thêm 1 record pending, patch _publish để luôn raise, gọi _run_once()
    và kiểm tra retry_count tăng mà record KHÔNG bị xoá.
    Không cần RabbitMQ thật.
    """
    print("\n═══ Scenario 3: retry khi publish fail ═══")

    from unittest.mock import patch
    from pr_webhook_module.workers.outbox_relay import _run_once
    from pr_webhook_module.db.models import GapResultOutbox, OutboxStatus
    from pr_webhook_module.workers.claude_runner import _save_to_outbox

    # Tạo 1 record mới riêng cho scenario này
    _save_to_outbox({**SAMPLE_PAYLOAD, "pr_id": 7777})

    session = _get_session()
    try:
        record = (
            session.query(GapResultOutbox)
            .order_by(GapResultOutbox.created_at.desc())
            .first()
        )
        assert record is not None
        assert record.payload.get("pr_id") == 7777
        rid = record.id
    finally:
        session.close()

    # Patch _publish để simulate RabbitMQ down
    with patch("pr_webhook_module.workers.outbox_relay._publish", side_effect=Exception("RabbitMQ down")):
        _run_once()

    session = _get_session()
    try:
        record = session.get(GapResultOutbox, rid)
        assert record is not None, "FAIL: record bị xoá — không được xoá khi fail"
        assert record.status == OutboxStatus.pending, \
            f"FAIL: status={record.status} sau lần fail đầu, expected pending"
        assert record.retry_count == 1, \
            f"FAIL: retry_count={record.retry_count}, expected 1"
        print(f"  ✓ Record id={rid} vẫn còn trong DB — status=pending retry_count=1")
    finally:
        session.close()

    # Patch tiếp đủ MAX_RETRIES lần để record → failed
    from pr_webhook_module.workers.outbox_relay import MAX_RETRIES
    with patch("pr_webhook_module.workers.outbox_relay._publish", side_effect=Exception("RabbitMQ down")):
        for _ in range(MAX_RETRIES - 1):
            _run_once()

    session = _get_session()
    try:
        record = session.get(GapResultOutbox, rid)
        assert record.status == OutboxStatus.failed, \
            f"FAIL: status={record.status} sau {MAX_RETRIES} lần fail, expected failed"
        assert record.retry_count >= MAX_RETRIES, \
            f"FAIL: retry_count={record.retry_count}, expected >= {MAX_RETRIES}"
        print(f"  ✓ Record id={rid} → status=failed sau {record.retry_count} lần retry")
    finally:
        session.close()
        _cleanup(rid)


# ---------------------------------------------------------------------------
# Scenario 4: full flow — save → relay → message xuất hiện trong queue
# ---------------------------------------------------------------------------

def test_full_flow() -> None:
    """
    End-to-end: _save_to_outbox → _run_once → consume message từ queue
    để xác nhận Node.js gapFindingConsumer sẽ nhận được đúng payload.
    """
    print("\n═══ Scenario 4: full flow (save → relay → consume từ queue) ═══")

    from pr_webhook_module.workers.claude_runner import _save_to_outbox
    from pr_webhook_module.workers.outbox_relay import _run_once
    from pr_webhook_module.db.models import GapResultOutbox, OutboxStatus
    from kombu import Connection, Exchange, Queue as KombuQueue

    payload = {**SAMPLE_PAYLOAD, "pr_id": 6666, "pr_title": "[TEST] Full flow"}
    _save_to_outbox(payload)

    session = _get_session()
    try:
        record = (
            session.query(GapResultOutbox)
            .order_by(GapResultOutbox.created_at.desc())
            .first()
        )
        assert record is not None
        assert record.payload.get("pr_id") == 6666
        rid = record.id
    finally:
        session.close()

    _run_once()

    # Đọc message từ queue để xác nhận payload đúng
    broker_url = os.getenv("CELERY_BROKER_URL", "amqp://guest:guest@localhost:5672//")
    exchange = Exchange("gap_results", type="direct", durable=True)
    queue = KombuQueue("gap_results", exchange=exchange, routing_key="gap_results", durable=True)

    received = None
    with Connection(broker_url) as conn:
        with conn.Consumer(queue, accept=["json"]) as consumer:
            def on_message(body, message):
                nonlocal received
                if body.get("pr_id") == 6666:
                    received = body
                    message.ack()
            consumer.callbacks = [on_message]
            conn.drain_events(timeout=3)

    assert received is not None, "FAIL: message không xuất hiện trong queue sau relay"
    assert received["pr_id"] == 6666
    assert received["source"] == "test_outbox_script"
    print(f"  ✓ Message PR #6666 nhận được từ queue — payload hợp lệ")
    print(f"  ✓ gapFindingConsumer (Node.js) sẽ lưu vào GapFinding + TestResult")

    session = _get_session()
    try:
        record = session.get(GapResultOutbox, rid)
        assert record.status == OutboxStatus.published
        print(f"  ✓ Outbox record id={rid} → status=published")
    finally:
        session.close()
        _cleanup(rid)


# ---------------------------------------------------------------------------
# Scenario 5: end-to-end với Node.js consumer — verify gap_findings DB
# ---------------------------------------------------------------------------

def test_node_consumer() -> None:
    """
    End-to-end thực sự:
        _save_to_outbox → relay publish → Node.js gapFindingConsumer nhận →
        lưu vào gap_findings + test_results (Outline DB).

    Không consume message trong test — để Node.js consumer là người duy nhất nhận.
    Đợi tối đa WAIT_S giây rồi check Outline DB.

    Yêu cầu:
        - GAPFINDING_DATABASE_URL  (gapfinding DB — outbox)
        - CELERY_BROKER_URL        (RabbitMQ)
        - DATABASE_URL             (Outline DB — gap_findings)
    """
    print("\n═══ Scenario 5: Node.js consumer → gap_findings DB ═══")

    outline_db_url = os.getenv("OUTLINE_DATABASE_URL") or os.getenv("DATABASE_URL", "")
    if not outline_db_url:
        print("  Bỏ qua — DATABASE_URL không set (Outline DB)")
        return
    # Trong Docker container, postgres chạy ở service name "outline-postgres"
    # chứ không phải "localhost" như trong .env.local
    if os.path.isdir("/app") and "localhost" in outline_db_url:
        outline_db_url = outline_db_url.replace("localhost", "outline-postgres")

    import psycopg2
    from pr_webhook_module.workers.claude_runner import _save_to_outbox
    from pr_webhook_module.workers.outbox_relay import _run_once
    from pr_webhook_module.db.models import GapResultOutbox, OutboxStatus

    PR_ID = 5555
    WAIT_S = 8   # thời gian đợi Node.js consumer xử lý

    payload = {
        **SAMPLE_PAYLOAD,
        "pr_id": PR_ID,
        "pr_title": "[TEST] Node consumer e2e",
        "source": "test_node_consumer",
    }
    expected_title = f"[BE] PR #{PR_ID} — {SAMPLE_PAYLOAD['repo']}"

    # 1. Lưu vào outbox
    _save_to_outbox(payload)

    session = _get_session()
    try:
        record = (
            session.query(GapResultOutbox)
            .order_by(GapResultOutbox.created_at.desc())
            .first()
        )
        assert record is not None
        assert record.payload.get("pr_id") == PR_ID
        rid = record.id
        print(f"  ✓ Outbox record id={rid} saved — status=pending")
    finally:
        session.close()

    # 2. Relay publish lên queue (KHÔNG consume ở đây)
    _run_once()

    session = _get_session()
    try:
        record = session.get(GapResultOutbox, rid)
        assert record.status == OutboxStatus.published, \
            f"FAIL: relay chưa publish — status={record.status}"
        print(f"  ✓ Relay published → message nằm trong queue, chờ Node.js xử lý...")
    finally:
        session.close()

    # 3. Đợi Node.js consumer xử lý
    print(f"  ... đợi {WAIT_S}s ...")
    time.sleep(WAIT_S)

    # 4. Kiểm tra gap_findings trong Outline DB
    conn = psycopg2.connect(outline_db_url)
    gap_finding_id = None
    try:
        with conn.cursor() as cur:
            cur.execute(
                'SELECT id, title, severity, status FROM gap_findings WHERE title = %s LIMIT 1',
                (expected_title,),
            )
            row = cur.fetchone()
            assert row is not None, (
                f"FAIL: không tìm thấy gap_findings với title='{expected_title}' — "
                f"Node.js consumer chưa xử lý hoặc bị lỗi"
            )
            gap_finding_id, title, severity, status = row
            print(f"  ✓ gap_findings: id={gap_finding_id} title='{title}' severity={severity} status={status}")

            # 5. Kiểm tra test_results (underscored: true → gap_finding_id)
            cur.execute(
                "SELECT COUNT(*) FROM test_results WHERE gap_finding_id = %s",
                (gap_finding_id,),
            )
            count = cur.fetchone()[0]
            assert count > 0, \
                f"FAIL: không có test_results nào cho gap_finding_id={gap_finding_id}"
            print(f"  ✓ test_results: {count} row(s) cho gap_finding_id={gap_finding_id}")
    finally:
        conn.close()

    # Cleanup outbox record (chỉ xóa bên gapfinding DB, giữ lại gap_findings để kiểm tra)
    _cleanup(rid)
    print(f"  → gap_findings id={gap_finding_id} được giữ lại trong Outline DB để kiểm tra thủ công")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    target = sys.argv[1] if len(sys.argv) > 1 else "all"

    if not os.getenv("GAPFINDING_DATABASE_URL"):
        print("ERROR: GAPFINDING_DATABASE_URL không set — không thể kết nối DB")
        sys.exit(1)

    errors = []

    def run(name, fn, *args):
        try:
            return fn(*args)
        except AssertionError as e:
            print(f"  {e}")
            errors.append(name)
            return None
        except Exception as e:
            print(f"  ERROR: {e}")
            errors.append(name)
            return None

    if target in ("all", "save", "relay"):
        record_id = run("save", test_save_to_outbox)

        if target in ("all", "relay") and record_id:
            if not os.getenv("CELERY_BROKER_URL"):
                print("\n[relay] Bỏ qua — CELERY_BROKER_URL không set")
            else:
                run("relay", test_relay_publish, record_id)
                _cleanup(record_id)

    if target in ("all", "retry"):
        run("retry", test_relay_retry)

    if target in ("all", "full"):
        if not os.getenv("CELERY_BROKER_URL"):
            print("\n[full] Bỏ qua — CELERY_BROKER_URL không set")
        else:
            run("full", test_full_flow)

    if target in ("all", "node"):
        if not os.getenv("CELERY_BROKER_URL"):
            print("\n[node] Bỏ qua — CELERY_BROKER_URL không set")
        else:
            run("node", test_node_consumer)

    print()
    if errors:
        print(f"FAILED: {errors}")
        sys.exit(1)
    else:
        print("Tất cả scenarios PASSED ✓")


if __name__ == "__main__":
    main()

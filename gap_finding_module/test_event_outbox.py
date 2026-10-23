"""
E2E test: Outbox Pattern cho github_config_events + team_events.

Flow được test:
  1. Insert record vào event_outbox trong Outline PostgreSQL
     (giả lập publishGithubConfigEvent / publishTeamEvent từ Node.js)
  2. outboxRelay (Node.js) poll, publish lên RabbitMQ
  3. Python consumer (config_consumer / team_event_consumer) xử lý, lưu vào github_configs
  4. Hiển thị kết quả cuối trong gap-finding DB

Yêu cầu trước khi chạy:
  - Node.js server đang chạy với SERVICES=...outboxrelay (đã migrate event_outbox)
  - config_consumer và team_event_consumer đang chạy trong gap-finding module
  - RabbitMQ đang hoạt động

Usage:
  # Copy vào container rồi chạy:
  docker cp gap_finding_module/test_event_outbox.py outline-gapfinding:/app/
  docker exec -it outline-gapfinding python test_event_outbox.py [scenario]

  # Chạy local:
  python test_event_outbox.py [scenario] [outline_db_url] [gapfinding_db_url]

Scenarios:
  upsert   — config.upserted → github_configs được tạo/cập nhật
  delete   — config.deleted  → github_configs bị xóa
  team     — team lifecycle: suspended → reactivated
  full     — toàn bộ: upsert → suspend → reactivate → delete (default)
"""

import json
import os
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from dotenv import load_dotenv
load_dotenv(dotenv_path="../.env.local", override=False)

# ── DB URLs ──────────────────────────────────────────────────────────────────

def _outline_db_url() -> str:
    url = sys.argv[2] if len(sys.argv) > 2 else os.getenv("DATABASE_URL", "")
    if not url:
        raise RuntimeError(
            "Outline DB URL không có. Set DATABASE_URL hoặc truyền làm tham số thứ 2."
        )
    # Trong Docker container: outline-postgres thay cho localhost
    if os.path.isdir("/app") and "localhost" in url:
        url = url.replace("localhost", "outline-postgres")
    return url


def _gapfinding_db_url() -> str:
    url = sys.argv[3] if len(sys.argv) > 3 else os.getenv("GAPFINDING_DATABASE_URL", "")
    if not url:
        raise RuntimeError(
            "Gap-finding DB URL không có. Set GAPFINDING_DATABASE_URL hoặc truyền làm tham số thứ 3."
        )
    return url


# ── Helpers: Outline DB (event_outbox) ───────────────────────────────────────

def _insert_outbox(outline_url: str, queue_name: str, payload: dict) -> str:
    """Insert một record pending vào event_outbox, trả về id (UUID string)."""
    import psycopg2
    record_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    with psycopg2.connect(outline_url) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO event_outbox
                    (id, queue_name, payload, status, retry_count, created_at, updated_at)
                VALUES (%s, %s, %s, 'pending', 0, %s, %s)
                """,
                (record_id, queue_name, json.dumps(payload), now, now),
            )
        conn.commit()
    return record_id


def _poll_outbox_published(outline_url: str, record_id: str, timeout: int = 20) -> dict:
    """Poll cho đến khi outboxRelay publish xong (status=published hoặc failed)."""
    import psycopg2
    deadline = time.time() + timeout
    while time.time() < deadline:
        with psycopg2.connect(outline_url) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT id, queue_name, status, retry_count, created_at, published_at "
                    "FROM event_outbox WHERE id = %s",
                    (record_id,),
                )
                row = cur.fetchone()
        if row:
            status = row[2]
            if status in ("published", "failed"):
                return {
                    "id": row[0],
                    "queue_name": row[1],
                    "status": status,
                    "retry_count": row[3],
                    "created_at": row[4],
                    "published_at": row[5],
                }
        time.sleep(1)
    raise TimeoutError(
        f"outboxRelay chưa publish sau {timeout}s. "
        "Kiểm tra SERVICES env có 'outboxrelay' và server đang chạy."
    )


def _cleanup_outbox(outline_url: str, record_id: str) -> None:
    import psycopg2
    with psycopg2.connect(outline_url) as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM event_outbox WHERE id = %s", (record_id,))
        conn.commit()


# ── Helpers: Gap-finding DB (github_configs) ─────────────────────────────────

def _get_github_config(gf_url: str, team_id: str) -> dict | None:
    import psycopg2
    with psycopg2.connect(gf_url) as conn:
        conn.rollback()
        with conn.cursor() as cur:
            cur.execute(
                "SELECT team_id, github_token, repositories, claude_project_dir, status, updated_at "
                "FROM github_configs WHERE team_id = %s",
                (team_id,),
            )
            row = cur.fetchone()
    if not row:
        return None
    return {
        "team_id": row[0],
        "github_token": row[1],
        "repositories": row[2],
        "claude_project_dir": row[3],
        "status": row[4],
        "updated_at": row[5],
    }


def _poll_github_config(
    gf_url: str,
    team_id: str,
    expected_status: str | None = "active",
    expect_deleted: bool = False,
    timeout: int = 20,
) -> dict | None:
    """Poll cho đến khi github_configs phản ánh trạng thái mong đợi."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        row = _get_github_config(gf_url, team_id)
        if expect_deleted and row is None:
            return None
        if not expect_deleted and row is not None:
            if expected_status is None or row["status"] == expected_status:
                return row
        time.sleep(1)
    if expect_deleted:
        raise TimeoutError(
            f"github_configs team_id={team_id} vẫn còn sau {timeout}s — "
            "kiểm tra config_consumer có đang chạy không."
        )
    raise TimeoutError(
        f"github_configs team_id={team_id} chưa có status='{expected_status}' sau {timeout}s — "
        "kiểm tra consumer có đang chạy không."
    )


def _print_github_configs(gf_url: str, team_id: str = None) -> None:
    """In toàn bộ (hoặc theo team_id) bảng github_configs."""
    import psycopg2
    with psycopg2.connect(gf_url) as conn:
        conn.rollback()
        with conn.cursor() as cur:
            if team_id:
                cur.execute(
                    "SELECT team_id, github_token, repositories, claude_project_dir, status, updated_at "
                    "FROM github_configs WHERE team_id = %s",
                    (team_id,),
                )
            else:
                cur.execute(
                    "SELECT team_id, github_token, repositories, claude_project_dir, status, updated_at "
                    "FROM github_configs ORDER BY updated_at DESC LIMIT 20"
                )
            rows = cur.fetchall()
    print(f"\n  ┌── github_configs ({'team_id=' + team_id if team_id else 'all'}) ─────────────────────────────")
    if not rows:
        print("  │  (empty)")
    for r in rows:
        repos = r[2] if isinstance(r[2], list) else []
        repo_names = [
            f"{rp.get('owner', '')}/{rp.get('repo', '')}" if isinstance(rp, dict)
            else str(rp)
            for rp in repos
        ]
        print(f"  │  team_id   : {r[0]}")
        print(f"  │  token     : {str(r[1])[:20]}..." if r[1] else "  │  token     : (none)")
        print(f"  │  repos     : {repo_names}")
        print(f"  │  proj_dir  : {r[3]}")
        print(f"  │  status    : {r[4]}")
        print(f"  │  updated_at: {r[5]}")
        print("  │")
    print("  └─────────────────────────────────────────────────────────")


# ── Test scenarios ────────────────────────────────────────────────────────────

SCENARIO = sys.argv[1] if len(sys.argv) > 1 else "full"

TEST_TEAM_ID = f"e2e-test-{uuid.uuid4().hex[:8]}"
CONFIG_PAYLOAD = {
    "event": "config.upserted",
    "teamId": TEST_TEAM_ID,
    "apiKey": "ghp_test_token_e2e_12345",
    "repositories": [
        {
            "url": f"https://github.com/e2e-org/test-repo",
            "owner": "e2e-org",
            "repo": "test-repo",
            "webhookSecret": "whs_test_secret",
        }
    ],
    "claudeProjectDir": "/projects/e2e-test",
    "userId": "user-e2e-test",
}
DELETE_PAYLOAD = {"event": "config.deleted", "teamId": TEST_TEAM_ID}
SUSPEND_PAYLOAD = {"event": "team.suspended", "teamId": TEST_TEAM_ID}
REACTIVATE_PAYLOAD = {"event": "team.reactivated", "teamId": TEST_TEAM_ID}
DELETED_PAYLOAD = {"event": "team.deleted", "teamId": TEST_TEAM_ID}


def step_upsert(outline_url: str, gf_url: str) -> None:
    """config.upserted → github_configs được tạo với status=active."""
    print("\n─── Step: config.upserted ─────────────────────────────────────")
    record_id = _insert_outbox(outline_url, "github_config_events", CONFIG_PAYLOAD)
    print(f"  ✓ Inserted event_outbox id={record_id} (queue=github_config_events, status=pending)")

    outbox = _poll_outbox_published(outline_url, record_id, timeout=20)
    print(f"  ✓ outboxRelay published — status={outbox['status']} published_at={outbox['published_at']}")
    assert outbox["status"] == "published", f"FAIL: outbox status={outbox['status']}"

    config = _poll_github_config(gf_url, TEST_TEAM_ID, expected_status="active", timeout=20)
    print(f"  ✓ github_configs created — status={config['status']}")
    _print_github_configs(gf_url, TEST_TEAM_ID)
    _cleanup_outbox(outline_url, record_id)


def step_suspend(outline_url: str, gf_url: str) -> None:
    """team.suspended → github_configs.status = suspended."""
    print("\n─── Step: team.suspended ──────────────────────────────────────")
    record_id = _insert_outbox(outline_url, "team_events", SUSPEND_PAYLOAD)
    print(f"  ✓ Inserted event_outbox id={record_id} (queue=team_events, status=pending)")

    outbox = _poll_outbox_published(outline_url, record_id, timeout=20)
    print(f"  ✓ outboxRelay published — status={outbox['status']} published_at={outbox['published_at']}")
    assert outbox["status"] == "published", f"FAIL: outbox status={outbox['status']}"

    config = _poll_github_config(gf_url, TEST_TEAM_ID, expected_status="suspended", timeout=20)
    print(f"  ✓ github_configs.status = {config['status']}")
    _print_github_configs(gf_url, TEST_TEAM_ID)
    _cleanup_outbox(outline_url, record_id)


def step_reactivate(outline_url: str, gf_url: str) -> None:
    """team.reactivated → github_configs.status = active."""
    print("\n─── Step: team.reactivated ────────────────────────────────────")
    record_id = _insert_outbox(outline_url, "team_events", REACTIVATE_PAYLOAD)
    print(f"  ✓ Inserted event_outbox id={record_id} (queue=team_events, status=pending)")

    outbox = _poll_outbox_published(outline_url, record_id, timeout=20)
    print(f"  ✓ outboxRelay published — status={outbox['status']} published_at={outbox['published_at']}")
    assert outbox["status"] == "published", f"FAIL: outbox status={outbox['status']}"

    config = _poll_github_config(gf_url, TEST_TEAM_ID, expected_status="active", timeout=20)
    print(f"  ✓ github_configs.status = {config['status']}")
    _print_github_configs(gf_url, TEST_TEAM_ID)
    _cleanup_outbox(outline_url, record_id)


def step_delete_config(outline_url: str, gf_url: str) -> None:
    """config.deleted → github_configs row bị xóa."""
    print("\n─── Step: config.deleted ──────────────────────────────────────")
    record_id = _insert_outbox(outline_url, "github_config_events", DELETE_PAYLOAD)
    print(f"  ✓ Inserted event_outbox id={record_id} (queue=github_config_events, status=pending)")

    outbox = _poll_outbox_published(outline_url, record_id, timeout=20)
    print(f"  ✓ outboxRelay published — status={outbox['status']} published_at={outbox['published_at']}")
    assert outbox["status"] == "published", f"FAIL: outbox status={outbox['status']}"

    _poll_github_config(gf_url, TEST_TEAM_ID, expect_deleted=True, timeout=20)
    print(f"  ✓ github_configs row đã bị xóa — team_id={TEST_TEAM_ID} không còn tồn tại")
    _cleanup_outbox(outline_url, record_id)


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    outline_url = _outline_db_url()
    gf_url = _gapfinding_db_url()

    print("=" * 65)
    print(f"  E2E Test: event_outbox Outbox Pattern")
    print(f"  Scenario : {SCENARIO}")
    print(f"  Team ID  : {TEST_TEAM_ID}")
    print(f"  Outline  : {outline_url[:50]}...")
    print(f"  GapFind  : {gf_url[:50]}...")
    print("=" * 65)
    print()
    print("  Yêu cầu:")
    print("    - Node.js server chạy với SERVICES=...outboxrelay")
    print("    - config_consumer + team_event_consumer đang chạy")
    print("    - Đã chạy: yarn db:migrate (bảng event_outbox tồn tại)")
    print()

    try:
        if SCENARIO == "upsert":
            step_upsert(outline_url, gf_url)

        elif SCENARIO == "delete":
            # Cần upsert trước rồi mới delete
            step_upsert(outline_url, gf_url)
            step_delete_config(outline_url, gf_url)

        elif SCENARIO == "team":
            # Upsert trước, rồi test team lifecycle
            step_upsert(outline_url, gf_url)
            step_suspend(outline_url, gf_url)
            step_reactivate(outline_url, gf_url)

        else:  # full
            step_upsert(outline_url, gf_url)
            step_suspend(outline_url, gf_url)
            step_reactivate(outline_url, gf_url)
            step_delete_config(outline_url, gf_url)

        print()
        print("=" * 65)
        print("  KẾT QUẢ: TẤT CẢ PASSED ✓")
        print("=" * 65)

        # Hiển thị toàn bộ github_configs sau khi test
        print("\n  [Gap-finding DB] github_configs — toàn bộ records hiện tại:")
        _print_github_configs(gf_url)

    except AssertionError as e:
        print(f"\n  FAILED: {e}")
        sys.exit(1)
    except TimeoutError as e:
        print(f"\n  TIMEOUT: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"\n  ERROR: {e}")
        raise


if __name__ == "__main__":
    main()

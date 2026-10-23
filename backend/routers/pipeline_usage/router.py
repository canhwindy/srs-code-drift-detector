"""
Pipeline Usage Router — đọc pipeline_usage.jsonl và trả array JSON.

Nguồn data: pr_event_worker._append_pipeline_usage_record() ghi 1 dòng JSON
mỗi lần gap-finding pipeline hoàn thành.

Endpoint: GET /api/pipeline-usage
Truy cập từ browser qua Outline Node proxy: /python-api/api/pipeline-usage
"""
import json
import logging
import os
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Query

logger = logging.getLogger(__name__)

_LOG_PATH = Path(
    os.getenv("PIPELINE_USAGE_LOG_PATH", "/app/logs/pipeline_usage.jsonl")
)

router = APIRouter(prefix="/api", tags=["Pipeline Usage"])


@router.get("/pipeline-usage")
def list_pipeline_usage(
    team_id: Optional[str] = Query(None, description="Filter theo team_id"),
    pr_id: Optional[int] = Query(None, description="Filter theo PR number"),
    limit: int = Query(100, ge=1, le=1000, description="Số record tối đa trả về"),
) -> dict:
    """
    Trả array records gap-finding pipeline usage, mới nhất trước.

    Response:
        {
          "path": "/app/logs/pipeline_usage.jsonl",
          "count": <int>,
          "records": [
            {
              "pr_id": 10, "repo": "...", "team_id": "...", "status": "completed",
              "finished_at": "2026-...", "uc_id": "UC-02", "gap_rows": 12,
              "calls": [{"purpose": "...", "input_tokens": ..., ...}, ...],
              "total": {"input_tokens": ..., "output_tokens": ..., "cost_usd": 0.21}
            },
            ...
          ]
        }
    """
    if not _LOG_PATH.exists():
        return {"path": str(_LOG_PATH), "count": 0, "records": []}

    records: list[dict] = []
    try:
        with _LOG_PATH.open("r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    records.append(json.loads(line))
                except json.JSONDecodeError:
                    logger.warning("[PipelineUsage] Skipping malformed line")
                    continue
    except Exception as exc:
        logger.error("[PipelineUsage] Failed to read log file: %s", exc)
        return {"path": str(_LOG_PATH), "count": 0, "records": [], "error": str(exc)}

    # Filter
    if team_id:
        records = [r for r in records if r.get("team_id") == team_id]
    if pr_id is not None:
        records = [r for r in records if r.get("pr_id") == pr_id]

    # Newest first, apply limit
    records.reverse()
    records = records[:limit]

    return {"path": str(_LOG_PATH), "count": len(records), "records": records}

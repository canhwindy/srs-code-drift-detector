"""
srs_flow_logger.py — Per-request structured logger for the SRS suggestion pipeline.

Each flow run writes a separate JSON file to backend/logs/srs_flow/<timestamp>_<gap_id>.json.

Token counts are approximations: len(text) // 4  (~4 chars per token for English/Vietnamese mix).
"""

import json
import time
from datetime import datetime, timezone
from pathlib import Path

_LOG_DIR = Path(__file__).parent.parent / "logs" / "srs_flow"


def count_tokens(text: str) -> int:
    """Approximate token count: ~4 chars per token (English/Vietnamese mix heuristic)."""
    return len(text) // 4 if text else 0


class SrsFlowLogger:
    def __init__(self, gap_finding_id: str, use_case_name: str) -> None:
        self.gap_finding_id = gap_finding_id
        self.use_case_name = use_case_name
        self._wall_start = time.monotonic()
        self.steps: list[dict] = []

    def log_step(
        self,
        step: str,
        *,
        prompt_tokens: int = 0,
        response_tokens: int = 0,
        duration_ms: float = 0.0,
        **meta,
    ) -> None:
        entry: dict = {
            "step": step,
            "prompt_tokens": prompt_tokens,
            "response_tokens": response_tokens,
            "duration_ms": round(duration_ms, 1),
        }
        entry.update(meta)
        self.steps.append(entry)

    def flush(self, suggestion_preview: str = "") -> None:
        total_prompt = sum(s.get("prompt_tokens", 0) for s in self.steps)
        total_response = sum(s.get("response_tokens", 0) for s in self.steps)
        llm_calls = sum(
            1 for s in self.steps
            if s.get("prompt_tokens", 0) > 0 or s.get("response_tokens", 0) > 0
        )
        warnings: list = next(
            (s["warnings"] for s in self.steps if s.get("step") == "graph_eval" and "warnings" in s),
            [],
        )

        record = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "gap_finding_id": self.gap_finding_id,
            "use_case_name": self.use_case_name,
            "total_duration_ms": round((time.monotonic() - self._wall_start) * 1000, 1),
            "total_prompt_tokens": total_prompt,
            "total_response_tokens": total_response,
            "total_tokens": total_prompt + total_response,
            "llm_calls": llm_calls,
            "warnings_count": len(warnings),
            "suggestion_preview": (suggestion_preview[:200] if suggestion_preview else ""),
            "steps": self.steps,
        }

        try:
            _LOG_DIR.mkdir(parents=True, exist_ok=True)
            ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")
            short_id = self.gap_finding_id[:8] if self.gap_finding_id else "unknown"
            log_file = _LOG_DIR / f"{ts}_{short_id}.json"
            with open(log_file, "w", encoding="utf-8") as fh:
                fh.write(json.dumps(record, indent=2, ensure_ascii=False))
        except Exception:
            pass

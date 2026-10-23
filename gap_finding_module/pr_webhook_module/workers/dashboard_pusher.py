"""
Dashboard Pusher — Push pipeline results to the BA Dashboard (Outline).

Flow:
    1. Load verdict_result.json + surplus_result.json (if exists)
    2. Call LLM (gemini-2.0-flash) to generate a brief Vietnamese error summary
    3. POST to Outline /api/badashboard.importPipelineResult using PIPELINE_API_KEY
    4. Return gapFindingId on success, None on failure

Called at the end of test_pipeline.py::main().
"""

import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models"


# =============================================================================
# LLM helper — proxy-aware (same pattern as other workers)
# =============================================================================

def _call_llm(prompt: str, api_key: str, llm_host: str, llm_model: str) -> str:
    """
    Call LLM via proxy (LLM_BINDING_HOST) if set, else fall back to Gemini native API.
    Returns the generated text, or raises on failure.
    """
    if llm_host:
        url = f"{llm_host.rstrip('/')}/chat/completions"
        resp = httpx.post(
            url,
            json={"model": llm_model, "messages": [{"role": "user", "content": prompt}]},
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()
        return data["candidates"][0]["content"]["parts"][0]["text"].strip()

    # Gemini native API
    url = f"{GEMINI_API_BASE}/{llm_model}:generateContent?key={api_key}"
    resp = httpx.post(
        url,
        json={"contents": [{"parts": [{"text": prompt}]}]},
        timeout=30,
    )
    resp.raise_for_status()
    data = resp.json()
    return (
        data.get("candidates", [{}])[0]
        .get("content", {})
        .get("parts", [{}])[0]
        .get("text", "")
        .strip()
    )


# =============================================================================
# LLM: generate short Vietnamese error summary
# =============================================================================

def _llm_error_summary(
    pr_title: str,
    mismatch_verdicts: list,
    missing_verdicts: list,
    surplus_items: list,
    api_key: str,
    llm_host: str = "",
    llm_model: str = "gemini-2.0-flash",
) -> str:
    """
    Tạo tóm tắt ngắn (2-4 câu, tiếng Việt) về các lỗi tìm thấy.
    Dùng LLM proxy (LLM_BINDING_HOST) nếu có, fallback sang Gemini native API.
    Falls back to plain text nếu cả hai đều thất bại.
    """
    if not mismatch_verdicts and not missing_verdicts and not surplus_items:
        return "Tất cả test cases đều PASS. Không phát hiện gap nào giữa code và SRS."

    issue_lines = []
    for v in mismatch_verdicts[:5]:
        err = (v.get("error_message") or v.get("tag_reason") or "")[:250]
        issue_lines.append(f"MISMATCH — {v.get('test_name', '')}: {err}")
    for v in missing_verdicts[:5]:
        reason = (v.get("tag_reason") or v.get("error_message") or "")[:200]
        issue_lines.append(f"MISSING — {v.get('test_name', '')}: {reason}")
    for s in surplus_items[:3]:
        reason = (s.get("reason_surplus") or s.get("reason") or "")[:200]
        issue_lines.append(f"SURPLUS — {s.get('title', s.get('id', '?'))}: {reason}")

    prompt = (
        f'Bạn là BA (Business Analyst). Tóm tắt ngắn gọn (2-4 câu, tiếng Việt) '
        f'các vấn đề GAP phát hiện trong Pull Request: "{pr_title}".\n\n'
        f'Danh sách vấn đề:\n'
        + "\n".join(f"- {line}" for line in issue_lines)
        + "\n\nChỉ trả lời bằng đoạn tóm tắt, không thêm header hay format khác."
    )

    try:
        text = _call_llm(prompt, api_key, llm_host, llm_model)
        if text:
            return text
    except Exception as exc:
        logger.warning(f"[Dashboard] LLM summary call failed: {exc}")

    # Fallback: plain text
    lines = []
    if mismatch_verdicts:
        lines.append(f"{len(mismatch_verdicts)} test(s) MISMATCH — behavior sai so với SRS:")
        for v in mismatch_verdicts[:3]:
            lines.append(f"  • {v.get('test_name', '')}")
    if missing_verdicts:
        lines.append(f"{len(missing_verdicts)} test(s) MISSING — feature chưa implement:")
        for v in missing_verdicts[:3]:
            lines.append(f"  • {v.get('test_name', '')}")
    if surplus_items:
        lines.append(f"{len(surplus_items)} surplus item(s) — code không có trong SRS:")
        for s in surplus_items[:3]:
            lines.append(f"  • {s.get('title', s.get('id', '?'))}")
    return "\n".join(lines)


# =============================================================================
# Helper: build description for each test verdict
# =============================================================================

def _build_description(v: dict) -> str:
    """
    Trả về description cho TestResult:
    - Nếu có requirement_description (từ SRS) → dùng làm chính, append result summary
    - Nếu không có → dùng tag_reason + error_message làm summary
    """
    srs_desc = (v.get("requirement_description") or "").strip()
    tag       = v.get("tag", "missing")
    tag_reason = (v.get("tag_reason") or "").strip()
    error_msg  = (v.get("error_message") or "").strip()

    # Build result summary
    if tag == "matching":
        result_line = "✓ Test passed — app behavior matches SRS."
    elif tag == "mismatch":
        short_err = error_msg[:200] if error_msg else tag_reason[:200]
        result_line = f"✗ Mismatch: {short_err}"
    else:  # missing
        short_err = error_msg[:200] if error_msg else tag_reason[:200]
        result_line = f"? Missing: {short_err}"

    if srs_desc:
        return f"{srs_desc}\n\n[Result] {result_line}"
    return result_line


# =============================================================================
# Main push function
# =============================================================================

def push_to_dashboard(
    verdict_path: str,
    pr_context_path: str,
    surplus_path: Optional[str],
    llm_cost_usd: float,
    outline_url: Optional[str] = None,
    api_key: Optional[str] = None,
) -> Optional[str]:
    """
    Push pipeline results to Outline BA Dashboard.

    Args:
        verdict_path:     Path to verdict_result.json from run_verdict_worker
        pr_context_path:  Path to pr_context.json from pr_worker
        surplus_path:     Path to surplus_result.json (None if Branch B was skipped)
        llm_cost_usd:     Total LLM cost for this pipeline run
        outline_url:      Outline server URL (defaults to OUTLINE_URL env var)
        api_key:          Pipeline API key (defaults to PIPELINE_API_KEY env var)

    Returns:
        gapFindingId string if successful, None if push failed
    """
    _outline_url = (outline_url or os.getenv("OUTLINE_URL", "http://localhost:3000")).rstrip("/")
    _api_key = api_key or os.getenv("PIPELINE_API_KEY", "")
    # LLM for summary: prefer proxy (same key/host as the rest of the pipeline)
    _llm_host  = os.getenv("LLM_BINDING_HOST", "")
    _llm_model = os.getenv("LLM_MODEL", "gemini-2.0-flash")
    _llm_key   = os.getenv("LLM_BINDING_API_KEY", "") or os.getenv("GEMINI_API_KEY", "")

    if not _api_key:
        logger.warning("[Dashboard] PIPELINE_API_KEY not set — skipping dashboard push")
        return None

    # ── Load verdict ──────────────────────────────────────────────────────────
    if not os.path.exists(verdict_path):
        logger.warning(f"[Dashboard] verdict file not found: {verdict_path}")
        return None

    with open(verdict_path, encoding="utf-8") as f:
        verdict = json.load(f)

    # ── Load pr_context ───────────────────────────────────────────────────────
    with open(pr_context_path, encoding="utf-8") as f:
        pr_context = json.load(f)

    # ── Load surplus (optional) ───────────────────────────────────────────────
    surplus_items: list = []
    surplus_count: int = 0
    if surplus_path and os.path.exists(surplus_path):
        with open(surplus_path, encoding="utf-8") as f:
            surplus = json.load(f)
        surplus_items = surplus.get("surplus_items", [])
        surplus_count = surplus.get("total_surplus", len(surplus_items))

    pr_id   = verdict.get("pr_id") or pr_context.get("pr_id", 0)
    repo    = verdict.get("repo") or pr_context.get("repo", "")
    repo_type = verdict.get("repo_type") or pr_context.get("repo_type", "unknown")
    pr_title  = pr_context.get("title", "")
    verdicts: list = verdict.get("verdicts", [])

    verdict_summary = {
        "total":    verdict.get("total", 0),
        "matching": verdict.get("matching", 0),
        "mismatch": verdict.get("mismatch", 0),
        "missing":  verdict.get("missing", 0),
    }

    # ── Generate error summary via LLM ────────────────────────────────────────
    mismatch_verdicts = [v for v in verdicts if v.get("tag") == "mismatch"]
    missing_verdicts  = [v for v in verdicts if v.get("tag") == "missing"]

    error_summary = _llm_error_summary(
        pr_title, mismatch_verdicts, missing_verdicts, surplus_items,
        api_key=_llm_key, llm_host=_llm_host, llm_model=_llm_model,
    )

    # ── Build payload ─────────────────────────────────────────────────────────
    payload = {
        "pr_id":    pr_id,
        "repo":     repo,
        "repo_type": repo_type,
        "pr_title": pr_title,
        "verdict_summary": verdict_summary,
        "surplus_count": surplus_count,
        "error_summary": error_summary,
        "llm_cost_usd": round(llm_cost_usd, 6),
        "run_at": datetime.now(timezone.utc).isoformat(),
        "test_verdicts": [
            {
                "name":                    v.get("test_name", ""),
                "tag":                     v.get("tag", "missing"),
                "requirement_id":          v.get("requirement_id", ""),
                "requirement_description": _build_description(v),
                "srs_section":             v.get("srs_section", ""),
                "error_message":           v.get("error_message", ""),
                "assertion_logic":         v.get("assertion_logic", ""),
                "test_code":               v.get("test_code", ""),
                "tag_reason":              v.get("tag_reason", ""),
                "duration_ms":             v.get("duration_ms", 0),
            }
            for v in verdicts
        ],
        "surplus_items": [
            {
                "id":         s.get("id", ""),
                "title":      s.get("title", ""),
                "reason":     s.get("reason_surplus") or s.get("reason", ""),
                "confidence": s.get("confidence", ""),
            }
            for s in surplus_items
        ],
    }

    # ── POST to Outline ───────────────────────────────────────────────────────
    url = f"{_outline_url}/api/badashboard.importPipelineResult"
    logger.info(f"[Dashboard] Pushing PR #{pr_id} results to {url}")

    try:
        resp = httpx.post(
            url,
            json=payload,
            headers={"X-Pipeline-Api-Key": _api_key, "Content-Type": "application/json"},
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()
        gap_finding_id = data.get("data", {}).get("gapFindingId")
        logger.info(f"[Dashboard] ✓ Pushed → gapFindingId={gap_finding_id}, title={data.get('data', {}).get('title')}")
        return gap_finding_id
    except httpx.HTTPStatusError as exc:
        logger.error(f"[Dashboard] HTTP {exc.response.status_code}: {exc.response.text[:300]}")
    except Exception as exc:
        logger.error(f"[Dashboard] Push failed: {exc}")

    return None


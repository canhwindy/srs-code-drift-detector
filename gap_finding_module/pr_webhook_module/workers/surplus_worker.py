"""
Branch B — Surplus Detection

Flow:
    B.1  Phân tích PR diff → extract "những gì code đã implement"
    B.2  So sánh với SRS context → phán xét item nào không có trong SRS → tag "surplus"

KEY PRINCIPLE:
    Branch B nhận CẢ code diff LẪN SRS content (ngược với Branch A chỉ nhận SRS).
    Mục đích: tìm những gì code implement NGOÀI yêu cầu SRS.

Output:
    surplus_pr_{id}_{repo}.json  — per-item surplus analysis + summary
"""

import json
import logging
import os
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx
from dotenv import load_dotenv

load_dotenv(dotenv_path=".env", override=False)

logger = logging.getLogger(__name__)

GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models"

from pr_webhook_module.workers import llm_cost_tracker as _tracker


# =============================================================================
# Config
# =============================================================================

class SurplusConfig:
    def __init__(self):
        self.llm_binding = os.getenv("LLM_BINDING", "gemini")
        self.llm_model   = os.getenv("LLM_MODEL", "gemini-2.5-flash")
        self.llm_host    = os.getenv("LLM_BINDING_HOST", "")
        self.llm_api_key = os.getenv("LLM_BINDING_API_KEY", "") or os.getenv("GEMINI_API_KEY", "")
        self.output_dir  = os.getenv("PR_LOG_OUTPUT_DIR", "./pr_logs")
        self.request_timeout = float(os.getenv("LLM_TIMEOUT", "300"))

    def validate(self) -> list[str]:
        errors = []
        if not self.llm_api_key:
            errors.append("LLM_BINDING_API_KEY or GEMINI_API_KEY is required")
        return errors

    @property
    def generate_url(self) -> str:
        if self.llm_binding == "claude" and self.llm_host:
            return f"{self.llm_host.rstrip('/')}/v1/chat/completions"
        if self.llm_host:
            # Gemini proxy: Bearer auth, OpenAI request, Gemini response
            return f"{self.llm_host.rstrip('/')}/chat/completions"
        # Gemini native direct
        key = self.llm_api_key
        return f"{GEMINI_API_BASE}/{self.llm_model}:generateContent?key={key}"


# =============================================================================
# Data structures
# =============================================================================

@dataclass
class SurplusItem:
    """Một behavior/feature được implement nhưng không có trong SRS."""
    id: str
    title: str
    description: str      # Mô tả cụ thể behavior được implement
    code_location: str    # File + function/class liên quan
    diff_context: str     # Đoạn diff liên quan (1-3 dòng)
    reason_surplus: str   # Tại sao không có trong SRS
    confidence: str       # "high" | "medium" | "low"


@dataclass
class SurplusResult:
    """Kết quả phân tích Nhánh B."""
    pr_id: int
    repo: str
    repo_type: str

    surplus_items: list[SurplusItem] = field(default_factory=list)
    total_surplus: int = 0
    summary: str = ""
    llm_reasoning: str = ""   # Raw LLM response for audit/debug

    pr_context_path: str = ""
    srs_context_path: str = ""
    analyzed_at: str = ""


# =============================================================================
# Prompt
# =============================================================================

_SURPLUS_ANALYSIS_PROMPT = """\
You are a software quality analyst performing SURPLUS DETECTION on a Pull Request.

TASK:
Analyze the code changes in this PR and identify behaviors/features that were implemented
but are NOT required or mentioned in the SRS (Software Requirements Specification).

=== PR INFORMATION ===
Repository: {repo}
PR Title: {pr_title}
Changed Files:
{changed_files}

=== CODE DIFF (what was implemented) ===
{diff}
=== END DIFF ===

=== SRS REQUIREMENTS (what is required) ===
{srs_content}
=== END SRS ===

INSTRUCTIONS:
1. Carefully read the SRS to understand what IS required.
2. Carefully read the code diff to understand what WAS implemented.
3. Identify behaviors/features in the code that have NO clear basis in the SRS.
4. Be specific: describe exactly what was implemented and what SRS section it contradicts or omits.

Do NOT flag as surplus:
- Generic error handling, logging, performance hints
- Standard HTTP status codes (404 for not found, 401 for unauthorized)
- Minor implementation details that are implied by the requirements

DO flag as surplus:
- New business rules or validation conditions not mentioned in SRS
- Extra status checks or guard clauses beyond SRS scope
- New API response fields or behaviors not specified in SRS
- Additional access control logic not described in SRS
- ESPECIALLY: optional guard clauses (e.g. `if X: check_constraint()`) that make a
  required SRS constraint optional — SRS may say "always check X" but code only checks
  "if log exists, then check X", implicitly bypassing the constraint when log is absent

Return a JSON object — NO markdown, NO explanation, pure JSON only:
{{
  "surplus_items": [
    {{
      "id": "S001",
      "title": "Short title (under 10 words)",
      "description": "Detailed description of what was implemented",
      "code_location": "filename.py — function or class name",
      "diff_context": "1-3 relevant lines from the diff",
      "reason_surplus": "Why this is not required by the SRS",
      "confidence": "high | medium | low"
    }}
  ],
  "summary": "X surplus item(s) found. Brief overall assessment."
}}

If no surplus found:
{{
  "surplus_items": [],
  "summary": "No surplus detected. All implemented behaviors align with SRS requirements."
}}
"""

DIFF_MAX_CHARS = 20_000
SRS_MAX_CHARS = 20_000


# =============================================================================
# LLM call
# =============================================================================

async def call_gemini(prompt: str, config: SurplusConfig, stage: str = "B") -> str:
    """Gọi LLM API (Gemini native hoặc proxy) và trả về text response.
    Ghi lại token usage + cost estimate qua llm_cost_tracker.
    """
    if config.llm_binding == "claude" and config.llm_host:
        # OpenAI-compatible proxy, returns OpenAI format
        payload = {
            "model": config.llm_model,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.1,
            "max_tokens": 8192,
        }
        headers = {"Authorization": f"Bearer {config.llm_api_key}"}
        async with httpx.AsyncClient(timeout=config.request_timeout) as client:
            response = await client.post(config.generate_url, json=payload, headers=headers)
            response.raise_for_status()
            data = response.json()
            text = data["choices"][0]["message"]["content"]
            _tracker.record_usage(stage, config.llm_model, data, "claude", len(prompt), len(text))
            return text
    elif config.llm_host:
        # Gemini proxy: OpenAI request + Bearer auth, returns Gemini format
        payload = {
            "model": config.llm_model,
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": 8192,
        }
        headers = {"Authorization": f"Bearer {config.llm_api_key}"}
        async with httpx.AsyncClient(timeout=config.request_timeout) as client:
            response = await client.post(config.generate_url, json=payload, headers=headers)
            response.raise_for_status()
            data = response.json()
            text = data["candidates"][0]["content"]["parts"][0]["text"]
            _tracker.record_usage(stage, config.llm_model, data, "gemini", len(prompt), len(text))
            return text
    else:
        # Gemini native direct
        payload = {
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {"temperature": 0.1, "maxOutputTokens": 8192},
        }
        async with httpx.AsyncClient(timeout=config.request_timeout) as client:
            response = await client.post(config.generate_url, json=payload)
            response.raise_for_status()
            data = response.json()
            text = data["candidates"][0]["content"]["parts"][0]["text"]
            _tracker.record_usage(stage, config.llm_model, data, "gemini", len(prompt), len(text))
            return text


def _repair_truncated_json(text: str) -> str:
    """
    Attempt to repair a truncated JSON string by closing unclosed structures.

    Strategy:
    1. Walk the text tracking a stack of open {/[ so we know the correct close order.
    2. If truncated mid-string, close the string first.
    3. Record the position after each complete surplus_item (depth stack = [{).
    4. If we found at least one complete item, truncate there and close properly.
    5. Otherwise fall back to closing whatever the stack says is still open.
    """
    stack: list[str] = []   # ordered list of '{' or '[' still open
    in_string = False
    escape_next = False
    last_safe_pos = 0        # position after the last complete surplus_item "}"

    for i, ch in enumerate(text):
        if escape_next:
            escape_next = False
            continue
        if ch == "\\" and in_string:
            escape_next = True
            continue
        if ch == '"':
            in_string = not in_string
            continue
        if in_string:
            continue

        if ch in ("{", "["):
            stack.append(ch)
        elif ch == "}":
            if stack and stack[-1] == "{":
                stack.pop()
            # After closing an item that sits directly inside the surplus_items array:
            # stack should be ["{", "["] i.e. root object + surplus_items array
            if stack == ["{", "["]:
                last_safe_pos = i + 1
        elif ch == "]":
            if stack and stack[-1] == "[":
                stack.pop()

    needs_repair = in_string or bool(stack)
    if not needs_repair:
        return text  # already valid

    if last_safe_pos > 0:
        # Truncate at the last complete item boundary and close properly
        truncated = text[:last_safe_pos].rstrip().rstrip(",")
        truncated += '], "summary": "Truncated — partial surplus items recovered."}'
        return truncated

    # No complete item found — close whatever is still open in reverse stack order
    closing = ""
    if in_string:
        closing += '"'
    for opener in reversed(stack):
        closing += "}" if opener == "{" else "]"
    return text + closing


def _parse_json_response(raw: str) -> dict:
    """Strip markdown code fences nếu có, rồi parse JSON. Thử repair nếu truncated."""
    text = raw.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        text = "\n".join(lines[1:])
        if text.rstrip().endswith("```"):
            text = "\n".join(text.rstrip().split("\n")[:-1])
    text = text.strip()

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        # Try to repair truncated JSON
        repaired = _repair_truncated_json(text)
        try:
            result = json.loads(repaired)
            logger.warning("[Branch B] JSON was truncated — repaired and parsed partial response")
            return result
        except json.JSONDecodeError:
            pass
    raise json.JSONDecodeError("Could not parse or repair JSON response", text, 0)


# =============================================================================
# Main function
# =============================================================================

async def detect_surplus_for_pr(
    pr_context: dict,
    srs_context: dict,
    config: SurplusConfig,
) -> SurplusResult:
    """
    Branch B: Phân tích PR diff vs SRS → detect surplus behaviors.
    """
    pr_id: int = pr_context.get("pr_id", 0)
    repo: str = pr_context.get("repo", "")
    repo_type: str = pr_context.get("repo_type", "unknown")
    pr_title: str = pr_context.get("title", "")
    diff: str = pr_context.get("diff", "")
    changed_files: list = pr_context.get("changed_files", [])
    srs_content: str = srs_context.get("srs_content", "")

    from pr_webhook_module.workers.file_filter import filter_relevant_files, get_filter_summary
    relevant_files = filter_relevant_files(changed_files)
    logger.info("[Branch B] %s", get_filter_summary(changed_files, relevant_files))

    result = SurplusResult(
        pr_id=pr_id,
        repo=repo,
        repo_type=repo_type,
        analyzed_at=datetime.now(timezone.utc).isoformat(),
    )

    if not diff:
        logger.warning("[Branch B] No diff available, skipping surplus detection")
        result.summary = "No diff available for analysis."
        return result

    # Truncate nếu quá dài
    diff_trimmed = diff[:DIFF_MAX_CHARS]
    if len(diff) > DIFF_MAX_CHARS:
        diff_trimmed += f"\n... [TRUNCATED — total {len(diff)} chars]"

    srs_trimmed = srs_content[:SRS_MAX_CHARS]
    if len(srs_content) > SRS_MAX_CHARS:
        srs_trimmed += f"\n... [TRUNCATED — total {len(srs_content)} chars]"

    changed_files_str = "\n".join(
        f"  - {f.get('filename', f)} (+{f.get('additions', 0)} -{f.get('deletions', 0)})"
        if isinstance(f, dict) else f"  - {f}"
        for f in relevant_files[:20]
    ) or "  (none)"

    prompt = _SURPLUS_ANALYSIS_PROMPT.format(
        repo=repo,
        pr_title=pr_title,
        changed_files=changed_files_str,
        diff=diff_trimmed,
        srs_content=srs_trimmed or "(SRS not available)",
    )

    logger.info(
        f"[B.1+B.2] Calling LLM for surplus analysis "
        f"(diff={len(diff_trimmed)}c, srs={len(srs_trimmed)}c)"
    )
    raw = await call_gemini(prompt, config)
    result.llm_reasoning = raw

    try:
        data = _parse_json_response(raw)
    except json.JSONDecodeError as e:
        logger.error(f"[Branch B] Failed to parse JSON: {e}\nRaw: {raw[:500]}")
        result.summary = f"LLM response parse error: {e}"
        return result

    raw_items: list[dict] = data.get("surplus_items", [])
    result.summary = data.get("summary", "")

    for i, item in enumerate(raw_items):
        surplus = SurplusItem(
            id=item.get("id", f"S{i+1:03d}"),
            title=item.get("title", ""),
            description=item.get("description", ""),
            code_location=item.get("code_location", ""),
            diff_context=item.get("diff_context", ""),
            reason_surplus=item.get("reason_surplus", ""),
            confidence=item.get("confidence", "medium"),
        )
        result.surplus_items.append(surplus)
        logger.info(f"  [SURPLUS/{surplus.confidence.upper():>6}] {surplus.title}")

    result.total_surplus = len(result.surplus_items)
    logger.info(f"[Branch B] Done. {result.total_surplus} surplus item(s) found.")
    return result


# =============================================================================
# Save output
# =============================================================================

def save_surplus_result(result: SurplusResult, output_dir: str) -> str:
    safe_repo = result.repo.replace("/", "_").replace(" ", "-")
    filename = f"surplus_pr_{result.pr_id}_{safe_repo}.json"
    Path(output_dir).mkdir(parents=True, exist_ok=True)
    filepath = os.path.join(output_dir, filename)
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(asdict(result), f, ensure_ascii=False, indent=2)
    logger.info(f"[Branch B] Surplus saved -> {filepath}")
    return filepath


def load_json(path: str) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


# =============================================================================
# Celery task
# =============================================================================

from celery import shared_task


@shared_task(
    bind=True,
    name="pr_webhook_module.workers.surplus_worker.detect_surplus",
    max_retries=1,
    default_retry_delay=10,
)
def detect_surplus(self, phase3_result: dict[str, Any]) -> dict[str, Any]:
    """
    Celery task Nhánh B: phân tích code diff vs SRS → detect surplus.

    Args:
        phase3_result: return value của srs_query_worker
                       cần có: context_json, srs_context_path

    Returns:
        dict với surplus_path, surplus_summary
    """
    import asyncio

    context_json: str = phase3_result.get("context_json", "")
    srs_context_path: str = phase3_result.get("srs_context_path", "")

    if not context_json or not srs_context_path:
        raise ValueError("phase3_result thiếu 'context_json' hoặc 'srs_context_path'")

    logger.info(f"[Branch B] Running surplus detection. Task ID: {self.request.id}")

    cfg = SurplusConfig()
    errors = cfg.validate()
    if errors:
        logger.warning(f"[Branch B] Config errors: {errors}, skipping")
        return {
            **phase3_result,
            "surplus_path": None,
            "surplus_summary": {"total_surplus": 0, "summary": "Skipped (config error)"},
        }

    try:
        pr_context = load_json(context_json)
        srs_context = load_json(srs_context_path)

        result = asyncio.run(detect_surplus_for_pr(pr_context, srs_context, cfg))
        surplus_path = save_surplus_result(result, cfg.output_dir)

        return {
            **phase3_result,
            "surplus_path": surplus_path,
            "surplus_summary": {
                "total_surplus": result.total_surplus,
                "summary": result.summary,
            },
        }
    except Exception as e:
        logger.error(f"[Branch B] Surplus task failed: {e}")
        raise self.retry(exc=e)

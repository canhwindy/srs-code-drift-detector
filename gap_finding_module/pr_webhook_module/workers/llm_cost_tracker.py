"""
LLM Token & Cost Tracker

Được import bởi generate_tests_worker và surplus_worker.
Mỗi call_gemini() ghi lại token usage + chi phí ước tính sau khi nhận response.

Gemini 2.5 Flash pricing (tháng 3/2026):
    Input          : $0.15  / 1M tokens
    Output         : $0.60  / 1M tokens
    Thinking tokens: $3.50  / 1M tokens  (Gemini 2.5 Flash auto-thinking)

Ghi chú:
    - Nếu proxy không trả về usageMetadata → ước tính từ len(chars) / 4
    - Thinking tokens chỉ có trong Gemini native hoặc proxy forward đầy đủ
"""

import logging

logger = logging.getLogger(__name__)

# ─── Pricing table (per-token, USD) ──────────────────────────────────────────
# Key: model name prefix (match longest)
_PRICING: dict[str, dict[str, float]] = {
    "gemini-2.5-flash":        {"input": 0.15e-6, "output": 0.60e-6, "thinking": 3.50e-6},
    "gemini-2.0-flash":        {"input": 0.075e-6, "output": 0.30e-6, "thinking": 0.0},
    "gemini-1.5-flash":        {"input": 0.075e-6, "output": 0.30e-6, "thinking": 0.0},
    "gemini-1.5-pro":          {"input": 1.25e-6,  "output": 5.00e-6, "thinking": 0.0},
    "claude-3-5-sonnet":       {"input": 3.00e-6,  "output": 15.0e-6, "thinking": 0.0},
    "claude-3-7-sonnet":       {"input": 3.00e-6,  "output": 15.0e-6, "thinking": 3.50e-6},
    # fallback
    "default":                 {"input": 0.15e-6,  "output": 0.60e-6, "thinking": 3.50e-6},
}

# ─── Records list ─────────────────────────────────────────────────────────────
_records: list[dict] = []


def _get_pricing(model: str) -> dict[str, float]:
    """Tìm pricing theo model prefix (longest match)."""
    best_key = "default"
    best_len = 0
    for key in _PRICING:
        if key != "default" and model.startswith(key) and len(key) > best_len:
            best_key = key
            best_len = len(key)
    return _PRICING[best_key]


def record_usage(
    stage: str,
    model: str,
    response_data: dict,
    binding: str = "gemini",
    input_chars: int = 0,
    output_chars: int = 0,
) -> None:
    """
    Đọc token usage từ LLM response và ghi log chi phí.

    Args:
        stage:         Tên giai đoạn, ví dụ "A.1", "A.2", "B"
        model:         Tên model, ví dụ "gemini-2.5-flash"
        response_data: Parsed JSON response dict từ LLM API
        binding:       "gemini" | "claude"
        input_chars:   Độ dài prompt (fallback nếu không có token count)
        output_chars:  Độ dài output text (fallback)
    """
    input_tok = output_tok = thinking_tok = 0
    estimated = False

    if binding == "claude":
        # OpenAI-compatible format: response["usage"]["prompt_tokens"]
        usage = response_data.get("usage", {})
        input_tok = usage.get("prompt_tokens", 0)
        output_tok = usage.get("completion_tokens", 0)
    else:
        # Gemini format: response["usageMetadata"]
        usage = response_data.get("usageMetadata", {})
        input_tok = usage.get("promptTokenCount", 0)
        output_tok = usage.get("candidatesTokenCount", 0)
        thinking_tok = usage.get("thoughtsTokenCount", 0)

    # Fallback: ước tính từ char count (~4 chars / token) nếu API không trả về
    if input_tok == 0 and input_chars > 0:
        input_tok = input_chars // 4
        estimated = True
    if output_tok == 0 and output_chars > 0:
        output_tok = output_chars // 4
        estimated = True

    pricing = _get_pricing(model)
    cost = (
        input_tok   * pricing["input"] +
        output_tok  * pricing["output"] +
        thinking_tok * pricing["thinking"]
    )

    rec = {
        "stage":           stage,
        "model":           model,
        "input_tokens":    input_tok,
        "output_tokens":   output_tok,
        "thinking_tokens": thinking_tok,
        "cost_usd":        cost,
        "estimated":       estimated,
    }
    _records.append(rec)

    think_str = f" + {thinking_tok:,} think" if thinking_tok else ""
    est_str   = " (est.)" if estimated else ""
    kg_note   = " [+KG context unknown]" if stage.startswith("P3") else ""
    logger.info(
        f"[TOKEN] {stage:<4} | in={input_tok:>6,}  out={output_tok:>6,}{think_str}"
        f"  cost=${cost:.5f}{est_str}{kg_note}"
    )


def reset() -> None:
    """Xóa toàn bộ records — gọi ở đầu mỗi pipeline run."""
    _records.clear()


def get_total() -> dict:
    return {
        "calls":                 len(_records),
        "total_input_tokens":    sum(r["input_tokens"]    for r in _records),
        "total_output_tokens":   sum(r["output_tokens"]   for r in _records),
        "total_thinking_tokens": sum(r["thinking_tokens"] for r in _records),
        "total_cost_usd":        round(sum(r["cost_usd"]  for r in _records), 6),
        "records":               list(_records),
    }


def print_summary(label: str = "LLM COST SUMMARY") -> None:
    """In bảng tổng hợp token usage + cost ra logger."""
    if not _records:
        logger.info(f"[TOKEN] {label}: no LLM calls recorded.")
        return

    total_in    = sum(r["input_tokens"]    for r in _records)
    total_out   = sum(r["output_tokens"]   for r in _records)
    total_think = sum(r["thinking_tokens"] for r in _records)
    total_cost  = sum(r["cost_usd"]        for r in _records)
    has_est     = any(r["estimated"]       for r in _records)

    # ── header ──
    logger.info("")
    logger.info("  ╔══════════════════════════════════════════════════════════╗")
    logger.info(f"  ║  {label:<56}║")
    logger.info("  ╠══════╦═══════════╦══════════╦══════════════╦════════════╣")
    logger.info("  ║Stage ║ Input tok ║ Output   ║ Thinking     ║    Cost    ║")
    logger.info("  ╠══════╬═══════════╬══════════╬══════════════╬════════════╣")

    for r in _records:
        est = "*" if r["estimated"] else " "
        logger.info(
            f"  ║ {r['stage']:<5}║{r['input_tokens']:>8,}{est}  ║{r['output_tokens']:>8,}  ║"
            f"{r['thinking_tokens']:>10,}    ║ ${r['cost_usd']:>8.5f} ║"
        )

    logger.info("  ╠══════╬═══════════╬══════════╬══════════════╬════════════╣")
    logger.info(
        f"  ║ {'TOTAL':<5}║{total_in:>8,}   ║{total_out:>8,}  ║"
        f"{total_think:>10,}    ║ ${total_cost:>8.5f} ║"
    )
    logger.info("  ╚══════╩═══════════╩══════════╩══════════════╩════════════╝")

    if has_est:
        logger.info("  * = ước tính từ char count (proxy không trả usageMetadata)")
    logger.info("  Pricing ref: Gemini 2.5 Flash — in $0.15/1M, out $0.60/1M, think $3.50/1M")
    logger.info("")

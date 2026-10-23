"""
Full Pipeline Runner — Single source of truth for PR processing logic.

Dùng bởi:
    - process_pull_request (Celery task từ webhook)
    - test_pipeline.py (manual run)

Flow:
    Phase 3  — Query LightRAG SRS
    Branch A — Generate E2E tests → Run verdict (matching/mismatch/missing)
    Branch B — Detect surplus (code không có trong SRS)
    Finalize — Push lên BA Dashboard → Dọn file trung gian
"""

import asyncio
import logging
import os
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


async def run_pipeline(pr_worker_result: dict[str, Any]) -> dict[str, Any]:
    """
    Chạy toàn bộ pipeline từ Phase 3 đến finalize.

    Args:
        pr_worker_result: output của process_pr_async / run_phase_12,
                          phải có 'context_json' và 'log_file'.

    Returns:
        dict với tất cả kết quả: verdict_path, surplus_path, gap_finding_id, ...
    """
    from pr_webhook_module.workers.srs_query_worker import (
        SRSQueryConfig, load_pr_context, query_srs_for_pr, save_srs_context,
    )
    from pr_webhook_module.workers.generate_tests_worker import (
        GenerateTestsConfig, load_json, generate_tests_for_pr,
    )
    from pr_webhook_module.workers.run_verdict_worker import (
        VerdictConfig, run_and_tag, save_verdict,
    )
    from pr_webhook_module.workers.surplus_worker import (
        SurplusConfig, detect_surplus_for_pr, save_surplus_result,
    )
    from pr_webhook_module.workers.dashboard_pusher import push_to_dashboard

    context_json_path: str = pr_worker_result.get("context_json", "")
    log_path: str = pr_worker_result.get("log_file", "")

    # ── Phase 3: Query LightRAG SRS ──────────────────────────────────────────
    logger.info("[Pipeline] Phase 3 — Querying SRS...")
    srs_cfg = SRSQueryConfig()
    pr_context_obj = load_pr_context(context_json_path)
    srs_context_obj = await query_srs_for_pr(pr_context_obj, srs_cfg)
    srs_context_path = save_srs_context(srs_context_obj, srs_cfg.output_dir)

    result = {
        **pr_worker_result,
        "conversation_id": srs_context_obj.conversation_id,
        "srs_context_path": srs_context_path,
        "related_uc_hints": srs_context_obj.related_uc_hints,
    }

    # ── Branch A: Generate Tests + Run Verdict ───────────────────────────────
    logger.info("[Pipeline] Branch A — Generating tests & running verdict...")
    gen_cfg = GenerateTestsConfig()
    srs_context_dict = load_json(srs_context_path)
    pr_context_dict  = load_json(context_json_path)

    manifest = await generate_tests_for_pr(srs_context_dict, pr_context_dict, gen_cfg)

    manifest_dict = {
        "pr_id":      manifest.pr_id,
        "repo":       manifest.repo,
        "repo_type":  manifest.repo_type,
        "test_file_path": manifest.test_file_path,
        "manifest_path":  manifest.manifest_path,
        "test_cases": [
            {
                "id": tc.id, "name": tc.name,
                "srs_section":              tc.srs_section,
                "requirement_id":           tc.requirement_id,
                "requirement_description":  tc.requirement_description,
                "assertion_logic":          tc.assertion_logic,
                "code":                     tc.code,
            }
            for tc in manifest.test_cases
        ],
    }

    verdict_cfg  = VerdictConfig()
    verdict      = run_and_tag(manifest_dict, verdict_cfg)
    verdict_path = save_verdict(verdict, verdict_cfg.output_dir)

    result = {
        **result,
        "manifest_path":    manifest.manifest_path,
        "verdict_path":     verdict_path,
        "verdict_summary": {
            "total":    verdict.total,
            "matching": verdict.matching,
            "mismatch": verdict.mismatch,
            "missing":  verdict.missing,
        },
    }

    logger.info(
        f"[Pipeline] Branch A done — "
        f"matching={verdict.matching} mismatch={verdict.mismatch} missing={verdict.missing}"
    )

    # ── Branch B: Surplus Detection ──────────────────────────────────────────
    logger.info("[Pipeline] Branch B — Detecting surplus...")
    surplus_cfg = SurplusConfig()
    surplus_errors = surplus_cfg.validate()
    surplus_path: str | None = None

    if surplus_errors:
        logger.warning(f"[Pipeline] Branch B skipped: {surplus_errors}")
        result["surplus_path"] = None
    else:
        surplus_result = await detect_surplus_for_pr(pr_context_dict, srs_context_dict, surplus_cfg)
        surplus_path   = save_surplus_result(surplus_result, surplus_cfg.output_dir)
        result["surplus_path"] = surplus_path
        logger.info(f"[Pipeline] Branch B done — surplus={surplus_result.total_surplus}")

    # ── Finalize: Push Dashboard + Cleanup ───────────────────────────────────
    logger.info(f"[Pipeline] Finalizing — pushing PR #{result.get('pr_id')} to dashboard...")
    gap_finding_id = push_to_dashboard(
        verdict_path=verdict_path,
        pr_context_path=context_json_path,
        surplus_path=surplus_path,
        llm_cost_usd=0.0,
    )
    result["gap_finding_id"] = gap_finding_id

    if gap_finding_id:
        logger.info(f"[Pipeline] ✓ gapFindingId={gap_finding_id} — cleaning up intermediate files")
        # log_path được giữ lại để quản lý lịch sử trong folder
        _cleanup(verdict_path, context_json_path, surplus_path,
                 srs_context_path, manifest.manifest_path)
    else:
        logger.warning("[Pipeline] Dashboard push failed — files kept for retry/debug")

    return result


def _cleanup(*paths: str | None) -> None:
    for path in paths:
        if path and os.path.exists(path):
            try:
                os.remove(path)
            except Exception as e:
                logger.warning(f"[Pipeline] Could not delete {path}: {e}")

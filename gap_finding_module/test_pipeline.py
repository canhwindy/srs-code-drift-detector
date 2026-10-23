"""
Test Phase 1-2-3 pipeline — chay truc tiep, bypass Celery.

Usage:
    python test_pipeline.py [pr_number] [owner/repo] [--branch-a-only] [--skip-branch-b]

Options:
    --branch-a-only   Skip phases 1-2-3, use existing srs_context.json + context.json
    --skip-branch-b   Skip Branch B (surplus detection)

Defaults:
    pr_number = 2
    repo      = Ann4530/EVO-LMS-DJANGO

Examples:
    python test_pipeline.py 2 Ann4530/EVO-LMS-DJANGO --branch-a-only
    python test_pipeline.py 5 Ann4530/EVO-LMS-DJANGO
    python test_pipeline.py 3 Ann4530/evo-lms-angular
"""

import asyncio
import json
import sys
import os
from pathlib import Path

# Force UTF-8 output on Windows
if sys.stdout.encoding != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# Để import được pr_webhook_module khi chạy từ gap_finding_module/
sys.path.insert(0, str(Path(__file__).parent))

from dotenv import load_dotenv
load_dotenv(dotenv_path="../.env.local", override=False)

import logging
logging.basicConfig(level=logging.INFO, format="%(message)s", stream=sys.stdout)

from pr_webhook_module.workers import llm_cost_tracker

# ─── Config từ args ───────────────────────────────────────────────────────────

_args = [a for a in sys.argv[1:] if not a.startswith("--")]
_flags = [a for a in sys.argv[1:] if a.startswith("--")]

pr_number = int(_args[0]) if len(_args) > 0 else 2
repo_full_name = _args[1] if len(_args) > 1 else "Ann4530/EVO-LMS-DJANGO"
owner, repo_name = repo_full_name.split("/")
BRANCH_A_ONLY = "--branch-a-only" in _flags
SKIP_BRANCH_B = "--skip-branch-b" in _flags


def separator(title: str) -> None:
    print(f"\n{'=' * 60}")
    print(f"  {title}")
    print("=" * 60)


# =============================================================================
# Phase 1-2: Fetch PR data
# =============================================================================

async def run_phase_12() -> dict:
    separator(f"PHASE 1-2 — Fetch PR #{pr_number} from {repo_full_name}")

    from pr_webhook_module.workers.pr_worker import (
        get_config,
        fetch_pr_details,
        fetch_pr_commits,
        fetch_pr_files,
        fetch_pr_diff,
        truncate_diff,
        _build_pr_context,
        write_pr_context_json,
        write_pr_log,
    )

    cfg = get_config()
    errors = cfg.validate()
    if errors:
        print(f"[ERROR] Config: {errors}")
        sys.exit(1)

    api_kwargs = dict(
        owner=owner,
        repo=repo_name,
        pr_number=pr_number,
        github_token=cfg.github_token,
        github_api_url=cfg.github_api_url,
    )

    print(f"\n[1/5] Fetching PR details...")
    pr_details = await fetch_pr_details(**api_kwargs)
    print(f"      Title : {pr_details.get('title')!r}")
    print(f"      Author: {pr_details.get('user', {}).get('login')}")
    print(f"      Branch: {pr_details.get('head', {}).get('ref')} -> {pr_details.get('base', {}).get('ref')}")
    desc = (pr_details.get("body") or "").strip()
    print(f"      Desc  : {desc[:120]!r}{'...' if len(desc) > 120 else ''}")

    print(f"\n[2/5] Fetching commits...")
    raw_commits = []
    try:
        raw_commits = await fetch_pr_commits(**api_kwargs)
        print(f"      {len(raw_commits)} commit(s) found")
        for c in raw_commits[:5]:
            msg = c.get("commit", {}).get("message", "").split("\n")[0]
            sha = c.get("sha", "")[:7]
            author = c.get("commit", {}).get("author", {}).get("name", "")
            print(f"        {sha}  {author}  {msg}")
    except Exception as e:
        print(f"      [WARN] {e}")

    print(f"\n[3/5] Fetching changed files...")
    raw_files = []
    try:
        raw_files = await fetch_pr_files(**api_kwargs)
        print(f"      {len(raw_files)} file(s) changed")
        for f in raw_files[:10]:
            print(f"        [{f.get('status'):>8}]  +{f.get('additions')} -{f.get('deletions')}  {f.get('filename')}")
    except Exception as e:
        print(f"      [WARN] {e}")

    print(f"\n[4/5] Fetching diff...")
    diff = ""
    diff_truncated = False
    try:
        diff = await fetch_pr_diff(**api_kwargs)
        diff, diff_truncated = truncate_diff(diff, cfg.max_diff_chars)
        print(f"      {len(diff)} chars{' [TRUNCATED]' if diff_truncated else ''}")
    except Exception as e:
        print(f"      [WARN] {e}")

    print(f"\n[5/5] Building PRContext + saving outputs...")
    context = _build_pr_context(
        action="opened",
        repo_full_name=repo_full_name,
        pr_details=pr_details,
        raw_commits=raw_commits,
        raw_files=raw_files,
        diff=diff,
        diff_truncated=diff_truncated,
    )

    os.makedirs(cfg.log_output_dir, exist_ok=True)
    json_path = write_pr_context_json(context, cfg.log_output_dir)
    log_path = write_pr_log(context, None, cfg.log_output_dir)
    print(f"      JSON ->{json_path}")
    print(f"      LOG  ->{log_path}")

    return {
        "pr_id": context.pr_id,
        "repo": context.repo,
        "repo_type": context.repo_type,
        "action": context.action,
        "title": context.title,
        "total_commits": context.total_commits,
        "total_files": len(context.changed_files),
        "total_additions": context.total_additions,
        "total_deletions": context.total_deletions,
        "diff_truncated": context.diff_truncated,
        "context_json": json_path,
        "log_file": log_path,
    }


# =============================================================================
# Phase 3: Query LightRAG SRS
# =============================================================================

async def run_phase_3(pr_worker_result: dict) -> dict:
    separator("PHASE 3 — Query LightRAG SRS")

    from pr_webhook_module.workers.srs_query_worker import (
        SRSQueryConfig,
        load_pr_context,
        query_srs_for_pr,
        save_srs_context,
    )

    cfg = SRSQueryConfig()
    print(f"\n  LightRAG URL: {cfg.lightrag_url}")

    pr_context = load_pr_context(pr_worker_result["context_json"])

    print(f"\n[1/3] Turn 1 — Broad UC discovery query...")
    print(f"      (PR title + description + changed file paths ->tìm UC liên quan)")

    print(f"\n[2/3] Turn 2 — Narrow requirements query...")
    print(f"      (Conversation history + file paths ->chi tiết acceptance criteria)")

    srs_context = await query_srs_for_pr(pr_context, cfg)

    print(f"\n[3/3] Saving srs_context.json...")
    srs_path = save_srs_context(srs_context, cfg.output_dir)
    print(f"      ->{srs_path}")

    print(f"\n  Conversation ID : {srs_context.conversation_id}")
    print(f"  UC hints found  : {srs_context.related_uc_hints or '(none)'}")
    print(f"\n  --- SRS CONTENT PREVIEW (first 800 chars) ---")
    print(f"  {srs_context.srs_content[:800]}")
    if len(srs_context.srs_content) > 800:
        print(f"  ... [{len(srs_context.srs_content)} total chars]")

    return {
        **pr_worker_result,
        "conversation_id": srs_context.conversation_id,
        "srs_context_path": srs_path,
        "related_uc_hints": srs_context.related_uc_hints,
    }


# =============================================================================
# Branch A: Generate Tests + Run Verdict
# =============================================================================

async def run_branch_a(phase3_result: dict) -> dict:
    separator("BRANCH A — Generate E2E Tests from SRS")

    from pr_webhook_module.workers.generate_tests_worker import (
        GenerateTestsConfig,
        load_json,
        generate_tests_for_pr,
    )
    from pr_webhook_module.workers.run_verdict_worker import (
        VerdictConfig,
        run_and_tag,
        save_verdict,
    )

    gen_cfg = GenerateTestsConfig()
    errors = gen_cfg.validate()
    if errors:
        print(f"\n  [SKIP] Branch A: {errors}")
        return phase3_result

    srs_context = load_json(phase3_result["srs_context_path"])
    pr_context  = load_json(phase3_result["context_json"])

    print(f"\n  Gemini model : {gen_cfg.gemini_model}")
    repo_type = pr_context.get("repo_type", "unknown")
    base_url = gen_cfg.get_base_url(repo_type)
    print(f"  App base URL : {base_url}")
    print(f"  Repo type    : {repo_type}")

    # Phase 2.5 — Resolve Swagger endpoints
    if repo_type == "backend":
        from pr_webhook_module.workers.swagger_resolver import resolve_endpoints_for_pr
        separator("PHASE 2.5 — Swagger Endpoint Resolution")
        print(f"\n  Fetching schema from {base_url}/api/schema/ ...")
        endpoints = await resolve_endpoints_for_pr(pr_context, base_url)
        print(f"  Endpoints found : {len(endpoints)}")
        if endpoints:
            print("\n  --- RELEVANT ENDPOINTS ---")
            for ep in endpoints:
                print(f"  [{ep.score:2d}] {ep.method} {ep.path}")
                if ep.summary:
                    print(f"       {ep.summary}")

    # A.1 + A.2 — Extract requirements -> generate tests
    print("\n[A.1] Extracting requirements from SRS...")
    print("[A.2] Generating Playwright tests (LLM sees SRS only, no code)...")
    manifest = await generate_tests_for_pr(srs_context, pr_context, gen_cfg)

    print(f"\n  Requirements extracted : {manifest.total_requirements}")
    print(f"  Test cases generated   : {len(manifest.test_cases)}")
    print(f"  Test file              : {manifest.test_file_path}")
    print(f"  Manifest               : {manifest.manifest_path}")

    # Preview test cases
    for tc in manifest.test_cases[:5]:
        print(f"    - [{tc.srs_section}] {tc.name}")
    if len(manifest.test_cases) > 5:
        print(f"    ... and {len(manifest.test_cases) - 5} more")

    # A.3 + A.4 — Run tests + tag
    print(f"\n[A.3] Running pytest against {gen_cfg.get_base_url(repo_type)}...")
    print("[A.4] Verdict engine: tagging matching / mismatch / missing...")

    verdict_cfg = VerdictConfig()
    manifest_dict = {
        "pr_id": manifest.pr_id,
        "repo": manifest.repo,
        "repo_type": manifest.repo_type,
        "test_file_path": manifest.test_file_path,
        "manifest_path": manifest.manifest_path,
        "test_cases": [
            {
                "id": tc.id, "name": tc.name,
                "srs_section": tc.srs_section,
                "requirement_id": tc.requirement_id,
                "requirement_description": tc.requirement_description,
                "assertion_logic": tc.assertion_logic,
                "code": tc.code,
            }
            for tc in manifest.test_cases
        ],
    }
    verdict = run_and_tag(manifest_dict, verdict_cfg)
    verdict_path = save_verdict(verdict, verdict_cfg.output_dir)

    print("\n  --- VERDICT SUMMARY ---")
    print(f"  matching  : {verdict.matching}")
    print(f"  mismatch  : {verdict.mismatch}")
    print(f"  missing   : {verdict.missing}")
    print(f"  total     : {verdict.total}")
    print(f"  Saved     : {verdict_path}")

    if verdict.verdicts:
        print("\n  --- PER TEST ---")
        for v in verdict.verdicts:
            print(f"  [{v.tag.upper():>9}] {v.test_name}")
            if v.tag != "matching":
                print(f"             Reason: {v.tag_reason[:100]}")

    llm_cost_tracker.print_summary("Branch A — LLM Cost")

    return {
        **phase3_result,
        "test_file_path": manifest.test_file_path,
        "manifest_path": manifest.manifest_path,
        "verdict_path": verdict_path,
        "verdict_summary": {
            "total": verdict.total,
            "matching": verdict.matching,
            "mismatch": verdict.mismatch,
            "missing": verdict.missing,
        },
    }


# =============================================================================
# Branch B: Surplus Detection
# =============================================================================

async def run_branch_b(phase3_result: dict) -> dict:
    separator("BRANCH B — Surplus Detection (Diff vs SRS)")

    from pr_webhook_module.workers.surplus_worker import (
        SurplusConfig,
        load_json,
        detect_surplus_for_pr,
        save_surplus_result,
    )

    cfg = SurplusConfig()
    errors = cfg.validate()
    if errors:
        print(f"\n  [SKIP] Branch B: {errors}")
        return {**phase3_result, "surplus_path": None, "surplus_summary": {"total_surplus": 0}}

    pr_context  = load_json(phase3_result["context_json"])
    srs_context = load_json(phase3_result["srs_context_path"])

    diff_len = len(pr_context.get("diff", ""))
    srs_len  = len(srs_context.get("srs_content", ""))
    print(f"\n  Diff length : {diff_len} chars")
    print(f"  SRS length  : {srs_len} chars")
    print(f"  Gemini model: {cfg.llm_model}")

    print("\n[B.1+B.2] Calling LLM to compare diff vs SRS...")
    result = await detect_surplus_for_pr(pr_context, srs_context, cfg)
    surplus_path = save_surplus_result(result, cfg.output_dir)

    print("\n  --- LLM REASONING (raw response) ---")
    print(f"  {result.llm_reasoning}")

    print(f"\n  --- SURPLUS SUMMARY ---")
    print(f"  Total surplus: {result.total_surplus}")
    print(f"  Summary      : {result.summary}")
    print(f"  Saved        : {surplus_path}")

    if result.surplus_items:
        print("\n  --- SURPLUS ITEMS ---")
        for item in result.surplus_items:
            print(f"  [{item.confidence.upper():>6}] {item.id}: {item.title}")
            print(f"           Location: {item.code_location}")
            print(f"           Reason  : {item.reason_surplus[:100]}")

    llm_cost_tracker.print_summary("Branch B — LLM Cost")

    return {
        **phase3_result,
        "surplus_path": surplus_path,
        "surplus_summary": {
            "total_surplus": result.total_surplus,
            "summary": result.summary,
        },
    }


# =============================================================================
# Main
# =============================================================================

async def main() -> None:
    from pr_webhook_module.workers.pipeline_runner import run_pipeline

    llm_cost_tracker.reset()
    print(f"\nTarget: PR #{pr_number}  Repo: {repo_full_name}")

    if BRANCH_A_ONLY:
        separator("BRANCH-A-ONLY — Loading existing context files")
        from pr_webhook_module.workers.srs_query_worker import SRSQueryConfig
        cfg = SRSQueryConfig()
        safe_repo = repo_full_name.replace("/", "_").replace(" ", "-")

        context_path = os.path.join(cfg.output_dir, f"pr_{pr_number}_{safe_repo}_context.json")
        if not os.path.exists(context_path):
            print(f"[ERROR] context.json not found: {context_path}")
            sys.exit(1)

        print(f"  context -> {context_path}")
        pr_worker_result = {"context_json": context_path}
    else:
        pr_worker_result = await run_phase_12()

    separator("RUNNING PIPELINE (Phase 3 → Branch A → Branch B → Dashboard)")
    final_result = await run_pipeline(pr_worker_result)

    separator("FINAL RESULT")
    print(json.dumps(final_result, indent=2, ensure_ascii=False))

    llm_cost_tracker.print_summary("TOTAL PIPELINE — Direct LLM Cost")
    totals = llm_cost_tracker.get_total()
    print(f"[OK] Pipeline completed. Direct LLM cost: ${totals['total_cost_usd']:.5f} ({totals['calls']} call(s))")
    if final_result.get("gap_finding_id"):
        print(f"[OK] Dashboard updated → gapFindingId={final_result['gap_finding_id']}")
    else:
        print("[WARN] Dashboard push failed or skipped (check PIPELINE_API_KEY / OUTLINE_URL)")


if __name__ == "__main__":
    asyncio.run(main())

"""
Nhánh A — Step A.3 + A.4: Run Tests & Verdict Engine

Flow:
    A.3  Chạy pytest trên generated test file
    A.4  Phân loại kết quả → 3 tags:
            PASS              → matching   (app đúng với SRS)
            AssertionError    → mismatch   (app trả về sai so với SRS)
            404/timeout/conn  → missing    (feature chưa implement)

Output:
    verdict_result.json  — per-test tags + summary
"""

import json
import logging
import os
import subprocess
import sys
import tempfile
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

from dotenv import load_dotenv

load_dotenv(dotenv_path=".env", override=False)

logger = logging.getLogger(__name__)

GapTag = Literal["matching", "mismatch", "missing"]


# =============================================================================
# Config
# =============================================================================

class VerdictConfig:
    def __init__(self):
        self.output_dir = os.getenv("PR_LOG_OUTPUT_DIR", "./pr_logs")
        self.tests_dir = os.path.join(self.output_dir, "generated_tests")
        self.backend_base_url  = os.getenv("BACKEND_BASE_URL",  "http://localhost:8001")
        self.frontend_base_url = os.getenv("FRONTEND_BASE_URL", "http://localhost:4200")
        self.pytest_timeout = int(os.getenv("PYTEST_TIMEOUT", "30"))   # seconds per test

    def get_base_url(self, repo_type: str) -> str:
        return self.frontend_base_url if repo_type == "frontend" else self.backend_base_url


# =============================================================================
# Data structures
# =============================================================================

@dataclass
class TestVerdict:
    """Kết quả + tag cho một test case."""
    test_id: str
    test_name: str
    srs_section: str
    requirement_id: str
    requirement_description: str
    assertion_logic: str

    # pytest function code (lấy từ manifest)
    test_code: str

    # Kết quả chạy test
    outcome: str          # "passed" | "failed" | "error" | "skipped"
    duration_ms: float
    error_message: str    # empty nếu passed

    # Tag được gán bởi verdict engine
    tag: GapTag
    tag_reason: str       # giải thích tại sao gán tag này


@dataclass
class VerdictResult:
    """Kết quả toàn bộ Nhánh A."""
    pr_id: int
    repo: str
    repo_type: str

    verdicts: list[TestVerdict] = field(default_factory=list)

    # Summary
    total: int = 0
    matching: int = 0
    mismatch: int = 0
    missing: int = 0
    skipped: int = 0

    # Paths
    test_file_path: str = ""
    manifest_path: str = ""

    analyzed_at: str = ""


# =============================================================================
# Step A.4 — Verdict engine: classify pytest result → tag
# =============================================================================

# Keywords trong error message → missing (feature không tồn tại)
_MISSING_KEYWORDS = (
    "404",
    "not found",
    "connection refused",
    "connection error",
    "connect error",
    "timed out",
    "timeout",
    "no route",
    "econnrefused",
    "name or service not known",
    "failed to connect",
    "no such element",      # playwright: element không tồn tại
    "element not found",
    "locator.click: error",
    "page.goto: net::err_connection_refused",
)

# Keywords → mismatch (feature tồn tại nhưng trả về sai)
_MISMATCH_KEYWORDS = (
    "assertionerror",
    "assert",
    "expected",
    "got ",
    "statuscode",
    "status_code",
    "200",
    "expected 400",
    "expected 403",
    "expected 201",
)


def classify_outcome(outcome: str, error_message: str) -> tuple[GapTag, str]:
    """
    Step A.4: Phân loại test outcome thành 3 tags.

    Logic:
        passed                          → matching
        skipped                         → missing  (cannot be tested via API)
        error_msg có 404/conn/timeout   → missing  (feature chưa implement)
        failed với AssertionError       → mismatch (feature có nhưng behavior sai)
        error outcome (fixture fail)    → kiểm tra error_msg để phân biệt
    """
    if outcome == "passed":
        return "matching", "Test passed: app behavior matches SRS requirement"

    # skipped → missing (test bị skip vì không thể test qua API, thiếu data, hoặc endpoint không có)
    if outcome == "skipped":
        return "missing", f"Test skipped (cannot be verified via API): {error_message[:200]}"

    err_lower = error_message.lower()

    # Check missing indicators trước — áp dụng cho cả failed lẫn error outcome
    # Bao gồm: fixture/setup fail với 404 (app chưa deploy hoặc endpoint chưa có)
    for kw in _MISSING_KEYWORDS:
        if kw in err_lower:
            return "missing", (
                f"Feature not implemented or endpoint not found. "
                f"Indicator: '{kw}' in error message"
            )

    # outcome == "error" mà không có 404/conn → setup/infra error, không phải app behavior
    if outcome == "error":
        return "missing", f"Test setup error (possible missing feature or infra): {error_message[:200]}"

    # outcome == "failed" → có chạy được nhưng assertion fail → mismatch
    for kw in _MISMATCH_KEYWORDS:
        if kw in err_lower:
            return "mismatch", (
                f"App returned different value than SRS expects. "
                f"Indicator: '{kw}' in assertion error"
            )
    return "mismatch", f"Test failed with unexpected behavior: {error_message[:200]}"


# =============================================================================
# Step A.3 — Run pytest và parse JSON report
# =============================================================================

def _run_pytest(test_file: str, config: VerdictConfig, base_url: str, repo_type: str = "backend") -> dict:
    """
    Chạy pytest với --json-report và trả về parsed report.
    - backend: dùng httpx, truyền BACKEND_BASE_URL qua env var
    - frontend: dùng Playwright, truyền --base-url cho pytest-playwright
    """
    # Use absolute path to avoid CWD resolution differences between parent and subprocess
    report_name = os.path.basename(test_file).replace(".py", "_report.json")
    report_file = os.path.abspath(os.path.join(config.output_dir, report_name))
    # Remove stale report from previous run if it exists
    if os.path.exists(report_file):
        os.remove(report_file)

    cmd = [
        sys.executable, "-m", "pytest",
        test_file,
        "--json-report",
        f"--json-report-file={report_file}",
        "--tb=short",
        f"--timeout={config.pytest_timeout}",
        "-v",
        "--no-header",
    ]

    if repo_type == "frontend":
        # Playwright cần --base-url để inject vào page fixture
        cmd.append(f"--base-url={base_url}")

    logger.info(f"[A.3] Running: {' '.join(cmd)}")

    # Truyền env vars cho subprocess — httpx đọc BACKEND_BASE_URL, test đọc credentials
    env = os.environ.copy()
    env.setdefault("BACKEND_BASE_URL", config.backend_base_url)
    env.setdefault("FRONTEND_BASE_URL", config.frontend_base_url)

    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=config.pytest_timeout * 20,   # global timeout cho toàn bộ suite
        env=env,
    )

    logger.info(f"[A.3] pytest exit code: {result.returncode}")
    if result.stdout:
        logger.debug(f"[A.3] stdout:\n{result.stdout[-2000:]}")
    if result.stderr:
        logger.debug(f"[A.3] stderr:\n{result.stderr[-1000:]}")

    # Parse JSON report
    if os.path.exists(report_file) and os.path.getsize(report_file) > 0:
        with open(report_file, encoding="utf-8") as f:
            return json.load(f)

    # Fallback: report không được ghi — log stdout/stderr để debug
    logger.warning(f"[A.3] JSON report not found at: {report_file}")
    if result.stdout:
        logger.warning(f"[A.3] pytest stdout:\n{result.stdout[-3000:]}")
    if result.stderr:
        logger.warning(f"[A.3] pytest stderr:\n{result.stderr[-1000:]}")
    return _parse_stdout_fallback(result.stdout)


def _parse_stdout_fallback(stdout: str) -> dict:
    """
    Fallback parser khi pytest-json-report chưa được cài.
    Xử lý nhiều format pytest output:
    - pytest -v: "test_file.py::test_name[chromium] FAILED        [ 33%]"
    - pytest -v session fixture fail: "test_file.py::test_name[chromium] ERROR"
    - pytest short: "FAILED test_file.py::test_name - reason"
    """
    tests = []
    for line in stdout.split("\n"):
        line = line.strip()
        if "::" not in line:
            continue
        for outcome in ("PASSED", "FAILED", "ERROR", "SKIPPED"):
            # Match: "test::name OUTCOME" (end of line, possibly with trailing spaces/percent)
            # Match: "OUTCOME test::name" (short form)
            # Match: "test::name OUTCOME [ 50%]" (verbose with progress)
            line_normalized = line.split(" - ")[0].strip()  # Remove " - reason" suffix
            matched = (
                line_normalized.startswith(outcome)
                or line_normalized.endswith(f" {outcome}")
                or f" {outcome} " in line_normalized
                or f" {outcome}[" in line_normalized   # "ERROR[chromium]" edge case
            )
            if matched:
                # Extract nodeid: part before/after OUTCOME keyword
                nodeid = line_normalized
                for kw in ("PASSED", "FAILED", "ERROR", "SKIPPED"):
                    nodeid = nodeid.replace(f" {kw}", "").replace(f"{kw} ", "").strip()
                tests.append({
                    "nodeid": nodeid or line,
                    "outcome": outcome.lower(),
                    "duration": 0.0,
                    "call": {"longrepr": line} if outcome != "PASSED" else {},
                })
                break

    return {
        "tests": tests,
        "summary": {
            "passed": sum(1 for t in tests if t["outcome"] == "passed"),
            "failed": sum(1 for t in tests if t["outcome"] == "failed"),
            "error": sum(1 for t in tests if t["outcome"] == "error"),
        },
    }


def _extract_error_message(test_report: dict) -> str:
    """Extract error message từ pytest JSON report test entry.
    Kiểm tra cả setup/call/teardown để bắt fixture errors.
    """
    def _get_longrepr(section: dict) -> str:
        longrepr = section.get("longrepr", "")
        if isinstance(longrepr, str):
            return longrepr
        if isinstance(longrepr, list):
            return "\n".join(str(x) for x in longrepr)
        return ""

    for phase in ("setup", "call", "teardown"):
        section = test_report.get(phase, {})
        if isinstance(section, dict):
            msg = _get_longrepr(section)
            if msg:
                return msg
    return ""


def _increment_counter(verdict: VerdictResult, tag: GapTag) -> None:
    if tag == "matching":
        verdict.matching += 1
    elif tag == "mismatch":
        verdict.mismatch += 1
    elif tag == "missing":
        verdict.missing += 1


def _build_test_verdict(tr: dict, tc_meta: dict[str, dict]) -> TestVerdict:
    nodeid: str = tr.get("nodeid", "")
    test_name = nodeid.split("::")[-1] if "::" in nodeid else nodeid
    outcome: str = tr.get("outcome", "error")
    duration_ms = float(tr.get("duration", 0)) * 1000
    error_msg = _extract_error_message(tr)
    tag, tag_reason = classify_outcome(outcome, error_msg)
    meta = tc_meta.get(test_name, {})
    return TestVerdict(
        test_id=meta.get("id", test_name),
        test_name=test_name,
        srs_section=meta.get("srs_section", ""),
        requirement_id=meta.get("requirement_id", ""),
        requirement_description=meta.get("requirement_description", ""),
        assertion_logic=meta.get("assertion_logic", ""),
        test_code=meta.get("code", ""),
        outcome=outcome,
        duration_ms=duration_ms,
        error_message=error_msg[:500],
        tag=tag,
        tag_reason=tag_reason,
    )


def run_and_tag(
    manifest: dict,
    config: VerdictConfig,
) -> VerdictResult:
    """
    Step A.3 + A.4: Chạy pytest → parse results → gán tag cho từng test.
    """
    pr_id: int = manifest.get("pr_id", 0)
    repo: str = manifest.get("repo", "")
    repo_type: str = manifest.get("repo_type", "unknown")
    test_file: str = manifest.get("test_file_path", "")
    test_cases: list[dict] = manifest.get("test_cases", [])

    # Build lookup: test name → metadata
    tc_meta: dict[str, dict] = {tc["name"]: tc for tc in test_cases}

    verdict = VerdictResult(
        pr_id=pr_id,
        repo=repo,
        repo_type=repo_type,
        test_file_path=test_file,
        manifest_path=manifest.get("manifest_path", ""),
        analyzed_at=datetime.now(timezone.utc).isoformat(),
    )

    if not test_file or not os.path.exists(test_file):
        logger.error(f"[A.3] Test file not found: {test_file}")
        return verdict

    # Chạy pytest
    base_url = config.get_base_url(repo_type)
    logger.info(f"[A.3] repo_type={repo_type} → base_url={base_url}")
    report = _run_pytest(test_file, config, base_url, repo_type=repo_type)
    test_reports: list[dict] = report.get("tests", [])

    # Gán tag cho từng test
    for tr in test_reports:
        nodeid: str = tr.get("nodeid", "")
        # nodeid format: "path/file.py::test_name"
        test_name = nodeid.split("::")[-1] if "::" in nodeid else nodeid

        outcome: str = tr.get("outcome", "error")
        duration_ms = float(tr.get("duration", 0)) * 1000
        error_msg = _extract_error_message(tr)

        tag, tag_reason = classify_outcome(outcome, error_msg)

        meta = tc_meta.get(test_name, {})
        tv = TestVerdict(
            test_id=meta.get("id", test_name),
            test_name=test_name,
            srs_section=meta.get("srs_section", ""),
            requirement_id=meta.get("requirement_id", ""),
            requirement_description=meta.get("requirement_description", ""),
            assertion_logic=meta.get("assertion_logic", ""),
            test_code=meta.get("code", ""),
            outcome=outcome,
            duration_ms=duration_ms,
            error_message=error_msg[:500],   # truncate dài quá
            tag=tag,
            tag_reason=tag_reason,
        )
        verdict.verdicts.append(tv)

        if tag == "matching":
            verdict.matching += 1
        elif tag == "mismatch":
            verdict.mismatch += 1
        elif tag == "missing":
            verdict.missing += 1

        logger.info(
            f"  [{tag.upper():>9}] {test_name}"
            f" — {tag_reason[:80]}"
        )

    verdict.total = len(verdict.verdicts)
    verdict.skipped = verdict.total - verdict.matching - verdict.mismatch - verdict.missing
    return verdict


# =============================================================================
# Save output
# =============================================================================

def save_verdict(verdict: VerdictResult, output_dir: str) -> str:
    safe_repo = verdict.repo.replace("/", "_").replace(" ", "-")
    filename = f"verdict_pr_{verdict.pr_id}_{safe_repo}.json"
    Path(output_dir).mkdir(parents=True, exist_ok=True)
    filepath = os.path.join(output_dir, filename)
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(asdict(verdict), f, ensure_ascii=False, indent=2)
    logger.info(f"[A.4] Verdict saved -> {filepath}")
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
    name="pr_webhook_module.workers.run_verdict_worker.run_verdict",
    max_retries=1,
    default_retry_delay=10,
)
def run_verdict(self, generate_tests_result: dict[str, Any]) -> dict[str, Any]:
    """
    Celery task Nhánh A: chạy generated tests → gán tag matching/mismatch/missing.

    Args:
        generate_tests_result: return value của generate_tests task
                               cần có: manifest_path

    Returns:
        dict với verdict_path, summary counts (matching/mismatch/missing)
    """
    manifest_path: str = generate_tests_result.get("manifest_path", "")
    if not manifest_path:
        raise ValueError("generate_tests_result thiếu 'manifest_path'")

    logger.info(f"[Branch A] Running verdict. Task ID: {self.request.id}")

    cfg = VerdictConfig()

    try:
        manifest = load_json(manifest_path)
        verdict = run_and_tag(manifest, cfg)
        verdict_path = save_verdict(verdict, cfg.output_dir)

        # Xóa temp test file sau khi đã chạy xong
        test_file = manifest.get("test_file_path", "")
        if test_file and os.path.exists(test_file):
            try:
                os.remove(test_file)
                logger.info(f"[Branch A] Cleaned up temp test file: {test_file}")
            except Exception as clean_err:
                logger.warning(f"[Branch A] Could not delete temp test file {test_file}: {clean_err}")

        logger.info(
            f"[Branch A] Done. "
            f"matching={verdict.matching} "
            f"mismatch={verdict.mismatch} "
            f"missing={verdict.missing} "
            f"/ total={verdict.total}"
        )

        result = {
            **generate_tests_result,
            "verdict_path": verdict_path,
            "summary": {
                "total": verdict.total,
                "matching": verdict.matching,
                "mismatch": verdict.mismatch,
                "missing": verdict.missing,
            },
        }

        return result
    except Exception as e:
        logger.error(f"[Branch A] Verdict task failed: {e}")
        raise self.retry(exc=e)

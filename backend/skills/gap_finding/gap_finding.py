"""
Gap Finding Pipeline — Python implementation.

Thay thế gap-finding/SKILL.md + CLI invocation.
Gọi qua CLIProxy → Claude API thay vì Claude Code CLI.

Pipeline:
  Step 1: Lấy PR changed files + patches từ GitHub REST API (thay thế gh CLI)
  Step 2: Query GitNexus theo feature_name để lấy context kiến trúc cả 2 repo
  Step 3: Query LightRAG lấy SRS UC spec
  Step 4: Normalize cả 2 về EAS format (Claude via CLIProxy)
  Step 5: So sánh row-by-row (Claude via CLIProxy)
  Step 6: Output JSON Drift Report
"""
import asyncio
import json
import logging
import os
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import httpx

from . import gitnexus as gn
from .config import (
    DEFAULT_BASE_BRANCH,
    GITHUB_API_URL,
    GITHUB_TOKEN,
    INTERNAL_API_KEY,
    LIGHTRAG_QUERY_TEMPLATE,
    MAX_CONTEXT_CHARS_PER_SYMBOL,
    MAX_DEEP_SYMBOLS_PER_REPO,
    MAX_FULL_FILE_CHARS,
    OUTLINE_INTERNAL_URL,
)

# Gap-finding LUÔN dùng Claude qua CLIProxy, độc lập với LLM_BINDING toàn cục
# (LLM_BINDING điều khiển LightRAG entity extraction — không liên quan gap-finding LLM calls)
_LLM_BINDING = "claude"

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────
# EAS SYSTEM PROMPTS (ported from SKILL.md, hardcoded here)
# ─────────────────────────────────────────────────────────────

_EAS_NORMALIZE_SYSTEM = """
You are an expert in SRS analysis and code execution flow normalization.
Task: Given input data (SRS spec + code context), produce two separate EAS tables.

IMPORTANT LANGUAGE RULE: All descriptive text in the output EAS tables (UC Name, Context,
Action descriptions, Guard descriptions, drift details, error summaries) MUST be written
in Vietnamese. Only keep English for technical identifiers: function names, file paths,
HTTP endpoints, class names, model names, git/GitNexus commands.

## CORE PRINCIPLE
FE and BE are NOT two separate flows — they are two parts of a single unified flow.
Read the flow as one continuous story: "User clicks → FE calls API → BE validates → BE processes → BE returns → FE renders"
Each step in that story = one row in the EAS table. The Layer column indicates whether the step is FE or BE.

## EAS FORMAT (used for BOTH tables)

UC-ID  : <UC-ID>
UC Name: <UC name in Vietnamese>
Context: <One-sentence end-to-end flow description in Vietnamese: FE trigger → through BE → to FE render>

#  | Layer | Actor       | Event                     | Action                              | State           | Guard
---|-------|-------------|---------------------------|-------------------------------------|-----------------|-------------------
1  | FE    | <Actor>     | <UI trigger>              | <FE: component/service/API call>    | <FE State>      | <FE Guard>
2  | BE    | System      | <Receive HTTP request>    | <BE: auth check>                    | <BE State>      | → 401/403
3  | BE    | System      | <Auth passed>             | <BE: business logic / queryset>     | <BE State>      | → 404
4  | BE    | System      | <Logic done>              | <BE: serialize + return>            | <BE State>      | —
5  | FE    | System (FE) | <Receive response>        | <FE: update state, render UI>       | <FE State>      | —

## SRS → EAS MAPPING

| SRS Field     | EAS Column                                  |
|---------------|---------------------------------------------|
| Actor         | Actor (separate column)                     |
| Trigger       | Event #1                                    |
| Precondition  | Guard at the validate step                  |
| Main Flow     | Action chain (sequential rows)              |
| Postcondition | Final State (last row of happy path)        |
| Business Rule | Inline BR ref at the correct step           |
| Exception/Alt | Explicit separate fail steps                |

## GITNEXUS → EAS MAPPING (for EAS from Code)

| GitNexus Output     | EAS Column                              |
|---------------------|-----------------------------------------|
| Process entry point | Event #1 (FE trigger)                   |
| FE service method   | Action at FE layer                      |
| HTTP endpoint       | Event at BE layer                       |
| BE viewset method   | Action at BE layer                      |
| Guard/condition     | Guard column                            |
| HTTP status codes   | Guard notation (→ 401/403/404)          |
| Callee chain        | Sub-actions written in the same row     |
| Impact upstream     | Actor (who triggers this flow)          |

## RULES
- Layer = FE or BE only
- Row order = actual execution order — FE and BE interleave as the flow runs
- BE Guard: HTTP status code notation (→ 401/403/404)
- FE Guard: UI conditions, loading state
- Do not omit error handling rows
- If FE has not implemented a part → write row with Action = "⚠️ Chưa tìm thấy FE implementation"
- Business Rules: inline at the correct step, e.g. "BR 2-1: sắp xếp tên SV A-Z"
- Context field: one sentence describing the full end-to-end flow, e.g.:
  "CourseClassService.getById() → GET /api/course-classes/{id}/ → CourseClassViewSet.retrieve() → Serializer → render màn hình chi tiết"
- **SRS gap marking**: if a specific value (sort field/direction, filter clause, button label) is NOT a verbatim quote in THIS UC's chunks, write Guard = "⚠️ Chưa định nghĩa trong SRS". Do NOT borrow from sibling UCs — downstream tags this as `srs_gap`, not `mismatch`.
- **Inherited ORM defaults**: before declaring a soft filter missing ("≠ Đã xóa", "active=true"), check parent base class for default manager filter (Django `_default_manager.get_queryset`, JPA `@Where`, Rails `default_scope`). If parent body not visible, emit "Cần thêm context để xác minh: <BaseClassName>" instead of "missing".

## OUTPUT
Output ONLY the two EAS tables in the correct format. No other text.

### EAS from SRS — <UC-ID>: <UC Name in Vietnamese>
[EAS table built from SRS spec]

---

### EAS from Code — <UC-ID>: <UC Name in Vietnamese>
Source: <FE + BE file paths if known>
[EAS table built from code context]
""".strip()

_EAS_COMPARE_SYSTEM = """
You are an expert in comparing SRS specifications against code implementations.
Input: two EAS tables (EAS from SRS, EAS from Code).
Task: Compare row-by-row and output a JSON Drift Report following the schema provided.

IMPORTANT LANGUAGE RULE: All free-text fields in the JSON output (uc_name, error_summary,
drift_detail, business rule details, surplus reason, guard descriptions, action descriptions)
MUST be written in Vietnamese. Only keep English for technical identifiers: function names,
file paths, HTTP endpoints, class names, model names.

## STEP 1: MAP CODE ROWS TO SRS ROWS

Apply 4 Rules in priority order:

### Rule 1: Match by Business Intent (MOST IMPORTANT)
Same business purpose = match, regardless of function name or implementation style.
Example: SRS "validate old password is not blank" ↔ Code validate_old_password() if not value → raise ValidationError → MATCH

### Rule 2: Match by Actor + Role Path
Code rows in the Instructor path → map only to SRS rows for Instructor.
Code rows in the Learner path → map only to SRS rows for Learner.
Do not cross-map between different actor paths.

### Rule 3: Many Code rows map to one SRS row (Many-to-1)
One abstract SRS step typically requires multiple code steps to implement.
Group all Code rows serving the same SRS intent into one mapping group before assigning a label.
Example: SRS "Hash and save, update Modified Date, Modified By" ← Code: check_password() + set_password() + user.save()

### Rule 4: Unmatched rows
- Code exists, SRS does not → put in surplus_items (NOT in gap_rows)
- SRS exists, Code does not → gap_rows entry with code fields = null

## STEP 2: ASSIGN DRIFT LABEL

After mapping, assign one label per SRS row:

| Drift Label | JSON `tag`  | JSON `drift_label` | Condition                                              |
|-------------|-------------|--------------------|--------------------------------------------------------|
| Match       | `matching`  | `match`            | Code fully matches SRS (actor, event, action, state)  |
| Partial     | `mismatch`  | `partial`          | Same intent but wrong logic/field/formula/order        |
| Hard Drift  | `missing`   | `hard_drift`       | SRS has the step, Code has nothing for it              |
| Extra Impl  | —           | —                  | Code does more than spec → goes to surplus_items       |
| SRS Gap     | `missing`   | `srs_gap`          | Neither SRS nor Code is clear — spec never defined it  |

## CITATION RULE (CRITICAL — applied to EVERY verdict)

Every `match` verdict MUST include at least one `code_references` entry with a
verbatim snippet copied from CODE CONTEXT that proves the SRS step is
implemented. If you cannot quote the exact code that implements the SRS
requirement, you MUST tag the row as `mismatch` (partial) or `missing`
(hard_drift) — never assume implicit/default behavior counts as implementation.

### Specifically forbidden
1. **Framework default ≠ explicit handling.**
   Examples that DO NOT qualify as `match`:
   - "Servlet container default error page" satisfying SRS "show error message"
   - "Spring auto-validation" satisfying SRS-defined validation rules
   - "Django default 404" satisfying SRS-defined not-found flow
   - Empty `catch` blocks or `printStackTrace()` satisfying SRS error display
   These are `hard_drift` because the explicit SRS-defined behavior is absent
   in the project's own code.

2. **Implicit/inferred behavior is not match.**
   If the code does not explicitly implement what SRS describes — even if a
   reasonable developer would assume the framework handles it — tag as
   `partial` or `hard_drift`, not `match`.

3. **Removal of buggy code is not a fix.**
   When PR removes a method (e.g., `countTotalLessons` deleted), do not
   conclude "PR fixes the issue" automatically. Evaluate the REMAINING code
   against SRS — the removal may itself create a `hard_drift` (SRS step now
   has no implementation), or the original method may have been wrong-scope
   (SRS expects per-entity scope but code computed global scope).

4. **Filter / scope / condition clauses are mandatory evidence.**
   If SRS specifies a filter ("active only", "public only", "per subject",
   "current user", "BR-XX: chỉ hiển thị thông tin công khai"), you MUST find
   the corresponding `WHERE`, `IF`, predicate, or guard clause in code.
   Absence of the clause = `partial` (intent right but filter wrong) or
   `hard_drift` (filter completely missing).

5. **Pre-existing wrong scope is still drift.**
   If a method called by the changed code has wrong scope vs SRS (e.g., SRS
   expects `WHERE subject_id = ?` but code has unconditional `SELECT COUNT(*)`),
   flag it as `partial` even if the PR did not introduce the issue. The drift
   report measures CODE vs SRS, not PR delta vs SRS.

6. **Membership guard ≠ ownership filter.**
   - SRS "must be Learner of class X → 403" requires explicit reject (raise
     `PermissionDenied`, `permission_classes`, middleware). A `WHERE owner=user`
     does NOT satisfy it — non-members get 200+`[]` instead of 403. Tag `hard_drift`.
   - SRS "show only my records" → 200 with filter is satisfied by `.filter(owner=user)`.
   When code only filters by user but SRS demands access guard, the right tag is
   `hard_drift` (the 403 path is missing), NOT `partial`.

### When uncertain
If CODE CONTEXT is insufficient to decide (e.g., a referenced symbol's body is
not visible), prefer `partial` with `drift_detail` explicitly stating
"Cần thêm context để xác minh: <symbol_name>" — never default to `match`
under uncertainty.

## STEP 3: BUILD error_summary (3-layer analysis)

Analyze drift across 3 layers to write error_summary (in Vietnamese):
- Business layer: Are Actor, trigger, postcondition correct?
- Frontend layer: Does UI flow match spec? Navigation, display, state update?
- Backend layer: API endpoint, validation, business rules, data handling correct?

## RULES FOR POPULATING JSON

- `tag` MUST be lowercase: `matching`, `mismatch`, `missing`
- `drift_label` is the raw label: `match`, `partial`, `hard_drift`, `srs_gap`
- `gap_rows` must include ALL steps — both happy path and exception flows
- If a step only exists in SRS (hard_drift): set code fields = null
- Code extra impl → goes to `surplus_items`, NOT `gap_rows`
- `srs` side: use business language (Actor = Instructor/Learner, Event = UI trigger) — in Vietnamese
- `code` side: use technical names (Actor = Client/System, Event = HTTP method + endpoint)
- `drift_detail`: empty string if match; specific mismatch description in Vietnamese if partial/hard_drift/srs_gap
- `srs_references`: verbatim quotes from SRS response. For each reference, populate:
    - `quote`: verbatim excerpt from the SRS UC SPEC.
    - `reference_id`: the integer N from the `[SRS-REF-N]` block whose chunk contains this quote (e.g., `1`, `2`). If no SRS-REF block matches, omit `reference_id`.
    - `file_path`: the filename portion only (e.g., "UC-78.md"). Server will enrich this with the actual document link based on `reference_id`.
- `code_references`: from git diff or gitnexus context — file path + line number + snippet
- If SRS not found: gap_rows = [], error_summary = "⚠️ Không tìm thấy UC trong LightRAG."
- If all rows match: error_summary = "Tất cả các bước đều khớp giữa code và SRS. Không phát hiện drift."

Output MUST be a single JSON block. No text of any kind outside the JSON.
""".strip()

_GAP_FINDING_OUTPUT_SCHEMA = """
Output the following JSON schema exactly (no additional text):
{
  "uc_id": "UC-XXX",
  "uc_name": "<UC name in Vietnamese>",
  "repo_type": "backend | frontend",
  "error_summary": "<short Vietnamese summary of detected drift>",
  "gap_rows": [
    {
      "step": 1,
      "tag": "matching | mismatch | missing",
      "drift_label": "match | partial | hard_drift | srs_gap",
      "drift_detail": "<Vietnamese description of the mismatch, empty string if match>",
      "srs": {
        "actor": "...", "event": "...", "action": "...",
        "state": "...", "guard_br": "..."
      },
      "code": {
        "actor": "...", "event": "...", "action": "...",
        "state": "...", "guard": "..."
      },
      "srs_references": [{"quote": "...", "reference_id": 1, "file_path": "..."}],
      "code_references": [{"file_path": "...", "line": 0, "snippet": "..."}]
    }
  ],
  "business_rules": [
    {
      "id": "BR-X-Y", "name": "<Vietnamese name>", "step_ref": 1,
      "details": ["<Vietnamese detail>"], "undefined": "<what SRS left undefined>"
    }
  ],
  "surplus_items": [
    {
      "id": "SURPLUS-01", "actor": "...", "event": "...",
      "action": "...", "state": "...", "guard": "...",
      "reason": "<Vietnamese explanation of why this is extra>",
      "confidence": "high | medium | low",
      "code_references": []
    }
  ]
}
""".strip()


# ─────────────────────────────────────────────────────────────
# DATA CLASSES
# ─────────────────────────────────────────────────────────────

@dataclass
class GapFindingRequest:
    """Input cho gap-finding pipeline."""
    # Một trong ba: pr_number, branch_range, hoặc feature_name
    pr_number: int | None = None
    repo: str | None = None               # "org/EVO-LMS-DJANGO"
    branch_range: str | None = None       # "develop..feature-branch"
    feature_name: str | None = None       # "xem chi tiet lop hoc"
    uc_id: str | None = None              # "UC-TM-002"
    base_branch: str = DEFAULT_BASE_BRANCH
    workspace_id: str = ""                # LightRAG workspace (teamId)
    workspace_id: str = ""                # LightRAG workspace (teamId)
    # user credentials để gọi Claude via CLIProxy
    # Nếu None, run_gap_finding() sẽ đọc từ env PIPELINE_CREDENTIALS_JSON / PIPELINE_CRED_PATH
    credentials_json: str | None = None
    user_id: str | None = None


@dataclass
class GapFindingResult:
    """Output từ gap-finding pipeline."""
    success: bool
    drift_report: dict | None = None
    error: str | None = None


# ─────────────────────────────────────────────────────────────
# HELPER FUNCTIONS
# ─────────────────────────────────────────────────────────────

def _determine_repo_role(repo: str) -> str:
    """Xác định role (backend/frontend) từ repo name."""
    repo_lower = repo.lower()
    if "django" in repo_lower or "backend" in repo_lower:
        return "backend"
    if "angular" in repo_lower or "frontend" in repo_lower or "lms-angular" in repo_lower:
        return "frontend"
    return "backend"  # default


def _other_role(role: str) -> str:
    return "frontend" if role == "backend" else "backend"


def _extract_repo_short_name(full_repo: str) -> str:
    """Strip 'owner/' prefix để lấy repo name mà GitNexus dùng làm khóa."""
    if not full_repo:
        return ""
    return full_repo.split("/", 1)[1] if "/" in full_repo else full_repo


async def _fetch_github_config_from_db(team_id: str) -> tuple[str, list[dict]]:
    """
    Lấy GitHub token + repositories list từ DB qua Node.js internal endpoint.
    Fallback: (GITHUB_TOKEN env var, []) nếu DB không có config hoặc lỗi.
    """
    if not team_id or not INTERNAL_API_KEY:
        return GITHUB_TOKEN, []

    url = f"{OUTLINE_INTERNAL_URL}/api/github.internalConfig"
    headers = {"X-Internal-Api-Key": INTERNAL_API_KEY}
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(url, headers=headers, params={"teamId": team_id})
            resp.raise_for_status()
            data = resp.json().get("data")
            if not data or not data.get("apiKey"):
                logger.warning(
                    f"[GapFinding] Không tìm thấy GitHub config trong DB cho teamId={team_id}, "
                    "fallback sang env var"
                )
                return GITHUB_TOKEN, []
            repos = data.get("repositories") or []
            logger.info(
                f"[GapFinding] GitHub config từ DB — teamId={team_id}, repos={len(repos)}"
            )
            return data["apiKey"], repos
    except Exception as e:
        logger.warning(f"[GapFinding] Không lấy được GitHub config từ DB: {e}, fallback sang env var")
        return GITHUB_TOKEN, []


async def _get_pr_head_ref(
    pr_number: int,
    repo: str,
    github_token: str = "",
    github_api_url: str = "https://api.github.com",
) -> tuple[str, str]:
    """
    Lấy head SHA + head branch name của PR để build link GitHub ổn định
    (tránh link bị lỗi khi branch bị xoá/force-push).
    Returns (sha, ref). Trả ("", "") nếu lỗi.
    """
    if not github_token or not pr_number or not repo:
        return "", ""
    headers = {
        "Authorization": f"Bearer {github_token}",
        "Accept": "application/vnd.github.v3+json",
    }
    url = f"{github_api_url}/repos/{repo}/pulls/{pr_number}"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(url, headers=headers)
            resp.raise_for_status()
            data = resp.json()
        head = data.get("head", {}) or {}
        return head.get("sha", ""), head.get("ref", "")
    except Exception as e:
        logger.warning(f"[GapFinding] Không lấy được PR head ref: {e}")
        return "", ""


def _build_code_url(repo_full: str, ref: str, file_path: str, line: int = 0) -> str:
    """Build GitHub blob URL: https://github.com/{repo}/blob/{ref}/{file}#L{line}."""
    if not repo_full or not file_path:
        return ""
    ref = ref or "HEAD"
    line_frag = f"#L{line}" if line and line > 0 else ""
    return f"https://github.com/{repo_full}/blob/{ref}/{file_path}{line_frag}"


def _enrich_code_references(
    drift_report: dict,
    changed_files: list[dict],
    changed_repo_full: str,
    changed_ref: str,
    other_repo_full: str,
    other_ref: str = "HEAD",
) -> None:
    """
    Mutates drift_report in-place: thêm `repo` và `url` cho mỗi code_reference.
    - Nếu file_path match changed_files của PR → dùng changed_repo_full + changed_ref (SHA)
    - Ngược lại → dùng other_repo_full + HEAD branch
    """
    changed_file_set = {f.get("filename", "") for f in changed_files if f.get("filename")}

    def _enrich_one(ref: dict) -> None:
        fp = ref.get("file_path", "") or ""
        if not fp:
            return
        if fp in changed_file_set:
            ref["repo"] = changed_repo_full
            ref["url"] = _build_code_url(changed_repo_full, changed_ref, fp, ref.get("line", 0))
        elif other_repo_full:
            ref["repo"] = other_repo_full
            ref["url"] = _build_code_url(other_repo_full, other_ref, fp, ref.get("line", 0))

    for row in drift_report.get("gap_rows", []) or []:
        for ref in row.get("code_references", []) or []:
            if isinstance(ref, dict):
                _enrich_one(ref)
    for item in drift_report.get("surplus_items", []) or []:
        for ref in item.get("code_references", []) or []:
            if isinstance(ref, dict):
                _enrich_one(ref)


_VALID_GAP_DRIFT_LABELS = {"match", "partial", "hard_drift", "srs_gap"}
_VALID_GAP_TAGS = {"matching", "mismatch", "missing"}


def _normalize_drift_report(drift_report: dict) -> None:
    """
    Mutate drift_report in-place — enforce schema invariants LLM hay vi phạm:

      1. Row trong gap_rows có tag='surplus' / drift_label='surplus' (Rule 4 violation)
         → di chuyển sang surplus_items.
      2. Sort gap_rows theo step ascending để FE render STT tuần tự.

    Không phụ thuộc renderer FE — backend đảm bảo output đúng schema.
    """
    if not isinstance(drift_report, dict):
        return

    gap_rows = drift_report.get("gap_rows") or []
    surplus_items = drift_report.get("surplus_items") or []
    if not isinstance(gap_rows, list):
        gap_rows = []
    if not isinstance(surplus_items, list):
        surplus_items = []

    kept: list[dict] = []
    moved = 0
    for row in gap_rows:
        if not isinstance(row, dict):
            continue
        tag = str(row.get("tag") or "").lower()
        drift_label = str(row.get("drift_label") or "").lower()
        is_surplus = (
            tag == "surplus"
            or drift_label == "surplus"
            or (tag not in _VALID_GAP_TAGS and drift_label not in _VALID_GAP_DRIFT_LABELS)
        )
        if is_surplus:
            code = row.get("code") or {}
            if not isinstance(code, dict):
                code = {}
            surplus_items.append({
                "id": f"SURPLUS-{len(surplus_items) + 1:02d}",
                "actor": code.get("actor", "") or "",
                "event": code.get("event", "") or "",
                "action": code.get("action", "") or "",
                "state": code.get("state", "") or "",
                "guard": code.get("guard", "") or "",
                "reason": row.get("drift_detail", "") or "",
                "confidence": "medium",
                "code_references": row.get("code_references", []) or [],
            })
            moved += 1
        else:
            kept.append(row)

    def _step_key(r: dict) -> tuple[int, int]:
        s = r.get("step")
        if isinstance(s, int):
            return (s, 0)
        if isinstance(s, str) and s.isdigit():
            return (int(s), 0)
        return (10**6, 0)  # rows không có step rơi cuối

    kept.sort(key=_step_key)

    drift_report["gap_rows"] = kept
    drift_report["surplus_items"] = surplus_items

    if moved:
        logger.info(
            f"[GapFinding] Normalize: moved {moved} surplus rows từ gap_rows → surplus_items"
        )


def _resolve_srs_doc_ids(drift_report: dict, chunk_lookup: dict[str, dict]) -> None:
    """
    Mutate drift_report in-place: gắn `document_id` cho mỗi `srs_references[i]`
    bằng cách map về `chunk_lookup` (build từ srs_chunks gốc của LightRAG).

    Strategy theo thứ tự (lấy match đầu tiên):
      1. `reference_id` LLM trả về khớp key chunk_lookup
      2. `filename` (từ file_path) khớp filename của 1 chunk
      3. `quote` xuất hiện trong content của 1 chunk

    Nếu không có chunk nào khớp → `document_id = ""` (FE không build được link,
    sẽ rơi về fallback hiện có).
    """
    if not chunk_lookup:
        return

    # Index phụ để lookup nhanh
    by_filename: dict[str, dict] = {}
    for c in chunk_lookup.values():
        fn = (c.get("filename") or "").strip()
        if fn and fn not in by_filename:
            by_filename[fn] = c

    def _resolve_one(ref: dict) -> None:
        if not isinstance(ref, dict):
            return

        # Strategy 1: reference_id
        rid = ref.get("reference_id")
        rid_key = str(rid).strip() if rid is not None else ""
        chunk = chunk_lookup.get(rid_key) if rid_key else None

        # Strategy 2: filename
        if not chunk:
            fp = str(ref.get("file_path") or "").strip()
            # Nếu LLM lỡ giữ format cũ "{docId}<#>{filename}" thì cắt lấy filename
            if "<#>" in fp:
                fp = fp.split("<#>", 1)[1]
            if fp and fp in by_filename:
                chunk = by_filename[fp]

        # Strategy 3: quote substring trong chunk content
        if not chunk:
            quote = str(ref.get("quote") or "").strip()
            if len(quote) >= 20:
                quote_norm = " ".join(quote.split())
                for c in chunk_lookup.values():
                    content_norm = " ".join((c.get("content") or "").split())
                    if quote_norm in content_norm:
                        chunk = c
                        break

        if chunk:
            ref["document_id"] = chunk.get("doc_id") or ""
            # Normalize file_path = filename (drop docId prefix nếu có)
            if not ref.get("file_path") or "<#>" in str(ref.get("file_path")):
                ref["file_path"] = chunk.get("filename") or ""
        else:
            ref["document_id"] = ""
            logger.warning(
                f"[GapFinding] Không resolve được document_id cho srs_reference: "
                f"reference_id={rid!r}, file_path={ref.get('file_path')!r}, "
                f"quote_prefix={str(ref.get('quote') or '')[:60]!r}"
            )

    for row in drift_report.get("gap_rows", []) or []:
        if isinstance(row, dict):
            for ref in row.get("srs_references", []) or []:
                _resolve_one(ref)


async def _get_pr_changed_files_github(
    pr_number: int,
    repo: str,
    github_token: str = "",
    github_api_url: str = "https://api.github.com",
) -> tuple[str, list[dict]]:
    """
    Lấy danh sách changed files + patch diffs từ GitHub REST API.
    Thay thế `gh pr diff` subprocess vì backend container không có gh CLI.

    Returns:
        (pr_diff_text, changed_files_list)
        pr_diff_text: nối tất cả patches lại, cap 8000 chars
        changed_files_list: list raw file objects từ GitHub API
    """
    if not github_token:
        logger.warning("[GapFinding] GITHUB_TOKEN chưa được cấu hình — bỏ qua PR diff")
        return "", []

    headers = {
        "Authorization": f"Bearer {github_token}",
        "Accept": "application/vnd.github.v3+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    url = f"{github_api_url}/repos/{repo}/pulls/{pr_number}/files"

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(url, headers=headers, params={"per_page": 30})
            resp.raise_for_status()
            files = resp.json()

        # Build diff text từ patch field của từng file
        diff_parts = []
        for f in files:
            filename = f.get("filename", "")
            patch = f.get("patch", "")
            status = f.get("status", "modified")
            if patch:
                diff_parts.append(f"[{status}] {filename}\n{patch}")
            else:
                diff_parts.append(f"[{status}] {filename} (no patch — binary or too large)")

        pr_diff = "\n\n".join(diff_parts)[:8000]
        logger.info(
            f"[GapFinding] GitHub API: {len(files)} changed files cho PR#{pr_number}"
        )
        return pr_diff, files

    except Exception as e:
        logger.error(f"[GapFinding] GitHub API PR files error: {e}")
        return "", []


def _extract_seed_symbols_from_diff(
    changed_files: list[dict],
    full_file_contents: dict[str, str] | None = None,
    top_n: int = 30,
) -> list[str]:
    """
    Extract identifier names từ patch hunks + full file content (nếu có).

    Language-agnostic: chỉ dùng heuristic structural (regex), KHÔNG hardcode
    keyword theo ngôn ngữ. Hoạt động cho Java/Python/JS/TS/Go/Kotlin/...

    Strategy:
      1. Capture identifiers theo 2 hình thái phổ biến:
         - PascalCase (user-defined types/classes)        → MyClass, UserService
         - camelCase / snake_case calls hoặc defs ≥3 ký tự → getUser, save_user
      2. Filename basename → seed symbol (HomepageServlet.java → HomepageServlet)
      3. Đếm tần suất, trả top_n để giới hạn Cypher query size
      4. Filter stopwords TỐI THIỂU & UNIVERSAL: chỉ những từ cực ngắn (<3 chars).
         Symbol thật sự trong codebase user sẽ được GitNexus xác minh — nếu
         identifier không tồn tại trong graph, Cypher tự động trả rỗng.

    `full_file_contents`: dict {filename: content} — khi cung cấp, parse cả
    full file để bắt được callee pre-existing nằm ngoài patch hunk
    (ví dụ: `packageDAO.getAllPackage1()` được HomepageServlet gọi nhưng
    dòng đó không nằm trong diff PR).
    """
    import re
    from collections import Counter

    counter: Counter[str] = Counter()

    # PascalCase: bắt đầu chữ hoa, 3+ ký tự — phổ biến cho class/type ở mọi ngôn ngữ
    class_pat = re.compile(r"\b([A-Z][A-Za-z0-9_]{2,})\b")
    # Method/function calls: `.name(` hoặc `name(` — bao quát hầu hết ngôn ngữ
    call_pat = re.compile(r"(?:^|[^A-Za-z0-9_])([a-zA-Z_][a-zA-Z0-9_]{2,})\s*\(")
    # Snake_case/camelCase identifier nằm sau dot (method access)
    method_access_pat = re.compile(r"\.([a-zA-Z_][a-zA-Z0-9_]{2,})\b")

    def _scan_text(text: str) -> None:
        for raw_line in text.splitlines():
            if not raw_line or raw_line.startswith(("@@", "---", "+++", "diff --git")):
                continue
            # Patch lines: strip leading +/- nhưng giữ nội dung
            line = raw_line[1:] if raw_line and raw_line[0] in "+- " else raw_line
            for name in class_pat.findall(line):
                counter[name] += 1
            for name in call_pat.findall(line):
                # Loại từ khoá control flow ngắn vô tình lọt (if, for, while...)
                if len(name) < 3:
                    continue
                counter[name] += 1
            for name in method_access_pat.findall(line):
                if len(name) < 3:
                    continue
                counter[name] += 1

    for f in changed_files:
        filename = f.get("filename") or ""
        if filename:
            base = filename.rsplit("/", 1)[-1].rsplit(".", 1)[0]
            if base and len(base) >= 3:
                counter[base] += 5  # boost vì là tên file đã thay đổi
        patch = f.get("patch") or ""
        if patch:
            _scan_text(patch)

    if full_file_contents:
        for content in full_file_contents.values():
            if content:
                _scan_text(content)

    # Sort theo tần suất giảm dần, đảm bảo deterministic bằng tên alphabet khi tie
    ranked = sorted(counter.items(), key=lambda kv: (-kv[1], kv[0]))
    return [name for name, _ in ranked[:top_n]]


# Suffixes BE phổ biến cần strip khi bridge sang FE search
_BE_SYMBOL_SUFFIXES = (
    "ViewSet", "ViewSet ", "View", "Manager", "Service", "Controller",
    "Repository", "Serializer", "Permission", "Pagination", "Form",
)
_BE_FILE_SUFFIXES = (
    "_viewset", "_serializer", "_service", "_form", "_manager",
    "_repository", "_controller", "_permission", "_pagination",
)
# Tokens quá generic, dễ match toàn bộ FE — bỏ qua
_GENERIC_TOKENS = {
    "models", "views", "utils", "config", "common", "base", "test",
    "tests", "main", "index", "core", "api", "type", "types", "data",
}


def _derive_other_repo_search_tokens(
    seed_symbols: list[str],
    changed_files: list[dict],
) -> list[str]:
    """
    Dẫn xuất tokens để search OTHER repo (FE) từ BE seed symbols + changed file paths.

    BE Django (snake_case + suffix `_viewset`) ↔ FE Angular (kebab-case + `Component`)
    dùng tên domain khác nhau → keyword search trực tiếp thường miss. Helper này:
      1. Strip BE suffix (ViewSet, Manager, Serializer, ...)
      2. Convert snake_case → kebab-case
      3. Generate Q-A variants (qna ↔ qa) — convention 2 repo có thể khác
      4. Lấy domain noun từ basename file đã đổi (thường share giữa 2 repo)
      5. Filter generic tokens (models, views, ...) để giảm false positive
    """
    tokens: set[str] = set()

    def _add_token(t: str) -> None:
        t = t.strip().lower()
        if len(t) >= 3 and t not in _GENERIC_TOKENS:
            tokens.add(t)

    def _add_with_variants(base: str) -> None:
        _add_token(base)
        # snake → kebab và ngược lại
        if "_" in base:
            _add_token(base.replace("_", "-"))
            _add_token(base.replace("_", ""))
        elif "-" in base:
            _add_token(base.replace("-", "_"))
            _add_token(base.replace("-", ""))
        # Q-A vs QnA (BE 'class_qna' ↔ FE 'class-qa')
        for variant in (base.replace("qna", "qa"), base.replace("qa", "qna")):
            _add_token(variant)
            if "_" in variant:
                _add_token(variant.replace("_", "-"))
            if "-" in variant:
                _add_token(variant.replace("-", "_"))

    for sym in seed_symbols or []:
        clean = sym
        for suf in _BE_SYMBOL_SUFFIXES:
            if clean.endswith(suf):
                clean = clean[: -len(suf)]
                break
        if len(clean) >= 3:
            _add_with_variants(clean.lower())

    for f in (changed_files or [])[:8]:
        path = f.get("filename") or ""
        if not path:
            continue
        base = path.rsplit("/", 1)[-1].rsplit(".", 1)[0]
        for suf in _BE_FILE_SUFFIXES:
            if base.endswith(suf):
                base = base[: -len(suf)]
                break
        if len(base) >= 3:
            _add_with_variants(base.lower())

    return list(tokens)[:12]


async def _fetch_full_file_content_github(
    filename: str,
    repo: str,
    ref: str = "",
    github_token: str = "",
    github_api_url: str = "https://api.github.com",
    max_chars: int = MAX_FULL_FILE_CHARS,
) -> str:
    """
    Lấy full content của 1 file qua GitHub Contents API.

    Cung cấp pre-existing context cho Claude — patch hunk chỉ thấy ±3 dòng
    quanh thay đổi, không thấy callee/dependency đã có sẵn trong file.

    Returns: decoded UTF-8 content, cap ở `max_chars`. "" nếu lỗi/binary.
    """
    if not github_token or not filename or not repo:
        return ""

    import base64

    headers = {
        "Authorization": f"Bearer {github_token}",
        "Accept": "application/vnd.github.v3+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    url = f"{github_api_url}/repos/{repo}/contents/{filename}"
    params = {"ref": ref} if ref else {}

    try:
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.get(url, headers=headers, params=params)
            resp.raise_for_status()
            data = resp.json()
        if data.get("encoding") != "base64":
            return ""
        content = base64.b64decode(data.get("content", "")).decode("utf-8", errors="replace")
        return content[:max_chars]
    except Exception as e:
        logger.warning(f"[GapFinding] Full file fetch failed: {filename} — {e}")
        return ""


async def _query_lightrag_srs(
    uc_id: str,
    uc_name: str,
    workspace_id: str = "",
    credentials_json: str = "",
    user_id: str = "",
) -> tuple[str, list[dict]]:
    """Query LightRAG để lấy SRS UC spec + chunks với file_path đầy đủ.

    Returns (srs_text, chunks). chunks mỗi phần tử có:
      - content, file_path (format "{docId}<#>{filename}"), reference_id
    → để build citation clickable giống chat.

    LightRAG internal sẽ gọi llm_model_func → _call_claude_cli_async để synthesize
    answer từ chunks. Pattern giống chat.py: override llm_model_func + set ContextVar
    để _call_claude_cli_async đọc được credentials pipeline-global.
    """
    from rag_state import (
        _call_claude_cli_async,
        _request_credentials,
        _request_user_id,
        get_rag_for_workspace,
    )
    from lightrag import QueryParam

    query_text = LIGHTRAG_QUERY_TEMPLATE.format(
        uc_id=uc_id or "",
        uc_name=uc_name or "",
    )

    logger.info(f"[GapFinding] LightRAG query — workspace={workspace_id!r} query[:60]={query_text[:60]!r}")
    try:
        rag = await get_rag_for_workspace(workspace_id)
        rag.llm_model_func = _call_claude_cli_async

        token_cred = _request_credentials.set(credentials_json or "")
        token_uid = _request_user_id.set(user_id or "pipeline-system")
        try:
            # aquery_llm trả về dict có "llm_response.content" + "raw_data.data.chunks"
            # Dùng nó thay aquery() để lấy được chunks với file_path "{docId}<#>{filename}"
            result = await rag.aquery_llm(query_text, param=QueryParam(mode="hybrid"))
        finally:
            _request_credentials.reset(token_cred)
            _request_user_id.reset(token_uid)

        llm_text = (result.get("llm_response") or {}).get("content", "") or ""
        raw = result.get("raw_data") or {}
        data = raw.get("data") or result.get("data") or {}
        chunks: list[dict] = data.get("chunks") or []
        if not llm_text.strip():
            return "", chunks
        return llm_text, chunks
    except RuntimeError as e:
        logger.error(f"[GapFinding] LightRAG chưa sẵn sàng (workspace={workspace_id!r}): {e}")
        return "", []
    except Exception as e:
        logger.error(f"[GapFinding] LightRAG query error (workspace={workspace_id!r}): {e}")
        return "", []


async def _call_llm(
    prompt: str,
    system_prompt: str,
    credentials_json: str | None = None,
    user_id: str | None = None,
) -> str:
    """
    Gọi LLM theo LLM_BINDING được cấu hình trong rag_state:
      - gemini   → _call_gemini_async (API key từ env, không cần OAuth)
      - claude   → _call_claude_cli_async qua CLIProxy (cần OAuth credentials)
    """
    if _LLM_BINDING != "claude":
        # Gemini hoặc bất kỳ binding nào khác — không cần OAuth
        from rag_state import _call_gemini_async
        return await _call_gemini_async(prompt=prompt, system_prompt=system_prompt)

    # Claude CLIProxy path — cần credentials và user_id
    from rag_state import (
        _call_claude_cli_async,
        _request_credentials,
        _request_user_id,
    )

    token_cred = _request_credentials.set(credentials_json or "")
    token_uid = _request_user_id.set(user_id or "pipeline-system")
    try:
        return await _call_claude_cli_async(
            prompt=prompt,
            system_prompt=system_prompt,
        )
    finally:
        _request_credentials.reset(token_cred)
        _request_user_id.reset(token_uid)


# ─────────────────────────────────────────────────────────────
# MAIN PIPELINE
# ─────────────────────────────────────────────────────────────

async def run_gap_finding(request: GapFindingRequest) -> GapFindingResult:
    """
    Chạy gap-finding pipeline đầy đủ.

    Steps 1-5 là internal work. Output cuối là JSON Drift Report.
    Khi LLM_BINDING=gemini: không cần credentials_json/user_id (Gemini dùng API key từ env).
    Khi LLM_BINDING=claude: cần credentials_json và user_id cho CLIProxy.
    """
    # Resolve credentials: request fields first, then env vars, then mounted file
    credentials_json = request.credentials_json
    if not credentials_json:
        credentials_json = os.getenv("PIPELINE_CREDENTIALS_JSON", "")
    if not credentials_json:
        _cred_path = Path(os.getenv("PIPELINE_CRED_PATH", "/root/.claude/.credentials.json"))
        if _cred_path.exists():
            credentials_json = _cred_path.read_text(encoding="utf-8")

    user_id = request.user_id or os.getenv("PIPELINE_USER_ID", "pipeline")

    if not credentials_json or not user_id:
        return GapFindingResult(
            success=False,
            error=(
                "credentials_json và user_id là bắt buộc. "
                "Set PIPELINE_CREDENTIALS_JSON hoặc mount ~/.claude vào container."
            ),
        )

    # Lấy GitHub config (token + repositories) từ DB theo teamId.
    # Dùng sớm để resolve repo names đúng (GitNexus register theo tên repo thật).
    github_token, team_repos = await _fetch_github_config_from_db(request.workspace_id)

    # Xác định repo role + GitNexus repo name.
    # Ưu tiên tên thật từ PR event (strip owner/), rồi mới đến env hardcode.
    changed_repo_role = "backend"
    changed_repo_gitnexus = ""

    if request.repo:
        changed_repo_role = _determine_repo_role(request.repo)
        changed_repo_gitnexus = _extract_repo_short_name(request.repo)
    if not changed_repo_gitnexus:
        changed_repo_gitnexus = gn.get_repo_name(changed_repo_role)

    # Other repo: tìm repo khác trong team config (theo owner/repo) — không hardcode role.
    # Nếu team chỉ có 1 repo → other_repo rỗng, các query liên quan sẽ skip cleanly.
    other_repo_role = _other_role(changed_repo_role)
    other_repo_gitnexus = ""
    for r in team_repos:
        candidate = r.get("repo") or ""
        if candidate and candidate != changed_repo_gitnexus:
            other_repo_gitnexus = candidate
            break
    # Chỉ fallback sang env hardcode khi team config HOÀN TOÀN rỗng (dev mode).
    # Team có config nhưng chỉ 1 repo → tôn trọng, không đoán mò repo thứ 2.
    if not other_repo_gitnexus and not team_repos:
        fallback = gn.get_repo_name(other_repo_role)
        if fallback and fallback != changed_repo_gitnexus:
            other_repo_gitnexus = fallback

    logger.info(
        f"[GapFinding] Start — changed_repo={changed_repo_gitnexus!r}, "
        f"other_repo={other_repo_gitnexus!r}, pr={request.pr_number}"
    )

    # ── Step 1 + 2: Thu thập code context song song ──────────────────
    #
    # Chiến lược:
    #   A. GitHub REST API  → lấy danh sách changed files + patches của PR
    #   B. GitNexus Cypher  → tìm symbols theo tên keyword từ feature_name
    #      (semantic query thường trống vì không có indexed processes;
    #       Cypher tìm trực tiếp trên knowledge graph — ổn định hơn)
    #   C. GitNexus context → đọc sâu từng symbol: callers, callees, source

    query_text = request.feature_name or f"PR {request.pr_number}"

    async def _empty_pr_files() -> tuple[str, list]:
        return "", []

    # Tách từ khóa từ feature_name để dùng cho Cypher CONTAINS search
    def _feature_keywords(text: str) -> list[str]:
        """
        Trả về keywords để tìm symbols liên quan đến feature.

        Ưu tiên:
          1. Compound form: "change_password", "changepassword" (dễ match tên hàm/class)
          2. Từ dài, đặc trưng (>= 5 ký tự, không phải stopword chung)
        Bỏ qua words ngắn, chung chung để tránh false positives.

        Ví dụ: "Change password" → ["change_password", "changepassword", "password"]
        """
        import re
        words = re.findall(r"\w+", text.lower())
        # Stopwords quá chung để tìm symbol
        stopwords = {
            "the", "a", "an", "of", "in", "for", "to", "and", "or", "is",
            "pr", "get", "set", "list", "create", "view", "page", "show",
            "add", "edit", "delete", "update", "fix", "new", "old",
        }
        specific_words = [w for w in words if w not in stopwords and len(w) >= 5]
        keywords: list[str] = []
        # Compound forms (underscore + no-space) — tốt nhất để match function/class names
        if len(words) >= 2:
            clean_words = [w for w in words if w not in stopwords and len(w) >= 3]
            if len(clean_words) >= 2:
                keywords.append("_".join(clean_words))      # "change_password"
                keywords.append("".join(clean_words))       # "changepassword"
        # Thêm từ đặc trưng nhất (dài nhất)
        for w in sorted(specific_words, key=len, reverse=True)[:2]:
            if w not in keywords:
                keywords.append(w)
        # Fallback nếu không có gì
        if not keywords:
            keywords = [text.lower().replace(" ", "")]
        return keywords[:4]

    async def _cypher_find_symbols(keywords: list[str], repo: str) -> list[dict]:
        """
        Tìm symbols trong GitNexus bằng Cypher CONTAINS search theo keyword.

        Ưu tiên:
          1. Symbols (Class/Function/Method) khớp compound keyword (e.g. "change_password")
          2. Symbols khớp specific word keyword
          3. Files (nodeType = File) xuống cuối — ít informative hơn
        """
        if not keywords or not repo:
            return []
        # Compound keywords là phần tử đầu (có underscore hoặc dài > 8)
        compound_kws = [kw for kw in keywords if "_" in kw or len(kw) > 8]
        specific_kws = [kw for kw in keywords if kw not in compound_kws]

        def _conditions(kws: list[str]) -> str:
            return " OR ".join(f'toLower(n.name) CONTAINS "{kw}"' for kw in kws)

        # Compound keywords tìm chính xác hơn (e.g. "change_password" < "change" + "password")
        # Dùng UNION: compound first (precise), fallback all keywords (broader)
        parts = []
        if compound_kws:
            parts.append(
                f"MATCH (n) WHERE ({_conditions(compound_kws)}) "
                f"AND n.name IS NOT NULL AND n.filePath IS NOT NULL "
                f"RETURN n.name, n.filePath LIMIT {MAX_DEEP_SYMBOLS_PER_REPO}"
            )
        all_conditions = _conditions(keywords)
        parts.append(
            f"MATCH (n) WHERE ({all_conditions}) "
            f"AND n.name IS NOT NULL AND n.filePath IS NOT NULL "
            f"RETURN n.name, n.filePath LIMIT {MAX_DEEP_SYMBOLS_PER_REPO * 2}"
        )
        q = " UNION ".join(parts)

        try:
            result = await gn.cypher(q, repo=repo)
            md = result.get("markdown", "")
            names: list[dict] = []
            seen: set[str] = set()
            for line in md.splitlines():
                if line.startswith("|") and "n.name" not in line and "---" not in line:
                    cell_parts = [p.strip() for p in line.strip("|").split("|")]
                    if cell_parts and cell_parts[0] and cell_parts[0] not in seen:
                        seen.add(cell_parts[0])
                        names.append({
                            "name": cell_parts[0],
                            "filePath": cell_parts[1] if len(cell_parts) > 1 else "",
                        })
            # Sort: compound keyword matches first (those names contain underscore + keyword)
            def _rank(sym: dict) -> int:
                name_lower = sym["name"].lower()
                for ck in compound_kws:
                    if ck in name_lower:
                        return 0  # best: matches compound keyword
                for kw in specific_kws:
                    if kw in name_lower:
                        return 1  # good: matches specific keyword
                return 2  # fallback
            names.sort(key=_rank)
            return names
        except Exception as e:
            logger.warning(f"[GapFinding] Cypher symbol search failed ({repo}): {e}")
            return []

    keywords = _feature_keywords(query_text)
    logger.info(f"[GapFinding] Feature keywords: {keywords}")

    # ── Phase A: Fetch PR files + head SHA song song ──────────────────
    # PR files cần xong trước khi extract seed symbols, nên tách 2 phase rõ ràng.
    pr_files_task = asyncio.create_task(
        _get_pr_changed_files_github(
            pr_number=request.pr_number,
            repo=request.repo,
            github_token=github_token,
            github_api_url=GITHUB_API_URL,
        )
        if request.pr_number and request.repo
        else _empty_pr_files()
    )
    pr_head_task = asyncio.create_task(
        _get_pr_head_ref(
            pr_number=request.pr_number,
            repo=request.repo,
            github_token=github_token,
            github_api_url=GITHUB_API_URL,
        )
        if request.pr_number and request.repo
        else asyncio.sleep(0, result=("", ""))
    )

    pr_files_result, pr_head_result = await asyncio.gather(
        pr_files_task, pr_head_task, return_exceptions=True,
    )
    pr_head_sha, pr_head_ref = (
        pr_head_result if isinstance(pr_head_result, tuple) else ("", "")
    )
    if isinstance(pr_files_result, Exception):
        logger.warning(f"[GapFinding] pr_files_github failed: {pr_files_result}")
        pr_diff, changed_files = "", []
    else:
        pr_diff, changed_files = pr_files_result

    # ── Phase B: Fetch FULL file content cho changed files (cải tiến #5) ─
    # Patch hunk chỉ thấy ±3 dòng quanh thay đổi → bỏ sót callee/dependency
    # đã có sẵn trong file. Fetch full body để extract seed symbols đầy đủ
    # và để Claude thấy được code pre-existing.
    full_file_contents: dict[str, str] = {}
    if changed_files and request.repo and github_token:
        ref_for_fetch = pr_head_sha or pr_head_ref or ""
        full_file_tasks = [
            _fetch_full_file_content_github(
                filename=f.get("filename", ""),
                repo=request.repo,
                ref=ref_for_fetch,
                github_token=github_token,
                github_api_url=GITHUB_API_URL,
            )
            for f in changed_files[:15]
            if f.get("filename") and f.get("status") != "removed"
        ]
        full_file_results = await asyncio.gather(*full_file_tasks, return_exceptions=True)
        for f, content in zip(changed_files[:15], full_file_results):
            if isinstance(content, Exception):
                continue
            if content and isinstance(content, str):
                full_file_contents[f.get("filename", "")] = content
        logger.info(
            f"[GapFinding] Full file fetch: {len(full_file_contents)}/{len(changed_files)} files"
        )

    # ── Phase C: Extract seed symbols TỪ DIFF + full files (cải tiến #4) ─
    seed_symbols = _extract_seed_symbols_from_diff(
        changed_files=changed_files,
        full_file_contents=full_file_contents,
    )
    # Fallback: nếu PR không có diff (token thiếu hoặc PR rỗng), dùng keyword
    # extraction từ PR title như cũ.
    search_terms = seed_symbols if seed_symbols else keywords
    logger.info(
        f"[GapFinding] Seed symbols ({len(seed_symbols)} từ diff): "
        f"{seed_symbols[:10]}{'...' if len(seed_symbols) > 10 else ''}"
    )

    # ── Phase D: Cypher search với seed symbols (auto-hop callees, #6) ──
    # Seed symbols đã chứa cả symbol thay đổi LẪN callees pre-existing
    # (do parse full file content), nên không cần explicit 2nd-hop traversal.
    #
    # OTHER repo (typically FE Angular khi changed=BE Django) dùng tokens
    # đã bridged: strip BE suffix + snake→kebab + qna↔qa variants. Nếu không
    # bridge được, fallback search_terms gốc + keywords từ feature_name.
    other_search_terms = (
        _derive_other_repo_search_tokens(seed_symbols, changed_files)
        + keywords
    ) or search_terms
    changed_symbols_task = asyncio.create_task(
        _cypher_find_symbols(search_terms, repo=changed_repo_gitnexus)
    )
    other_symbols_task = asyncio.create_task(
        _cypher_find_symbols(other_search_terms, repo=other_repo_gitnexus)
    )
    changed_symbols_raw, other_symbols_raw = await asyncio.gather(
        changed_symbols_task, other_symbols_task, return_exceptions=True,
    )
    if isinstance(changed_symbols_raw, Exception):
        logger.warning(f"[GapFinding] changed_symbols_cypher failed: {changed_symbols_raw}")
        changed_symbols_raw = []
    if isinstance(other_symbols_raw, Exception):
        logger.warning(f"[GapFinding] other_symbols_cypher failed: {other_symbols_raw}")
        other_symbols_raw = []

    logger.info(
        f"[GapFinding] Cypher found: changed={len(changed_symbols_raw)} symbols, "
        f"other={len(other_symbols_raw)} symbols, "
        f"pr_diff={len(pr_diff)} chars, full_files={len(full_file_contents)}"
    )
    if not changed_symbols_raw and not other_symbols_raw:
        logger.warning(
            f"[GapFinding] Cypher không tìm được symbol nào cho terms={search_terms[:5]} — "
            f"repo '{changed_repo_gitnexus}' có thể chưa được index trong GitNexus, "
            f"hoặc seed symbols không match tên symbol. LLM sẽ chỉ thấy PR diff + full files."
        )
    if not pr_diff:
        logger.warning(
            "[GapFinding] PR diff rỗng — GitHub token có thể chưa cấu hình "
            "hoặc PR không có patch. LLM sẽ chỉ thấy indexed code từ GitNexus."
        )

    # Đọc sâu key symbols từ changed repo qua context API
    changed_symbols_raw = changed_symbols_raw[:MAX_DEEP_SYMBOLS_PER_REPO]
    changed_contexts = await asyncio.gather(
        *[
            gn.context(sym.get("name", ""), repo=changed_repo_gitnexus, include_content=True)
            for sym in changed_symbols_raw
            if sym.get("name")
        ],
        return_exceptions=True,
    )
    # FE context body (TS interface/component) trung bình ~800 chars — ngắn hơn
    # BE Python nhiều, nên fetch full danh sách (Cypher đã LIMIT *2 ở trên) vẫn
    # fit budget 60000 chars dưới đây. Cap top-N cho FE từng đẩy component thật
    # ra khỏi context khi BE-derived token (e.g. "courseclass") match noise TS
    # data models trước.
    other_contexts = await asyncio.gather(
        *[
            gn.context(sym.get("name", ""), repo=other_repo_gitnexus, include_content=True)
            for sym in other_symbols_raw
            if sym.get("name")
        ],
        return_exceptions=True,
    )

    # ── Step 3: Query LightRAG cho SRS UC spec ───────────────────────
    uc_id = request.uc_id or ""
    uc_name = request.feature_name or f"PR {request.pr_number}"

    srs_raw, srs_chunks = await _query_lightrag_srs(
        uc_id=uc_id,
        uc_name=uc_name,
        workspace_id=request.workspace_id,
        credentials_json=credentials_json,
        user_id=user_id,
    )

    if not srs_raw:
        return GapFindingResult(
            success=True,
            drift_report={
                "uc_id": uc_id,
                "uc_name": uc_name,
                "repo_type": changed_repo_role,
                "error_summary": "⚠️ Không tìm thấy UC trong LightRAG.",
                "gap_rows": [],
                "business_rules": [],
                "surplus_items": [],
            },
        )

    # ── Step 4: Normalize cả 2 về EAS format ────────────────────────
    # Tóm tắt danh sách files thay đổi (filename + status + patch excerpt)
    changed_files_summary = [
        {
            "filename": f.get("filename", ""),
            "status": f.get("status", "modified"),
            "additions": f.get("additions", 0),
            "deletions": f.get("deletions", 0),
            "patch_excerpt": (f.get("patch") or "")[:250],
        }
        for f in changed_files[:15]
    ]

    # Context text từ GitNexus (plain text output từ eval-server, rất informative)
    def _extract_raw(ctx: dict | Exception) -> str:
        if isinstance(ctx, Exception):
            return str(ctx)
        return ctx.get("raw", json.dumps(ctx, ensure_ascii=False))

    # Cap mỗi context theo MAX_CONTEXT_CHARS_PER_SYMBOL (đã bumped 3000→6000)
    # để full body của method dài (DAO query + parse logic) được giữ nguyên.
    changed_contexts_text = [_extract_raw(c)[:MAX_CONTEXT_CHARS_PER_SYMBOL] for c in changed_contexts]
    other_contexts_text = [_extract_raw(c)[:MAX_CONTEXT_CHARS_PER_SYMBOL] for c in other_contexts]

    # Full file contents — pre-existing code mà patch hunk không thấy
    full_files_block = [
        {"filename": fn, "content": content}
        for fn, content in full_file_contents.items()
    ]

    # LƯU Ý: Thứ tự field quan trọng — GitNexus contexts + full files chứa
    # source code thật, là bằng chứng quan trọng nhất để xác định drift.
    # Đặt lên đầu để không bị truncate khi prompt vượt budget. (Bug cũ:
    # pr_diff + changed_files ăn hết 10k chars → LLM không thấy code thật.)
    code_context_summary = json.dumps(
        {
            "changed_symbols_found": [s.get("name") for s in changed_symbols_raw],
            "changed_repo_contexts": changed_contexts_text,
            "changed_files_full_content": full_files_block,
            "other_repo_symbols_found": [s.get("name") for s in other_symbols_raw],
            "other_repo_contexts": other_contexts_text,
            "pr_diff_excerpt": pr_diff[:2500] if pr_diff else "",
            "changed_files": changed_files_summary,
        },
        ensure_ascii=False,
        indent=2,
    )[:60000]

    # Build SRS-REF block + chunk_lookup table.
    # - Block hiển thị cho LLM chỉ filename (LLM không cần biết docId).
    # - chunk_lookup giữ docId/filename/quote_prefix để Python resolve sau khi LLM trả JSON.
    srs_ref_lines: list[str] = []
    chunk_lookup: dict[str, dict] = {}  # reference_id -> {doc_id, filename, content}
    for ch in (srs_chunks or [])[:20]:
        ref_id = str(ch.get("reference_id") or ch.get("id") or "").strip()
        fp = str(ch.get("file_path") or "").strip()
        if not (ref_id and fp):
            continue
        # Tách "{docId}<#>{filename}". Nếu chunk thiếu "<#>" coi cả chuỗi là filename, doc_id rỗng.
        if "<#>" in fp:
            doc_id, filename = fp.split("<#>", 1)
        else:
            doc_id, filename = "", fp
            logger.warning(
                f"[GapFinding] SRS chunk ref_id={ref_id!r} file_path={fp!r} thiếu '<#>' "
                f"separator — sẽ không có document_id"
            )
        chunk_lookup[ref_id] = {
            "doc_id":   doc_id,
            "filename": filename,
            "content":  str(ch.get("content") or ""),
        }
        srs_ref_lines.append(f"[SRS-REF-{ref_id}] file_path={filename}")
    srs_refs_block = "\n".join(srs_ref_lines) if srs_ref_lines else "(no chunk refs available)"

    normalize_prompt = f"""
From the information below, produce two separate EAS tables following the exact format in the system prompt.

Requirements:
- EAS from SRS: derived entirely from the SRS UC SPEC section below
- EAS from Code: derived entirely from the CODE CONTEXT section below (both FE and BE, interleaved in execution order)
- Each table must include: UC-ID, UC Name, Context, and a rows table with columns #/Layer/Actor/Event/Action/State/Guard
- Do not omit exception handling rows or Business Rules
- All descriptive text (UC Name, Context, Action/Guard descriptions) must be in Vietnamese

=== SRS UC SPEC ===
UC-ID: {uc_id}
UC Name: {uc_name}
{srs_raw}

=== SRS CHUNK REFERENCES (use these EXACT file_path values for srs_references.file_path) ===
{srs_refs_block}

=== CODE CONTEXT ===
Changed repo: {changed_repo_gitnexus} ({changed_repo_role})
Other repo:   {other_repo_gitnexus} ({other_repo_role})
{code_context_summary}
""".strip()

    eas_tables = await _call_llm(
        prompt=normalize_prompt,
        system_prompt=_EAS_NORMALIZE_SYSTEM,
        credentials_json=credentials_json,
        user_id=user_id,
    )

    # ── Step 5 + 6: So sánh và output Drift Report JSON ─────────────
    compare_prompt = f"""
Below are two EAS tables (EAS from SRS and EAS from Code).
Apply the 4 Mapping Rules from the system prompt to map Code rows to SRS rows, then assign a Drift Label to each row.
Output the JSON Drift Report following the schema below exactly. No text of any kind outside the JSON block.
Remember: all free-text fields (uc_name, error_summary, drift_detail, rule details, surplus reason) must be in Vietnamese.

{eas_tables}

=== OUTPUT JSON SCHEMA ===
{_GAP_FINDING_OUTPUT_SCHEMA}
""".strip()

    drift_json_raw = await _call_llm(
        prompt=compare_prompt,
        system_prompt=_EAS_COMPARE_SYSTEM,
        credentials_json=credentials_json,
        user_id=user_id,
    )

    # Parse JSON từ response
    # LLM đôi khi trả JSON hơi malformed (trailing comma, unescaped quote,
    # chuỗi cắt dở khi gần max_tokens). Fallback sang json_repair nếu json.loads fail.
    clean = drift_json_raw.strip()
    if clean.startswith("```"):
        clean = clean.split("```", 2)[1]
        if clean.startswith("json"):
            clean = clean[4:]
        clean = clean.rsplit("```", 1)[0]
    clean = clean.strip()

    drift_report = None
    try:
        drift_report = json.loads(clean)
    except json.JSONDecodeError as e:
        logger.warning(
            f"[GapFinding] json.loads fail ({e}) — thử json_repair fallback. "
            f"Response length={len(clean)}"
        )
        try:
            import json_repair
            drift_report = json_repair.loads(clean)
            if not isinstance(drift_report, dict) or not drift_report:
                raise ValueError("json_repair trả về kết quả rỗng/sai type")
            logger.info("[GapFinding] json_repair phục hồi JSON thành công")
        except Exception as e2:
            logger.error(
                f"[GapFinding] Cả json.loads lẫn json_repair đều fail: "
                f"json_err={e}, repair_err={e2}\nRaw (first 500): {drift_json_raw[:500]}"
            )
            return GapFindingResult(
                success=False,
                error=f"LLM trả về response không phải JSON hợp lệ: {e}",
            )

    # ── Normalize drift_report: enforce schema invariants LLM hay vi phạm ──
    # (move surplus rows từ gap_rows sang surplus_items + sort theo step).
    try:
        _normalize_drift_report(drift_report)
    except Exception as e:
        logger.warning(f"[GapFinding] Normalize drift_report fail (non-fatal): {e}")

    # ── Enrich code_references với repo + URL GitHub ──────────────────
    # Other repo (frontend vs backend): giả định cùng owner với changed_repo.
    other_repo_full = ""
    if request.repo and "/" in request.repo:
        owner = request.repo.split("/", 1)[0]
        other_repo_full = f"{owner}/{other_repo_gitnexus}"
    try:
        _enrich_code_references(
            drift_report=drift_report,
            changed_files=changed_files,
            changed_repo_full=request.repo or "",
            changed_ref=pr_head_sha or pr_head_ref or "HEAD",
            other_repo_full=other_repo_full,
            other_ref="HEAD",
        )
    except Exception as e:
        logger.warning(f"[GapFinding] Enrich code_references fail (non-fatal): {e}")

    # ── Resolve document_id cho srs_references từ chunks gốc ───────────
    try:
        _resolve_srs_doc_ids(drift_report=drift_report, chunk_lookup=chunk_lookup)
    except Exception as e:
        logger.warning(f"[GapFinding] Resolve srs document_ids fail (non-fatal): {e}")

    # ── Single-repo team → treat as fullstack ─────────────────────────
    # Khi team chỉ có 1 repo (không có other_repo), repo đó thường là monolith
    # chứa cả FE+BE (Java JSP, Django + templates, Rails, Next.js, ...).
    # Override repo_type → "fullstack" cho MỌI giá trị LLM trả về (kể cả
    # "unknown", "", "java", "monolith", literal placeholder "backend | frontend"...)
    # để title hiển thị [FS] và gap items được phân loại theo file_path (FE vs BE)
    # thay vì rơi vào nhánh [??]/[BE]/[FE] sai.
    if not other_repo_gitnexus:
        original = drift_report.get("repo_type")
        if original != "fullstack":
            drift_report["repo_type"] = "fullstack"
            logger.info(
                f"[GapFinding] Single-repo team detected ({changed_repo_gitnexus!r}) — "
                f"override repo_type {original!r} → 'fullstack'"
            )

    logger.info(
        f"[GapFinding] Done — uc_id={drift_report.get('uc_id')}, "
        f"gap_rows={len(drift_report.get('gap_rows', []))}, "
        f"repo_type={drift_report.get('repo_type')!r}"
    )
    return GapFindingResult(success=True, drift_report=drift_report)

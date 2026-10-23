"""
Phase 3 — SRS Query Worker

Nhận pr_context.json từ Phase 1-2, query LightRAG qua 3-turn conversation
để lấy SRS requirements liên quan đến Pull Request.

Flow:
    Step 3.1  Build query strings từ PR data (không dùng code diff)
    Step 3.2  Turn 1 — Broad UC discovery: PR liên quan UC nào trong SRS?
    Step 3.3  Turn 2 — Full UC content: lấy TOÀN BỘ nội dung các UC đã xác định
    Step 3.4  Turn 3 — Narrow scope: khoanh vùng requirement nào bị ảnh hưởng bởi PR change
    Step 3.5  Save srs_context.json

Output srs_context.json được dùng bởi:
    - Nhánh A (generate_tests_worker.py): lấy srs_content để sinh E2E test
    - Nhánh B (surplus_worker.py): reuse conversation_id để hỏi tiếp về surplus
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

from pr_webhook_module.workers import llm_cost_tracker as _tracker

GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models"


# =============================================================================
# Config
# =============================================================================

class SRSQueryConfig:
    def __init__(self):
        self.lightrag_url = os.getenv("LIGHTRAG_API_URL", "http://localhost:8000")
        self.request_timeout = float(os.getenv("LIGHTRAG_TIMEOUT", "120"))
        self.output_dir = os.getenv("PR_LOG_OUTPUT_DIR", "./pr_logs")
        # LLM config for UC-relevance file filter
        self.llm_api_key = os.getenv("LLM_BINDING_API_KEY", "") or os.getenv("GEMINI_API_KEY", "")
        self.llm_model   = os.getenv("LLM_MODEL", "gemini-2.0-flash")
        self.llm_host    = os.getenv("LLM_BINDING_HOST", "")
        self.llm_binding = os.getenv("LLM_BINDING", "gemini")  # "gemini" or "claude"

    @property
    def conversations_url(self) -> str:
        return f"{self.lightrag_url}/api/conversations"

    def messages_url(self, conversation_id: str) -> str:
        return f"{self.lightrag_url}/api/conversations/{conversation_id}/messages"

    def delete_conversation_url(self, conversation_id: str) -> str:
        return f"{self.lightrag_url}/api/conversations/{conversation_id}"


# =============================================================================
# Data structures
# =============================================================================

@dataclass
class SRSContext:
    """
    Output của Phase 3 — SRS requirements liên quan đến PR.
    Được dùng bởi cả Nhánh A (test gen) và Nhánh B (surplus detection).
    """

    pr_id: int
    repo: str

    # LightRAG conversation — reuse ở surplus detection (Nhánh B)
    conversation_id: str

    # Queries đã gửi (để trace/debug)
    broad_query: str       # Turn 1: tìm UC liên quan
    full_uc_query: str     # Turn 2: lấy toàn bộ nội dung UC
    narrow_query: str      # Turn 3: khoanh vùng requirement bị ảnh hưởng bởi PR

    # Raw responses từ LightRAG
    broad_response: str    # Turn 1 response
    full_uc_response: str  # Turn 2 response
    narrow_response: str   # Turn 3 response

    # Nội dung SRS đã tổng hợp — INPUT cho Nhánh A (test generation)
    # Chỉ chứa requirements, KHÔNG chứa code change
    srs_content: str

    # Metadata
    queried_at: str = ""
    related_uc_hints: list[str] = field(default_factory=list)   # UC IDs/names xuất hiện
    uc_relevant_files: list[str] = field(default_factory=list)  # Filenames sau LLM filter


# =============================================================================
# Step 3.1 — Build query strings từ PR data
# =============================================================================

def _summarize_changed_files(changed_files: list[dict]) -> str:
    """
    Tóm tắt file changes thành mô tả ngắn gọn cho query.
    Chỉ dùng filename và status — không dùng patch content.

    Áp dụng file_filter để loại bỏ lock files, generated files, binary assets, v.v.
    trước khi tóm tắt, tránh gây nhiễu cho LightRAG query.
    """
    if not changed_files:
        return ""

    from pr_webhook_module.workers.file_filter import filter_relevant_files, get_filter_summary

    relevant = filter_relevant_files(changed_files)
    logger.info("[Phase 3] %s", get_filter_summary(changed_files, relevant))

    if not relevant:
        return "(tất cả file thay đổi đã bị lọc là không liên quan đến logic nghiệp vụ)"

    # Nhóm theo thư mục cấp 1-2 để tóm tắt module
    modules: set[str] = set()
    file_list: list[str] = []

    for f in relevant[:20]:  # giới hạn 20 file để tránh query quá dài
        filename = f.get("filename", "")
        status = f.get("status", "")
        file_list.append(f"{filename} ({status})")

        parts = filename.replace("\\", "/").split("/")
        if len(parts) >= 2:
            modules.add(parts[0])
        elif len(parts) == 1:
            modules.add(parts[0].split(".")[0])

    files_str = ", ".join(file_list)
    modules_str = ", ".join(sorted(modules))
    return f"Modules/components bị ảnh hưởng: {modules_str}\nFiles thay đổi: {files_str}"


def build_broad_query(pr_context: dict) -> str:
    """
    Turn 1 Query — Broad UC Discovery.

    Mục đích: Tìm tất cả Use Cases trong SRS có liên quan đến PR này.
    Input: title + description + file summary (KHÔNG có code diff).
    """
    title = pr_context.get("title", "")
    description = pr_context.get("description", "").strip()
    changed_files = pr_context.get("changed_files", [])
    repo_type = pr_context.get("repo_type", "unknown")

    file_summary = _summarize_changed_files(changed_files)

    query = f"""Tôi có một Pull Request từ repo {repo_type} với thông tin sau:

**Tiêu đề PR:** {title}

**Mô tả PR:**
{description or "(Không có mô tả)"}

**{file_summary}**

Dựa vào thông tin trên, hãy:
1. Xác định các Use Case (UC) trong tài liệu SRS có liên quan đến Pull Request này
2. Liệt kê tên UC, mã UC (nếu có), và mô tả ngắn gọn mỗi UC
3. Giải thích lý do tại sao mỗi UC liên quan đến PR này

Trả lời theo format:
- UC ID (nếu có): Tên UC — Lý do liên quan"""

    return query


def _normalize_uc_variants(broad_response: str, pr_title: str) -> list[str]:
    """
    Extract UC numbers từ Turn 1 response + PR title, sinh ALL naming variants.

    Vấn đề: SRS hay dùng nhiều cách viết cho cùng một UC:
        "UC 47", "UC-47", "UC-TM-47", "UC-TM-047", "Use Case 47"
    → Turn 2 query cần list tất cả để LightRAG tìm đúng dù tên khác nhau.
    """
    import re

    combined = f"{broad_response} {pr_title}"
    numbers: set[str] = set()
    for m in re.finditer(r'\bUC[-_\s](?:[A-Z]+[-_\s])?(\d{2,3})\b', combined, re.IGNORECASE):
        numbers.add(m.group(1))
    for m in re.finditer(r'Use Case\s+(\d{2,3})\b', combined, re.IGNORECASE):
        numbers.add(m.group(1))

    if not numbers:
        return []

    variants: list[str] = []
    for num in sorted(numbers):
        n = int(num)
        short = str(n)
        padded = f"{n:03d}"
        variants += [
            f"UC {short}", f"UC-{short}",
            f"UC {padded}", f"UC-{padded}",
            f"UC-TM-{short}", f"UC-TM-{padded}",
            f"UC TM {short}", f"UC TM {padded}",
        ]
    return variants


def build_full_uc_query(uc_variants: list[str] | None = None) -> str:
    """
    Turn 2 Query — Full UC Content.

    Mục đích: Lấy TOÀN BỘ nội dung của các UC đã xác định ở Turn 1,
    không lọc theo PR change. Đây là SRS ground truth đầy đủ.

    Args:
        uc_variants: Tất cả naming variants của UC IDs.
                     Nếu có, thêm vào query để LightRAG tìm đúng dù tên khác.
    """
    variants_note = ""
    if uc_variants:
        variants_str = ", ".join(f'"{v}"' for v in uc_variants[:12])
        variants_note = (
            f"\n\nLưu ý: Các tên sau đây đều chỉ CÙNG MỘT use case "
            f"(chỉ khác cách viết): {variants_str}. "
            f"Hãy tìm và trả về nội dung cho TẤT CẢ các tên đó."
        )

    return f"""Với các Use Cases vừa xác định ở trên, hãy trả về TOÀN BỘ nội dung của từng UC trong tài liệu SRS, bao gồm:{variants_note}

1. **Mô tả UC** — Mục tiêu và phạm vi của use case
2. **Actors** — Tác nhân tham gia
3. **Pre-conditions** — Điều kiện tiên quyết
4. **Post-conditions** — Trạng thái sau khi hoàn thành
5. **Main Flow** — Luồng chính từng bước
6. **Alternative Flows** — Luồng thay thế (nếu có)
7. **Exception Flows** — Luồng ngoại lệ và xử lý lỗi
8. **Business Rules** — Tất cả quy tắc nghiệp vụ áp dụng
9. **Acceptance Criteria** — Tiêu chí chấp nhận đầy đủ

Hãy trả lời đầy đủ, không bỏ sót thông tin nào trong SRS. Đây là bước lấy dữ liệu gốc, chưa lọc."""


def build_narrow_query(pr_context: dict, filtered_files: list[dict] | None = None) -> str:
    """
    Turn 3 Query — Narrow Scope.

    Mục đích: Từ toàn bộ nội dung UC đã lấy ở Turn 2, xác định
    những requirement CỤ THỂ nào bị ảnh hưởng bởi PR change này.
    Đây là bước duy nhất đưa thông tin PR vào để khoanh vùng.

    Args:
        filtered_files: Nếu có, dùng danh sách này thay vì toàn bộ changed_files.
                        Nên là output của _filter_files_by_uc_relevance().
    """
    title = pr_context.get("title", "")
    description = pr_context.get("description", "").strip()
    files_to_use = filtered_files if filtered_files is not None else pr_context.get("changed_files", [])
    file_summary = _summarize_changed_files(files_to_use)

    query = f"""Dựa vào toàn bộ nội dung UC vừa cung cấp ở trên, hãy xác định những requirement CỤ THỂ nào bị ảnh hưởng bởi Pull Request sau:

**Tiêu đề PR:** {title}

**Mô tả thay đổi:**
{description or "(Không có mô tả)"}

**{file_summary}**

Với mỗi requirement bị ảnh hưởng, hãy chỉ rõ:
1. **UC ID + tên requirement** — Requirement nào trong UC nào
2. **Lý do bị ảnh hưởng** — PR change này tác động đến requirement này như thế nào
3. **Acceptance Criteria liên quan** — Tiêu chí cần kiểm tra
4. **Expected Behavior** — Hành vi kỳ vọng (bao gồm cả trường hợp lỗi)

Chỉ liệt kê những requirement thực sự bị ảnh hưởng bởi thay đổi này, không liệt kê toàn bộ UC."""

    return query


# =============================================================================
# Step 3.2 & 3.3 — LightRAG API calls
# =============================================================================

async def create_conversation(
    client: httpx.AsyncClient,
    config: SRSQueryConfig,
    title: str,
) -> str:
    """Tạo conversation mới trên LightRAG. Trả về conversation_id."""
    response = await client.post(
        config.conversations_url,
        json={"title": title},
        timeout=config.request_timeout,
    )
    response.raise_for_status()
    data = response.json()
    conversation_id = data["id"]
    logger.info(f"Created LightRAG conversation: {conversation_id} — {title!r}")
    return conversation_id


async def send_message(
    client: httpx.AsyncClient,
    config: SRSQueryConfig,
    conversation_id: str,
    query: str,
) -> str:
    """
    Gửi message vào conversation và trả về nội dung response của AI.
    LightRAG tự động đưa conversation history vào context (last 10 messages).
    """
    response = await client.post(
        config.messages_url(conversation_id),
        json={"content": query},
        timeout=config.request_timeout,
    )
    response.raise_for_status()
    data = response.json()

    # Lấy nội dung AI response
    ai_content: str = data.get("ai_message", {}).get("content", "")
    logger.info(
        f"LightRAG response received. "
        f"Conversation: {conversation_id}, length: {len(ai_content)} chars"
    )

    # Estimate visible token usage (query + response only — KG context injected by
    # LightRAG internally is NOT counted here, so actual input tokens are higher)
    _tracker.record_usage(
        stage="P3",
        model=os.getenv("LIGHTRAG_LLM_MODEL", os.getenv("LLM_MODEL", "gemini-2.5-flash")),
        response_data={},   # LightRAG does not expose usageMetadata
        binding="gemini",
        input_chars=len(query),
        output_chars=len(ai_content),
    )

    return ai_content


# =============================================================================
# Step 3.4 — Parse & structure output
# =============================================================================

def _extract_uc_hints(text: str) -> list[str]:
    """
    Trích xuất sơ bộ UC IDs/names từ response text để dùng làm metadata.
    Tìm pattern: UC01, UC-01, UC_LOGIN, Use Case 1, v.v.
    Không parse cứng — chỉ để gợi ý, actual content ở srs_content.
    """
    import re
    patterns = [
        r"\bUC[-_]?\d{2,3}\b",          # UC01, UC-01, UC_01
        r"\bUC[-_][A-Z_]+\b",            # UC_LOGIN, UC-AUTH
        r"Use Case\s+\d+",               # Use Case 1
    ]
    hints: set[str] = set()
    for pattern in patterns:
        matches = re.findall(pattern, text, re.IGNORECASE)
        hints.update(m.upper() for m in matches)
    return sorted(hints)


def build_srs_content(broad_response: str, full_uc_response: str, narrow_response: str) -> str:
    """
    Tổng hợp nội dung SRS từ 3 turn response.
    Turn 1: danh sách UC liên quan.
    Turn 2: toàn bộ nội dung SRS của các UC đó (ground truth).
    Turn 3: requirement cụ thể bị ảnh hưởng bởi PR (đã khoanh vùng).
    Nhánh A (test gen) chỉ nhìn thấy output này — không có code change.
    """
    return (
        "=== USE CASES LIÊN QUAN (Turn 1) ===\n\n"
        + broad_response.strip()
        + "\n\n"
        + "=== TOÀN BỘ NỘI DUNG UC TRONG SRS (Turn 2) ===\n\n"
        + full_uc_response.strip()
        + "\n\n"
        + "=== REQUIREMENTS BỊ ẢNH HƯỞNG BỞI PR (Turn 3) ===\n\n"
        + narrow_response.strip()
    )


# =============================================================================
# UC-relevance file filter (LLM-based)
# =============================================================================

async def _filter_files_by_uc_relevance(
    broad_response: str,
    changed_files: list[dict],
    config: SRSQueryConfig,
) -> list[dict]:
    """
    Dùng LLM để lọc files thực sự liên quan đến UC đã xác định ở Turn 1.

    Gọi sau Turn 1, trước Turn 2. Output được dùng trong Turn 3 (narrow query)
    để file_summary chỉ chứa files implement business logic của UC — không nhiễu
    bởi styling, shared UI, hay config changes.

    Fallback: nếu LLM call thất bại hoặc trả về rỗng, dùng toàn bộ changed_files.
    """
    if not changed_files or not config.llm_api_key:
        logger.warning("[Phase 3][FileFilter] No API key or no files — skipping LLM filter")
        return changed_files

    file_lines = [
        f"- {f.get('filename', '')} ({f.get('status', '')}, +{f.get('additions', 0)}/-{f.get('deletions', 0)})"
        for f in changed_files
    ]
    file_list_str = "\n".join(file_lines)

    prompt = (
        f"Bạn là BA đang phân tích GAP giữa code và SRS.\n\n"
        f"Các Use Cases liên quan đến PR này (kết quả phân tích SRS):\n"
        f"{broad_response.strip()}\n\n"
        f"Danh sách {len(changed_files)} files thay đổi trong PR:\n"
        f"{file_list_str}\n\n"
        f"Nhiệm vụ: Chọn ra những files THỰC SỰ implement hoặc ảnh hưởng đến "
        f"business logic của các UC trên.\n\n"
        f"Loại bỏ những files sau (không liên quan đến UC behavior):\n"
        f"- Thay đổi màu sắc, CSS class, styling thuần túy\n"
        f"- Generic shared UI components (status badge, tabs, logo, pagination...)\n"
        f"- Angular/framework config (angular.json, tsconfig, ...)\n"
        f"- Pipes/utilities thuần UI (color pipe, formatting pipe, ...)\n"
        f"- Layout/shell components không chứa business logic của UC\n\n"
        f"Trả về ĐÚNG danh sách filename liên quan, mỗi file một dòng, "
        f"không có prefix, không giải thích thêm."
    )

    try:
        async with httpx.AsyncClient(timeout=config.request_timeout) as client:
            if config.llm_host:
                resp = await client.post(
                    f"{config.llm_host.rstrip('/')}/chat/completions",
                    json={
                        "model": config.llm_model,
                        "messages": [{"role": "user", "content": prompt}],
                    },
                    headers={"Authorization": f"Bearer {config.llm_api_key}"},
                )
                resp.raise_for_status()
                data = resp.json()
                if config.llm_binding == "claude":
                    text = data["choices"][0]["message"]["content"].strip()
                else:
                    # Gemini proxy: OpenAI-style request but returns Gemini native format
                    text = (
                        data.get("candidates", [{}])[0]
                        .get("content", {})
                        .get("parts", [{}])[0]
                        .get("text", "")
                        .strip()
                    )
            else:
                resp = await client.post(
                    f"{GEMINI_API_BASE}/{config.llm_model}:generateContent?key={config.llm_api_key}",
                    json={"contents": [{"parts": [{"text": prompt}]}]},
                )
                resp.raise_for_status()
                data = resp.json()
                text = (
                    data.get("candidates", [{}])[0]
                    .get("content", {})
                    .get("parts", [{}])[0]
                    .get("text", "")
                    .strip()
                )

        relevant_names: set[str] = {
            line.strip().lstrip("- ").strip()
            for line in text.splitlines()
            if line.strip()
        }

        if not relevant_names:
            logger.warning("[Phase 3][FileFilter] LLM returned empty list — using all files")
            return changed_files

        filtered = [f for f in changed_files if f.get("filename", "") in relevant_names]

        if not filtered:
            logger.warning("[Phase 3][FileFilter] No filename matched LLM output — using all files")
            return changed_files

        n_removed = len(changed_files) - len(filtered)
        logger.info(
            f"[Phase 3][FileFilter] {len(filtered)}/{len(changed_files)} files kept "
            f"({n_removed} removed as non-relevant to UC)"
        )
        return filtered

    except Exception as exc:
        logger.warning(f"[Phase 3][FileFilter] LLM call failed: {exc} — using all files")
        return changed_files


# =============================================================================
# Main async function
# =============================================================================

async def query_srs_for_pr(pr_context: dict, config: SRSQueryConfig) -> SRSContext:
    """
    Chạy toàn bộ Phase 3: tạo conversation, query 3 turns, build SRSContext.
    """
    pr_id: int = pr_context.get("pr_id", 0)
    repo: str = pr_context.get("repo", "")

    logger.info(f"[Phase 3] Querying SRS for PR #{pr_id} from {repo}")

    async with httpx.AsyncClient() as client:

        # ── Step 3.2: Tạo conversation ─────────────────────────────────────
        conversation_title = f"Gap Analysis — PR #{pr_id} — {repo}"
        conversation_id = await create_conversation(client, config, conversation_title)

        # ── Step 3.3a: Turn 1 — Broad UC Discovery ────────────────────────
        broad_query = build_broad_query(pr_context)
        logger.info(f"[Phase 3] Turn 1 — Broad UC query ({len(broad_query)} chars)")
        broad_response = await send_message(client, config, conversation_id, broad_query)

        # ── Step 3.3b: LLM-based UC-relevance file filter ─────────────────
        # Dùng broad_response (danh sách UC vừa tìm) để lọc files thực sự
        # implement business logic UC đó — loại bỏ styling, shared UI, config.
        uc_relevant_files = await _filter_files_by_uc_relevance(
            broad_response=broad_response,
            changed_files=pr_context.get("changed_files", []),
            config=config,
        )

        # ── Normalize UC naming variants ───────────────────────────────────
        # SRS hay dùng nhiều cách viết cho cùng UC ("UC 47", "UC-TM-047"...).
        # Build all variants từ Turn 1 response + PR title để Turn 2 tìm đúng.
        pr_title = pr_context.get("title", "")
        uc_variants = _normalize_uc_variants(broad_response, pr_title)
        if uc_variants:
            logger.info(f"[Phase 3] UC variants: {uc_variants[:6]}{'...' if len(uc_variants) > 6 else ''}")

        # ── Step 3.3c: Turn 2 — Full UC Content ───────────────────────────
        # Lấy TOÀN BỘ nội dung SRS của các UC đã xác định ở Turn 1.
        # LightRAG giữ conversation history nên có thể refer "các UC vừa xác định".
        full_uc_query = build_full_uc_query(uc_variants=uc_variants or None)
        logger.info(f"[Phase 3] Turn 2 — Full UC content query ({len(full_uc_query)} chars)")
        full_uc_response = await send_message(client, config, conversation_id, full_uc_query)

        # ── Step 3.3d: Turn 3 — Narrow Scope ──────────────────────────────
        # Từ toàn bộ UC content ở Turn 2, khoanh vùng requirement bị ảnh hưởng bởi PR.
        # Dùng uc_relevant_files (đã lọc) để file_summary không bị nhiễu.
        narrow_query = build_narrow_query(pr_context, filtered_files=uc_relevant_files)
        logger.info(f"[Phase 3] Turn 3 — Narrow scope query ({len(narrow_query)} chars)")
        narrow_response = await send_message(client, config, conversation_id, narrow_query)

        # Guard: LightRAG đôi khi trả về Turn 3 gần rỗng (<500 chars) do flakiness.
        # Nếu vậy, bỏ qua Turn 3 để tránh làm nhiễu SRS content và giảm input cho A.1.
        _TURN3_MIN_CHARS = 500
        if len(narrow_response.strip()) < _TURN3_MIN_CHARS:
            logger.warning(
                f"[Phase 3] Turn 3 response too short ({len(narrow_response)} chars) "
                f"— discarding, using Turn 2 content only."
            )
            narrow_response = ""

    # ── Step 3.5: Build output ─────────────────────────────────────────────
    srs_content = build_srs_content(broad_response, full_uc_response, narrow_response)
    uc_hints = _extract_uc_hints(broad_response + " " + full_uc_response)

    context = SRSContext(
        pr_id=pr_id,
        repo=repo,
        conversation_id=conversation_id,   # Nhánh B sẽ reuse để hỏi surplus
        broad_query=broad_query,
        full_uc_query=full_uc_query,
        narrow_query=narrow_query,
        broad_response=broad_response,
        full_uc_response=full_uc_response,
        narrow_response=narrow_response,
        srs_content=srs_content,           # Nhánh A đọc file này để gen test
        queried_at=datetime.now(timezone.utc).isoformat(),
        related_uc_hints=uc_hints,
        uc_relevant_files=[f.get("filename", "") for f in uc_relevant_files],
    )

    logger.info(
        f"[Phase 3] Done. "
        f"UC hints found: {uc_hints or '(none detected)'}. "
        f"SRS content: {len(srs_content)} chars"
    )
    return context


# =============================================================================
# I/O helpers
# =============================================================================

def load_pr_context(json_path: str) -> dict:
    with open(json_path, encoding="utf-8") as f:
        return json.load(f)


def save_srs_context(srs_context: SRSContext, output_dir: str) -> str:
    safe_repo = srs_context.repo.replace("/", "_").replace(" ", "-")
    filename = f"pr_{srs_context.pr_id}_{safe_repo}_srs_context.json"
    Path(output_dir).mkdir(parents=True, exist_ok=True)
    filepath = os.path.join(output_dir, filename)

    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(asdict(srs_context), f, ensure_ascii=False, indent=2)

    logger.info(f"[Phase 3] SRS context saved → {filepath}")
    return filepath


# =============================================================================
# Celery task (chained sau process_pull_request)
# =============================================================================

from celery import shared_task


@shared_task(
    bind=True,
    name="pr_webhook_module.workers.srs_query_worker.query_srs",
    max_retries=2,
    default_retry_delay=30,
)
def query_srs(self, pr_worker_result: dict[str, Any]) -> dict[str, Any]:
    """
    Celery task Phase 3: query LightRAG để lấy SRS liên quan đến PR.

    Args:
        pr_worker_result: return value của process_pull_request task
                          phải có field "context_json" (path đến pr_context.json)

    Returns:
        dict với pr_id, repo, conversation_id, srs_context_path
    """
    import asyncio

    context_json_path: str = pr_worker_result.get("context_json", "")
    if not context_json_path:
        raise ValueError("pr_worker_result thiếu field 'context_json'")

    logger.info(f"[Phase 3] Starting SRS query. Task ID: {self.request.id}")
    logger.info(f"[Phase 3] Reading PR context from: {context_json_path}")

    cfg = SRSQueryConfig()

    try:
        pr_context = load_pr_context(context_json_path)
        srs_context = asyncio.run(query_srs_for_pr(pr_context, cfg))
        srs_context_path = save_srs_context(srs_context, cfg.output_dir)

        result = {
            # Pass-through từ Phase 1-2 để các bước sau dùng
            **pr_worker_result,
            # Phase 3 outputs
            "conversation_id": srs_context.conversation_id,
            "srs_context_path": srs_context_path,
            "related_uc_hints": srs_context.related_uc_hints,
        }

        return result

    except Exception as e:
        logger.error(f"[Phase 3] Task failed: {e}")
        raise self.retry(exc=e)

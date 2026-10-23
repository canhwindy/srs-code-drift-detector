import re

import logging
from typing import Any

from models.conversation import Conversation
from models.message import Message


logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────────────────────
# CONSTANTS
# ─────────────────────────────────────────────────────────────

# Pattern để extract inline citation với quote: [n]<#>quote<#>
# re.DOTALL cho phép quote span nhiều dòng
_INLINE_CITATION_PATTERN: re.Pattern[str] = re.compile(r'\[(\d+)\]<#>(.*?)<#>', re.DOTALL)

# Pattern fallback: plain [n] không có <#>quote<#>
_PLAIN_CITATION_PATTERN: re.Pattern[str] = re.compile(r'\[(\d+)\]')

# Pattern để strip References section nếu LLM vẫn sinh ra (dùng để clean display text)
_REFERENCES_SECTION_PATTERN: re.Pattern[str] = re.compile(
    r'\n+#{1,4}\s*References?\s*\n',
    re.IGNORECASE,
)


# ─────────────────────────────────────────────────────────────
# Helper: Lấy tên document dễ đọc từ file_path
# ─────────────────────────────────────────────────────────────

def _extract_document_title(file_path: str) -> str:
    if not file_path or file_path.strip() == "unknown_source":
        return "Unknown Document"
    normalized: str = file_path.replace("\\", "/")
    parts: list[str] = normalized.split("/")
    filename: str = parts[-1] if parts else file_path
    return filename if filename else "Unknown Document"


# ─────────────────────────────────────────────────────────────
# Core: Parse LightRAG output → structured paragraphs
# ─────────────────────────────────────────────────────────────

def parse_paragraphs_with_citations(
    llm_text: str,
    chunks: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """
    Parse LightRAG LLM response để extract structured paragraphs với citations.

    LLM được instruct output format inline:
        "Text here [1]<#>verbatim quote from source 1<#>. More text [2]<#>quote 2<#>."

    Cùng [n] ở paragraph khác nhau có quote khác nhau.
    Nếu LLM không sinh <#>...<#> (fallback), dùng full chunk content.

    Args:
        llm_text: Full markdown text từ LightRAG LLM response
        chunks:   List chunks, mỗi chunk có {"content", "file_path", "reference_id"}

    Returns:
        List of paragraph dicts: [{"text": str, "citations": [...]}]
    """
    if not llm_text or not llm_text.strip():
        return []

    # Strip References section nếu LLM vẫn sinh ra (không parse, chỉ bỏ khỏi display)
    split_parts: list[str] = _REFERENCES_SECTION_PATTERN.split(llm_text, maxsplit=1)
    main_text: str = split_parts[0].strip()
    if not main_text:
        return []

    # Build ref_map: reference_id (str) → chunk dict
    ref_map: dict[str, dict[str, Any]] = {}
    for chunk in chunks:
        ref_id: str = str(chunk.get("reference_id", "")).strip()
        if ref_id:
            ref_map[ref_id] = chunk

    result: list[dict[str, Any]] = []

    for raw_para in re.split(r'\n\n+', main_text):
        trimmed: str = raw_para.strip()
        if not trimmed:
            continue

        citations: list[dict[str, Any]] = []
        seen: set[tuple[str, str]] = set()

        # PRIMARY: extract [n]<#>quote<#> pairs
        for m in _INLINE_CITATION_PATTERN.finditer(trimmed):
            cid: str = m.group(1)
            quote: str = m.group(2).strip()
            key: tuple[str, str] = (cid, quote)
            if key in seen:
                continue
            seen.add(key)

            chunk_data: dict[str, Any] | None = ref_map.get(cid)
            if chunk_data is None:
                logger.warning(f"[Citations] No chunk for reference_id={cid!r}")
                continue

            file_path: str = str(chunk_data.get("file_path", "unknown_source"))
            citations.append({
                "id": int(cid),
                "quote": quote,
                "source": {
                    "file_path": file_path,
                    "document_title": _extract_document_title(file_path),
                },
            })

        # FALLBACK: plain [n] without <#>quote<#> — use full chunk content
        if not citations:
            for cid in dict.fromkeys(_PLAIN_CITATION_PATTERN.findall(trimmed)):
                chunk_data = ref_map.get(cid)
                if chunk_data is None:
                    continue
                file_path = str(chunk_data.get("file_path", "unknown_source"))
                citations.append({
                    "id": int(cid),
                    "quote": str(chunk_data.get("content", "")).strip(),
                    "source": {
                        "file_path": file_path,
                        "document_title": _extract_document_title(file_path),
                    },
                })

        # Clean display text: xóa <#>quote<#>, giữ [n]
        clean_text: str = re.sub(r'<#>.*?<#>', '', trimmed, flags=re.DOTALL)
        clean_text = re.sub(r'\s{2,}', ' ', clean_text).strip()

        result.append({"text": clean_text, "citations": citations})

    logger.debug(
        f"[Citations] Parsed {len(result)} paragraphs, "
        f"{sum(len(p['citations']) for p in result)} total citations"
    )
    return result




# ─────────────────────────────────────────────────────────────
# Helper: serialize Conversation object → dict cho JSON response
# ─────────────────────────────────────────────────────────────

def _serialize_conversation(conv: Conversation, preview: str = "") -> dict[str, Any]:
    """
    Serialize Conversation SQLAlchemy object → dict cho JSON response.

    Args:
        conv:    Conversation ORM object
        preview: Nội dung preview (80 chars đầu của message cuối)

    Returns:
        Dict với các fields: id, title, preview, created_at, updated_at
    """
    return {
        "id": conv.id,
        "title": conv.title,
        "preview": preview,
        "created_at": conv.created_at.isoformat(),
        "updated_at": conv.updated_at.isoformat(),
    }


# ─────────────────────────────────────────────────────────────
# Helper: serialize Message object → dict cho JSON response
# ─────────────────────────────────────────────────────────────

def _serialize_message(msg: Message) -> dict[str, Any]:
    """
    Serialize Message SQLAlchemy object → dict cho JSON response.

    Nếu message có paragraphs (AI response với citations),
    include luôn trong response để frontend hiển thị citations.
    Nếu không có (legacy message hoặc user message), bỏ qua field paragraphs.

    Args:
        msg: Message ORM object

    Returns:
        Dict với các fields: id, conversation_id, role, content, created_at,
        và optionally paragraphs (chỉ cho AI messages có citations)
    """
    result: dict[str, Any] = {
        "id": msg.id,
        "conversation_id": msg.conversation_id,
        "role": msg.role,
        "content": msg.content,
        "created_at": msg.created_at.isoformat(),
    }

    # Chỉ include paragraphs nếu có data (không include key nếu None)
    # → Frontend sẽ check `message.paragraphs !== undefined`
    paragraphs = msg.paragraphs
    if paragraphs is not None:
        result["paragraphs"] = paragraphs

    return result
import asyncio
import json
import logging

from json_repair import repair_json
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from database import get_db
from dependencies.claude_credentials import get_claude_credentials
from lightrag import QueryParam
from models.kanban_template import KanbanTemplate
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from lightrag_prompts import KANBAN_RETRIEVE_CANDIDATES_PROMPT
from rag_state import (
    _call_claude_cli_async,
    _request_credentials,
    _request_user_id,
    get_rag_for_workspace,
    ClaudeAIError,
)
from routers.kanban.kanban_agent_prompts import (
    DEFAULT_SAMPLE_INSTRUCTION,
    KANBAN_ANALYZE_SYSTEM_PROMPT,
    KANBAN_CREATE_SYSTEM_PROMPT,
    KANBAN_DELETE_SYSTEM_PROMPT,
    KANBAN_IMPACT_ANALYSIS_SYSTEM_PROMPT,
    KANBAN_UPDATE_SYSTEM_PROMPT,
)

logger = logging.getLogger(__name__)


# ─── Per-user rate limiter (max 3 concurrent requests per user) ───────────────

_MAX_CONCURRENT_PER_USER: int = 3
_rate_limit_lock = asyncio.Lock()
_user_slots: dict[str, int] = {}


async def _acquire_slot(user_id: str) -> bool:
    """Try to acquire a processing slot for user_id. Returns False if limit reached."""
    async with _rate_limit_lock:
        count = _user_slots.get(user_id, 0)
        if count >= _MAX_CONCURRENT_PER_USER:
            return False
        _user_slots[user_id] = count + 1
        return True


async def _release_slot(user_id: str) -> None:
    """Release a previously acquired slot for user_id."""
    async with _rate_limit_lock:
        count = _user_slots.get(user_id, 0)
        if count > 1:
            _user_slots[user_id] = count - 1
        else:
            _user_slots.pop(user_id, None)


# ─── Per-card in-process lock (single worker only) ────────────────────────────
# NOTE: Chỉ hoạt động đúng với single worker. Nếu scale lên multi-worker/
#       multi-container, phải thay thế bằng Redis distributed lock.

_card_lock = asyncio.Lock()
_in_progress_cards: set[str] = set()


async def _acquire_card(card_id: str) -> bool:
    """Try to mark card_id as in-progress. Returns False if already being processed."""
    async with _card_lock:
        if card_id in _in_progress_cards:
            return False
        _in_progress_cards.add(card_id)
        return True


async def _release_card(card_id: str) -> None:
    """Mark card_id as no longer in-progress."""
    async with _card_lock:
        _in_progress_cards.discard(card_id)


class RelatedDocument(BaseModel):
    id: str
    title: str
    url: str


class RelatedDocumentWithContent(BaseModel):
    id: str
    title: str
    url: str
    content: str | None = None


class TextEdit(BaseModel):
    old_string: str
    new_string: str
    description: str


class DocumentChange(BaseModel):
    document_id: str
    document_title: str
    changes_summary: list[str]
    is_user_provided: bool
    text_edits: list[TextEdit] = []


class RetrieveCandidatesRequest(BaseModel):
    """Request body cho POST /kanban/retrieve-candidates."""

    card_title: str = Field(..., description="Tiêu đề Kanban card — dùng làm query chính")
    card_description: str | None = Field(
        None,
        description="Mô tả chi tiết của card — bổ sung ngữ cảnh cho embedding query",
    )


class CandidateChunk(BaseModel):
    """Một document candidate được tìm thấy qua vector search."""

    # file_path: tên file khi upload lên LightRAG (VD: "Our Editor.md")
    # Node.js sẽ strip extension và tìm kiếm trong documents.title
    file_path: str
    content_snippet: str


class RetrieveCandidatesResponse(BaseModel):
    """Response của POST /kanban/retrieve-candidates."""

    candidates: list[CandidateChunk]


class ImpactAnalysisItemWithContent(BaseModel):
    """Một usecase bị ảnh hưởng bởi change request, kèm content và lý do."""

    affected_document_id: str | None = Field(
        None, description="UUID primary key của document trong DB (null nếu AI không xác định được)"
    )
    affected_document_title: str = Field(..., description="Tiêu đề document bị ảnh hưởng")
    affected_document_url: str | None = Field(
        None, description="Navigation URL của document (e.g. /doc/urlId)"
    )
    description: str = Field(..., description="Lý do tại sao usecase này bị ảnh hưởng (impact reason)")
    content: str | None = Field(
        None, description="Nội dung đầy đủ của document; null nếu affected_document_id là null"
    )


class KanbanImplementRequest(BaseModel):
    card_id: str = Field(..., description="ID của Kanban card")
    card_title: str = Field(..., description="Tiêu đề của card")
    card_description: str | None = Field(None, description="Mô tả chi tiết của card")
    related_documents: list[RelatedDocument] = Field(
        default_factory=list,
        description="Danh sách documents được link vào card (metadata)",
    )
    related_documents_with_content: list[RelatedDocumentWithContent] = Field(
        default_factory=list,
        description="Danh sách documents với nội dung đầy đủ (fetched by Node.js)",
    )
    impact_analysis_items: list[ImpactAnalysisItemWithContent] = Field(
        default_factory=list,
        description="Danh sách usecase bị ảnh hưởng từ kết quả Analyze Impact, kèm content và lý do",
    )
    # Kept for backward compatibility with the /analyze-impact endpoint which still
    # receives candidate_documents from LightRAG (via Node.js analyze-impact route).
    # NOT used by the implement workflow — implement workflow uses impact_analysis_items.
    candidate_documents: list[RelatedDocumentWithContent] = Field(
        default_factory=list,
        description="[analyze-impact only] Documents tìm thấy qua LightRAG, dùng bởi _call_impact_agent_v2",
    )
    # Dùng để tra cứu active template của user trong DB.
    # Optional để backward compatible với clients cũ chưa gửi 2 field này.
    outline_user_id: str = Field(default="", description="Outline user ID (từ auth store)")
    team_id: str = Field(default="", description="Workspace (team) ID")


class AnalyzeImpactItem(BaseModel):
    affected_document_id: str | None = None
    affected_document_title: str
    affected_document_url: str | None = None
    description: str


class AnalyzeImpactResponse(BaseModel):
    has_impacts: bool
    impacts: list[AnalyzeImpactItem] = []


class DocumentToCreate(BaseModel):
    title: str
    content: str
    collection_id: str | None = None


class KanbanImplementResponse(BaseModel):
    action: Literal["create_document", "update_document", "delete_document", "none"]
    documents_to_create: list[DocumentToCreate] | None = None
    target_document_id: str | None = None
    document_changes: list[DocumentChange] | None = None
    delete_document_ids: list[str] | None = None
    delete_document_titles: list[str] | None = None
    reasoning: str


router = APIRouter(
    prefix="/kanban",
    tags=["kanban"],
)


# ─── Constants cho /retrieve-candidates ─────────────────────────────────────
# Số candidates tối đa trả về cho Node.js
_MAX_CANDIDATES: int = 10
# Độ dài content snippet (ký tự)
_SNIPPET_LENGTH: int = 300


@router.post(
    "/retrieve-candidates",
    response_model=RetrieveCandidatesResponse,
    summary="Tìm candidate documents liên quan đến Kanban card bằng LightRAG hybrid search (knowledge graph + vector)",
)
async def retrieve_candidates(
    body: RetrieveCandidatesRequest,
    request: Request,
    credentials_json: str = Depends(get_claude_credentials),
) -> RetrieveCandidatesResponse:
    """
    Tìm kiếm documents trong LightRAG knowledge base có nội dung liên quan
    đến card title + description, sử dụng hybrid retrieval (knowledge graph + vector).

    Pipeline:
        1. Ghép card_title + card_description thành query string
        2. Gọi rag.aquery_llm(query, mode="hybrid") — kết hợp Neo4j graph traversal
           và vector similarity search để tìm documents liên quan gián tiếp
        3. Extract chunks từ raw_data["data"]["chunks"] (không parse LLM text)
        4. De-duplicate chunks theo file_path
        5. Trả về toàn bộ candidates (không giới hạn số lượng)

    Node.js sẽ dùng file_path để tìm document tương ứng trong Outline DB.
    """
    # BƯỚC 1: Xây dựng query string từ title + description
    query: str = body.card_title
    if body.card_description and body.card_description.strip():
        query = f"{body.card_title}\n\n{body.card_description}"

    logger.info(
        "[RetrieveCandidates] card=%r, query_len=%d chars, mode=hybrid",
        body.card_title,
        len(query),
    )

    # BƯỚC 2: Hybrid retrieval qua knowledge graph + vector search
    workspace_id = request.headers.get("X-Workspace-Id", "").strip()
    logger.info(f"[RetrieveCandidates] workspace_id={workspace_id}")
    rag = await get_rag_for_workspace(workspace_id)
    original_func = rag.llm_model_func
    rag.llm_model_func = _call_claude_cli_async
    user_id = request.headers.get("X-User-Key", "").strip()
    ctx_token = _request_credentials.set(credentials_json)
    ctx_token_user = _request_user_id.set(user_id)
    try:
        result: dict = await rag.aquery_llm(
            query,
            param=QueryParam(mode="hybrid"),
            system_prompt=KANBAN_RETRIEVE_CANDIDATES_PROMPT,
        )
    except Exception as exc:
        logger.error(
            "[RetrieveCandidates] aquery_llm failed: %s", exc, exc_info=True
        )
        return RetrieveCandidatesResponse(candidates=[])
    finally:
        rag.llm_model_func = original_func
        _request_credentials.reset(ctx_token)
        _request_user_id.reset(ctx_token_user)

    # BƯỚC 3: Extract chunks từ raw_data (knowledge graph đã xác định)
    raw_data: dict = result.get("raw_data", {})
    data_section: dict = raw_data.get("data", result.get("data", {}))
    raw_chunks: list[dict] = data_section.get("chunks", [])
    logger.info(f"Raw chunks retrieved: {raw_chunks}")

    # BƯỚC 4: De-duplicate theo file_path
    seen_file_paths: set[str] = set()
    candidates: list[CandidateChunk] = []

    for chunk in raw_chunks:
        file_path: str = chunk.get("file_path") or ""
        content: str = chunk.get("content") or ""

        if not file_path or file_path in seen_file_paths:
            continue

        seen_file_paths.add(file_path)
        logger.info(f"File path added as candidate: {file_path}")
        candidates.append(
            CandidateChunk(
                file_path=file_path,
                content_snippet=content[:_SNIPPET_LENGTH],
            )
        )

    logger.info(
        "[RetrieveCandidates] card=%r → %d unique candidates from %d raw chunks",
        body.card_title,
        len(candidates),
        len(raw_chunks),
    )
    logger.info("Candidates:\n" + "\n".join(f"- {c.file_path}" for c in candidates))

    return RetrieveCandidatesResponse(candidates=candidates)


# ─── Prompt builders ─────────────────────────────────────────────────────────

def _build_agent_context(
    user_docs: list[RelatedDocumentWithContent],
    impact_items: list[ImpactAnalysisItemWithContent],
    card_title: str,
    card_description: str | None,
    related_docs: list[RelatedDocument] | None = None,
) -> str:
    """Build the shared document context section used by all agents.

    Sections rendered (only when non-empty):
    1. USER-PROVIDED DOCUMENTS — documents manually linked to the card (full content)
    2. IMPACT ANALYSIS RESULTS — usecases affected by this change request (content + reason)
    3. Card Title / Card Description
    4. Related Documents — metadata list (optional)
    """
    parts: list[str] = []

    if user_docs:
        doc_parts = []
        for doc in user_docs:
            content = doc.content if doc.content else "(no content)"
            doc_parts.append(
                f"Document ID: {doc.id}\n"
                f"Title: {doc.title}\n"
                f"URL: {doc.url}\n"
                f"Content:\n{content}\n"
                f"---"
            )
        parts.append("USER-PROVIDED DOCUMENTS (full content):\n" + "\n".join(doc_parts))

    if impact_items:
        impact_parts = []
        for item in impact_items:
            content = item.content if item.content else "(no content)"
            impact_parts.append(
                f"Document ID: {item.affected_document_id or 'N/A'}\n"
                f"Title: {item.affected_document_title}\n"
                f"URL: {item.affected_document_url or 'N/A'}\n"
                f"Content:\n{content}\n"
                f"Impact Reason: {item.description}\n"
                f"---"
            )
        parts.append(
            "IMPACT ANALYSIS RESULTS (use cases affected by this change request):\n"
            + "\n".join(impact_parts)
        )

    card_section = f"Card Title: {card_title}"
    if card_description and card_description.strip():
        card_section += f"\nCard Description:\n{card_description}"
    parts.append(card_section)

    if related_docs:
        docs_list = "\n".join(
            f"  - ID: {doc.id}, Title: {doc.title}, URL: {doc.url}"
            for doc in related_docs
        )
        parts.append(f"Related Documents:\n{docs_list}")

    return "\n\n".join(parts)


def _parse_agent_response(raw: str, step_name: str) -> dict:
    """Parse a JSON response from an agent call, repairing if needed."""
    try:
        data = repair_json(raw, return_objects=True)
        if not isinstance(data, dict):
            raise ValueError(f"Parsed result is not a JSON object, got: {type(data)}")
        return data
    except Exception as e:
        logger.error("[%s] Agent returned invalid JSON: %s\nRaw response: %s", step_name, e, raw[:500])
        raise HTTPException(status_code=500, detail="AI gặp lỗi trong quá trình xử lý, vui lòng thử lại")


# ─── Agent functions ──────────────────────────────────────────────────────────

async def _call_analyze_agent(
    card_title: str,
    card_description: str | None,
    related_docs: list[RelatedDocument],
) -> dict:
    """Step 1: Analyze the card and determine the required document action.

    Only needs card info + related document metadata (id/title) to determine the action.
    Full document content is NOT passed here — it would waste tokens without adding value,
    since the analyze agent only needs to identify IDs for hints, not read content.
    """
    parts: list[str] = []

    card_section = f"Card Title: {card_title}"
    if card_description and card_description.strip():
        card_section += f"\nCard Description:\n{card_description}"
    parts.append(card_section)

    if related_docs:
        docs_list = "\n".join(
            f"  - ID: {doc.id}, Title: {doc.title}, URL: {doc.url}"
            for doc in related_docs
        )
        parts.append(f"Related Documents:\n{docs_list}")

    prompt = "\n\n".join(parts)
    prompt += "\n\nBased on the card and related documents (if any) above, determine the required document action and return JSON."
    logger.info("[KanbanWorkflow][Step1:Analyze] Calling Claude CLI")
    logger.info("[KanbanWorkflow][Step1:Analyze] Prompt:\n%s", prompt)

    raw = await _call_claude_cli_async(prompt=prompt, system_prompt=KANBAN_ANALYZE_SYSTEM_PROMPT)
    logger.info("[KanbanWorkflow][Step1:Analyze] Raw response:\n%s", raw)

    result = _parse_agent_response(raw, "Step1:Analyze")
    logger.info(
        "[KanbanWorkflow][Step1:Analyze] action=%r", result.get("action")
    )
    return result


async def _call_create_agent(
    card_title: str,
    card_description: str | None,
    analyze_result: dict,
    user_docs: list[RelatedDocumentWithContent],
    impact_items: list[ImpactAnalysisItemWithContent],
    custom_instruction: str | None = None,
) -> dict:
    """Step 2 (create branch): Generate new document content."""
    context = _build_agent_context(
        user_docs=user_docs,
        impact_items=impact_items,
        card_title=card_title,
        card_description=card_description,
    )
    prompt = (
        f"{context}\n\n"
        f"Analysis Result:\n{json.dumps(analyze_result, ensure_ascii=False)}\n\n"
        f"Create Hints: {json.dumps(analyze_result.get('createHints'), ensure_ascii=False)}\n\n"
        f"Based on the card, user-provided documents, and impact analysis results (if any) above, generate the new UC document."
    )
    logger.info("[KanbanWorkflow][Step2:Create] Calling Claude CLI")
    logger.info("[KanbanWorkflow][Step2:Create] Prompt:\n%s", prompt)

    instruction = custom_instruction or DEFAULT_SAMPLE_INSTRUCTION
    system_prompt = KANBAN_CREATE_SYSTEM_PROMPT.replace("<<<SAMPLE_INSTRUCTION>>>", instruction)
    logger.info("[KanbanWorkflow][Step2:Create] System prompt:\n%s", system_prompt)
    raw = await _call_claude_cli_async(prompt=prompt, system_prompt=system_prompt)
    logger.info("[KanbanWorkflow][Step2:Create] Raw response:\n%s", raw)

    result = _parse_agent_response(raw, "Step2:Create")
    doc_count = len(result.get("documentsToCreate") or [])
    logger.info("[KanbanWorkflow][Step2:Create] documentsToCreate count=%d", doc_count)
    return result


async def _call_update_agent(
    card_title: str,
    card_description: str | None,
    analyze_result: dict,
    user_docs: list[RelatedDocumentWithContent],
    impact_items: list[ImpactAnalysisItemWithContent],
) -> dict:
    """Step 2 (update branch): Produce textEdits for existing documents."""
    context = _build_agent_context(
        user_docs=user_docs,
        impact_items=impact_items,
        card_title=card_title,
        card_description=card_description,
    )
    prompt = (
        f"{context}\n\n"
        f"Analysis Result:\n{json.dumps(analyze_result, ensure_ascii=False)}\n\n"
        f"Update Hints: {json.dumps(analyze_result.get('updateHints'), ensure_ascii=False)}\n\n"
        f"Based on the card, user-provided documents, and impact analysis results (if any) above, produce textEdits for the required changes."
    )
    logger.info("[KanbanWorkflow][Step2:Update] Calling Claude CLI")
    logger.info("[KanbanWorkflow][Step2:Update] Prompt:\n%s", prompt)

    raw = await _call_claude_cli_async(prompt=prompt, system_prompt=KANBAN_UPDATE_SYSTEM_PROMPT)
    logger.info("[KanbanWorkflow][Step2:Update] Raw response:\n%s", raw)

    result = _parse_agent_response(raw, "Step2:Update")
    change_count = len(result.get("documentChanges") or [])
    logger.info("[KanbanWorkflow][Step2:Update] documentChanges count=%d", change_count)
    return result


async def _call_delete_agent(
    card_title: str,
    card_description: str | None,
    analyze_result: dict,
    user_docs: list[RelatedDocumentWithContent],
    impact_items: list[ImpactAnalysisItemWithContent],
) -> dict:
    """Step 2 (delete branch): Identify documents to delete."""
    context = _build_agent_context(
        user_docs=user_docs,
        impact_items=impact_items,
        card_title=card_title,
        card_description=card_description,
    )
    prompt = (
        f"{context}\n\n"
        f"Analysis Result:\n{json.dumps(analyze_result, ensure_ascii=False)}\n\n"
        f"Delete Hints: {json.dumps(analyze_result.get('deleteHints'), ensure_ascii=False)}\n\n"
        f"Based on the card, user-provided documents, and impact analysis results (if any) above, identify the documents to delete."
    )
    logger.info("[KanbanWorkflow][Step2:Delete] Calling Claude CLI")
    logger.info("[KanbanWorkflow][Step2:Delete] Prompt:\n%s", prompt)

    raw = await _call_claude_cli_async(prompt=prompt, system_prompt=KANBAN_DELETE_SYSTEM_PROMPT)
    logger.info("[KanbanWorkflow][Step2:Delete] Raw response:\n%s", raw)

    result = _parse_agent_response(raw, "Step2:Delete")
    id_count = len(result.get("documentIds") or [])
    logger.info("[KanbanWorkflow][Step2:Delete] documentIds count=%d", id_count)
    return result


async def _call_impact_agent_v2(
    card_title: str,
    card_description: str | None,
    user_docs: list[RelatedDocumentWithContent],
    candidate_docs: list[RelatedDocumentWithContent],
) -> tuple[dict, dict[str, str]]:
    """Analyze impact of a change request on related use case documents.

    Runs BEFORE any document operation is determined — receives only the card
    (change request) and the related use case documents. Evaluates impact across
    three dimensions: Functional, Business, Data.

    NOTE: This function builds its own prompt directly (not via _build_agent_context)
    because the impact analysis agent expects the legacy "CANDIDATE DOCUMENTS" section
    label as defined in KANBAN_IMPACT_ANALYSIS_SYSTEM_PROMPT, while _build_agent_context
    now renders "IMPACT ANALYSIS RESULTS" for the implement workflow agents.

    Returns a tuple of (agent_result_dict, url_map) where url_map maps
    document id → document url for all input documents.
    """
    parts: list[str] = []

    if user_docs:
        doc_parts = []
        for doc in user_docs:
            content = doc.content if doc.content else "(no content)"
            doc_parts.append(
                f"Document ID: {doc.id}\n"
                f"Title: {doc.title}\n"
                f"URL: {doc.url}\n"
                f"Content:\n{content}\n"
                f"---"
            )
        parts.append("USER-PROVIDED DOCUMENTS (full content):\n" + "\n".join(doc_parts))

    if candidate_docs:
        doc_parts = []
        for doc in candidate_docs:
            content = doc.content if doc.content else "(no content)"
            doc_parts.append(
                f"Document ID: {doc.id}\n"
                f"Title: {doc.title}\n"
                f"URL: {doc.url}\n"
                f"Content:\n{content}\n"
                f"---"
            )
        parts.append("CANDIDATE DOCUMENTS (may be relevant):\n" + "\n".join(doc_parts))

    card_section = f"Card Title: {card_title}"
    if card_description and card_description.strip():
        card_section += f"\nCard Description:\n{card_description}"
    parts.append(card_section)

    prompt = "\n\n".join(parts)
    prompt += "\n\nBased on the card and provided documents (if any) above, identify and analyze all affected use cases."

    logger.info("[AnalyzeImpact] Calling Claude CLI — card=%r", card_title)
    logger.info("[AnalyzeImpact] Prompt:\n%s", prompt)

    raw = await _call_claude_cli_async(prompt=prompt, system_prompt=KANBAN_IMPACT_ANALYSIS_SYSTEM_PROMPT)
    logger.info("[AnalyzeImpact] Raw response:\n%s", raw)

    result = _parse_agent_response(raw, "AnalyzeImpact")
    logger.info(
        "[AnalyzeImpact] hasImpacts=%s, impacts count=%d",
        result.get("hasImpacts"),
        len(result.get("impacts") or []),
    )
    logger.info(f"[AnalyzeImpact] Impacts result: {json.dumps(result.get('impacts'), ensure_ascii=False)}")

    url_map: dict[str, str] = {
        doc.id: doc.url
        for doc in (user_docs + candidate_docs)
        if doc.url
    }
    return result, url_map


def _parse_analyze_impact_response(
    data: dict,
    url_map: dict[str, str] | None = None,
) -> AnalyzeImpactResponse:
    """Parse the agent dict result into an AnalyzeImpactResponse model."""
    try:
        raw_impacts = data.get("impacts") or []
        _url_map = url_map or {}
        impacts = [
            AnalyzeImpactItem(
                affected_document_id=item.get("affectedDocumentId"),
                affected_document_title=str(item.get("affectedDocumentTitle", "")),
                affected_document_url=_url_map.get(item.get("affectedDocumentId") or ""),
                description=str(item.get("description", "")),
            )
            for item in raw_impacts
            if isinstance(item, dict)
        ]
        return AnalyzeImpactResponse(
            has_impacts=bool(data.get("hasImpacts", False)),
            impacts=impacts,
        )
    except Exception as e:
        logger.error("[_parse_analyze_impact_response] Parse failed: %s\nData: %s", e, str(data)[:500])
        raise HTTPException(status_code=500, detail="AI gặp lỗi trong quá trình xử lý, vui lòng thử lại")


# ─── Orchestration ────────────────────────────────────────────────────────────

async def _run_kanban_workflow(
    request: KanbanImplementRequest,
    custom_instruction: str | None = None,
) -> KanbanImplementResponse:
    """
    Python-controlled 4-step Kanban workflow:
      Step 1 — Analyze:  determine required action (create/update/delete/none)
      Step 2 — Execute:  run the appropriate action agent
      Step 3 — Impact:   analyze impact on other documents
      Step 4 — Merge:    combine results into KanbanImplementResponse
    """
    logger.info(
        "[KanbanWorkflow] START — card_id=%r, card_title=%r",
        request.card_id,
        request.card_title,
    )

    # ── Step 1: Analyze ──────────────────────────────────────────────────────
    logger.info("[KanbanWorkflow][Step1:Analyze] ENTER")
    analyze_result = await _call_analyze_agent(
        card_title=request.card_title,
        card_description=request.card_description,
        related_docs=request.related_documents,
    )
    action = analyze_result.get("action", "none")
    logger.info("[KanbanWorkflow][Step1:Analyze] EXIT — action=%r", action)

    # ── Early return: skip AI for update/delete when no docs available ────────
    if action in ("update_document", "delete_document"):
        user_docs = request.related_documents_with_content
        impact_items = request.impact_analysis_items
        if not user_docs and not impact_items:
            logger.info(
                "[KanbanWorkflow] Early return — action=%r but no user_docs and no impact_items",
                action,
            )
            return KanbanImplementResponse(
                action=action,
                reasoning="Không có tài liệu liên quan để thực hiện thao tác này.",
            )

    # ── Step 2: Execute ──────────────────────────────────────────────────────
    action_result: dict

    if action == "create_document":
        logger.info("[KanbanWorkflow][Step2:Create] ENTER")
        raw_create = await _call_create_agent(
            card_title=request.card_title,
            card_description=request.card_description,
            analyze_result=analyze_result,
            user_docs=request.related_documents_with_content,
            impact_items=request.impact_analysis_items,
            custom_instruction=custom_instruction,
        )
        action_result = {
            "action": "create_document",
            "documentsToCreate": raw_create.get("documentsToCreate", []),
            "reasoning": raw_create.get("reasoning", ""),
        }
        logger.info("[KanbanWorkflow][Step2:Create] EXIT")

    elif action == "update_document":
        logger.info("[KanbanWorkflow][Step2:Update] ENTER")
        raw_update = await _call_update_agent(
            card_title=request.card_title,
            card_description=request.card_description,
            analyze_result=analyze_result,
            user_docs=request.related_documents_with_content,
            impact_items=request.impact_analysis_items,
        )
        action_result = {
            "action": "update_document",
            "documentChanges": raw_update.get("documentChanges", []),
            "reasoning": raw_update.get("reasoning", ""),
        }
        logger.info("[KanbanWorkflow][Step2:Update] EXIT")

    elif action == "delete_document":
        logger.info("[KanbanWorkflow][Step2:Delete] ENTER")
        raw_delete = await _call_delete_agent(
            card_title=request.card_title,
            card_description=request.card_description,
            analyze_result=analyze_result,
            user_docs=request.related_documents_with_content,
            impact_items=request.impact_analysis_items,
        )
        action_result = {
            "action": "delete_document",
            "deleteDocumentIds": raw_delete.get("documentIds", []),
            "deleteDocumentTitles": raw_delete.get("documentTitles", []),
            "reasoning": raw_delete.get("reasoning", ""),
        }
        logger.info("[KanbanWorkflow][Step2:Delete] EXIT")

    else:  # none — no action agent needed
        logger.info("[KanbanWorkflow][Step2:None] No action agent required")
        action_result = {
            "action": "none",
            "reasoning": analyze_result.get("reasoning", "No document operation required."),
        }

    # ── Step 3: Merge and parse ───────────────────────────────────────────────
    logger.info("[KanbanWorkflow] DONE — parsing action result")
    logger.debug("[KanbanWorkflow] Action result:\n%s", json.dumps(action_result, ensure_ascii=False, indent=2))

    return _parse_ai_response(json.dumps(action_result, ensure_ascii=False), request.card_title)


# ─── Response parser ──────────────────────────────────────────────────────────

def _parse_ai_response(response_text: str, card_title: str) -> KanbanImplementResponse:
    try:
        data = repair_json(response_text, return_objects=True)
        if not isinstance(data, dict):
            raise ValueError("Parsed result is not a JSON object")
    except Exception as e:
        logger.error("[_parse_ai_response] Claude CLI trả về response không phải JSON hợp lệ: %s\nRaw response: %s", e, response_text[:500])
        raise HTTPException(status_code=500, detail="AI gặp lỗi trong quá trình xử lý, vui lòng thử lại")

    action = data.get("action")
    valid_actions = ("create_document", "update_document", "delete_document", "none")
    if action not in valid_actions:
        logger.error("[_parse_ai_response] Action không hợp lệ: %r. Raw response: %s", action, response_text[:500])
        raise HTTPException(status_code=500, detail="AI gặp lỗi trong quá trình xử lý, vui lòng thử lại")

    # Parse documentsToCreate cho create action
    documents_to_create: list[DocumentToCreate] | None = None
    if action == "create_document":
        raw_docs = data.get("documentsToCreate")
        if isinstance(raw_docs, list):
            documents_to_create = [
                DocumentToCreate(
                    title=str(d.get("title", "")),
                    content=str(d.get("content", "")),
                    collection_id=d.get("collectionId"),
                )
                for d in raw_docs
                if isinstance(d, dict)
            ]

    # Parse documentChanges cho update action
    document_changes: list[DocumentChange] | None = None
    if action == "update_document":
        raw_changes = data.get("documentChanges")
        if isinstance(raw_changes, list):
            document_changes = []
            for item in raw_changes:
                if isinstance(item, dict):
                    raw_edits = item.get("textEdits") or []
                    text_edits = []
                    for edit in raw_edits:
                        if isinstance(edit, dict):
                            text_edits.append(
                                TextEdit(
                                    old_string=str(edit.get("oldString", "")),
                                    new_string=str(edit.get("newString", "")),
                                    description=str(edit.get("description", "")),
                                )
                            )
                    document_changes.append(
                        DocumentChange(
                            document_id=str(item.get("documentId", "")),
                            document_title=str(item.get("documentTitle", "")),
                            changes_summary=item.get("changesSummary") or [],
                            is_user_provided=bool(item.get("isUserProvided", True)),
                            text_edits=text_edits,
                        )
                    )

    # Parse deleteDocumentIds/Titles for delete action
    delete_document_ids: list[str] | None = None
    delete_document_titles: list[str] | None = None
    if action == "delete_document":
        raw_ids = data.get("deleteDocumentIds")
        raw_titles = data.get("deleteDocumentTitles")
        if isinstance(raw_ids, list):
            delete_document_ids = [str(i) for i in raw_ids if i]
        if isinstance(raw_titles, list):
            delete_document_titles = [str(t) for t in raw_titles if t]

    return KanbanImplementResponse(
        action=action,
        documents_to_create=documents_to_create,
        target_document_id=data.get("targetDocumentId"),
        document_changes=document_changes,
        delete_document_ids=delete_document_ids,
        delete_document_titles=delete_document_titles,
        reasoning=data.get("reasoning", "No reasoning provided"),
    )


# ─── Batch helpers for analyze-impact ────────────────────────────────────────

def _chunk_list(lst: list, size: int) -> list[list]:
    """Chia list thành các batch kích thước size."""
    return [lst[i : i + size] for i in range(0, len(lst), size)]


async def _run_single_batch(
    card_title: str,
    card_description: str | None,
    user_docs_batch: list[RelatedDocumentWithContent],
    candidate_docs_batch: list[RelatedDocumentWithContent],
) -> dict | None:
    """Chạy 1 batch analyze impact. Trả về None nếu batch bị lỗi."""
    try:
        result, _ = await _call_impact_agent_v2(
            card_title=card_title,
            card_description=card_description,
            user_docs=user_docs_batch,
            candidate_docs=candidate_docs_batch,
        )
        return result
    except Exception as exc:
        logger.warning("[AnalyzeImpact] Batch failed, skipping: %s", exc)
        return None


# ─── Endpoints ────────────────────────────────────────────────────────────────

@router.post(
    "/analyze-impact",
    response_model=AnalyzeImpactResponse,
    summary="AI phân tích tác động của change request lên các usecase liên quan",
)
async def analyze_impact(
    body: KanbanImplementRequest,
    request: Request,
    credentials_json: str = Depends(get_claude_credentials),
) -> AnalyzeImpactResponse:
    logger.info(
        "[AnalyzeImpact] START — card_id=%r, card_title=%r",
        body.card_id,
        body.card_title,
    )

    user_id = request.headers.get("X-User-Key", "anonymous").strip() or "anonymous"

    if not await _acquire_slot(user_id):
        logger.warning("[AnalyzeImpact] Rate limit hit — user_id=%r", user_id)
        raise HTTPException(
            status_code=429,
            detail="Maximum 3 cards are being processed, please wait.",
        )

    card_acquired = False
    ctx_token = _request_credentials.set(credentials_json)
    ctx_token_user = _request_user_id.set(user_id)
    try:
        if not await _acquire_card(body.card_id):
            logger.warning("[AnalyzeImpact] Card already in progress — card_id=%r", body.card_id)
            raise HTTPException(
                status_code=409,
                detail="Card này đang được xử lý bởi người dùng khác. Vui lòng chờ.",
            )
        card_acquired = True

        # Task 3: Dedup — xóa khỏi candidate_docs những doc có id trùng user_docs
        user_docs = body.related_documents_with_content
        user_doc_ids = {doc.id for doc in user_docs}
        candidate_docs = [doc for doc in body.candidate_documents if doc.id not in user_doc_ids]

        logger.info(
            "[AnalyzeImpact] After dedup — user_docs=%d, candidate_docs=%d",
            len(user_docs),
            len(candidate_docs),
        )

        # Task 4: Early return nếu cả 2 list rỗng
        if not user_docs and not candidate_docs:
            logger.info("[AnalyzeImpact] Both lists empty, returning no impacts")
            return AnalyzeImpactResponse(has_impacts=False, impacts=[])
        # Task 7: Chia batch và chạy song song
        user_batches = _chunk_list(user_docs, _MAX_CANDIDATES)
        candidate_batches = _chunk_list(candidate_docs, _MAX_CANDIDATES)

        tasks = []
        for batch in user_batches:
            tasks.append(_run_single_batch(body.card_title, body.card_description, batch, []))
        for batch in candidate_batches:
            tasks.append(_run_single_batch(body.card_title, body.card_description, [], batch))

        logger.info(
            "[AnalyzeImpact] Running %d batches concurrently (%d user, %d candidate)",
            len(tasks),
            len(user_batches),
            len(candidate_batches),
        )

        batch_results = await asyncio.gather(*tasks)

        # Merge: concatenate kết quả, bỏ qua batch lỗi (None)
        url_map: dict[str, str] = {
            doc.id: doc.url for doc in (user_docs + candidate_docs) if doc.url
        }
        all_impacts: list[dict] = []
        has_impacts = False
        for res in batch_results:
            if res is None:
                continue
            if res.get("hasImpacts"):
                has_impacts = True
            all_impacts.extend(res.get("impacts") or [])

        logger.info(
            "[AnalyzeImpact] Merged — hasImpacts=%s, total impacts=%d",
            has_impacts,
            len(all_impacts),
        )

        return _parse_analyze_impact_response(
            {"hasImpacts": has_impacts, "impacts": all_impacts},
            url_map,
        )
    except ClaudeAIError as e:
        logger.error("[AnalyzeImpact] Claude AI error: %s - %s", e.error_code, e.message)
        raise HTTPException(
            status_code=400,
            detail={"error_code": e.error_code, "message": e.message},
        ) from e
    except RuntimeError as e:
        logger.error("[AnalyzeImpact] Claude CLI failed: %s", e)
        raise HTTPException(
            status_code=503,
            detail=f"Claude CLI không available: {str(e)}",
        ) from e
    except ValueError as e:
        logger.error("[AnalyzeImpact] Parse failed: %s", e)
        raise HTTPException(
            status_code=422,
            detail=f"Không thể phân tích response từ AI: {str(e)}",
        ) from e
    finally:
        if card_acquired:
            await _release_card(body.card_id)
        await _release_slot(user_id)
        _request_credentials.reset(ctx_token)
        _request_user_id.reset(ctx_token_user)


@router.post(
    "/implement",
    response_model=KanbanImplementResponse,
    summary="AI phân tích Kanban card và xác định document operation",
)
async def implement_kanban_card(
    body: KanbanImplementRequest,
    request: Request,
    credentials_json: str = Depends(get_claude_credentials),
    db: AsyncSession = Depends(get_db),
) -> KanbanImplementResponse:
    logger.info(
        "[KanbanImplement] Analyzing card: id=%r, title=%r",
        body.card_id,
        body.card_title,
    )

    user_id = request.headers.get("X-User-Key", "anonymous").strip() or "anonymous"

    if not await _acquire_slot(user_id):
        logger.warning("[KanbanImplement] Rate limit hit — user_id=%r", user_id)
        raise HTTPException(
            status_code=429,
            detail="Maximum 3 cards are being processed, please wait.",
        )

    # Lấy active template của user nếu có
    custom_instruction: str | None = None
    if body.outline_user_id and body.team_id:
        result = await db.execute(
            select(KanbanTemplate).where(
                KanbanTemplate.user_id == body.outline_user_id,
                KanbanTemplate.team_id == body.team_id,
                KanbanTemplate.is_active == True,
            )
        )
        active_template = result.scalar_one_or_none()
        if active_template:
            custom_instruction = active_template.content
            logger.info(
                "[KanbanImplement] Using custom template: %r", active_template.name
            )

    card_acquired = False
    ctx_token = _request_credentials.set(credentials_json)
    ctx_token_user = _request_user_id.set(user_id)
    try:
        if not await _acquire_card(body.card_id):
            logger.warning("[KanbanImplement] Card already in progress — card_id=%r", body.card_id)
            raise HTTPException(
                status_code=409,
                detail="Card này đang được xử lý bởi người dùng khác. Vui lòng chờ.",
            )
        card_acquired = True
        return await _run_kanban_workflow(body, custom_instruction=custom_instruction)
    except ClaudeAIError as e:
        logger.error("[KanbanImplement] Claude AI error: %s - %s", e.error_code, e.message)
        raise HTTPException(
            status_code=400,
            detail={"error_code": e.error_code, "message": e.message},
        ) from e
    except RuntimeError as e:
        logger.error("[KanbanImplement] Claude CLI failed: %s", e)
        raise HTTPException(
            status_code=503,
            detail=f"Claude CLI không available: {str(e)}",
        ) from e
    except ValueError as e:
        logger.error("[KanbanImplement] Parse failed: %s", e)
        raise HTTPException(
            status_code=422,
            detail=f"Không thể phân tích response từ AI: {str(e)}",
        ) from e
    finally:
        if card_acquired:
            await _release_card(body.card_id)
        await _release_slot(user_id)
        _request_credentials.reset(ctx_token)
        _request_user_id.reset(ctx_token_user)

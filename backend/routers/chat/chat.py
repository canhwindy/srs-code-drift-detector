import json
import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from dependencies.claude_credentials import get_claude_credentials
from models.conversation import Conversation
from models.message import Message
from .chat_type import CreateConversationRequest, RenameConversationRequest, SendMessageRequest
from .chat_helper import _serialize_conversation, _serialize_message, parse_paragraphs_with_citations
from rag_state import (
    get_rag_for_workspace,
    _call_claude_cli_async,
    _request_credentials,
    _request_user_id,
    ClaudeAIError,
)
from lightrag import QueryParam
from lightrag_prompts import INLINE_CITATION_RAG_RESPONSE

logger = logging.getLogger(__name__)


router = APIRouter(prefix="/api", tags=["Chat"])


@router.post("/conversations")
async def create_conversation(
    body: CreateConversationRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    POST /api/conversations — Tạo một conversation mới.

    Body: { "title": "My conversation", "user_id": "...", "workspace_id": "..." }
    Returns: { id, title, preview, created_at, updated_at }
    """
    # BƯỚC 1: Tạo Conversation object với user_id và workspace_id
    conv = Conversation(
        title=body.title or "New conversation",
        user_id=body.user_id,
        workspace_id=body.workspace_id,
    )
    db.add(conv)

    # BƯỚC 2: Commit và refresh để lấy giá trị do DB/default sinh ra
    await db.commit()
    await db.refresh(conv)

    logger.info(f"[Chat] Created conversation: {conv.id} — '{conv.title}'")
    return _serialize_conversation(conv)


@router.get("/conversations")
async def list_conversations(request: Request, db: AsyncSession = Depends(get_db)):
    """
    GET /api/conversations — Lấy danh sách conversations của user trong workspace.

    Filter theo X-User-Key và X-Workspace-Id headers (forwarded từ Node.js proxy).
    Sắp xếp theo updated_at DESC (conversation có tin nhắn mới nhất lên đầu).
    Mỗi item kèm theo preview là 80 ký tự đầu của tin nhắn cuối cùng.

    Returns: { "conversations": [...] }
    """
    # Lấy user_id và workspace_id từ headers (forwarded bởi Node.js)
    user_id = request.headers.get("X-User-Key", "").strip()
    workspace_id = request.headers.get("X-Workspace-Id", "").strip()

    # BƯỚC 1: Query conversations của user trong workspace này, mới nhất lên đầu
    result = await db.execute(
        select(Conversation)
        .where(Conversation.user_id == user_id)
        .where(Conversation.workspace_id == workspace_id)
        .where(Conversation.is_deleted == False)  # noqa: E712
        .order_by(Conversation.updated_at.desc())
    )
    logger.info(f"======list_conversations Result: {result}")
    conversations = result.scalars().all()

    # BƯỚC 2: Với mỗi conversation, lấy tin nhắn cuối cùng làm preview
    items = []
    for conv in conversations:
        # Query 1 message gần nhất của conversation này
        last_msg_result = await db.execute(
            select(Message)
            .where(Message.conversation_id == conv.id)
            .order_by(Message.created_at.desc())
            .limit(1)
        )
        last_msg = last_msg_result.scalar_one_or_none()

        # Cắt 80 ký tự đầu làm preview, fallback về "" nếu chưa có message
        preview = (last_msg.content[:80] + "...") if last_msg and len(last_msg.content) > 80 \
            else (last_msg.content if last_msg else "")

        items.append(_serialize_conversation(conv, preview=preview))

    logger.info(f"[Chat] Listed {len(items)} conversations")
    return {"conversations": items}


@router.post("/conversations/{conversation_id}/messages")
async def send_message(
    conversation_id: str,
    body: SendMessageRequest,
    request: Request,
    credentials_json: str = Depends(get_claude_credentials),
    db: AsyncSession = Depends(get_db),
):
    """
    POST /api/conversations/{conversation_id}/messages

    Workflow:
        1. Kiểm tra conversation tồn tại trong DB
        2. Lưu user message vào DB
        3. Gọi LightRAG aquery() với Gemini để tạo AI response
        4. Lưu AI message vào DB
        5. Cập nhật conversation.updated_at để sort danh sách đúng
        6. Trả về cả 2 messages

    LightRAG Query Mode: "hybrid"
        - Kết hợp local search (entities gần câu hỏi)
          và global search (context toàn bộ knowledge graph)
        - Cho kết quả tốt nhất với câu hỏi về tài liệu đã upload

    Returns: { user_message: {...}, ai_message: {...} }
    """
    # ─────────────────────────────────────────────────────────
    # BƯỚC 1: Kiểm tra conversation tồn tại và thuộc về đúng user + workspace
    # ─────────────────────────────────────────────────────────
    req_user_id = request.headers.get("X-User-Key", "").strip()
    req_workspace_id = request.headers.get("X-Workspace-Id", "").strip()

    conv = await db.get(Conversation, conversation_id)
    if not conv or conv.user_id != req_user_id or conv.workspace_id != req_workspace_id or conv.is_deleted:
        raise HTTPException(status_code=404, detail="Not Found")

    # ─────────────────────────────────────────────────────────
    # BƯỚC 2: Lưu user message vào DB
    # ─────────────────────────────────────────────────────────
    # Lưu trước khi gọi LightRAG để đảm bảo user message không bị mất
    # ngay cả khi LightRAG query thất bại
    user_msg = Message(
        conversation_id=conversation_id,
        role="user",
        content=body.content,
    )
    db.add(user_msg)
    # Flush để sinh ID cho user_msg mà không commit hẳn
    # (commit sẽ thực hiện sau khi có AI response)
    await db.flush()
    logger.info(f"[Chat] User message staged — conv={conversation_id}")

    # ─────────────────────────────────────────────────────────
    # Fetch N messages gần nhất của conversation này (không tính message vừa flush)
    # để AI biết những gì đã nói trước → trả lời câu hỏi follow-up đúng.
    #
    # HISTORY_LIMIT = 20: Lấy tối đa 20 messages (10 cặp user+assistant).
    # Tăng từ 10 lên 20 để AI có better context cho follow-up questions.
    HISTORY_LIMIT = 20

    history_result = await db.execute(
        select(Message)
        # Chỉ lấy messages của conversation này
        .where(Message.conversation_id == conversation_id)
        # Bỏ qua message vừa flush (user_msg.id) — chưa commit nhưng đã có ID
        .where(Message.id != user_msg.id)
        # Sắp xếp DESC để lấy N cái mới nhất, sau đó reverse lại
        .order_by(Message.created_at.desc())
        .limit(HISTORY_LIMIT)
    )
    history_messages = history_result.scalars().all()
    # Đảo ngược: DB trả về mới → cũ, ta cần cũ → mới để đọc đúng thứ tự
    history_messages = list(reversed(history_messages))

    # Build chuỗi lịch sử hội thoại
    if history_messages:
        history_lines = []
        for m in history_messages:
            # Map role DB → nhãn dễ đọc cho Gemini
            role_label = "User" if m.role == "user" else "Assistant"
            history_lines.append(f"{role_label}: {m.content}")
        history_text = "\n".join(history_lines)

        # Ghép history + câu hỏi hiện tại thành full prompt
        full_query = (
            f"Conversation history:\n"
            f"{history_text}\n\n"
            f"Current question: {body.content}"
        )
        logger.info(
            f"[Chat] Built query with {len(history_messages)} history messages"
        )
    else:
        # Conversation mới, chưa có message nào → query trực tiếp
        full_query = body.content
        logger.info("[Chat] No history — querying directly")

    # ─────────────────────────────────────────────────────────
    # BƯỚC 3: Gọi LightRAG để tạo AI response
    # ─────────────────────────────────────────────────────────
    # Override rag.llm_model_func sang Claude CLI cho chat query
    rag = await get_rag_for_workspace(req_workspace_id)
    original_func = rag.llm_model_func
    rag.llm_model_func = _call_claude_cli_async

    # Set ContextVars — isolate per asyncio Task, không race condition với concurrent requests
    user_id = request.headers.get("X-User-Key", "").strip()
    ctx_token = _request_credentials.set(credentials_json)
    ctx_token_user = _request_user_id.set(user_id)
    try:
        logger.info(
            f"[Chat] Querying LightRAG — mode=hybrid, query='{body.content[:50]}...'"
        )

        # aquery_llm() trả về dict với:
        # - result["llm_response"]["content"]: text có inline [n] citations
        # - result["raw_data"]["data"]["chunks"]: list chunk với content, file_path, reference_id
        # system_prompt=INLINE_CITATION_RAG_RESPONSE: override prompt mặc định của LightRAG
        # để LLM đặt [n] INLINE trong từng câu thay vì chỉ ở cuối trong References section.
        result: dict = await rag.aquery_llm(
            full_query,
            param=QueryParam(mode="hybrid"),
            system_prompt=INLINE_CITATION_RAG_RESPONSE,
        )
        # print(f"======LightRAG aquery_llm Result: {result}")
        # Extract LLM response text
        llm_response: dict = result.get("llm_response", {})
        # print(f"======LightRAG aquery_llm llm_response: {llm_response}")
        ai_content: str = llm_response.get("content", "") or ""
        # print(f"======LightRAG aquery_llm ai_content: {ai_content}")
        # GUARD: LightRAG trả về empty → fallback message
        if not ai_content.strip():
            ai_content = (
                "Tôi không tìm thấy thông tin liên quan trong tài liệu đã upload. "
                "Hãy thử đặt câu hỏi theo cách khác hoặc upload thêm tài liệu."
            )
            paragraphs_list: list = []
        else:
            # Extract chunks từ raw_data để build citations
            # LightRAG aquery_llm() structure: result["raw_data"]["data"]["chunks"]
            # Fallback về result["data"]["chunks"] để tương thích các version khác
            raw_data_section: dict = result.get("raw_data", {})
            data_section: dict = raw_data_section.get("data", result.get("data", {}))
            chunks: list[dict] = data_section.get("chunks", [])
            logger.info(f"[Chat] Extracted {len(chunks)} chunks from aquery_llm result")
            # logger.info(f"[Chat] All chunks: {chunks}")
            # Parse LLM text + chunks → structured paragraphs với citations
            paragraphs_list = parse_paragraphs_with_citations(ai_content, chunks)

            logger.info(
                f"[Chat] LightRAG responded — length={len(ai_content)} chars, "
                f"paragraphs={len(paragraphs_list)}"
            )

    except ClaudeAIError as e:
        # ClaudeAIError: credential missing/expired hoặc CLIProxyAPI unavailable
        # Raise ngay — không lưu AI message vào DB
        logger.error(f"[Chat] Claude AI error: {e.error_code} - {e.message}")
        raise HTTPException(
            status_code=400,
            detail={"error_code": e.error_code, "message": e.message},
        ) from e

    except RuntimeError as e:
        # RuntimeError: rag_state.get_rag() gọi trước khi app startup hoàn tất
        logger.error(f"[Chat] RAG not ready: {e}")
        ai_content = "Hệ thống đang khởi động, vui lòng thử lại sau vài giây."
        paragraphs_list = []

    except Exception as e:
        # Exception khác: Neo4j, network, v.v.
        logger.error(f"[Chat] LightRAG query failed: {e}", exc_info=True)
        ai_content = (
            "Xin lỗi, đã xảy ra lỗi khi xử lý câu hỏi của bạn. "
            "Vui lòng thử lại."
        )
        paragraphs_list = []
    finally:
        rag.llm_model_func = original_func      # Restore về default sau khi query xong
        _request_credentials.reset(ctx_token)   # Cleanup ContextVars — tránh memory leak
        _request_user_id.reset(ctx_token_user)

    # ─────────────────────────────────────────────────────────────
    # BƯỚC 4: Lưu AI message vào DB (kèm paragraphs_json)
    # ─────────────────────────────────────────────────────────────
    ai_msg = Message(
        conversation_id=conversation_id,
        role="assistant",
        content=ai_content,
        # Serialize paragraphs thành JSON string để lưu vào TEXT column
        # None nếu không parse được (không có citations)
        paragraphs_json=json.dumps(paragraphs_list, ensure_ascii=False)
        if paragraphs_list
        else None,
    )
    
    db.add(ai_msg)

    # ─────────────────────────────────────────────────────────
    # BƯỚC 5: Cập nhật updated_at của conversation
    # ─────────────────────────────────────────────────────────
    # Dùng để sort danh sách: conversation có message mới lên đầu
    conv.updated_at = datetime.utcnow()

    # ─────────────────────────────────────────────────────────
    # BƯỚC 6: Commit tất cả thay đổi trong một transaction
    # ─────────────────────────────────────────────────────────
    # Nếu commit thành công: cả user_msg và ai_msg được lưu vào DB
    # Nếu commit thất bại: cả 2 bị rollback (tính nhất quán)
    await db.commit()
    await db.refresh(user_msg)
    await db.refresh(ai_msg)

    logger.info(
        f"[Chat] Transaction committed — "
        f"conv={conversation_id}, user={user_msg.id}, ai={ai_msg.id}"
    )

    # ─────────────────────────────────────────────────────────
    # BƯỚC 7: Trả về response cho frontend
    # ─────────────────────────────────────────────────────────
    return {
        "user_message": _serialize_message(user_msg),
        "ai_message": _serialize_message(ai_msg),
    }


@router.get("/conversations/{conversation_id}/messages")
async def get_messages(
    conversation_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    GET /api/conversations/{conversation_id}/messages

    Lấy toàn bộ messages của một conversation, sắp xếp theo thời gian tạo ASC
    (tin nhắn cũ nhất hiển thị đầu, mới nhất hiển thị cuối — giống mọi chat app).

    Returns: { "messages": [...] }
    """
    # Kiểm tra conversation tồn tại và thuộc về đúng user + workspace
    req_user_id = request.headers.get("X-User-Key", "").strip()
    req_workspace_id = request.headers.get("X-Workspace-Id", "").strip()
    conv = await db.get(Conversation, conversation_id)
    if not conv or conv.user_id != req_user_id or conv.workspace_id != req_workspace_id or conv.is_deleted:
        raise HTTPException(status_code=404, detail="Not Found")

    # Query messages, sắp xếp ASC để hiển thị đúng thứ tự
    result = await db.execute(
        select(Message)
        .where(Message.conversation_id == conversation_id)
        .order_by(Message.created_at.asc())
    )
    messages = result.scalars().all()

    logger.info(
        f"[Chat] Loaded {len(messages)} messages for conv={conversation_id}")

    return {"messages": [_serialize_message(m) for m in messages]}


@router.patch("/conversations/{conversation_id}")
async def rename_conversation(
    conversation_id: str,
    body: RenameConversationRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    PATCH /api/conversations/{conversation_id} — Đổi tên conversation.

    Body: { "title": "Tên mới của conversation" }
    Returns: { id, title, preview, created_at, updated_at }

    HTTP 404 nếu conversation_id không tồn tại hoặc không thuộc user/workspace.
    """
    # BƯỚC 1: Kiểm tra conversation tồn tại và thuộc về đúng user + workspace
    req_user_id = request.headers.get("X-User-Key", "").strip()
    req_workspace_id = request.headers.get("X-Workspace-Id", "").strip()
    conv = await db.get(Conversation, conversation_id)
    if not conv or conv.user_id != req_user_id or conv.workspace_id != req_workspace_id or conv.is_deleted:
        raise HTTPException(status_code=404, detail="Not Found")

    # BƯỚC 2: Cập nhật title
    # Trim whitespace để tránh lưu tên có khoảng trắng thừa
    conv.title = body.title.strip() or "New conversation"

    # BƯỚC 3: Commit vào DB và refresh để lấy giá trị mới nhất
    await db.commit()
    await db.refresh(conv)

    logger.info(
        f"[Chat] Renamed conversation {conversation_id} → '{conv.title}'")

    # BƯỚC 4: Trả về conversation đã được cập nhật
    # _serialize_conversation() đã có sẵn, tái sử dụng luôn
    return _serialize_conversation(conv)


@router.delete("/conversations/{conversation_id}", status_code=200)
async def delete_conversation(
    conversation_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    DELETE /api/conversations/{conversation_id}

    Xóa một conversation và toàn bộ messages của nó khỏi database.

    - HTTP 404 nếu conversation_id không tồn tại hoặc không thuộc user/workspace
    - HTTP 200 + { "deleted": true, "id": "..." } nếu thành công

    Returns: { "deleted": true, "id": conversation_id }
    """
    # BƯỚC 1: Kiểm tra conversation tồn tại và thuộc về đúng user + workspace
    req_user_id = request.headers.get("X-User-Key", "").strip()
    req_workspace_id = request.headers.get("X-Workspace-Id", "").strip()
    conv = await db.get(Conversation, conversation_id)
    if not conv or conv.user_id != req_user_id or conv.workspace_id != req_workspace_id or conv.is_deleted:
        raise HTTPException(status_code=404, detail="Not Found")

    # BƯỚC 2: Xóa tất cả messages của conversation trước
    # (tránh lỗi foreign key constraint nếu DB không có cascade)
    from sqlalchemy import delete as sql_delete
    await db.execute(
        sql_delete(Message).where(Message.conversation_id == conversation_id)
    )

    # BƯỚC 3: Xóa conversation khỏi DB
    await db.delete(conv)

    # BƯỚC 4: Commit transaction — cả messages lẫn conversation bị xóa cùng lúc
    await db.commit()

    logger.info(f"[Chat] Deleted conversation {conversation_id}")

    # BƯỚC 5: Trả về confirmation cho frontend
    return {"deleted": True, "id": conversation_id}

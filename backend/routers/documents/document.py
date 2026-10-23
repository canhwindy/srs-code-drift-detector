import asyncio
import logging
from fastapi import APIRouter, HTTPException, BackgroundTasks, Request
from lightrag.base import DocStatus
from lightrag.kg.shared_storage import get_namespace_data
from rag_state import get_rag_for_workspace, acquire_workspace_lock, release_workspace_lock, check_workspace_lock, _call_gemini_async
from routers.documents.document_helper import background_delete_documents
from routers.documents.document_type import DeleteDocumentsRequest
from lightrag_helpers import pipeline_enqueue_file
from lightrag_extended import ExtendedLightRAG



logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["Documents"])


async def _is_pipeline_busy() -> bool:
    """
    Check if LightRAG pipeline is currently processing documents.

    Reads the shared pipeline_status namespace set by apipeline_process_enqueue_documents().
    Returns False (not busy) if the namespace is not yet initialized.
    """
    try:
        pipeline_status = await get_namespace_data("pipeline_status")
        return bool(pipeline_status.get("busy", False))
    except Exception:
        return True  # Fail-safe: assume busy if state cannot be read


async def run_scan_process(rag: ExtendedLightRAG) -> None:
    """
    Background task: retry PENDING / FAILED / PROCESSING documents.

    After the PostgreSQL migration, all new documents enter exclusively
    via POST /api/upload-document, which enqueues them immediately.
    There is no input_document/ directory to scan for "new" files.

    This function's purpose is now:
      1. Log the current doc_status counts (for observability)
      2. Call apipeline_process_enqueue_documents() to retry any doc
         that is stuck in PENDING, FAILED, or PROCESSING state

    LightRAG reads document content from lightrag_kv_full_docs (PostgreSQL)
    when retrying — no original files needed.
    """
    try:
        from lightrag.base import DocStatus

        # ── STEP 1: Load and log current doc statuses ──────────────
        all_docs, total = await rag.doc_status.get_docs_paginated(
            status_filter=None,
            page=1,
            page_size=10000,
            sort_field="updated_at",
            sort_direction="desc",
        )

        # Count by status for observability
        status_counts: dict[str, int] = {}
        for _, doc in all_docs:
            status_str = doc.status.value if hasattr(doc.status, "value") else str(doc.status)
            status_counts[status_str] = status_counts.get(status_str, 0) + 1

        logger.info(f"Doc status summary (total={total}): {status_counts}")

        non_processed = sum(
            count for status, count in status_counts.items()
            if status != DocStatus.PROCESSED.value
        )

        if non_processed == 0:
            logger.info("All documents already processed — nothing to retry")
            return

        logger.info(f"Retrying {non_processed} non-processed document(s)...")

        # ── STEP 2: Retry PENDING / FAILED / PROCESSING ────────────
        # Override llm_model_func sang Gemini (giống upload path) để
        # entity extraction dùng Gemini thay vì Claude CLI mặc định.
        original_func = rag.llm_model_func
        rag.llm_model_func = _call_gemini_async
        try:
            await rag.apipeline_process_enqueue_documents()
            logger.info("Retry process completed")
        finally:
            rag.llm_model_func = original_func  # Restore sau khi retry xong

    except Exception as e:
        logger.error(f"run_scan_process error: {e!r}")
        import traceback
        logger.error(traceback.format_exc())

@router.post("/documents/scan")
async def scan_documents(request: Request, background_tasks: BackgroundTasks):
    """
    Scan input_document/ directory and reprocess non-processed documents.

    ═══════════════════════════════════════════════════════════
    📋 PURPOSE:
    ═══════════════════════════════════════════════════════════
    - Detects new files in INPUT_DIR not yet in the knowledge graph
    - Re-triggers processing for documents stuck in PENDING / FAILED / PROCESSING
    - Returns immediately; processing happens in a FastAPI background task

    ═══════════════════════════════════════════════════════════
    ⚠️ RACE CONDITION HANDLING:
    ═══════════════════════════════════════════════════════════
    Checks lightrag_extended pipeline_status.busy before starting.
    If pipeline is already running → returns status="busy" immediately.
    The running pipeline WILL automatically pick up pending/failed docs when
    the current batch finishes, so no action is needed from the user.

    ═══════════════════════════════════════════════════════════
    📤 RESPONSES:
    ═══════════════════════════════════════════════════════════
    { "status": "scanning_started", "message": "..." }
    { "status": "busy",             "message": "..." }
    """
    workspace_id = request.headers.get("X-Workspace-Id", "").strip()
    if not workspace_id:
        raise HTTPException(400, "Missing X-Workspace-Id header")

    if await _is_pipeline_busy():
        logger.info("⚠️  Scan requested but pipeline is busy — returning busy status")
        return {
            "status": "busy",
            "message": (
                "Pipeline is currently processing documents. "
                "It will automatically retry any pending or failed documents "
                "when the current batch finishes."
            ),
        }

    if not await acquire_workspace_lock(workspace_id, "indexing"):
        raise HTTPException(429, detail="Workspace busy with another operation")

    rag = await get_rag_for_workspace(workspace_id)

    async def _scan_with_lock_release():
        try:
            await run_scan_process(rag)
        finally:
            release_workspace_lock(workspace_id)

    background_tasks.add_task(_scan_with_lock_release)
    logger.info("🔍 Scan/Retry background task registered for workspace %s", workspace_id)
    return {
        "status": "scanning_started",
        "message": (
            "Scanning and reprocessing non-processed documents "
            "in the background. The document list will update as files are indexed."
        ),
    }

@router.delete("/documents/delete")
async def delete_documents(
    request: Request,
    body: DeleteDocumentsRequest = None,
    background_tasks: BackgroundTasks = None,
):
    """
    Xóa một hoặc nhiều documents (async background).

    ═══════════════════════════════════════════════════════════
    📋 PURPOSE:
    ═══════════════════════════════════════════════════════════
    Nhận danh sách doc_ids → đăng ký background task → return ngay.
    Không block HTTP connection — deletion chạy ở nền.

    ═══════════════════════════════════════════════════════════
    📥 REQUEST BODY:
    ═══════════════════════════════════════════════════════════
    {
      "doc_ids": ["doc-d062a9e8ac8c570e401e2b88b147c644"],
      "delete_file": true
    }

    ═══════════════════════════════════════════════════════════
    📤 RESPONSE (immediate — trước khi xóa xong):
    ═══════════════════════════════════════════════════════════
    {
      "status": "deletion_started",
      "message": "Deletion of 2 document(s) started in background",
      "doc_ids": ["doc-abc...", "doc-xyz..."]
    }

    ═══════════════════════════════════════════════════════════
    ⚠️ LƯU Ý QUAN TRỌNG:
    ═══════════════════════════════════════════════════════════
    "deletion_started" KHÔNG có nghĩa là đã xóa xong!
    Frontend phải poll GET /api/documents mỗi 2s để theo dõi.
    """
    workspace_id = request.headers.get("X-Workspace-Id", "").strip()
    if not workspace_id:
        raise HTTPException(400, "Missing X-Workspace-Id header")

    try:
        # Validate: kiểm tra doc_ids không rỗng
        if not body.doc_ids:
            raise HTTPException(status_code=400, detail="doc_ids cannot be empty")

        if await _is_pipeline_busy():
            logger.warning("⚠️ Cannot delete — pipeline is currently processing")
            return {
                "status": "busy",
                "message": (
                    "Pipeline is currently processing documents. "
                    "Please wait for indexing to complete before deleting."
                ),
                "doc_ids": [],
            }

        if not await acquire_workspace_lock(workspace_id, "indexing"):
            raise HTTPException(429, detail="Workspace busy with another operation")

        rag = await get_rag_for_workspace(workspace_id)

        logger.info(f"📥 Delete request: {len(body.doc_ids)} doc(s), delete_file={body.delete_file}")

        async def _delete_with_lock_release():
            try:
                await background_delete_documents(rag, body.doc_ids, body.delete_file)
            finally:
                release_workspace_lock(workspace_id)

        background_tasks.add_task(_delete_with_lock_release)

        logger.info(f"✅ Background delete task registered for {len(body.doc_ids)} doc(s)")

        return {
            "status": "deletion_started",
            "message": f"Deletion of {len(body.doc_ids)} document(s) started in background",
            "doc_ids": body.doc_ids,
        }

    except HTTPException:
        raise
    except Exception as e:
        release_workspace_lock(workspace_id)
        logger.error(f"❌ Delete endpoint error: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))
    


@router.delete("/documents/clear")
async def clear_all_documents(request: Request):
    """
    Xóa tất cả documents — reset hoàn toàn knowledge base.

    ═══════════════════════════════════════════════════════════
    📋 PURPOSE:
    ═══════════════════════════════════════════════════════════
    Drop song song tất cả 11 LightRAG storages thay vì loop
    adelete_by_doc_id() từng doc. Nhanh hơn nhiều (O(1) vs O(n)).
    Đây là đúng theo LightRAG origin implementation.

    ═══════════════════════════════════════════════════════════
    📥 REQUEST:
    ═══════════════════════════════════════════════════════════
    DELETE /api/documents/clear  (không có body)

    ═══════════════════════════════════════════════════════════
    📤 RESPONSE (sau khi xóa xong — blocking):
    ═══════════════════════════════════════════════════════════
    {
      "status": "success",
      "message": "All 11 storages cleared and 4 files deleted",
      "total_deleted": 11
    }

    ═══════════════════════════════════════════════════════════
    🗄️ STORAGES BỊ DROP:
    ═══════════════════════════════════════════════════════════
    rag.text_chunks          → kv_store_text_chunks.json
    rag.full_docs            → kv_store_full_docs.json
    rag.full_entities        → kv_store_full_entities.json
    rag.full_relations       → kv_store_full_relations.json
    rag.entity_chunks        → kv_store_entity_chunks.json
    rag.relation_chunks      → kv_store_relation_chunks.json
    rag.entities_vdb         → vdb_entities_*.json
    rag.relationships_vdb    → vdb_relationships_*.json
    rag.chunks_vdb           → vdb_chunks_*.json
    rag.chunk_entity_relation_graph → Neo4j (xóa toàn bộ nodes + edges)
    rag.doc_status           → kv_store_doc_status.json
    """
    workspace_id = request.headers.get("X-Workspace-Id", "").strip()
    if not workspace_id:
        raise HTTPException(400, "Missing X-Workspace-Id header")

    if not await acquire_workspace_lock(workspace_id, "indexing"):
        raise HTTPException(429, detail="Workspace busy with another operation")

    try:
        rag = await get_rag_for_workspace(workspace_id)

        # ─────────────────────────────────────────────────────
        # STEP 1: Định nghĩa tất cả 11 storages cần drop
        # ─────────────────────────────────────────────────────
        # getattr với default None để an toàn nếu LightRAG version khác nhau
        storage_attrs = [
            'text_chunks',               # Text chunks KV store
            'full_docs',                 # Full document content
            'full_entities',             # Extracted entities
            'full_relations',            # Extracted relations
            'entity_chunks',             # Entity-to-chunk mappings
            'relation_chunks',           # Relation-to-chunk mappings
            'entities_vdb',              # Entity vector embeddings
            'relationships_vdb',         # Relation vector embeddings
            'chunks_vdb',                # Chunk vector embeddings
            'chunk_entity_relation_graph', # Knowledge Graph (Neo4j)
            'doc_status',                # Document processing status
        ]

        # Chỉ drop những storage thực sự tồn tại và có method drop()
        storages_to_drop = []
        for attr in storage_attrs:
            storage = getattr(rag, attr, None)
            if storage is not None and hasattr(storage, 'drop'):
                storages_to_drop.append((attr, storage))
            else:
                logger.warning(f"⚠️ Storage '{attr}' not found or has no drop() method")

        logger.info(f"🗑️ Dropping {len(storages_to_drop)} storages concurrently...")

        # ─────────────────────────────────────────────────────
        # STEP 2: Drop tất cả storages song song (asyncio.gather)
        # ─────────────────────────────────────────────────────
        # asyncio.gather() chạy tất cả coroutines đồng thời
        # return_exceptions=True: lỗi ở 1 storage không cancel cái khác
        async def drop_storage(name: str, storage):
            try:
                await storage.drop()
                logger.info(f"  ✅ Dropped: {name}")
                return True
            except Exception as e:
                logger.error(f"  ❌ Failed to drop {name}: {e}")
                return False

        # Chạy song song tất cả drop operations
        results = await asyncio.gather(
            *[drop_storage(name, storage) for name, storage in storages_to_drop],
            return_exceptions=True,
        )

        # Đếm số storage drop thành công
        success_count = sum(1 for r in results if r is True)
        fail_count = len(results) - success_count

        logger.info(f"📊 Drop complete: {success_count} success, {fail_count} failed")

        # # ─────────────────────────────────────────────────────
        # # STEP 3: Xóa tất cả files vật lý trong input_document/
        # # ─────────────────────────────────────────────────────
        # cleared_files = 0
        # for physical_file in INPUT_DIR.iterdir():
        #     if physical_file.is_file():  # Không xóa subdir
        #         try:
        #             physical_file.unlink()
        #             cleared_files += 1
        #             logger.info(f"🗑️ Deleted file: {physical_file.name}")
        #         except Exception as e:
        #             logger.error(f"❌ Failed to delete file {physical_file.name}: {e}")

        # logger.info(f"📊 Clear complete: {success_count} storages, {cleared_files} files deleted")

        # ─────────────────────────────────────────────────────
        # STEP 4: Return kết quả
        # ─────────────────────────────────────────────────────
        # Xác định status dựa trên số storage drop thành công
        if fail_count == 0:
            status = "success"
            #message = f"All {success_count} storages cleared and {cleared_files} file(s) deleted"
            message = f"All {success_count} storages cleared from PostgreSQL"

        else:
            status = "partial_success"
            # message = f"{success_count}/{len(storages_to_drop)} storages cleared, {fail_count} failed. {cleared_files} file(s) deleted"
            message = f"{success_count}/{len(storages_to_drop)} storages cleared, {fail_count} failed"

        return {
            "status": status,
            "message": message,
            "total_deleted": success_count,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Clear endpoint error: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        release_workspace_lock(workspace_id)


@router.get("/pipeline/status")
async def get_pipeline_status(request: Request):
    """
    Return actual pipeline busy state (in-memory RAM flag only).

    busy resets to False on server restart by design — prevents dead lock.
    Docs stuck in PENDING after crash → busy=False → frontend unblocks buttons.
    Frontend polls this every 3s to gate Delete/Clear buttons.
    """
    workspace_id = request.headers.get("X-Workspace-Id", "").strip()
    if not workspace_id:
        raise HTTPException(400, "Missing X-Workspace-Id header")

    # Check workspace lock (more reliable cross-workspace indicator)
    lock_error = await check_workspace_lock(workspace_id)
    if lock_error:
        return {
            "busy": True,
            "job_name": lock_error.get("operation", "unknown"),
            "cur_batch": 0,
            "batchs": 0,
            "workspace_locked": True,
        }

    try:
        pipeline_status = await get_namespace_data("pipeline_status")
        return {
            "busy": bool(pipeline_status.get("busy", False)),
            "job_name": pipeline_status.get("job_name", "-"),
            "cur_batch": pipeline_status.get("cur_batch", 0),
            "batchs": pipeline_status.get("batchs", 0),
        }
    except Exception:
        return {"busy": False, "job_name": "-", "cur_batch": 0, "batchs": 0}
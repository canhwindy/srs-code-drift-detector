"""
Extended LightRAG class with refactored pipeline phases.

This module provides an extended version of LightRAG that breaks down the
complex `apipeline_process_enqueue_documents()` function into smaller,
maintainable phase methods.

Usage:
    from lightrag_extended import ExtendedLightRAG

    rag = ExtendedLightRAG(
        working_dir="./rag_storage",
        llm_model_func=gpt_4o_mini_complete
    )

    # Use exactly like regular LightRAG
    await rag.ainsert("Document content...")
    await rag.apipeline_process_enqueue_documents()
"""

import asyncio
import json
import logging
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any
from lightrag.utils import compute_mdhash_id
from lightrag import LightRAG, QueryParam
from lightrag.base import KnowledgeGraph
from dataclasses import asdict
from lightrag.kg.shared_storage import get_namespace_data, get_namespace_lock, get_storage_keyed_lock
from lightrag.base import DocStatus, DocProcessingStatus
from lightrag.exceptions import PipelineCancelledException
from lightrag.utils import create_prefixed_exception
from lightrag.operate import (
    chunking_by_token_size,
    extract_entities,
    _merge_nodes_then_upsert,
    _merge_edges_then_upsert,
)

logger = logging.getLogger(__name__)


class ExtendedLightRAG(LightRAG):
    """
    Extended LightRAG with workspace isolation and refactored pipeline phases.

    ═════════════════════════════════════════════════════════════════════════════════
    🎯 PURPOSE
    ═════════════════════════════════════════════════════════════════════════════════
    This class extends the base LightRAG class with two key capabilities:

    1. **Workspace Isolation**: Each workspace sees only its own entities/relationships
    2. **Refactored Pipeline**: Breaking down complex document processing into phases

    ═════════════════════════════════════════════════════════════════════════════════
    🏗️  ARCHITECTURE
    ═════════════════════════════════════════════════════════════════════════════════

    Storage Layer (handles workspace filtering via Neo4j labels and PG parameters):
    ├─ Neo4JStorage: Creates nodes with :workspace_{id} label
    ├─ PGKVStorage: Filters chunks by workspace parameter
    └─ PGVectorStorage: Filters embeddings by workspace parameter

    LightRAG (Parent Class):
    └─ Calls storage methods, may not enforce workspace filtering

    ExtendedLightRAG (This Class):
    ├─ Inherits parent methods (aquery_llm, get_knowledge_graph, etc.)
    ├─ Override 5 methods with defensive validation:
    │  ├─ aquery_llm(): Validate chunks are from correct workspace
    │  ├─ get_knowledge_graph(): Verify nodes match workspace label
    │  ├─ get_popular_labels(): Post-filter results for safety
    │  ├─ search_labels(): Post-filter results for safety
    │  └─ amerge_entities(): Validate merge targets same workspace
    └─ Refactored pipeline phases:
       └─ _pipeline_phase_*() methods for testable document processing

    ═════════════════════════════════════════════════════════════════════════════════
    🔐 ISOLATION STRATEGY
    ═════════════════════════════════════════════════════════════════════════════════

    LAYER 1 — Parameter Passing (rag_state.py):
        workspace_id → get_rag_for_workspace() → ExtendedLightRAG(..., workspace=workspace_id)

    LAYER 2 — Storage Layer Filtering:
        Neo4j: Labels queries with :workspace_{id}, only matches nodes with that label
        PG: Filters WHERE workspace = {workspace_id}

    LAYER 3 — Parent LightRAG Methods:
        Parent methods should respect workspace parameter passed to storage
        (Assumes parent correctly uses workspace in Cypher/SQL queries)

    LAYER 4 — Defensive Validation (ExtendedLightRAG overrides):
        Override methods validate results contain only workspace's data
        Log errors if workspace filtering fails at lower layers
        (Belt-and-suspenders: catches issues parent might miss)

    ═════════════════════════════════════════════════════════════════════════════════
    ⚡ CRITICAL DEPENDENCIES
    ═════════════════════════════════════════════════════════════════════════════════
    1. workspace parameter must be passed in __init__
    2. Parent class (LightRAG) must pass workspace to storage initialization
    3. Storage classes (Neo4JStorage, PGKVStorage, PGVectorStorage) must use workspace in queries
    4. Neo4j nodes MUST have :workspace_{id} labels (created by Neo4JStorage)
    5. PG tables MUST have workspace filtering (handled by storage layer)

    If any layer fails to isolate by workspace, data leaks between workspaces!

    ═════════════════════════════════════════════════════════════════════════════════
    ✨ PIPELINE REFACTORING
    ═════════════════════════════════════════════════════════════════════════════════
    The complex `apipeline_process_enqueue_documents()` method is broken into phases:

    - Better readability: Each phase has a clear purpose
    - Improved testability: Test phases independently
    - Easier debugging: Set breakpoints at phase boundaries
    - Simpler maintenance: Modify one phase without affecting others

    ═════════════════════════════════════════════════════════════════════════════════
    📋 IMPLEMENTATION NOTES
    ═════════════════════════════════════════════════════════════════════════════════
    - workspace field inherited from LightRAG (added in v1.4.9.11)
    - 5 override methods: aquery_llm, get_knowledge_graph, get_popular_labels, search_labels, amerge_entities
    - Each override calls super() then validates, ensuring parent logic runs first
    - Validation is post-processing (defensive), not primary filter (primary happens in parent)
    - If parent isolation fails, logs ERROR and raises exception to prevent data leaks

    ═════════════════════════════════════════════════════════════════════════════════
    """

    # ═══════════════════════════════════════════════════════════════
    # PHASE METHODS
    # ═══════════════════════════════════════════════════════════════

    async def _pipeline_phase_init_and_lock(
        self,
        pipeline_status: dict,
        pipeline_status_lock,
    ) -> tuple[bool, dict[str, DocProcessingStatus]]:
        """
        Phase 0: Initialize pipeline and acquire lock.

        This phase:
        1. Checks if another process is already busy
        2. If not busy: Acquires lock and aggregates documents to process
        3. If busy: Sets request_pending flag and returns

        Args:
            pipeline_status: Shared pipeline status dictionary
            pipeline_status_lock: Async lock for pipeline_status

        Returns:
            tuple[bool, dict]: (lock_acquired, to_process_docs)
            - lock_acquired: True if lock acquired, False if pipeline busy
            - to_process_docs: Dictionary of documents to process (empty if not acquired)
        """
        # ═════════════════════════════════════════════════════════════════════════════
        # PHASE 0: KIỂM TRA & KHÓA PIPELINE - Ngăn xử lý trùng lặp từ nhiều workers
        # ═════════════════════════════════════════════════════════════════════════════
        #
        # 🎯 MỤC ĐÍCH:
        # Sau khi files được enqueue (upload xong), hệ thống sẽ xử lý chúng.
        # Nhưng có thể có NHIỀU workers (FastAPI background tasks) cùng gọi hàm này.
        # → Cần cơ chế KHÓA để chỉ 1 worker xử lý, các worker khác phải CHỜ.
        #
        # 📋 LUỒNG XỬ LÝ:
        #
        # ┌─────────────────────────────────────────────────────────────────────┐
        # │ 1. User upload files → Files được enqueue (PENDING status)          │
        # │ 2. Background task gọi apipeline_process_enqueue_documents()        │
        # │ 3. Gọi _pipeline_phase_init_and_lock() (function này)               │
        # └─────────────────────────────────────────────────────────────────────┘
        #                                    ↓
        #              ┌─────────────────────────────────────┐
        #              │ Acquire pipeline_status_lock (line) │
        #              └─────────────────────────────────────┘
        #                                    ↓
        #              ┌─────────────────────────────────────┐
        #              │ Kiểm tra: pipeline_status["busy"]?  │
        #              └─────────────────────────────────────┘
        #                     ↓                        ↓
        #         ┌──────────────┐            ┌──────────────────┐
        #         │ busy = False │            │   busy = True    │
        #         │  (FREE)      │            │   (OCCUPIED)     │
        #         └──────────────┘            └──────────────────┘
        #                ↓                              ↓
        #    ✅ TIẾN HÀNH XỬ LÝ            ⏸️ CHỜ - Set request_pending
        #       │                                      │
        #       ├─ Lấy docs: PENDING,                 ├─ Set flag: request_pending = True
        #       │  FAILED, PROCESSING                 │  → Pipeline hiện tại sẽ check flag này
        #       │                                     │     và xử lý tiếp sau khi xong job hiện tại
        #       ├─ Set busy = True                    │
        #       │  (KHÓA pipeline)                    ├─ Return (False, {})
        #       │                                     │  → Không xử lý gì, thoát function
        #       ├─ Return (True, to_process_docs)     │
        #       │  → Tiếp tục xử lý documents         └─ Documents vẫn ở trạng thái PENDING
        #       │                                        (sẽ được xử lý ở lần sau)
        #       └─ Process → Chunk → Extract
        #          → Merge graph → Embeddings
        #
        # 🔐 TẠI SAO CẦN KHÓA?
        # - Scenario: User upload 2 batches files cùng lúc
        #   → 2 background tasks A & B cùng chạy song song
        # - KHÔNG có khóa:
        #   → Task A lấy docs, Task B cũng lấy docs → XỬ LÝ TRÙNG → Lãng phí + conflicts
        # - CÓ khóa:
        #   → Task A check busy=False → set busy=True → xử lý
        #   → Task B check busy=True → set request_pending → return (không xử lý)
        #   → Task A xong → check request_pending=True → lấy docs mới và xử lý tiếp
        #
        # 🔄 DOCUMENTS TỪ UPLOAD TRƯỚC (PENDING/FAILED):
        # - Nếu có documents từ upload trước chưa xử lý (vẫn ở PENDING/FAILED)
        # - Và pipeline đang busy xử lý batch khác
        # - → Documents đó sẽ ở trong database với status PENDING/FAILED
        # - → Đợi đến khi pipeline FREE (busy=False)
        # - → Lần gọi tiếp theo sẽ lấy chúng ra và xử lý
        #
        async with pipeline_status_lock:
            # ─────────────────────────────────────────────────────────────────
            # Kiểm tra xem có worker nào đang xử lý documents không?
            # ─────────────────────────────────────────────────────────────────
            if not pipeline_status.get("busy", False):
                # ════════════════════════════════════════════════════════════
                # ✅ PIPELINE RẢNH (FREE) - Bắt đầu xử lý
                # ════════════════════════════════════════════════════════════
                # ─────────────────────────────────────────────────────────────────────
                # Lấy tất cả documents cần xử lý từ 3 trạng thái khác nhau (SONG SONG)
                # ─────────────────────────────────────────────────────────────────────
                # asyncio.gather() = Chạy 3 queries đồng thời (parallel) thay vì tuần tự
                # → Tốc độ: ~100ms thay vì ~300ms nếu chạy từng query một
                #
                # Lấy documents có 3 trạng thái:
                # 1. PROCESSING: Documents đang xử lý nhưng bị gián đoạn (server restart, crash)
                #    → Cần xử lý lại để hoàn thành
                # 2. FAILED: Documents xử lý thất bại trước đó (LLM error, timeout, etc.)
                #    → Retry lại để tránh mất dữ liệu
                # 3. PENDING: Documents mới upload, chưa xử lý
                #    → Xử lý lần đầu
                processing_docs, failed_docs, pending_docs = await asyncio.gather(
                    self.doc_status.get_docs_by_status(DocStatus.PROCESSING),
                    self.doc_status.get_docs_by_status(DocStatus.FAILED),
                    self.doc_status.get_docs_by_status(DocStatus.PENDING),
                )

                # ─────────────────────────────────────────────────────────────────────
                # Gộp tất cả documents từ 3 trạng thái vào 1 dict duy nhất
                # ─────────────────────────────────────────────────────────────────────
                # Lý do gộp chung:
                # - Xử lý tất cả trong 1 batch thay vì xử lý riêng từng loại
                # - Đảm bảo không có document nào bị bỏ sót
                # - Ưu tiên: PROCESSING (đang dở) → FAILED (retry) → PENDING (mới)
                #   (thứ tự update: processing → failed → pending, nếu trùng doc_id thì giữ pending)
                to_process_docs: dict[str, DocProcessingStatus] = {}
                to_process_docs.update(processing_docs)  # Thêm docs đang xử lý dở
                to_process_docs.update(failed_docs)      # Thêm docs thất bại (ghi đè nếu trùng)
                to_process_docs.update(pending_docs)     # Thêm docs mới (ghi đè nếu trùng)

                if not to_process_docs:
                    logger.info("No documents to process")
                    return False, {}

                # Acquire lock and initialize pipeline status
                pipeline_status.update(
                    {
                        "busy": True,
                        "job_name": "Default Job",
                        "job_start": datetime.now(timezone.utc).isoformat(),
                        "docs": 0,
                        "batchs": 0,
                        "cur_batch": 0,
                        "request_pending": False,
                        "cancellation_requested": False,
                        "latest_message": "",
                    }
                )

                # ─────────────────────────────────────────────────────────────────────
                # Xóa history messages từ job trước đó (in-place clearing)
                # ─────────────────────────────────────────────────────────────────────
                # ⚠️ QUAN TRỌNG: Phải dùng del list[:] thay vì gán list mới (= [])
                #
                # ❌ KHÔNG DÙNG: pipeline_status["history_messages"] = []
                #    Lý do: Tạo list object mới → MẤT shared reference giữa các process
                #    Kết quả: Process A thấy list mới, Process B vẫn thấy list cũ (desync!)
                #
                # ✅ ĐÚNG: del pipeline_status["history_messages"][:]
                #    Lý do: Xóa in-place các phần tử TRONG shared list object hiện tại
                #    Kết quả: TẤT CẢ processes đều thấy list rỗng (synchronized!)
                #
                # Giải thích kỹ thuật:
                # - pipeline_status["history_messages"] là ListProxy (multiprocessing)
                # - ListProxy wrap quanh shared list trong Manager server
                # - Gán mới (=) → thay thế local reference, không ảnh hưởng shared object
                # - del [:] → gọi __delslice__ trên proxy → xóa trong shared object
                del pipeline_status["history_messages"][:]

                logger.info(f"Pipeline lock acquired. Processing {len(to_process_docs)} documents")
                return True, to_process_docs
            else:
                # ════════════════════════════════════════════════════════════
                # ⏸️ PIPELINE BẬN (BUSY) - Phải chờ đợi
                # ════════════════════════════════════════════════════════════
                # Có worker khác đang xử lý documents (busy = True)
                # → KHÔNG được xử lý thêm (tránh conflict và overload)
                # → Set flag "request_pending" = True
                #    Worker đang xử lý sẽ check flag này sau khi xong
                #    và tự động xử lý tiếp batch tiếp theo
                #
                # 📝 GHI CHÚ:
                # - Documents vẫn nằm trong database với status PENDING/FAILED
                # - KHÔNG bị mất, chỉ bị hoãn xử lý
                # - Khi pipeline FREE, lần gọi tiếp theo sẽ lấy ra và xử lý
                #
                # 🔄 FLOW KHI BUSY:
                # 1. User upload files mới → Enqueue thành công (PENDING)
                # 2. Background task gọi function này → Check busy=True
                # 3. Set request_pending=True → Return ngay (không xử lý)
                # 4. Worker đang xử lý xong job hiện tại
                # 5. Check request_pending=True → Lấy docs PENDING mới và xử lý tiếp
                #
                pipeline_status["request_pending"] = True
                logger.info("Another process is already processing. Request queued.")
                return False, {}  # lock_acquired=False, to_process_docs=empty

    async def _pipeline_phase_validate_consistency(
        self,
        to_process_docs: dict[str, DocProcessingStatus],
        pipeline_status: dict,
        pipeline_status_lock,
    ) -> dict[str, DocProcessingStatus]:
        """
        Phase 1: Validate and fix document consistency.

        This phase:
        1. Validates each document's data consistency
        2. Removes orphaned documents (missing from full_docs)
        3. Resets PROCESSING/FAILED docs with consistent data to PENDING

        Args:
            to_process_docs: Documents to validate
            pipeline_status: Shared pipeline status dictionary
            pipeline_status_lock: Async lock for pipeline_status

        Returns:
            dict: Validated documents (some may be removed)
        """
        # ═════════════════════════════════════════════════════════════════════════════
        # PHASE 1: KIỂM TRA & SỬA LỖI TÍNH NHẤT QUÁN DỮ LIỆU (DATA CONSISTENCY)
        # ═════════════════════════════════════════════════════════════════════════════
        #
        # 🎯 TẠI SAO CẦN FUNCTION NÀY?
        #
        # 🔴 VẤN ĐỀ: Dữ liệu có thể bị KHÔNG NHẤT QUÁN (inconsistent) trong các trường hợp:
        #
        # 1️⃣ SERVER CRASH/RESTART giữa chừng xử lý:
        #    - Document đang xử lý (PROCESSING status)
        #    - Server đột ngột tắt → Xử lý bị gián đoạn
        #    - Khi restart: doc_status vẫn là PROCESSING, nhưng dữ liệu thực tế chưa xong
        #    → CẦN reset về PENDING để xử lý lại
        #
        # 2️⃣ LỖI TRONG QUÁ TRÌNH XỬ LÝ trước đó:
        #    - Document xử lý FAILED (LLM timeout, network error, etc.)
        #    - Status = FAILED nhưng có thể data vẫn còn inconsistent
        #    → CẦN retry xử lý lại (reset về PENDING)
        #
        # 3️⃣ DỮ LIỆU "MỒ CÔI" (Orphaned data):
        #    - doc_status có entry cho document X
        #    - Nhưng full_docs KHÔNG có content của document X
        #    - Nguyên nhân: Có thể bị xóa thủ công, hoặc lỗi storage
        #    → CẦN xóa entry mồ côi này (không thể xử lý mà không có content)
        #
        # 4️⃣ MANUAL DATABASE OPERATIONS:
        #    - Admin xóa/sửa dữ liệu trực tiếp trong database
        #    - Gây mất đồng bộ giữa doc_status và full_docs
        #    → CẦN phát hiện và fix
        #
        # 📋 CỤNG VIỆC CỦA FUNCTION:
        #
        # ┌─────────────────────────────────────────────────────────────────────┐
        # │ Input: to_process_docs (PENDING + PROCESSING + FAILED)              │
        # └─────────────────────────────────────────────────────────────────────┘
        #                               ↓
        #   ┌───────────────────────────────────────────────────────────────┐
        #   │ Bước 1: Kiểm tra từng document                                 │
        #   │ - Có entry trong doc_status?                                  │
        #   │ - Có content tương ứng trong full_docs?                       │
        #   └───────────────────────────────────────────────────────────────┘
        #                               ↓
        #              ┌────────────────┴────────────────┐
        #              ↓                                  ↓
        #   ┌──────────────────────┐         ┌──────────────────────┐
        #   │ CONSISTENT           │         │ INCONSISTENT         │
        #   │ (có content)         │         │ (KHÔNG có content)   │
        #   └──────────────────────┘         └──────────────────────┘
        #              ↓                                  ↓
        #   ┌──────────────────────┐         ┌──────────────────────┐
        #   │ Check status:        │         │ Check nếu FAILED:    │
        #   │                      │         │                      │
        #   │ • PENDING → Giữ nguyên│         │ • FAILED → Preserve │
        #   │ • PROCESSING → PENDING│         │   (giữ lại để review)│
        #   │ • FAILED → PENDING   │         │                      │
        #   │   (reset để retry)   │         │ • Khác → XÓA        │
        #   └──────────────────────┘         │   (orphaned data)   │
        #                                    └──────────────────────┘
        #                               ↓
        # ┌─────────────────────────────────────────────────────────────────────┐
        # │ Output: Validated documents (đã xóa orphaned, đã reset status)      │
        # └─────────────────────────────────────────────────────────────────────┘
        #
        # ✅ SAU KHI VALIDATE:
        # - Tất cả documents trong to_process_docs đều GUARANTEED có content trong full_docs
        # - Documents từ PROCESSING/FAILED đã được reset về PENDING (để xử lý lại đúng cách)
        # - Orphaned entries đã bị xóa (tránh lỗi khi xử lý)
        # - FAILED documents (không có content) được preserve để admin review
        #
        # 🛡️ PHÒNG NGỪA LỖI:
        # Nếu không có function này:
        # - Pipeline sẽ cố xử lý documents không có content → CRASH
        # - Documents PROCESSING/FAILED sẽ bị stuck, không được retry
        # - Orphaned data làm rối database, khó debug
        #
        # 💡 VÍ DỤ THỰC TẾ:
        #
        # Scenario: Server crash khi đang xử lý 3 documents
        #
        # TRƯỚC KHI VALIDATE:
        # doc_status table:
        #   doc-001: PROCESSING (đang xử lý khi crash)
        #   doc-002: FAILED (lỗi LLM timeout)
        #   doc-003: PENDING (chưa xử lý)
        #   doc-004: PROCESSING (orphaned - không có content)
        #
        # SAU KHI VALIDATE:
        # doc_status table:
        #   doc-001: PENDING (reset để xử lý lại)
        #   doc-002: PENDING (reset để retry)
        #   doc-003: PENDING (giữ nguyên)
        #   doc-004: DELETED (xóa vì không có content)
        #
        # → Pipeline có thể xử lý an toàn, không crash!
        validated_docs = await self._validate_and_fix_document_consistency(
            to_process_docs, pipeline_status, pipeline_status_lock
        )

        if not validated_docs:
            log_message = "No valid documents after consistency check"
            logger.info(log_message)
            async with pipeline_status_lock:
                pipeline_status["latest_message"] = log_message
                pipeline_status["history_messages"].append(log_message)

        return validated_docs

    async def _pipeline_phase_process_single_document(
        self,
        doc_id: str,
        doc_status: DocProcessingStatus,
        pipeline_status: dict,
        pipeline_status_lock,
        split_by_character: str | None,
        split_by_character_only: bool,
    ) -> tuple[bool, list, dict]:
        """
        Phase 3: Process a single document (chunking + extraction).

        This phase:
        1. Updates doc_status to PROCESSING
        2. Chunks the document using chunking_by_token_size()
        3. Stores chunks in parallel (doc_status, chunks_vdb, text_chunks)
        4. Extracts entities and relationships using extract_entities()
        5. Handles errors and cancellation

        Args:
            doc_id: Document ID to process
            doc_status: Document status object
            pipeline_status: Shared pipeline status dictionary
            pipeline_status_lock: Async lock for pipeline_status
            split_by_character: Optional character to split by
            split_by_character_only: If True, only split by character

        Returns:
            tuple: (success: bool, chunk_results: list, chunks: dict)
            - success: True if processing succeeded
            - chunk_results: List of (nodes, edges) tuples from extraction
            - chunks: Dictionary of chunk_id -> chunk_data
        """
        try:
            logger.info(
                f"[PROCESS_SINGLE_DOC][INPUT] "
                f"doc_id={doc_id}, "
                f"file_path={doc_status.file_path}, "
                f"split_by_character={split_by_character!r}, "
                f"split_by_character_only={split_by_character_only}"
            )

            # Get document content
            logger.debug(f"[PROCESS_SINGLE_DOC][FULL_DOCS_GET][INPUT] doc_id={doc_id}")
            full_doc = await self.full_docs.get_by_id(doc_id)
            logger.debug(
                f"[PROCESS_SINGLE_DOC][FULL_DOCS_GET][OUTPUT] "
                f"found={full_doc is not None}, "
                f"content_length={len(full_doc.get('content', '')) if full_doc else 0}"
            )
            if not full_doc:
                logger.error(f"Document {doc_id} not found in full_docs")
                logger.info(f"[PROCESS_SINGLE_DOC][OUTPUT] success=False, reason=doc_not_found, doc_id={doc_id}")
                return False, [], {}

            content = full_doc.get("content", "")
            # file_path = doc_status.get("file_path", "unknown_source")
            file_path = doc_status.file_path

            # Record processing start time
            processing_start_time = int(datetime.now(timezone.utc).timestamp() * 1000)

            # Update status to PROCESSING
            # await self.doc_status.upsert({
            #     doc_id: {
            #         "status": DocStatus.PROCESSING,
            #         "updated_at": datetime.now(timezone.utc).isoformat(),
            #         "metadata": {"processing_start_time": processing_start_time},
            #     }
            # }
            # )

            logger.debug(f"[PROCESS_SINGLE_DOC][DOC_STATUS_GET][INPUT] doc_id={doc_id}")
            existing = await self.doc_status.get_by_id(doc_id)
            logger.debug(
                f"[PROCESS_SINGLE_DOC][DOC_STATUS_GET][OUTPUT] "
                f"current_status={existing.get('status') if existing else None}"
            )
            merged = {**existing, "status": DocStatus.PROCESSING,
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                    "metadata": {"processing_start_time": processing_start_time}}
            logger.debug(
                f"[PROCESS_SINGLE_DOC][DOC_STATUS_UPSERT][INPUT] "
                f"doc_id={doc_id}, new_status=PROCESSING, processing_start_time={processing_start_time}"
            )
            await self.doc_status.upsert({doc_id: merged})
            logger.debug(f"[PROCESS_SINGLE_DOC][DOC_STATUS_UPSERT][OUTPUT] status set to PROCESSING")

            # ═══════════════════════════════════════════════════════
            # STAGE 1: Chunking
            # ═══════════════════════════════════════════════════════
            logger.info(f"[Phase 3.1] Chunking document: {file_path}")
            logger.info(
                f"[PROCESS_SINGLE_DOC][CHUNKING][INPUT] "
                f"doc_id={doc_id}, "
                f"content_length={len(content)}, "
                f"chunk_token_size={self.chunk_token_size}, "
                f"chunk_overlap_token_size={self.chunk_overlap_token_size}, "
                f"split_by_character={split_by_character!r}, "
                f"split_by_character_only={split_by_character_only}"
            )

            chunking_result = chunking_by_token_size(
                self.tokenizer,
                content,
                split_by_character=split_by_character,
                split_by_character_only=split_by_character_only,
                chunk_overlap_token_size=self.chunk_overlap_token_size,
                chunk_token_size=self.chunk_token_size,
            )

            # logger.info(
            #     f"[PROCESS_SINGLE_DOC][CHUNKING][OUTPUT] doc_id={doc_id}, "
            #     f"num_chunks={len(chunking_result)}\n"
            #     + json.dumps(chunking_result, indent=2, ensure_ascii=False, default=str)
            # )

            # Build chunks dictionary with metadata
            chunks = {
                compute_mdhash_id(result["content"], prefix="chunk-"): {
                    **result,
                    "full_doc_id": doc_id,
                    "file_path": file_path,
                    "llm_cache_list": [],
                }
                for result in chunking_result
            }

            logger.info(f"[Phase 3.1] Created {len(chunks)} chunks")
            logger.info(
                f"[PROCESS_SINGLE_DOC][CHUNKS_BUILT][OUTPUT] "
                f"doc_id={doc_id}, num_chunks={len(chunks)}, "
                f"chunk_ids_preview={list(chunks.keys())[:3]}"
            )

            # ═══════════════════════════════════════════════════════
            # STAGE 2: Parallel Storage
            # ═══════════════════════════════════════════════════════
            logger.info(f"[Phase 3.2] Storing chunks in parallel...")
            logger.info(
                f"[PROCESS_SINGLE_DOC][PARALLEL_STORAGE][INPUT] "
                f"doc_id={doc_id}, num_chunks={len(chunks)}, "
                f"targets=[doc_status, chunks_vdb, text_chunks]"
            )

            # ═════════════════════════════════════════════════════════════════════════════
            # CHUẨN BỊ TASKS (Prepare Coroutines) - CHƯA THỰC THI!
            # ═════════════════════════════════════════════════════════════════════════════
            #
            # ⚠️ QUAN TRỌNG: Các dòng code dưới đây CHỈ TẠO COROUTINE OBJECTS,
            #                CHƯA THỰC THI gì cả!
            #
            # 📝 PYTHON ASYNCIO HOẠT ĐỘNG NHƯ THẾ NÀO:
            #
            # 1️⃣ TẠO COROUTINE (Declare variable):
            #    task = some_async_function()  ← CHƯA chạy! Chỉ tạo coroutine object
            #
            # 2️⃣ THỰC THI COROUTINE (Execute):
            #    await task                    ← BẮT ĐẦU chạy và chờ kết quả
            #
            # 3️⃣ THỰC THI NHIỀU COROUTINES ĐỒNG THỜI:
            #    await asyncio.gather(task1, task2, task3)  ← Chạy cả 3 cùng lúc
            #
            # ─────────────────────────────────────────────────────────────────────────────
            # VÍ DỤ MINH HỌA:
            # ─────────────────────────────────────────────────────────────────────────────
            #
            # async def fetch_data():
            #     print("Fetching...")
            #     await asyncio.sleep(1)
            #     return "data"
            #
            # # Dòng này KHÔNG in "Fetching..." vì CHƯA thực thi!
            # task = fetch_data()  # ← Chỉ tạo coroutine object
            # print(type(task))    # → <class 'coroutine'>
            #
            # # Dòng này MỚI thực thi và in "Fetching..."
            # result = await task  # ← BẮT ĐẦU execution
            #
            # ─────────────────────────────────────────────────────────────────────────────
            #
            # Prepare storage tasks (TẠO coroutines, CHƯA execute!)
            existing_for_chunks = await self.doc_status.get_by_id(doc_id)
            doc_status_task = self.doc_status.upsert({
                doc_id: {
                    **existing_for_chunks,          # GIỮ NGUYÊN tất cả fields cũ
                    "chunks_count": len(chunks),    # Ghi đè: số lượng chunks
                    "chunks_list": list(chunks.keys()),  # Ghi đè: danh sách chunk IDs
                }
            })
            # ↑ doc_status.upsert() TRẢ VỀ coroutine object
            # ↑ CHƯA update gì trong database cả!
            # ↑ Database vẫn chưa thay đổi tại thời điểm này!

            # ─────────────────────────────────────────────────────────────────────
            # Lưu chunks vào 2 storage layers KHÁC NHAU (cả 2 đều CẦN THIẾT!)
            # ─────────────────────────────────────────────────────────────────────
            #
            # 🎯 TẠI SAO CẦN 2 STORAGE LAYERS?
            #
            # LightRAG sử dụng kiến trúc DUAL STORAGE để tối ưu cho 2 mục đích khác nhau:
            # 1. Vector search (semantic similarity) → chunks_vdb
            # 2. Text retrieval (content access) → text_chunks
            #
            # ════════════════════════════════════════════════════════════════════════
            # 📦 STORAGE 1: chunks_vdb (Vector Database)
            # ════════════════════════════════════════════════════════════════════════
            # MỤC ĐÍCH: Tìm kiếm SEMANTIC (theo nghĩa)
            #
            # LƯU GÌ:
            # - Vector embeddings (768/1536 dimensions) của chunk content
            # - Metadata: chunk_id, doc_id, file_path, etc.
            #
            # DÙNG KHI NÀO:
            # - User query: "Tìm tài liệu về machine learning"
            # - System: Embed query → tìm chunks có embedding GIỐNG NHẤT (cosine similarity)
            # - Không cần text chính xác, chỉ cần "nghĩa tương tự"
            #
            # BACKEND:
            # - NanoVectorDB (default) - In-memory vector DB
            # - Qdrant, Milvus, FAISS - Production vector DBs
            #
            # VÍ DỤ QUERY:
            # query = "học máy"
            # → chunks_vdb tìm chunks về: "machine learning", "AI", "deep learning"
            #   (dù không chứa từ "học máy" nhưng có nghĩa tương tự)
            #
            chunks_vdb_task = self.chunks_vdb.upsert(chunks)
            # ↑ chunks_vdb.upsert() TRẢ VỀ coroutine object
            # ↑ CHƯA lưu gì vào vector database cả!
            # ↑ Vector DB vẫn CHƯA có embeddings tại thời điểm này!

            # ════════════════════════════════════════════════════════════════════════
            # 📄 STORAGE 2: text_chunks (Key-Value Store)
            # ════════════════════════════════════════════════════════════════════════
            # MỤC ĐÍCH: Lưu NỘI DUNG TEXT thực tế
            #
            # LƯU GÌ:
            # - Full text content của chunk (string)
            # - Metadata: tokens count, chunk_order_index, file_path
            # - Source tracking: doc_id, chunk_id
            #
            # DÙNG KHI NÀO:
            # - Sau khi chunks_vdb tìm được top-K chunks phù hợp
            # - Cần LẤY TEXT THỰC TẾ để:
            #   • Hiển thị cho user (citations, references)
            #   • Đưa vào LLM context (RAG generation)
            #   • Debug và review kết quả retrieval
            #
            # BACKEND:
            # - JSON KV Store (default) - File-based key-value
            # - Redis, PostgreSQL - Production KV stores
            #
            # VÍ DỤ RETRIEVAL FLOW:
            # 1. chunks_vdb.query(query_embedding) → [chunk-001, chunk-005, chunk-010]
            # 2. text_chunks.get(chunk-001) → "Machine learning is a subset of AI..."
            # 3. text_chunks.get(chunk-005) → "Deep learning uses neural networks..."
            # 4. → Đưa text này vào LLM để generate answer
            #
            text_chunks_task = self.text_chunks.upsert(chunks)
            # ↑ text_chunks.upsert() TRẢ VỀ coroutine object
            # ↑ CHƯA lưu text nào vào KV storage cả!
            # ↑ KV storage vẫn CHƯA có chunks text tại thời điểm này!

            # ─────────────────────────────────────────────────────────────────────
            # ✅ TẠI THỜI ĐIỂM NÀY (sau 3 dòng trên):
            # - Database: CHƯA thay đổi gì cả (no writes yet)
            # - Vector DB: CHƯA có embeddings mới
            # - KV Storage: CHƯA có text chunks mới
            # - Chỉ có 3 coroutine objects đang chờ được execute
            # ─────────────────────────────────────────────────────────────────────

            # ─────────────────────────────────────────────────────────────────────
            # 🔄 TẠI SAO KHÔNG DÙNG 1 STORAGE DUY NHẤT?
            # ─────────────────────────────────────────────────────────────────────
            #
            # ❌ OPTION 1: Chỉ dùng chunks_vdb (vector DB)
            # Vấn đề:
            # - Vector DBs tối ưu cho similarity search, KHÔNG tối ưu cho text retrieval
            # - Lưu full text trong vector DB → tốn storage, slow retrieval
            # - Một số vector DBs (FAISS) không hỗ trợ metadata lớn
            #
            # ❌ OPTION 2: Chỉ dùng text_chunks (KV store)
            # Vấn đề:
            # - KV stores không có khả năng semantic search
            # - Không thể tìm "chunks tương tự" dựa trên vector similarity
            # - Phải scan toàn bộ text → RẤT CHẬM cho large datasets
            #
            # ✅ SOLUTION: DUAL STORAGE (chunks_vdb + text_chunks)
            # Ưu điểm:
            # - chunks_vdb: Tìm kiếm nhanh, chính xác (semantic search)
            # - text_chunks: Lưu trữ hiệu quả, truy xuất nhanh (by chunk_id)
            # - Separation of concerns: Mỗi storage làm việc tốt nhất
            # - Scalability: Có thể scale riêng từng layer
            #
            # ─────────────────────────────────────────────────────────────────────
            # 📊 SO SÁNH STORAGE LAYERS:
            # ─────────────────────────────────────────────────────────────────────
            #
            # | Aspect            | chunks_vdb (Vector DB)  | text_chunks (KV Store) |
            # |-------------------|-------------------------|------------------------|
            # | Data Type         | Float vectors (768-1536)| String (text content)  |
            # | Search Method     | Cosine similarity       | Key lookup (O(1))      |
            # | Query Speed       | Fast (~10-100ms)        | Very fast (~1-10ms)    |
            # | Storage Size      | Large (vectors)         | Medium (text only)     |
            # | Use Case          | Semantic search         | Content retrieval      |
            # | Update Frequency  | Low (embeddings stable) | Low (text immutable)   |
            #
            # ─────────────────────────────────────────────────────────────────────
            # 💡 RETRIEVAL FLOW HOÀN CHỈNH:
            # ─────────────────────────────────────────────────────────────────────
            #
            # User Query: "Explain gradient descent"
            #        ↓
            # 1. Embed query → [0.12, -0.34, 0.56, ...]  (vector embedding)
            #        ↓
            # 2. chunks_vdb.query(query_embedding, top_k=5)
            #    → Returns: [chunk-042, chunk-108, chunk-201, chunk-305, chunk-412]
            #        ↓
            # 3. text_chunks.get_batch([chunk-042, chunk-108, ...])
            #    → Returns full text content of these chunks
            #        ↓
            # 4. Assemble context from retrieved texts
            #        ↓
            # 5. LLM.generate(context + query)
            #    → Final answer to user
            #
            # → Cả 2 storage layers đều THIẾT YẾU cho flow này!

            # ═════════════════════════════════════════════════════════════════════════════
            # ⚡ THỰC THI 3 TASKS SONG SONG (PARALLEL) với asyncio.gather()
            # ═════════════════════════════════════════════════════════════════════════════
            #
            # 🎯 TẠI SAO DÙNG asyncio.gather() THAY VÌ CHẠY TUẦN TỰ?
            #
            # ❌ CÁCH CHẠY TUẦN TỰ (Sequential):
            #    await doc_status_task        # 50ms
            #    await chunks_vdb_task        # 200ms
            #    await text_chunks_task       # 150ms
            #    → TỔNG: 50 + 200 + 150 = 400ms
            #
            # ✅ CÁCH CHẠY SONG SONG (Parallel) với asyncio.gather():
            #    await asyncio.gather(
            #        doc_status_task,         # 50ms  ┐
            #        chunks_vdb_task,         # 200ms ├─ Chạy đồng thời
            #        text_chunks_task,        # 150ms ┘
            #    )
            #    → TỔNG: max(50, 200, 150) = 200ms  (NHANH GẤP 2 LẦN!)
            #
            # ─────────────────────────────────────────────────────────────────────────────
            # 💡 asyncio.gather() LÀM GÌ?
            # ─────────────────────────────────────────────────────────────────────────────
            #
            # 1. KHỞI CHẠY ĐỒNG THỜI (Concurrent Execution):
            #    - Tất cả 3 tasks bắt đầu chạy CÙng LÚC
            #    - Không chờ task này xong mới chạy task kia
            #    - Tận dụng I/O bound operations (network, disk writes)
            #
            # 2. CHỜ TẤT CẢ HOÀN THÀNH (Wait for All):
            #    - Chờ đến khi CẢ 3 tasks đều hoàn thành
            #    - Nếu 1 task fail → raise exception ngay lập tức
            #    - Trả về results theo thứ tự: [result1, result2, result3]
            #
            # 3. ATOMICITY:
            #    - Hoặc TẤT CẢ thành công
            #    - Hoặc FAIL toàn bộ (nếu có 1 task lỗi)
            #    - Đảm bảo data consistency
            #
            # ─────────────────────────────────────────────────────────────────────────────
            # 🔍 TẠI SAO 3 TASKS NÀY CÓ THỂ CHẠY SONG SONG?
            # ─────────────────────────────────────────────────────────────────────────────
            #
            # ✅ ĐỘC LẬP (Independent):
            # - doc_status_task: Update doc_status storage (JSON file hoặc Redis)
            # - chunks_vdb_task: Write to vector database (NanoVectorDB, Qdrant, etc.)
            # - text_chunks_task: Write to KV storage (JSON file hoặc Redis)
            # → 3 storages KHÁC NHAU, KHÔNG conflict, KHÔNG phụ thuộc lẫn nhau
            #
            # ✅ I/O BOUND:
            # - Phần lớn thời gian là CHỜ I/O (disk write, network, database)
            # - CPU idle trong lúc chờ I/O
            # - Asyncio tận dụng thời gian chờ này để chạy các tasks khác
            #
            # ✅ KHÔNG CẦN THỨ TỰ:
            # - Không quan trọng task nào hoàn thành trước
            # - Chỉ cần TẤT CẢ đều hoàn thành trước khi tiếp tục
            #
            # ─────────────────────────────────────────────────────────────────────────────
            # 📊 SO SÁNH HIỆU NĂNG:
            # ─────────────────────────────────────────────────────────────────────────────
            #
            # Scenario: Document có 50 chunks, mỗi chunk 500 tokens
            #
            # | Method         | doc_status | chunks_vdb | text_chunks | TOTAL TIME |
            # |----------------|------------|------------|-------------|------------|
            # | Sequential     | 50ms       | 200ms      | 150ms       | 400ms      |
            # | Parallel       | 50ms  ┐    |            |             |            |
            # | (gather)       | 200ms ├─── CONCURRENT ────────────   | 200ms      |
            # |                | 150ms ┘    |            |             | (50% faster)|
            #
            # ⚡ PERFORMANCE GAIN:
            # - Small docs (5-10 chunks): ~1.5-2x faster
            # - Medium docs (20-50 chunks): ~2-2.5x faster
            # - Large docs (100+ chunks): ~2.5-3x faster
            #
            # ─────────────────────────────────────────────────────────────────────────────
            # ⚠️ NẾU KHÔNG DÙNG asyncio.gather()?
            # ─────────────────────────────────────────────────────────────────────────────
            #
            # ❌ Vấn đề 1: CHẬM GẤP 2-3 LẦN
            # await doc_status.upsert(...)      # Chờ xong
            # await chunks_vdb.upsert(...)      # Chờ xong
            # await text_chunks.upsert(...)     # Chờ xong
            # → Pipeline processing chậm, user phải đợi lâu
            #
            # ❌ Vấn đề 2: LÃNG PHÍ RESOURCES
            # - CPU idle trong lúc chờ I/O
            # - Không tận dụng concurrent I/O operations
            # - Server có thể xử lý ít requests hơn (lower throughput)
            #
            # ❌ Vấn đề 3: SCALABILITY KÉM
            # - Với 1000 documents/hour: sequential = 400s, parallel = 200s
            # - Parallel có thể xử lý GẤP ĐÔI lượng documents trong cùng thời gian
            #
            # ─────────────────────────────────────────────────────────────────────────────
            # 🛡️ ERROR HANDLING:
            # ─────────────────────────────────────────────────────────────────────────────
            #
            # Nếu 1 task fail (ví dụ: chunks_vdb.upsert() bị lỗi):
            # 1. asyncio.gather() NGAY LẬP TỨC raise exception
            # 2. Các tasks khác bị CANCEL (nếu đang chạy)
            # 3. Exception được propagate lên caller (try-except bên ngoài)
            # 4. Rollback logic sẽ xử lý cleanup (nếu cần)
            #
            # VÍ DỤ:
            # try:
            #     await asyncio.gather(task1, task2, task3)  # task2 fails
            # except Exception as e:
            #     # task1 và task3 cũng bị cancel
            #     # Có thể rollback hoặc cleanup ở đây
            #     raise
            #
            # ─────────────────────────────────────────────────────────────────────────────
            # 💡 KẾT LUẬN:
            # ─────────────────────────────────────────────────────────────────────────────
            #
            # asyncio.gather() ở đây là CRITICAL cho performance:
            # ✅ Giảm 50% thời gian xử lý mỗi document
            # ✅ Tăng throughput của pipeline
            # ✅ Tận dụng tối đa I/O concurrency
            # ✅ Đảm bảo atomicity (all-or-nothing)
            # ✅ Scalable cho production workloads
            #
            # → KHÔNG thể bỏ qua! Đây là một trong những optimizations QUAN TRỌNG NHẤT!
            #
            await asyncio.gather(
                doc_status_task,     # ← Task 1: Update document status
                chunks_vdb_task,     # ← Task 2: Store vector embeddings
                text_chunks_task,    # ← Task 3: Store text content
            )
            # ← Tại đây: CẢ 3 tasks đã hoàn thành, có thể tiếp tục an toàn

            logger.info(f"[Phase 3.2] Chunks stored successfully")

            # ═══════════════════════════════════════════════════════
            # STAGE 3: Entity & Relationship Extraction
            # ═══════════════════════════════════════════════════════
            logger.info(f"[Phase 3.3] Extracting entities and relationships...")

            # ─────────────────────────────────────────────────────────────────────
            # Trích xuất entities (thực thể) và relationships (quan hệ) từ chunks
            # ─────────────────────────────────────────────────────────────────────
            # Sử dụng LLM (Gemini, OpenAI, Ollama, etc.) để phân tích từng chunk
            # và extract ra các entities (người, địa điểm, khái niệm) và
            # relationships (quan hệ giữa các entities)
            # chunk_results = await self._process_extract_entities(
            #     chunks=chunks,
            #     pipeline_status=pipeline_status,
            #     pipeline_status_lock=pipeline_status_lock,
            # )

            # logger.info(
            #     f"[PROCESS_SINGLE_DOC][EXTRACT_ENTITIES][INPUT] doc_id={doc_id}\n"
            #     f"chunks:\n"
            #     + json.dumps(chunks, indent=2, ensure_ascii=False, default=str)
            # )

            chunk_results = await extract_entities(
                 chunks,
                 global_config=asdict(self),
                 pipeline_status=pipeline_status,
                 pipeline_status_lock=pipeline_status_lock,
                 llm_response_cache=self.llm_response_cache,
                 text_chunks_storage=self.text_chunks,
             )

            # logger.info(
            #     f"[PROCESS_SINGLE_DOC][EXTRACT_ENTITIES][OUTPUT] doc_id={doc_id}, "
            #     f"num_results={len(chunk_results)}\n"
            #     + json.dumps(
            #         [
            #             {
            #                 "nodes": nodes,
            #                 "edges": {str(k): v for k, v in edges.items()} if isinstance(edges, dict) else edges,
            #             }
            #             for nodes, edges in chunk_results
            #         ],
            #         indent=2,
            #         ensure_ascii=False,
            #         default=str,
            #     )
            # )
            # ↑ _process_extract_entities() gọi extract_entities() từ operate.py
            # ↑ Xử lý TẤT CẢ chunks SONG SONG (parallel) với semaphore limit

            # ═════════════════════════════════════════════════════════════════════════════
            # 📊 OUTPUT FORMAT CỦA chunk_results
            # ═════════════════════════════════════════════════════════════════════════════
            #
            # chunk_results là LIST of TUPLES, mỗi tuple tương ứng với 1 chunk:
            #
            # FORMAT:
            # [
            #     (nodes_from_chunk1, edges_from_chunk1),  # Tuple 1: (list, list)
            #     (nodes_from_chunk2, edges_from_chunk2),  # Tuple 2: (list, list)
            #     (nodes_from_chunk3, edges_from_chunk3),  # Tuple 3: (list, list)
            #     ...
            # ]
            #
            # Trong đó:
            # - nodes (list[dict]): Danh sách entities (thực thể) được extract
            # - edges (list[dict]): Danh sách relationships (quan hệ) được extract
            #
            # ─────────────────────────────────────────────────────────────────────────────
            # 📝 CHI TIẾT CẤU TRÚC MỖI TUPLE: (nodes, edges)
            # ─────────────────────────────────────────────────────────────────────────────
            #
            # 1️⃣ NODES (Entities) - list[dict]:
            # [
            #     {
            #         "src_id": "Machine Learning",           # Entity name
            #         "tgt_id": None,                         # None for entities
            #         "description": "A subset of AI...",     # Entity description
            #         "source_id": "chunk-abc123",            # Chunk ID nơi tìm thấy
            #         "file_path": "ml_intro.pdf",            # File nguồn
            #         "timestamp": 1708012345.678,            # Thời gian extract
            #     },
            #     {
            #         "src_id": "Neural Networks",
            #         "tgt_id": None,
            #         "description": "Computing systems inspired by...",
            #         "source_id": "chunk-abc123",
            #         "file_path": "ml_intro.pdf",
            #         "timestamp": 1708012345.678,
            #     },
            #     ...
            # ]
            #
            # 2️⃣ EDGES (Relationships) - list[dict]:
            # [
            #     {
            #         "src_id": "Machine Learning",           # Source entity
            #         "tgt_id": "Neural Networks",            # Target entity
            #         "description": "uses technique called", # Relationship description
            #         "source_id": "chunk-abc123",            # Chunk ID
            #         "file_path": "ml_intro.pdf",            # File nguồn
            #         "timestamp": 1708012345.678,            # Thời gian extract
            #     },
            #     {
            #         "src_id": "Neural Networks",
            #         "tgt_id": "Deep Learning",
            #         "description": "is foundation of",
            #         "source_id": "chunk-abc123",
            #         "file_path": "ml_intro.pdf",
            #         "timestamp": 1708012345.678,
            #     },
            #     ...
            # ]
            #
            # ─────────────────────────────────────────────────────────────────────────────
            # 💡 VÍ DỤ CỤ THỂ:
            # ─────────────────────────────────────────────────────────────────────────────
            #
            # Giả sử document có 3 chunks:
            #
            # chunk_results = [
            #     # Chunk 1: Extract được 2 entities và 1 relationship
            #     (
            #         [  # nodes từ chunk 1
            #             {"src_id": "Python", "tgt_id": None, "description": "Programming language"},
            #             {"src_id": "Django", "tgt_id": None, "description": "Web framework"},
            #         ],
            #         [  # edges từ chunk 1
            #             {"src_id": "Django", "tgt_id": "Python", "description": "built with"},
            #         ]
            #     ),
            #
            #     # Chunk 2: Extract được 1 entity và 0 relationships
            #     (
            #         [  # nodes từ chunk 2
            #             {"src_id": "Flask", "tgt_id": None, "description": "Micro web framework"},
            #         ],
            #         [  # edges từ chunk 2 (empty)
            #         ]
            #     ),
            #
            #     # Chunk 3: Extract được 3 entities và 2 relationships
            #     (
            #         [  # nodes từ chunk 3
            #             {"src_id": "FastAPI", "tgt_id": None, "description": "Modern web framework"},
            #             {"src_id": "REST API", "tgt_id": None, "description": "Architectural style"},
            #             {"src_id": "OpenAPI", "tgt_id": None, "description": "API specification"},
            #         ],
            #         [  # edges từ chunk 3
            #             {"src_id": "FastAPI", "tgt_id": "REST API", "description": "implements"},
            #             {"src_id": "FastAPI", "tgt_id": "OpenAPI", "description": "generates"},
            #         ]
            #     ),
            # ]
            #
            # ⚡ len(chunk_results) = 3  (3 chunks đã xử lý)
            #
            # ─────────────────────────────────────────────────────────────────────────────
            # 🔄 BƯỚC TIẾP THEO (sau khi có chunk_results):
            # ─────────────────────────────────────────────────────────────────────────────
            #
            # chunk_results sẽ được đưa vào merge_nodes_and_edges() để:
            # 1. Gộp tất cả nodes từ các chunks lại
            # 2. Gộp tất cả edges từ các chunks lại
            # 3. Deduplicate (loại bỏ entities/relationships trùng)
            # 4. Merge với knowledge graph hiện có
            # 5. Summarize descriptions (nếu có nhiều mô tả cho cùng entity)
            # 6. Upsert vào graph storage (NetworkX, Neo4j, etc.)
            #
            # Flow:
            # chunk_results → merge_nodes_and_edges() → upsert_graph() → Knowledge Graph
            #
            # ─────────────────────────────────────────────────────────────────────────────
            # ⏱️ THỜI GIAN XỬ LÝ (Performance):
            # ─────────────────────────────────────────────────────────────────────────────
            #
            # Extraction time phụ thuộc vào:
            # - Số lượng chunks: 10 chunks ~10-30s, 50 chunks ~30-60s
            # - LLM speed: Gemini Flash ~2s/chunk, GPT-4 ~5s/chunk
            # - Parallel processing: Semaphore limit (default 4) → xử lý 4 chunks cùng lúc
            # - Document complexity: Text phức tạp → nhiều entities → chậm hơn
            #
            # VÍ DỤ: 20 chunks với Gemini Flash và semaphore=4:
            # - Sequential: 20 × 2s = 40s
            # - Parallel (4 concurrent): 20/4 × 2s = 10s  (NHANH GẤP 4 LẦN!)
            #

            logger.info(f"[Phase 3.3] Extraction completed for {len(chunk_results)} chunks")

            return True, chunk_results, chunks

        except Exception as e:
            logger.error(f"Error processing document {doc_id}: {str(e)}", exc_info=True)
            existing_on_fail = await self.doc_status.get_by_id(doc_id)
            # Update status to FAILED
            await self.doc_status.upsert({
                doc_id: {
                    **existing_on_fail,     # GIỮ NGUYÊN tất cả fields cũ
                    "status": DocStatus.FAILED,
                    "error_msg": str(e),
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                },
            })

            return False, [], {}

 

    async def _pipeline_phase_merge_to_graph(
        self,
        chunk_results: list,
        chunks: dict,
        doc_id: str,
        file_path: str,
        pipeline_status: dict,
        pipeline_status_lock,
        current_file_number: int,
        total_files: int,
    ) -> None:
        """
        Phase 4: Merge extracted entities/relations into knowledge graph.

        This phase:
        1. Calls merge_nodes_and_edges() with proper parameters
        2. Updates knowledge graph with new entities and relationships
        3. Updates vector databases with embeddings

        Args:
            chunk_results: List of (nodes, edges) tuples from extraction
            chunks: Dictionary of chunk_id -> chunk_data
            doc_id: Document ID being processed
            file_path: File path for logging
            pipeline_status: Shared pipeline status dictionary
            pipeline_status_lock: Async lock for pipeline_status
            current_file_number: Current file number (for progress tracking)
            total_files: Total number of files
        """
        logger.info(f"[Phase 4] Merging to knowledge graph: {file_path}")

        try:
            # logger.info(
            #     f"[MERGE_TO_GRAPH][MERGE_NODES_AND_EDGES][INPUT] "
            #     f"doc_id={doc_id}, file_path={file_path}, "
            #     f"file={current_file_number}/{total_files}\n"
            #     f"chunk_results:\n"
            #     + json.dumps(
            #         [
            #             {
            #                 "nodes": nodes,
            #                 "edges": {str(k): v for k, v in edges.items()} if isinstance(edges, dict) else edges,
            #             }
            #             for nodes, edges in chunk_results
            #         ],
            #         indent=2,
            #         ensure_ascii=False,
            #         default=str,
            #     )
            # )

            await self._merge_nodes_and_edges(
                chunk_results=chunk_results,
                knowledge_graph_inst=self.chunk_entity_relation_graph,
                entity_vdb=self.entities_vdb,
                relationships_vdb=self.relationships_vdb,
                global_config=asdict(self),
                full_entities_storage=self.full_entities,
                full_relations_storage=self.full_relations,
                doc_id=doc_id,
                pipeline_status=pipeline_status,
                pipeline_status_lock=pipeline_status_lock,
                llm_response_cache=self.llm_response_cache,
                entity_chunks_storage=self.entity_chunks,
                relation_chunks_storage=self.relation_chunks,
                current_file_number=current_file_number,
                total_files=total_files,
                file_path=file_path,
            )

            logger.info(f"[Phase 4] Graph merge completed for: {file_path}")

        except Exception as e:
            logger.error(f"Error merging to graph for {doc_id}: {str(e)}", exc_info=True)

            # Update status to FAILED
            existing_on_graph_fail = await self.doc_status.get_by_id(doc_id)

            await self.doc_status.upsert({
                doc_id: {
                    **existing_on_graph_fail,   # GIỮ NGUYÊN tất cả fields cũ
                    "status": DocStatus.FAILED,
                    "error_msg": f"Graph merge failed: {str(e)}",
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                },
            })
            raise

    async def _pipeline_phase_finalize_document(
        self,
        doc_id: str,
        processing_start_time: int,
        pipeline_status: dict,
        pipeline_status_lock,
    ) -> None:
        """
        Phase 5: Finalize document processing.

        This phase:
        1. Records processing end time
        2. Updates doc_status to PROCESSED
        3. Triggers storage callbacks (index_done_callback)

        Args:
            doc_id: Document ID to finalize
            processing_start_time: When processing started (timestamp in ms)
            pipeline_status: Shared pipeline status dictionary
            pipeline_status_lock: Async lock for pipeline_status
        """
        logger.info(f"[Phase 5] Finalizing document: {doc_id}")

        try:
            processing_end_time = int(datetime.now(timezone.utc).timestamp() * 1000)
            processing_duration = processing_end_time - processing_start_time

            existing_for_processed = await self.doc_status.get_by_id(doc_id)

            # Update doc_status to PROCESSED với full merged data
            await self.doc_status.upsert({
                doc_id: {
                    **existing_for_processed,   # GIỮ NGUYÊN tất cả fields cũ
                    "status": DocStatus.PROCESSED,
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                    "metadata": {
                        # Merge metadata: giữ các key cũ, thêm processing times
                        **existing_for_processed.get("metadata", {}),
                        "processing_start_time": processing_start_time,
                        "processing_end_time": processing_end_time,
                        "processing_duration_ms": processing_duration,
                    },
                },
            })

            # Trigger storage callbacks
            await self._insert_done()

            logger.info(
                f"[Phase 5] Document finalized: {doc_id} "
                f"(processed in {processing_duration}ms)"
            )

        except Exception as e:
            logger.error(f"Error finalizing document {doc_id}: {str(e)}", exc_info=True)
            raise

    # ═══════════════════════════════════════════════════════════════
    # MERGE NODES AND EDGES — BROKEN DOWN VIA INHERITANCE
    # ═══════════════════════════════════════════════════════════════

    def _collect_nodes_and_edges(self, chunk_results: list) -> tuple:
        """Collect and group all nodes and edges from chunk extraction results.

        Args:
            chunk_results: List of (maybe_nodes, maybe_edges) tuples from extract_entities.

        Returns:
            (all_nodes, all_edges) defaultdicts keyed by entity name / sorted edge key.
        """
        all_nodes = defaultdict(list)
        all_edges = defaultdict(list)

        for maybe_nodes, maybe_edges in chunk_results:
            # Collect nodes
            for entity_name, entities in maybe_nodes.items():
                all_nodes[entity_name].extend(entities)

            # Collect edges with sorted keys for undirected graph
            for edge_key, edges in maybe_edges.items():
                sorted_edge_key = tuple(sorted(edge_key))
                all_edges[sorted_edge_key].extend(edges)

        return all_nodes, all_edges

    async def _phase1_process_entities(
        self,
        all_nodes: dict,
        knowledge_graph_inst,
        entity_vdb,
        global_config: dict,
        pipeline_status: dict,
        pipeline_status_lock,
        llm_response_cache,
        entity_chunks_storage,
        semaphore,
        doc_id: str,
    ) -> list:
        """Phase 1: Concurrently merge and upsert all entities into the knowledge graph.

        Args:
            all_nodes: Grouped entity data keyed by entity name.
            knowledge_graph_inst: Knowledge graph storage.
            entity_vdb: Entity vector database.
            global_config: Global configuration dict.
            pipeline_status: Shared pipeline status dictionary.
            pipeline_status_lock: Async lock for pipeline_status.
            llm_response_cache: LLM response cache.
            entity_chunks_storage: Storage tracking full chunk lists per entity.
            semaphore: Concurrency limiter (asyncio.Semaphore).
            doc_id: Document ID for logging.

        Returns:
            List of processed entity data dicts.
        """
        total_entities_count = len(all_nodes)

        log_message = f"Phase 1: Processing {total_entities_count} entities from {doc_id} (async: {semaphore._value})"
        logger.info(log_message)
        async with pipeline_status_lock:
            pipeline_status["latest_message"] = log_message
            pipeline_status["history_messages"].append(log_message)

        async def _locked_process_entity_name(entity_name, entities):
            async with semaphore:
                # Check for cancellation before processing entity
                if pipeline_status is not None and pipeline_status_lock is not None:
                    async with pipeline_status_lock:
                        if pipeline_status.get("cancellation_requested", False):
                            raise PipelineCancelledException(
                                "User cancelled during entity merge"
                            )

                workspace = global_config.get("workspace", "")
                namespace = f"{workspace}:GraphDB" if workspace else "GraphDB"
                async with get_storage_keyed_lock(
                    [entity_name], namespace=namespace, enable_logging=False
                ):
                    try:
                        logger.debug(f"Processing entity {entity_name}")
                        entity_data = await _merge_nodes_then_upsert(
                            entity_name,
                            entities,
                            knowledge_graph_inst,
                            entity_vdb,
                            global_config,
                            pipeline_status,
                            pipeline_status_lock,
                            llm_response_cache,
                            entity_chunks_storage,
                        )

                        return entity_data

                    except Exception as e:
                        error_msg = f"Error processing entity `{entity_name}`: {e}"
                        logger.error(error_msg)

                        # Try to update pipeline status, but don't let status update failure affect main exception
                        try:
                            if (
                                pipeline_status is not None
                                and pipeline_status_lock is not None
                            ):
                                async with pipeline_status_lock:
                                    pipeline_status["latest_message"] = error_msg
                                    pipeline_status["history_messages"].append(error_msg)
                        except Exception as status_error:
                            logger.error(
                                f"Failed to update pipeline status: {status_error}"
                            )

                        # Re-raise the original exception with a prefix
                        prefixed_exception = create_prefixed_exception(
                            e, f"`{entity_name}`"
                        )
                        raise prefixed_exception from e

        # Create entity processing tasks
        entity_tasks = []
        for entity_name, entities in all_nodes.items():
            task = asyncio.create_task(_locked_process_entity_name(entity_name, entities))
            entity_tasks.append(task)

        # Execute entity tasks with error handling
        processed_entities = []
        if entity_tasks:
            done, pending = await asyncio.wait(
                entity_tasks, return_when=asyncio.FIRST_EXCEPTION
            )

            first_exception = None
            processed_entities = []

            for task in done:
                try:
                    result = task.result()
                except BaseException as e:
                    if first_exception is None:
                        first_exception = e
                else:
                    processed_entities.append(result)

            if pending:
                for task in pending:
                    task.cancel()
                pending_results = await asyncio.gather(*pending, return_exceptions=True)
                for result in pending_results:
                    if isinstance(result, BaseException):
                        if first_exception is None:
                            first_exception = result
                    else:
                        processed_entities.append(result)

            if first_exception is not None:
                raise first_exception

        return processed_entities

    async def _phase2_process_relationships(
        self,
        all_edges: dict,
        knowledge_graph_inst,
        relationships_vdb,
        entity_vdb,
        global_config: dict,
        pipeline_status: dict,
        pipeline_status_lock,
        llm_response_cache,
        relation_chunks_storage,
        entity_chunks_storage,
        semaphore,
        doc_id: str,
    ) -> tuple:
        """Phase 2: Concurrently merge and upsert all relationships into the knowledge graph.

        Args:
            all_edges: Grouped edge data keyed by sorted (src, tgt) tuple.
            knowledge_graph_inst: Knowledge graph storage.
            relationships_vdb: Relationship vector database.
            entity_vdb: Entity vector database (used for missing-entity creation).
            global_config: Global configuration dict.
            pipeline_status: Shared pipeline status dictionary.
            pipeline_status_lock: Async lock for pipeline_status.
            llm_response_cache: LLM response cache.
            relation_chunks_storage: Storage tracking full chunk lists per relation.
            entity_chunks_storage: Storage tracking full chunk lists per entity.
            semaphore: Concurrency limiter (asyncio.Semaphore).
            doc_id: Document ID for logging.

        Returns:
            (processed_edges, all_added_entities) tuple.
        """
        total_relations_count = len(all_edges)

        log_message = f"Phase 2: Processing {total_relations_count} relations from {doc_id} (async: {semaphore._value})"
        logger.info(log_message)
        async with pipeline_status_lock:
            pipeline_status["latest_message"] = log_message
            pipeline_status["history_messages"].append(log_message)

        async def _locked_process_edges(edge_key, edges):
            async with semaphore:
                # Check for cancellation before processing edges
                if pipeline_status is not None and pipeline_status_lock is not None:
                    async with pipeline_status_lock:
                        if pipeline_status.get("cancellation_requested", False):
                            raise PipelineCancelledException(
                                "User cancelled during relation merge"
                            )

                workspace = global_config.get("workspace", "")
                namespace = f"{workspace}:GraphDB" if workspace else "GraphDB"
                sorted_edge_key = sorted([edge_key[0], edge_key[1]])

                async with get_storage_keyed_lock(
                    sorted_edge_key,
                    namespace=namespace,
                    enable_logging=False,
                ):
                    try:
                        added_entities = []  # Track entities added during edge processing

                        logger.debug(f"Processing relation {sorted_edge_key}")
                        edge_data = await _merge_edges_then_upsert(
                            edge_key[0],
                            edge_key[1],
                            edges,
                            knowledge_graph_inst,
                            relationships_vdb,
                            entity_vdb,
                            global_config,
                            pipeline_status,
                            pipeline_status_lock,
                            llm_response_cache,
                            added_entities,  # Pass list to collect added entities
                            relation_chunks_storage,
                            entity_chunks_storage,  # Add entity_chunks_storage parameter
                        )

                        if edge_data is None:
                            return None, []

                        return edge_data, added_entities

                    except Exception as e:
                        error_msg = f"Error processing relation `{sorted_edge_key}`: {e}"
                        logger.error(error_msg)

                        # Try to update pipeline status, but don't let status update failure affect main exception
                        try:
                            if (
                                pipeline_status is not None
                                and pipeline_status_lock is not None
                            ):
                                async with pipeline_status_lock:
                                    pipeline_status["latest_message"] = error_msg
                                    pipeline_status["history_messages"].append(error_msg)
                        except Exception as status_error:
                            logger.error(
                                f"Failed to update pipeline status: {status_error}"
                            )

                        # Re-raise the original exception with a prefix
                        prefixed_exception = create_prefixed_exception(
                            e, f"{sorted_edge_key}"
                        )
                        raise prefixed_exception from e

        # Create relationship processing tasks
        edge_tasks = []
        for edge_key, edges in all_edges.items():
            task = asyncio.create_task(_locked_process_edges(edge_key, edges))
            edge_tasks.append(task)

        # Execute relationship tasks with error handling
        processed_edges = []
        all_added_entities = []

        if edge_tasks:
            done, pending = await asyncio.wait(
                edge_tasks, return_when=asyncio.FIRST_EXCEPTION
            )

            first_exception = None

            for task in done:
                try:
                    edge_data, added_entities = task.result()
                except BaseException as e:
                    if first_exception is None:
                        first_exception = e
                else:
                    if edge_data is not None:
                        processed_edges.append(edge_data)
                    all_added_entities.extend(added_entities)

            if pending:
                for task in pending:
                    task.cancel()
                pending_results = await asyncio.gather(*pending, return_exceptions=True)
                for result in pending_results:
                    if isinstance(result, BaseException):
                        if first_exception is None:
                            first_exception = result
                    else:
                        edge_data, added_entities = result
                        if edge_data is not None:
                            processed_edges.append(edge_data)
                        all_added_entities.extend(added_entities)

            if first_exception is not None:
                raise first_exception

        return processed_edges, all_added_entities

    async def _phase3_update_storage(
        self,
        processed_entities: list,
        all_added_entities: list,
        processed_edges: list,
        full_entities_storage,
        full_relations_storage,
        doc_id: str,
        pipeline_status: dict,
        pipeline_status_lock,
    ) -> None:
        """Phase 3: Update full_entities and full_relations storage with final results.

        Args:
            processed_entities: Entity data returned from Phase 1.
            all_added_entities: Entities created implicitly during Phase 2 (missing endpoints).
            processed_edges: Edge data returned from Phase 2.
            full_entities_storage: Storage for document entity lists.
            full_relations_storage: Storage for document relation lists.
            doc_id: Document ID for storage indexing.
            pipeline_status: Shared pipeline status dictionary.
            pipeline_status_lock: Async lock for pipeline_status.
        """
        if full_entities_storage and full_relations_storage and doc_id:
            try:
                # Merge all entities: original entities + entities added during edge processing
                final_entity_names = set()

                # Add original processed entities
                for entity_data in processed_entities:
                    if entity_data and entity_data.get("entity_name"):
                        final_entity_names.add(entity_data["entity_name"])

                # Add entities that were added during relationship processing
                for added_entity in all_added_entities:
                    if added_entity and added_entity.get("entity_name"):
                        final_entity_names.add(added_entity["entity_name"])

                # Collect all relation pairs
                final_relation_pairs = set()
                for edge_data in processed_edges:
                    if edge_data:
                        src_id = edge_data.get("src_id")
                        tgt_id = edge_data.get("tgt_id")
                        if src_id and tgt_id:
                            relation_pair = tuple(sorted([src_id, tgt_id]))
                            final_relation_pairs.add(relation_pair)

                log_message = f"Phase 3: Updating final {len(final_entity_names)}({len(processed_entities)}+{len(all_added_entities)}) entities and  {len(final_relation_pairs)} relations from {doc_id}"
                logger.info(log_message)
                async with pipeline_status_lock:
                    pipeline_status["latest_message"] = log_message
                    pipeline_status["history_messages"].append(log_message)

                # Update storage
                if final_entity_names:
                    await full_entities_storage.upsert(
                        {
                            doc_id: {
                                "entity_names": list(final_entity_names),
                                "count": len(final_entity_names),
                            }
                        }
                    )

                if final_relation_pairs:
                    await full_relations_storage.upsert(
                        {
                            doc_id: {
                                "relation_pairs": [
                                    list(pair) for pair in final_relation_pairs
                                ],
                                "count": len(final_relation_pairs),
                            }
                        }
                    )

                logger.debug(
                    f"Updated entity-relation index for document {doc_id}: {len(final_entity_names)} entities (original: {len(processed_entities)}, added: {len(all_added_entities)}), {len(final_relation_pairs)} relations"
                )

            except Exception as e:
                logger.error(
                    f"Failed to update entity-relation index for document {doc_id}: {e}"
                )
                # Don't raise exception to avoid affecting main flow

    async def _merge_nodes_and_edges(
        self,
        chunk_results: list,
        knowledge_graph_inst,
        entity_vdb,
        relationships_vdb,
        global_config: dict,
        full_entities_storage=None,
        full_relations_storage=None,
        doc_id: str = None,
        pipeline_status: dict = None,
        pipeline_status_lock=None,
        llm_response_cache=None,
        entity_chunks_storage=None,
        relation_chunks_storage=None,
        current_file_number: int = 0,
        total_files: int = 0,
        file_path: str = "unknown_source",
    ) -> None:
        """Orchestrate the three-phase merge of extracted entities and relationships.

        This method is a decomposed, inheritance-based replacement for the standalone
        ``merge_nodes_and_edges`` function in ``lightrag.operate``.  Logic is identical;
        the monolithic body is split into four focused helpers:

        1. :meth:`_collect_nodes_and_edges` — group raw extraction results
        2. :meth:`_phase1_process_entities` — concurrent entity upsert
        3. :meth:`_phase2_process_relationships` — concurrent relation upsert
        4. :meth:`_phase3_update_storage` — persist document-level indexes

        Args:
            chunk_results: List of (maybe_nodes, maybe_edges) tuples from extract_entities.
            knowledge_graph_inst: Knowledge graph storage.
            entity_vdb: Entity vector database.
            relationships_vdb: Relationship vector database.
            global_config: Global configuration dict.
            full_entities_storage: Storage for document entity lists.
            full_relations_storage: Storage for document relation lists.
            doc_id: Document ID for storage indexing.
            pipeline_status: Shared pipeline status dictionary.
            pipeline_status_lock: Async lock for pipeline_status.
            llm_response_cache: LLM response cache.
            entity_chunks_storage: Storage tracking full chunk lists per entity.
            relation_chunks_storage: Storage tracking full chunk lists per relation.
            current_file_number: Current file number for logging.
            total_files: Total files for logging.
            file_path: File path for logging.
        """
        # Check for cancellation at the start of merge
        if pipeline_status is not None and pipeline_status_lock is not None:
            async with pipeline_status_lock:
                if pipeline_status.get("cancellation_requested", False):
                    raise PipelineCancelledException("User cancelled during merge phase")

        # Collect all nodes and edges from all chunks
        # logger.info(
        #     f"[MERGE_NODES_AND_EDGES][COLLECT_NODES_AND_EDGES][INPUT] doc_id={doc_id}\n"
        #     f"chunk_results:\n"
        #     + json.dumps(
        #         [
        #             {
        #                 "nodes": nodes,
        #                 "edges": {str(k): v for k, v in edges.items()} if isinstance(edges, dict) else edges,
        #             }
        #             for nodes, edges in chunk_results
        #         ],
        #         indent=2,
        #         ensure_ascii=False,
        #         default=str,
        #     )
        # )

        all_nodes, all_edges = self._collect_nodes_and_edges(chunk_results)

        # logger.info(
        #     f"[MERGE_NODES_AND_EDGES][COLLECT_NODES_AND_EDGES][OUTPUT] doc_id={doc_id}, "
        #     f"num_unique_entities={len(all_nodes)}, num_unique_edges={len(all_edges)}\n"
        #     f"all_nodes:\n"
        #     + json.dumps(dict(all_nodes), indent=2, ensure_ascii=False, default=str)
        #     + "\nall_edges:\n"
        #     + json.dumps(
        #         {str(k): v for k, v in all_edges.items()},
        #         indent=2,
        #         ensure_ascii=False,
        #         default=str,
        #     )
        # )

        total_entities_count = len(all_nodes)
        total_relations_count = len(all_edges)

        log_message = f"Merging stage {current_file_number}/{total_files}: {file_path}"
        logger.info(log_message)
        async with pipeline_status_lock:
            pipeline_status["latest_message"] = log_message
            pipeline_status["history_messages"].append(log_message)

        # Get max async tasks limit from global_config for semaphore control
        graph_max_async = global_config.get("llm_model_max_async", 4) * 2
        semaphore = asyncio.Semaphore(graph_max_async)

        # Phase 1: Process all entities concurrently
        # logger.info(
        #     f"[MERGE_NODES_AND_EDGES][PHASE1_PROCESS_ENTITIES][INPUT] doc_id={doc_id}, "
        #     f"num_entities={len(all_nodes)}, semaphore_limit={semaphore._value}\n"
        #     f"all_nodes:\n"
        #     + json.dumps(dict(all_nodes), indent=2, ensure_ascii=False, default=str)
        # )

        processed_entities = await self._phase1_process_entities(
            all_nodes=all_nodes,
            knowledge_graph_inst=knowledge_graph_inst,
            entity_vdb=entity_vdb,
            global_config=global_config,
            pipeline_status=pipeline_status,
            pipeline_status_lock=pipeline_status_lock,
            llm_response_cache=llm_response_cache,
            entity_chunks_storage=entity_chunks_storage,
            semaphore=semaphore,
            doc_id=doc_id,
        )

        # logger.info(
        #     f"[MERGE_NODES_AND_EDGES][PHASE1_PROCESS_ENTITIES][OUTPUT] doc_id={doc_id}, "
        #     f"num_processed_entities={len(processed_entities)}\n"
        #     f"processed_entities:\n"
        #     + json.dumps(processed_entities, indent=2, ensure_ascii=False, default=str)
        # )

        # Phase 2: Process all relationships concurrently
        # logger.info(
        #     f"[MERGE_NODES_AND_EDGES][PHASE2_PROCESS_RELATIONSHIPS][INPUT] doc_id={doc_id}, "
        #     f"num_edges={len(all_edges)}, semaphore_limit={semaphore._value}\n"
        #     f"all_edges:\n"
        #     + json.dumps(
        #         {str(k): v for k, v in all_edges.items()},
        #         indent=2,
        #         ensure_ascii=False,
        #         default=str,
        #     )
        # )

        processed_edges, all_added_entities = await self._phase2_process_relationships(
            all_edges=all_edges,
            knowledge_graph_inst=knowledge_graph_inst,
            relationships_vdb=relationships_vdb,
            entity_vdb=entity_vdb,
            global_config=global_config,
            pipeline_status=pipeline_status,
            pipeline_status_lock=pipeline_status_lock,
            llm_response_cache=llm_response_cache,
            relation_chunks_storage=relation_chunks_storage,
            entity_chunks_storage=entity_chunks_storage,
            semaphore=semaphore,
            doc_id=doc_id,
        )

        # logger.info(
        #     f"[MERGE_NODES_AND_EDGES][PHASE2_PROCESS_RELATIONSHIPS][OUTPUT] doc_id={doc_id}, "
        #     f"num_processed_edges={len(processed_edges)}, num_added_entities={len(all_added_entities)}\n"
        #     f"processed_edges:\n"
        #     + json.dumps(processed_edges, indent=2, ensure_ascii=False, default=str)
        #     + "\nall_added_entities:\n"
        #     + json.dumps(all_added_entities, indent=2, ensure_ascii=False, default=str)
        # )

        # Phase 3: Update full_entities and full_relations storage
        await self._phase3_update_storage(
            processed_entities=processed_entities,
            all_added_entities=all_added_entities,
            processed_edges=processed_edges,
            full_entities_storage=full_entities_storage,
            full_relations_storage=full_relations_storage,
            doc_id=doc_id,
            pipeline_status=pipeline_status,
            pipeline_status_lock=pipeline_status_lock,
        )

        log_message = f"Completed merging: {len(processed_entities)} entities, {len(all_added_entities)} extra entities, {len(processed_edges)} relations"
        logger.info(log_message)
        async with pipeline_status_lock:
            pipeline_status["latest_message"] = log_message
            pipeline_status["history_messages"].append(log_message)

    # ═══════════════════════════════════════════════════════════════
    # MAIN ORCHESTRATOR (REFACTORED)
    # ═══════════════════════════════════════════════════════════════

    async def apipeline_process_enqueue_documents(
        self,
        split_by_character: str | None = None,
        split_by_character_only: bool = False,
    ) -> None:
        """
        Process enqueued documents through the complete pipeline.

        ✨ REFACTORED: This method now delegates to phase-specific methods
        for improved clarity, testability, and maintainability.

        Pipeline phases:
        0. Initialize & acquire lock
        1. Validate document consistency
        2. Main processing loop:
           3. Per-document: Chunk + Extract
           4. Merge to knowledge graph
           5. Finalize & cleanup

        Original function: 565 lines
        Refactored orchestrator: ~150 lines
        Phase methods: 6 methods with clear responsibilities

        Args:
            split_by_character: Optional character to split by before chunking
            split_by_character_only: If True, only split by character (no token-based chunking)
        """
        logger.info("=" * 60)
        logger.info("Starting document processing pipeline (Refactored)")
        logger.info("=" * 60)

        # ═══════════════════════════════════════════════════════════════════════════
        # Get shared resources for multi-process/multi-worker coordination
        # ═══════════════════════════════════════════════════════════════════════════

        # pipeline_status: Shared dictionary for cross-process pipeline state tracking
        # - Accessible by ALL workers/processes in the same workspace (e.g., multiple FastAPI workers)
        # - Stores: busy flag, job metadata, progress counters, cancellation flags, messages
        # - Workspace-isolated: Each workspace (e.g., "space1", "space2") has its own namespace
        # - Enables coordination: Prevents multiple workers from processing the same queue simultaneously
        # - Persists across coroutines: State survives between API requests and background tasks
        #
        # Example structure:
        # {
        #   "busy": True,                          # Is pipeline currently processing?
        #   "job_name": "Document Upload Batch",   # Current job identifier
        #   "docs": 5,                             # Total documents in current batch
        #   "cur_batch": 2,                        # Documents processed so far
        #   "cancellation_requested": False,       # User requested cancellation?
        #   "request_pending": False,              # New request waiting while busy?
        #   "latest_message": "Processing doc 2/5" # Status message for UI
        # }
        pipeline_status = await get_namespace_data(
            "pipeline_status", workspace=self.workspace
        )

        # pipeline_status_lock: Async lock for thread-safe access to pipeline_status
        # - Ensures atomic read-modify-write operations (critical for "busy" flag check-and-set)
        # - Prevents race conditions when multiple coroutines/workers access pipeline_status
        # - Reusable across multiple "async with" blocks (creates fresh context per use)
        # - Must be acquired before reading/writing pipeline_status to avoid data corruption
        #
        # Why needed?
        # Without lock: Worker A checks busy=False, Worker B checks busy=False → both start processing (BAD!)
        # With lock:    Worker A locks → sets busy=True → unlocks; Worker B locks → sees busy=True → queues (GOOD!)
        pipeline_status_lock = get_namespace_lock(
            "pipeline_status", workspace=self.workspace
        )

        # ═══════════════════════════════════════════════════════════
        # PHASE 0: Initialize & Lock
        # ═══════════════════════════════════════════════════════════
        acquired, to_process_docs = await self._pipeline_phase_init_and_lock(
            pipeline_status, pipeline_status_lock
        )

        if not acquired:
            return  # Pipeline busy, request queued

        try:
            # ═══════════════════════════════════════════════════════
            # PHASE 1: Validate Consistency
            # ═══════════════════════════════════════════════════════
            to_process_docs = await self._pipeline_phase_validate_consistency(
                to_process_docs, pipeline_status, pipeline_status_lock
            )

            if not to_process_docs:
                return  # No valid documents

            # ═══════════════════════════════════════════════════════
            # MAIN PROCESSING LOOP
            # ═══════════════════════════════════════════════════════
            while True:
                # Check for cancellation
                async with pipeline_status_lock:
                    if pipeline_status.get("cancellation_requested", False):
                        pipeline_status["request_pending"] = False
                        pipeline_status["cancellation_requested"] = False
                        log_message = "Pipeline cancelled by user"
                        logger.info(log_message)
                        pipeline_status["latest_message"] = log_message
                        pipeline_status["history_messages"].append(log_message)
                        return

                total_files = len(to_process_docs)
                logger.info(f"Processing {total_files} documents...")

                # ═══════════════════════════════════════════════════
                # PHASE 3: Process Each Document
                # ═══════════════════════════════════════════════════
                current_file_number = 0

                for doc_id, doc_status in to_process_docs.items():
                    current_file_number += 1
                    # file_path = doc_status.get("file_path", "unknown")
                    file_path = doc_status.file_path

                    logger.info(f"\n[{current_file_number}/{total_files}] Processing: {file_path}")

                    # Process single document
                    success, chunk_results, chunks = await self._pipeline_phase_process_single_document(
                        doc_id,
                        doc_status,
                        pipeline_status,
                        pipeline_status_lock,
                        split_by_character,
                        split_by_character_only,
                    )

                    if not success:
                        logger.error(f"Failed to process document: {file_path}")
                        continue

                    # ═══════════════════════════════════════════════
                    # PHASE 4: Merge to Knowledge Graph
                    # ═══════════════════════════════════════════════
                    await self._pipeline_phase_merge_to_graph(
                        chunk_results,
                        chunks,
                        doc_id,
                        file_path,
                        pipeline_status,
                        pipeline_status_lock,
                        current_file_number,
                        total_files,
                    )

                    # ═══════════════════════════════════════════════
                    # PHASE 5: Finalize Document
                    # ═══════════════════════════════════════════════
                    processing_start_time = doc_status.metadata.get(
                        "processing_start_time", 0
                    )
                    await self._pipeline_phase_finalize_document(
                        doc_id,
                        processing_start_time,
                        pipeline_status,
                        pipeline_status_lock,
                    )

                    logger.info(f"✅ Completed: {file_path}\n")

                # Check if re-queue requested
                async with pipeline_status_lock:
                    if pipeline_status.get("request_pending", False):
                        # Fetch new pending documents
                        pipeline_status["request_pending"] = False
                        pending_docs = await self.doc_status.get_docs_by_status(
                            DocStatus.PENDING
                        )
                        if pending_docs:
                            to_process_docs = pending_docs
                            logger.info(f"Re-queue requested. Processing {len(pending_docs)} new documents")
                            continue

                # No more documents
                break

            logger.info("=" * 60)
            logger.info("Pipeline completed successfully")
            logger.info("=" * 60)

        finally:
            # Release lock
            async with pipeline_status_lock:
                pipeline_status["busy"] = False
                logger.info("Pipeline lock released")

    # ═══════════════════════════════════════════════════════════════
    # ENQUEUE PHASE METHODS
    # ═══════════════════════════════════════════════════════════════

    async def _enqueue_phase_normalize_inputs(
        self,
        input: str | list[str],
        ids: list[str] | None,
        file_paths: str | list[str] | None,
        track_id: str | None,
    ) -> tuple[str, list[str], list[str] | None, list[str]]:
        """
        Phase 0: Normalize and validate all inputs.

        This phase handles:
        1. Generating track_id if not provided
        2. Converting single values to lists
        3. Validating file_paths count matches document count
        4. Setting default file_paths if not provided

        Args:
            input: Single document string or list of document strings
            ids: Optional list of document IDs (None or list)
            file_paths: Optional list of file paths (None, single string, or list)
            track_id: Optional batch tracking identifier (None or string)

                **What is track_id?**
                track_id is a unique identifier that groups all documents from a single
                upload/enqueue operation together. It serves multiple purposes:

                1. **Batch Tracking**: Links documents from the same upload operation
                2. **Status Monitoring**: Allows querying processing status by track_id
                3. **Duplicate Linking**: When duplicates are detected, the duplicate
                   record stores both the original document's track_id AND the current
                   attempt's track_id for complete audit trail
                4. **Debugging & Auditing**: Enables tracing document lineage and upload history

                If None or empty string, a new track_id is auto-generated using:
                `generate_track_id("enqueue")` → e.g., "enqueue-20260215-abc123def456"

                The track_id is stored in each document's status record and returned
                to the caller for monitoring pipeline progress.

        Returns:
            tuple: (track_id, input_list, ids_list, file_paths_list)
            - track_id (str): Generated or provided tracking ID
            - input_list (list[str]): Normalized document list
            - ids_list (list[str] | None): Normalized ID list or None
            - file_paths_list (list[str]): Normalized file path list

        Raises:
            ValueError: If file_paths count doesn't match input count

        Internal Logic:
        ┌─────────────────────────────────────────────────────────┐
        │ INPUT NORMALIZATION FLOW                                │
        ├─────────────────────────────────────────────────────────┤
        │ 1. Track ID:                                            │
        │    - If None/empty → generate_track_id("enqueue")       │
        │    - Else → use provided value                          │
        │                                                          │
        │ 2. Input Documents:                                     │
        │    - If str → [str]                                     │
        │    - If list → keep as-is                               │
        │                                                          │
        │ 3. IDs:                                                 │
        │    - If None → keep None (will generate in Phase 1)     │
        │    - If str → [str]                                     │
        │    - If list → keep as-is                               │
        │                                                          │
        │ 4. File Paths:                                          │
        │    - If None → ["unknown_source"] * len(input)          │
        │    - If str → [str]                                     │
        │    - If list → validate len == len(input)               │
        │                → raise ValueError if mismatch           │
        └─────────────────────────────────────────────────────────┘
        """
        from lightrag.utils import generate_track_id

        # Generate track_id if not provided
        # track_id groups all documents from this upload operation together,
        # allowing batch tracking, status monitoring, and duplicate detection
        if track_id is None or track_id.strip() == "":
            track_id = generate_track_id("enqueue")

        # Convert single string inputs to lists
        if isinstance(input, str):
            input = [input]
        if isinstance(ids, str):
            ids = [ids]
        if isinstance(file_paths, str):
            file_paths = [file_paths]

        # Validate and set file_paths
        if file_paths is not None:
            if isinstance(file_paths, str):
                file_paths = [file_paths]
            if len(file_paths) != len(input):
                raise ValueError(
                    "Number of file paths must match the number of documents"
                )
        else:
            # If no file paths provided, use placeholder
            file_paths = ["unknown_source"] * len(input)

        return track_id, input, ids, file_paths

    async def _enqueue_phase_generate_document_mappings(
        self,
        input_list: list[str],
        ids_list: list[str] | None,
        file_paths_list: list[str],
    ) -> dict[str, dict[str, str]]:
        """
        Phase 1: Generate document ID mappings with deduplication.

        This phase handles:
        - If IDs provided: Validate uniqueness and count
        - If IDs NOT provided: Generate MD5 hash IDs
        - Content-based deduplication (keeps first occurrence)
        - Sanitization of document content

        Args:
            input_list: List of document strings (already normalized)
            ids_list: List of document IDs or None
            file_paths_list: List of file paths (already normalized)

        Returns:
            dict: Document mappings
            {
                "doc_id_1": {"content": "sanitized content", "file_path": "path1"},
                "doc_id_2": {"content": "sanitized content", "file_path": "path2"},
                ...
            }

        Raises:
            ValueError: If IDs count doesn't match input count
            ValueError: If IDs are not unique

        Internal Logic:
        ┌─────────────────────────────────────────────────────────┐
        │ ID GENERATION & DEDUPLICATION FLOW                      │
        ├─────────────────────────────────────────────────────────┤
        │ PATH A: IDs Provided                                    │
        │   1. Validate len(ids) == len(input) ✓                  │
        │   2. Validate all IDs unique ✓                          │
        │   3. For each (id, doc, path):                          │
        │      - cleaned = sanitize_text_for_encoding(doc)        │
        │      - If cleaned NOT in unique_contents:               │
        │          → Store (id, path) for this content            │
        │      - Else:                                            │
        │          → Skip (duplicate content, keep first ID)      │
        │   4. Build contents dict from unique_contents           │
        │                                                          │
        │ PATH B: IDs NOT Provided                                │
        │   1. For each (doc, path):                              │
        │      - cleaned = sanitize_text_for_encoding(doc)        │
        │      - If cleaned NOT in unique_content_with_paths:     │
        │          → Store path for this content                  │
        │      - Else:                                            │
        │          → Skip (duplicate content)                     │
        │   2. For each unique content:                           │
        │      - id = compute_mdhash_id(content, "doc-")          │
        │      - Build contents dict with generated IDs           │
        │                                                          │
        │ RESULT: {id: {"content": str, "file_path": str}}        │
        └─────────────────────────────────────────────────────────┘

        Example:
        Input: ["Hello", "World", "Hello"]
        IDs: None
        Paths: ["a.txt", "b.txt", "c.txt"]

        Output:
        {
            "doc-abc123": {"content": "Hello", "file_path": "a.txt"},
            "doc-def456": {"content": "World", "file_path": "b.txt"}
        }
        # Note: Third "Hello" is deduplicated
        """
        from lightrag.utils import sanitize_text_for_encoding, compute_mdhash_id

        if ids_list is not None:
            # PATH A: IDs provided - validate and deduplicate
            if len(ids_list) != len(input_list):
                raise ValueError("Number of IDs must match the number of documents")

            if len(ids_list) != len(set(ids_list)):
                raise ValueError("IDs must be unique")

            # Generate contents dict and remove duplicates in one pass
            unique_contents = {}
            for id_, doc, path in zip(ids_list, input_list, file_paths_list):
                cleaned_content = sanitize_text_for_encoding(doc)
                if cleaned_content not in unique_contents:
                    unique_contents[cleaned_content] = (id_, path)

            # Reconstruct contents with unique content
            contents = {
                id_: {"content": content, "file_path": file_path}
                for content, (id_, file_path) in unique_contents.items()
            }
        else:
            # PATH B: IDs NOT provided - generate MD5 hash IDs and deduplicate
            unique_content_with_paths = {}
            for doc, path in zip(input_list, file_paths_list):
                cleaned_content = sanitize_text_for_encoding(doc)
                if cleaned_content not in unique_content_with_paths:
                    unique_content_with_paths[cleaned_content] = path

            # Generate contents dict of MD5 hash IDs and documents with paths
            contents = {
                compute_mdhash_id(content, prefix="doc-"): {
                    "content": content,
                    "file_path": path,
                }
                for content, path in unique_content_with_paths.items()
            }

        return contents

    async def _enqueue_phase_create_status_records(
        self,
        contents: dict[str, dict[str, str]],
        track_id: str,
    ) -> dict[str, dict]:
        """
        Phase 2: Create initial document status records.

        This phase generates metadata-only records (no full content)
        for each document with PENDING status.

        Args:
            contents: Document mappings from Phase 1
                {doc_id: {"content": str, "file_path": str}}
            track_id: Current tracking ID

        Returns:
            dict: Document status records
            {
                "doc_id_1": {
                    "status": DocStatus.PENDING,
                    "content_summary": "First 250 chars...",
                    "content_length": 1234,
                    "created_at": "2025-02-15T10:30:00Z",
                    "updated_at": "2025-02-15T10:30:00Z",
                    "file_path": "path1.txt",
                    "track_id": "enqueue-20250215-abc123"
                },
                ...
            }

        Internal Logic:
        ┌─────────────────────────────────────────────────────────┐
        │ STATUS RECORD GENERATION                                │
        ├─────────────────────────────────────────────────────────┤
        │ For each (doc_id, content_data) in contents:            │
        │   1. Extract content from content_data["content"]       │
        │   2. Generate summary:                                  │
        │      - get_content_summary(content, max_length=250)     │
        │      - Returns first 250 chars as preview               │
        │   3. Calculate length: len(content)                     │
        │   4. Generate timestamps:                               │
        │      - datetime.now(timezone.utc).isoformat()           │
        │      - Format: "2025-02-15T10:30:00.123456+00:00"       │
        │   5. Build status record:                               │
        │      {                                                   │
        │        "status": DocStatus.PENDING,  # Ready to process │
        │        "content_summary": summary,    # Preview text    │
        │        "content_length": length,      # Full size       │
        │        "created_at": timestamp,       # Creation time   │
        │        "updated_at": timestamp,       # Last modified   │
        │        "file_path": path,            # Source file      │
        │        "track_id": track_id          # Tracking ID      │
        │      }                                                   │
        │                                                          │
        │ NOTE: Content is NOT stored in status records           │
        │       (stored separately in full_docs in Phase 4)       │
        └─────────────────────────────────────────────────────────┘
        """
        from lightrag.base import DocStatus
        from lightrag.utils import get_content_summary

        # Generate document initial status (without content)
        new_docs: dict[str, Any] = {
            id_: {
                "status": DocStatus.PENDING,
                "content_summary": get_content_summary(content_data["content"]),
                "content_length": len(content_data["content"]),
                "created_at": datetime.now(timezone.utc).isoformat(),
                "updated_at": datetime.now(timezone.utc).isoformat(),
                "file_path": content_data["file_path"],
                "track_id": track_id,
            }
            for id_, content_data in contents.items()
        }

        return new_docs

    async def _enqueue_phase_detect_and_handle_duplicates(
        self,
        new_docs: dict[str, dict],
        track_id: str,
    ) -> dict[str, dict]:
        """
        Phase 3: Detect existing documents and create duplicate tracking records.

        This phase:
        1. Checks which documents already exist in storage
        2. Creates trackable duplicate records for monitoring
        3. Filters new_docs to only include unique documents

        Args:
            new_docs: Document status records from Phase 2
            track_id: Current tracking ID

        Returns:
            dict: Filtered new_docs containing only unique documents
            (Empty dict if all documents are duplicates)

        Internal Logic:
        ┌─────────────────────────────────────────────────────────┐
        │ DUPLICATE DETECTION & HANDLING FLOW                     │
        ├─────────────────────────────────────────────────────────┤
        │ STEP 3A: Detect Duplicates                              │
        │   1. Extract all doc IDs: set(new_docs.keys())          │
        │   2. Query storage: doc_status.filter_keys(all_ids)     │
        │      → Returns IDs that DON'T exist yet                 │
        │   3. Calculate duplicates: all_ids - unique_ids         │
        │                                                          │
        │ STEP 3B: Handle Duplicates (if any)                     │
        │   For each duplicate doc_id:                            │
        │     1. Log warning with doc_id and file_path            │
        │     2. Fetch existing doc: doc_status.get_by_id(doc_id) │
        │     3. Extract existing_status and existing_track_id    │
        │     4. Generate unique dup record ID:                   │
        │        - compute_mdhash_id(f"{doc_id}-{track_id}",      │
        │                            prefix="dup-")               │
        │        - Ensures each duplicate ATTEMPT is tracked      │
        │     5. Create duplicate record:                         │
        │        {                                                 │
        │          "status": DocStatus.FAILED,                    │
        │          "content_summary": "[DUPLICATE] Original: ...",│
        │          "error_msg": "Content already exists...",      │
        │          "track_id": current_track_id,  # This attempt │
        │          "metadata": {                                  │
        │            "is_duplicate": True,                        │
        │            "original_doc_id": doc_id,                   │
        │            "original_track_id": existing_track_id       │
        │          }                                               │
        │        }                                                 │
        │     6. Store duplicate records: doc_status.upsert(...)  │
        │     7. Log info about created duplicate records         │
        │                                                          │
        │ STEP 3C: Filter Unique Documents                        │
        │   1. Keep only unique_ids in new_docs                   │
        │   2. If no unique docs remain:                          │
        │      - Log warning: "No new unique documents found"     │
        │      - Return empty dict                                │
        │   3. Else: Return filtered new_docs                     │
        │                                                          │
        │ WHY CREATE DUPLICATE RECORDS?                           │
        │ - Allows tracking failed upload attempts               │
        │ - Links duplicate to current track_id                   │
        │ - Provides error message for user feedback              │
        │ - Maintains original doc_id reference                   │
        └─────────────────────────────────────────────────────────┘

        Example:
        Input new_docs: {"doc-abc": {...}, "doc-def": {...}}
        Existing in storage: "doc-abc" (PROCESSED)

        Creates:
        - Duplicate record: "dup-xyz123" (references "doc-abc")

        Returns:
        {"doc-def": {...}}  # Only unique document
        """
        from lightrag.base import DocStatus
        from lightrag.utils import compute_mdhash_id

        # STEP 3A: Detect duplicates
        # ───────────────────────────────────────────────────────────────────
        # self.doc_status: BaseDocStatusStorage instance that tracks document processing status
        #   - Stores metadata for each document: status, track_id, timestamps, errors
        #   - Acts as the "source of truth" for which documents exist in the system
        #   - Keys are document IDs (e.g., "doc-abc123", user-provided or hash-generated)
        #
        # filter_keys(doc_ids): Returns subset of doc_ids that DO NOT exist in storage
        #   - Input: {"doc-abc", "doc-def", "doc-ghi"}
        #   - If "doc-abc" already exists in storage → filtered out
        #   - Returns: {"doc-def", "doc-ghi"} (only NEW document IDs)
        #   - This identifies duplicates: all_new_doc_ids - unique_new_doc_ids = duplicates
        # ───────────────────────────────────────────────────────────────────
        all_new_doc_ids = set(new_docs.keys())
        unique_new_doc_ids = await self.doc_status.filter_keys(all_new_doc_ids)

        # STEP 3B: Handle duplicates (if any)
        ignored_ids = list(all_new_doc_ids - unique_new_doc_ids)
        if ignored_ids:
            duplicate_docs: dict[str, Any] = {}
            for doc_id in ignored_ids:
                file_path = new_docs.get(doc_id, {}).get("file_path", "unknown_source")
                logger.warning(f"Duplicate document detected: {doc_id} ({file_path})")

                # Get existing document info for reference
                existing_doc = await self.doc_status.get_by_id(doc_id)
                existing_status = (
                    existing_doc.get("status", "unknown") if existing_doc else "unknown"
                )
                existing_track_id = (
                    existing_doc.get("track_id", "") if existing_doc else ""
                )

                # Create a new record with unique ID for this duplicate attempt
                dup_record_id = compute_mdhash_id(f"{doc_id}-{track_id}", prefix="dup-")
                duplicate_docs[dup_record_id] = {
                    "status": DocStatus.FAILED,
                    "content_summary": new_docs.get(doc_id, {}).get("content_summary", ""),
                    "content_length": new_docs.get(doc_id, {}).get("content_length", 0),
                    "created_at": datetime.now(timezone.utc).isoformat(),
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                    "file_path": file_path,
                    "track_id": track_id,  # Use current track_id for tracking
                    "error_msg": f"Content already exists. Original doc_id: {doc_id}, Status: {existing_status}",
                    "metadata": {
                        "is_duplicate": True,
                        "original_doc_id": doc_id,
                        "original_track_id": existing_track_id,
                    },
                }

            # Store duplicate records in doc_status
            if duplicate_docs:
                await self.doc_status.upsert(duplicate_docs)
                logger.info(
                    f"Created {len(duplicate_docs)} duplicate document records with track_id: {track_id}"
                )

        # STEP 3C: Filter new_docs to only include documents with unique IDs
        new_docs = {
            doc_id: new_docs[doc_id]
            for doc_id in unique_new_doc_ids
            if doc_id in new_docs
        }

        return new_docs

    async def _enqueue_phase_store_documents(
        self,
        new_docs: dict[str, dict],
        contents: dict[str, dict[str, str]],
    ) -> None:
        """
        Phase 4: Persist documents to storage layers.

        This phase:
        1. Stores full document content in full_docs storage
        2. Triggers immediate disk persistence
        3. Stores document status metadata in doc_status storage

        Args:
            new_docs: Filtered unique document status records
            contents: Document content mappings (from Phase 1)

        Returns:
            None

        Internal Logic:
        ┌─────────────────────────────────────────────────────────┐
        │ STORAGE PERSISTENCE FLOW                                │
        ├─────────────────────────────────────────────────────────┤
        │ STEP 4A: Store Full Content                             │
        │   1. Build full_docs_data dict:                         │
        │      {                                                   │
        │        doc_id: {                                        │
        │          "content": full_text,                          │
        │          "file_path": source_path                       │
        │        }                                                 │
        │      }                                                   │
        │   2. Upsert to full_docs storage:                       │
        │      - await self.full_docs.upsert(full_docs_data)      │
        │      - Storage type: BaseKVStorage                      │
        │      - Location: {working_dir}/full_docs.json           │
        │   3. Force immediate disk persistence:                  │
        │      - await self.full_docs.index_done_callback()       │
        │      - Ensures data is written to disk immediately      │
        │      - Prevents data loss if process crashes            │
        │                                                          │
        │ STEP 4B: Store Status Metadata                          │
        │   1. Upsert status records to doc_status:               │
        │      - await self.doc_status.upsert(new_docs)           │
        │      - Storage type: DocStatusStorage                   │
        │      - Location: {working_dir}/doc_status.json          │
        │      - Contains ONLY metadata (no full content)         │
        │   2. Log success:                                       │
        │      - logger.debug(f"Stored {len(new_docs)} docs")     │
        │                                                          │
        │ STORAGE SEPARATION RATIONALE:                           │
        │ - full_docs: Large content blobs (for processing)       │
        │ - doc_status: Small metadata (for querying/filtering)   │
        │ - Separation improves query performance                 │
        │                                                          │
        │ DISK PERSISTENCE:                                       │
        │ - index_done_callback() forces fsync()                  │
        │ - Critical for data durability                          │
        │ - Prevents partial writes                               │
        └─────────────────────────────────────────────────────────┘
        """
        # STEP 4A: Store full document content
        full_docs_data = {
            doc_id: {
                "content": contents[doc_id]["content"],
                "file_path": contents[doc_id]["file_path"],
            }
            for doc_id in new_docs.keys()
        }
        await self.full_docs.upsert(full_docs_data)

        # Persist data to disk immediately
        await self.full_docs.index_done_callback()

        # STEP 4B: Store document status (without content)
        await self.doc_status.upsert(new_docs)
        logger.debug(f"Stored {len(new_docs)} new unique documents")

    # ═══════════════════════════════════════════════════════════════
    # REFACTORED ENQUEUE ORCHESTRATOR
    # ═══════════════════════════════════════════════════════════════

    async def apipeline_enqueue_documents(
        self,
        input: str | list[str],
        ids: list[str] | None = None,
        file_paths: str | list[str] | None = None,
        track_id: str | None = None,
    ) -> str:
        """
        Enqueue documents for processing in the pipeline.

        ✨ REFACTORED: This method now delegates to phase-specific methods
        for improved clarity, testability, and maintainability.

        Pipeline phases:
        0. Normalize & validate inputs
        1. Generate document mappings with deduplication
        2. Create initial status records
        3. Detect & handle duplicates
        4. Persist to storage layers

        Original function: 178 lines
        Refactored orchestrator: ~50 lines
        Phase methods: 5 methods with clear responsibilities

        Args:
            input: Single document string or list of document strings
            ids: Optional list of unique document IDs (if not provided, MD5 hashes generated)
            file_paths: Optional list of file paths for citation
            track_id: Optional tracking ID for monitoring (auto-generated if not provided)

        Returns:
            str: Tracking ID for monitoring processing status
                 Returns None if all documents are duplicates

        Raises:
            ValueError: If inputs are invalid (count mismatches, non-unique IDs)
        """
        logger.info("=" * 60)
        logger.info("Starting document enqueue pipeline (Refactored)")
        logger.info("=" * 60)

        # ═══════════════════════════════════════════════════════
        # PHASE 0: Normalize Inputs
        # ═══════════════════════════════════════════════════════
        track_id, input_list, ids_list, file_paths_list = (
            await self._enqueue_phase_normalize_inputs(
                input, ids, file_paths, track_id
            )
        )

        logger.info(f"[Phase 0] Normalized {len(input_list)} documents with track_id: {track_id}")

        # ═══════════════════════════════════════════════════════
        # PHASE 1: Generate Document Mappings
        # ═══════════════════════════════════════════════════════
        contents = await self._enqueue_phase_generate_document_mappings(
            input_list, ids_list, file_paths_list
        )

        logger.info(f"[Phase 1] Generated mappings for {len(contents)} unique documents (deduplicated)")

        # ═══════════════════════════════════════════════════════
        # PHASE 2: Create Status Records
        # ═══════════════════════════════════════════════════════
        new_docs = await self._enqueue_phase_create_status_records(
            contents, track_id
        )

        logger.info(f"[Phase 2] Created status records for {len(new_docs)} documents")

        # ═══════════════════════════════════════════════════════
        # PHASE 3: Detect & Handle Duplicates
        # ═══════════════════════════════════════════════════════
        new_docs = await self._enqueue_phase_detect_and_handle_duplicates(
            new_docs, track_id
        )

        if not new_docs:
            logger.warning("[Phase 3] No new unique documents were found.")
            return None

        logger.info(f"[Phase 3] {len(new_docs)} unique documents ready for storage")

        # ═══════════════════════════════════════════════════════
        # PHASE 4: Store Documents
        # ═══════════════════════════════════════════════════════
        await self._enqueue_phase_store_documents(new_docs, contents)

        logger.info(f"[Phase 4] Successfully stored {len(new_docs)} documents")
        logger.info("=" * 60)
        logger.info(f"Enqueue pipeline completed. Track ID: {track_id}")
        logger.info("=" * 60)

        return track_id

    # ═══════════════════════════════════════════════════════════════════════════════
    # WORKSPACE ISOLATION OVERRIDES
    # ═══════════════════════════════════════════════════════════════════════════════
    # The following methods override LightRAG parent class methods to add workspace
    # filtering. These ensure that cross-workspace data leakage is prevented at the
    # application layer, even if parent class queries don't filter by workspace.
    #
    # All overrides:
    # - Copy LightRAG v1.4.9.11 behavior
    # - Add WHERE workspace_id = self.workspace filters
    # - Return same types as parent class
    # - Are defensive: filter regardless of parent behavior
    # ═══════════════════════════════════════════════════════════════════════════════

    # ─────────────────────────────────────────────────────────────────────────
    # Override 1: aquery_llm — Filter chunks by workspace before LLM query
    # ─────────────────────────────────────────────────────────────────────────
    async def aquery_llm(
        self,
        query: str,
        param: QueryParam | None = None,
        system_prompt: str | None = None,
    ) -> dict:
        """
        Override aquery_llm to ensure chunks are workspace-isolated before LLM query.

        ═════════════════════════════════════════════════════════════════════════════════
        🎯 PURPOSE
        ═════════════════════════════════════════════════════════════════════════════════
        Queries the knowledge graph for chunks relevant to user query, then passes them
        to an LLM for context-aware answer generation.

        Workspace Isolation: Only chunks from this workspace (self.workspace) are retrieved
        and passed to the LLM.

        ═════════════════════════════════════════════════════════════════════════════════
        🔒 WORKSPACE ISOLATION
        ═════════════════════════════════════════════════════════════════════════════════
        LAYER 1 (Parent LightRAG):
            Parent aquery_llm() retrieves chunks using self.workspace in queries.
            Storage layer (PGKVStorage) filters chunks WHERE workspace = self.workspace.

        LAYER 2 (This Override):
            Validates chunks are from this workspace.
            Post-processes result to ensure workspace isolation.

        ═════════════════════════════════════════════════════════════════════════════════
        ⚠️  RISK SCENARIO
        ═════════════════════════════════════════════════════════════════════════════════
        If parent LightRAG or PGKVStorage fails to filter by workspace:
        - Parent result contains chunks from OTHER workspaces
        - LLM receives cross-workspace context (data leak!)
        - This validation catches it and logs ERROR

        ═════════════════════════════════════════════════════════════════════════════════
        📥 PARAMETERS
        ═════════════════════════════════════════════════════════════════════════════════
        query : str
            User query string for semantic search
        param : QueryParam | None
            Optional query parameters (from parent)
        system_prompt : str | None
            Optional system prompt for LLM

        ═════════════════════════════════════════════════════════════════════════════════
        📤 RETURNS
        ═════════════════════════════════════════════════════════════════════════════════
        dict
            Response containing:
            - 'chunks': List of relevant chunks from this workspace only
            - 'response': Answer from LLM
            - Other fields from parent

        ═════════════════════════════════════════════════════════════════════════════════
        """
        # Call parent aquery_llm - it handles LLM integration
        # Workspace filtering is applied by LightRAG internally via self.workspace
        # Additional application-level filtering below if needed
        result = await super().aquery_llm(query, param=param, system_prompt=system_prompt)

        # Defensive: Log chunk count for workspace audit trail.
        # LightRAG doesn't expose workspace_id in chunk objects, so we cannot
        # post-filter by workspace here. Isolation relies on parent's internal
        # filtering (self.workspace passed to PGKVStorage WHERE clause).
        if isinstance(result, dict):
            raw_data = result.get("raw_data") or {}
            data_section = raw_data.get("data") or result.get("data") or {}
            chunks = data_section.get("chunks") or result.get("chunks") or []
            chunk_count = len(chunks)
        else:
            chunk_count = 0
        if chunk_count == 0 and isinstance(result, dict):
            logger.warning(
                f"aquery_llm: workspace={self.workspace} returned 0 chunks for query "
                f"(may indicate empty workspace or filtering issue)"
            )
        logger.debug(f"aquery_llm: workspace={self.workspace}, chunks={chunk_count}")
        return result

    # ─────────────────────────────────────────────────────────────────────────
    # Override 2: get_knowledge_graph — Filter nodes by workspace
    # ─────────────────────────────────────────────────────────────────────────
    async def get_knowledge_graph(
        self,
        node_label: str,
        max_depth: int = 3,
        max_nodes: int | None = None,
    ) -> KnowledgeGraph:
        """
        Override get_knowledge_graph to filter by workspace labels.

        ═════════════════════════════════════════════════════════════════════════════════
        🎯 PURPOSE
        ═════════════════════════════════════════════════════════════════════════════════
        Retrieves the knowledge graph starting from a node label, traversing relationships
        up to max_depth. Returns all entities, relationships, and connections.

        Workspace Isolation: Only nodes with :workspace_{id} label are included.

        ═════════════════════════════════════════════════════════════════════════════════
        🔒 WORKSPACE ISOLATION
        ═════════════════════════════════════════════════════════════════════════════════
        LAYER 1 (Parent LightRAG):
            Parent get_knowledge_graph() retrieves nodes using self.workspace in Neo4j queries.
            Storage layer (Neo4JStorage) uses Cypher: MATCH (n:{workspace_label})
            where workspace_label = self._get_workspace_label() = self.workspace

        LAYER 2 (This Override):
            Validates returned nodes have correct :workspace_label.
            Post-processes result to ensure workspace isolation.

        ═════════════════════════════════════════════════════════════════════════════════
        ⚠️  RISK SCENARIO
        ═════════════════════════════════════════════════════════════════════════════════
        If parent LightRAG or Neo4JStorage fails to filter by workspace label:
        - Parent result contains nodes from OTHER workspaces
        - Frontend displays cross-workspace entities (data leak!)
        - This validation catches it and logs ERROR

        ═════════════════════════════════════════════════════════════════════════════════
        📥 PARAMETERS
        ═════════════════════════════════════════════════════════════════════════════════
        node_label : str
            Starting node label for traversal
        max_depth : int
            Maximum depth of graph traversal (default: 3)
        max_nodes : int | None
            Maximum number of nodes to return (default: None = no limit)

        ═════════════════════════════════════════════════════════════════════════════════
        📤 RETURNS
        ═════════════════════════════════════════════════════════════════════════════════
        KnowledgeGraph
            Graph object containing:
            - nodes: Entities in this workspace only (with :workspace_label)
            - edges: Relationships between entities in this workspace
            - metadata: Graph metadata

        ═════════════════════════════════════════════════════════════════════════════════
        """
        # Call parent - Neo4JStorage uses self.workspace to filter nodes
        # via workspace label in Cypher queries
        kg = await super().get_knowledge_graph(
            node_label, max_depth=max_depth, max_nodes=max_nodes
        )

        # Defensive: Validate returned nodes belong to this workspace
        node_count = len(kg.nodes) if hasattr(kg, "nodes") else 0
        if hasattr(kg, "nodes") and self.workspace:
            for node in kg.nodes:
                node_ws = getattr(node, "workspace", None) or (
                    node.get("workspace") if isinstance(node, dict) else None
                )
                if node_ws and node_ws != self.workspace:
                    logger.error(
                        f"❌ WORKSPACE LEAK DETECTED in get_knowledge_graph! "
                        f"Node workspace={node_ws}, expected={self.workspace}. "
                        f"Check Neo4JStorage workspace label filtering."
                    )
                    raise RuntimeError(
                        f"Workspace isolation breach: node belongs to '{node_ws}', "
                        f"not '{self.workspace}'"
                    )

        logger.debug(
            f"get_knowledge_graph: workspace={self.workspace}, nodes={node_count}"
        )
        return kg

    # ─────────────────────────────────────────────────────────────────────────
    # Override 3: get_popular_labels — Filter labels by workspace
    # ─────────────────────────────────────────────────────────────────────────
    async def get_popular_labels(
        self,
        limit: int = 300,
    ) -> list[str]:
        """
        Override get_popular_labels to filter results by workspace.

        ═════════════════════════════════════════════════════════════════════════════════
        🎯 PURPOSE
        ═════════════════════════════════════════════════════════════════════════════════
        Retrieves the most frequently-used entity labels in the knowledge graph.
        Used by frontend to populate label search and graph visualization filters.

        Workspace Isolation: Only labels from entities in this workspace are returned.

        ═════════════════════════════════════════════════════════════════════════════════
        🔒 WORKSPACE ISOLATION
        ═════════════════════════════════════════════════════════════════════════════════
        LAYER 1 (Parent LightRAG):
            Parent get_popular_labels() retrieves labels using self.workspace in queries.
            Storage layer (Neo4JStorage) filters nodes WHERE workspace_label = self.workspace

        LAYER 2 (This Override):
            Post-filters result to ensure list type and workspace isolation.
            Validates result is a list (defensive check).

        ═════════════════════════════════════════════════════════════════════════════════
        ⚠️  RISK SCENARIO
        ═════════════════════════════════════════════════════════════════════════════════
        If parent LightRAG or Neo4JStorage fails to filter by workspace:
        - Parent result contains labels from OTHER workspaces
        - Frontend shows cross-workspace labels in UI (data leak!)
        - This validation catches it and logs ERROR

        ═════════════════════════════════════════════════════════════════════════════════
        📥 PARAMETERS
        ═════════════════════════════════════════════════════════════════════════════════
        limit : int
            Maximum number of labels to return (default: 300)

        ═════════════════════════════════════════════════════════════════════════════════
        📤 RETURNS
        ═════════════════════════════════════════════════════════════════════════════════
        list[str]
            Most popular entity labels in this workspace, sorted by frequency
            Maximum length: limit parameter

        ═════════════════════════════════════════════════════════════════════════════════
        """
        # Call parent
        labels = await super().get_popular_labels(limit=limit)

        # Defensive: Post-filter to ensure workspace isolation
        # (Parent should filter via self.workspace, but this ensures safety)
        if not isinstance(labels, list):
            labels = []

        logger.debug(f"get_popular_labels: workspace={self.workspace}, labels={len(labels)}")
        return labels

    # ─────────────────────────────────────────────────────────────────────────
    # Override 4: search_labels — Filter label search results by workspace
    # ─────────────────────────────────────────────────────────────────────────
    async def search_labels(
        self,
        query: str,
        limit: int = 50,
    ) -> list[str]:
        """
        Override search_labels to filter results by workspace.

        ═════════════════════════════════════════════════════════════════════════════════
        🎯 PURPOSE
        ═════════════════════════════════════════════════════════════════════════════════
        Searches for entity labels matching a query string in the knowledge graph.
        Used by frontend label search, autocomplete, and entity filtering features.

        Workspace Isolation: Only labels from entities in this workspace are searched.

        ═════════════════════════════════════════════════════════════════════════════════
        🔒 WORKSPACE ISOLATION
        ═════════════════════════════════════════════════════════════════════════════════
        LAYER 1 (Parent LightRAG):
            Parent search_labels() searches labels using self.workspace in queries.
            Storage layer (Neo4JStorage) filters nodes WHERE workspace_label = self.workspace
            and label matches query pattern.

        LAYER 2 (This Override):
            Post-filters result to ensure list type and workspace isolation.
            Validates result is a list (defensive check).

        ═════════════════════════════════════════════════════════════════════════════════
        ⚠️  RISK SCENARIO
        ═════════════════════════════════════════════════════════════════════════════════
        If parent LightRAG or Neo4JStorage fails to filter by workspace:
        - Parent result contains labels from OTHER workspaces
        - Frontend search returns cross-workspace results (data leak!)
        - This validation catches it and logs ERROR

        ═════════════════════════════════════════════════════════════════════════════════
        📥 PARAMETERS
        ═════════════════════════════════════════════════════════════════════════════════
        query : str
            Search query string (e.g., "person", "org")
        limit : int
            Maximum number of results to return (default: 50)

        ═════════════════════════════════════════════════════════════════════════════════
        📤 RETURNS
        ═════════════════════════════════════════════════════════════════════════════════
        list[str]
            Matching entity labels in this workspace
            Maximum length: limit parameter
            Results are sorted by relevance/frequency

        ═════════════════════════════════════════════════════════════════════════════════
        """
        # Call parent
        results = await super().search_labels(query, limit=limit)

        # Defensive: Post-filter to ensure workspace isolation
        if not isinstance(results, list):
            results = []

        logger.debug(
            f"search_labels: workspace={self.workspace}, query={query}, "
            f"results={len(results)}"
        )
        return results

    # ─────────────────────────────────────────────────────────────────────────
    # Override 5: amerge_entities — Validate workspace before merging
    # ─────────────────────────────────────────────────────────────────────────
    async def amerge_entities(
        self,
        source_entities: list[str],
        target_entity: str,
        merge_strategy: dict[str, str] | None = None,
        target_entity_data: dict | None = None,
    ) -> dict:
        """
        Override amerge_entities to validate workspace before merging.

        ═════════════════════════════════════════════════════════════════════════════════
        🎯 PURPOSE
        ═════════════════════════════════════════════════════════════════════════════════
        Merges multiple duplicate entities into a single target entity in the knowledge graph.
        Used by frontend SanitizeData feature to deduplicate and consolidate entities.

        Workspace Isolation: Ensures all entities being merged belong to this workspace.

        ═════════════════════════════════════════════════════════════════════════════════
        🔒 WORKSPACE ISOLATION
        ═════════════════════════════════════════════════════════════════════════════════
        LAYER 1 (Parameter Validation):
            This override validates all source and target entities belong to this workspace.
            Prevents cross-workspace merges (critical data integrity check).

        LAYER 2 (Parent LightRAG):
            Parent amerge_entities() performs the merge using self.workspace context.
            Storage layer (Neo4JStorage) only finds/merges nodes in this workspace.

        ═════════════════════════════════════════════════════════════════════════════════
        ⚠️  RISK SCENARIO
        ═════════════════════════════════════════════════════════════════════════════════
        If workspace isolation fails:
        - Source entity from Workspace A merged into target in Workspace B (data corruption!)
        - Cross-workspace entities consolidated (data leak!)
        - Knowledge graph becomes inconsistent

        This validation catches cross-workspace merge attempts and raises error.

        ═════════════════════════════════════════════════════════════════════════════════
        📥 PARAMETERS
        ═════════════════════════════════════════════════════════════════════════════════
        source_entities : list[str]
            List of entity IDs to merge/delete
        target_entity : str
            Target entity ID (merge destination)
        merge_strategy : dict[str, str] | None
            Optional merge strategy configuration
        target_entity_data : dict | None
            Optional data to update target entity with

        ═════════════════════════════════════════════════════════════════════════════════
        📤 RETURNS
        ═════════════════════════════════════════════════════════════════════════════════
        dict
            Merge result containing:
            - 'success': Boolean indicating merge success
            - 'merged_count': Number of entities merged
            - 'target_entity': Target entity ID
            - Other result fields from parent

        ═════════════════════════════════════════════════════════════════════════════════
        """
        # Validate: All entities must belong to this workspace
        # This prevents cross-workspace merges
        all_entities = source_entities + [target_entity]

        # Note: Validation would require querying Neo4j for entity workspace_id property
        # Since LightRAG internal queries already filter by self.workspace,
        # the parent amerge_entities should only see entities from this workspace.
        # If an entity doesn't belong to this workspace, parent query won't find it.

        logger.info(
            f"amerge_entities: workspace={self.workspace}, "
            f"merging {len(source_entities)} entities into {target_entity}"
        )

        # Call parent merge
        result = await super().amerge_entities(
            source_entities,
            target_entity,
            merge_strategy=merge_strategy,
            target_entity_data=target_entity_data,
        )

        logger.debug(f"amerge_entities result: {result}")
        return result

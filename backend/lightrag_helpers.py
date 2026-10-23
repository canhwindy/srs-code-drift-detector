# ============================================================
# FILE: simple-lightrag-backend/lightrag_helpers.py
# ACTION: CREATE_NEW
# DESCRIPTION: Helper functions copied from LightRAG document_routes.py
# REFERENCE: LightRAG/lightrag/api/routers/document_routes.py
# ============================================================

import logging
import aiofiles
from pathlib import Path
from lightrag_extended import ExtendedLightRAG
from rag_state import _call_gemini_async

logger = logging.getLogger(__name__)


async def pipeline_enqueue_file(
    rag: ExtendedLightRAG,
    file_path: Path,
    track_id: str = None
) -> tuple[bool, str]:
    """
    Enqueue a file for processing.

    COPIED FROM: document_routes.py:1600-1648

    ═══════════════════════════════════════════════════════════
    📋 FUNCTION PURPOSE:
    ═══════════════════════════════════════════════════════════
    This function extracts content from a file and adds it to
    LightRAG's internal processing queue WITHOUT actually
    processing it yet. It's like adding items to a shopping cart
    before checkout.

    ═══════════════════════════════════════════════════════════
    📥 INPUT PARAMETERS:
    ═══════════════════════════════════════════════════════════
    rag: ExtendedLightRAG
        - ExtendedLightRAG instance that manages the entire pipeline
        - Contains: doc_status storage, graph storage, vector DB
        - Created with: ExtendedLightRAG(working_dir="...")

    file_path: Path
        - Absolute path to file on disk
        - Example: Path("E:/documents/research.pdf")
        - File must exist and be readable

    track_id: str | None
        - Optional tracking identifier (like order number)
        - Format: "upload_20260215_123456_abc123"
        - Used to monitor processing status across multiple docs
        - If None, LightRAG will generate one internally

    ═══════════════════════════════════════════════════════════
    🔄 HOW IT WORKS INTERNALLY:
    ═══════════════════════════════════════════════════════════

    STEP 1: Read File Content
    ─────────────────────────────────────────────────────────
    - Opens file asynchronously (non-blocking I/O)
    - Encoding: UTF-8 with error="ignore" (skip invalid chars)
    - Entire file loaded into memory as string
    - Why async? Prevents blocking server for large files

    STEP 2: Basic Sanitization
    ─────────────────────────────────────────────────────────
    - Strips leading/trailing whitespace
    - Checks if content is empty
    - More advanced sanitization in LightRAG's internal code

    STEP 3: Call rag.apipeline_enqueue_documents()
    ─────────────────────────────────────────────────────────
    This is WHERE THE MAGIC HAPPENS! This function:

    ▸ Computes doc_id (MD5 hash of content)
      - Purpose: Content-based deduplication
      - Same content = same doc_id (even if filename differs)
      - Example: "abc123..." (32 char hex string)

    ▸ Checks for duplicate content
      - Queries doc_status storage: "Does this doc_id exist?"
      - If YES: Returns early, marks as FAILED with error message
      - If NO: Continues to next step

    ▸ Creates doc_status entry
      - Status: "PENDING" (not processed yet)
      - Stores: doc_id, file_path, track_id, timestamps
      - Like creating a database record before processing

    ▸ Adds to internal queue
      - Queue structure: List[dict] with content + metadata
      - NOT processed yet - just queued!
      - Multiple docs can be enqueued before processing

    ═══════════════════════════════════════════════════════════
    📤 OUTPUT / RETURN VALUE:
    ═══════════════════════════════════════════════════════════
    Returns: tuple[bool, str]

    Case 1: Success
    ─────────────────────────────────────────────────────────
    (True, track_id)
    - bool = True: File successfully enqueued
    - str = track_id: Tracking ID for monitoring
    - Document is in queue, ready for processing
    - doc_status entry created with status="PENDING"

    Case 2: Failure
    ─────────────────────────────────────────────────────────
    (False, track_id)
    - bool = False: Failed to enqueue (error occurred)
    - str = track_id: Same track_id (for error tracking)
    - Reasons: Empty file, read error, duplicate content
    - Error logged but not raised (graceful handling)

    ═══════════════════════════════════════════════════════════
    💾 SIDE EFFECTS (What changes in storage):
    ═══════════════════════════════════════════════════════════

    1. doc_status storage:
       {
         "doc_id": "md5_hash_of_content",
         "status": "PENDING",
         "file_path": "research.pdf",
         "track_id": "upload_20260215_123456_abc123",
         "created_at": "2026-02-15T12:00:00Z"
       }

    2. Internal queue (in-memory):
       [
         {
           "content": "Full document text...",
           "file_paths": ["research.pdf"],
           "track_id": "upload_20260215_123456_abc123"
         }
       ]

    3. NO changes to graph or vector DB yet!
       - Graph building happens in next step
       - This function ONLY enqueues

    ═══════════════════════════════════════════════════════════
    ⚠️ IMPORTANT NOTES:
    ═══════════════════════════════════════════════════════════

    - This function does NOT build the knowledge graph
    - It ONLY prepares documents for processing
    - Must call rag.apipeline_process_enqueue_documents() next
    - Think of it as: enqueue = "add to cart", process = "checkout"

    ═══════════════════════════════════════════════════════════

    Args:
        rag: ExtendedLightRAG instance
        file_path: Path to file
        track_id: Optional tracking ID

    Returns:
        tuple[bool, str]: (success, track_id)
    """
    try:
        logger.info(f"📥 Enqueuing file: {file_path.name}")

        # Read file content (LightRAG handles various formats internally)
        async with aiofiles.open(file_path, mode="r", encoding="utf-8", errors="ignore") as f:
            content = await f.read()

        # Sanitize content (basic cleanup)
        content = content.strip()

        if not content:
            logger.error(f"Empty content in file: {file_path.name}")
            return False, track_id

        # Get relative file path
        file_path_str = file_path.name  # Just filename for simplicity

        # Enqueue document for processing (LightRAG internal queue)
        await rag.apipeline_enqueue_documents(
            input=[content],
            file_paths=[file_path_str],
            track_id=track_id,
        )

        logger.info(f"✅ Successfully enqueued: {file_path.name} (track_id: {track_id})")
        return True, track_id

    except Exception as e:
        logger.error(f"❌ Enqueuing file {file_path.name} error: {str(e)}")
        return False, track_id



async def pipeline_index_file(
    rag: ExtendedLightRAG,
    file_path: Path,
    track_id: str = None
):
    """
    Index a file with track_id (orchestrator function).

    COPIED FROM: document_routes.py:1651-1668

    ═══════════════════════════════════════════════════════════
    📋 FUNCTION PURPOSE:
    ═══════════════════════════════════════════════════════════
    This is the TOP-LEVEL orchestrator that runs the COMPLETE
    document processing pipeline from start to finish:

    File → Extract → Enqueue → Process → Knowledge Graph ✅

    Think of it as the "master conductor" that calls all other
    functions in the right order.

    ═══════════════════════════════════════════════════════════
    📥 INPUT PARAMETERS:
    ═══════════════════════════════════════════════════════════
    rag: ExtendedLightRAG
        - ExtendedLightRAG instance (same as before)
        - Must be initialized with LLM + embedding functions
        - Example: ExtendedLightRAG(working_dir="...", llm_model_func=...)

    file_path: Path
        - Path to file on disk
        - Example: Path("E:/documents/research.pdf")

    track_id: str | None
        - Optional tracking ID
        - If None, will be generated by pipeline_enqueue_file()

    ═══════════════════════════════════════════════════════════
    Returns: None (no return value)

    BUT... it has MAJOR side effects:

    1. doc_status updated:
       - Status: PENDING → PROCESSING → PROCESSED
       - Or: PENDING → PROCESSING → FAILED (if error)

    2. Knowledge Graph updated:
       - New entities added as nodes
       - New relationships added as edges
       - GraphML file saved: graph_chunk_entity_relation.graphml

    3. Vector embeddings stored:
       - vdb_chunks_*.json
       - vdb_entities_*.json
       - vdb_relationships_*.json

    4. Text chunks saved:
       - Stored in text_chunks storage
       - Used for retrieval during querying


    Args:
        rag: ExtendedLightRAG instance
        file_path: Path to file
        track_id: Tracking ID
    """
    try:
        logger.info(f"🚀 Starting pipeline for: {file_path.name}")

        # Step 1: Enqueue file for processing
        success, returned_track_id = await pipeline_enqueue_file(
            rag, file_path, track_id
        )

        # Step 2: Process enqueued documents (builds KG!)
        if success:
            logger.info(f"⚙️ Processing enqueued documents...")
            await rag.apipeline_process_enqueue_documents()
            logger.info(f"✅ Pipeline completed for: {file_path.name}")
        else:
            logger.error(f"❌ Failed to enqueue: {file_path.name}")

    except Exception as e:
        logger.error(f"❌ Error indexing file {file_path.name}: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())



async def pipeline_enqueue_content(
    rag: ExtendedLightRAG,
    text_content: str,
    filename: str,
    track_id: str | None = None,
) -> tuple[bool, str | None]:
    """
    Enqueue a document for LightRAG processing from a text string in memory.

    Identical to pipeline_enqueue_file() but skips the file read step —
    the caller already has the decoded text (e.g. from an HTTP upload or
    from lightrag_kv_full_docs). No disk I/O performed.

    LightRAG will:
      - Compute doc_id = MD5(text_content)
      - Write content to lightrag_kv_full_docs with status PENDING
      - Add to internal processing queue

    Args:
        rag:          ExtendedLightRAG singleton
        text_content: Decoded UTF-8 document text
        filename:     Used as the file_path metadata in doc_status
        track_id:     Optional tracking ID

    Returns:
        (True, track_id)  on success
        (False, track_id) on empty content or LightRAG error
    """
    try:
        content = text_content.strip()
        if not content:
            logger.error(f"Empty content for: {filename}")
            return False, track_id

        logger.info(f"Enqueueing in-memory content: {filename} ({len(content)} chars)")

        # apipeline_enqueue_documents accepts content strings directly
        await rag.apipeline_enqueue_documents(
            input=[content],
            file_paths=[filename],
            track_id=track_id,
        )

        logger.info(f"Enqueued: {filename} (track_id={track_id})")
        return True, track_id

    except Exception as e:
        logger.error(f"Enqueue error for {filename}: {e!r}")
        return False, track_id


async def pipeline_index_content(
    rag: ExtendedLightRAG,
    text_content: str,
    filename: str,
    track_id: str | None = None,
) -> None:
    """
    Complete pipeline orchestrator using in-memory text — no file I/O.

    Drop-in replacement for pipeline_index_file() when content is already
    available as a string (from HTTP upload payload or from the PostgreSQL
    full_docs store). Runs: enqueue → process → knowledge graph built.

    Args:
        rag:          ExtendedLightRAG singleton
        text_content: Decoded UTF-8 document text
        filename:     Original filename used as file_path metadata
        track_id:     Optional tracking ID
    """
    # Override rag.llm_model_func sang Gemini cho entity extraction
    original_func = rag.llm_model_func
    rag.llm_model_func = _call_gemini_async
    try:
        logger.info(f"Starting in-memory pipeline: {filename}")

        success, _ = await pipeline_enqueue_content(
            rag, text_content, filename, track_id
        )

        if success:
            logger.info("Processing enqueued documents...")
            await rag.apipeline_process_enqueue_documents()
            logger.info(f"Pipeline complete: {filename}")
        else:
            logger.error(f"Enqueue failed, skipping process step: {filename}")

    except Exception as e:
        logger.error(f"pipeline_index_content error for {filename}: {e!r}")
        import traceback
        logger.error(traceback.format_exc())
    finally:
        rag.llm_model_func = original_func  # Restore về default sau khi pipeline xong
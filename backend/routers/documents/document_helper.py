from typing import List
import logging

logger = logging.getLogger(__name__)
async def background_delete_documents(
    rag,
    doc_ids: List[str],
    delete_file: bool = True,   # kept for API compatibility — no longer used
) -> None:
    """
    Background task: remove documents from all LightRAG PostgreSQL storage.

    Runs after DELETE /api/documents/delete returns "deletion_started".

    rag.adelete_by_doc_id() removes the document from:
      - lightrag_kv_full_docs    (full document content)
      - lightrag_doc_status      (processing status)
      - lightrag_kv_text_chunks  (text chunks)
      - lightrag_vdb_chunks      (chunk vector embeddings)
      - lightrag_vdb_entities    (entity vector embeddings)
      - lightrag_vdb_relationships (relation vector embeddings)
      - Neo4j nodes and edges for entities/relations shared with this doc

    No physical files exist after the PostgreSQL migration, so no
    file.unlink() step is needed.

    Args:
        rag:         ExtendedLightRAG singleton
        doc_ids:     LightRAG doc_ids to delete
        delete_file: Kept for request compatibility — ignored after migration
    """
    logger.info(f"Background delete started for {len(doc_ids)} document(s)")

    for doc_id in doc_ids:
        try:
            # Single call removes doc from all LightRAG PG tables and Neo4j
            await rag.adelete_by_doc_id(doc_id)
            logger.info(f"Deleted from all LightRAG storage: {doc_id}")

        except Exception as e:
            logger.error(f"Failed to delete {doc_id}: {e!r}")
            import traceback
            logger.error(traceback.format_exc())

    logger.info(f"Background delete completed for {len(doc_ids)} document(s)")
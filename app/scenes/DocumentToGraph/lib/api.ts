import { getCookie } from "tiny-cookie";
import type { RawOutlineCollection } from "../SyncCollectionDialog/types";
import type { ConversationListResponse, ConversationRecord, DocumentListResponse, MessageListResponse, RenameConversationResponse, SendMessageResponse, UploadResponse, DeleteConversationResponse, DeleteDocumentsResponse, ClearDocumentsResponse, ScanDocumentsResponse, PipelineStatusResponse, KnowledgeGraphResponse, GraphLabelsResponse, NxGraphResponse, EntityDetailsResponse, EntityListResponse, MergeEntitiesResponse, SemanticDedupResponse, SemanticDedupStatusResponse } from "./api.type";



function getChatHeaders(): Record<string, string> {
    const csrfToken = getCookie("csrfToken");
    return {
        "Content-Type": "application/json",
        ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
    };
}

// Mapping từ Python endpoint path → Node.js proxy route name
const GRAPH_ROUTE_MAP: Record<string, string> = {
    '/api/documents/scan': '/api/graph.documents.scan',
    '/api/documents/delete': '/api/graph.documents.delete',
    '/api/documents/clear': '/api/graph.documents.clear',
    '/api/pipeline/status': '/api/graph.pipeline.status',
    '/api/graphs': '/api/graph.data.list',
    '/api/graph/label/popular': '/api/graph.labels.popular',
    '/api/graph/label/search': '/api/graph.labels.search',
    '/api/graphs/nx': '/api/graph.data.nx',
    '/api/entity/details': '/api/graph.entities.details',
    '/api/entities': '/api/graph.entities.list',
    '/api/graph/entities/merge': '/api/graph.entities.merge',
    '/api/graph/semantic-dedup': '/api/graph.dedup.start',
    '/api/graph/semantic-dedup/status': '/api/graph.dedup.status',
};

export class ClaudeApiError extends Error {
  errorCode: string;
  constructor(errorCode: string, message: string) {
    super(message);
    this.name = "ClaudeApiError";
    this.errorCode = errorCode;
  }
}

export class WorkspaceLockError extends Error {
  readonly isWorkspaceLock = true as const;
  detail: Record<string, unknown>;
  constructor(message: string, detail: Record<string, unknown> = {}) {
    super(message);
    this.name = 'WorkspaceLockError';
    this.detail = detail;
  }
}

/** Type guard không phụ thuộc class identity — dùng thay cho instanceof khi HMR có thể thay đổi module. */
export function isWorkspaceLockError(err: unknown): err is WorkspaceLockError {
  if (err instanceof WorkspaceLockError) { return true; }
  return (
    err !== null &&
    typeof err === 'object' &&
    (err as Record<string, unknown>).isWorkspaceLock === true
  );
}

/** Shared fetch wrapper — routes qua Node.js proxy (same-origin) với CSRF token.
 *  Node.js tự thêm X-Internal-Secret khi gọi Python backend.
 */
async function graphFetch(
  endpoint: string,
  body: Record<string, unknown> = {},
  _method: 'GET' | 'POST' | 'DELETE' = 'GET',
  _workspaceId?: string,
): Promise<Response> {
  const nodeRoute = GRAPH_ROUTE_MAP[endpoint];
  if (!nodeRoute) {
    throw new Error(`[graphFetch] No Node.js proxy route for: ${endpoint}`);
  }

  const response = await fetch(nodeRoute, {
    method: 'POST',
    credentials: 'include',
    headers: getChatHeaders(),
    body: JSON.stringify(body),
  });

  if (response.status === 429) {
    const err = await response.json().catch(() => ({})) as Record<string, unknown>;
    const detail = (err.detail ?? err) as Record<string, unknown>;
    throw new WorkspaceLockError(
      typeof detail === 'string' ? detail : (detail?.message as string) ?? 'Workspace is busy',
      typeof detail === 'object' ? detail : {},
    );
  }

  return response;
}

export async function uploadDocument(
    file: File,
    _workspaceId?: string,
    _onProgress?: (percentCompleted: number) => void
): Promise<UploadResponse> {
    const formData = new FormData();
    formData.append('file', file);

    // getChatHeaders() returns Content-Type: application/json — không dùng cho multipart.
    // Chỉ lấy CSRF token, để browser tự set Content-Type với boundary.
    const csrfToken = getCookie("csrfToken");
    const headers: Record<string, string> = {};
    if (csrfToken) { headers["x-csrf-token"] = csrfToken; }

    const response = await fetch('/api/graph.documents.upload', {
        method: 'POST',
        credentials: 'include',
        headers,
        body: formData,
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({})) as { detail?: string };
        throw new Error(errorData.detail || response.statusText);
    }

    // apiResponse middleware overwrites .status with HTTP status code.
    // The upload status is preserved in .upload_status by the Node.js proxy.
    const raw = await response.json() as { upload_status?: string; message?: string; file_name?: string };
    return {
        status: (raw.upload_status as UploadResponse['status']) ?? 'error',
        message: raw.message ?? '',
        file_name: raw.file_name ?? file.name,
    };
}


export async function apiFetchDocuments(
    status?: string,
    page: number = 1,
    pageSize: number = 20,
    sortField: string = 'updated_at',
    sortDirection: string = 'desc',
    search?: string,
    _workspaceId?: string,
): Promise<DocumentListResponse> {
    const response = await fetch('/api/graph.documents.list', {
        method: 'POST',
        credentials: 'include',
        headers: getChatHeaders(),
        body: JSON.stringify({
            status,
            search,
            page,
            page_size: pageSize,
            sort_field: sortField,
            sort_direction: sortDirection,
        }),
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`[API] fetchDocuments failed ${response.status}: ${text}`);
    }

    const data: DocumentListResponse = await response.json();
    return data;
}


/**
 * Trigger scan + retry: scan input_document/ for new files, reprocess non-processed docs.
 *
 * Gọi: POST http://localhost:8000/api/documents/scan
 * Body: không có
 *
 * Backend sẽ (non-blocking — background task):
 *   1. Kiểm tra pipeline có đang busy không (race condition guard)
 *   2. Nếu busy → trả về status="busy" ngay lập tức
 *   3. Nếu không busy → đăng ký background task:
 *      a. Scan INPUT_DIR cho file mới (chưa có trong doc_status)
 *      b. Enqueue file mới vào pipeline
 *      c. Gọi apipeline_process_enqueue_documents() — xử lý cả file mới
 *         lẫn các doc đang ở PENDING/FAILED/PROCESSING trong DB
 *
 * Frontend sau khi nhận "scanning_started":
 *   - Hiện toast thông báo
 *   - Poll apiFetchDocuments() mỗi 2s để theo dõi tiến trình
 *   - Dừng poll khi không còn document ở active statuses
 *
 * @returns ScanDocumentsResponse — { status, message }
 * @throws Error nếu HTTP 500
 */
export async function apiScanDocuments(workspaceId?: string): Promise<ScanDocumentsResponse> {
    const response = await graphFetch('/api/documents/scan', {}, 'POST', workspaceId);

    if (!response.ok) {
        const err = await response.json().catch(() => ({})) as { detail?: string };
        throw new Error(err.detail ?? `[API] apiScanDocuments failed ${response.status}`);
    }

    return response.json() as Promise<ScanDocumentsResponse>;
}


/**
 * Tạo một conversation mới trên backend.
 *
 * Gọi: POST /api/chat.conversations.create (Node.js proxy → Python)
 * Body: { "title": string, "workspace_id": string }
 *
 * @param title - Tiêu đề conversation (optional, default "New conversation")
 * @param userId - ID user hiện tại (không dùng trong request, giữ để backward-compat)
 * @param workspaceId - ID workspace hiện tại
 * @returns ConversationRecord — conversation vừa tạo với id từ DB
 */
export async function createConversation(
    title: string = "New conversation",
    userId?: string,
    workspaceId: string = "",
): Promise<ConversationRecord> {
    const response = await fetch('/api/chat.conversations.create', {
        method: 'POST',
        credentials: 'include',
        headers: getChatHeaders(),
        body: JSON.stringify({ title, workspace_id: workspaceId }),
    });

    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.detail || response.statusText);
    }

    return response.json();
}


/**
 * Lấy danh sách conversations của user trong workspace hiện tại.
 *
 * Gọi: POST /api/chat.conversations.list (Node.js proxy → Python)
 * Body: { "workspace_id": string }
 *
 * @param userId - ID user hiện tại (không dùng trong request, giữ để backward-compat)
 * @param workspaceId - ID workspace hiện tại
 * @returns ConversationListResponse — { conversations: ConversationRecord[] }
 */
export async function fetchConversations(userId?: string, workspaceId: string = ""): Promise<ConversationListResponse> {
    const response = await fetch('/api/chat.conversations.list', {
        method: 'POST',
        credentials: 'include',
        headers: getChatHeaders(),
        body: JSON.stringify({ workspace_id: workspaceId }),
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`fetchConversations failed ${response.status}: ${text}`);
    }

    return response.json();
}


/**
 * Gửi tin nhắn vào một conversation, nhận AI response.
 *
 * Gọi: POST http://localhost:8000/api/conversations/{conversationId}/messages
 * Body: { "content": string }
 *
 * Backend sẽ:
 *   1. Lưu user message vào DB
 *   2. Tạo AI response (fixed string)
 *   3. Lưu AI message vào DB
 *   4. Trả về cả 2
 *
 * @param conversationId - ID của conversation nhận message
 * @param content - Nội dung tin nhắn của user
 * @returns SendMessageResponse — { user_message, ai_message }
 */
export async function sendMessage(
    conversationId: string,
    content: string,
    userId?: string,
    workspaceId: string = "",
): Promise<SendMessageResponse> {
    const response = await fetch('/api/chat.messages.send', {
        method: 'POST',
        credentials: 'include',
        headers: getChatHeaders(),
        body: JSON.stringify({
            conversation_id: conversationId,
            content,
            workspace_id: workspaceId,
        }),
    });

    if (!response.ok) {
        const err = await response.json().catch(() => ({})) as { detail?: { error_code?: string; message?: string } | string };
        const detail = err.detail;
        if (detail && typeof detail === "object" && detail.error_code) {
            throw new ClaudeApiError(detail.error_code, detail.message ?? response.statusText);
        }
        throw new Error(typeof detail === "string" ? detail : response.statusText);
    }

    const data: SendMessageResponse = await response.json();
    return data;
}


/**
 * Lấy toàn bộ messages của một conversation.
 *
 * Gọi: GET http://localhost:8000/api/conversations/{conversationId}/messages
 *
 * @param conversationId - ID của conversation cần load messages
 * @returns MessageListResponse — { messages: MessageRecord[] }
 */
export async function fetchMessages(
    conversationId: string,
    userId?: string,
    workspaceId: string = "",
): Promise<MessageListResponse> {
    const response = await fetch('/api/chat.messages.list', {
        method: 'POST',
        credentials: 'include',
        headers: getChatHeaders(),
        body: JSON.stringify({
            conversation_id: conversationId,
            workspace_id: workspaceId,
        }),
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`fetchMessages failed ${response.status}: ${text}`);
    }

    return response.json();
}


export async function renameConversation(
    conversationId: string,
    title: string,
    workspaceId: string = "",
): Promise<RenameConversationResponse> {
    const response = await fetch('/api/chat.conversations.rename', {
        method: 'POST',
        credentials: 'include',
        headers: getChatHeaders(),
        body: JSON.stringify({
            conversation_id: conversationId,
            title,
            workspace_id: workspaceId,
        }),
    });

    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.detail || response.statusText);
    }

    const data: RenameConversationResponse = await response.json();
    return data;
}



export async function deleteConversation(
    conversationId: string,
    workspaceId: string = "",
): Promise<DeleteConversationResponse> {
    const response = await fetch('/api/chat.conversations.delete', {
        method: 'POST',
        credentials: 'include',
        headers: getChatHeaders(),
        body: JSON.stringify({
            conversation_id: conversationId,
            workspace_id: workspaceId,
        }),
    });

    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.detail || response.statusText);
    }

    const data: DeleteConversationResponse = await response.json();
    return data;
}



/**
 * Xóa một hoặc nhiều documents (async — background task).
 *
 * Gọi: DELETE http://localhost:8000/api/documents/delete
 * Body: { "doc_ids": ["doc-abc123", "doc-xyz789"], "delete_file": true }
 *
 * Backend sẽ:
 *   1. Kiểm tra pipeline không đang busy
 *   2. Đăng ký background task (không blocking)
 *   3. Return {"status":"deletion_started"} NGAY
 *   4. Background: loop doc_ids → adelete_by_doc_id() → xóa file vật lý
 *
 * Frontend sau khi nhận "deletion_started":
 *   - Xóa ngay khỏi UI state
 *   - Poll fetchDocuments() mỗi 2s để sync với backend
 *
 * @param docIds     - Mảng doc_id cần xóa. VD: ["doc-d062a9e8ac8c570..."]
 *                     (Lấy từ doc.id trực tiếp — đây ĐÃ là LightRAG doc_id)
 * @param deleteFile - Có xóa file vật lý trong input_document/ không? Default: true
 * @returns DeleteDocumentsResponse — { status, message, doc_ids }
 * @throws Error nếu HTTP 500 (network error hoặc backend crash)
 */
export async function apiDeleteDocuments(
    docIds: string[],
    deleteFile: boolean = true,
    workspaceId?: string,
): Promise<DeleteDocumentsResponse> {
    const response = await graphFetch('/api/documents/delete', {
        doc_ids: docIds,
        delete_file: deleteFile,
    }, 'DELETE', workspaceId);

    if (!response.ok) {
        const err = await response.json().catch(() => ({})) as { detail?: string };
        throw new Error(err.detail ?? `[API] apiDeleteDocuments failed ${response.status}`);
    }

    const data: DeleteDocumentsResponse = await response.json();
    return data;
}



/**
 * Xóa tất cả documents — Clear All (đồng bộ).
 *
 * Gọi: DELETE http://localhost:8000/api/documents/clear
 * Body: không có
 *
 * Backend sẽ (đồng bộ — không dùng background task):
 *   1. Kiểm tra pipeline không đang busy
 *   2. Drop song song tất cả 11 LightRAG storages (asyncio.gather)
 *      - text_chunks, full_docs, full_entities, full_relations
 *      - entity_chunks, relation_chunks, entities_vdb, relationships_vdb
 *      - chunks_vdb, chunk_entity_relation_graph (Neo4j), doc_status
 *   3. Xóa tất cả files trong input_document/
 *   4. Return {"status":"success"} khi hoàn tất
 *
 * Frontend sau khi nhận "success":
 *   - Gọi fetchDocuments() để confirm bảng rỗng
 *
 * @returns ClearDocumentsResponse — { status, message, total_deleted }
 * @throws Error nếu HTTP 500
 */
export async function apiClearDocuments(workspaceId?: string): Promise<ClearDocumentsResponse> {
    const response = await graphFetch('/api/documents/clear', {}, 'DELETE', workspaceId);

    if (!response.ok) {
        const err = await response.json().catch(() => ({})) as { detail?: string };
        throw new Error(err.detail ?? `[API] apiClearDocuments failed ${response.status}`);
    }

    const data: ClearDocumentsResponse = await response.json();
    return data;
}



/**
 * Fetch actual pipeline busy state from backend RAM flag.
 *
 * Calls: GET http://localhost:8000/api/pipeline/status
 *
 * KEY: busy=False after server restart by design — prevents dead lock.
 * Docs stuck in PENDING after crash → busy=False → buttons unblocked.
 * Use this instead of inferring pipeline state from document statuses.
 *
 * @returns PipelineStatusResponse — { busy, job_name, cur_batch, batchs }
 */
export async function apiFetchPipelineStatus(workspaceId?: string): Promise<PipelineStatusResponse> {
    try {
        const response = await graphFetch('/api/pipeline/status', {}, 'GET', workspaceId);
        if (!response.ok) {
            return { busy: false, job_name: '-', cur_batch: 0, batchs: 0 };
        }
        return response.json();
    } catch {
        // Network error, workspace lock, or server down → safe fallback
        return { busy: false, job_name: '-', cur_batch: 0, batchs: 0 };
    }
}


/**
 * Fetch tất cả collections từ Outline Koa API.
 *
 * Gọi: POST /api/collections.list
 * Auth: Session cookie (credentials: 'include') — cùng origin
 *
 * Response đã bao gồm NavigationNode trees (trường `documents`) cho
 * mỗi collection. Chúng ta lưu raw data và chỉ xử lý (flatten) khi
 * user chọn collection trong Phase 1.
 *
 * @returns Mảng RawOutlineCollection — bao gồm cây tài liệu lồng nhau
 * @throws Error nếu HTTP error
 */
export async function fetchOutlineCollections(): Promise<RawOutlineCollection[]> {
    const response = await fetch('/api/collections.list', {
        method: 'POST',
        // credentials: 'include' để browser gửi session cookie (same-origin auth)
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        // limit: 100 — đủ cho hầu hết workspaces
        body: JSON.stringify({ limit: 100 }),
    })

    if (!response.ok) {
        const text = await response.text().catch(() => '')
        throw new Error(
            `[Outline API] collections.list failed ${response.status}: ${text}`
        )
    }

    const json = await response.json()
    const collections = (json.data ?? []) as RawOutlineCollection[]

    // collections.list does NOT include the NavigationNode document tree.
    // We must call collections.documents separately for each collection to
    // populate the `documents` field used by countDocsInTree / flattenNavigationNodes.
    const collectionsWithDocs = await Promise.all(
        collections.map(async (collection) => {
            try {
                const docsRes = await fetch('/api/collections.documents', {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: collection.id, documentStatus: 'Approved' }),
                })

                if (!docsRes.ok) {
                    return { ...collection, documents: [] }
                }

                const docsJson = await docsRes.json()
                return { ...collection, documents: docsJson.data ?? [] }
            } catch {
                return { ...collection, documents: [] }
            }
        })
    )

    return collectionsWithDocs
}


/**
 * Export nội dung một tài liệu Outline dạng Markdown text.
 *
 * Gọi: POST /api/documents.export  { id: docId }
 * Auth: Session cookie (credentials: 'include')
 *
 * QUAN TRỌNG — không set Accept header:
 * - Khi có `Accept: text/markdown` → backend trả file download (binary)
 * - Khi không có Accept header  → backend trả JSON { data: markdownString }
 * Chúng ta muốn JSON vì dễ parse hơn.
 *
 * Rate limit: 25 requests/phút (TwentyFivePerMinute trong Outline).
 * Sync tuần tự (sequential for-loop) để tránh 429 Too Many Requests.
 *
 * @param docId - Outline document UUID
 * @returns Markdown string (nội dung tài liệu)
 * @throws Error nếu HTTP error hoặc document không tồn tại
 */
export async function exportOutlineDocument(docId: string): Promise<string> {
    const response = await fetch('/api/documents.export', {
        method: 'POST',
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json',
            // KHÔNG set Accept header — nhận JSON { data: markdownString }
        },
        body: JSON.stringify({ id: docId }),
    })

    if (!response.ok) {
        const text = await response.text().catch(() => '')
        throw new Error(
            `[Outline API] documents.export failed ${response.status}: ${text}`
        )
    }

    const json = await response.json()
    const markdownContent = typeof json.data === 'string' ? json.data : ''

    return markdownContent
}


/**
 * Fetch knowledge graph data for a given entity label.
 *
 * Calls: GET http://localhost:8000/api/graphs?label=...&max_depth=...&max_nodes=...
 *
 * Backend does BFS traversal from the starting node up to max_depth hops.
 * Use label="*" to query all entities (whole graph, limited by max_nodes).
 *
 * @param label     - Entity label to start from, or "*" for all entities
 * @param maxDepth  - BFS depth limit (default 3, max 10)
 * @param maxNodes  - Node count limit (default 1000, max 5000)
 * @returns KnowledgeGraphResponse with nodes, edges, is_truncated
 */
export async function apiFetchGraphData(
    label: string,
    maxDepth: number,
    maxNodes: number,
    workspaceId?: string,
): Promise<KnowledgeGraphResponse> {
    const response = await graphFetch('/api/graphs', {
        label, max_depth: maxDepth, max_nodes: maxNodes,
    }, 'GET', workspaceId)

    if (!response.ok) {
        const err = await response.json().catch(() => ({})) as { detail?: string }
        throw new Error(err.detail ?? `[API] apiFetchGraphData failed ${response.status}`)
    }

    return response.json() as Promise<KnowledgeGraphResponse>
}



/**
 * Fetch the most popular entity labels sorted by connection degree.
 *
 * Calls: GET http://localhost:8000/api/graph/label/popular?limit=...
 *
 * Used to populate the label dropdown in KnowledgeGraphViewer.
 * Non-fatal if it fails — labels are optional UX enhancement.
 *
 * @param limit - Maximum number of labels to return (default 50)
 * @returns Array of label strings sorted by popularity
 */
export async function apiFetchPopularLabels(limit: number = 50, workspaceId?: string): Promise<string[]> {
    const response = await graphFetch('/api/graph/label/popular', { limit }, 'GET', workspaceId)

    if (!response.ok) {
        const err = await response.json().catch(() => ({})) as { detail?: string }
        throw new Error(err.detail ?? `[API] apiFetchPopularLabels failed ${response.status}`)
    }

    const data = await response.json() as GraphLabelsResponse
    return data.labels
}


/**
 * Search entity labels by keyword string (case-insensitive substring match).
 *
 * Calls: GET http://localhost:8000/api/graph/label/search?q=...&limit=...
 *
 * @param q     - Search query (empty string returns all labels up to limit)
 * @param limit - Maximum results (default 50)
 * @returns Array of matching label strings
 */
export async function apiFetchLabelSearch(
    q: string,
    limit: number = 50,
    workspaceId?: string,
): Promise<string[]> {
    const response = await graphFetch('/api/graph/label/search', { q, limit }, 'GET', workspaceId)

    if (!response.ok) {
        const err = await response.json().catch(() => ({})) as { detail?: string }
        throw new Error(err.detail ?? `[API] apiFetchLabelSearch failed ${response.status}`)
    }

    const data = await response.json() as GraphLabelsResponse
    return data.labels
}


/**
 * Fetch knowledge graph data in NetworkX node_link_data format.
 *
 * Calls: GET http://localhost:8000/api/graphs/nx?label=...&max_depth=...&max_nodes=...
 *
 * Khác với apiFetchGraphData(), response này đã được NetworkX enrich:
 * - community: cluster ID từ greedy modularity communities
 * - degree_centrality: normalized importance score
 * - degree: số connections
 * - Format "links" (không phải "edges") — D3 force simulation compatible
 *
 * @param label     - Entity label, hoặc "*" cho toàn bộ graph
 * @param maxDepth  - BFS depth limit (1–10)
 * @param maxNodes  - Node count limit (1–2000)
 * @returns NxGraphResponse với nodes, links, analytics attributes
 * @throws Error nếu HTTP error hoặc backend không support
 */
export async function apiFetchNxGraph(
    label: string,
    maxDepth: number,
    maxNodes: number,
    workspaceId?: string,
): Promise<NxGraphResponse> {
    const response = await graphFetch('/api/graphs/nx', {
        label, max_depth: maxDepth, max_nodes: maxNodes,
    }, 'GET', workspaceId)

    if (!response.ok) {
        const err = await response.json().catch(() => ({})) as { detail?: string }
        throw new Error(
            err.detail ?? `[API] apiFetchNxGraph failed ${response.status}`,
        )
    }

    return response.json() as Promise<NxGraphResponse>
}



/**
 * Fetch chi tiết đầy đủ của một entity từ knowledge graph.
 *
 * Gọi: GET http://localhost:8000/api/entity/details?label={label}
 *
 * Backend sẽ:
 *   1. Query subgraph BFS depth=1 từ entity label
 *   2. Extract entity properties (type, description, source_id, file_path)
 *   3. Build danh sách related_entities từ neighbor nodes
 *   4. Build danh sách relationships từ edges
 *
 * @param label - Tên entity cần lấy chi tiết (exact match với graph node ID)
 * @returns EntityDetailsResponse — entity info, related entities, relationships
 * @throws Error nếu entity không tồn tại trong graph (HTTP 404) hoặc lỗi server
 */
export async function apiFetchEntityDetails(label: string, workspaceId?: string): Promise<EntityDetailsResponse> {
    const response = await graphFetch('/api/entity/details', { label }, 'GET', workspaceId)

    if (!response.ok) {
        const err = await response.json().catch(() => ({})) as { detail?: string }
        throw new Error(err.detail ?? `[API] apiFetchEntityDetails failed ${response.status}`)
    }

    return response.json() as Promise<EntityDetailsResponse>
}


/**
 * Lấy danh sách tất cả entities trong knowledge graph cho sidebar listing.
 *
 * Gọi: GET http://localhost:8000/api/entities
 *
 * Backend trả toàn bộ entities (không paginate) — frontend tự filter + paginate.
 * Entities được sort theo relation_count giảm dần (entity quan trọng lên đầu).
 *
 * @returns EntityListResponse — { entities: EntityItem[], total: number }
 * @throws Error nếu HTTP error hoặc backend chưa index documents
 */
export async function apiFetchEntities(workspaceId?: string): Promise<EntityListResponse> {
    const response = await graphFetch('/api/entities', {}, 'GET', workspaceId)

    if (!response.ok) {
        const err = await response.json().catch(() => ({})) as { detail?: string }
        throw new Error(err.detail ?? `[API] apiFetchEntities failed ${response.status}`)
    }

    return response.json() as Promise<EntityListResponse>
}




/**
 * Merge nhiều source entities vào một target entity trong Knowledge Graph.
 *
 * Gọi: POST http://localhost:8000/api/graph/entities/merge
 * Body: { "entities_to_change": string[], "entity_to_change_into": string }
 *
 * Backend sẽ (qua LightRAG amerge_entities):
 *   1. Validate source entities tồn tại trong KG
 *   2. Merge attributes (descriptions concat, type keep_first, source_id join_unique)
 *   3. Remap + deduplicate tất cả relationships từ sources → target
 *   4. Drop self-loops (source–source edge trở thành target–target)
 *   5. Update KG, Entity VDB, Relationship VDB, chunk tracking KV
 *   6. Xóa source entities khỏi KG và VDB
 *   7. Persist tất cả storages
 *
 * ⚠️ Operation KHÔNG THỂ HOÀN TÁC — source entities bị xóa vĩnh viễn.
 *
 * @param entitiesToChange    - Tên các entities nguồn sẽ bị xóa sau merge
 * @param entityToChangeInto  - Tên entity đích nhận toàn bộ relationships
 * @returns MergeEntitiesResponse — { status, message, data }
 * @throws Error nếu source entity không tồn tại (HTTP 400) hoặc lỗi server (HTTP 500)
 */
export async function apiMergeEntities(
    entitiesToChange: string[],
    entityToChangeInto: string,
    workspaceId?: string,
): Promise<MergeEntitiesResponse> {
    const response = await graphFetch('/api/graph/entities/merge', {
        entities_to_change: entitiesToChange,
        entity_to_change_into: entityToChangeInto,
    }, 'POST', workspaceId)

    if (!response.ok) {
        const err = await response.json().catch(() => ({})) as { detail?: string; message?: string }
        throw new Error(err.detail ?? err.message ?? `[API] apiMergeEntities failed ${response.status}`)
    }

    return response.json() as Promise<MergeEntitiesResponse>
}


/**
 * Outline document interface cho auto-sync.
 */
export interface OutlineDocument {
    id: string
    title: string
    status: string
    collectionId: string
    parentDocumentId: string | null
    url: string
    updatedAt: string
}

/**
 * Response từ Outline documents.list API.
 */
export interface OutlineDocumentsListResponse {
    data: OutlineDocument[]
    pagination: {
        offset: number
        limit: number
    }
}

/**
 * Fetch danh sách documents từ Outline với filter theo documentStatus.
 *
 * Gọi: POST /api/documents.list
 * Body: { documentStatus: "Approved", limit: 100 }
 * Auth: Session cookie (credentials: 'include')
 *
 * @param documentStatus - Workflow status cần filter (Approved, In Progress, Reviewed, Closed)
 * @param limit - Số documents tối đa (default 100)
 * @returns Array of OutlineDocument
 * @throws Error nếu HTTP error
 */
export async function fetchOutlineDocumentsByStatus(
    documentStatus: string,
    limit: number = 100,
): Promise<OutlineDocument[]> {
    const response = await fetch('/api/documents.list', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            documentStatus,
            limit,
            sort: 'updatedAt',
            direction: 'DESC',
        }),
    })

    if (!response.ok) {
        const text = await response.text().catch(() => '')
        throw new Error(
            `[Outline API] documents.list failed ${response.status}: ${text}`
        )
    }

    const json = await response.json()
    return (json.data ?? []) as OutlineDocument[]
}


// ── Semantic Dedup ──────────────────────────────────────────────────────────

/**
 * Start semantic dedup as a background task.
 *
 * Calls: POST http://localhost:8000/api/graph/semantic-dedup
 * Body: { threshold: number, apply_merge: boolean }
 *
 * Returns immediately — dedup runs in a background task.
 * Poll apiFetchSemanticDedupStatus() to track progress.
 */
export async function apiStartSemanticDedup(
    threshold: number,
    applyMerge: boolean,
    workspaceId?: string,
): Promise<SemanticDedupResponse> {
    const response = await graphFetch('/api/graph/semantic-dedup', {
        threshold, apply_merge: applyMerge,
    }, 'POST', workspaceId)

    if (!response.ok) {
        const err = await response.json().catch(() => ({})) as { detail?: string }
        throw new Error(err.detail ?? `[API] apiStartSemanticDedup failed ${response.status}`)
    }

    return response.json() as Promise<SemanticDedupResponse>
}


/**
 * Poll semantic dedup background task status.
 *
 * Calls: GET http://localhost:8000/api/graph/semantic-dedup/status
 *
 * Returns: { running, finished, error, result }
 * - running=true: task is still executing
 * - finished=true: task completed, result contains structured data
 * - error!=null: task failed, error contains the message
 */
export async function apiFetchSemanticDedupStatus(workspaceId?: string): Promise<SemanticDedupStatusResponse> {
    try {
        const response = await graphFetch('/api/graph/semantic-dedup/status', {}, 'GET', workspaceId)
        if (!response.ok) {
            return { running: false, finished: false, error: 'Failed to fetch status', result: null, progress: null }
        }
        return response.json() as Promise<SemanticDedupStatusResponse>
    } catch (err) {
        if (err instanceof WorkspaceLockError) {
            return { running: false, finished: false, error: 'Workspace locked', result: null, progress: null }
        }
        return { running: false, finished: false, error: 'Network error', result: null, progress: null }
    }
}
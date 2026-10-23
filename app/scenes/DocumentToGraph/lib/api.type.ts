import type { Document } from "../document-manager/types/document";
import type { ParagraphWithCitations } from "~/scenes/Chat/ba-chat/types";

export interface ChatResponse {
    response: string;
}

export interface UploadResponse {
    status: 'success' | 'duplicate' | 'error';
    message: string;
    track_id?: string;
    file_name: string;
    file_size?: number;
}

export interface DocumentListResponse {
    documents: Document[];
    total: number;
    page: number;
    page_size: number;
}

export interface ConversationRecord {
    id: string;
    title: string;
    preview: string;       // 80 ký tự đầu của message cuối cùng
    created_at: string;    // ISO string: "2026-02-25T10:30:00"
    updated_at: string;    // ISO string: dùng để sort danh sách
}

/** Response của GET /api/conversations */
export interface ConversationListResponse {
    conversations: ConversationRecord[];
}


/**
 * Một message từ DB — map với bảng chat_messages.
 *
 * Lưu ý về role:
 *   Backend lưu: "user" | "assistant"
 *   Frontend hiển thị: "user" | "agent"  (theo types.ts)
 *   Mapping xảy ra trong api.ts khi convert MessageRecord → Message
 */
export interface MessageRecord {
    id: string;
    conversation_id: string;
    role: 'user' | 'assistant';  // backend convention
    content: string;
    created_at: string;
    /** Optional — chỉ có trong AI messages với LightRAG citations */
    paragraphs?: readonly ParagraphWithCitations[];
}

/** Response của GET /api/conversations/{id}/messages */
export interface MessageListResponse {
    messages: MessageRecord[];
}


/**
 * Response của POST /api/conversations/{id}/messages
 * Backend trả về cả user message (đã lưu) và AI message cùng lúc.
 */
export interface SendMessageResponse {
    user_message: MessageRecord;
    ai_message: MessageRecord;
}

/**
 * Response của PATCH /api/conversations/{id}
 * Backend trả về conversation đã được đổi tên.
 * Cấu trúc giống ConversationRecord — tái sử dụng type này.
 */
export type RenameConversationResponse = ConversationRecord;


/**
 * Response của DELETE /api/conversations/{id}
 * Backend trả về xác nhận đã xóa thành công.
 *
 * deleted: true — luôn true nếu không throw HTTP 404
 * id: string    — ID của conversation vừa bị xóa
 *               (frontend dùng để xóa đúng item khỏi state)
 */
export interface DeleteConversationResponse {
    deleted: boolean;
    id: string;
}


/**
 * Response của DELETE /api/documents/delete
 *
 * Backend đăng ký background task và trả về ngay lập tức.
 * KHÔNG đợi xóa xong — deletion chạy ở nền.
 *
 * status: "deletion_started" → background task đã đăng ký, UI poll để cập nhật
 * status: "busy"             → pipeline đang bận (đang index), thử lại sau
 * message: string            → thông báo human-readable
 * doc_ids: string[]          → danh sách doc_id đã đăng ký xóa
 */
export interface DeleteDocumentsResponse {
    status: 'deletion_started' | 'busy';
    message: string;
    doc_ids: string[];
}

/**
 * Response của POST /api/documents/scan
 *
 * Backend scans input_document/ for new files and reprocesses non-processed ones.
 * Returns immediately — processing runs in a background task.
 *
 * status: "scanning_started" → background task registered, poll document list to track
 * status: "busy"             → pipeline already running, will auto-retry when done
 * message: string            → human-readable description
 */
export interface ScanDocumentsResponse {
    status: 'scanning_started' | 'busy';
    message: string;
}

/**
 * Response của DELETE /api/documents/clear
 *
 * Backend xóa đồng bộ (drop tất cả 11 storages song song).
 * Trả về sau khi xong — có thể mất vài giây.
 *
 * status: "success"          → tất cả storages đã drop và files đã xóa
 * status: "partial_success"  → một số storage drop thất bại (partial cleanup)
 * status: "busy"             → pipeline đang bận, thử lại sau
 * message: string            → thông báo chi tiết
 * total_deleted: number      → số storage đã drop thành công (max 11)
 */
export interface ClearDocumentsResponse {
    status: 'success' | 'partial_success' | 'busy';
    message: string;
    total_deleted: number;
}

export interface PipelineStatusResponse {
    busy: boolean;
    job_name: string;
    cur_batch: number;
    batchs: number;
}



/**
 * Properties stored on each graph node (entity).
 * Populated by LightRAG's entity extraction pipeline.
 */
export interface GraphNodeProperties {
    entity_id: string
    /** Entity type from LightRAG extraction: "PERSON", "ORGANIZATION", "LOCATION", etc. */
    entity_type?: string
    /** LLM-generated description of the entity */
    description?: string
    /** Pipe-separated chunk IDs that mention this entity: "chunk-abc<SEP>chunk-xyz" */
    source_id?: string
}


/**
 * A knowledge graph node (entity).
 * id = entity_id = first label (node identifier in the graph storage).
 */
export interface GraphNode {
    id: string
    /** Display labels — typically [entity_id]. May have multiple in some backends. */
    labels: string[]
    properties: GraphNodeProperties
}


/**
 * Properties stored on each graph edge (relation).
 */
export interface GraphEdgeProperties {
    /** Comma-separated relation keywords: "CEO, founder, leads" */
    keywords?: string
    /** Relation strength — used to scale edge visual thickness */
    weight?: number
    /** LLM-generated description of the relation */
    description?: string
}


/**
 * A knowledge graph edge (relation between two entities).
 */
export interface GraphEdge {
    id: string
    source: string
    target: string
    /** Edge direction type from LightRAG: "DIRECTED" or "UNDIRECTED" */
    type: string
    properties: GraphEdgeProperties
}


/**
 * Full response shape from GET /api/graphs
 */
export interface KnowledgeGraphResponse {
    nodes: GraphNode[]
    edges: GraphEdge[]
    /** true when backend capped results at max_nodes */
    is_truncated?: boolean
}


/**
 * Response shape from GET /api/graph/label/popular and /api/graph/label/search
 */
export interface GraphLabelsResponse {
    labels: string[]
}



/**
 * Một node trong NetworkX node_link_data format.
 * Backend enrich thêm: community, degree_centrality, degree từ NetworkX analytics.
 *
 * D3.js simulation SẼ TỰ ĐỘNG thêm các fields x, y, vx, vy, fx, fy
 * vào mỗi object sau khi simulation khởi động — không cần khai báo ở đây.
 */
export interface NxNode {
    /** Node identifier — dùng làm key trong D3 force simulation */
    id: string
    /** Display label (= entity_id trong LightRAG) */
    label: string
    /** Entity type từ LightRAG: "PERSON", "ORGANIZATION", etc. Có thể rỗng */
    entity_type: string
    /** LLM-generated description của entity */
    description: string
    /** Community ID từ NetworkX greedy_modularity_communities (0-based) */
    community: number
    /** Degree centrality normalized [0, 1] từ NetworkX */
    degree_centrality: number
    /** Số cạnh kết nối với node này */
    degree: number
    /** Alias của label — D3 tooltip dùng field này (theo NetworkX guide) */
    name: string
    // D3 simulation runtime fields — optional vì D3 tự add sau khi init
    x?: number
    y?: number
    vx?: number
    vy?: number
    /** null = unpin node (free), number = pin node tại vị trí cố định */
    fx?: number | null
    fy?: number | null
}


/**
 * Một cạnh (link) trong NetworkX node_link_data format.
 *
 * QUAN TRỌNG: D3 force simulation sẽ MÚT (mutate) source và target
 * từ string ID → NxNode object sau khi simulation.nodes() + simulation.force("link") được gọi.
 * Vì vậy type là `string | NxNode` — cả hai đều có thể xảy ra tùy runtime state.
 */
export interface NxLink {
    /** Source node ID (string trước khi D3 resolve, NxNode sau khi resolve) */
    source: string | NxNode
    /** Target node ID (string trước khi D3 resolve, NxNode sau khi resolve) */
    target: string | NxNode
    /** Relationship strength — dùng cho stroke-width của edge */
    weight: number
    /** Comma-separated relation keywords: "CEO, founder, leads" */
    keywords: string
}


/**
 * Full response từ GET /api/graphs/nx
 * Là kết quả của networkx.readwrite.json_graph.node_link_data(G, edges="links")
 * được enrich thêm analytics và is_truncated flag.
 */
export interface NxGraphResponse {
    /** false vì backend dùng nx.Graph (undirected) */
    directed: boolean
    /** false vì không có parallel edges */
    multigraph: boolean
    /** Graph-level attributes (thường rỗng {}) */
    graph: Record<string, unknown>
    /** Danh sách nodes đã được enrich với analytics */
    nodes: NxNode[]
    /** Danh sách edges — key là "links" theo D3 convention */
    links: NxLink[]
    /** true khi backend capped kết quả tại max_nodes */
    is_truncated?: boolean
}


/**
 * Một entity có quan hệ trực tiếp với entity đang được xem.
 * Lấy từ các neighbor nodes trong BFS depth=1.
 */
export interface RelatedEntityInfo {
    /** Tên entity (= node ID trong LightRAG graph) */
    name: string
    /** Loại entity: "PERSON", "concept", "data", "UNKNOWN", v.v. */
    type: string
    /**
     * Danh sách descriptions của related entity.
     * Thường chỉ có 1 phần tử từ LightRAG,
     * nhưng để list để hỗ trợ multi-description trong tương lai.
     */
    descriptions: string[]
}


/**
 * Một relationship giữa entity đang xem và một entity khác.
 * Có thể là outgoing (from=entity, to=other) hoặc incoming (from=other, to=entity).
 */
export interface RelationshipInfo {
    /** Tên entity nguồn của relationship */
    from: string
    /** Tên entity đích của relationship */
    to: string
    /** LLM-generated description của relationship */
    description: string
    /** Độ mạnh của relationship (LightRAG weight, thường = 1.0) */
    weight: number
    /** Danh sách keywords mô tả loại relationship: ["assignment", "role"] */
    keywords: string[]
}


/**
 * Full response shape từ GET /api/entity/details?label={name}.
 *
 * Backend trả về:
 * - entity: thông tin chi tiết của entity đang xem
 * - related_entities: các entity có kết nối trực tiếp
 * - relationships: tất cả edges liên quan đến entity này
 */
export interface EntityDetailsResponse {
    entity: {
        /** Tên entity (= label được query) */
        name: string
        /** Loại entity từ LightRAG extraction */
        type: string
        /** LLM-generated description */
        description: string
        /** Chunk ID nguồn (first chunk nếu có nhiều) */
        source_id: string
        /**
         * Đường dẫn file nguồn.
         * null nếu backend không thể resolve từ text_chunks storage.
         */
        file_path: string | null
    }
    /** Danh sách entities có quan hệ trực tiếp */
    related_entities: RelatedEntityInfo[]
    /** Tất cả relationships của entity này (incoming + outgoing) */
    relationships: RelationshipInfo[]
}


/**
 * Một entity trong danh sách sidebar — response từ GET /api/entities.
 * Dùng snake_case để khớp với JSON từ Python backend.
 */
export interface EntityItem {
    /** Tên entity (= node ID trong LightRAG graph) */
    name: string
    /** Loại entity: "PERSON", "concept", "UNKNOWN", etc. */
    type: string
    /** LLM-generated description */
    description: string
    /** true nếu entity không có relationship nào (degree === 0) */
    is_orphan: boolean
    /** Số relationships của entity này */
    relation_count: number
}


/**
 * Full response từ GET /api/entities.
 */
export interface EntityListResponse {
    entities: EntityItem[]
    /** Tổng số entities trong graph (trước khi paginate) */
    total: number
}


/**
 * Response của POST /api/graph/entities/merge
 *
 * status: "success" — merge hoàn thành, sources đã bị xóa
 * message: string   — human-readable: "Successfully merged N entities into 'Target'"
 * data: object | null — merged entity info từ LightRAG get_entity_info()
 *                       null nếu LightRAG version cũ không return giá trị
 */
export interface MergeEntitiesResponse {
    status: 'success'
    message: string
    /**
     * Merged entity info từ LightRAG.
     * Structure phụ thuộc vào LightRAG version — dùng Record<string, unknown>
     * vì ta không cần đọc fields cụ thể của nó trong frontend.
     */
    data: Record<string, unknown> | null
}


// ── Semantic Dedup Types ────────────────────────────────────────────────────

/** Response từ POST /api/graph/semantic-dedup */
export interface SemanticDedupResponse {
    status: 'dedup_started' | 'busy'
    message: string
}

/** Chi tiết 1 merge trong kết quả dedup */
export interface SemanticDedupMergeDetail {
    canonical: string
    aliases: string[]
    refs_kept: { source: number; target: number }
    refs_merged: { name: string; source: number; target: number }[]
    relations_redirected?: number
}

/** 1 similarity cluster đã tìm thấy */
export interface SemanticDedupCluster {
    members: string[]
    max_similarity: number
}

/** Kết quả structured từ semantic dedup */
export interface SemanticDedupResult {
    summary: {
        total_groups: number
        entities_removed: number
        relations_updated: number
        text_dup_groups: number
        semantic_groups: number
        mode: 'dry_run' | 'applied'
    }
    merges: SemanticDedupMergeDetail[]
    clusters: SemanticDedupCluster[]
}

/** Progress info từ backend dedup task */
export interface SemanticDedupProgress {
    step: number
    total_steps: number
    step_name: string
    current: number
    total: number
}

/** Response từ GET /api/graph/semantic-dedup/status (polling) */
export interface SemanticDedupStatusResponse {
    running: boolean
    finished: boolean
    error: string | null
    result: SemanticDedupResult | null
    progress: SemanticDedupProgress | null
}
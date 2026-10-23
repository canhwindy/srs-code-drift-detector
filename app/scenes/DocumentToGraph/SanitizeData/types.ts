// ============================================================
// FILE: SanitizeData/types.ts
// Shared types dùng chung bởi nhiều components trong folder này.
// ============================================================

/**
 * Một entity trong sidebar listing — mapped từ EntityItem (API response).
 * Dùng camelCase theo convention frontend, khác với snake_case của backend.
 */
export interface Entity {
    /** Tên entity (= node ID trong LightRAG graph) */
    name: string
    /** Loại entity: "PERSON", "concept", "UNKNOWN", etc. — string thoải mái */
    type: string
    /** LLM-generated description */
    description: string
    /** true nếu entity không có relationship nào */
    isOrphan: boolean
    /** Số relationships của entity này */
    relationCount: number
}

/** Chế độ bộ lọc sidebar */
export type FilterMode = 'all' | 'orphans'

/** Chế độ hiển thị danh sách entity */
export type ShowMode = 'all' | 'selected'

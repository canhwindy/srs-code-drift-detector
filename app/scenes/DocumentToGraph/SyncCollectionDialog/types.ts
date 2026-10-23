// ============================================================
// SECTION 1: Outline API response types (từ Outline Koa backend)
// ============================================================

/**
 * NavigationNode — cấu trúc cây tài liệu từ Outline API.
 * Mỗi collection trả về một mảng NavigationNode (có thể lồng nhau nhiều cấp).
 * Chúng ta flatten cây này để lấy danh sách phẳng các tài liệu.
 */
export interface NavigationNode {
    id: string
    title: string
    url: string
    emoji?: string
    isDraft?: boolean
    collectionId?: string
    // type có thể là 'document' | 'collection' | undefined
    // Chúng ta chỉ lấy nodes có type === 'document' hoặc type === undefined
    type?: string
    // Children là các sub-documents lồng bên trong
    children: NavigationNode[]
}


/**
 * RawOutlineCollection — shape của mỗi collection trong response của
 * POST /api/collections.list.
 * Trường `documents` là NavigationNode[] chứa toàn bộ cây tài liệu.
 */
export interface RawOutlineCollection {
    id: string
    name: string
    icon?: string
    color?: string
    // Cây tài liệu lồng nhau — cần flatten để lấy flat list
    documents?: NavigationNode[]
    // Cho biết collection có bị archive không — chúng ta filter bỏ
    archivedAt?: string | null
}


/**
 * CollectionListItem — dữ liệu hiển thị cho một collection trong Phase 1.
 *
 * Khác với `CollectionWithDocs` (Phase 2), type này KHÔNG chứa docs.
 * Chỉ cần: id, name, icon, và doc count để render Phase 1 row.
 *
 * `docCount` được pre-computed bằng `countDocsInCollection()` để tránh
 * re-count mỗi lần render.
 */
export interface CollectionListItem {
    id: string
    name: string
    icon?: string
    color?: string
    /** Tổng số documents trong collection (đã đếm đệ quy) */
    docCount: number
}

/**
 * OutlineDoc — một tài liệu đã được flatten ra khỏi NavigationNode tree.
 * Lưu thêm `depth` để hỗ trợ indent UI (tài liệu con hiển thị lùi vào).
 */
export interface OutlineDoc {
    id: string
    title: string
    isDraft: boolean
    /** Độ sâu trong cây tài liệu (0 = top-level, 1 = con, 2 = cháu, v.v.) */
    depth: number
    /**
     * IDs của TẤT CẢ document con cháu (children + grandchildren + …).
     *
     * Được tính khi flatten NavigationNode tree trong flattenNavigationNodes().
     * Dùng trong toggleDoc() để cascade select/deselect:
     *   - Check doc cha  → thêm tất cả descendantIds vào selectedDocIds
     *   - Uncheck doc cha → xóa tất cả descendantIds khỏi selectedDocIds
     *
     * Với leaf node (không có con): descendantIds = []
     */
    descendantIds: string[]
    /**
     * Tên các tài liệu TỔ TIÊN từ trên xuống (không kể collection).
     *
     * Ví dụ với cây:
     *   LMS System (collection)
     *   └── 02_QA              → parentTitles = []
     *       └── UC_020_...     → parentTitles = ['02_QA']
     *
     *   01_Course_Class_Management   → parentTitles = []
     *   └── 01_General               → parentTitles = ['01_Course_Class_Management']
     *       └── UC_001_...           → parentTitles = ['01_Course_Class_Management', '01_General']
     *
     * Dùng trong buildSafeFilename() để ghép thành:
     *   Collection_Parent1_Parent2_DocTitle.md
     */
    parentTitles: string[]
    /**
     * IDs của TẤT CẢ document tổ tiên từ trên xuống (không kể collection).
     *
     * Ví dụ với cây:
     *   LMS System (collection)
     *   └── 02_QA              → parentIds = []
     *       └── UC_020_...     → parentIds = ['id_of_02_QA']
     *
     *   01_Course_Class_Management   → parentIds = []
     *   └── 01_General               → parentIds = ['id_of_01_Course...']
     *       └── UC_001_...           → parentIds = ['id_of_01_Course...', 'id_of_01_General']
     *
     * Dùng trong toggleDoc() để cascade select LÊN:
     *   - Check doc con → thêm tất cả parentIds vào selectedDocIds
     *
     * Với top-level doc (không có cha): parentIds = []
     */
    parentIds: string[]
}


/**
 * CollectionWithDocs — collection kèm flat list docs cho Phase 2.
 * Được tạo bởi `proceedToDocuments()` trong hook.
 */
export interface CollectionWithDocs {
    id: string
    name: string
    icon?: string
    color?: string
    /** Flat list docs — đã flatten từ NavigationNode tree */
    docs: OutlineDoc[]
    /**
     * isExpanded: trong Phase 2, mặc định true (user vừa chọn collection này,
     * họ muốn thấy tài liệu bên trong ngay lập tức).
     */
    isExpanded: boolean
}




// ============================================================
// DocSyncStatus — trạng thái sync của từng tài liệu.
//
// Flow trạng thái đầy đủ (bao gồm conflict resolution):
//   pending → exporting → uploading → success
//                                  ↘ duplicate
//                     ↘ error
//   pending → deleting → pending → exporting → uploading → success  (replace flow)
//   skipped  (user chọn ignore)
// ============================================================
export type DocSyncStatus =
    | 'pending'     // Đã chọn, chưa xử lý
    | 'exporting'   // Đang gọi documents.export
    | 'uploading'   // Đang upload lên Python backend
    | 'success'     // Upload thành công, LightRAG đang index
    | 'duplicate'   // File đã tồn tại trong KG (soft success — không có trong resolution)
    | 'error'       // Thất bại ở bước export hoặc upload
    | 'deleting'    // NEW: Đang xóa bản cũ trong KG trước khi re-upload (replace flow)
    | 'skipped'     // NEW: User chọn 'ignore' — tài liệu bị bỏ qua hoàn toàn

/**
* CollectionCheckState — trạng thái checkbox của collection.
*
* - 'unchecked':     Không có doc nào được chọn trong collection này
* - 'indeterminate': Một phần docs được chọn (hiển thị dấu gạch ngang)
* - 'checked':       Tất cả docs được chọn
*/
export type CollectionCheckState = 'unchecked' | 'indeterminate' | 'checked'


// ============================================================
// DialogPhase — v3 thêm phase 'resolve_conflicts'.
//
// Flow đầy đủ:
//   loading_collections
//     → select_collections ⇄ select_documents
//         → [check KG] → resolve_conflicts (nếu có conflict)
//             → syncing → done
//         → [no conflict] → syncing → done
//     → error
// ============================================================
export type DialogPhase =
    | 'loading_collections'  // Đang fetch collections.list
    | 'select_collections'   // [Phase 1] User chọn collections cần tải docs
    | 'select_documents'     // [Phase 2] User chọn docs cụ thể để sync
    | 'resolve_conflicts'    // [Phase 3 — NEW] User quyết định Replace/Ignore cho docs trùng tên
    | 'syncing'              // Đang export + upload (có thể có bước pre-delete)
    | 'done'                 // Hoàn tất (success/partial)
    | 'error'                // Không load được collections

/**
 * SyncSummary — kết quả sau khi sync hoàn tất.
 * Hiển thị trong phase 'done'.
 */
/**
 * SyncSummary — kết quả sau khi sync hoàn tất.
 * Hiển thị trong phase 'done'.
 */
export interface SyncSummary {
    total: number
    success: number
    duplicate: number
    error: number
    ignored: number    // NEW: số tài liệu user chọn 'ignore' trong Phase 3
}


/**
 * DuplicateResolution — quyết định của user cho một tài liệu xung đột.
 *
 * 'replace': Xóa bản cũ trong KG, sau đó upload bản mới.
 * 'ignore':  Bỏ qua tài liệu này — không export, không upload.
 */
export type DuplicateResolution = 'replace' | 'ignore'


/**
 * ConflictDoc — một tài liệu đang xung đột (đã tồn tại trong KG).
 *
 * Được tạo trong checkConflictsAndProceed() khi phát hiện
 * tên file trùng với tài liệu đang có trong Knowledge Graph.
 */
export interface ConflictDoc {
    /** ID của tài liệu Outline (key trong selectedDocIds) */
    outlineDocId: string
    /** Tên file đã compute — dùng để hiển thị cho user */
    filename: string
    /** LightRAG doc_id — dùng trong apiDeleteDocuments() khi replace */
    kgDocId: string
}



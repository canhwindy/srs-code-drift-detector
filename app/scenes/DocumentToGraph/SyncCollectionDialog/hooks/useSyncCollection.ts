
import { useState, useCallback, useMemo } from 'react'
import type {
    CollectionCheckState,
    CollectionListItem,
    CollectionWithDocs,
    ConflictDoc,
    DialogPhase,
    DocSyncStatus,
    DuplicateResolution,
    NavigationNode,
    OutlineDoc,
    RawOutlineCollection,
    SyncSummary,
} from '../types'
import {
    apiDeleteDocuments,
    apiFetchDocuments,
    apiScanDocuments,
    exportOutlineDocument,
    fetchOutlineCollections,
    uploadDocument,
} from '../../lib/api'
import { buildSafeFilename } from '../../lib/buildSafeFilename'
import { waitForKgDocsDeleted } from '../helpers/helpers'


/**
 * Đếm đệ quy số tài liệu trong cây NavigationNode.
 * Dùng trong Phase 1 để hiển thị "N docs" mà KHÔNG cần flatten toàn bộ cây.
 *
 * Chỉ đếm nodes có type === 'document' hoặc type === undefined.
 *
 * @param nodes - NavigationNode[] cần đếm
 * @returns Tổng số document nodes trong cây (kể cả children đệ quy)
 */
function countDocsInTree(nodes: NavigationNode[]): number {
    let count = 0
    for (const node of nodes) {
        // Chỉ đếm document nodes (bỏ qua userMembership, groupMembership, v.v.)
        const isDocument = !node.type || node.type === 'document'
        if (isDocument) {
            count++
        }
        // Đệ quy vào children dù node hiện tại không phải document
        // (phòng trường hợp structure lồng nhau bất thường)
        if (node.children?.length > 0) {
            count += countDocsInTree(node.children)
        }
    }
    return count
}


/**
 * Flatten đệ quy cây NavigationNode thành mảng OutlineDoc[] phẳng.
 * Chỉ được gọi trong Phase 2 khi user đã xác nhận chọn collection.
 *
 * Ví dụ cây:              Kết quả flatten:
 *   A (depth 0)     →     [A(0, parents=[]), B(1, parents=[A]), C(2, parents=[A,B]), D(1, parents=[A])]
 *   ├── B (depth 1)
 *   │   └── C (depth 2)
 *   └── D (depth 1)
 *
 * @param nodes          - NavigationNode[] cần flatten
 * @param depth          - Độ sâu hiện tại (0 = top-level)
 * @param ancestorTitles - Tiêu đề các tổ tiên (truyền xuống khi đệ quy, mặc định [])
 * @returns OutlineDoc[] phẳng, theo thứ tự duyệt pre-order
 */
function flattenNavigationNodes(
    nodes: NavigationNode[],
    depth = 0,
    ancestorTitles: string[] = [],   //tiêu đề các doc cha từ trên xuống
    ancestorIds: string[] = []
): OutlineDoc[] {
    const result: OutlineDoc[] = []

    for (const node of nodes) {
        const isDocument = !node.type || node.type === 'document'

        if (isDocument) {
            const nodeTitle = node.title || 'Untitled'

            // ANCESTOR LISTS FOR CHILDREN:
            // Khi đệ quy vào children, thêm cả title VÀ id của node hiện tại.
            // Ví dụ: node hiện tại là '02_QA' với id='abc'
            //   → childAncestorTitles = [...ancestorTitles, '02_QA']
            //   → childAncestorIds    = [...ancestorIds, 'abc']
            const childAncestorTitles = [...ancestorTitles, nodeTitle]
            const childAncestorIds = [...ancestorIds, node.id]

            // STEP 1: Flatten toàn bộ subtree TRƯỚC để lấy descendantIds
            const childrenFlat =
                node.children?.length > 0
                    ? flattenNavigationNodes(
                        node.children,
                        depth + 1,
                        childAncestorTitles,  // Truyền tiêu đề tổ tiên xuống
                        childAncestorIds      // Truyền ID tổ tiên xuống
                    )
                    : []

            // STEP 2: Thu thập tất cả IDs của con cháu
            const descendantIds = childrenFlat.map((d) => d.id)

            // STEP 3: Push node cha vào kết quả
            result.push({
                id: node.id,
                title: nodeTitle,
                isDraft: node.isDraft ?? false,
                depth,
                descendantIds,
                parentTitles: ancestorTitles,  // Tên tổ tiên (KHÔNG kể chính nó)
                parentIds: ancestorIds,         // ID tổ tiên (KHÔNG kể chính nó)
            })

            // STEP 4: Push toàn bộ subtree vào kết quả (pre-order: cha trước con)
            result.push(...childrenFlat)
        }
    }

    return result
}






/**
 * useSyncCollection — two-phase custom hook cho Sync Collection dialog.
 *
 * Phase 1 (select_collections): User chọn collections muốn tải docs.
 * Phase 2 (select_documents):   User chọn docs cụ thể trong các collections đã chọn.
 * Sync:                         Export markdown + upload vào Python LightRAG.
 *
 * @param onDocumentsUploaded - Callback sau sync, nhận File[] thành công.
 *   Parent (DocumentManagers) dùng để refresh bảng documents.
 */
export function useSyncCollection(
    onDocumentsUploaded: (files: File[]) => void,
    workspaceId?: string,
) {
    // ──────────────────────────────────────────────────────────
    // STATE GROUP A: Dialog phase & API data
    // ──────────────────────────────────────────────────────────

    /** Phase hiện tại của dialog */
    const [phase, setPhase] = useState<DialogPhase>('loading_collections')

    /** Thông báo lỗi khi phase === 'error' */
    const [errorMessage, setErrorMessage] = useState('')

    /**
     * Raw collections từ API — chứa NavigationNode trees chưa flatten.
     * Được parse thành CollectionListItem[] để render Phase 1.
     * NavigationNode trees được flatten on-demand khi proceedToDocuments().
     */
    const [rawCollections, setRawCollections] = useState<RawOutlineCollection[]>([])

    // ──────────────────────────────────────────────────────────
    // STATE GROUP B: Phase 1 — Collection selection
    // ──────────────────────────────────────────────────────────

    /**
     * Set các collectionId đang được chọn trong Phase 1.
     * Được giữ nguyên khi user dùng "← Back" từ Phase 2.
     */
    const [selectedCollectionIds, setSelectedCollectionIds] = useState<Set<string>>(
        new Set()
    )

    // ──────────────────────────────────────────────────────────
    // STATE GROUP C: Phase 2 — Document selection
    // ──────────────────────────────────────────────────────────

    /**
     * Collections đã được "load" (NavigationNode trees đã flatten).
     * Chỉ chứa các collections user đã chọn trong Phase 1.
     * Reset về [] khi user dùng "← Back".
     */
    const [loadedCollections, setLoadedCollections] = useState<CollectionWithDocs[]>([])

    /**
     * Set các docId được chọn trong Phase 2.
     * Reset về new Set() mỗi khi user vào Phase 2 (kể cả khi Back + Load lại).
     */
    const [selectedDocIds, setSelectedDocIds] = useState<Set<string>>(new Set())

    // ──────────────────────────────────────────────────────────
    // STATE GROUP D: Sync progress
    // ──────────────────────────────────────────────────────────

    const [docStatuses, setDocStatuses] = useState<Map<string, DocSyncStatus>>(
        new Map()
    )

    const [syncSummary, setSyncSummary] = useState<SyncSummary>({
        total: 0,
        success: 0,
        duplicate: 0,
        error: 0,
        ignored: 0
    })

    /**
     * Danh sách các tài liệu xung đột (đã tồn tại trong KG với cùng tên file).
     * Được set bởi checkConflictsAndProceed() khi phát hiện conflict.
     * Reset về [] khi: load(), goBack() (Phase2→1), goBackFromConflicts() (Phase3→2).
     */
    const [conflictDocs, setConflictDocs] = useState<ConflictDoc[]>([])

    /**
     * Quyết định của user cho từng tài liệu xung đột.
     * Key: outlineDocId (string), Value: DuplicateResolution ('replace' | 'ignore')
     * Default: tất cả 'replace' khi vào Phase 3 (user có thể đổi sang 'ignore').
     * Reset về new Map() khi: load(), goBack(), goBackFromConflicts().
     */
    const [docResolutions, setDocResolutions] = useState<Map<string, DuplicateResolution>>(
        new Map()
    )


    /**
     * Chuyển rawCollections → CollectionListItem[] cho Phase 1 render.
     * Lọc bỏ collections đã archived.
     * Pre-compute docCount để tránh re-count mỗi lần render.
     *
     * useMemo: Chỉ re-compute khi rawCollections thay đổi (sau load()).
     */
    const collectionListItems = useMemo<CollectionListItem[]>(() =>
        rawCollections
            // FILTER: Bỏ collections đã archive
            .filter((c) => !c.archivedAt)
            // MAP: Tính docCount + convert sang CollectionListItem
            .map((c) => ({
                id: c.id,
                name: c.name,
                icon: c.icon,
                color: c.color,
                // COUNT: Đệ quy đếm số docs trong tree (không flatten)
                docCount: countDocsInTree(c.documents ?? []),
            }))
        , [rawCollections])


    // ──────────────────────────────────────────────────────────
    // COMPUTED: Phase 1 footer — tổng số collections + docs đang chọn
    // ──────────────────────────────────────────────────────────

    /** Số collections đang được chọn trong Phase 1 */
    const totalSelectedCollections = selectedCollectionIds.size

    /**
     * Tổng số docs trong các collections đang được chọn Phase 1.
     * Hiển thị: "2 collections selected (47 docs total)"
     * Giúp user ước lượng thời gian sync trước khi chuyển sang Phase 2.
     */
    const totalDocsInSelectedCollections = useMemo(() =>
        rawCollections
            .filter((c) => selectedCollectionIds.has(c.id))
            .reduce((acc, c) => acc + countDocsInTree(c.documents ?? []), 0)
        , [rawCollections, selectedCollectionIds])


    // ──────────────────────────────────────────────────────────
    // COMPUTED: Phase 2 — tổng số docs đang chọn
    // ──────────────────────────────────────────────────────────

    const totalSelectedDocs = selectedDocIds.size

    // ──────────────────────────────────────────────────────────
    // ACTION 1: Load collections từ Outline API
    // ──────────────────────────────────────────────────────────

    /**
     * Fetch danh sách collections từ Outline API.
     * Được gọi khi dialog mở (useEffect trong SyncCollectionDialog).
     * Sau khi load xong → phase chuyển sang 'select_collections'.
     */
    const load = useCallback(async () => {
        // RESET: Về trạng thái ban đầu
        // RESET: Về trạng thái ban đầu
        setPhase('loading_collections')
        setRawCollections([])
        setSelectedCollectionIds(new Set())
        setLoadedCollections([])
        setSelectedDocIds(new Set())
        setDocStatuses(new Map())
        setErrorMessage('')
        // RESET Phase 3 state — xóa sạch conflicts khi load lại từ đầu
        setConflictDocs([])
        setDocResolutions(new Map())

        try {
            // FETCH: 1 API call — lấy tất cả collections kèm NavigationNode trees
            const raw = await fetchOutlineCollections()
            setRawCollections(raw)

            // PHASE CHANGE: Hiện Phase 1 UI
            setPhase('select_collections')

        } catch (err) {
            const msg =
                err instanceof Error ? err.message : 'Failed to load collections'
            setErrorMessage(msg)
            setPhase('error')
        }
    }, [])


    // ──────────────────────────────────────────────────────────
    // ACTION 2: Phase 1 — Toggle chọn/bỏ chọn một collection
    // ──────────────────────────────────────────────────────────

    /**
     * Toggle selection của một collection trong Phase 1.
     * @param collectionId - ID collection cần toggle
     */
    const toggleCollectionSelection = useCallback((collectionId: string) => {
        setSelectedCollectionIds((prev) => {
            const next = new Set(prev)
            if (next.has(collectionId)) {
                next.delete(collectionId)
            } else {
                next.add(collectionId)
            }
            return next
        })
    }, [])


    /**
   * Chọn tất cả collections (Select All trong Phase 1).
   * Chỉ chọn collections không bị archived (đã filter trong collectionListItems).
   */
    const selectAllCollections = useCallback(() => {
        setSelectedCollectionIds(
            new Set(collectionListItems.map((c) => c.id))
        )
    }, [collectionListItems])


    /**
   * Bỏ chọn tất cả collections (Deselect All trong Phase 1).
   */
    const deselectAllCollections = useCallback(() => {
        setSelectedCollectionIds(new Set())
    }, [])


    /**
   * Chuyển từ Phase 1 sang Phase 2.
   *
   * Flatten NavigationNode trees CHỈ cho các collections đã chọn.
   * Đây là operation đồng bộ (synchronous) — không cần API call thêm.
   * NavigationNode trees đã có trong `rawCollections` từ bước load().
   *
   * Sau khi flatten:
   * - loadedCollections được set (chỉ collections đã chọn, với docs đã flatten)
   * - selectedDocIds reset về rỗng
   * - phase chuyển sang 'select_documents'
   *
   * Collections trong Phase 2 mặc định isExpanded = true vì:
   * - User vừa chủ động chọn collections này
   * - Họ muốn thấy và chọn docs ngay lập tức
   */
    const proceedToDocuments = useCallback(() => {
        if (selectedCollectionIds.size === 0) { return; }

        // FLATTEN: Chỉ xử lý collections được chọn trong Phase 1
        const loaded: CollectionWithDocs[] = rawCollections
            .filter((c) => selectedCollectionIds.has(c.id) && !c.archivedAt)
            .map((c) => ({
                id: c.id,
                name: c.name,
                icon: c.icon,
                color: c.color,
                // FLATTEN: Chuyển NavigationNode tree → flat OutlineDoc[]
                docs: flattenNavigationNodes(c.documents ?? []),
                // AUTO-EXPAND: User vừa chọn collection này → hiện docs ngay
                isExpanded: true,
            }))

        setLoadedCollections(loaded)
        // RESET: Doc selection luôn bắt đầu rỗng khi vào Phase 2
        setSelectedDocIds(new Set())
        setPhase('select_documents')

    }, [rawCollections, selectedCollectionIds])


    /**
   * Quay lại Phase 1 từ Phase 2 (nút "← Back").
   *
   * Giữ nguyên: selectedCollectionIds (collection checkboxes trong Phase 1)
   * Reset: loadedCollections, selectedDocIds (Phase 2 state)
   *
   * User không mất lựa chọn collection khi Back — họ chỉ cần điều chỉnh
   * rồi click "Load Docs →" lại.
   */
    const goBack = useCallback(() => {
        setLoadedCollections([])
        setSelectedDocIds(new Set())
        // RESET Phase 3 state — nếu user đã check conflicts trước đó, reset để re-check khi vào Phase 2 lại
        setConflictDocs([])
        setDocResolutions(new Map())
        setPhase('select_collections')
        // selectedCollectionIds KHÔNG bị reset — giữ nguyên để UX nhất quán
    }, [])

    /**
         * Quay lại Phase 2 từ Phase 3 (nút "← Back" trong resolve_conflicts).
         *
         * Reset: conflictDocs, docResolutions (sẽ re-detect khi user click Sync → lại)
         * Giữ nguyên: selectedDocIds (Phase 2 selections vẫn còn)
         */
    const goBackFromConflicts = useCallback((): void => {
        setConflictDocs([])
        setDocResolutions(new Map())
        setPhase('select_documents')
        // selectedDocIds KHÔNG bị reset — user không mất lựa chọn khi Back
    }, [])


    /**
     * Đặt quyết định Replace/Ignore cho một tài liệu cụ thể trong Phase 3.
     * Được gọi khi user click button [Replace] hoặc [Ignore] cho từng doc.
     *
     * @param outlineDocId - ID của Outline document cần đặt quyết định
     * @param resolution   - 'replace' hoặc 'ignore'
     */
    const setDocResolution = useCallback(
        (outlineDocId: string, resolution: DuplicateResolution): void => {
            setDocResolutions((prev) => {
                // IMMUTABLE UPDATE: Tạo Map mới để React detect re-render
                const next = new Map(prev)
                next.set(outlineDocId, resolution)
                return next
            })
        },
        [],
    )


    /**
     * Đặt cùng một quyết định cho TẤT CẢ tài liệu xung đột.
     * Dùng cho buttons "Replace All" / "Ignore All" trong Phase 3.
     *
     * @param resolution - 'replace' hoặc 'ignore' — áp dụng cho toàn bộ conflictDocs
     */
    const setAllResolutions = useCallback(
        (resolution: DuplicateResolution): void => {
            setDocResolutions(
                new Map(conflictDocs.map((c): [string, DuplicateResolution] => [c.outlineDocId, resolution]))
            )
        },
        [conflictDocs],
    )


    /**
    * Bắt đầu quá trình sync: (optional pre-delete) → export → upload.
    *
    * Được gọi từ 2 nơi:
    * 1. checkConflictsAndProceed() — khi không có conflict nào
    * 2. "Confirm →" button trong Phase 3 UI — sau khi user set resolutions
    *
    * FLOW:
    * A. INIT:        Set status cho từng doc ('skipped' / 'deleting' / 'pending')
    * B. PRE-DELETE:  Nếu có docs 'replace', xóa bản cũ trong KG + chờ xóa xong
    * C. SYNC LOOP:   Sequential loop: skip 'ignore' docs, export + upload others
    * D. DONE:        Set syncSummary (bao gồm ignoredCount), gọi onDocumentsUploaded
    *
    * Chạy TUẦN TỰ để tôn trọng rate limit 25 req/phút của documents.export.
    */
    const startSync = useCallback(async (): Promise<void> => {
        if (selectedDocIds.size === 0) { return }

        setPhase('syncing')


        // ── A. INIT STATUSES ────────────────────────────────────

        // Build replaceConflictMap: outlineDocId → kgDocId (chỉ cho 'replace' conflicts)
        // Dùng để: (1) detect doc nào cần pre-delete, (2) set status 'deleting' đúng doc
        const replaceConflictMap = new Map<string, string>()
        for (const conflict of conflictDocs) {
            const resolution = docResolutions.get(conflict.outlineDocId)
            if (resolution === 'replace') {
                replaceConflictMap.set(conflict.outlineDocId, conflict.kgDocId)
            }
        }

        // Set initial status cho từng selected doc
        const initStatuses = new Map<string, DocSyncStatus>()
        for (const docId of selectedDocIds) {
            const resolution = docResolutions.get(docId)
            if (resolution === 'ignore') {
                // 'ignore' docs hiển thị ngay là 'skipped' — không xử lý
                initStatuses.set(docId, 'skipped')
            } else if (replaceConflictMap.has(docId)) {
                // 'replace' conflict docs hiển thị 'deleting' — đang chờ xóa bản cũ
                initStatuses.set(docId, 'deleting')
            } else {
                // Docs thông thường (không conflict, hoặc chưa có trong KG)
                initStatuses.set(docId, 'pending')
            }
        }
        setDocStatuses(initStatuses)


        // ── B. PRE-DELETION ────────────────────────────────────

        if (replaceConflictMap.size > 0) {
            const kgDocIds = Array.from(replaceConflictMap.values())

            try {
                // BULK DELETE: Xóa tất cả bản cũ cùng lúc (1 API call)
                const deleteResult = await apiDeleteDocuments(kgDocIds)

                if (deleteResult.status === 'deletion_started') {
                    // POLL: Chờ cho đến khi backend xác nhận đã xóa (max 20s)
                    await waitForKgDocsDeleted(kgDocIds, { workspaceId })
                }
                // Nếu deleteResult.status === 'busy': vẫn tiến hành upload
                // Backend sẽ báo duplicate, nhưng user đã được thông báo conflict
            } catch {
                // NETWORK ERROR: Vẫn tiến hành — upload có thể bị duplicate
            }

            // RESET STATUS: Sau khi xóa xong, đặt 'replace' docs về 'pending'
            // để sync loop xử lý bình thường (export → upload)
            for (const outlineDocId of replaceConflictMap.keys()) {
                setDocStatuses((prev) => new Map(prev).set(outlineDocId, 'pending'))
            }
        }


        // ── C. SYNC LOOP ───────────────────────────────────────

        const successFiles: File[] = []
        let successCount = 0
        let duplicateCount = 0
        let errorCount = 0
        let ignoredCount = 0

        for (const docId of selectedDocIds) {
            const resolution = docResolutions.get(docId)

            // SKIP: User đã chọn 'ignore' cho doc này
            if (resolution === 'ignore') {
                ignoredCount++
                continue  // Không export, không upload — bỏ qua hoàn toàn
            }

            // LOOKUP: Tìm title để tạo filename
            let docTitle = 'Untitled'

            for (const coll of loadedCollections) {
                const doc = coll.docs.find((d) => d.id === docId)
                if (doc !== undefined) {
                    docTitle = doc.title
                    break
                }
            }

            // ── STEP 1: Export document content ──────────────────
            setDocStatuses((prev) => new Map(prev).set(docId, 'exporting'))

            let markdownContent: string
            try {
                markdownContent = await exportOutlineDocument(docId)
            } catch {
                setDocStatuses((prev) => new Map(prev).set(docId, 'error'))
                errorCount++
                continue  // Skip tới doc tiếp theo — không dừng cả batch
            }

            // ── STEP 2: Tạo File object ────────────────────────────
            const filename = buildSafeFilename(docId, docTitle)
            const file = new File([markdownContent], filename, {
                type: 'text/markdown',
            })

            // ── STEP 3: Upload vào Python LightRAG ────────────────
            setDocStatuses((prev) => new Map(prev).set(docId, 'uploading'))

            try {
                const result = await uploadDocument(file, workspaceId)

                if (result.status === 'success') {
                    setDocStatuses((prev) => new Map(prev).set(docId, 'success'))
                    successFiles.push(file)
                    successCount++
                } else if (result.status === 'duplicate') {
                    // Duplicate không được resolve (edge case: delete chưa xong)
                    setDocStatuses((prev) => new Map(prev).set(docId, 'duplicate'))
                    duplicateCount++
                } else {
                    setDocStatuses((prev) => new Map(prev).set(docId, 'error'))
                    errorCount++
                }
            } catch {
                setDocStatuses((prev) => new Map(prev).set(docId, 'error'))
                errorCount++
            }
        } // end for


        // ── D. DONE ───────────────────────────────────────────

        setSyncSummary({
            total: selectedDocIds.size,
            success: successCount,
            duplicate: duplicateCount,
            error: errorCount,
            ignored: ignoredCount,  // NEW: số docs user chọn ignore
        })

        if (successFiles.length > 0) {
            onDocumentsUploaded(successFiles)
        }

        // Trigger scan để backend process tất cả PENDING docs tuần tự.
        // Gọi luôn dù có upload lỗi — docs đã PENDING vẫn cần được xử lý.
        // Bỏ qua lỗi: nếu scan busy hoặc network lỗi, docs PENDING xử lý lần sau.
        try {
            await apiScanDocuments(workspaceId)
        } catch {
            // intentional no-op
        }

        setPhase('done')
    }, [selectedDocIds, loadedCollections, conflictDocs, docResolutions, onDocumentsUploaded, workspaceId])




    /**
     * Handler cho nút "Sync →" ở Phase 2.
     *
     * Thay thế việc gọi startSync() trực tiếp — thêm bước kiểm tra
     * xem có tài liệu nào đã tồn tại trong KG với cùng tên file không.
     *
     * FLOW:
     * 1. Fetch tất cả docs hiện có trong KG (1 API call)
     * 2. Với mỗi selectedDoc: tính filename → check xem KG có file đó không
     * 3. Nếu không có conflict → gọi startSync() ngay
     * 4. Nếu có conflict → chuyển sang phase 'resolve_conflicts' để user quyết định
     *
     * ERROR FALLBACK: Nếu fetch KG thất bại → gọi startSync() bình thường
     * (duplicates sẽ được xử lý như cũ: trả về status 'duplicate').
     */
    const checkConflictsAndProceed = useCallback(async (): Promise<void> => {
        if (selectedDocIds.size === 0) { return }

        try {
            // FETCH: Lấy tất cả docs trong KG — pageSize=1000 đủ cho hầu hết workspace
            const kgResponse = await apiFetchDocuments(undefined, 1, 1000, 'updated_at', 'desc', undefined, workspaceId)

            // BUILD MAP: filename (không có path) → kgDocId
            // KG file_path format: '/input_document/filename.md' hoặc 'filename.md'
            const filenameToKgDocId = new Map<string, string>()
            for (const kgDoc of kgResponse.documents) {
                // Lấy phần tên file từ path (bỏ thư mục prefix)
                const filename = kgDoc.file_path.split('/').pop() ?? kgDoc.file_path
                filenameToKgDocId.set(filename, kgDoc.id)
            }

            // DETECT CONFLICTS: So sánh filename của từng selected doc với KG
            const conflicts: ConflictDoc[] = []

            for (const docId of selectedDocIds) {
                // Tìm collection chứa doc này để lấy collectionName + parentTitles
                for (const coll of loadedCollections) {
                    const doc = coll.docs.find((d) => d.id === docId)
                    if (doc !== undefined) {
                        // Tính filename theo cùng logic với buildSafeFilename trong startSync
                        const filename = buildSafeFilename(docId, doc.title)
                        const kgDocId = filenameToKgDocId.get(filename)

                        if (kgDocId !== undefined) {
                            // CONFLICT FOUND: doc này đã tồn tại trong KG với tên file đó
                            conflicts.push({ outlineDocId: docId, filename, kgDocId })
                        }
                        // Doc tìm thấy ở collection này rồi → không cần check collection khác
                        break
                    }
                }
            }

            if (conflicts.length === 0) {
                // NO CONFLICTS: Không có tài liệu nào trùng → sync trực tiếp
                await startSync()
            } else {
                // HAS CONFLICTS: Chuyển sang Phase 3 để user quyết định
                setConflictDocs(conflicts)

                // DEFAULT: Tất cả conflicts mặc định là 'replace'
                // (user đã chủ động chọn sync → intent là update, không phải skip)
                const defaultResolutions = new Map<string, DuplicateResolution>()
                for (const c of conflicts) {
                    defaultResolutions.set(c.outlineDocId, 'replace')
                }
                setDocResolutions(defaultResolutions)

                setPhase('resolve_conflicts')
            }
        } catch {
            // ERROR FALLBACK: Nếu không fetch được KG → sync bình thường
            // Duplicates sẽ được backend xử lý như trước (trả về status 'duplicate')
            await startSync()
        }
    }, [selectedDocIds, loadedCollections, startSync, workspaceId])




    // ──────────────────────────────────────────────────────────
    // ACTION 5: Phase 2 — Toggle expand/collapse collection
    // ──────────────────────────────────────────────────────────

    /**
     * Toggle expand/collapse của một collection trong Phase 2.
     * Không fetch thêm data — chỉ thay đổi UI state.
     */
    const toggleExpand = useCallback((collectionId: string) => {
        setLoadedCollections((prev) =>
            prev.map((c) =>
                c.id === collectionId
                    ? { ...c, isExpanded: !c.isExpanded }
                    : c
            )
        )
    }, [])


    // ──────────────────────────────────────────────────────────
    // ACTION 6: Phase 2 — Toggle chọn một document
    // ──────────────────────────────────────────────────────────

    /**
     * Toggle selection của một tài liệu trong Phase 2.
     * Set mới được tạo immutably để React detect re-render.
     */
    /**
 * Toggle selection của một tài liệu trong Phase 2.
 *
 * CASCADE BEHAVIOR:
 * - Check doc cha  → tự động check tất cả con cháu (descendantIds)
 * - Uncheck doc cha → tự động uncheck tất cả con cháu
 *
 * Cách tìm descendantIds:
 * - Flatten toàn bộ docs từ loadedCollections thành một mảng duy nhất
 * - Tra cứu doc theo docId để lấy descendantIds
 * - descendantIds đã được tính sẵn trong flattenNavigationNodes()
 *
 * Set mới được tạo immutably để React detect re-render.
 *
 * @param docId - ID của document cần toggle
 */
    const toggleDoc = useCallback((docId: string) => {
        // LOOKUP: Tìm doc trong tất cả loadedCollections để lấy descendantIds
        // flatMap để gộp docs từ nhiều collections thành 1 mảng phẳng
        const allDocs = loadedCollections.flatMap((c) => c.docs)
        const doc = allDocs.find((d) => d.id === docId)

        setSelectedDocIds((prev) => {
            const next = new Set(prev)

            if (next.has(docId)) {
                // DESELECT: Bỏ chọn doc này VÀ tất cả con cháu
                next.delete(docId)
                // doc.descendantIds là [] nếu leaf node → forEach không làm gì
                doc?.descendantIds.forEach((id) => next.delete(id))
                // NOTE: Không bỏ chọn cha — cha có thể được giữ do docs khác

            } else {
                // SELECT: Chọn doc này + tất cả con cháu + tất cả tổ tiên

                // CASCADE DOWN: thêm tất cả ID con cháu vào Set
                next.add(docId)
                doc?.descendantIds.forEach((id) => next.add(id))

                // CASCADE UP: thêm tất cả ID tổ tiên vào Set (MỚI)
                // parentIds = [] với top-level doc → forEach không làm gì
                doc?.parentIds.forEach((id) => next.add(id))
            }

            return next
        })
    }, [loadedCollections]) // loadedCollections chứa docs với descendantIds + parentIds


    // ──────────────────────────────────────────────────────────
    // ACTION 7: Phase 2 — Toggle toàn bộ docs của một collection
    // ──────────────────────────────────────────────────────────

    /**
     * Chọn/bỏ chọn tất cả docs trong một collection (Phase 2).
     *
     * Logic:
     * - Nếu tất cả docs đang được chọn → deselect all
     * - Nếu không (unchecked hoặc indeterminate) → select all
     */
    const toggleAllDocsInCollection = useCallback(
        (collectionId: string) => {
            const collection = loadedCollections.find((c) => c.id === collectionId)
            if (!collection || collection.docs.length === 0) { return; }

            const docIds = collection.docs.map((d) => d.id)

            setSelectedDocIds((prev) => {
                const next = new Set(prev)
                const allSelected = docIds.every((id) => prev.has(id))

                if (allSelected) {
                    // DESELECT ALL docs trong collection này
                    docIds.forEach((id) => next.delete(id))
                } else {
                    // SELECT ALL docs trong collection này
                    docIds.forEach((id) => next.add(id))
                }

                return next
            })
        },
        [loadedCollections]
    )


    /**
   * Tính trạng thái checkbox 3 mức của một collection trong Phase 2.
   *
   * @param collectionId - ID collection cần kiểm tra
   * @returns 'unchecked' | 'indeterminate' | 'checked'
   */
    const getCollectionCheckState = useCallback(
        (collectionId: string): CollectionCheckState => {
            const coll = loadedCollections.find((c) => c.id === collectionId)
            if (!coll || coll.docs.length === 0) { return 'unchecked'; }

            const docIds = coll.docs.map((d) => d.id)
            const selectedCount = docIds.filter((id) => selectedDocIds.has(id)).length

            if (selectedCount === 0) { return 'unchecked'; }
            if (selectedCount === docIds.length) { return 'checked'; }
            return 'indeterminate'
        },
        [loadedCollections, selectedDocIds]
    )



    // ──────────────────────────────────────────────────────────
    // RETURN: Expose state và actions cho SyncCollectionDialog
    // ──────────────────────────────────────────────────────────

    return {
        // Phase & error
        phase,
        errorMessage,

        // Phase 1 data
        collectionListItems,          // CollectionListItem[] cho Phase 1 render
        selectedCollectionIds,        // Set<string>
        totalSelectedCollections,     // number
        totalDocsInSelectedCollections, // number — hiện trong footer Phase 1

        // Phase 1 actions
        toggleCollectionSelection,
        selectAllCollections,
        deselectAllCollections,
        proceedToDocuments,           // Phase 1 → Phase 2

        // Phase 2 data
        loadedCollections,            // CollectionWithDocs[]
        selectedDocIds,               // Set<string>
        totalSelectedDocs,            // number

        // Phase 2 actions
        goBack,                       // Phase 2 → Phase 1
        toggleExpand,
        toggleDoc,
        toggleAllDocsInCollection,
        getCollectionCheckState,

        // Sync
        startSync,
        docStatuses,
        syncSummary,

        // Refresh
        load,

        // NEW: Phase 3 — Conflict resolution
        conflictDocs,             // ConflictDoc[] — danh sách docs xung đột
        docResolutions,           // Map<string, DuplicateResolution> — quyết định của user
        checkConflictsAndProceed, // Phase 2 "Sync →" → check conflicts → Phase 3 hoặc sync
        setDocResolution,         // Toggle per-doc: 'replace' | 'ignore'
        setAllResolutions,        // Bulk: Replace All / Ignore All
        goBackFromConflicts,      // Phase 3 "← Back" → Phase 2
    }
}

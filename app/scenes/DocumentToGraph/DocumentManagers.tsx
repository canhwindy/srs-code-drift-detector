'use client'

import React, { useState, useCallback, useEffect, useRef } from 'react'
import type { Document, DocumentManagerProps, StatusFilter, SortField, SortDirection } from './document-manager/types/document'
import ActionBar from './document-manager/ActionBar'
import Pagination from './document-manager/Pagination'
import StatusFilterBar from './document-manager/StatusFilterBar'
import DocumentTable from './document-manager/DocumentTable'
import ConfirmDialog from './document-manager/ConfirmDialog'
import DocumentManagerSkeleton from './document-manager/DocumentManagerSkeleton'
import { apiClearDocuments, apiDeleteDocuments, apiFetchDocuments, apiScanDocuments, apiFetchPipelineStatus } from './lib/api'
import { getDeletingIds, addDeletingIds, removeDeletingIds } from './document-manager/utils/deleting-ids-storage'
import { useToast } from './document-manager/hooks/useToast'
import Toast from './document-manager/Toast'
import { SyncCollectionDialog } from './SyncCollectionDialog'
import { useAutoSyncApproved } from './SyncCollectionDialog/hooks/useAutoSyncApproved'
import { useTranslation } from "react-i18next"

/** Number of documents per page — fixed for server-side pagination */
const PAGE_SIZE = 20

/**
 * DocumentManager Component
 *
 * A comprehensive document management interface with table view, filtering,
 * sorting, pagination, and batch operations.
 *
 * Documents are populated via the Sync Collection mechanism.
 *
 * Framework: Next.js 14+ (App Router)
 * Language: TypeScript
 * Styling: Tailwind CSS
 */

export default function DocumentManager({
  workspaceId,
  showFileNameByDefault = false,
  isLoading = false,
}: DocumentManagerProps) {
  const { t } = useTranslation();

  // ==========================================================================
  // UI State
  // ==========================================================================

  const [documents, setDocuments] = useState<Document[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [statusCounts, setStatusCounts] = useState({
    all: 0, processed: 0, preprocessed: 0, processing: 0, pending: 0, failed: 0,
  })
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [sortField, setSortField] = useState<SortField>('updated_at')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [currentPage, setCurrentPage] = useState(1)
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([])
  const [deletingDocIds, setDeletingDocIds] = useState<Set<string>>(
    () => getDeletingIds(workspaceId)
  )
  const [showFileName, setShowFileName] = useState(showFileNameByDefault)
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')

  // Dialog states
  const [showClearDialog, setShowClearDialog] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [showSyncDialog, setShowSyncDialog] = useState(false)

  // isDeleting: true trong khi apiDeleteDocuments() đang chạy
  // isClearing: true trong khi apiClearDocuments() đang chạy
  // isScanning: true trong khi apiScanDocuments() đang chạy hoặc pipeline đang xử lý
  // isFetchingDocuments: true trong khi fetchDocuments() đang chạy
  const [isDeleting, setIsDeleting] = useState(false)
  const [isClearing, setIsClearing] = useState(false)
  const [isScanning, setIsScanning] = useState(false)
  const [isFetchingDocuments, setIsFetchingDocuments] = useState(false)

  // isPipelineBusy: actual pipeline busy state từ RAM flag (GET /api/pipeline/status).
  const [isPipelineBusy, setIsPipelineBusy] = useState(false)
  const pipelinePollRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const triggerFastPollRef = useRef<(() => void) | null>(null)

  const { toast, showToast } = useToast(3500)
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── Refs: always hold latest pagination/filter/sort values ────────────────
  // Updated synchronously during render so callbacks always read current values.
  const currentPageRef = useRef(1)
  const statusFilterRef = useRef<StatusFilter>('all')
  const sortFieldRef = useRef<SortField>('updated_at')
  const sortDirectionRef = useRef<SortDirection>('desc')
  const workspaceIdRef = useRef(workspaceId)

  const searchQueryRef = useRef('')
  currentPageRef.current = currentPage
  statusFilterRef.current = statusFilter
  sortFieldRef.current = sortField
  sortDirectionRef.current = sortDirection
  searchQueryRef.current = debouncedSearch
  workspaceIdRef.current = workspaceId

  // Debounce searchQuery → debouncedSearch (300ms)
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300)
    return () => clearTimeout(timer)
  }, [searchQuery])

  // Reset to page 1 when debounced search changes
  useEffect(() => {
    setCurrentPage(1)
  }, [debouncedSearch])

  // ==========================================================================
  // Computed Values
  // ==========================================================================

  const totalPages = Math.ceil(totalCount / PAGE_SIZE)
  const isSelectionMode = selectedDocIds.length > 0
  const hasAnyDeleting = deletingDocIds.size > 0
  const currentPageDocIds = documents
    .filter((d) => !deletingDocIds.has(d.id))
    .map((d) => d.id)
  const isCurrentPageFullySelected =
    currentPageDocIds.length > 0 && currentPageDocIds.every((id) => selectedDocIds.includes(id))

  // ==========================================================================
  // Data Fetching — Server-Side Pagination
  // ==========================================================================

  /**
   * fetchDocuments — Fetch the current page from the server.
   * Reads from refs so it always uses the latest page/filter/sort state,
   * even when called from inside polling intervals or timeouts.
   */
  const fetchDocuments = useCallback(async () => {
    const statusParam = statusFilterRef.current === 'all' ? undefined : statusFilterRef.current
    const searchParam = searchQueryRef.current.trim() || undefined
    setIsFetchingDocuments(true)
    try {
      const result = await apiFetchDocuments(
        statusParam,
        currentPageRef.current,
        PAGE_SIZE,
        sortFieldRef.current,
        sortDirectionRef.current,
        searchParam,
        workspaceIdRef.current,
      )
      // Đọc localStorage SAU khi API resolve — tránh race condition với pollUntilDeleted.
      // Cross-check: IDs không còn trong backend response → tự cleanup localStorage ngay.
      const latestDeletingIds = getDeletingIds(workspaceIdRef.current)
      const resultDocIds = new Set(result.documents.map((d) => d.id))
      const gone = [...latestDeletingIds].filter((id) => !resultDocIds.has(id))
      if (gone.length > 0) {
        removeDeletingIds(workspaceIdRef.current, gone)
      }
      const activeDeletingIds = getDeletingIds(workspaceIdRef.current)
      const docs = result.documents.map((doc) =>
        activeDeletingIds.has(doc.id) ? { ...doc, status: 'deleting' as const } : doc
      )
      setDocuments(docs)
      setTotalCount(result.total)
      setDeletingDocIds(activeDeletingIds)
    } catch {
      // Keep stale data — don't crash the UI
    } finally {
      setIsFetchingDocuments(false)
    }
  }, [])

  /**
   * fetchStatusCounts — Fetch total counts for each status tab.
   * Runs 6 parallel requests (page_size=1) so the tab badges stay accurate
   * even when the user is viewing a filtered page.
   * Called on mount + after upload/delete/clear.
   */
  const fetchStatusCounts = useCallback(async () => {
    try {
      const [allR, processedR, preprocessedR, processingR, pendingR, failedR] = await Promise.all([
        apiFetchDocuments(undefined, 1, 1, 'updated_at', 'desc', undefined, workspaceIdRef.current),
        apiFetchDocuments('processed', 1, 1, 'updated_at', 'desc', undefined, workspaceIdRef.current),
        apiFetchDocuments('preprocessed', 1, 1, 'updated_at', 'desc', undefined, workspaceIdRef.current),
        apiFetchDocuments('processing', 1, 1, 'updated_at', 'desc', undefined, workspaceIdRef.current),
        apiFetchDocuments('pending', 1, 1, 'updated_at', 'desc', undefined, workspaceIdRef.current),
        apiFetchDocuments('failed', 1, 1, 'updated_at', 'desc', undefined, workspaceIdRef.current),
      ])
      setStatusCounts({
        all: allR.total,
        processed: processedR.total,
        preprocessed: preprocessedR.total,
        processing: processingR.total,
        pending: pendingR.total,
        failed: failedR.total,
      })
    } catch {
      // Keep stale counts
    }
  }, [])

  // Auto-fetch whenever page, filter, sort, or search changes
  useEffect(() => {
    void fetchDocuments()
  }, [currentPage, statusFilter, sortField, sortDirection, debouncedSearch, fetchDocuments, workspaceId])

  // Fetch status counts once on mount
  useEffect(() => {
    void fetchStatusCounts()
  }, [fetchStatusCounts])

  // ==========================================================================
  // Event Handlers
  // ==========================================================================

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDirection('desc')
    }
    setCurrentPage(1) // reset to page 1 on any sort change
  }

  const handleStatusFilterChange = (status: StatusFilter) => {
    setStatusFilter(status)
    setCurrentPage(1)
  }

  const handleSearchChange = (query: string) => {
    setSearchQuery(query)
    // Page reset happens when debouncedSearch actually changes (below)
  }

  const handlePageChange = (page: number) => setCurrentPage(page)

  const handleDocumentSelect = (docId: string, checked: boolean) => {
    setSelectedDocIds((prev) =>
      checked ? [...prev, docId] : prev.filter((id) => id !== docId)
    )
  }

  // Adaptive polling: poll pipeline status fast when busy, slow when idle.
  // busy=true  → 2s  (need quick UI updates during indexing)
  // busy=false → 30s (pipeline idle, no urgent updates needed)
  // Uses setTimeout chain instead of setInterval so:
  //   1. Next poll only schedules AFTER response arrives (no overlap)
  //   2. Delay auto-adjusts based on busy state from each response
  useEffect(() => {
    const scheduleNext = (busy: boolean) => {
      const delay = busy ? 2000 : 30000
      pipelinePollRef.current = setTimeout(poll, delay)
    }

    const poll = async () => {
      const data = await apiFetchPipelineStatus(workspaceIdRef.current)
      setIsPipelineBusy(data.busy)
      scheduleNext(data.busy)
    }

    // Expose trigger so action handlers (upload, sync, scan) can:
    //   1. Set isPipelineBusy=true immediately (no waiting for next poll)
    //   2. Cancel current 30s idle timeout → restart at 2s fast mode
    // Fixes: second+ upload/sync leaves Clear button enabled during 30s idle window
    triggerFastPollRef.current = () => {
      if (pipelinePollRef.current) {
        clearTimeout(pipelinePollRef.current)
        pipelinePollRef.current = null
      }
      setIsPipelineBusy(true)
      pipelinePollRef.current = setTimeout(poll, 2000)
    }

    poll() // immediate first check on mount
    return () => {
      if (pipelinePollRef.current) {
        clearTimeout(pipelinePollRef.current)
        pipelinePollRef.current = null
      }
      triggerFastPollRef.current = null
    }
  }, [])

  const handleDocumentsUploaded = useCallback(
    async (_uploadedFiles: File[]) => {
      // Upload triggers pipeline — set busy=true immediately
      triggerFastPollRef.current?.()
      // Wait 1s for backend background tasks to write doc_status, then refresh
      setTimeout(async () => {
        // Go to page 1 to see newly uploaded docs (sorted by updated_at desc)
        if (currentPageRef.current === 1) {
          // Already on page 1 — state won't change, so call fetch manually
          await fetchDocuments()
        } else {
          setCurrentPage(1) // triggers useEffect → fetchDocuments
        }
        await fetchStatusCounts()
      }, 1000)
    },
    [fetchDocuments, fetchStatusCounts],
  )

  // ==========================================================================
  // Auto-Sync Approved Documents — Sync documents with status "Approved" every 5 minutes
  // ==========================================================================

  const {
    status: autoSyncStatus,
    summary: autoSyncSummary,
    isEnabled: isAutoSyncEnabled,
    toggleEnabled: toggleAutoSync,
    triggerSync: triggerManualSync,
  } = useAutoSyncApproved(handleDocumentsUploaded, true, workspaceId, hasAnyDeleting)

  // Track the lastSyncAt value to detect NEW syncs (not old ones from localStorage)
  const prevLastSyncRef = useRef<Date | null>(null)

  // Show toast when auto-sync completes with results (only for NEW syncs)
  useEffect(() => {
    // Only show toast if:
    // 1. Status is idle (sync completed)
    // 2. We have a lastSyncAt timestamp
    // 3. This is a NEW sync (lastSyncAt changed from what we tracked)
    if (
      autoSyncStatus === 'idle' &&
      autoSyncSummary.lastSyncAt &&
      prevLastSyncRef.current !== null && // Skip first mount
      autoSyncSummary.lastSyncAt.getTime() !== prevLastSyncRef.current?.getTime()
    ) {
      const { documentsSynced, documentsUpdated, errors } = autoSyncSummary
      if (documentsSynced > 0 || documentsUpdated > 0) {
        const parts: string[] = []
        if (documentsSynced > 0) { parts.push(t('{{count}} added', { count: documentsSynced })) }
        if (documentsUpdated > 0) { parts.push(t('{{count}} updated', { count: documentsUpdated })) }
        showToast(
          t('Auto-sync completed: {{summary}}.', { summary: parts.join(', ') }),
          'success'
        )
      }
      if (errors > 0) {
        showToast(
          t('Auto-sync: {{count}} error(s) occurred.', { count: errors }),
          'warning'
        )
      }
    }
    // Update the ref to track current value
    prevLastSyncRef.current = autoSyncSummary.lastSyncAt
  }, [autoSyncStatus, autoSyncSummary.lastSyncAt, autoSyncSummary.documentsSynced, autoSyncSummary.documentsUpdated, autoSyncSummary.errors, showToast, t])


  // Cleanup cả hai intervals khi component unmount.
  // Tránh setInterval tiếp tục chạy sau khi user navigate đi
  // (nếu không cleanup: setDocuments() gọi trên unmounted component → warning)
  useEffect(() => () => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current)
    }
    if (pipelinePollRef.current) {
      clearTimeout(pipelinePollRef.current)
    }
  }, [])



  /**
   * pollUntilDeleted — Thay thế setTimeout × 2
   *
   * Cơ chế:
   *   1. Tạo setInterval chạy mỗi 2 giây
   *   2. Mỗi lần: fetch docs từ backend
   *   3. Trong lúc chờ: filter deleted IDs khỏi UI để tránh docs reappear
   *   4. Dừng khi: tất cả deletedDocIds đã biến mất khỏi backend response
   *   5. Dừng khi: đã poll MAX_POLLS lần (safeguard — tránh infinite loop)
   *
   * @param deletedDocIds - Danh sách doc_id vừa được gửi lệnh xóa
   */
  const pollUntilDeleted = useCallback((deletedDocIds: string[]) => {
    const deletedSet = new Set(deletedDocIds)
    const MAX_POLLS = 15
    let pollCount = 0

    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current)
    }

    pollIntervalRef.current = setInterval(async () => {
      pollCount++
      try {
        const statusParam = statusFilterRef.current === 'all' ? undefined : statusFilterRef.current
        const searchParam = searchQueryRef.current.trim() || undefined
        const result = await apiFetchDocuments(
          statusParam,
          currentPageRef.current,
          PAGE_SIZE,
          sortFieldRef.current,
          sortDirectionRef.current,
          searchParam,
          workspaceIdRef.current,
        )
        // Check if any deleted docs still appear on the current page
        const anyStillVisible = result.documents.some((d) => deletedSet.has(d.id))

        if (!anyStillVisible || pollCount >= MAX_POLLS) {
          // Done — cleanup localStorage + sync final state
          clearInterval(pollIntervalRef.current!)
          pollIntervalRef.current = null
          removeDeletingIds(workspaceIdRef.current, Array.from(deletedSet))
          const remaining = getDeletingIds(workspaceIdRef.current)
          setDeletingDocIds(remaining)
          const finalDocs = result.documents.map((doc) =>
            remaining.has(doc.id) ? { ...doc, status: 'deleting' as const } : doc
          )
          setDocuments(finalDocs)
          setTotalCount(result.total)
          void fetchStatusCounts()
        } else {
          // Still deleting — override status về "deleting" để tránh reappear
          const currentDeletingIds = getDeletingIds(workspaceIdRef.current)
          setDocuments(result.documents.map((doc) =>
            currentDeletingIds.has(doc.id) ? { ...doc, status: 'deleting' as const } : doc
          ))
          setTotalCount(result.total)
        }
      } catch {
        clearInterval(pollIntervalRef.current!)
        pollIntervalRef.current = null
        // Giữ nguyên localStorage — TTL 10 phút sẽ tự expire
      }
    }, 2000)
  }, [fetchStatusCounts])

  // ==========================================================================
  // Clear Handler — với Toast + Loading + Busy handling
  // ==========================================================================

  const handleClearConfirm = useCallback(async () => {
    // LOADING ON: Disable confirm button + hiện spinner
    setIsClearing(true)

    try {
      // ── BRANCH: Filter-aware clear ────────────────────────────────────────
      // statusFilter !== 'all' → chỉ xóa documents matching filter hiện tại
      // statusFilter === 'all' → xóa toàn bộ (drop all storages, nhanh hơn)
      if (statusFilterRef.current !== 'all') {
        // PHASE 1a: Fetch ALL doc IDs matching current filter (không giới hạn page)
        const filterStatus = statusFilterRef.current
        const filterCount = statusCounts[filterStatus]
        const result = await apiFetchDocuments(filterStatus, 1, Math.max(filterCount, 1000), 'updated_at', 'desc', undefined, workspaceIdRef.current)
        const docIdsToDelete = result.documents.map((d) => d.id)

        if (docIdsToDelete.length === 0) {
          showToast(t('No documents to clear for status "{{status}}".', { status: filterStatus }), 'info')
          setIsClearing(false)
          setShowClearDialog(false)
          return
        }

        // PHASE 1b: Gọi apiDeleteDocuments với danh sách doc IDs
        const deleteResult = await apiDeleteDocuments(docIdsToDelete, true, workspaceIdRef.current)

        if (deleteResult.status === 'busy') {
          showToast(t('Pipeline is busy. Please wait for indexing to finish.'), 'warning')
          setIsClearing(false)
          setShowClearDialog(false)
          return
        }

        // PHASE 2a: Optimistic UI update — xóa docs khỏi UI
        setDocuments((prev) => prev.filter((doc) => !docIdsToDelete.includes(doc.id)))
        setSelectedDocIds([])
        setShowClearDialog(false)

        showToast(
          t('Clearing {{count}} "{{status}}" document(s).', { count: docIdsToDelete.length, status: filterStatus }),
          'success',
        )

        // PHASE 3a: Poll until deleted docs disappear from backend
        pollUntilDeleted(docIdsToDelete)

      } else {
        // ── Original: Clear ALL (drop all storages) ─────────────────────────
        const result = await apiClearDocuments(workspaceIdRef.current)

        if (result.status === 'busy') {
          showToast(t('Pipeline is busy. Please wait for indexing to finish.'), 'warning')
          setIsClearing(false)
          setShowClearDialog(false)
          return
        }

        // PHASE 2b: Cập nhật UI state ngay lập tức
        setDocuments([])
        setTotalCount(0)
        setStatusCounts({ all: 0, processed: 0, preprocessed: 0, processing: 0, pending: 0, failed: 0 })
        setSelectedDocIds([])
        setCurrentPage(1)
        setShowClearDialog(false)

        showToast(t('All documents cleared.'), 'success')
      }

    } catch {
      // NETWORK ERROR: Vẫn clear UI, hiện error toast
      setDocuments([])
      setSelectedDocIds([])
      setShowClearDialog(false)
      showToast(t('Clear failed. UI updated but backend may have errors.'), 'error')

    } finally {
      // LOADING OFF: Luôn tắt loading dù thành công hay lỗi
      setIsClearing(false)
    }
  }, [statusCounts, showToast, pollUntilDeleted, t])

  // ==========================================================================
  // Scan/Retry Handler — Poll until pipeline is idle after scan
  // ==========================================================================

  /**
   * pollUntilIdle — Poll document list every 2s after a scan/retry is triggered.
   *
   * Stops when:
   *   1. No documents remain in active statuses (pending/processing/preprocessed)
   *   2. MAX_POLLS reached (safeguard against infinite loop)
   *
   * Uses the shared pollIntervalRef so there's only ever one active interval.
   */
  const pollUntilIdle = useCallback(() => {
    const ACTIVE = new Set(['pending', 'processing', 'preprocessed'])
    const MAX_POLLS = 30
    let count = 0

    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current)
    }

    pollIntervalRef.current = setInterval(async () => {
      count++
      try {
        const statusParam = statusFilterRef.current === 'all' ? undefined : statusFilterRef.current
        const searchParam = searchQueryRef.current.trim() || undefined
        const result = await apiFetchDocuments(
          statusParam,
          currentPageRef.current,
          PAGE_SIZE,
          sortFieldRef.current,
          sortDirectionRef.current,
          searchParam,
          workspaceIdRef.current,
        )
        setDocuments(result.documents)
        setTotalCount(result.total)

        const stillActive = result.documents.some((d) => ACTIVE.has(d.status))
        if (!stillActive || count >= MAX_POLLS) {
          clearInterval(pollIntervalRef.current!)
          pollIntervalRef.current = null
          setIsScanning(false)
          void fetchStatusCounts()
        }
      } catch {
        clearInterval(pollIntervalRef.current!)
        pollIntervalRef.current = null
        setIsScanning(false)
      }
    }, 2000)
  }, [fetchStatusCounts])

  /**
   * handleScanDocuments — Called when user clicks Scan/Retry button.
   *
   * Calls POST /api/documents/scan which:
   *   - Checks pipeline busy (race condition guard in lightrag_extended)
   *   - Scans input_document/ for new files
   *   - Re-triggers processing for PENDING/FAILED/PROCESSING docs
   *   - Returns immediately; actual work runs in FastAPI background task
   *
   * Race condition response:
   *   - status="busy"            → toast warning, no polling needed (pipeline auto-retries)
   *   - status="scanning_started" → toast info + start 2s polling until idle
   */
  const handleScanDocuments = useCallback(async () => {
    setIsScanning(true)
    try {
      const result = await apiScanDocuments(workspaceIdRef.current)

      if (result.status === 'busy') {
        showToast(
          t('Pipeline is already running. Pending and failed documents will be retried automatically when it finishes.'),
          'warning',
        )
        setIsScanning(false)
        return
      }

      // scanning_started — pipeline is now running
      // Kick pipeline poll to fast mode immediately (don't wait for 30s idle window)
      triggerFastPollRef.current?.()
      showToast(t('Scanning and reprocessing started. The document list will update as files are indexed.'), 'info')
      // Refresh immediately, then keep polling until idle
      await fetchDocuments()
      pollUntilIdle()
    } catch {
      showToast(t('Scan/Retry failed. Check your connection and try again.'), 'error')
      setIsScanning(false)
    }
  }, [showToast, fetchDocuments, pollUntilIdle])

  // ==========================================================================
  // Delete Handler — với Toast + Loading + Busy handling + Smart Polling
  // ==========================================================================

  const handleDeleteConfirm = useCallback(async () => {
    // SNAPSHOT: Lấy selectedDocIds tại thời điểm gọi
    // (tránh closure stale nếu user deselect trong lúc dialog đang hiện)
    const docIdsToDelete = [...selectedDocIds]

    // LOADING ON: Disable confirm button + hiện spinner
    setIsDeleting(true)

    try {
      // PHASE 1: Gọi backend đăng ký background deletion
      const result = await apiDeleteDocuments(docIdsToDelete, true, workspaceIdRef.current)

      if (result.status === 'busy') {
        // ── IMPROVED: Hiện toast thay vì console.warn im lặng ──────────────
        showToast(t('Pipeline is busy. Please wait for indexing to finish.'), 'warning')
        setIsDeleting(false)
        setShowDeleteDialog(false)
        return
      }

      // "deletion_started": background task đã đăng ký thành công
      showToast(t('Deletion started for {{count}} document(s).', { count: result.doc_ids.length }), 'info')

      // PHASE 2: Ghi localStorage + cập nhật state → fetchDocuments sẽ hiện "deleting"
      addDeletingIds(workspaceIdRef.current, docIdsToDelete)
      setDeletingDocIds(getDeletingIds(workspaceIdRef.current))

    } catch {
      // NETWORK ERROR: Không thêm vào "deleting" — giữ nguyên UI
      showToast(t('Delete request failed. Check your connection.'), 'error')
      setIsDeleting(false)
      setShowDeleteDialog(false)
      return
    }

    setSelectedDocIds([])
    setShowDeleteDialog(false)

    // LOADING OFF
    setIsDeleting(false)

    // Fetch lại để render badge "Deleting" ngay lập tức
    await fetchDocuments()

    // PHASE 3: Poll cho đến khi backend xóa xong → cleanup localStorage
    pollUntilDeleted(docIdsToDelete)

  }, [selectedDocIds, showToast, pollUntilDeleted])

  // ==========================================================================
  // Loading State
  // ==========================================================================

  if (isLoading) {
    return <DocumentManagerSkeleton />
  }

  // ==========================================================================
  // Main Render
  // ==========================================================================

  return (
    <div className="flex flex-col min-h-0">

      {/* ── NEW: Toast notification ─────────────────────────────────────────────
          Render ở đây (ngoài cùng) để z-index luôn cao nhất.
          Toast component dùng `fixed` positioning nên không ảnh hưởng layout.
      ────────────────────────────────────────────────────────────────────────── */}
      <Toast {...toast} />
      {/* Content */}
      <div className="flex-1 flex flex-col min-h-0">

        {/* Action Bar */}
        <div className="mb-4">
          <ActionBar
            isSelectionMode={isSelectionMode}
            isCurrentPageFullySelected={isCurrentPageFullySelected}
            selectedCount={selectedDocIds.length}
            isDeleting={isDeleting}
            isScanning={isScanning}
            onScanDocuments={handleScanDocuments}
            onSyncCollection={() => setShowSyncDialog(true)}
            onClearDocuments={() => setShowClearDialog(true)}
            hasPipelineBusyDoc={isPipelineBusy}
            hasAnyDeleting={hasAnyDeleting}
            statusFilter={statusFilter}
            statusFilterCount={statusCounts[statusFilter]}
            onDeleteDocuments={() => setShowDeleteDialog(true)}
            onSelectCurrentPage={() => setSelectedDocIds(currentPageDocIds)}
            onDeselectAll={() => setSelectedDocIds([])}
            // Auto-sync controls
            autoSyncStatus={autoSyncStatus}
            isAutoSyncEnabled={isAutoSyncEnabled}
            lastSyncAt={autoSyncSummary.lastSyncAt}
            lastSyncAdded={autoSyncSummary.documentsSynced}
            lastSyncUpdated={autoSyncSummary.documentsUpdated}
            onToggleAutoSync={toggleAutoSync}
            onTriggerManualSync={triggerManualSync}
          />
        </div>

        {/* Documents Section */}

        <div className="flex flex-col border border-gray-200 dark:border-[#2a2f3e] rounded-lg overflow-hidden">
          <StatusFilterBar
            statusFilter={statusFilter}
            statusCounts={statusCounts}
            showFileName={showFileName}
            searchQuery={searchQuery}
            onFilterChange={handleStatusFilterChange}
            onSearchChange={handleSearchChange}
            onRefresh={fetchDocuments}
            onToggleFileName={() => setShowFileName(!showFileName)}
          />

          <div className="overflow-auto relative">
            {isFetchingDocuments && (
              <div className="absolute inset-0 bg-white/70 dark:bg-[#111319]/70 flex items-center justify-center z-20">
                <svg
                  className="animate-spin h-7 w-7 text-[#3db18a]"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
              </div>
            )}
            <DocumentTable
              documents={documents}
              sortField={sortField}
              sortDirection={sortDirection}
              showFileName={showFileName}
              selectedDocIds={selectedDocIds}
              deletingDocIds={deletingDocIds}
              onSort={handleSort}
              onDocumentSelect={handleDocumentSelect}
            />
          </div>

          {totalCount > 0 && (
            <div className="flex justify-end px-4 py-2.5 border-t border-gray-100 dark:border-[#2a2f3e]">
              <Pagination
                currentPage={currentPage}
                totalPages={totalPages}
                totalCount={totalCount}
                pageSize={PAGE_SIZE}
                onPageChange={handlePageChange}
              />
            </div>
          )}
        </div>
      </div>

      {/* Dialogs */}
      <SyncCollectionDialog
        isOpen={showSyncDialog}
        onClose={() => setShowSyncDialog(false)}
        onDocumentsUploaded={handleDocumentsUploaded}
        workspaceId={workspaceId}
      />

      {/* Clear Dialog — truyền isLoading=isClearing */}
      <ConfirmDialog
        open={showClearDialog}
        title={
          statusFilter === 'all'
            ? t("Clear All Documents")
            : t('Clear "{{status}}" Documents', { status: statusFilter.charAt(0).toUpperCase() + statusFilter.slice(1) })
        }
        message={
          statusFilter === 'all'
            ? t("Are you sure you want to clear all documents?")
            : t('Are you sure you want to clear all {{count}} "{{status}}" document(s)?', {
                count: statusCounts[statusFilter],
                status: statusFilter.charAt(0).toUpperCase() + statusFilter.slice(1),
              })
        }
        confirmLabel={t("Clear")}
        confirmVariant="danger"
        isLoading={isClearing}
        onConfirm={handleClearConfirm}
        onCancel={() => !isClearing && setShowClearDialog(false)}
      />

      {/* Delete Dialog — truyền isLoading=isDeleting */}
      <ConfirmDialog
        open={showDeleteDialog}
        title={t("Delete Documents")}
        message={t("Delete {{count}} selected document(s)?", { count: selectedDocIds.length })}
        confirmLabel={t("Delete")}
        confirmVariant="danger"
        isLoading={isDeleting}
        onConfirm={handleDeleteConfirm}
        onCancel={() => !isDeleting && setShowDeleteDialog(false)}
      />
    </div>
  )
}

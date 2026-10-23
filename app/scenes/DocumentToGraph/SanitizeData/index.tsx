
import React, { useEffect, useMemo, useState } from 'react'
import { useTranslation } from "react-i18next";

import { apiFetchEntities, apiMergeEntities, WorkspaceLockError, isWorkspaceLockError } from '../lib/api'
import type { EntityItem } from '../lib/api.type'
import { MIN_MERGE_COUNT, PAGE_SIZE } from './constants'
import { EntityActionBar } from './EntityActionBar'
import { EntityCardGrid } from './EntityCardGrid'
import { EntitySidebar } from './EntitySidebar'
import { MergeModal } from './MergeModal'
import ConfirmDialog from '../document-manager/ConfirmDialog'
import type { Entity, FilterMode, ShowMode } from './types'

// ── Helper: Map API response → Frontend Entity ──────────────────────────────

/** Map EntityItem (snake_case từ API) sang Entity (camelCase frontend) */
function mapEntityItem(item: EntityItem): Entity {
    return {
        name: item.name,
        type: item.type,
        description: item.description,
        isOrphan: item.is_orphan,
        relationCount: item.relation_count,
    }
}


/**
 * SanitizeData — Trang quản lý và làm sạch Knowledge Graph entities.
 *
 * Layout: hai cột ngang (sidebar 460px | main flex-1).
 * Fetch toàn bộ entities từ /api/entities khi mount, sau đó
 * filter + paginate client-side.
 *
 * Merge flow:
 *   1. User chọn ≥2 entities + "Show Sel. Only" → canMerge = true
 *   2. Click "Merge Entities" → MergeModal mở
 *   3. User chọn target trong dropdown → click Confirm
 *   4. ConfirmDialog hiển thị cảnh báo operation không thể hoàn tác
 *   5. POST /api/graph/entities/merge → LightRAG xử lý
 *   6. Refresh entity list, clear selection, alert success
 */
interface SanitizeDataProps {
  workspaceId: string;
}

export default function SanitizeData({ workspaceId }: SanitizeDataProps): React.JSX.Element {
    const { t } = useTranslation();

    // ── Entity data state ─────────────────────────────────────────────────
    const [allEntities, setAllEntities] = useState<Entity[]>([])
    const [isLoadingEntities, setIsLoadingEntities] = useState<boolean>(true)
    const [loadError, setLoadError] = useState<string | null>(null)
    const [loadLockError, setLoadLockError] = useState<WorkspaceLockError | null>(null)

    // ── UI state ──────────────────────────────────────────────────────────
    const [selectedEntities, setSelectedEntities] = useState<string[]>([])
    const [searchQuery, setSearchQuery] = useState<string>('')
    const [filterMode, setFilterMode] = useState<FilterMode>('all')
    const [showMode, setShowMode] = useState<ShowMode>('all')
    const [currentPage, setCurrentPage] = useState<number>(1)

    // ── Merge state ───────────────────────────────────────────────────────
    /** true khi MergeModal đang mở (chờ user chọn target) */
    const [isMergeModalOpen, setIsMergeModalOpen] = useState<boolean>(false)
    /** true khi đang gọi API merge (chờ response từ backend) */
    const [isMerging, setIsMerging] = useState<boolean>(false)
    /** target entity đang chờ xác nhận lần cuối; null = ConfirmDialog đóng */
    const [pendingMergeTarget, setPendingMergeTarget] = useState<string | null>(null)

    // ── Fetch entities on mount ───────────────────────────────────────────
    useEffect(() => {
        let cancelled = false

        async function fetchEntities(): Promise<void> {
            setIsLoadingEntities(true)
            setLoadError(null)
            setLoadLockError(null)

            try {
                const response = await apiFetchEntities(workspaceId)
                if (!cancelled) {
                    setAllEntities(response.entities.map(mapEntityItem))
                }
            } catch (err: unknown) {
                if (!cancelled) {
                    if (isWorkspaceLockError(err)) {
                        setLoadLockError(err instanceof WorkspaceLockError ? err : new WorkspaceLockError((err as Error).message, (err as WorkspaceLockError).detail ?? {}))
                    } else {
                        const message =
                            err instanceof Error ? err.message : 'Failed to load entities'
                        setLoadError(message)
                    }
                }
            } finally {
                if (!cancelled) {
                    setIsLoadingEntities(false)
                }
            }
        }

        void fetchEntities()

        return () => {
            cancelled = true
        }
    }, [workspaceId]) // refetch khi mount hoặc workspace thay đổi

    // ── Filtered list ─────────────────────────────────────────────────────
    const filteredEntities = useMemo<Entity[]>(() => {
        let list: Entity[] = allEntities

        // 1. Filter theo search query (case-insensitive)
        if (searchQuery.trim() !== '') {
            const query = searchQuery.toLowerCase()
            list = list.filter((e) => e.name.toLowerCase().includes(query))
        }

        // 2. Filter orphan
        if (filterMode === 'orphans') {
            list = list.filter((e) => e.isOrphan)
        }

        // 3. Chỉ hiện entities đang được chọn nếu "Show Sel. Only"
        if (showMode === 'selected') {
            list = list.filter((e) => selectedEntities.includes(e.name))
        }

        return list
    }, [allEntities, searchQuery, filterMode, showMode, selectedEntities])

    // ── Pagination derived values ─────────────────────────────────────────
    const totalPages = Math.max(1, Math.ceil(filteredEntities.length / PAGE_SIZE))
    const safePage = Math.min(currentPage, totalPages)
    const startIdx = (safePage - 1) * PAGE_SIZE
    const paginatedEntities = filteredEntities.slice(startIdx, startIdx + PAGE_SIZE)

    // ── Merge eligibility ─────────────────────────────────────────────────
    const canMerge =
        selectedEntities.length >= MIN_MERGE_COUNT && showMode === 'selected'

    // ── Event handlers ────────────────────────────────────────────────────

    const handleToggleEntity = (name: string): void => {
        setSelectedEntities((prev) =>
            prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name],
        )
    }

    const handleClearSelection = (): void => {
        setSelectedEntities([])
    }

    const handleShowSelectedOnly = (): void => {
        setShowMode('selected')
        setCurrentPage(1)
    }

    const handleShowAll = (): void => {
        setShowMode('all')
        setCurrentPage(1)
    }

    const handleResetAll = (): void => {
        setSelectedEntities([])
        setSearchQuery('')
        setFilterMode('all')
        setShowMode('all')
        setCurrentPage(1)
    }

    const handleFilterModeChange = (mode: FilterMode): void => {
        setFilterMode(mode)
        setCurrentPage(1)
    }

    const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
        setSearchQuery(e.target.value)
        setCurrentPage(1)
    }

    const handlePageChange = (page: number): void => {
        setCurrentPage(page)
    }

    // ── Merge handlers ────────────────────────────────────────────────────

    /**
     * Mở MergeModal để user chọn target entity.
     * Chỉ gọi khi canMerge === true (button đã disabled guard).
     */
    const handleMergeClick = (): void => {
        setIsMergeModalOpen(true)
    }

    /**
     * Đóng MergeModal khi user click Cancel hoặc overlay.
     */
    const handleMergeCancel = (): void => {
        setIsMergeModalOpen(false)
    }

    /**
     * Bước 1 của merge flow: user chọn target trong MergeModal rồi click Confirm.
     * Đóng MergeModal và mở ConfirmDialog để xác nhận lần cuối.
     */
    const handleMergeConfirm = (targetEntity: string): void => {
        const entitiesToChange = selectedEntities.filter((name) => name !== targetEntity)
        if (entitiesToChange.length === 0) {
            window.alert(t('No source entities to merge.'))
            return
        }
        setIsMergeModalOpen(false)
        setPendingMergeTarget(targetEntity)
    }

    /** Đóng ConfirmDialog mà không thực hiện merge. */
    const handleConfirmDialogCancel = (): void => {
        setPendingMergeTarget(null)
    }

    /**
     * Bước 2 của merge flow: user click Confirm trong ConfirmDialog.
     * Thực hiện API call merge thực sự.
     */
    const handleDoMerge = async (): Promise<void> => {
        if (!pendingMergeTarget) { return }

        const targetEntity = pendingMergeTarget
        const entitiesToChange = selectedEntities.filter((name) => name !== targetEntity)

        setPendingMergeTarget(null)
        setIsMerging(true)

        try {
            const result = await apiMergeEntities(entitiesToChange, targetEntity, workspaceId)

            const freshData = await apiFetchEntities(workspaceId)
            setAllEntities(freshData.entities.map(mapEntityItem))

            setSelectedEntities([])
            setShowMode('all')
            setCurrentPage(1)

            window.alert(result.message ?? t('Entities merged successfully!'))
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : t('Failed to merge entities.')
            window.alert(message)
        } finally {
            setIsMerging(false)
        }
    }

    // ── Render ────────────────────────────────────────────────────────────
    return (
        <div
            className="flex overflow-hidden -mx-6 -my-6"
            style={{ height: 'calc(100vh - 3.5rem)' }}
        >
            {/* Sidebar trái */}
            <EntitySidebar
                selectedEntities={selectedEntities}
                paginatedEntities={paginatedEntities}
                currentPage={safePage}
                totalPages={totalPages}
                searchQuery={searchQuery}
                filterMode={filterMode}
                isLoading={isLoadingEntities}
                loadError={loadError}
                loadLockError={loadLockError}
                onToggleEntity={handleToggleEntity}
                onClearSelection={handleClearSelection}
                onShowSelectedOnly={handleShowSelectedOnly}
                onShowAll={handleShowAll}
                onResetAll={handleResetAll}
                onFilterModeChange={handleFilterModeChange}
                onSearchChange={handleSearchChange}
                onPageChange={handlePageChange}
            />

            {/* Main section phải */}
            <div className="flex-1 flex flex-col overflow-hidden bg-white dark:bg-[#111319]">
                <EntityActionBar
                    canMerge={canMerge}
                    onMergeClick={handleMergeClick}
                    isMerging={isMerging}
                />

                <div className="flex-1 overflow-y-auto">
                    {selectedEntities.length === 0 ? (
                        <div className="h-full flex items-center justify-center">
                            <p className="text-sm text-gray-400 dark:text-[#6b7280]">
                                {t('Select one or more entities on the left to view their details')}
                            </p>
                        </div>
                    ) : (
                        <EntityCardGrid entityNames={selectedEntities} workspaceId={workspaceId} />
                    )}
                </div>
            </div>

            {/* Merge Modal — render ở đây để nằm ngoài overflow:hidden containers */}
            <MergeModal
                isOpen={isMergeModalOpen}
                selectedEntities={selectedEntities}
                onConfirm={handleMergeConfirm}
                onCancel={handleMergeCancel}
            />

            {/* Confirm Dialog — xác nhận lần cuối trước khi thực hiện merge */}
            <ConfirmDialog
                open={pendingMergeTarget !== null}
                title={t('Confirm Merge')}
                message={t('Are you sure you want to merge {{count}} entities into "{{target}}"? Source entities will be permanently deleted. This cannot be undone.', {
                    count: pendingMergeTarget
                        ? selectedEntities.filter((n) => n !== pendingMergeTarget).length
                        : 0,
                    target: pendingMergeTarget ?? '',
                })}
                confirmLabel={t('Merge')}
                confirmVariant="danger"
                isLoading={isMerging}
                onConfirm={() => { void handleDoMerge() }}
                onCancel={handleConfirmDialogCancel}
            />
        </div>
    )
}
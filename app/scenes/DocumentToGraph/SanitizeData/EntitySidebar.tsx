'use client'

// ============================================================
// FILE: SanitizeData/EntitySidebar.tsx
// Sidebar trái — search, filter tabs, pagination,
// entity list với checkbox, selection controls, footer count.
// Hỗ trợ resize: kéo drag handle bên phải để thay đổi width.
// ============================================================

import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from "react-i18next";

import { PAGE_SIZE } from './constants'
import type { Entity, FilterMode } from './types'
import type { WorkspaceLockError } from '../lib/api'
import LockErrorBanner from '../components/LockErrorBanner'

// ── Resize constants ────────────────────────────────────────────────────────
const MIN_SIDEBAR_WIDTH = 240
const MAX_SIDEBAR_WIDTH = 640
const DEFAULT_SIDEBAR_WIDTH = 460

export interface EntitySidebarProps {
    // ── Data ──────────────────────────────────────────────────
    /** Danh sách tên entity đang được check */
    selectedEntities: string[]
    /** Trang hiện tại đã được paginate — truyền thẳng để render */
    paginatedEntities: Entity[]
    /** Trang hiện tại (1-based) */
    currentPage: number
    /** Tổng số trang */
    totalPages: number
    /** Giá trị ô tìm kiếm */
    searchQuery: string
    /** Chế độ filter: 'all' | 'orphans' */
    filterMode: FilterMode
    /** true khi đang fetch entities từ backend lần đầu */
    isLoading: boolean
    /** Error message nếu fetch entities thất bại (lỗi thông thường) */
    loadError: string | null
    /** WorkspaceLockError nếu workspace đang bị khoá */
    loadLockError?: WorkspaceLockError | null

    // ── Callbacks ─────────────────────────────────────────────
    onToggleEntity: (name: string) => void
    onClearSelection: () => void
    onShowSelectedOnly: () => void
    onShowAll: () => void
    onResetAll: () => void
    onFilterModeChange: (mode: FilterMode) => void
    onSearchChange: (e: React.ChangeEvent<HTMLInputElement>) => void
    onPageChange: (page: number) => void
}

/**
 * Sidebar trái hiển thị danh sách entity với:
 * - Search input (filter by name)
 * - Filter tabs: All Of Type / Orphans
 * - Pagination: First / Prev / [page input] / Next / Last
 * - Selection controls: Clear Sel. / Show Sel. Only / Show All / Reset All
 * - Entity list với checkbox, orphan badge, relation count
 * - Loading skeleton và error state khi fetch entities
 * - Footer: tổng số entity đang được chọn
 */
export function EntitySidebar({
    selectedEntities,
    paginatedEntities,
    currentPage,
    totalPages,
    searchQuery,
    filterMode,
    isLoading,
    loadError,
    loadLockError,
    onToggleEntity,
    onClearSelection,
    onShowSelectedOnly,
    onShowAll,
    onResetAll,
    onFilterModeChange,
    onSearchChange,
    onPageChange,
}: EntitySidebarProps): React.JSX.Element {
    const { t } = useTranslation();

    // ── Resize state ──────────────────────────────────────────────────────
    const [sidebarWidth, setSidebarWidth] = useState<number>(DEFAULT_SIDEBAR_WIDTH)
    const isDragging = useRef<boolean>(false)
    const dragStartX = useRef<number>(0)
    const dragStartWidth = useRef<number>(DEFAULT_SIDEBAR_WIDTH)

    // ── Collapse state ────────────────────────────────────────────────────
    const [isCollapsed, setIsCollapsed] = useState<boolean>(false)
    const preCollapseWidth = useRef<number>(DEFAULT_SIDEBAR_WIDTH)

    const handleToggleCollapse = (): void => {
        if (isCollapsed) {
            setSidebarWidth(preCollapseWidth.current)
        } else {
            preCollapseWidth.current = sidebarWidth
        }
        setIsCollapsed(prev => !prev)
    }

    // Attach document-level listeners once — handlers read from refs to avoid
    // stale closure issues and prevent unnecessary effect re-runs.
    useEffect(() => {
        const handleMouseMove = (e: MouseEvent): void => {
            if (!isDragging.current) { return }
            const delta = e.clientX - dragStartX.current
            const newWidth = Math.min(
                MAX_SIDEBAR_WIDTH,
                Math.max(MIN_SIDEBAR_WIDTH, dragStartWidth.current + delta),
            )
            setSidebarWidth(newWidth)
        }

        const handleMouseUp = (): void => {
            if (!isDragging.current) { return }
            isDragging.current = false
            document.body.style.userSelect = ''
            document.body.style.cursor = ''
        }

        document.addEventListener('mousemove', handleMouseMove)
        document.addEventListener('mouseup', handleMouseUp)

        return () => {
            document.removeEventListener('mousemove', handleMouseMove)
            document.removeEventListener('mouseup', handleMouseUp)
            // Safety: ensure body styles are cleaned up on unmount
            document.body.style.userSelect = ''
            document.body.style.cursor = ''
        }
    }, [])

    const handleDragStart = (e: React.MouseEvent<HTMLDivElement>): void => {
        e.preventDefault()
        isDragging.current = true
        dragStartX.current = e.clientX
        dragStartWidth.current = sidebarWidth
        // Prevent text selection and show resize cursor globally while dragging
        document.body.style.userSelect = 'none'
        document.body.style.cursor = 'col-resize'
    }

    // ── Page input handler ────────────────────────────────────────────────
    const handlePageInputChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
        const parsed = parseInt(e.target.value, 10)
        if (!isNaN(parsed)) {
            onPageChange(Math.max(1, Math.min(totalPages, parsed)))
        }
    }

    return (
        <div
            style={{ width: isCollapsed ? 40 : sidebarWidth }}
            className="relative flex-shrink-0 border-r border-gray-200 dark:border-[#2a2f3e] flex flex-col overflow-hidden bg-white dark:bg-[#111319] transition-[width] duration-200"
        >
            {/* ── Collapsed strip ───────────────────────────────────────────── */}
            {isCollapsed && (
                <div className="flex flex-col items-center pt-3 h-full">
                    <button
                        type="button"
                        onClick={handleToggleCollapse}
                        title="Expand sidebar"
                        className="p-1.5 rounded text-gray-500 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                    >
                        ›
                    </button>
                </div>
            )}

            {/* ── Expanded content ──────────────────────────────────────────── */}
            {!isCollapsed && <>

            {/* Collapse toggle button */}
            <button
                type="button"
                onClick={handleToggleCollapse}
                title="Collapse sidebar"
                className="absolute top-2.5 right-4 z-10 p-1 rounded text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-base leading-none"
            >
                ‹
            </button>

            {/* ── Search input ──────────────────────────────────────────────── */}
            <div className="p-3 pr-8 border-b border-gray-200 dark:border-[#2a2f3e]">
                <input
                    type="text"
                    placeholder={t("Filter entities...")}
                    value={searchQuery}
                    onChange={onSearchChange}
                    className="w-full px-3 py-1.5 text-sm border border-gray-300 dark:border-[#2a2f3e] rounded bg-white dark:bg-[#111319] text-gray-900 dark:text-[#E6E6E6] placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-emerald-400 focus:border-emerald-400"
                />
            </div>

            {/* ── Filter tabs ───────────────────────────────────────────────── */}
            <div className="flex gap-2 px-3 py-2 border-b border-gray-200 dark:border-[#2a2f3e]">
                <button
                    type="button"
                    onClick={() => onFilterModeChange('all')}
                    className={`px-3 py-1 text-xs rounded border transition-colors ${filterMode === 'all'
                        ? 'bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 border-gray-900 dark:border-gray-100'
                        : 'bg-white dark:bg-[#111319] text-gray-700 dark:text-[#E6E6E6] border-gray-300 dark:border-[#2a2f3e] hover:bg-gray-50 dark:hover:bg-gray-800'
                        }`}
                >
                    {t('All Of Type')}
                </button>
                <button
                    type="button"
                    onClick={() => onFilterModeChange('orphans')}
                    className={`px-3 py-1 text-xs rounded border transition-colors ${filterMode === 'orphans'
                        ? 'bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 border-gray-900 dark:border-gray-100'
                        : 'bg-white dark:bg-[#111319] text-gray-700 dark:text-[#E6E6E6] border-gray-300 dark:border-[#2a2f3e] hover:bg-gray-50 dark:hover:bg-gray-800'
                        }`}
                >
                    {t('Orphans')}
                </button>
            </div>

            {/* ── Pagination controls ───────────────────────────────────────── */}
            <div className="flex items-center gap-1 px-3 py-2 border-b border-gray-200 dark:border-[#2a2f3e] text-xs">
                <button
                    type="button"
                    onClick={() => onPageChange(1)}
                    disabled={currentPage <= 1}
                    className="px-2 py-1 rounded border border-gray-300 dark:border-[#2a2f3e] bg-white dark:bg-[#111319] text-gray-700 dark:text-[#E6E6E6] disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:cursor-not-allowed transition-colors"
                >
                    {t('First')}
                </button>
                <button
                    type="button"
                    onClick={() => onPageChange(Math.max(1, currentPage - 1))}
                    disabled={currentPage <= 1}
                    className="px-2 py-1 rounded border border-gray-300 dark:border-[#2a2f3e] bg-white dark:bg-[#111319] text-gray-700 dark:text-[#E6E6E6] disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:cursor-not-allowed transition-colors"
                >
                    {t('Prev')}
                </button>
                <div className="flex items-center gap-1 mx-1">
                    <span className="text-gray-500 dark:text-[#8a8f9e]">{t('Pg')}</span>
                    <input
                        type="number"
                        min={1}
                        max={totalPages}
                        value={currentPage}
                        onChange={handlePageInputChange}
                        className="w-10 px-1 py-0.5 text-center border border-gray-300 dark:border-[#2a2f3e] rounded bg-white dark:bg-[#111319] text-gray-900 dark:text-[#E6E6E6] focus:outline-none focus:ring-1 focus:ring-emerald-400"
                    />
                    <span className="text-gray-500 dark:text-[#8a8f9e]">{t("/ {{total}}", { total: totalPages })}</span>
                </div>
                <button
                    type="button"
                    onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
                    disabled={currentPage >= totalPages}
                    className="px-2 py-1 rounded border border-gray-300 dark:border-[#2a2f3e] bg-white dark:bg-[#111319] text-gray-700 dark:text-[#E6E6E6] disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:cursor-not-allowed transition-colors"
                >
                    {t('Next')}
                </button>
                <button
                    type="button"
                    onClick={() => onPageChange(totalPages)}
                    disabled={currentPage >= totalPages}
                    className="px-2 py-1 rounded border border-gray-300 dark:border-[#2a2f3e] bg-white dark:bg-[#111319] text-gray-700 dark:text-[#E6E6E6] disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:cursor-not-allowed transition-colors"
                >
                    {t('Last')}
                </button>
            </div>

            {/* ── Selection controls ────────────────────────────────────────── */}
            <div className="flex flex-wrap gap-1.5 px-3 py-2 border-b border-gray-200 dark:border-[#2a2f3e]">
                <button
                    type="button"
                    onClick={onClearSelection}
                    className="px-2.5 py-1 text-xs rounded border border-gray-300 dark:border-[#2a2f3e] bg-white dark:bg-[#111319] text-gray-700 dark:text-[#E6E6E6] hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                >
                    {t('Clear Sel.')}
                </button>
                <button
                    type="button"
                    onClick={onShowSelectedOnly}
                    disabled={selectedEntities.length === 0}
                    className="px-2.5 py-1 text-xs rounded border border-gray-300 dark:border-[#2a2f3e] bg-white dark:bg-[#111319] text-gray-700 dark:text-[#E6E6E6] hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                    {t('Show Sel. Only')}
                </button>
                <button
                    type="button"
                    onClick={onShowAll}
                    className="px-2.5 py-1 text-xs rounded border border-gray-300 dark:border-[#2a2f3e] bg-white dark:bg-[#111319] text-gray-700 dark:text-[#E6E6E6] hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                >
                    {t('Show All')}
                </button>
                <button
                    type="button"
                    onClick={onResetAll}
                    className="px-2.5 py-1 text-xs rounded border border-red-300 dark:border-red-800 bg-white dark:bg-[#111319] text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
                >
                    {t('Reset All')}
                </button>
            </div>

            {/* ── List header ───────────────────────────────────────────────── */}
            <div className="flex items-center px-3 py-2 border-b border-gray-200 dark:border-[#2a2f3e] bg-gray-50 dark:bg-[#111319]">
                <div className="w-8 flex-shrink-0 text-xs font-semibold text-gray-600 dark:text-[#8a8f9e]">
                    {t('Select')}
                </div>
                <div className="flex-1 text-xs font-semibold text-gray-600 dark:text-[#8a8f9e]">
                    {t('Entity Name')}
                </div>
                <div className="w-16 text-right text-xs font-semibold text-gray-600 dark:text-[#8a8f9e]">
                    {t('Relations')}
                </div>
            </div>
            <div className="px-3 py-1 border-b border-gray-200 dark:border-[#2a2f3e] bg-gray-50 dark:bg-[#111319]">
                <span className="text-xs font-semibold text-gray-600 dark:text-[#8a8f9e]">{t('Entities')}</span>
            </div>

            {/* ── Entity list (scrollable) ──────────────────────────────────── */}
            <div className="flex-1 overflow-y-auto">
                {/* Loading state — fetch entities lần đầu */}
                {isLoading ? (
                    <div className="space-y-0">
                        {Array.from({ length: PAGE_SIZE }).map((_, i) => (
                            // eslint-disable-next-line react/no-array-index-key
                            <div key={i} className="flex items-center px-3 py-2 border-b border-gray-100 dark:border-[#2a2f3e] animate-pulse">
                                <div className="w-8 flex-shrink-0">
                                    <div className="w-3.5 h-3.5 bg-gray-200 dark:bg-[#2a2f3e] rounded" />
                                </div>
                                <div className="flex-1 h-3.5 bg-gray-200 dark:bg-[#2a2f3e] rounded mr-4" />
                                <div className="w-6 h-3 bg-gray-200 dark:bg-[#2a2f3e] rounded" />
                            </div>
                        ))}
                    </div>
                ) : loadLockError !== null && loadLockError !== undefined ? (
                    /* Workspace lock state — friendly banner */
                    <div className="p-4">
                        <LockErrorBanner error={loadLockError} />
                    </div>
                ) : loadError !== null ? (
                    /* Error state */
                    <div className="p-4">
                        <div className="flex items-start gap-2 p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded text-xs">
                            <span className="text-red-500 flex-shrink-0">⚠</span>
                            <p className="text-red-700 dark:text-red-400 leading-relaxed">{loadError}</p>
                        </div>
                    </div>
                ) : paginatedEntities.length === 0 ? (
                    /* Empty state */
                    <div className="flex items-center justify-center py-16">
                        <p className="text-sm text-gray-400 dark:text-[#6b7280]">
                            {t('No entities match current filter')}
                        </p>
                    </div>
                ) : (
                    /* Entity rows */
                    paginatedEntities.map((entity) => {
                        const isChecked = selectedEntities.includes(entity.name)
                        return (
                            <div
                                key={entity.name}
                                onClick={() => onToggleEntity(entity.name)}
                                role="row"
                                aria-selected={isChecked}
                                className={`flex items-center px-3 py-2 border-b border-gray-100 dark:border-[#2a2f3e] cursor-pointer select-none transition-colors ${isChecked
                                    ? 'bg-emerald-50 dark:bg-emerald-950/30'
                                    : 'hover:bg-gray-50 dark:hover:bg-gray-900/50'
                                    }`}
                            >
                                <div className="w-8 flex-shrink-0">
                                    <input
                                        type="checkbox"
                                        checked={isChecked}
                                        onChange={() => onToggleEntity(entity.name)}
                                        onClick={(e: React.MouseEvent<HTMLInputElement>) => e.stopPropagation()}
                                        className="w-3.5 h-3.5 rounded border-gray-300 text-emerald-500 focus:ring-emerald-400 cursor-pointer"
                                    />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm text-gray-900 dark:text-[#E6E6E6] truncate">
                                            {entity.name}
                                        </span>
                                        {entity.isOrphan && (
                                            <span className="px-1.5 py-0.5 text-[10px] rounded bg-orange-100 text-orange-600 dark:bg-orange-900/40 dark:text-orange-400 flex-shrink-0">
                                                {t('orphan')}
                                            </span>
                                        )}
                                    </div>
                                </div>
                                <div className="w-16 text-right text-xs text-gray-400 dark:text-[#6b7280] flex-shrink-0">
                                    {entity.relationCount}
                                </div>
                            </div>
                        )
                    })
                )}
            </div>

            {/* ── Footer: selection count ───────────────────────────────────── */}
            {selectedEntities.length > 0 && (
                <div className="px-3 py-2 border-t border-gray-200 dark:border-[#2a2f3e] bg-gray-50 dark:bg-[#111319] text-xs text-gray-500 dark:text-[#8a8f9e]">
                    {t("{{count}} selected", { count: selectedEntities.length })}
                </div>
            )}

            {/* ── Drag handle (resize) ──────────────────────────────────────── */}
            {/* Positioned absolute on the right edge. w-1 visible line + invisible
                hover-expand trick via negative right offset for easier grab. */}
            <div
                onMouseDown={handleDragStart}
                title="Drag to resize panel"
                className="absolute right-0 top-0 h-full w-1 z-20 cursor-col-resize
                           bg-gray-200 dark:bg-[#1f232e]
                           hover:bg-emerald-400 dark:hover:bg-emerald-500
                           transition-colors duration-150"
            />

            </>}
        </div>
    )
}


'use client'

import React from 'react'
import { useTranslation } from "react-i18next";
import { RefreshCw, Trash2, CheckSquare, X, DatabaseZap, Zap, ZapOff, Clock } from 'lucide-react'
import useCurrentUser from '~/hooks/useCurrentUser'

interface ActionBarProps {
    isSelectionMode: boolean
    isCurrentPageFullySelected: boolean
    selectedCount: number
    isDeleting?: boolean
    isScanning?: boolean
    // hasPipelineBusyDoc: true khi BẤT KỲ document nào có status
    // pending/processing/preprocessed — block Delete + Clear để bảo vệ KG
    hasPipelineBusyDoc?: boolean
    // hasAnyDeleting: true khi có ít nhất 1 doc đang ở trạng thái "deleting"
    hasAnyDeleting?: boolean
    // Current status filter — hiện trên Clear button khi filter active
    statusFilter?: string
    statusFilterCount?: number
    // Auto-sync controls
    autoSyncStatus?: 'idle' | 'checking' | 'syncing' | 'error'
    isAutoSyncEnabled?: boolean
    lastSyncAt?: Date | null
    lastSyncAdded?: number
    lastSyncUpdated?: number
    onToggleAutoSync?: () => void
    onTriggerManualSync?: () => void
    onScanDocuments: () => void
    onSyncCollection: () => void
    onClearDocuments: () => void
    onDeleteDocuments: () => void
    onSelectCurrentPage: () => void
    onDeselectAll: () => void
}

export default function ActionBar({
    isSelectionMode,
    isCurrentPageFullySelected,
    selectedCount,
    onScanDocuments,
    onSyncCollection,
    isDeleting = false,
    isScanning = false,
    hasPipelineBusyDoc = false,
    hasAnyDeleting = false,
    // Status filter — hiện trên Clear button label
    statusFilter = 'all',
    statusFilterCount = 0,
    // Auto-sync controls
    autoSyncStatus = 'idle',
    isAutoSyncEnabled = true,
    lastSyncAt = null,
    lastSyncAdded = 0,
    lastSyncUpdated = 0,
    onToggleAutoSync,
    onTriggerManualSync,
    onClearDocuments,
    onDeleteDocuments,
    onSelectCurrentPage,
    onDeselectAll,
}: ActionBarProps) {
    const { t } = useTranslation();
    const user = useCurrentUser({ rejectOnEmpty: false })
    const isAdmin = user?.isAdmin ?? false

    // ─────────────────────────────────────────────────────────────────────
    // TOOLTIP MESSAGES: Giải thích cho user tại sao button bị disabled.
    // - Dùng native HTML `title` attribute → tooltip xuất hiện khi hover.
    // - Không cần custom tooltip component, không block interaction.
    // ─────────────────────────────────────────────────────────────────────

    const PIPELINE_BUSY_TOOLTIP =
        t('Cannot modify documents while the pipeline is processing. Please wait until all documents finish indexing.')
    const DELETING_TOOLTIP =
        t('Waiting for document deletion to complete...')


    return (
        <div className="flex items-center gap-2 flex-wrap">

            {/* ── ADMIN-ONLY: SCAN, SYNC, AUTO-SYNC ──────────────────────────── */}
            {isAdmin && (
                <>
                    {/* ── SCAN BUTTON ─────────────────────────────────────────── */}
                    <button
                        type="button"
                        onClick={onScanDocuments}
                        disabled={isScanning || hasAnyDeleting}
                        title={
                            hasAnyDeleting
                                ? DELETING_TOOLTIP
                                : isScanning
                                    ? t('Scanning input_document/ and reprocessing non-processed files…')
                                    : undefined
                        }
                        className={[
                            'inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md',
                            'border border-gray-200 dark:border-[#2a2f3e]',
                            'bg-white dark:bg-[#1f232e]',
                            'text-gray-600 dark:text-[#E6E6E6]',
                            'focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:ring-offset-2',
                            'transition-colors',
                            (isScanning || hasAnyDeleting)
                                ? 'opacity-50 cursor-not-allowed'
                                : 'hover:bg-gray-50 dark:hover:bg-[#2a2f3e] hover:border-gray-300 cursor-pointer',
                        ].join(' ')}
                        aria-label="Scan or retry documents"
                    >
                        <RefreshCw className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin' : ''}`} />
                        {isScanning ? t('Scanning...') : t('Scan/Retry')}
                    </button>

                    <button
                        type="button"
                        onClick={onSyncCollection}
                        disabled={hasAnyDeleting}
                        title={hasAnyDeleting ? DELETING_TOOLTIP : undefined}
                        className={[
                            'inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md',
                            'border border-gray-200 dark:border-[#2a2f3e]',
                            'bg-white dark:bg-[#1f232e]',
                            'text-gray-600 dark:text-[#E6E6E6]',
                            'focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:ring-offset-2 transition-colors',
                            hasAnyDeleting
                                ? 'opacity-50 cursor-not-allowed'
                                : 'hover:bg-gray-50 dark:hover:bg-[#2a2f3e] hover:border-gray-300 cursor-pointer',
                        ].join(' ')}
                        aria-label="Sync documents from collections to knowledge graph"
                    >
                        <DatabaseZap className="w-3.5 h-3.5" />
                        {t('Sync Collection')}
                    </button>

                    {/* ── AUTO-SYNC CONTROLS ──────────────────────────────────── */}
                    <div className="flex items-center gap-2 ml-2 pl-2 border-l border-gray-200 dark:border-[#2a2f3e]">
                        <button
                            type="button"
                            onClick={onToggleAutoSync}
                            title={isAutoSyncEnabled
                                ? t('Auto-sync enabled: Approved documents sync every 60 minutes. Click to disable.')
                                : t('Auto-sync disabled: Click to enable automatic syncing of Approved documents every 60 minutes.')
                            }
                            className={[
                                'inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md',
                                'border transition-colors cursor-pointer',
                                'focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:ring-offset-2',
                                isAutoSyncEnabled
                                    ? 'border-emerald-200 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/30'
                                    : 'border-gray-200 dark:border-[#2a2f3e] bg-white dark:bg-[#1f232e] text-gray-500 dark:text-[#8a8f9e] hover:bg-gray-50 dark:hover:bg-[#2a2f3e]',
                            ].join(' ')}
                        >
                            {isAutoSyncEnabled ? (
                                <Zap className="w-3.5 h-3.5" />
                            ) : (
                                <ZapOff className="w-3.5 h-3.5" />
                            )}
                            {t('Auto-Sync')}
                        </button>

                        {(isAutoSyncEnabled || autoSyncStatus !== 'idle') && (
                            <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-[#8a8f9e]">
                                {autoSyncStatus === 'checking' && (
                                    <>
                                        <RefreshCw className="w-3 h-3 animate-spin text-blue-500" />
                                        <span>{t('Checking...')}</span>
                                    </>
                                )}
                                {autoSyncStatus === 'syncing' && (
                                    <>
                                        <RefreshCw className="w-3 h-3 animate-spin text-emerald-500" />
                                        <span>{t('Syncing...')}</span>
                                    </>
                                )}
                                {autoSyncStatus === 'error' && (
                                    <>
                                        <span className="text-red-500">{t('Error')}</span>
                                    </>
                                )}
                                {autoSyncStatus === 'idle' && lastSyncAt && (
                                    <>
                                        <Clock className="w-3 h-3" />
                                        <span>{t('Last: {{time}}', { time: lastSyncAt.toLocaleTimeString() })}</span>
                                        {lastSyncAdded > 0 && (
                                            <span className="text-emerald-500 dark:text-emerald-400">
                                                +{lastSyncAdded}
                                            </span>
                                        )}
                                        {lastSyncUpdated > 0 && (
                                            <span className="text-blue-500 dark:text-blue-400">
                                                ↻{lastSyncUpdated}
                                            </span>
                                        )}
                                    </>
                                )}
                            </div>
                        )}

                        {onTriggerManualSync && (
                            <button
                                type="button"
                                onClick={onTriggerManualSync}
                                disabled={autoSyncStatus !== 'idle' || hasAnyDeleting}
                                title={
                                    hasAnyDeleting
                                        ? DELETING_TOOLTIP
                                        : autoSyncStatus !== 'idle'
                                            ? t('Sync is in progress…')
                                            : t('Manually sync Approved documents now')
                                }
                                className={[
                                    'inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded border',
                                    'border-gray-200 dark:border-[#2a2f3e] bg-white dark:bg-[#1f232e]',
                                    'text-gray-500 dark:text-[#8a8f9e] transition-colors',
                                    'focus:outline-none focus:ring-1 focus:ring-emerald-400',
                                    (autoSyncStatus !== 'idle' || hasAnyDeleting)
                                        ? 'opacity-50 cursor-not-allowed'
                                        : 'hover:bg-gray-50 dark:hover:bg-[#2a2f3e] cursor-pointer',
                                ].join(' ')}
                            >
                                <RefreshCw className={`w-3 h-3 ${autoSyncStatus !== 'idle' ? 'animate-spin' : ''}`} />
                                {t('Sync Now')}
                            </button>
                        )}
                    </div>
                </>
            )}

            {isSelectionMode ? (
                <>
                    {/* ── DELETE BUTTON — Admin only ──────────────────────────── */}
                    {isAdmin && (
                        <button
                            type="button"
                            onClick={onDeleteDocuments}
                            disabled={isDeleting || hasPipelineBusyDoc || hasAnyDeleting}
                            title={
                                hasAnyDeleting
                                    ? DELETING_TOOLTIP
                                    : hasPipelineBusyDoc
                                        ? PIPELINE_BUSY_TOOLTIP
                                        : undefined
                            }
                            className={[
                                'inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md',
                                'border border-red-200 dark:border-red-700',
                                'bg-white dark:bg-[#1f232e]',
                                'text-red-600 dark:text-red-400',
                                (isDeleting || hasPipelineBusyDoc || hasAnyDeleting)
                                    ? 'opacity-50 cursor-not-allowed'
                                    : 'hover:bg-red-50 dark:hover:bg-red-900/20 cursor-pointer',
                                'focus:outline-none focus:ring-2 focus:ring-red-400 focus:ring-offset-2',
                                'transition-colors',
                            ].join(' ')}
                        >
                            <Trash2 className="w-3.5 h-3.5" />
                            {isDeleting ? t('Deleting...') : t("Delete ({{count}})", { count: selectedCount })}
                        </button>
                    )}

                    {/* ── SELECT/DESELECT BUTTON — All users ─────────────────── */}
                    <button
                        type="button"
                        onClick={isCurrentPageFullySelected ? onDeselectAll : onSelectCurrentPage}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md border border-gray-200 dark:border-[#2a2f3e] bg-white dark:bg-[#1f232e] text-gray-600 dark:text-[#E6E6E6] hover:bg-gray-50 dark:hover:bg-[#2a2f3e] transition-colors cursor-pointer"
                    >
                        {isCurrentPageFullySelected ? (
                            <><X className="w-3.5 h-3.5" />{t('Deselect All')}</>
                        ) : (
                            <><CheckSquare className="w-3.5 h-3.5" />{t('Select Page')}</>
                        )}
                    </button>
                </>
            ) : (
                /* ── CLEAR BUTTON — Admin only ───────────────────────────── */
                isAdmin && (
                    <button
                        type="button"
                        onClick={onClearDocuments}
                        disabled={hasPipelineBusyDoc || hasAnyDeleting}
                        title={
                            hasAnyDeleting
                                ? DELETING_TOOLTIP
                                : hasPipelineBusyDoc
                                    ? PIPELINE_BUSY_TOOLTIP
                                    : undefined
                        }
                        className={[
                            'inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md',
                            'border border-gray-200 dark:border-[#2a2f3e]',
                            'bg-white dark:bg-[#1f232e]',
                            'text-gray-600 dark:text-[#E6E6E6]',
                            (hasPipelineBusyDoc || hasAnyDeleting)
                                ? 'opacity-50 cursor-not-allowed'
                                : 'hover:bg-gray-50 dark:hover:bg-[#2a2f3e] hover:border-gray-300 cursor-pointer',
                            'transition-colors',
                        ].join(' ')}
                    >
                        {statusFilter === 'all'
                            ? t('Clear')
                            : t('Clear {{status}} ({{count}})', {
                                status: statusFilter.charAt(0).toUpperCase() + statusFilter.slice(1),
                                count: statusFilterCount,
                            })
                        }
                    </button>
                )
            )}

        </div>
    )

}

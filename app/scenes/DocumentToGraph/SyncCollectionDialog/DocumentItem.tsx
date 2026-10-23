'use client'

import React from 'react'
import { useTranslation } from "react-i18next";
import {
    CheckCircle2,
    AlertCircle,
    RefreshCw,
    Loader2,
    FileText,
    Upload,
    Trash2,
    MinusCircle,
} from 'lucide-react'
import type { DocSyncStatus, OutlineDoc } from './types'

interface DocumentItemProps {
    doc: OutlineDoc
    isSelected: boolean
    syncStatus?: DocSyncStatus
    isSyncing: boolean
    onToggle: (docId: string) => void
}


function SyncStatusIcon({ status }: { status: DocSyncStatus }): React.ReactElement | null {
    switch (status) {
        case 'pending':
            return <FileText className="w-4 h-4 text-gray-400" />
        case 'exporting':
            return <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
        case 'uploading':
            return <Upload className="w-4 h-4 text-emerald-500 animate-pulse" />
        case 'success':
            return <CheckCircle2 className="w-4 h-4 text-emerald-500" />
        case 'duplicate':
            return <RefreshCw className="w-4 h-4 text-amber-500" />
        case 'error':
            return <AlertCircle className="w-4 h-4 text-red-500" />
        case 'deleting':
            // NEW: Đang xóa bản cũ trong KG trước khi re-upload (replace flow)
            return <Trash2 className="w-4 h-4 text-orange-500 animate-pulse" />
        case 'skipped':
            // NEW: User chọn 'ignore' — doc bị bỏ qua hoàn toàn
            return <MinusCircle className="w-4 h-4 text-gray-400" />
        default: {
            // Exhaustive check — TypeScript sẽ báo lỗi nếu thêm DocSyncStatus mới mà không handle
            const _exhaustive: never = status
            throw new Error(`Unhandled DocSyncStatus: ${String(_exhaustive)}`)
        }
    }
}



/**
 * DocumentItem — hiển thị một tài liệu trong Phase 2.
 *
 * Có 2 chế độ:
 * - Selection (isSyncing=false): checkbox có thể click
 * - Sync (isSyncing=true):       status icon, không click được
 *
 * `doc.depth` dùng để tính indent (16px base + 16px mỗi cấp sâu hơn).
 */
export default function DocumentItem({
    doc,
    isSelected,
    syncStatus,
    isSyncing,
    onToggle,
}: DocumentItemProps) {
    const { t } = useTranslation();

    // INDENT: depth=0 → 16px, depth=1 → 32px, depth=2 → 48px
    const indentPx = 16 + doc.depth * 16

    return (
        <div
            className={[
                'flex items-center gap-2 py-1.5 pr-3 rounded',
                !isSyncing
                    ? 'hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer'
                    : 'cursor-default',
                syncStatus === 'success' ? 'opacity-70' : '',
            ].join(' ')}
            style={{ paddingLeft: `${indentPx}px` }}
            onClick={() => !isSyncing && onToggle(doc.id)}
            role="checkbox"
            aria-checked={isSelected}
        >
            {/* LEFT: Checkbox hoặc Status Icon */}
            <div className="flex-shrink-0">
                {isSyncing && syncStatus ? (
                    <SyncStatusIcon status={syncStatus} />
                ) : (
                    <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => onToggle(doc.id)}
                        disabled={isSyncing}
                        onClick={(e) => e.stopPropagation()}
                        className="w-4 h-4 rounded accent-emerald-500 cursor-pointer"
                        aria-label={`Select ${doc.title}`}
                    />
                )}
            </div>

            {/* RIGHT: Document title */}
            <span
                className={[
                    'text-sm truncate flex-1',
                    doc.isDraft
                        ? 'text-gray-400 dark:text-[#6b7280] italic'
                        : 'text-gray-700 dark:text-[#E6E6E6]',
                    syncStatus === 'error' ? 'text-red-500 dark:text-red-400' : '',
                    syncStatus === 'success'
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : '',
                    // NEW: skipped docs hiển thị mờ hơn để phân biệt với docs đang sync
                    syncStatus === 'skipped' ? 'opacity-40 line-through' : '',
                    // NEW: deleting docs hiển thị màu orange
                    syncStatus === 'deleting' ? 'text-orange-500 dark:text-orange-400' : '',
                ].join(' ')}
                title={doc.title}
            >
                {doc.title}
                {doc.isDraft && (
                    <span className="ml-1.5 text-xs text-gray-400">{t("(draft)")}</span>
                )}
            </span>
        </div>
    )
}
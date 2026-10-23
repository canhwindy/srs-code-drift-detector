// ============================================================
// FILE: app/scenes/DocumentToGraph/SyncCollectionDialog/CollectionItem.tsx
// DESCRIPTION: Phase 2 row — collection với expand/collapse và doc list
// ============================================================

'use client'

import React, { useRef, useEffect } from 'react'
import { useTranslation } from "react-i18next";
import { ChevronRight, ChevronDown, FolderOpen } from 'lucide-react'
import type {
    CollectionCheckState,
    CollectionWithDocs,
    DocSyncStatus,
} from './types'
import DocumentItem from './DocumentItem'

interface CollectionItemProps {
    collection: CollectionWithDocs
    checkState: CollectionCheckState
    selectedDocIds: Set<string>
    docStatuses: Map<string, DocSyncStatus>
    isSyncing: boolean
    onToggleCollection: (collectionId: string) => void
    onToggleExpand: (collectionId: string) => void
    onToggleDoc: (docId: string) => void
}


/**
 * CollectionItem — Phase 2 collection row + expandable doc list.
 *
 * Checkbox có 3 trạng thái (unchecked/indeterminate/checked).
 * `indeterminate` phải set qua DOM ref vì React không hỗ trợ trực tiếp.
 *
 * Trong Phase 2, collections mặc định expanded (isExpanded=true từ proceedToDocuments).
 * User có thể collapse để gọn giao diện nếu muốn.
 */
export default function CollectionItem({
    collection,
    checkState,
    selectedDocIds,
    docStatuses,
    isSyncing,
    onToggleCollection,
    onToggleExpand,
    onToggleDoc,
}: CollectionItemProps) {
    const { t } = useTranslation();

    // REF: Dùng để set indeterminate state lên DOM (không thể set qua JSX prop)
    const checkboxRef = useRef<HTMLInputElement>(null)

    // EFFECT: Sync indeterminate DOM state với checkState prop sau mỗi render
    useEffect(() => {
        if (checkboxRef.current) {
            checkboxRef.current.indeterminate = checkState === 'indeterminate'
        }
    }, [checkState])

    const isEmpty = collection.docs.length === 0
    const isExpanded = collection.isExpanded

    const selectedInCollection = collection.docs.filter((d) =>
        selectedDocIds.has(d.id)
    ).length


    return (
        <div className="border-b border-gray-100 dark:border-[#2a2f3e] last:border-0">

            {/* ── COLLECTION ROW ─────────────────────────────────── */}
            <div className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800/50 rounded">

                {/* EXPAND TOGGLE */}
                <button
                    type="button"
                    onClick={() => !isEmpty && onToggleExpand(collection.id)}
                    disabled={isEmpty}
                    className={[
                        'flex-shrink-0 p-0.5 rounded transition-colors',
                        isEmpty
                            ? 'text-gray-300 cursor-not-allowed'
                            : 'text-gray-500 hover:text-gray-700 dark:text-[#8a8f9e] dark:hover:text-gray-200 cursor-pointer',
                    ].join(' ')}
                >
                    {isExpanded ? (
                        <ChevronDown className="w-4 h-4" />
                    ) : (
                        <ChevronRight className="w-4 h-4" />
                    )}
                </button>

                {/* COLLECTION CHECKBOX (indeterminate via ref) */}
                <input
                    ref={checkboxRef}
                    type="checkbox"
                    checked={checkState === 'checked'}
                    onChange={() =>
                        !isEmpty && !isSyncing && onToggleCollection(collection.id)
                    }
                    disabled={isEmpty || isSyncing}
                    className={[
                        'w-4 h-4 rounded accent-emerald-500 flex-shrink-0',
                        isEmpty || isSyncing
                            ? 'cursor-not-allowed opacity-50'
                            : 'cursor-pointer',
                    ].join(' ')}
                    aria-label={`Select all in ${collection.name}`}
                />

                {/* ICON */}
                <span className="flex-shrink-0 text-base leading-none">
                    {collection.icon && collection.icon.length <= 2 ? (
                        collection.icon
                    ) : (
                        <FolderOpen className="w-4 h-4 text-gray-400" />
                    )}
                </span>

                {/* NAME */}
                <span
                    className="flex-1 text-sm font-medium text-gray-800 dark:text-[#E6E6E6] truncate cursor-pointer"
                    onClick={() => !isEmpty && onToggleExpand(collection.id)}
                >
                    {collection.name}
                </span>

                {/* COUNT BADGE */}
                <span className="flex-shrink-0 text-xs text-gray-400 dark:text-[#6b7280] whitespace-nowrap">
                    {isEmpty ? (
                        <span className="italic">{t("empty")}</span>
                    ) : selectedInCollection > 0 ? (
                        t("{{selected}}/{{total}}", { selected: selectedInCollection, total: collection.docs.length })
                    ) : (
                        t("{{count}} docs", { count: collection.docs.length })
                    )}
                </span>
            </div>

            {/* ── DOC LIST (khi expanded) ─────────────────────────── */}
            {isExpanded && !isEmpty && (
                <div className="pb-1">
                    {collection.docs.map((doc) => (
                        <DocumentItem
                            key={doc.id}
                            doc={doc}
                            isSelected={selectedDocIds.has(doc.id)}
                            syncStatus={docStatuses.get(doc.id)}
                            isSyncing={isSyncing}
                            onToggle={onToggleDoc}
                        />
                    ))}
                </div>
            )}
        </div>
    )
}
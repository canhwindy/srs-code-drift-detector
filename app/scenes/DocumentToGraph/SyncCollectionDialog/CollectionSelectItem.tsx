'use client'

import React from 'react'
import { useTranslation } from "react-i18next";
import { FolderOpen } from 'lucide-react'
import type { CollectionListItem } from './types'

// ============================================================
// SECTION 1: Props interface
// ============================================================

interface CollectionSelectItemProps {
    /** Collection metadata + pre-computed doc count */
    collection: CollectionListItem
    /** Collection có đang được chọn không */
    isSelected: boolean
    /** Callback khi user click checkbox */
    onToggle: (collectionId: string) => void
}


/**
 * CollectionSelectItem — row đơn giản cho Phase 1 (chọn collections).
 *
 * Layout:
 *   [ checkbox ] [ icon ] [ Collection Name ]  [ N docs ]
 *
 * Không có expand/collapse (Phase 1 chỉ chọn collection, không xem docs).
 * Docs sẽ hiện sau khi user click "Load Docs →" vào Phase 2.
 *
 * Khi docCount === 0: Checkbox disabled (không có gì để sync).
 */
export default function CollectionSelectItem({
    collection,
    isSelected,
    onToggle,
}: CollectionSelectItemProps) {
    const { t } = useTranslation();
    const isEmpty = collection.docCount === 0

    return (
        <div
            className={[
                // LAYOUT: Flex row, căn giữa dọc
                'flex items-center gap-3 px-4 py-2.5 rounded-lg',
                // INTERACTIVE: Hover effect và cursor (chỉ khi không empty)
                isEmpty
                    ? 'opacity-50 cursor-not-allowed'
                    : 'hover:bg-gray-50 dark:hover:bg-[#2a2f3e]/60 cursor-pointer',
                'transition-colors',
            ].join(' ')}
            // Click toàn bộ row để toggle (UX tốt hơn chỉ click vào checkbox nhỏ)
            onClick={() => !isEmpty && onToggle(collection.id)}
            role="checkbox"
            aria-checked={isSelected}
        >
            {/* ── CHECKBOX ─────────────────────────────────────────── */}
            <input
                type="checkbox"
                checked={isSelected}
                onChange={() => !isEmpty && onToggle(collection.id)}
                disabled={isEmpty}
                onClick={(e) => e.stopPropagation()} // Tránh double-toggle khi click checkbox
                className="w-4 h-4 rounded accent-emerald-500 flex-shrink-0 cursor-pointer disabled:cursor-not-allowed"
                aria-label={`Select collection ${collection.name}`}
            />

            {/* ── COLLECTION ICON ──────────────────────────────────── */}
            <span className="flex-shrink-0 text-base leading-none" aria-hidden="true">
                {/* Dùng icon nếu là emoji (1-2 ký tự), ngược lại dùng FolderOpen */}
                {collection.icon && collection.icon.length <= 2 ? (
                    collection.icon
                ) : (
                    <FolderOpen className="w-4 h-4 text-gray-400" />
                )}
            </span>

            {/* ── COLLECTION NAME ──────────────────────────────────── */}
            <span
                className={[
                    'flex-1 text-sm font-medium truncate',
                    isEmpty
                        ? 'text-gray-400 dark:text-[#6b7280]'
                        : 'text-gray-800 dark:text-[#E6E6E6]',
                ].join(' ')}
                title={collection.name}
            >
                {collection.name}
            </span>

            {/* ── DOC COUNT BADGE ──────────────────────────────────── */}
            <span className="flex-shrink-0 text-xs whitespace-nowrap px-2 py-0.5 rounded-full bg-gray-100 dark:bg-[#1f232e] text-gray-500 dark:text-[#8a8f9e]">
                {isEmpty ? t("empty") : t("{{count}} docs", { count: collection.docCount })}
            </span>
        </div>
    )
}
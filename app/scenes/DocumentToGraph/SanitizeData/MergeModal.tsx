'use client'

// ============================================================
// FILE: app/scenes/DocumentToGraph/SanitizeData/MergeModal.tsx
// ACTION: CREATE_NEW
// DESCRIPTION: Modal chọn target entity cho Merge Entities flow.
//              Hiển thị dropdown từ selectedEntities (sorted alphabetically).
//              Confirm button disabled cho đến khi target được chọn.
// ESLINT: @typescript-eslint/strict compliant
// ============================================================

import React, { useState } from 'react'
import { useTranslation } from "react-i18next";

// ── Props Interface ─────────────────────────────────────────────────────────

export interface MergeModalProps {
    /** Có hiển thị modal không */
    isOpen: boolean
    /**
     * Danh sách entity names đang được select (sẽ populate dropdown).
     * Modal tự sort alphabetically để hiển thị.
     */
    selectedEntities: string[]
    /**
     * Gọi khi user click "Confirm" với target đã chọn.
     * @param targetEntity - Tên entity được chọn làm target
     */
    onConfirm: (targetEntity: string) => void
    /** Gọi khi user click "Cancel" hoặc click overlay */
    onCancel: () => void
}


/**
 * Modal chọn target entity trước khi thực hiện merge.
 *
 * Flow:
 *   1. Dropdown hiện tất cả selectedEntities (sorted A-Z)
 *   2. User chọn target → tempTarget được set
 *   3. "Confirm" button enabled → user click → onConfirm(tempTarget) gọi
 *   4. Hoặc user click "Cancel" / overlay → onCancel() gọi
 *
 * Note: Modal KHÔNG tự đóng — parent component xử lý isOpen state.
 */
export function MergeModal({
    isOpen,
    selectedEntities,
    onConfirm,
    onCancel,
}: MergeModalProps): React.JSX.Element | null {
    const { t } = useTranslation();

    // ── Local state: target entity đang được chọn tạm thời ─────────────────
    // Reset về '' mỗi lần modal mở lại (vì key prop reset không dùng ở đây,
    // ta xử lý bằng cách parent truyền isOpen=false rồi isOpen=true khi mở lại)
    const [tempTarget, setTempTarget] = useState<string>('')

    // ── Early return nếu không hiển thị ────────────────────────────────────
    if (!isOpen) {
        return null
    }

    // ── Sorted options cho dropdown ─────────────────────────────────────────
    // Tạo bản copy để tránh mutate prop gốc
    const sortedEntities: string[] = [...selectedEntities].sort((a, b) =>
        a.localeCompare(b),
    )

    // ── Event handlers ──────────────────────────────────────────────────────

    const handleSelectChange = (e: React.ChangeEvent<HTMLSelectElement>): void => {
        setTempTarget(e.target.value)
    }

    const handleConfirmClick = (): void => {
        // Guard: chỉ confirm nếu target hợp lệ và nằm trong selectedEntities
        if (!tempTarget || !selectedEntities.includes(tempTarget)) {
            return
        }
        // Reset local state trước khi gọi callback
        setTempTarget('')
        onConfirm(tempTarget)
    }

    const handleCancelClick = (): void => {
        setTempTarget('')
        onCancel()
    }

    const handleOverlayClick = (): void => {
        setTempTarget('')
        onCancel()
    }

    // Ngăn click bên trong modal bubble lên overlay
    const handleModalContentClick = (e: React.MouseEvent<HTMLDivElement>): void => {
        e.stopPropagation()
    }

    // ── Số source entities (để hiển thị warning) ───────────────────────────
    const sourceCount = tempTarget
        ? selectedEntities.filter((name) => name !== tempTarget).length
        : selectedEntities.length - 1

    // ── Render ───────────────────────────────────────────────────────────────
    return (
        /* Overlay — click để cancel */
        <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="merge-modal-title"
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
            onClick={handleOverlayClick}
        >
            {/* Modal content — click không bubble lên overlay */}
            <div
                className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl dark:bg-[#111319]"
                onClick={handleModalContentClick}
            >
                {/* Header */}
                <h2
                    id="merge-modal-title"
                    className="mb-2 text-lg font-semibold text-gray-900 dark:text-[#E6E6E6]"
                >
                    {t('Select Target Entity')}
                </h2>

                {/* Description */}
                <p className="mb-4 text-sm text-gray-500 dark:text-[#8a8f9e]">
                    {t('Choose which entity to keep. All other selected entities will be merged into it and then permanently deleted.')}
                </p>

                {/* Dropdown */}
                <label
                    htmlFor="merge-target-select"
                    className="mb-1 block text-sm font-medium text-gray-700 dark:text-[#E6E6E6]"
                >
                    {t('Target entity (will be kept):')}
                </label>
                <select
                    id="merge-target-select"
                    value={tempTarget}
                    onChange={handleSelectChange}
                    autoFocus
                    className="mb-4 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500 dark:border-[#2a2f3e] dark:bg-[#1f232e] dark:text-[#E6E6E6]"
                >
                    <option value="">{t('— Select target entity —')}</option>
                    {sortedEntities.map((name) => (
                        <option key={name} value={name}>
                            {name}
                        </option>
                    ))}
                </select>

                {/* Warning — chỉ hiển thị khi đã chọn target */}
                {tempTarget && (
                    <p className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                        {t('{{count}} entities will be merged into "{{target}}" and deleted.', { count: sourceCount, target: tempTarget })}
                    </p>
                )}

                {/* Action buttons */}
                <div className="flex justify-end gap-2">
                    <button
                        type="button"
                        onClick={handleCancelClick}
                        className="rounded px-4 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 dark:text-[#E6E6E6] dark:hover:bg-gray-800"
                    >
                        {t('Cancel')}
                    </button>
                    <button
                        type="button"
                        disabled={!tempTarget}
                        onClick={handleConfirmClick}
                        title={!tempTarget ? t('Select a target entity first') : undefined}
                        className="rounded bg-cyan-500 px-4 py-1.5 text-sm font-medium text-white hover:bg-cyan-600 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        {t('Confirm')}
                    </button>
                </div>
            </div>
        </div>
    )
}
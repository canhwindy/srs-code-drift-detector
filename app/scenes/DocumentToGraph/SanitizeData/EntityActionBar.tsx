'use client'

// ============================================================
// FILE: SanitizeData/EntityActionBar.tsx
// Thanh action buttons phía trên detail panel.
// Tách riêng để dễ mở rộng khi các buttons có handler thực sự.
// ============================================================

import React from 'react'
import { useTranslation } from "react-i18next";
import useCurrentUser from '~/hooks/useCurrentUser'

export interface EntityActionBarProps {
    /**
     * Merge Entities button chỉ enabled khi:
     * - selectedEntities.length >= MIN_MERGE_COUNT (2)
     * - showMode === 'selected'
     */
    canMerge: boolean
    /**
     * Handler khi user click "Merge Entities" button.
     * Gọi để mở MergeModal.
     */
    onMergeClick: () => void
    /**
     * true khi đang chờ API merge response.
     * Dùng để disable button và hiển thị loading state.
     * @default false
     */
    isMerging?: boolean
}

/**
 * 5 action buttons: Create Entity, Merge Entities, Create Rel.,
 * Batch Rel., Delete Entity.
 *
 * Chỉ "Merge Entities" có handler thực sự (hiện tại).
 * TODO: Thêm onClick handlers cho các actions khác khi implement.
 */
export function EntityActionBar({
    canMerge,
    onMergeClick,
    isMerging = false,
}: EntityActionBarProps): React.JSX.Element | null {
    const { t } = useTranslation();
    const user = useCurrentUser({ rejectOnEmpty: false })
    const isAdmin = user?.isAdmin ?? false

    if (!isAdmin) {
        return null
    }

    // Button merge bị disable khi: không đủ điều kiện HOẶC đang merging
    const mergeDisabled = !canMerge || isMerging

    // Tooltip text phụ thuộc vào trạng thái hiện tại
    const mergeTitle: string = isMerging
        ? t('Merging in progress…')
        : !canMerge
            ? t('Select ≥ 2 entities then click "Show Sel. Only"')
            : t('Merge selected entities into one')

    return (
        <div className="flex flex-wrap gap-2 px-4 py-3 border-b border-gray-200 dark:border-[#2a2f3e]">

            {/* Merge Entities — cyan/teal */}
            <button
                type="button"
                disabled={mergeDisabled}
                title={mergeTitle}
                onClick={onMergeClick}
                className="px-3.5 py-1.5 text-sm font-medium text-white bg-cyan-500 hover:bg-cyan-600 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
                {isMerging ? t('Merging…') : t('Merge Entities')}
            </button>

        </div>
    )
}
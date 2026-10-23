'use client'

// ============================================================
// FILE: SanitizeData/EntityCardGrid.tsx
// Layout container cho multi-select entity cards.
// 1 entity → centered single card (max-w-2xl)
// 2+ entities → 2-column grid, mỗi card scroll độc lập
// ============================================================

import React from 'react'

import { EntityCard } from './EntityCard'

export interface EntityCardGridProps {
    /** Danh sách tên entity đang được chọn */
    entityNames: string[]
    /** Workspace ID để forward xuống EntityCard khi fetch entity details */
    workspaceId?: string
}

/**
 * Grid container hiển thị EntityCard cho từng selected entity.
 *
 * Layout rules:
 * - 1 entity  → flex justify-center + max-w-2xl (dễ đọc, không quá rộng)
 * - 2+ entities → grid grid-cols-2 (side-by-side, tối đa 2 cột mỗi hàng)
 *
 * Dùng CSS grid thay vì flex để đảm bảo equal column widths khi wrap.
 */
export function EntityCardGrid({ entityNames, workspaceId }: EntityCardGridProps): React.JSX.Element {
    // ── 1 entity: centered, max-width ─────────────────────────────────────────
    if (entityNames.length === 1) {
        // Guard cho noUncheckedIndexedAccess — length===1 đảm bảo [0] tồn tại
        const singleName = entityNames[0]
        if (singleName === undefined) {
            return <></>
        }
        return (
            <div className="flex justify-center w-full p-4">
                <div className="w-full max-w-2xl">
                    <EntityCard entityName={singleName} workspaceId={workspaceId} />
                </div>
            </div>
        )
    }

    // ── 2+ entities: 2-column grid, rows grow naturally, outer container scrolls ──
    return (
        <div className="grid grid-cols-2 gap-4 p-4 w-full items-start">
            {entityNames.map((name) => (
                <EntityCard key={name} entityName={name} workspaceId={workspaceId} />
            ))}
        </div>
    )
}

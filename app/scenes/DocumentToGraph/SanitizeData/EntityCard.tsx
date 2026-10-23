'use client'

// ============================================================
// FILE: SanitizeData/EntityCard.tsx
// Card chi tiết một entity — fetch data từ backend khi mount.
// Colocates: EntityCardSkeleton, RelatedEntityRow, RelationshipRow
// (3 sub-components này chỉ dùng trong file này nên không tách riêng)
// ============================================================

import React, { useEffect, useState } from 'react'
import { useTranslation } from "react-i18next";

import { apiFetchEntityDetails } from '../lib/api'
import type { EntityDetailsResponse, RelatedEntityInfo, RelationshipInfo } from '../lib/api.type'

// ============================================================
// SECTION 1: EntityCardSkeleton
// ============================================================

/**
 * Loading skeleton — hiển thị khi EntityCard đang fetch data.
 * Dùng animated pulse để thể hiện loading state.
 */
function EntityCardSkeleton(): React.JSX.Element {
    return (
        <div className="p-5 animate-pulse space-y-4">
            <div className="flex items-center justify-between gap-2">
                <div className="h-5 bg-gray-200 dark:bg-[#2a2f3e] rounded w-2/5" />
                <div className="flex gap-2">
                    <div className="h-4 bg-gray-200 dark:bg-[#2a2f3e] rounded w-20" />
                    <div className="h-4 bg-gray-200 dark:bg-[#2a2f3e] rounded w-32" />
                </div>
            </div>
            <div className="h-4 bg-gray-200 dark:bg-[#2a2f3e] rounded w-1/3" />
            <div className="h-4 bg-gray-200 dark:bg-[#2a2f3e] rounded w-1/4" />
            <div className="space-y-2">
                <div className="h-3 bg-gray-200 dark:bg-[#2a2f3e] rounded w-full" />
                <div className="h-3 bg-gray-200 dark:bg-[#2a2f3e] rounded w-5/6" />
                <div className="h-3 bg-gray-200 dark:bg-[#2a2f3e] rounded w-4/6" />
            </div>
            <div className="space-y-2 mt-4">
                <div className="h-4 bg-gray-200 dark:bg-[#2a2f3e] rounded w-1/3" />
                <div className="h-3 bg-gray-200 dark:bg-[#2a2f3e] rounded w-full" />
                <div className="h-3 bg-gray-200 dark:bg-[#2a2f3e] rounded w-full" />
            </div>
        </div>
    )
}

// ============================================================
// SECTION 2: RelatedEntityRow
// ============================================================

interface RelatedEntityRowProps {
    /** 1-based index: "Related Entity 1:", "Related Entity 2:", ... */
    index: number
    entity: RelatedEntityInfo
}

/** Hiển thị một related entity với type và danh sách descriptions. */
function RelatedEntityRow({ index, entity }: RelatedEntityRowProps): React.JSX.Element {
    const { t } = useTranslation();

    return (
        <div className="text-sm">
            <p className="font-semibold text-gray-900 dark:text-[#E6E6E6]">
                {t("Related Entity {{index}}: {{name}}", { index, name: entity.name })}
            </p>
            <p className="text-gray-600 dark:text-[#8a8f9e]">
                {t("(Type: {{type}})", { type: entity.type })}
            </p>
            {entity.descriptions.length > 0 && (
                <div className="mt-1">
                    <p className="font-medium text-gray-700 dark:text-[#E6E6E6]">{t("Description:")}</p>
                    {entity.descriptions.map((desc, descIdx) => (
                        // Key dùng index vì descriptions không có unique ID
                        // eslint-disable-next-line react/no-array-index-key
                        <p key={descIdx} className="text-gray-600 dark:text-[#8a8f9e] mt-0.5 leading-relaxed">
                            {desc}
                        </p>
                    ))}
                </div>
            )}
        </div>
    )
}

// ============================================================
// SECTION 3: RelationshipRow
// ============================================================

interface RelationshipRowProps {
    rel: RelationshipInfo
}

/** Hiển thị một relationship: From / To / Relation / Weight / Keywords. */
function RelationshipRow({ rel }: RelationshipRowProps): React.JSX.Element {
    const { t } = useTranslation();

    return (
        <div className="text-sm border-t border-gray-100 dark:border-[#2a2f3e] pt-3">
            <p className="text-gray-700 dark:text-[#E6E6E6]">
                <span className="font-medium">{t("From:")}</span> {rel.from}
            </p>
            <p className="text-gray-700 dark:text-[#E6E6E6] mt-0.5">
                <span className="font-medium">{t("To:")}</span> {rel.to}
            </p>
            {rel.description && (
                <div className="mt-1">
                    <p className="font-medium text-gray-700 dark:text-[#E6E6E6]">{t("Relation:")}</p>
                    <p className="text-gray-600 dark:text-[#8a8f9e] leading-relaxed">
                        {rel.description}
                    </p>
                </div>
            )}
            <div className="flex flex-wrap items-center gap-2 mt-1.5">
                <span className="text-gray-500 dark:text-[#8a8f9e]">
                    <span className="font-medium text-gray-700 dark:text-[#E6E6E6]">{t("Weight:")}</span> {rel.weight}
                </span>
                {rel.keywords.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                        {rel.keywords.map((kw) => (
                            <span
                                key={kw}
                                className="px-1.5 py-0.5 text-[11px] bg-gray-100 dark:bg-[#1f232e] text-gray-600 dark:text-[#E6E6E6] rounded"
                            >
                                {kw}
                            </span>
                        ))}
                    </div>
                )}
            </div>
        </div>
    )
}

// ============================================================
// SECTION 4: EntityCard — exported component
// ============================================================

export interface EntityCardProps {
    /** Tên entity cần hiển thị — dùng để fetch data từ backend */
    entityName: string
    /** Workspace ID để gọi đúng workspace khi fetch entity details */
    workspaceId?: string
}

/**
 * Card chi tiết một entity — fetch data từ `GET /api/entity/details` khi mount.
 *
 * States:
 * - isLoading → skeleton
 * - error     → error banner
 * - data      → full entity details (type, description, source_id, file_path,
 *               related entities, relationships)
 *
 * Cleanup: `cancelled` flag tránh setState trên unmounted component.
 */
export function EntityCard({ entityName, workspaceId }: EntityCardProps): React.JSX.Element {
    const { t } = useTranslation();
    const [data, setData] = useState<EntityDetailsResponse | null>(null)
    const [isLoading, setIsLoading] = useState<boolean>(true)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        // Tránh setState sau khi component unmount (user bỏ chọn trước khi fetch xong)
        let cancelled = false

        async function fetchDetails(): Promise<void> {
            setIsLoading(true)
            setError(null)

            try {
                const result = await apiFetchEntityDetails(entityName, workspaceId)
                if (!cancelled) {
                    setData(result)
                }
            } catch (err: unknown) {
                if (!cancelled) {
                    const message = err instanceof Error
                        ? err.message
                        : t('Failed to load entity details')
                    setError(message)
                }
            } finally {
                if (!cancelled) {
                    setIsLoading(false)
                }
            }
        }

        void fetchDetails()

        return () => {
            cancelled = true
        }
    }, [entityName])

    // ── Loading ────────────────────────────────────────────────────────────────
    if (isLoading) {
        return (
            <div className="border border-gray-200 dark:border-[#2a2f3e] rounded-lg bg-white dark:bg-[#111319]">
                <EntityCardSkeleton />
            </div>
        )
    }

    // ── Error ──────────────────────────────────────────────────────────────────
    if (error !== null) {
        return (
            <div className="border border-gray-200 dark:border-[#2a2f3e] rounded-lg bg-white dark:bg-[#111319] p-5">
                <p className="text-sm font-semibold text-gray-900 dark:text-[#E6E6E6] mb-2">
                    {entityName}
                </p>
                <div className="flex items-start gap-2 p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded">
                    <span className="text-red-500 mt-0.5 flex-shrink-0">⚠</span>
                    <p className="text-xs text-red-700 dark:text-red-400 leading-relaxed">
                        {error}
                    </p>
                </div>
            </div>
        )
    }

    // ── No data guard (TypeScript strictNullChecks) ────────────────────────────
    if (data === null) {
        return (
            <div className="border border-gray-200 dark:border-[#2a2f3e] rounded-lg bg-white dark:bg-[#111319] p-5">
                <p className="text-sm text-gray-400 dark:text-[#6b7280]">
                    {t('No data available for "{{name}}"', { name: entityName })}
                </p>
            </div>
        )
    }

    // ── Full data ──────────────────────────────────────────────────────────────
    const { entity, related_entities: relatedEntities, relationships } = data

    return (
        <div className="border border-gray-200 dark:border-[#2a2f3e] rounded-lg bg-white dark:bg-[#111319]">
            <div className="p-5 space-y-4">

                {/* Header: entity name + action links */}
                <div className="flex items-start justify-between gap-3">
                    <h3 className="text-base font-bold text-gray-900 dark:text-[#E6E6E6] leading-snug">
                        {entity.name}
                    </h3>
                    <div className="flex items-center gap-3 flex-shrink-0 text-xs">
                        <button
                            type="button"
                            className="text-teal-600 dark:text-teal-400 hover:underline font-medium"
                        >
                            {t('Edit Entity')}
                        </button>
                        <button
                            type="button"
                            className="text-teal-600 dark:text-teal-400 hover:underline font-medium"
                        >
                            {t('Edit/Delete Relationships')}
                        </button>
                    </div>
                </div>

                {/* Meta: Type + Related Entities count */}
                <div className="text-sm space-y-0.5">
                    <p className="text-gray-800 dark:text-[#E6E6E6]">
                        <span className="font-bold">{t('Type:')}</span> {entity.type}
                    </p>
                    <p className="text-gray-800 dark:text-[#E6E6E6]">
                        <span className="font-bold">{t('Related Entities:')}</span> {relatedEntities.length}
                    </p>
                </div>

                {/* Description */}
                {entity.description && (
                    <div className="text-sm">
                        <p className="font-bold text-gray-800 dark:text-[#E6E6E6] mb-1">{t('Description:')}</p>
                        <p className="text-gray-600 dark:text-[#8a8f9e] leading-relaxed">
                            {entity.description}
                        </p>
                    </div>
                )}

                {/* Source ID */}
                {entity.source_id && (
                    <div className="text-sm">
                        <p className="font-bold text-gray-800 dark:text-[#E6E6E6] mb-1">{t('Source ID:')}</p>
                        <p className="text-gray-500 dark:text-[#8a8f9e] font-mono text-xs break-all">
                            {entity.source_id}
                        </p>
                    </div>
                )}

                {/* File Path — chỉ hiển thị nếu backend resolve được */}
                {entity.file_path !== null && entity.file_path !== '' && (
                    <div className="text-sm">
                        <p className="font-bold text-gray-800 dark:text-[#E6E6E6] mb-1">{t('File Path:')}</p>
                        <p className="text-gray-500 dark:text-[#8a8f9e] font-mono text-xs">
                            {entity.file_path}
                        </p>
                    </div>
                )}

                {/* Related Entities list */}
                {relatedEntities.length > 0 && (
                    <div className="space-y-3">
                        {relatedEntities.map((relEntity, idx) => (
                            <RelatedEntityRow
                                key={relEntity.name}
                                index={idx + 1}
                                entity={relEntity}
                            />
                        ))}
                    </div>
                )}

                {/* Relationships list */}
                {relationships.length > 0 && (
                    <div>
                        <p className="font-bold text-gray-800 dark:text-[#E6E6E6] text-sm mb-3">
                            {t('Relationships:')}
                        </p>
                        <div className="space-y-3">
                            {relationships.map((rel, idx) => (
                                // Composite key: From-To-idx vì một cặp có thể có nhiều relations
                                // eslint-disable-next-line react/no-array-index-key
                                <RelationshipRow key={`${rel.from}-${rel.to}-${idx}`} rel={rel} />
                            ))}
                        </div>
                    </div>
                )}

                {/* Empty state: entity tồn tại nhưng không có relations */}
                {relatedEntities.length === 0 && relationships.length === 0 && (
                    <p className="text-xs text-gray-400 dark:text-[#6b7280] italic">
                        {t('This entity has no relationships in the current graph.')}
                    </p>
                )}

            </div>
        </div>
    )
}

'use client'

import React from 'react'
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight } from 'lucide-react'

interface PaginationProps {
    currentPage: number
    totalPages: number
    totalCount: number
    pageSize: number
    onPageChange: (page: number) => void
}

export default function Pagination({
    currentPage,
    totalPages,
    totalCount,
    pageSize,
    onPageChange,
}: PaginationProps) {
    const { t } = useTranslation();
    if (totalCount === 0) { return null }

    const start = (currentPage - 1) * pageSize + 1
    const end = Math.min(currentPage * pageSize, totalCount)

    return (
        <div className="flex items-center gap-3">
            <span className="text-sm text-gray-500 dark:text-[#8a8f9e]">
                {t("{{start}}–{{end}} of {{total}} documents", { start, end, total: totalCount })}
            </span>
            {totalPages > 1 && (
                <>
                    <button
                        type="button"
                        onClick={() => onPageChange(currentPage - 1)}
                        disabled={currentPage === 1}
                        className="p-2 rounded-md border border-gray-300 dark:border-[#2a2f3e] disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-800"
                        aria-label="Previous page"
                    >
                        <ChevronLeft className="w-4 h-4" />
                    </button>
                    <span className="text-sm text-gray-600 dark:text-[#8a8f9e]">
                        {t("Page {{current}} of {{total}}", { current: currentPage, total: totalPages })}
                    </span>
                    <button
                        type="button"
                        onClick={() => onPageChange(currentPage + 1)}
                        disabled={currentPage === totalPages}
                        className="p-2 rounded-md border border-gray-300 dark:border-[#2a2f3e] disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-800"
                        aria-label="Next page"
                    >
                        <ChevronRight className="w-4 h-4" />
                    </button>
                </>
            )}
        </div>
    )
}

'use client'

import React from 'react'
import { useTranslation } from "react-i18next";
import { RotateCcw, Search, X } from 'lucide-react'
import type { StatusFilter, StatusCounts } from './types/document'

interface StatusFilterBarProps {
    statusFilter: StatusFilter
    statusCounts: StatusCounts
    showFileName: boolean
    searchQuery: string
    onFilterChange: (status: StatusFilter) => void
    onSearchChange: (query: string) => void
    onRefresh: () => void
    onToggleFileName: () => void
}

const STATUS_OPTIONS: StatusFilter[] = [
    'all',
    'processed',
    'preprocessed',
    'processing',
    'pending',
    'failed',
]

export default function StatusFilterBar({
    statusFilter,
    statusCounts,
    showFileName,
    searchQuery,
    onFilterChange,
    onSearchChange,
    onRefresh,
    onToggleFileName,
}: StatusFilterBarProps) {
    const { t } = useTranslation();

    return (
        <div className="flex flex-col border-b border-gray-200 dark:border-[#2a2f3e]">
            {/* Row 1 — Status filters + controls */}
            <div className="flex items-center h-11 px-4">
                {/* Center — Status Filters */}
                <div className="flex items-center justify-start gap-1 flex-1 overflow-x-auto min-w-0">
                    {STATUS_OPTIONS.map((status) => (
                        <button
                            type="button"
                            key={status}
                            onClick={() => onFilterChange(status)}
                            className={`inline-flex items-center h-6 px-2.5 text-xs rounded transition-colors cursor-pointer whitespace-nowrap ${
                                statusFilter === status
                                    ? 'border border-gray-300 dark:border-[#2a2f3e] text-gray-700 dark:text-[#E6E6E6] bg-white dark:bg-[#1f232e]'
                                    : 'border border-transparent text-gray-400 dark:text-[#6b7280] hover:text-gray-600 dark:hover:text-gray-300'
                            }`}
                        >
                            {t(status.charAt(0).toUpperCase() + status.slice(1))} ({statusCounts[status]})
                        </button>
                    ))}

                    <button
                        type="button"
                        onClick={onRefresh}
                        className="inline-flex items-center justify-center w-6 h-6 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded transition-colors cursor-pointer"
                        aria-label="Refresh documents"
                    >
                        <RotateCcw className="w-3.5 h-3.5" />
                    </button>
                </div>

                {/* Right — File Name Toggle */}
                <div className="flex items-center gap-2 w-44 justify-end shrink-0">
                    <span className="text-xs text-gray-400 dark:text-[#6b7280]">{t('File Name')}</span>
                    <button
                        type="button"
                        onClick={onToggleFileName}
                        className="inline-flex items-center h-6 px-3 text-xs border border-gray-300 dark:border-[#2a2f3e] text-gray-600 dark:text-[#8a8f9e] rounded hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors cursor-pointer"
                    >
                        {showFileName ? t('Hide') : t('Show')}
                    </button>
                </div>
            </div>

            {/* Row 2 — Search */}
            <div className="flex items-center h-9 px-4 border-t border-gray-100 dark:border-[#2a2f3e]">
                <div className="relative flex items-center flex-1 max-w-sm">
                    <Search className="absolute left-2 w-3.5 h-3.5 text-gray-400 dark:text-[#6b7280] pointer-events-none" />
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => onSearchChange(e.target.value)}
                        placeholder={t('Search by file name...')}
                        className="w-full h-6 pl-7 pr-7 text-xs bg-transparent border border-gray-200 dark:border-[#2a2f3e] rounded text-gray-700 dark:text-[#E6E6E6] placeholder-gray-400 dark:placeholder-[#6b7280] focus:outline-none focus:border-gray-400 dark:focus:border-[#4a4f5e] transition-colors"
                    />
                    {searchQuery && (
                        <button
                            type="button"
                            onClick={() => onSearchChange('')}
                            className="absolute right-1.5 p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded transition-colors cursor-pointer"
                        >
                            <X className="w-3 h-3" />
                        </button>
                    )}
                </div>
            </div>
        </div>
    )
}

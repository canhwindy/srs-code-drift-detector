'use client'

import React from 'react'
import { useTranslation } from "react-i18next";
import { ArrowUp, ArrowDown } from 'lucide-react'
import type { Document, SortField, SortDirection } from './types/document'
import DocumentTableRow from './DocumentTableRow'

interface DocumentTableProps {
    documents: Document[]
    sortField: SortField
    sortDirection: SortDirection
    showFileName: boolean
    selectedDocIds: string[]
    deletingDocIds: Set<string>
    onSort: (field: SortField) => void
    onDocumentSelect: (docId: string, checked: boolean) => void
}

export default function DocumentTable({
    documents,
    sortField,
    sortDirection,
    showFileName,
    selectedDocIds,
    deletingDocIds,
    onSort,
    onDocumentSelect,
}: DocumentTableProps) {
    const { t } = useTranslation();

    if (documents.length === 0) {
        return (
            <div className="flex items-center justify-center h-72 text-gray-400 dark:text-[#6b7280]">
                <div className="text-center">
                    <svg className="w-10 h-10 mx-auto mb-3 opacity-30" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                    </svg>
                    <p className="text-sm font-medium text-gray-500 dark:text-[#8a8f9e] mb-1">{t('No documents found')}</p>
                    <p className="text-xs text-gray-400 dark:text-[#6b7280]">{t('Upload documents to get started')}</p>
                </div>
            </div>
        )
    }

    const SortIcon = ({ field }: { field: SortField }) => {
        if (sortField !== field) { return null; }
        return sortDirection === 'asc' ? (
            <ArrowUp className="w-3 h-3" />
        ) : (
            <ArrowDown className="w-3 h-3" />
        )
    }

    const sortableThClass =
        'px-2 py-3 text-left font-medium text-gray-700 dark:text-[#E6E6E6] cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 select-none'
    const staticThClass =
        'px-2 py-3 text-left font-medium text-gray-700 dark:text-[#E6E6E6]'

    return (
        <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white dark:bg-[#111319] border-b border-gray-200 dark:border-[#2a2f3e] z-10">
                <tr>
                    <th
                        onClick={() => onSort(showFileName ? 'file_path' : 'id')}
                        className={sortableThClass}
                    >
                        <div className="flex items-center gap-1">
                            {showFileName ? t('File Name') : t('ID')}
                            <SortIcon field={showFileName ? 'file_path' : 'id'} />
                        </div>
                    </th>
                    <th className={staticThClass}>{t('Summary')}</th>
                    <th className={staticThClass}>{t('Status')}</th>
                    <th className={staticThClass}>{t('Length')}</th>
                    <th className={staticThClass}>{t('Chunks')}</th>
                    <th onClick={() => onSort('created_at')} className={sortableThClass}>
                        <div className="flex items-center gap-1">
                            {t('Created')}
                            <SortIcon field="created_at" />
                        </div>
                    </th>
                    <th onClick={() => onSort('updated_at')} className={sortableThClass}>
                        <div className="flex items-center gap-1">
                            {t('Updated')}
                            <SortIcon field="updated_at" />
                        </div>
                    </th>
                    <th className="px-2 py-3 text-center font-medium text-gray-700 dark:text-[#E6E6E6]">
                        {t('Select')}
                    </th>
                </tr>
            </thead>
            <tbody>
                {documents.map((doc) => (
                    <DocumentTableRow
                        key={doc.id}
                        doc={doc}
                        showFileName={showFileName}
                        isSelected={selectedDocIds.includes(doc.id)}
                        isDeleting={deletingDocIds.has(doc.id)}
                        onSelect={onDocumentSelect}
                    />
                ))}
            </tbody>
        </table>
    )
}

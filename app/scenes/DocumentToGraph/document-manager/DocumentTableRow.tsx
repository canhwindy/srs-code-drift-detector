'use client'

import React from 'react'
import { AlertTriangle, Info } from 'lucide-react'
import type { Document } from './types/document'
import { getDisplayFileName, getStatusColor, getStatusLabel } from './utils/document-utils'

interface DocumentTableRowProps {
    doc: Document
    showFileName: boolean
    isSelected: boolean
    isDeleting: boolean
    onSelect: (docId: string, checked: boolean) => void
}

export default function DocumentTableRow({
    doc,
    showFileName,
    isSelected,
    isDeleting,
    onSelect,
}: DocumentTableRowProps) {
    return (
        <tr className={[
            'border-b border-gray-200 dark:border-[#2a2f3e] hover:bg-gray-50 dark:hover:bg-gray-800/50',
            isDeleting ? 'opacity-50' : '',
        ].join(' ')}>
            <td className="px-2 py-2 font-mono text-xs max-w-[250px]">
                <div className="relative group">
                    <div className="truncate">
                        {showFileName ? getDisplayFileName(doc) : doc.id}
                    </div>
                    {showFileName && (
                        <div className="text-[10px] text-gray-500 dark:text-[#8a8f9e] truncate">
                            {doc.id}
                        </div>
                    )}
                    {/* Tooltip */}
                    <div className="invisible group-hover:visible absolute z-50 left-0 top-full mt-1 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-xs rounded-md py-1 px-2 whitespace-nowrap shadow-lg">
                        {doc.file_path}
                    </div>
                </div>
            </td>
            <td className="px-2 py-2 max-w-xs truncate">{doc.content_summary}</td>
            <td className="px-2 py-2">
                <div className="flex items-center gap-1">
                    <span className={getStatusColor(doc.status)}>
                        {getStatusLabel(doc.status)}
                    </span>
                    {doc.error_msg && (
                        <div className="relative group/error">
                            <AlertTriangle className="w-4 h-4 text-yellow-500 cursor-pointer" />
                            <div className="invisible group-hover/error:visible absolute z-50 left-full ml-1 top-1/2 -translate-y-1/2 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-xs rounded-md py-2 px-3 shadow-lg max-w-xs whitespace-pre-wrap break-words">
                                {doc.error_msg}
                            </div>
                        </div>
                    )}
                    {doc.metadata && <Info className="w-4 h-4 text-blue-500" />}
                </div>
            </td>
            <td className="px-2 py-2">{doc.content_length}</td>
            <td className="px-2 py-2">{doc.chunks_count}</td>
            <td className="px-2 py-2 text-xs">
                {new Date(doc.created_at).toLocaleString()}
            </td>
            <td className="px-2 py-2 text-xs">
                {new Date(doc.updated_at).toLocaleString()}
            </td>
            <td className="px-2 py-2 text-center">
                <input
                    type="checkbox"
                    checked={isSelected}
                    disabled={isDeleting}
                    onChange={(e) => onSelect(doc.id, e.target.checked)}
                    className="w-4 h-4 text-emerald-500 border-gray-300 dark:border-[#2a2f3e] rounded focus:ring-emerald-400 disabled:cursor-not-allowed"
                />
            </td>
        </tr>
    )
}

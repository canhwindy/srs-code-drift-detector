import type { Document } from '../types/document'

export const getDisplayFileName = (doc: Document, maxLength: number = 30): string => {
    if (!doc.file_path) { return doc.id; }
    const parts = doc.file_path.split('/')
    const fileName = parts[parts.length - 1]
    return fileName.length > maxLength ? fileName.slice(0, maxLength) + '...' : fileName
}

export const getStatusColor = (status: Document['status']): string => {
    const colors: Record<Document['status'], string> = {
        processed: 'text-green-600 dark:text-green-400',
        preprocessed: 'text-purple-600 dark:text-purple-400',
        processing: 'text-blue-600 dark:text-blue-400',
        pending: 'text-yellow-600 dark:text-yellow-400',
        failed: 'text-red-600 dark:text-red-400',
        deleting: 'text-gray-400 dark:text-gray-500',
    }
    return colors[status]
}

export const getStatusLabel = (status: Document['status']): string => {
    const labels: Record<Document['status'], string> = {
        processed: 'Completed',
        preprocessed: 'Preprocessed',
        processing: 'Processing',
        pending: 'Pending',
        failed: 'Failed',
        deleting: 'Deleting',
    }
    return labels[status]
}

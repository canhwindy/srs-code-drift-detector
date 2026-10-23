export interface Document {
    id: string
    file_path: string
    content_summary: string
    status: 'processed' | 'preprocessed' | 'processing' | 'pending' | 'failed' | 'deleting'
    content_length: number
    chunks_count: number
    created_at: string
    updated_at: string
    error_msg?: string
    metadata?: Record<string, any>
    track_id?: string
}

export interface DocumentManagerProps {
    /**
     * Current workspace ID — triggers refetch when workspace changes
     */
    workspaceId: string

    /**
     * Whether to show file names instead of IDs
     */
    showFileNameByDefault?: boolean

    /**
     * Initial page size
     */
    initialPageSize?: number

    /**
     * Whether the component is in loading state
     */
    isLoading?: boolean
}

export type StatusFilter = 'all' | 'processed' | 'preprocessed' | 'processing' | 'pending' | 'failed'
export type SortField = 'id' | 'file_path' | 'created_at' | 'updated_at'
export type SortDirection = 'asc' | 'desc'

export type StatusCounts = Record<StatusFilter, number>

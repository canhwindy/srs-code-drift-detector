import { useState, useCallback, useEffect, useRef } from 'react'
import {
    apiDeleteDocuments,
    apiFetchDocuments,
    apiScanDocuments,
    exportOutlineDocument,
    fetchOutlineDocumentsByStatus,
    uploadDocument,
} from '../../lib/api'
import { buildSafeFilename } from '../../lib/buildSafeFilename'
import { waitForKgDocsDeleted } from '../helpers/helpers'

const _AUTO_SYNC_MINUTES = Number(import.meta.env.VITE_AUTO_SYNC_INTERVAL_MINUTES) || 60
const AUTO_SYNC_INTERVAL = _AUTO_SYNC_MINUTES * 60 * 1000

/** LocalStorage keys */
const LS_KEY_LAST_SYNC = 'autoSync_lastSyncAt'
const LS_KEY_ENABLED = 'autoSync_isEnabled'
const LS_KEY_SYNCED_DOCS = 'autoSync_syncedDocs'

/**
 * Status of the auto-sync process
 */
export type AutoSyncStatus =
    | 'idle'        // Not running
    | 'checking'    // Checking for new approved documents
    | 'syncing'     // Syncing documents
    | 'error'       // Error occurred

/**
 * Summary of the last auto-sync run
 */
export interface AutoSyncSummary {
    lastSyncAt: Date | null
    documentsChecked: number
    documentsSynced: number
    documentsUpdated: number
    documentsSkipped: number
    documentsRemoved: number
    errors: number
}

/**
 * Read last sync timestamp from localStorage
 */
function getLastSyncFromStorage(): Date | null {
    try {
        const stored = localStorage.getItem(LS_KEY_LAST_SYNC)
        if (stored) {
            const date = new Date(stored)
            if (!isNaN(date.getTime())) {
                return date
            }
        }
    } catch {
        // localStorage not available
    }
    return null
}

/**
 * Save last sync timestamp to localStorage
 */
function saveLastSyncToStorage(date: Date): void {
    try {
        localStorage.setItem(LS_KEY_LAST_SYNC, date.toISOString())
    } catch {
        // localStorage not available
    }
}

/**
 * Read enabled state from localStorage
 */
function getEnabledFromStorage(defaultValue: boolean): boolean {
    try {
        const stored = localStorage.getItem(LS_KEY_ENABLED)
        if (stored !== null) {
            return stored === 'true'
        }
    } catch {
        // localStorage not available
    }
    return defaultValue
}

/**
 * Save enabled state to localStorage
 */
function saveEnabledToStorage(enabled: boolean): void {
    try {
        localStorage.setItem(LS_KEY_ENABLED, String(enabled))
    } catch {
        // localStorage not available
    }
}

/**
 * Read the registry of auto-synced docs from localStorage.
 * Maps outlineDocId → { filename, kgDocId }
 */
type SyncedDocEntry = {
    filename: string
    kgDocId: string
    contentHash?: string
    updatedAt?: string
}

function getSyncedDocsFromStorage(): Map<string, SyncedDocEntry> {
    try {
        const stored = localStorage.getItem(LS_KEY_SYNCED_DOCS)
        if (stored) {
            const parsed = JSON.parse(stored) as Record<string, SyncedDocEntry>
            return new Map(Object.entries(parsed))
        }
    } catch {
        // localStorage not available or corrupt data
    }
    return new Map()
}

/**
 * Save the registry of auto-synced docs to localStorage.
 */
function saveSyncedDocsToStorage(registry: Map<string, SyncedDocEntry>): void {
    try {
        const obj = Object.fromEntries(registry)
        localStorage.setItem(LS_KEY_SYNCED_DOCS, JSON.stringify(obj))
    } catch {
        // localStorage not available
    }
}

/**
 * Compute SHA-256 hash of a string using Web Crypto API.
 * Returns a lowercase hex string.
 */
async function computeContentHash(content: string): Promise<string> {
    const encoder = new TextEncoder()
    const data = encoder.encode(content)
    const hashBuffer = await crypto.subtle.digest('SHA-256', data)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Check if enough time has passed since last sync
 */
function shouldSyncNow(lastSyncAt: Date | null): boolean {
    if (!lastSyncAt) {
        return true // Never synced before
    }
    const elapsed = Date.now() - lastSyncAt.getTime()
    // Sync if more than 4 minutes have passed (give 1 minute buffer)
    return elapsed >= AUTO_SYNC_INTERVAL - 60 * 1000
}


/**
 * useAutoSyncApproved — Custom hook để tự động sync documents có status "Approved" mỗi 5 phút.
 *
 * PERSISTENCE:
 * - lastSyncAt được lưu vào localStorage để tránh sync lại khi navigate giữa các trang
 * - isEnabled được lưu vào localStorage để nhớ preference của user
 * - Khi mount, chỉ sync nếu đã qua đủ thời gian kể từ lần sync cuối
 *
 * @param onDocumentsUploaded - Callback sau khi sync thành công (để refresh bảng)
 * @param enabled - Bật/tắt auto-sync (default: true)
 * @param workspaceId - Workspace ID
 * @param isPaused - Tạm dừng auto-sync (ví dụ: khi có docs đang "deleting")
 */
export function useAutoSyncApproved(
    onDocumentsUploaded?: (files: File[]) => void,
    enabled: boolean = true,
    workspaceId?: string,
    isPaused: boolean = false,
) {
    // Initialize from localStorage
    const [status, setStatus] = useState<AutoSyncStatus>('idle')
    const [summary, setSummary] = useState<AutoSyncSummary>(() => ({
        lastSyncAt: getLastSyncFromStorage(),
        documentsChecked: 0,
        documentsSynced: 0,
        documentsUpdated: 0,
        documentsSkipped: 0,
        documentsRemoved: 0,
        errors: 0,
    }))
    const [isEnabled, setIsEnabled] = useState(() => getEnabledFromStorage(enabled))
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
    const isSyncingRef = useRef(false)
    const mountedRef = useRef(true)
    // Ref để performSync luôn đọc giá trị isPaused mới nhất (tránh stale closure)
    const isPausedRef = useRef(isPaused)
    isPausedRef.current = isPaused

    /**
     * Perform the sync operation
     */
    const performSync = useCallback(async () => {
        // Tạm dừng khi có docs đang "deleting" — resume tự động sau khi xóa xong
        if (isPausedRef.current) {
            return
        }
        // Prevent concurrent syncs
        if (isSyncingRef.current) {
            return
        }


        isSyncingRef.current = true
        setStatus('checking')

        let documentsChecked = 0
        let documentsSynced = 0
        let documentsUpdated = 0
        let documentsSkipped = 0
        let documentsRemoved = 0
        let errors = 0
        const successFiles: File[] = []

        try {
            // Step 1: Fetch approved documents from Outline
            let approvedDocs: Awaited<ReturnType<typeof fetchOutlineDocumentsByStatus>> = []
            approvedDocs = await fetchOutlineDocumentsByStatus('Approved')
            documentsChecked = approvedDocs.length

            // Step 2: Fetch existing documents in Knowledge Graph
            const kgResponse = await apiFetchDocuments(undefined, 1, 1000, 'updated_at', 'desc', undefined, workspaceId)
            const kgDocsByFilename = new Map(
                kgResponse.documents.map(doc => {
                    const filename = doc.file_path.split('/').pop() ?? doc.file_path
                    return [filename, doc.id] as const
                })
            )

            // Step 2.5: Remove stale docs — docs in registry that lost Approved status
            const registry = getSyncedDocsFromStorage()
            const approvedDocIds = new Set(approvedDocs.map(d => d.id))

            for (const [outlineId, entry] of registry.entries()) {
                if (!approvedDocIds.has(outlineId)) {
                    // This doc lost Approved status — delete from KG
                    const kgDocId = kgDocsByFilename.get(entry.filename) ?? entry.kgDocId
                    if (kgDocId) {
                        try {
                            await apiDeleteDocuments([kgDocId])
                            documentsRemoved++
                            registry.delete(outlineId)
                        } catch {
                            // Keep in registry to retry next cycle
                            errors++
                        }
                    } else {
                        // Already gone from KG — just clean up registry
                        registry.delete(outlineId)
                    }
                }
            }
            saveSyncedDocsToStorage(registry)

            const now = new Date()

            if (approvedDocs.length === 0 && documentsRemoved === 0) {
                if (mountedRef.current) {
                    setStatus('idle')
                    setSummary({
                        lastSyncAt: now,
                        documentsChecked,
                        documentsSynced,
                        documentsUpdated,
                        documentsSkipped,
                        documentsRemoved,
                        errors,
                    })
                }
                saveLastSyncToStorage(now)
                isSyncingRef.current = false
                return
            }

            if (mountedRef.current) {
                setStatus('syncing')
            }

            // Step 3: For each approved document, check if it needs syncing
            for (const doc of approvedDocs) {
                const filename = buildSafeFilename(doc.id, doc.title)

                // Check if document already exists in KG
                if (kgDocsByFilename.has(filename)) {
                    const kgDocId = kgDocsByFilename.get(filename)!
                    const registryEntry = registry.get(doc.id)

                    // Filter by updatedAt — if unchanged, skip without any export call
                    if (registryEntry?.updatedAt && registryEntry.updatedAt === doc.updatedAt) {
                        documentsSkipped++
                        continue
                    }

                    // updatedAt changed (or no registry entry) — export and check content hash
                    try {
                        const markdownContent = await exportOutlineDocument(doc.id)
                        const newHash = await computeContentHash(markdownContent)

                        if (registryEntry?.contentHash && registryEntry.contentHash === newHash) {
                            // Content unchanged — update updatedAt in registry and skip
                            registry.set(doc.id, { filename, kgDocId, contentHash: newHash, updatedAt: doc.updatedAt })
                            documentsSkipped++
                            continue
                        }

                        // Content changed (or no previous hash = migration) — replace
                        await apiDeleteDocuments([kgDocId])
                        await waitForKgDocsDeleted([kgDocId], { workspaceId })

                        const file = new File([markdownContent], filename, { type: 'text/markdown' })
                        const result = await uploadDocument(file, workspaceId)

                        if (result.status === 'success') {
                            documentsUpdated++
                            successFiles.push(file)
                            registry.set(doc.id, {
                                filename,
                                kgDocId: result.track_id ?? '',
                                contentHash: newHash,
                                updatedAt: doc.updatedAt,
                            })
                        } else {
                            errors++
                        }
                    } catch {
                        errors++
                    }
                    continue
                }

                try {
                    // Export document content from Outline
                    const markdownContent = await exportOutlineDocument(doc.id)

                    // Create File object
                    const file = new File([markdownContent], filename, {
                        type: 'text/markdown',
                    })

                    // Upload to LightRAG backend
                    const result = await uploadDocument(file, workspaceId)

                    if (result.status === 'success') {
                        documentsSynced++
                        successFiles.push(file)
                        registry.set(doc.id, {
                            filename,
                            kgDocId: result.track_id ?? '',
                            contentHash: await computeContentHash(markdownContent),
                            updatedAt: doc.updatedAt,
                        })
                    } else if (result.status === 'duplicate') {
                        documentsSkipped++
                    } else {
                        errors++
                    }
                } catch (_docError) {
                    errors++
                }
            }

            // Save updated registry
            saveSyncedDocsToStorage(registry)

            // Trigger scan để backend process tất cả PENDING docs tuần tự.
            // Gọi dù có upload lỗi — docs đã PENDING vẫn cần được xử lý.
            // Bỏ qua lỗi: nếu scan busy hoặc network lỗi, docs PENDING xử lý lần sau.
            try {
                await apiScanDocuments(workspaceId)
            } catch {
                // intentional no-op
            }

            // Step 4: Update summary and notify parent
            const syncTime = new Date()
            saveLastSyncToStorage(syncTime)

            if (mountedRef.current) {
                setSummary({
                    lastSyncAt: syncTime,
                    documentsChecked,
                    documentsSynced,
                    documentsUpdated,
                    documentsSkipped,
                    documentsRemoved,
                    errors,
                })

                if (successFiles.length > 0 && onDocumentsUploaded) {
                    onDocumentsUploaded(successFiles)
                }

                setStatus('idle')
            }
        } catch (_syncError) {
            if (mountedRef.current) {
                setStatus('error')
                setSummary(prev => ({
                    ...prev,
                    lastSyncAt: new Date(),
                    errors: prev.errors + 1,
                }))
            }
        } finally {
            isSyncingRef.current = false
        }
    }, [onDocumentsUploaded, workspaceId])


    /**
     * Toggle auto-sync on/off
     */
    const toggleEnabled = useCallback(() => {
        setIsEnabled(prev => {
            const newValue = !prev
            saveEnabledToStorage(newValue)
            return newValue
        })
    }, [])


    /**
     * Manually trigger a sync
     */
    const triggerSync = useCallback(() => {
        void performSync()
    }, [performSync])


    /**
     * Setup interval for auto-sync
     */
    useEffect(() => {
        mountedRef.current = true

        if (!isEnabled) {
            // Clear interval when disabled
            if (intervalRef.current) {
                clearInterval(intervalRef.current)
                intervalRef.current = null
            }

            return () => {
                mountedRef.current = false
            }
        }

        // Check if we should perform initial sync based on last sync time
        const lastSync = getLastSyncFromStorage()
        const shouldSync = shouldSyncNow(lastSync)



        let initialTimeout: ReturnType<typeof setTimeout> | null = null

        if (shouldSync) {
            // Perform initial sync after a short delay

            initialTimeout = setTimeout(() => {

                void performSync()
            }, 3000) // 3 second delay before first sync
        }

        // Calculate time until next sync
        // If we just skipped initial sync, schedule based on remaining time
        let nextSyncDelay = AUTO_SYNC_INTERVAL
        if (!shouldSync && lastSync) {
            const elapsed = Date.now() - lastSync.getTime()
            nextSyncDelay = Math.max(AUTO_SYNC_INTERVAL - elapsed, 60 * 1000) // At least 1 minute
        }

        // Setup interval for periodic sync
        // Start the interval after the calculated delay
        const startInterval = () => {
            intervalRef.current = setInterval(() => {
                void performSync()
            }, AUTO_SYNC_INTERVAL)
        }

        // If we're doing initial sync, start interval immediately
        // Otherwise, wait for the remaining time before starting
        if (shouldSync) {
            startInterval()
        } else {
            const delayTimeout = setTimeout(() => {
                void performSync()
                startInterval()
            }, nextSyncDelay)

            return () => {
                mountedRef.current = false
                clearTimeout(delayTimeout)
                if (initialTimeout) { clearTimeout(initialTimeout) }
                if (intervalRef.current) {
                    clearInterval(intervalRef.current)
                    intervalRef.current = null
                }
            }
        }

        return () => {
            mountedRef.current = false
            if (initialTimeout) { clearTimeout(initialTimeout) }
            if (intervalRef.current) {
                clearInterval(intervalRef.current)
                intervalRef.current = null
            }
        }
    }, [isEnabled, performSync])


    return {
        status,
        summary,
        isEnabled,
        toggleEnabled,
        triggerSync,
    }
}

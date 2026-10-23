const TTL_MS = 10 * 60 * 1000 // 10 minutes

interface DeletingEntry {
    ids: string[]
    expiresAt: number
}

function storageKey(workspaceId: string): string {
    return `pending_deletion_${workspaceId}`
}

function readEntry(workspaceId: string): DeletingEntry | null {
    try {
        const raw = localStorage.getItem(storageKey(workspaceId))
        if (!raw) { return null; }
        const entry: DeletingEntry = JSON.parse(raw)
        if (Date.now() > entry.expiresAt) {
            localStorage.removeItem(storageKey(workspaceId))
            return null
        }
        return entry
    } catch {
        return null
    }
}

function writeEntry(workspaceId: string, ids: string[]): void {
    try {
        if (ids.length === 0) {
            localStorage.removeItem(storageKey(workspaceId))
            return
        }
        const entry: DeletingEntry = { ids, expiresAt: Date.now() + TTL_MS }
        localStorage.setItem(storageKey(workspaceId), JSON.stringify(entry))
    } catch {
        // localStorage unavailable (private mode, storage full) — degrade gracefully
    }
}

/** Returns the set of doc IDs currently marked as deleting (unexpired only). */
export function getDeletingIds(workspaceId: string): Set<string> {
    const entry = readEntry(workspaceId)
    return new Set(entry?.ids ?? [])
}

/** Adds doc IDs to the deleting set and resets the TTL. */
export function addDeletingIds(workspaceId: string, ids: string[]): void {
    const existing = readEntry(workspaceId)?.ids ?? []
    const merged = Array.from(new Set([...existing, ...ids]))
    writeEntry(workspaceId, merged)
}

/** Removes doc IDs from the deleting set. Clears storage when set becomes empty. */
export function removeDeletingIds(workspaceId: string, ids: string[]): void {
    const existing = readEntry(workspaceId)?.ids ?? []
    const toRemove = new Set(ids)
    const remaining = existing.filter((id) => !toRemove.has(id))
    writeEntry(workspaceId, remaining)
}

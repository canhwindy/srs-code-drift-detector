// ============================================================
// FILE: app/scenes/DocumentToGraph/SyncCollectionDialog/index.ts
// ACTION: CREATE_NEW
// DESCRIPTION: Re-exports cho SyncCollectionDialog
// ============================================================

// Main component — dùng trong DocumentManagers.tsx
export { default as SyncCollectionDialog } from './SyncCollectionDialog'

// Types nếu cần dùng ở nơi khác
export type {
    CollectionListItem,
    CollectionWithDocs,
    OutlineDoc,
    DocSyncStatus,
    DialogPhase,
} from './types'
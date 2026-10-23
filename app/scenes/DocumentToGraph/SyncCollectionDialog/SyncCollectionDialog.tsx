'use client'

import React, { useEffect, useRef } from 'react'
import { useTranslation } from "react-i18next";
import { X, DatabaseZap, AlertTriangle, ChevronLeft, FileText } from 'lucide-react'
import CollectionSelectItem from './CollectionSelectItem'
import CollectionItem from './CollectionItem'
import { useSyncCollection } from './hooks/useSyncCollection'

// ============================================================
// SECTION 1: Props
// ============================================================

interface SyncCollectionDialogProps {
    isOpen: boolean
    onClose: () => void
    onDocumentsUploaded: (files: File[]) => void
    workspaceId?: string
}

// ============================================================
// SECTION 2: Reusable sub-components
// ============================================================

/** Skeleton loading — hiển thị khi đang fetch collections.list */
function LoadingSkeleton() {
    return (
        <div className="p-4 space-y-2 animate-pulse">
            {[80, 65, 90, 55, 75].map((w, i) => (
                <div key={i} className="flex items-center gap-3 px-2 py-1.5">
                    <div className="w-4 h-4 bg-gray-200 dark:bg-[#2a2f3e] rounded flex-shrink-0" />
                    <div className="w-4 h-4 bg-gray-200 dark:bg-[#2a2f3e] rounded flex-shrink-0" />
                    <div
                        className="h-4 bg-gray-200 dark:bg-[#2a2f3e] rounded flex-1"
                        style={{ maxWidth: `${w}%` }}
                    />
                    <div className="w-16 h-4 bg-gray-100 dark:bg-[#1f232e] rounded flex-shrink-0" />
                </div>
            ))}
        </div>
    )
}


/** Step indicator — "Step 1 of 2" hoặc "Step 2 of 2" */
function StepIndicator({ current, total }: { current: 1 | 2; total: 2 }) {
    const { t } = useTranslation();
    return (
        <div className="flex items-center gap-2">
            {/* Dot indicators */}
            {Array.from({ length: total }).map((_, i) => (
                <div
                    key={i}
                    className={[
                        'rounded-full transition-all',
                        i + 1 === current
                            ? 'w-4 h-1.5 bg-emerald-500'    // Active: pill shape
                            : 'w-1.5 h-1.5 bg-gray-300 dark:bg-gray-600',  // Inactive: small dot
                    ].join(' ')}
                />
            ))}
            <span className="text-xs text-gray-400 dark:text-[#6b7280] ml-1">
                {t("Step {{current}} of {{total}}", { current, total })}
            </span>
        </div>
    )
}



/** Sync summary hiển thị sau khi phase === 'done' */
function SyncDoneSummary({
    success,
    duplicate,
    error,
    ignored,
}: {
    success: number
    duplicate: number
    error: number
    ignored: number    // NEW: docs user chọn ignore
}): React.ReactElement {
    const { t } = useTranslation();
    const hasNoResult = success === 0 && duplicate === 0 && error === 0 && ignored === 0
    return (
        <div className="flex items-center gap-3 text-sm flex-wrap">
            {success > 0 && (
                <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                    {"✅ "}{t("{{count}} synced", { count: success })}
                </span>
            )}
            {duplicate > 0 && (
                <span className="text-amber-600 dark:text-amber-400">
                    {"♻️ "}{t("{{count}} already in KG", { count: duplicate })}
                </span>
            )}
            {error > 0 && (
                <span className="text-red-600 dark:text-red-400">
                    {"❌ "}{t("{{count}} failed", { count: error })}
                </span>
            )}
            {/* NEW: hiện số docs bị skip khi user chọn 'ignore' */}
            {ignored > 0 && (
                <span className="text-gray-400 dark:text-[#6b7280]">
                    {"⊘ "}{t("{{count}} skipped", { count: ignored })}
                </span>
            )}
            {hasNoResult && (
                <span className="text-gray-400">{t("No documents processed.")}</span>
            )}
        </div>
    )
}

// ============================================================
// SECTION 3: Main dialog component
// ============================================================

/**
 * SyncCollectionDialog — two-phase modal.
 *
 * Phase 1 (select_collections):
 *   - Hiện danh sách collections + doc count
 *   - User check collections muốn load
 *   - Click "Load Docs →" → instant transition sang Phase 2
 *
 * Phase 2 (select_documents):
 *   - Hiện docs của collections đã chọn (auto-expanded)
 *   - User chọn docs cụ thể
 *   - Click "Sync →" → export + upload
 *   - "← Back" quay lại Phase 1
 *
 * Sync phases (syncing → done): Giống v1.
 */
export default function SyncCollectionDialog({
    isOpen,
    onClose,
    onDocumentsUploaded,
    workspaceId,
}: SyncCollectionDialogProps) {
    const { t } = useTranslation();

    const {
        // Phase
        phase,
        errorMessage,

        // Phase 1
        collectionListItems,
        selectedCollectionIds,
        totalSelectedCollections,
        totalDocsInSelectedCollections,
        toggleCollectionSelection,
        selectAllCollections,
        deselectAllCollections,
        proceedToDocuments,

        // Phase 2
        loadedCollections,
        selectedDocIds,
        totalSelectedDocs,
        goBack,
        toggleExpand,
        toggleDoc,
        toggleAllDocsInCollection,
        getCollectionCheckState,

        // Sync
        startSync,
        docStatuses,
        syncSummary,

        // Reload
        load,


        // NEW: Phase 3 — Conflict resolution
        conflictDocs,
        docResolutions,
        checkConflictsAndProceed,
        setDocResolution,
        setAllResolutions,
        goBackFromConflicts,
    } = useSyncCollection(onDocumentsUploaded, workspaceId)


    // EFFECT: Load collections khi dialog mở lần đầu
    useEffect(() => {
        if (isOpen) {
            load()
        }
    }, [isOpen, load])

    // EFFECT: Đóng bằng Escape (chỉ khi không sync)
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && phase !== 'syncing') {
                onClose()
            }
        }
        if (isOpen) { document.addEventListener('keydown', handler); }
        return () => document.removeEventListener('keydown', handler)
    }, [isOpen, phase, onClose])

    // ── Derived booleans cho readability ──────────────────────
    // IMPORTANT: Must be declared BEFORE the early return to keep hook call
    // order stable across renders (Rules of Hooks).
    const isSyncing = phase === 'syncing'
    const isDone = phase === 'done'
    const isPhase1 = phase === 'select_collections'
    const isPhase2 = phase === 'select_documents'


    // NEW: Phase 3 — Conflict resolution
    const isConflictPhase = phase === 'resolve_conflicts'

    // NEW: Computed counters cho footer Phase 3
    // Tính số 'replace' và 'ignore' dựa trên docResolutions Map hiện tại
    const conflictReplaceCount = isConflictPhase
        ? conflictDocs.filter((c) => docResolutions.get(c.outlineDocId) === 'replace').length
        : 0
    const conflictIgnoreCount = isConflictPhase
        ? conflictDocs.filter((c) => docResolutions.get(c.outlineDocId) === 'ignore').length
        : 0



    // Phase 1: allSelected = tất cả collections đang được chọn
    const allCollectionsSelected =
        collectionListItems.length > 0 &&
        collectionListItems.every((c) => selectedCollectionIds.has(c.id))

    // Phase 1: someSelected = ít nhất 1 collection được chọn
    const someCollectionsSelected =
        !allCollectionsSelected &&
        collectionListItems.some((c) => selectedCollectionIds.has(c.id))

    // Ref cho "Select All" checkbox Phase 1 (cần set indeterminate)
    // IMPORTANT: Must be declared BEFORE the early return — hooks cannot be
    // called conditionally.
    const selectAllRef = useRef<HTMLInputElement>(null)
    useEffect(() => {
        if (selectAllRef.current) {
            selectAllRef.current.indeterminate = someCollectionsSelected
        }
    }, [someCollectionsSelected])

    if (!isOpen) { return null; }


    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
            onClick={(e) => {
                if (e.target === e.currentTarget && !isSyncing) { onClose(); }
            }}
            role="dialog"
            aria-modal="true"
        >
            {/* ── DIALOG PANEL ───────────────────────────────────── */}
            <div className="relative bg-white dark:bg-[#111319] rounded-xl shadow-2xl w-full max-w-lg mx-4 flex flex-col max-h-[80vh]">

                {/* ── HEADER ─────────────────────────────────────────── */}
                <div className="flex items-start gap-3 px-5 py-4 border-b border-gray-200 dark:border-[#2a2f3e]">
                    {/* Icon + Title */}
                    <DatabaseZap className="w-5 h-5 text-emerald-500 flex-shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                        <h2 className="text-base font-semibold text-gray-900 dark:text-[#E6E6E6]">
                            {t("Sync Collection to Knowledge Graph")}
                        </h2>
                        {/* Step indicator — chỉ hiện khi đang ở Phase 1 hoặc 2 */}
                        {(isPhase1 || isPhase2) && (
                            <div className="mt-1.5">
                                <StepIndicator current={isPhase1 ? 1 : 2} total={2} />
                            </div>
                        )}
                        {/* Phase description */}
                        <p className="mt-1 text-xs text-gray-400 dark:text-[#6b7280]">
                            {isPhase1 && t("Select which collections to load documents from")}
                            {isPhase2 && t("Choose specific documents to sync")}
                            {isConflictPhase && t("{{count}} documents already exist in the Knowledge Graph", { count: conflictDocs.length })}
                            {isSyncing && t("Exporting and uploading selected documents...")}
                            {isDone && t("Sync complete")}
                            {phase === 'loading_collections' && t("Loading collections...")}
                        </p>
                    </div>

                    {/* Close button */}
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={isSyncing}
                        className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>

                {/* ── BODY ───────────────────────────────────────────── */}
                <div className="flex-1 overflow-y-auto min-h-0">

                    {/* LOADING */}
                    {phase === 'loading_collections' && <LoadingSkeleton />}

                    {/* ERROR */}
                    {phase === 'error' && (
                        <div className="flex flex-col items-center justify-center p-8 gap-3 text-center">
                            <AlertTriangle className="w-8 h-8 text-amber-500" />
                            <p className="text-sm text-gray-600 dark:text-[#8a8f9e]">
                                {t("Failed to load collections")}
                            </p>
                            <p className="text-xs text-gray-400 font-mono bg-gray-50 dark:bg-[#1f232e] px-3 py-1.5 rounded">
                                {errorMessage}
                            </p>
                            <button
                                type="button"
                                onClick={load}
                                className="mt-1 px-4 py-1.5 text-sm rounded-md bg-gray-100 dark:bg-[#1f232e] hover:bg-gray-200 dark:hover:bg-[#2a2f3e] text-gray-700 dark:text-[#E6E6E6] transition-colors"
                            >
                                {t("Retry")}
                            </button>
                        </div>
                    )}

                    {/* ── PHASE 1: SELECT COLLECTIONS ─────────────────── */}
                    {isPhase1 && (
                        <>
                            {collectionListItems.length === 0 ? (
                                <div className="p-8 text-center text-sm text-gray-400">
                                    {t("No collections found in this workspace.")}
                                </div>
                            ) : (
                                <>
                                    {/* SELECT ALL header row */}
                                    <div className="flex items-center gap-3 px-4 py-2.5 border-b border-gray-100 dark:border-[#2a2f3e] bg-gray-50/50 dark:bg-[#1f232e]/30">
                                        <input
                                            ref={selectAllRef}
                                            type="checkbox"
                                            checked={allCollectionsSelected}
                                            onChange={() =>
                                                allCollectionsSelected
                                                    ? deselectAllCollections()
                                                    : selectAllCollections()
                                            }
                                            className="w-4 h-4 rounded accent-emerald-500 cursor-pointer flex-shrink-0"
                                            aria-label="Select all collections"
                                        />
                                        <span className="text-xs font-medium text-gray-500 dark:text-[#8a8f9e] uppercase tracking-wide">
                                            {allCollectionsSelected
                                                ? t("Deselect All")
                                                : t("Select All Collections")}
                                        </span>
                                        <span className="ml-auto text-xs text-gray-400">
                                            {t("{{count}} collections", { count: collectionListItems.length })}
                                        </span>
                                    </div>

                                    {/* Collection list */}
                                    <div className="p-2 space-y-0.5">
                                        {collectionListItems.map((collection) => (
                                            <CollectionSelectItem
                                                key={collection.id}
                                                collection={collection}
                                                isSelected={selectedCollectionIds.has(collection.id)}
                                                onToggle={toggleCollectionSelection}
                                            />
                                        ))}
                                    </div>
                                </>
                            )}
                        </>
                    )}

                    {/* ── PHASE 2: SELECT DOCUMENTS ───────────────────── */}
                    {(isPhase2 || isSyncing || isDone) && (
                        <>
                            {loadedCollections.length === 0 ? (
                                <div className="p-8 text-center text-sm text-gray-400">
                                    {t("No documents found in selected collections.")}
                                </div>
                            ) : (
                                <div className="divide-y divide-gray-100 dark:divide-gray-800">
                                    {loadedCollections.map((collection) => (
                                        <CollectionItem
                                            key={collection.id}
                                            collection={collection}
                                            checkState={getCollectionCheckState(collection.id)}
                                            selectedDocIds={selectedDocIds}
                                            docStatuses={docStatuses}
                                            isSyncing={isSyncing}
                                            onToggleCollection={toggleAllDocsInCollection}
                                            onToggleExpand={toggleExpand}
                                            onToggleDoc={toggleDoc}
                                        />
                                    ))}
                                </div>
                            )}
                        </>
                    )}



                    {/* ── PHASE 3: RESOLVE CONFLICTS ─────────────────── */}
                    {isConflictPhase && (
                        <>
                            {/* Header row: "Replace All" / "Ignore All" bulk actions */}
                            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-100 dark:border-[#2a2f3e] bg-gray-50/50 dark:bg-[#1f232e]/30">
                                <span className="text-xs font-medium text-gray-500 dark:text-[#8a8f9e] uppercase tracking-wide flex-1">
                                    {t("{{count}} conflicts found", { count: conflictDocs.length })}
                                </span>
                                {/* Replace All: đặt tất cả về 'replace' */}
                                <button
                                    type="button"
                                    onClick={() => { setAllResolutions('replace') }}
                                    className="px-2.5 py-1 text-xs rounded-md bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 transition-colors"
                                >
                                    {t("Replace All")}
                                </button>
                                {/* Ignore All: đặt tất cả về 'ignore' */}
                                <button
                                    type="button"
                                    onClick={() => { setAllResolutions('ignore') }}
                                    className="px-2.5 py-1 text-xs rounded-md bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/50 transition-colors"
                                >
                                    {t("Ignore All")}
                                </button>
                            </div>

                            {/* Danh sách từng conflict doc với toggle Replace/Ignore */}
                            <div className="p-2 space-y-0.5">
                                {conflictDocs.map((conflict) => {
                                    // Lấy resolution hiện tại — fallback 'replace' (không thể undefined vì đã set default)
                                    const resolution: 'replace' | 'ignore' =
                                        docResolutions.get(conflict.outlineDocId) === 'ignore'
                                            ? 'ignore'
                                            : 'replace'

                                    return (
                                        <div
                                            key={conflict.outlineDocId}
                                            className="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-gray-50 dark:hover:bg-gray-800/40"
                                        >
                                            {/* Icon: file */}
                                            <FileText className="w-4 h-4 text-gray-400 flex-shrink-0" />

                                            {/* Filename — truncate nếu dài */}
                                            <span
                                                className="flex-1 text-sm text-gray-700 dark:text-[#E6E6E6] truncate"
                                                title={conflict.filename}
                                            >
                                                {conflict.filename}
                                            </span>

                                            {/* Toggle: [Replace] [Ignore] pill buttons */}
                                            <div className="flex items-center flex-shrink-0">
                                                {/* Replace button */}
                                                <button
                                                    type="button"
                                                    onClick={() => { setDocResolution(conflict.outlineDocId, 'replace') }}
                                                    className={[
                                                        'px-2.5 py-1 text-xs rounded-l-md border transition-colors',
                                                        resolution === 'replace'
                                                            ? 'bg-emerald-500 border-emerald-500 text-white font-medium'
                                                            : 'bg-white dark:bg-[#1f232e] border-gray-200 dark:border-[#2a2f3e] text-gray-500 dark:text-[#8a8f9e] hover:bg-gray-50 dark:hover:bg-[#2a2f3e]',
                                                    ].join(' ')}
                                                    aria-pressed={resolution === 'replace'}
                                                >
                                                    {t("Replace")}
                                                </button>
                                                {/* Ignore button */}
                                                <button
                                                    type="button"
                                                    onClick={() => { setDocResolution(conflict.outlineDocId, 'ignore') }}
                                                    className={[
                                                        'px-2.5 py-1 text-xs rounded-r-md border border-l-0 transition-colors',
                                                        resolution === 'ignore'
                                                            ? 'bg-amber-500 border-amber-500 text-white font-medium'
                                                            : 'bg-white dark:bg-[#1f232e] border-gray-200 dark:border-[#2a2f3e] text-gray-500 dark:text-[#8a8f9e] hover:bg-gray-50 dark:hover:bg-[#2a2f3e]',
                                                    ].join(' ')}
                                                    aria-pressed={resolution === 'ignore'}
                                                >
                                                    {t("Ignore")}
                                                </button>
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        </>
                    )}
                </div>

                {/* ── FOOTER ─────────────────────────────────────────── */}
                <div className="flex items-center justify-between px-5 py-4 border-t border-gray-200 dark:border-[#2a2f3e] gap-3">

                    {/* LEFT: Counter / Summary */}
                    <div className="text-sm text-gray-500 dark:text-[#8a8f9e] min-w-0">
                        {isDone && <SyncDoneSummary
                            success={syncSummary.success}
                            duplicate={syncSummary.duplicate}
                            error={syncSummary.error}
                            ignored={syncSummary.ignored}
                        />}

                        {isSyncing && (
                            <span>
                                {t("Syncing {{synced}} / {{total}}...", { synced: Array.from(docStatuses.values()).filter((s) => s === 'success' || s === 'duplicate' || s === 'error').length, total: totalSelectedDocs })}
                            </span>
                        )}

                        {/* Phase 1 footer info */}
                        {isPhase1 && (
                            totalSelectedCollections > 0 ? (
                                <span>
                                    {t("{{count}} collections selected ({{docs}} docs)", { count: totalSelectedCollections, docs: totalDocsInSelectedCollections })}
                                </span>
                            ) : (
                                <span className="text-gray-400">{t("Select collections to load")}</span>
                            )
                        )}

                        {/* Phase 2 footer info */}
                        {isPhase2 && (
                            totalSelectedDocs > 0 ? (
                                <span>
                                    {t("{{count}} documents selected", { count: totalSelectedDocs })}
                                </span>
                            ) : (
                                <span className="text-gray-400">{t("Select documents to sync")}</span>
                            )
                        )}

                        {/* Phase 3 footer info — NEW */}
                        {isConflictPhase && (
                            <span>
                                <span className="font-medium text-emerald-600 dark:text-emerald-400">
                                    {t("{{count}} replace", { count: conflictReplaceCount })}
                                </span>
                                {conflictIgnoreCount > 0 && (
                                    <span className="text-gray-400">
                                        {' '}{t("· {{count}} ignore", { count: conflictIgnoreCount })}
                                    </span>
                                )}
                            </span>
                        )}
                    </div>

                    {/* RIGHT: Action buttons */}
                    <div className="flex items-center gap-2 flex-shrink-0">

                        {/* BACK button — chỉ hiện ở Phase 2 */}
                        {isPhase2 && (
                            <button
                                type="button"
                                onClick={goBack}
                                className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-md border border-gray-200 dark:border-[#2a2f3e] bg-white dark:bg-[#1f232e] text-gray-600 dark:text-[#E6E6E6] hover:bg-gray-50 dark:hover:bg-[#2a2f3e] transition-colors"
                            >
                                <ChevronLeft className="w-3.5 h-3.5" />
                                {t("Back")}
                            </button>
                        )}


                        {/* NEW: BACK button — Phase 3 → Phase 2 */}
                        {isConflictPhase && (
                            <button
                                type="button"
                                onClick={goBackFromConflicts}
                                className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-md border border-gray-200 dark:border-[#2a2f3e] bg-white dark:bg-[#1f232e] text-gray-600 dark:text-[#E6E6E6] hover:bg-gray-50 dark:hover:bg-[#2a2f3e] transition-colors"
                            >
                                <ChevronLeft className="w-3.5 h-3.5" />
                                {t("Back")}
                            </button>
                        )}

                        {/* CANCEL / CLOSE */}
                        <button
                            type="button"
                            onClick={onClose}
                            disabled={isSyncing}
                            className="px-3 py-1.5 text-sm rounded-md border border-gray-200 dark:border-[#2a2f3e] bg-white dark:bg-[#1f232e] text-gray-600 dark:text-[#E6E6E6] hover:bg-gray-50 dark:hover:bg-[#2a2f3e] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            {isDone ? t("Close") : t("Cancel")}
                        </button>

                        {/* LOAD DOCS → button (Phase 1) */}
                        {isPhase1 && (
                            <button
                                type="button"
                                onClick={proceedToDocuments}
                                disabled={totalSelectedCollections === 0}
                                className="px-4 py-1.5 text-sm font-medium rounded-md bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                                {t("Load Docs →")}
                            </button>
                        )}

                        {/* SYNC → button (Phase 2) */}
                        {isPhase2 && (
                            <button
                                type="button"
                                onClick={() => { void checkConflictsAndProceed() }}
                                disabled={totalSelectedDocs === 0}
                                className="px-4 py-1.5 text-sm font-medium rounded-md bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                                {t("Sync →")}
                            </button>
                        )}


                        {isConflictPhase && (
                            <button
                                type="button"
                                onClick={() => { void startSync() }}
                                className="px-4 py-1.5 text-sm font-medium rounded-md bg-emerald-500 text-white hover:bg-emerald-600 transition-colors"
                            >
                                {t("Confirm →")}
                            </button>
                        )}

                        {/* SYNCING button (disabled, shows spinner) */}
                        {isSyncing && (
                            <button
                                type="button"
                                disabled
                                className="px-4 py-1.5 text-sm font-medium rounded-md bg-emerald-500 text-white opacity-80 cursor-not-allowed"
                            >
                                <span className="flex items-center gap-1.5">
                                    <span className="inline-block w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                                    {t("Syncing...")}
                                </span>
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}


import { observable, action, computed, runInAction } from "mobx";
import { toast } from "sonner";
import type RootStore from "./RootStore";
import { client } from "~/utils/ApiClient";

/**
 * Store to manage scanning and converting yaml/markdown notice blocks in documents.
 * When a collection is opened for the first time, it scans all documents and converts
 * notice info blocks that have yaml/markdown labels to plain text.
 */
class ScanNoticesStore {
    rootStore: RootStore;

    @observable
    isScanning = false;

    @observable
    scanProgress = 0;

    @observable
    currentDocumentName = "";

    @observable
    totalDocuments = 0;

    @observable
    processedDocuments = 0;

    @observable
    convertedDocuments = 0;

    @observable
    scanningCollectionId: string | null = null;

    @observable
    scanningCollectionName: string | null = null;

    // Track which collections have been scanned (stored in localStorage)
    // Version key: bump this when conversion logic changes to re-scan
    private scannedCollectionsKey = "outline_scanned_collections_v7";

    constructor(rootStore: RootStore) {
        this.rootStore = rootStore;
    }

    @computed
    get isDialogVisible(): boolean {
        return this.isScanning;
    }

    /**
     * Check if a collection has been scanned before
     */
    hasBeenScanned(collectionId: string): boolean {
        try {
            const scanned = localStorage.getItem(this.scannedCollectionsKey);
            if (scanned) {
                const scannedList = JSON.parse(scanned) as string[];
                return scannedList.includes(collectionId);
            }
        } catch {
            // Ignore localStorage errors
        }
        return false;
    }

    /**
     * Mark a collection as scanned
     */
    @action
    markAsScanned(collectionId: string): void {
        try {
            const scanned = localStorage.getItem(this.scannedCollectionsKey);
            let scannedList: string[] = [];
            if (scanned) {
                scannedList = JSON.parse(scanned) as string[];
            }
            if (!scannedList.includes(collectionId)) {
                scannedList.push(collectionId);
                localStorage.setItem(
                    this.scannedCollectionsKey,
                    JSON.stringify(scannedList)
                );
            }
        } catch {
            // Ignore localStorage errors
        }
    }

    /**
     * Scan all documents in a collection and convert yaml/markdown notice blocks
     */
    @action
    scanCollection = async (collectionId: string, collectionName: string) => {
        if (this.isScanning) {
            return;
        }

        // Check if already scanned
        if (this.hasBeenScanned(collectionId)) {
            return;
        }

        this.isScanning = true;
        this.scanProgress = 0;
        this.processedDocuments = 0;
        this.convertedDocuments = 0;
        this.scanningCollectionId = collectionId;
        this.scanningCollectionName = collectionName;

        try {
            // Fetch all documents in the collection
            const res = await client.post("/collections.documents", {
                id: collectionId,
            });

            if (!res?.data) {
                throw new Error("Failed to fetch documents");
            }

            // Flatten the document tree to get all document IDs
            const allDocuments = this.flattenDocumentTree(res.data);
            this.totalDocuments = allDocuments.length;

            if (allDocuments.length === 0) {
                this.markAsScanned(collectionId);
                return;
            }

            // Process each document
            for (const doc of allDocuments) {
                await this.processDocument(doc.id, doc.title);
                runInAction(() => {
                    this.processedDocuments++;
                    this.scanProgress = Math.round(
                        (this.processedDocuments / this.totalDocuments) * 100
                    );
                });
            }

            // Mark as scanned
            this.markAsScanned(collectionId);

            if (this.convertedDocuments > 0) {
                toast.success(
                    `Đã chuyển đổi ${this.convertedDocuments} tài liệu có notice yaml/markdown`
                );
            }
        } catch (error: any) {
            toast.error("Lỗi khi quét tài liệu: " + error.message);
        } finally {
            runInAction(() => {
                this.isScanning = false;
                this.scanningCollectionId = null;
                this.scanningCollectionName = null;
            });
        }
    };

    /**
     * Flatten nested document tree to array
     */
    private flattenDocumentTree(
        nodes: Array<{ id: string; title: string; children?: any[] }>
    ): Array<{ id: string; title: string }> {
        const result: Array<{ id: string; title: string }> = [];

        const traverse = (
            items: Array<{ id: string; title: string; children?: any[] }>
        ) => {
            for (const item of items) {
                result.push({ id: item.id, title: item.title });
                if (item.children && item.children.length > 0) {
                    traverse(item.children);
                }
            }
        };

        traverse(nodes);
        return result;
    }

    /**
     * Process a single document - fetch, convert notices, and save
     */
    private async processDocument(
        documentId: string,
        title: string
    ): Promise<void> {
        runInAction(() => {
            this.currentDocumentName = title;
        });

        try {
            // Fetch document content - use x-api-version 1 to get markdown text
            const docRes = await client.post("/documents.info", {
                id: documentId,
            }, {
                headers: {
                    "x-api-version": "1",
                },
            });

            const docData = docRes?.data;
            if (!docData?.text) {
                return;
            }

            const originalText = docData.text;
            const convertedText = this.convertAllNoticeBlocks(originalText);

            if (convertedText !== originalText) {
                await client.post("/documents.update", {
                    id: documentId,
                    text: convertedText,
                });

                runInAction(() => {
                    this.convertedDocuments++;
                });
            }
        } catch (_error: unknown) {
            // Continue with other documents even if one fails
        }
    }

    /**
     * Convert ALL :::info notice blocks to plain text.
     * Handles formats produced by FileSplitApi:
     * - Code-fenced content (```yaml, ```json, etc.)
     * - Label-prefixed content (YAML\n..., markdown\n...)
     * - Plain content (no label, no fence)
     */
    convertAllNoticeBlocks(text: string): string {
        const lines = text.split("\n");
        const result: string[] = [];
        let i = 0;

        while (i < lines.length) {
            const trimmed = lines[i].trim();

            // Detect start of an info notice block
            if (trimmed === ":::info") {
                // Collect all lines until the closing :::
                const blockLines: string[] = [];
                i++;
                let closingFound = false;

                while (i < lines.length) {
                    const innerTrimmed = lines[i].trim();
                    if (innerTrimmed === ":::") {
                        closingFound = true;
                        i++;
                        break;
                    }
                    blockLines.push(lines[i]);
                    i++;
                }

                if (!closingFound) {
                    // Malformed block — keep original
                    result.push(":::info");
                    result.push(...blockLines);
                    continue;
                }

                // Extract content from the notice block (remove :::info wrapper)
                const extracted = this.extractNoticeContent(blockLines);
                if (extracted.trim()) {
                    result.push(extracted);
                }
            } else {
                result.push(lines[i]);
                i++;
            }
        }

        return result.join("\n");
    }

    /**
     * Extract content from inside a :::info notice block.
     * Handles all formats produced by FileSplitApi:
     * 1. Code fence with any language: ```yaml\ncontent\n```
     * 2. Label prefix (yaml/markdown/md) followed by content
     * 3. Plain content (no label, no code fence) — just unwrap
     *
     * Post-processing:
     * - Strips full-line **bold** wrapping (artifact from old imports)
     * - Ensures --- has blank line before it (prevents setext heading misinterpretation)
     */
    private extractNoticeContent(blockLines: string[]): string {
        // Find first non-empty line
        const firstNonEmptyIdx = blockLines.findIndex((l) => l.trim().length > 0);
        if (firstNonEmptyIdx < 0) {
            return "";
        }

        const firstLine = blockLines[firstNonEmptyIdx].trim();
        // Strip ** bold wrapping for label detection (e.g., **YAML** → YAML)
        const strippedFirstLine = firstLine.replace(/^\*\*(.+)\*\*$/, "$1").trim();
        const strippedLower = strippedFirstLine.toLowerCase();

        let content = "";

        // Case 1: Line starts with yaml/markdown/md label
        const labelMatch = strippedFirstLine.match(/^(yaml|markdown|md)$/i);
        if (labelMatch) {
            // Collect remaining lines after the label
            for (let j = firstNonEmptyIdx + 1; j < blockLines.length; j++) {
                content += blockLines[j] + "\n";
            }
            // Replace literal \n (backslash + n) with actual newlines
            content = content.replace(/\\n/g, "\n");
        }
        // Case 2: Code fence with any language (e.g., ```yaml, ```json, ```html)
        else if (/^```\w+\s*$/.test(strippedLower)) {
            for (let j = firstNonEmptyIdx + 1; j < blockLines.length; j++) {
                if (blockLines[j].trim() === "```") {
                    break;
                }
                content += blockLines[j] + "\n";
            }
            // Replace literal \n with actual newlines
            content = content.replace(/\\n/g, "\n");
        }
        // Case 3: Plain content (no label, no code fence) — just unwrap
        else {
            content = blockLines.join("\n");
        }

        // Strip full-line **bold** wrapping (artifact from old imports where
        // GetParagraphMarkdown wrapped every line in **)
        content = content.replace(/^\*\*(.+)\*\*$/gm, "$1");

        // Ensure standalone --- lines have a blank line before them
        // to prevent ProseMirror from interpreting them as setext heading underlines
        content = this.ensureThematicBreaks(content);

        return content.trim();
    }

    /**
     * Ensure standalone --- lines have a blank line before them
     * so ProseMirror treats them as thematic breaks (HR), not setext headings.
     */
    private ensureThematicBreaks(text: string): string {
        const lines = text.split("\n");
        const result: string[] = [];
        for (let i = 0; i < lines.length; i++) {
            if (
                lines[i].trim() === "---" &&
                i > 0 &&
                result.length > 0 &&
                result[result.length - 1].trim() !== ""
            ) {
                result.push(""); // blank line before --- prevents setext heading
            }
            result.push(lines[i]);
        }
        return result.join("\n");
    }

    @action
    reset = () => {
        this.isScanning = false;
        this.scanProgress = 0;
        this.currentDocumentName = "";
        this.totalDocuments = 0;
        this.processedDocuments = 0;
        this.convertedDocuments = 0;
        this.scanningCollectionId = null;
        this.scanningCollectionName = null;
    };

    /**
     * Clear the scanned status for a collection (for re-scanning)
     */
    @action
    clearScannedStatus(collectionId: string): void {
        try {
            const scanned = localStorage.getItem(this.scannedCollectionsKey);
            if (scanned) {
                let scannedList = JSON.parse(scanned) as string[];
                scannedList = scannedList.filter((id) => id !== collectionId);
                localStorage.setItem(
                    this.scannedCollectionsKey,
                    JSON.stringify(scannedList)
                );
            }
        } catch {
            // Ignore localStorage errors
        }
    }

    /**
     * Clear all scanned status (for debugging/testing)
     */
    @action
    clearAllScannedStatus(): void {
        try {
            localStorage.removeItem(this.scannedCollectionsKey);
        } catch {
            // Ignore localStorage errors
        }
    }
}

export default ScanNoticesStore;

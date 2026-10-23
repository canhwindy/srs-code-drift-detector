import { observable, action, computed } from "mobx";
import { t } from "i18next";
import { toast } from "sonner";
import type RootStore from "./RootStore";

type DocumentNode = {
  heading: string;
  level: number;
  contentHtml: string | null;
  contentMarkdown: string | null;
  contentDocxBase64: string | null;
  children: DocumentNode[];
  statistics: {
    paragraphCount: number;
    tableCount: number;
    imageCount: number;
    wordCount: number;
  };
};

type HeadingLevelInfo = {
  level: number;
  fontSize: number | null;
  styleName: string | null;
  paragraphCount: number;
  detectionMethod: string;
};

export type DocumentSplitResponse = {
  fileName: string;
  documentTree: DocumentNode[];
  detectedHeadingLevels: HeadingLevelInfo[];
  bodyTextFontSize: number | null;
  statistics: {
    totalNodes: number;
    maxDepth: number;
    totalParagraphs: number;
    totalTables: number;
    totalImages: number;
    processedAt: string;
    processingTimeMs: number;
  };
  warnings: string[];
  success: boolean;
  errorMessage: string | null;
};

export type ImportStep = "upload" | "preview" | "progress" | "scanning";

class ImportSplitStore {
  rootStore: RootStore;

  // Step state
  @observable
  step: ImportStep = "upload";

  // Upload state
  @observable
  uploadedFile: File | null = null;

  @observable
  uploadProgress = 0;

  @observable
  isUploading = false;

  @observable
  isSplitting = false;

  @observable
  splitData: DocumentSplitResponse | null = null;

  // Preview state
  @observable
  collectionName = "";

  @observable
  selectedNodes: Record<string, boolean> = {};

  // Import progress state
  @observable
  importProgress = 0;

  @observable
  currentItem = "";

  @observable
  isImportComplete = false;

  @observable
  isImporting = false;

  @observable
  createdCount = 0;

  @observable
  totalToImport = 0;

  @observable
  createdCollection: any | null = null;

  @observable
  importError: string | null = null;

  // Scan state
  @observable
  isScanComplete = false;

  @observable
  scanError: string | null = null;

  constructor(rootStore: RootStore) {
    this.rootStore = rootStore;
  }

  @computed
  get canProceedToPreview(): boolean {
    return this.uploadedFile !== null && this.splitData !== null;
  }

  @action
  setStep = (step: ImportStep) => {
    this.step = step;
  };

  @action
  setUploadedFile = (file: File | null) => {
    this.uploadedFile = file;
  };

  @action
  setUploadProgress = (progress: number) => {
    this.uploadProgress = progress;
  };

  @action
  setIsUploading = (value: boolean) => {
    this.isUploading = value;
  };

  @action
  setIsSplitting = (value: boolean) => {
    this.isSplitting = value;
  };

  @action
  setSplitData = (data: DocumentSplitResponse | null) => {
    this.splitData = data;
  };

  @action
  setCollectionName = (name: string) => {
    this.collectionName = name;
  };

  @action
  setSelectedNodes = (nodes: Record<string, boolean>) => {
    this.selectedNodes = nodes;
  };

  @action
  startImport = async () => {
    if (!this.splitData) {
      return;
    }
    if (this.isImporting) {
      return;
    }

    this.isImporting = true;
    this.isImportComplete = false;
    this.importError = null;
    this.importProgress = 5;
    this.currentItem = t("Creating collection...");
    this.createdCount = 0;
    this.createdCollection = null;

    const { collections, documents } = this.rootStore;

    try {
      const collection = await collections.create({
        name:
          this.collectionName ||
          this.splitData.fileName.replace(/\.(docx|doc)$/i, ""),
      });

      this.setCreatedCollection(collection);
      this.setImportProgress(15);

      const totalNodes = this.countNodes(this.splitData.documentTree);
      this.setTotalToImport(totalNodes);

      let processedNodes = 0;

      const createDocumentsRecursive = async (
        nodes: DocumentNode[],
        parentId: string | null
      ) => {
        // Reverse iteration order because publish() inserts each document
        // at index 0 (prepend). By creating the last document first,
        // the first document ends up at position 0 after all are created.
        const reversedNodes = [...nodes].reverse();
        for (const node of reversedNodes) {
          this.setCurrentItem(t("Importing: {{name}}", { name: node.heading }));

          try {
            const documentContent = node.contentMarkdown || "";

            // Pre-convert yaml/markdown notice blocks to plain text
            // so the document is created with clean content (no extra revision from scan)
            const { scanNotices } = this.rootStore;
            const cleanContent = scanNotices.convertAllNoticeBlocks(documentContent);

            const doc = await documents.create({
              title: node.heading || "Untitled",
              text: cleanContent,
              collectionId: collection.id,
              parentDocumentId: parentId || undefined,
              publish: true,
            });

            processedNodes++;
            this.setCreatedCount(processedNodes);
            this.setImportProgress(
              Math.round(15 + (processedNodes / totalNodes) * 80)
            );

            await new Promise((resolve) => setTimeout(resolve, 200));

            if (node.children.length > 0) {
              await createDocumentsRecursive(node.children, doc.id);
            }
          } catch {
            // Continue with other documents even if one fails
          }
        }
      };

      await createDocumentsRecursive(this.splitData.documentTree, null);

      this.setImportProgress(100);
      this.setImportComplete(true);
      toast.success(t("Import completed successfully!"));

      // Auto-transition to scanning step
      this.setStep("scanning");
      await this.startScan(collection.id, collection.name);
    } catch (error: any) {
      this.setImportError(
        error.message || t("Failed to import documents")
      );
      toast.error(t("Import failed: {{error}}", { error: error.message }));
      this.setImportComplete(true);
    } finally {
      this.setIsImporting(false);
    }
  };

  @action
  private setCreatedCollection = (collection: any) => {
    this.createdCollection = collection;
  };

  @action
  private setImportProgress = (progress: number) => {
    this.importProgress = progress;
  };

  @action
  private setCurrentItem = (item: string) => {
    this.currentItem = item;
  };

  @action
  private setCreatedCount = (count: number) => {
    this.createdCount = count;
  };

  @action
  private setTotalToImport = (total: number) => {
    this.totalToImport = total;
  };

  @action
  private setImportComplete = (value: boolean) => {
    this.isImportComplete = value;
  };

  @action
  private setIsImporting = (value: boolean) => {
    this.isImporting = value;
  };

  @action
  private setImportError = (error: string | null) => {
    this.importError = error;
  };

  @action
  startScan = async (collectionId: string, collectionName: string) => {
    this.isScanComplete = false;
    this.scanError = null;
    const { scanNotices } = this.rootStore;
    try {
      await scanNotices.scanCollection(collectionId, collectionName);
      this.isScanComplete = true;
    } catch (error: any) {
      this.scanError = error.message || "Scan failed";
      this.isScanComplete = true;
    }
  };

  @action
  reset = () => {
    this.step = "upload";
    this.uploadedFile = null;
    this.uploadProgress = 0;
    this.isUploading = false;
    this.isSplitting = false;
    this.splitData = null;
    this.collectionName = "";
    this.selectedNodes = {};
    this.importProgress = 0;
    this.currentItem = "";
    this.isImportComplete = false;
    this.isImporting = false;
    this.createdCount = 0;
    this.totalToImport = 0;
    this.createdCollection = null;
    this.importError = null;
    this.isScanComplete = false;
    this.scanError = null;
  };

  private countNodes(nodes: DocumentNode[]): number {
    return nodes.reduce(
      (sum, node) => sum + 1 + this.countNodes(node.children),
      0
    );
  }
}

export default ImportSplitStore;

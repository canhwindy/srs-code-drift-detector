import invariant from "invariant";
import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useHistory } from "react-router-dom";
import { toast } from "sonner";
import type { FileWithPath } from "@shared/utils/files";
import useStores from "~/hooks/useStores";
import { documentPath } from "~/utils/routeHelpers";

let importingLock = false;

export default function useImportDocument(
  collectionId?: string | null,
  documentId?: string
): {
  handleFiles: (files: File[] | FileWithPath[]) => Promise<void>;
  isImporting: boolean;
} {
  const { documents } = useStores();
  const [isImporting, setImporting] = useState(false);
  const { t } = useTranslation();
  const history = useHistory();
  const handleFiles = useCallback(
    async (files = []) => {
      if (importingLock) {
        return;
      }

      // Because this is the onChange handler it's possible for the change to be
      // from previously selecting a file to not selecting a file – aka empty
      if (!files.length) {
        return;
      }

      setImporting(true);
      importingLock = true;

      try {
        let cId = collectionId;
        const redirect = files.length === 1 && !("path" in files[0]);

        if (documentId && !collectionId) {
          const document = await documents.fetch(documentId);
          invariant(document, "Document not available");
          cId = document.collectionId;
        }

        // Check if files have path information
        const hasPathInfo = files.length > 0 && "path" in files[0];

        if (hasPathInfo) {
          // Process files with folder hierarchy
          const filesWithPath = files as FileWithPath[];

          // Map to store created folder documents (path -> documentId)
          const folderDocuments = new Map<string, string>();

          // Sort files by path depth to ensure parent folders are created first
          const sortedFiles = [...filesWithPath].sort((a, b) => {
            const depthDiff = a.path.split("/").length - b.path.split("/").length;
            // If same depth, sort alphabetically for consistent ordering
            return depthDiff !== 0 ? depthDiff : a.path.localeCompare(b.path);
          });

          let successCount = 0;
          let errorCount = 0;

          for (const fileWithPath of sortedFiles) {
            try {
              const pathParts = fileWithPath.path.split("/");

              // Build the folder hierarchy
              let currentParentId = documentId;
              for (let i = 0; i < pathParts.length - 1; i++) {
                const folderName = pathParts[i];
                const folderPath = pathParts.slice(0, i + 1).join("/");

                // Check if we've already created this folder
                if (!folderDocuments.has(folderPath)) {
                  // Create a folder document (empty document with the folder name)
                  const folderDoc = await documents.create({
                    title: folderName,
                    text: "",
                    collectionId: cId,
                    parentDocumentId: currentParentId,
                    publish: true,
                  });
                  folderDocuments.set(folderPath, folderDoc.id);
                  currentParentId = folderDoc.id;
                } else {
                  currentParentId = folderDocuments.get(folderPath) || currentParentId;
                }
              }

              // Import the actual file
              const doc = await documents.import(
                fileWithPath.file,
                currentParentId,
                cId,
                { publish: true }
              );

              successCount++;

              if (redirect) {
                history.push(documentPath(doc));
              }
            } catch (err) {
              errorCount++;
              toast.error(`${fileWithPath.path}: ${err.message}`);
            }
          }

          // Show summary for multiple files
          if (filesWithPath.length > 1) {
            if (successCount > 0) {
              toast.success(
                t("Imported {{count}} file(s) successfully", {
                  count: successCount,
                })
              );
            }
            if (errorCount > 0) {
              toast.error(
                t("Failed to import {{count}} file(s)", { count: errorCount })
              );
            }
          }
        } else {
          // Process files without path information (backward compatibility)
          for (const file of files as File[]) {
            try {
              const doc = await documents.import(file, documentId, cId, {
                publish: true,
              });

              if (redirect) {
                history.push(documentPath(doc));
              }
            } catch (err) {
              toast.error(err.message);
            }
          }
        }
      } catch (err) {
        toast.error(`${t("Could not import file")}. ${err.message}`);
      } finally {
        setImporting(false);
        importingLock = false;
      }
    },
    [t, documents, history, collectionId, documentId]
  );

  return {
    handleFiles,
    isImporting,
  };
}

// Re-export types for backward compatibility
export type { TextEdit, DocumentChange, ImplementPreviewData } from "./types";

import * as React from "react";
import CreateDocumentModal from "./CreateDocumentModal";
import DeleteDocumentModal from "./DeleteDocumentModal";
import NoneActionModal from "./NoneActionModal";
import UpdateDocumentModal from "./UpdateDocumentModal";
import type { SelectedDocumentChange } from "./UpdateDocumentModal";
import type { AnalyzeImpactResult, ImplementPreviewData } from "./types";

export interface ImplementConfirmModalProps {
  preview: ImplementPreviewData;
  cardId: string;
  onConfirm: (
    deleteDocumentIds?: string[],
    createDocumentIndexes?: number[],
    updateDocumentChanges?: SelectedDocumentChange[]
  ) => void;
  onCancel: () => void;
  readOnly?: boolean;
  impactAnalysisResult?: AnalyzeImpactResult | null;
  onViewImpact?: () => void;
}

/**
 * Unified entry point cho luồng xác nhận implement.
 * Tự động render đúng modal dựa trên preview.action.
 */
export default function ImplementConfirmModal({
  preview,
  cardId,
  onConfirm,
  onCancel,
  readOnly = false,
  impactAnalysisResult,
  onViewImpact,
}: ImplementConfirmModalProps) {
  if (preview.action === "create_document") {
    return (
      <CreateDocumentModal
        preview={preview}
        onConfirm={(selectedIndexes) => onConfirm(undefined, selectedIndexes)}
        onCancel={onCancel}
        readOnly={readOnly}
        impactAnalysisResult={impactAnalysisResult}
        onViewImpact={onViewImpact}
      />
    );
  }

  if (preview.action === "update_document") {
    return (
      <UpdateDocumentModal
        preview={preview}
        onConfirm={(selectedChanges) =>
          onConfirm(undefined, undefined, selectedChanges)
        }
        onCancel={onCancel}
        readOnly={readOnly}
        impactAnalysisResult={impactAnalysisResult}
        onViewImpact={onViewImpact}
      />
    );
  }

  if (preview.action === "delete_document") {
    return (
      <DeleteDocumentModal
        preview={preview}
        cardId={cardId}
        onConfirm={(selectedIds) => onConfirm(selectedIds)}
        onCancel={onCancel}
        readOnly={readOnly}
        impactAnalysisResult={impactAnalysisResult}
        onViewImpact={onViewImpact}
      />
    );
  }

  return (
    <NoneActionModal
      preview={preview}
      onConfirm={() => onConfirm()}
      onCancel={onCancel}
      readOnly={readOnly}
      impactAnalysisResult={impactAnalysisResult}
      onViewImpact={onViewImpact}
    />
  );
}

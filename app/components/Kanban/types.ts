export type TextEdit = {
  oldString: string;
  newString: string;
  description: string;
};

export type DocumentChange = {
  documentId: string;
  documentTitle: string;
  changesSummary: string[];
  isUserProvided: boolean;
  textEdits?: TextEdit[];
};

export type DocumentToCreate = {
  title: string;
  content: string;
  collectionId: string | null;
};

// ─── New impact analysis types (analyze-impact flow) ─────────────────────────

export type AnalyzeImpactItem = {
  affectedDocumentId?: string | null;
  affectedDocumentTitle: string;
  affectedDocumentUrl?: string | null;
  description: string;
};

export type AnalyzeImpactResult = {
  hasImpacts: boolean;
  impacts: AnalyzeImpactItem[];
};

// ─── Legacy impact types (kept for ImplementPreviewData compatibility) ────────

export type ImpactItem = {
  affectedDocumentId: string | null;
  affectedDocumentTitle: string;
  affectedElement: string;
  impactType: "use_case" | "business_rule" | "actor" | "api" | "data_flow" | "other";
  description: string;
  severity: "high" | "medium" | "low";
};

export type ImpactAnalysisResult = {
  hasImpacts: boolean;
  impacts: ImpactItem[];
  summary: string;
};

// ─── AI Instruction Template types ───────────────────────────────────────────

export type KanbanTemplate = {
  id: string;
  name: string;
  content: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type SystemDefaultTemplate = {
  isSystemDefault: true;
  name: string;
  content: string;
};

export type AnyTemplate = KanbanTemplate | SystemDefaultTemplate;

export type ImplementPreviewData = {
  action: "create_document" | "update_document" | "delete_document" | "none";
  documentsToCreate?: DocumentToCreate[];
  targetDocumentId: string | null;
  collectionId: string | null;
  reasoning: string;
  documentChanges?: DocumentChange[] | null;
  deleteDocumentIds?: string[];
  deleteDocumentTitles?: string[];
  deleteDocumentUrls?: (string | null)[];
};

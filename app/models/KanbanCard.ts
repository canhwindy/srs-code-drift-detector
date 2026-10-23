import { observable } from "mobx";
import type { ImplementPreviewData } from "~/components/Kanban/types";
import ParanoidModel from "./base/ParanoidModel";
import Field from "./decorators/Field";

/**
 * Represents a Kanban card.
 */
export default class KanbanCard extends ParanoidModel {
  static modelName = "KanbanCard";

  /** The title of the card. */
  @Field
  @observable
  title: string;

  /** The description of the card. */
  @Field
  @observable
  description?: string;

  /** The color of the card. */
  @Field
  @observable
  color?: string;

  /** The sort index for the card. */
  @Field
  @observable
  index: string;

  /** The due date for the card. */
  @Field
  @observable
  dueDate?: Date;

  /** The ID of the list this card belongs to. */
  @Field
  @observable
  listId: string;

  /** The ID of the user who created the card. */
  @Field
  @observable
  createdById: string;

  /** The priority of the card. */
  @Field
  @observable
  priority?: string | null;

  /** The priority display label. */
  @Field
  @observable
  priorityLabel?: string | null;

  /** The priority display color. */
  @Field
  @observable
  priorityColor?: string | null;

  /** The members assigned to this card. */
  @Field
  @observable
  members?: Array<{
    id: string;
    name: string;
    avatarUrl: string;
    email: string;
  }>;

  /** The related documents linked to this card. */
  @Field
  @observable
  relatedDocuments?: Array<{
    id: string;
    title: string;
    url: string;
  }>;

  /** AI implement status: idle | running | completed | failed */
  @Field
  @observable
  implementStatus: string;

  /** Error message if implement failed */
  @Field
  @observable
  implementError: string | null;

  /** ID of document created/updated/deleted by AI */
  @Field
  @observable
  implementedDocumentId: string | null;

  /** Timestamp when implement completed successfully */
  @Field
  @observable
  implementedAt: Date | null;

  /** Name of the user who last successfully implemented this card */
  @Field
  @observable
  implementedByName: string | null;

  /** History of all implement attempts */
  @Field
  @observable
  implementHistory: Array<{
    at: string;
    status: "completed" | "failed";
    error?: string;
    documentId?: string;
    documentIds?: string[];
    userId?: string;
    userName?: string;
    preview?: ImplementPreviewData;
  }>;

  /**
   * Frontend-only queue position (1-based). Null khi không trong queue chờ slot.
   * Không có @Field — không sync với server, chỉ là UI state thuần.
   */
  @observable
  queuePosition: number | null = null;

  /** AI-generated preview stored in DB, ready for user confirmation */
  @Field
  @observable
  implementPreview: {
    action: "create_document" | "update_document" | "delete_document" | "none";
    documentsToCreate?: Array<{
      title: string;
      content: string;
      collectionId: string | null;
    }>;
    targetDocumentId: string | null;
    collectionId: string | null;
    reasoning: string;
    documentChanges?: Array<{
      documentId: string;
      documentTitle: string;
      changesSummary: string[];
      isUserProvided: boolean;
      textEdits?: Array<{
        oldString: string;
        newString: string;
        description: string;
      }>;
    }> | null;
    deleteDocumentIds?: string[];
    deleteDocumentTitles?: string[];
    deleteDocumentUrls?: (string | null)[];
  } | null;

  @Field
  @observable
  impactAnalysis: {
    hasImpacts: boolean;
    impacts: Array<{
      affectedDocumentId?: string | null;
      affectedDocumentTitle: string;
      description: string;
    }>;
  } | null;

}

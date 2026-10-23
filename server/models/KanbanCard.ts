import { DataTypes } from "sequelize";
import { Column, Table, BelongsTo, ForeignKey, BelongsToMany } from "sequelize-typescript";
import ParanoidModel from "./base/ParanoidModel";
import User from "./User";
import KanbanList from "./KanbanList";
import Document from "./Document";
import Fix from "./decorators/Fix";

export enum KanbanPriority {
  Blocked = "Blocked",
  Critical = "Critical",
  High = "High",
  Medium = "Medium",
}

export const KANBAN_PRIORITIES = [
  { value: KanbanPriority.Blocked, label: "Blocked", color: "#B91C1C" },
  { value: KanbanPriority.Critical, label: "Critical", color: "#DC2626" },
  { value: KanbanPriority.High, label: "High", color: "#F97316" },
  { value: KanbanPriority.Medium, label: "Medium", color: "#FACC15" },
];

export enum KanbanImplementStatus {
  Idle = "idle",
  Running = "running",
  PreviewReady = "preview_ready",
  Completed = "completed",
  Failed = "failed",
}

@Table({ tableName: "kanban_cards", modelName: "kanban_card" })
@Fix
class KanbanCard extends ParanoidModel<KanbanCard> {
  @Column
  title: string;

  @Column(DataTypes.TEXT)
  description: string | null;

  @Column(DataTypes.STRING)
  index: string;

  @Column(DataTypes.JSONB)
  color: string | null;

  @Column(DataTypes.DATE)
  dueDate: Date | null;

  @Column(DataTypes.STRING)
  priority: string | null;

  @Column(DataTypes.JSONB)
  relatedDocuments: Array<{ id: string; title: string; url: string }> | null;

  // ── Implement tracking fields ──────────────────────────────

  @Column({
    type: DataTypes.STRING(20),
    defaultValue: KanbanImplementStatus.Idle,
  })
  implementStatus: string;

  @Column(DataTypes.TEXT)
  implementError: string | null;

  @ForeignKey(() => Document)
  @Column(DataTypes.UUID)
  implementedDocumentId: string | null;

  @BelongsTo(() => Document, "implementedDocumentId")
  implementedDocument: Document | null;

  @Column(DataTypes.DATE)
  implementedAt: Date | null;

  @ForeignKey(() => User)
  @Column(DataTypes.UUID)
  implementedById: string | null;

  @BelongsTo(() => User, "implementedById")
  implementedBy: User | null;

  @Column(DataTypes.JSONB)
  implementHistory: Array<{
    at: string;
    status: "completed" | "failed";
    error?: string;
    documentId?: string;
    documentIds?: string[];
    userId?: string;
    userName?: string;
    preview?: {
      action: "create_document" | "update_document" | "delete_document" | "none";
      documentsToCreate?: Array<{ title: string; content: string; collectionId: string | null }>;
      targetDocumentId: string | null;
      collectionId: string | null;
      reasoning: string;
      documentChanges?: Array<{
        documentId: string;
        documentTitle: string;
        changesSummary: string[];
        isUserProvided: boolean;
        textEdits?: Array<{ oldString: string; newString: string; description: string }>;
      }> | null;
      deleteDocumentIds?: string[];
      deleteDocumentTitles?: string[];
      deleteDocumentUrls?: (string | null)[];
    };
  }>;

  @Column(DataTypes.JSONB)
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
  } | null;

  @Column(DataTypes.JSONB)
  impactAnalysis: {
    hasImpacts: boolean;
    impacts: Array<{
      affectedDocumentId?: string | null;
      affectedDocumentTitle: string;
      description: string;
    }>;
  } | null;

  // associations

  @BelongsTo(() => KanbanList, "listId")
  list: KanbanList;

  @ForeignKey(() => KanbanList)
  @Column(DataTypes.UUID)
  listId: string;

  @BelongsTo(() => User, "createdById")
  createdBy: User;

  @ForeignKey(() => User)
  @Column(DataTypes.UUID)
  createdById: string;

  @BelongsToMany(() => User, () => require("./KanbanCardMember").default)
  members: User[];
}

export default KanbanCard;

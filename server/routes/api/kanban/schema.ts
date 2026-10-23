import { z } from "zod";
import { zodIdType } from "@server/utils/zod";
import { ValidateIndex } from "@server/validation";
import { BaseSchema } from "../schema";
import { KanbanPriority } from "@server/models/KanbanCard";

const BaseIdSchema = z.object({
  /** Id of the entity */
  id: zodIdType(),
});

// Board schemas

export const KanbanBoardsCreateSchema = BaseSchema.extend({
  body: z.object({
    name: z.string().min(1).max(255),
    description: z.string().optional(),
    color: z.string().optional(),
  }),
});

export type KanbanBoardsCreateReq = z.infer<typeof KanbanBoardsCreateSchema>;

export const KanbanBoardsInfoSchema = BaseSchema.extend({
  body: BaseIdSchema,
});

export type KanbanBoardsInfoReq = z.infer<typeof KanbanBoardsInfoSchema>;

export const KanbanBoardsUpdateSchema = BaseSchema.extend({
  body: BaseIdSchema.extend({
    name: z.string().min(1).max(255).optional(),
    description: z.string().optional(),
    color: z.string().optional(),
    index: z
      .string()
      .regex(ValidateIndex.regex, { message: ValidateIndex.message })
      .optional(),
  }),
});

export type KanbanBoardsUpdateReq = z.infer<typeof KanbanBoardsUpdateSchema>;

export const KanbanBoardsDeleteSchema = BaseSchema.extend({
  body: BaseIdSchema,
});

export type KanbanBoardsDeleteReq = z.infer<typeof KanbanBoardsDeleteSchema>;

// List schemas

export const KanbanListsCreateSchema = BaseSchema.extend({
  body: z.object({
    boardId: zodIdType(),
    name: z.string().min(1).max(255),
    index: z
      .string()
      .regex(ValidateIndex.regex, { message: ValidateIndex.message })
      .optional(),
  }),
});

export type KanbanListsCreateReq = z.infer<typeof KanbanListsCreateSchema>;

export const KanbanListsUpdateSchema = BaseSchema.extend({
  body: BaseIdSchema.extend({
    name: z.string().min(1).max(255).optional(),
    index: z
      .string()
      .regex(ValidateIndex.regex, { message: ValidateIndex.message })
      .optional(),
  }),
});

export type KanbanListsUpdateReq = z.infer<typeof KanbanListsUpdateSchema>;

export const KanbanListsDeleteSchema = BaseSchema.extend({
  body: BaseIdSchema,
});

export type KanbanListsDeleteReq = z.infer<typeof KanbanListsDeleteSchema>;

// Card schemas

export const KanbanCardsCreateSchema = BaseSchema.extend({
  body: z.object({
    listId: zodIdType(),
    title: z.string().min(1).max(255),
    description: z.string().optional(),
    color: z.string().optional(),
    dueDate: z.coerce.date().optional().nullable(),
    priority: z.nativeEnum(KanbanPriority).optional().nullable(),
    index: z
      .string()
      .regex(ValidateIndex.regex, { message: ValidateIndex.message })
      .optional(),
  }),
});

export type KanbanCardsCreateReq = z.infer<typeof KanbanCardsCreateSchema>;

export const KanbanCardsUpdateSchema = BaseSchema.extend({
  body: BaseIdSchema.extend({
    title: z.string().min(1).max(255).optional(),
    description: z.string().optional().nullable(),
    color: z.string().optional().nullable(),
    dueDate: z.coerce.date().optional().nullable(),
    priority: z.nativeEnum(KanbanPriority).optional().nullable(),
    listId: zodIdType().optional(),
    index: z
      .string()
      .regex(ValidateIndex.regex, { message: ValidateIndex.message })
      .optional(),
  }),
});

export type KanbanCardsUpdateReq = z.infer<typeof KanbanCardsUpdateSchema>;

export const KanbanCardsDeleteSchema = BaseSchema.extend({
  body: BaseIdSchema,
});

export type KanbanCardsDeleteReq = z.infer<typeof KanbanCardsDeleteSchema>;

// Card Member assignment

export const KanbanCardsAddMemberSchema = BaseSchema.extend({
  body: z.object({
    cardId: zodIdType(),
    userId: zodIdType(),
  }),
});

export type KanbanCardsAddMemberReq = z.infer<typeof KanbanCardsAddMemberSchema>;

export const KanbanCardsRemoveMemberSchema = BaseSchema.extend({
  body: z.object({
    cardId: zodIdType(),
    userId: zodIdType(),
  }),
});

export type KanbanCardsRemoveMemberReq = z.infer<typeof KanbanCardsRemoveMemberSchema>;

// Card Related Documents

export const KanbanCardsAddRelatedDocumentSchema = BaseSchema.extend({
  body: z.object({
    cardId: zodIdType(),
    documentId: zodIdType(),
  }),
});

export type KanbanCardsAddRelatedDocumentReq = z.infer<typeof KanbanCardsAddRelatedDocumentSchema>;

export const KanbanCardsRemoveRelatedDocumentSchema = BaseSchema.extend({
  body: z.object({
    cardId: zodIdType(),
    documentId: zodIdType(),
  }),
});

export type KanbanCardsRemoveRelatedDocumentReq = z.infer<typeof KanbanCardsRemoveRelatedDocumentSchema>;

// Card info schema

export const KanbanCardsInfoSchema = BaseSchema.extend({
  body: BaseIdSchema,
});

export type KanbanCardsInfoReq = z.infer<typeof KanbanCardsInfoSchema>;

// Card activities schema

export const KanbanCardsActivitiesSchema = BaseSchema.extend({
  body: z.object({
    cardId: zodIdType(),
  }),
});

export type KanbanCardsActivitiesReq = z.infer<typeof KanbanCardsActivitiesSchema>;

// Card comment schemas

export const KanbanCardsAddCommentSchema = BaseSchema.extend({
  body: z.object({
    cardId: zodIdType(),
    comment: z.string().min(1).max(10000),
    parentId: zodIdType().optional().nullable(),
    attachmentIds: z.array(zodIdType()).optional(),
  }),
});

export type KanbanCardsAddCommentReq = z.infer<typeof KanbanCardsAddCommentSchema>;

export const KanbanCardsDeleteCommentSchema = BaseSchema.extend({
  body: z.object({
    commentId: zodIdType(),
  }),
});

export type KanbanCardsDeleteCommentReq = z.infer<typeof KanbanCardsDeleteCommentSchema>;

// Checklist schemas

export const KanbanChecklistsListSchema = BaseSchema.extend({
  body: z.object({
    cardId: zodIdType(),
  }),
});

export type KanbanChecklistsListReq = z.infer<typeof KanbanChecklistsListSchema>;

export const KanbanChecklistsCreateSchema = BaseSchema.extend({
  body: z.object({
    cardId: zodIdType(),
    title: z.string().min(1).max(255),
  }),
});

export type KanbanChecklistsCreateReq = z.infer<typeof KanbanChecklistsCreateSchema>;

export const KanbanChecklistsUpdateSchema = BaseSchema.extend({
  body: BaseIdSchema.extend({
    title: z.string().min(1).max(255).optional(),
  }),
});

export type KanbanChecklistsUpdateReq = z.infer<typeof KanbanChecklistsUpdateSchema>;

export const KanbanChecklistsDeleteSchema = BaseSchema.extend({
  body: BaseIdSchema,
});

export type KanbanChecklistsDeleteReq = z.infer<typeof KanbanChecklistsDeleteSchema>;

// Checklist item schemas

export const KanbanChecklistItemsCreateSchema = BaseSchema.extend({
  body: z.object({
    checklistId: zodIdType(),
    title: z.string().min(1).max(255),
  }),
});

export type KanbanChecklistItemsCreateReq = z.infer<typeof KanbanChecklistItemsCreateSchema>;

export const KanbanChecklistItemsUpdateSchema = BaseSchema.extend({
  body: BaseIdSchema.extend({
    title: z.string().min(1).max(255).optional(),
    isCompleted: z.boolean().optional(),
  }),
});

export type KanbanChecklistItemsUpdateReq = z.infer<typeof KanbanChecklistItemsUpdateSchema>;

export const KanbanChecklistItemsDeleteSchema = BaseSchema.extend({
  body: BaseIdSchema,
});

export type KanbanChecklistItemsDeleteReq = z.infer<typeof KanbanChecklistItemsDeleteSchema>;

// User search for mentions

export const KanbanUsersSearchMentionableSchema = BaseSchema.extend({
  body: z.object({
    query: z.string().max(255).optional(),
    limit: z.number().int().min(1).max(50).optional(),
  }),
});

export type KanbanUsersSearchMentionableReq = z.infer<typeof KanbanUsersSearchMentionableSchema>;

export const KanbanCardsAnalyzeImpactSchema = BaseSchema.extend({
  body: z.object({
    id: z.string().uuid(),
  }),
});

export type KanbanCardsAnalyzeImpactReq = z.infer<typeof KanbanCardsAnalyzeImpactSchema>;

export const KanbanCardsClearImpactAnalysisSchema = BaseSchema.extend({
  body: z.object({
    id: z.string().uuid(),
  }),
});

export type KanbanCardsClearImpactAnalysisReq = z.infer<typeof KanbanCardsClearImpactAnalysisSchema>;

export const KanbanCardsUpdateImpactAnalysisSchema = BaseSchema.extend({
  body: z.object({
    id: z.string().uuid(),
    impacts: z.array(
      z.object({
        affectedDocumentId: z.string().uuid().nullable().optional(),
        affectedDocumentTitle: z.string().min(1),
        affectedDocumentUrl: z.string().nullable().optional(),
        description: z.string().min(1),
      })
    ),
  }),
});

export type KanbanCardsUpdateImpactAnalysisReq = z.infer<
  typeof KanbanCardsUpdateImpactAnalysisSchema
>;

export const KanbanCardsImplementSchema = BaseSchema.extend({
  body: z.object({
    id: z.string().uuid(),
  }),
});

export type KanbanCardsImplementReq = z.infer<typeof KanbanCardsImplementSchema>;

export const KanbanCardsImplementConfirmSchema = BaseSchema.extend({
  body: z.object({
    id: z.string().uuid(),
    deleteDocumentIds: z.array(z.string().uuid()).optional(),
    createDocumentIndexes: z.array(z.number().int().nonnegative()).optional(),
    updateDocumentChanges: z.array(z.object({
      documentId: z.string().uuid(),
      selectedEditIndices: z.array(z.number().int().nonnegative()),
    })).optional(),
  }),
});

export type KanbanCardsImplementConfirmReq = z.infer<
  typeof KanbanCardsImplementConfirmSchema
>;

export const KanbanCardsImplementCancelSchema = BaseSchema.extend({
  body: z.object({
    id: z.string().uuid(),
  }),
});

export type KanbanCardsImplementCancelReq = z.infer<
  typeof KanbanCardsImplementCancelSchema
>;

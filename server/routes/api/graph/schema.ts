import { z } from "zod";
import { BaseSchema } from "../schema";

// ── Query Routes ──────────────────────────────────────────────────────────────

export const GraphDataListSchema = BaseSchema.extend({
  body: z.object({
    label: z.string().optional().default("*"),
    max_depth: z.number().int().min(1).max(10).optional().default(3),
    max_nodes: z.number().int().min(1).max(5000).optional().default(1000),
  }),
});
export type GraphDataListReq = z.infer<typeof GraphDataListSchema>;

export const GraphLabelsPopularSchema = BaseSchema.extend({
  body: z.object({
    limit: z.number().int().min(1).max(500).optional().default(50),
  }),
});
export type GraphLabelsPopularReq = z.infer<typeof GraphLabelsPopularSchema>;

export const GraphLabelsSearchSchema = BaseSchema.extend({
  body: z.object({
    q: z.string().optional().default(""),
    limit: z.number().int().min(1).max(200).optional().default(50),
  }),
});
export type GraphLabelsSearchReq = z.infer<typeof GraphLabelsSearchSchema>;

export const GraphDataNxSchema = BaseSchema.extend({
  body: z.object({
    label: z.string().optional().default("*"),
    max_depth: z.number().int().min(1).max(10).optional().default(3),
    max_nodes: z.number().int().min(1).max(2000).optional().default(500),
  }),
});
export type GraphDataNxReq = z.infer<typeof GraphDataNxSchema>;

export const GraphEntitiesDetailsSchema = BaseSchema.extend({
  body: z.object({
    label: z.string().min(1, "label is required"),
  }),
});
export type GraphEntitiesDetailsReq = z.infer<typeof GraphEntitiesDetailsSchema>;

export const GraphEntitiesListSchema = BaseSchema.extend({
  body: z.object({}),
});
export type GraphEntitiesListReq = z.infer<typeof GraphEntitiesListSchema>;

// ── Mutation Routes ───────────────────────────────────────────────────────────

export const GraphEntitiesMergeSchema = BaseSchema.extend({
  body: z.object({
    entities_to_change: z.array(z.string()).min(1),
    entity_to_change_into: z.string().min(1),
  }),
});
export type GraphEntitiesMergeReq = z.infer<typeof GraphEntitiesMergeSchema>;

export const GraphDedupStartSchema = BaseSchema.extend({
  body: z.object({
    threshold: z.number().min(0).max(1).optional().default(0.9),
    apply_merge: z.boolean().optional().default(false),
  }),
});
export type GraphDedupStartReq = z.infer<typeof GraphDedupStartSchema>;

export const GraphDedupStatusSchema = BaseSchema.extend({
  body: z.object({}),
});
export type GraphDedupStatusReq = z.infer<typeof GraphDedupStatusSchema>;

export const GraphDedupCancelSchema = BaseSchema.extend({
  body: z.object({}),
});
export type GraphDedupCancelReq = z.infer<typeof GraphDedupCancelSchema>;

// ── Document Routes ───────────────────────────────────────────────────────────

export const GraphDocumentsScanSchema = BaseSchema.extend({
  body: z.object({}),
});
export type GraphDocumentsScanReq = z.infer<typeof GraphDocumentsScanSchema>;

export const GraphDocumentsDeleteSchema = BaseSchema.extend({
  body: z.object({
    doc_ids: z.array(z.string()).min(1),
    delete_file: z.boolean().optional().default(true),
  }),
});
export type GraphDocumentsDeleteReq = z.infer<typeof GraphDocumentsDeleteSchema>;

export const GraphDocumentsClearSchema = BaseSchema.extend({
  body: z.object({}),
});
export type GraphDocumentsClearReq = z.infer<typeof GraphDocumentsClearSchema>;

export const GraphPipelineStatusSchema = BaseSchema.extend({
  body: z.object({}),
});
export type GraphPipelineStatusReq = z.infer<typeof GraphPipelineStatusSchema>;

export const GraphDocumentsUploadSchema = BaseSchema.extend({
  body: z.object({}),
});
export type GraphDocumentsUploadReq = z.infer<typeof GraphDocumentsUploadSchema>;

export const GraphDocumentsListSchema = BaseSchema.extend({
  body: z.object({
    status: z.string().optional(),
    search: z.string().optional(),
    page: z.number().int().min(1).optional().default(1),
    page_size: z.number().int().min(1).max(10000).optional().default(20),
    sort_field: z.string().optional().default("updated_at"),
    sort_direction: z.enum(["asc", "desc"]).optional().default("desc"),
  }),
});
export type GraphDocumentsListReq = z.infer<typeof GraphDocumentsListSchema>;

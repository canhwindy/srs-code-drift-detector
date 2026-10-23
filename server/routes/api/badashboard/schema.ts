import { z } from "zod";
import { zodIdType } from "@server/utils/zod";
import { ValidateIndex } from "@server/validation";
import { BaseSchema } from "../schema";

const BaseIdSchema = z.object({
    /** Id of the entity */
    id: zodIdType(),
});

// Dashboard schemas

export const BADashboardListSchema = BaseSchema.extend({
    body: z.object({
        type: z.string().optional(),
        limit: z.number().optional(),
        offset: z.number().optional(),
    }),
});

export type BADashboardListReq = z.infer<typeof BADashboardListSchema>;

export const BADashboardInfoSchema = BaseSchema.extend({
    body: BaseIdSchema,
});

export type BADashboardInfoReq = z.infer<typeof BADashboardInfoSchema>;

export const BADashboardCreateSchema = BaseSchema.extend({
    body: z.object({
        title: z.string().min(1).max(255),
        description: z.string().optional(),
        type: z.string().min(1).max(50),
        config: z.record(z.unknown()).optional(),
        dataSource: z.string().optional(),
    }),
});

export type BADashboardCreateReq = z.infer<typeof BADashboardCreateSchema>;

export const BADashboardUpdateSchema = BaseSchema.extend({
    body: BaseIdSchema.extend({
        title: z.string().min(1).max(255).optional(),
        description: z.string().optional(),
        type: z.string().min(1).max(50).optional(),
        config: z.record(z.unknown()).optional(),
        dataSource: z.string().optional(),
        index: z
            .string()
            .regex(ValidateIndex.regex, { message: ValidateIndex.message })
            .optional(),
    }),
});

export type BADashboardUpdateReq = z.infer<typeof BADashboardUpdateSchema>;

export const BADashboardDeleteSchema = BaseSchema.extend({
    body: BaseIdSchema,
});

export type BADashboardDeleteReq = z.infer<typeof BADashboardDeleteSchema>;

// Analytics schemas

export const BADashboardAnalyticsSchema = BaseSchema.extend({
    body: z.object({
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        metrics: z.array(z.string()).optional(),
        groupBy: z.string().optional(),
    }),
});

export type BADashboardAnalyticsReq = z.infer<typeof BADashboardAnalyticsSchema>;

// Chart data schema

export const BADashboardChartDataSchema = BaseSchema.extend({
    body: z.object({
        chartId: z.string().min(1),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        filters: z.record(z.unknown()).optional(),
    }),
});

export type BADashboardChartDataReq = z.infer<typeof BADashboardChartDataSchema>;

export const BADashboardAgentProposalsSchema = BaseSchema.extend({
    body: z.object({
        gapFindingId: zodIdType(),
    }),
});
export type AgentProposalsReq = z.infer<typeof BADashboardAgentProposalsSchema>;

export const BADashboardRecordActivitySchema = BaseSchema.extend({
    body: z.object({
        action: z.enum(["ChangeCode", "ChangeSRS", "Reject Proposal From Agent"]),
        gapFindingId: z.string().min(1),
        documentId: z.string().nullable().optional(),
        agentProposalId: z.string().nullable().optional(),
    }),
});
export type RecordActivityReq = z.infer<typeof BADashboardRecordActivitySchema>;

export const BADashboardListActivitiesSchema = BaseSchema.extend({
    body: z.object({
        gapFindingId: z.string().optional(),
    }),
});
export type ListActivitiesReq = z.infer<typeof BADashboardListActivitiesSchema>;

export const BADashboardUpdateGapFindingStatusSchema = BaseSchema.extend({
    body: z.object({
        gapFindingId: z.string().min(1),
        status: z.enum(["approved", "rejected", "pending"]),
    }),
});
export type UpdateGapFindingStatusReq = z.infer<typeof BADashboardUpdateGapFindingStatusSchema>;

export const BADashboardUpdateAgentProposalStatusSchema = BaseSchema.extend({
    body: z.object({
        agentProposalId: z.string().min(1),
        status: z.enum(["approved", "rejected", "pending"]),
    }),
});
export type UpdateAgentProposalStatusReq = z.infer<typeof BADashboardUpdateAgentProposalStatusSchema>;

export const BADashboardUpdateTestResultActionSchema = BaseSchema.extend({
    body: z.object({
        testResultId: z.string().min(1),
        suggestedAction: z.enum(["change_code", "change_srs"]).nullable(),
    }),
});
export type UpdateTestResultActionReq = z.infer<typeof BADashboardUpdateTestResultActionSchema>;

export const BADashboardTestResultsSchema = BaseSchema.extend({
    body: z.object({
        gapFindingId: zodIdType(),
    }),
});
export type TestResultsReq = z.infer<typeof BADashboardTestResultsSchema>;

const TestResultItemSchema = z.object({
    id: z.string(),
    gapFindingId: z.string(),
    title: z.string(),
    description: z.string(),
    code_to_srs: z.enum(["mismatch", "match", "missing", "surplus"]),
});

export const BADashboardSrsChangeSuggestionSchema = BaseSchema.extend({
    body: z.object({
        gapFindingId: z.string().min(1),
        testResults: z.array(TestResultItemSchema),
        useCaseName: z.string(),
        userInstruction: z.string().optional(),
    }),
});
export type SrsChangeSuggestionReq = z.infer<typeof BADashboardSrsChangeSuggestionSchema>;

export const BADashboardSrsRefineSuggestionSchema = BaseSchema.extend({
    body: z.object({
        gapFindingId: z.string().min(1),
        previousProposalId: z.string().min(1),
        userInstruction: z.string().min(1),
        useCaseName: z.string(),
    }),
});
export type SrsRefineSuggestionReq = z.infer<typeof BADashboardSrsRefineSuggestionSchema>;

export const BADashboardSaveInstructionSchema = BaseSchema.extend({
    body: z.object({
        instruction: z.string(),
    }),
});
export type SaveInstructionReq = z.infer<typeof BADashboardSaveInstructionSchema>;

export const BADashboardGetInstructionSchema = BaseSchema.extend({
    body: z.object({}),
});
export type GetInstructionReq = z.infer<typeof BADashboardGetInstructionSchema>;

export const BADashboardImportPipelineResultSchema = BaseSchema.extend({
    body: z.object({
        pr_id: z.number(),
        repo: z.string(),
        repo_type: z.string(),
        pr_title: z.string(),
        verdict_summary: z.object({
            total: z.number(),
            matching: z.number(),
            mismatch: z.number(),
            missing: z.number(),
        }),
        surplus_count: z.number().optional().default(0),
        error_summary: z.string(),
        llm_cost_usd: z.number().optional().default(0),
        run_at: z.string(),
        test_verdicts: z.array(z.object({
            name: z.string().max(255),
            tag: z.enum(["matching", "mismatch", "missing"]),
            requirement_id: z.string().max(100),
            requirement_description: z.string(),
            srs_section: z.string().max(100),
            error_message: z.string(),
            assertion_logic: z.string(),
            tag_reason: z.string().optional().default(""),
            duration_ms: z.number().optional().default(0),
            test_code: z.string().optional().default(""),
            // EAS row fields — cho phép hiển thị cột có cấu trúc trên FE
            step: z.number().optional(),
            srs: z.object({
                actor: z.string().optional(),
                event: z.string().optional(),
                action: z.string().optional(),
                state: z.string().optional(),
                guard_br: z.string().optional(),
            }).optional(),
            code: z.object({
                actor: z.string().optional(),
                event: z.string().optional(),
                action: z.string().optional(),
                state: z.string().optional(),
                guard: z.string().optional(),
            }).optional(),
            srs_references: z.array(z.object({
                quote: z.string().optional(),
                file_path: z.string().optional(),
            })).optional(),
            code_references: z.array(z.object({
                file_path: z.string().optional(),
                line: z.number().optional(),
                snippet: z.string().optional(),
                repo: z.string().optional(),
                url: z.string().optional(),
            })).optional(),
        })),
        surplus_items: z.array(z.object({
            id: z.string(),
            title: z.string().max(255),
            reason: z.string(),
            confidence: z.string(),
            actor: z.string().optional().nullable(),
            event: z.string().optional().nullable(),
            action: z.string().optional().nullable(),
            code_references: z.array(z.object({
                file_path: z.string().optional(),
                line: z.number().optional(),
                snippet: z.string().optional(),
                repo: z.string().optional(),
                url: z.string().optional(),
            })).optional().default([]),
        })).optional().default([]),
    }),
});
export type ImportPipelineResultReq = z.infer<typeof BADashboardImportPipelineResultSchema>;

// Claude CLI output schema
const ClaudeGapSchema = z.object({
    // Format cũ (business_gaps/frontend_gaps/backend_gaps)
    name: z.string().optional(),
    title: z.string().optional(),
    tag: z.enum(["matching", "mismatch", "missing"]).optional(),
    requirement_id: z.string().optional(),
    requirement_description: z.string().optional(),
    description: z.string().optional(),
    srs_section: z.string().optional(),
    error_message: z.string().optional(),
    tag_reason: z.string().optional(),
    assertion_logic: z.string().optional(),
    test_code: z.string().optional(),
    duration_ms: z.number().optional(),
    // Format mới (gap_rows từ EAS Drift Report)
    step: z.number().optional(),
    drift_label: z.string().optional(),
    drift_detail: z.string().optional(),
    srs: z.object({
        actor: z.string().optional(),
        event: z.string().optional(),
        action: z.string().optional(),
        state: z.string().optional(),
        guard_br: z.string().optional(),
    }).optional(),
    code: z.object({
        actor: z.string().optional(),
        event: z.string().optional(),
        action: z.string().optional(),
        state: z.string().optional(),
        guard: z.string().optional(),
    }).optional(),
    srs_references: z.array(z.object({ quote: z.string().optional(), file_path: z.string().optional() })).optional(),
    code_references: z.array(z.object({
        file_path: z.string().optional(),
        line: z.number().optional(),
        snippet: z.string().optional(),
        repo: z.string().optional(),
        url: z.string().optional(),
    })).optional(),
});

const ClaudeSurplusSchema = z.object({
    id: z.string().optional(),
    title: z.string().optional(),
    reason: z.string().optional(),
    confidence: z.string().optional(),
    // Format mới
    actor: z.string().optional(),
    event: z.string().optional(),
    action: z.string().optional(),
    state: z.string().optional(),
    guard: z.string().optional(),
    code_references: z.array(z.object({
        file_path: z.string().optional(),
        line: z.number().optional(),
        snippet: z.string().optional(),
        repo: z.string().optional(),
        url: z.string().optional(),
    })).optional(),
});

export const ClaudeOutputSchema = z.object({
    // Format mới
    uc_id: z.string().optional(),
    uc_name: z.string().optional(),
    gap_rows: z.array(ClaudeGapSchema).optional(),
    business_rules: z.array(z.any()).optional(),
    // Format cũ (backward compatible)
    business_gaps: z.array(ClaudeGapSchema).optional().default([]),
    frontend_gaps: z.array(ClaudeGapSchema).optional().default([]),
    backend_gaps: z.array(ClaudeGapSchema).optional().default([]),
    // Chung
    repo_type: z.string().optional(),
    error_summary: z.string().optional(),
    surplus_items: z.array(ClaudeSurplusSchema).optional().default([]),
    raw_output: z.string().optional(),
});

export type ClaudeOutputType = z.infer<typeof ClaudeOutputSchema>;

import Router from "koa-router";
import auth from "@server/middlewares/authentication";
import validate from "@server/middlewares/validate";
import { transaction } from "@server/middlewares/transaction";
import type { APIContext } from "@server/types";
// import externalApiService from "@server/services/externalApiService";
import { ApprovalActivity, User, UserSrsInstruction, GapFinding, TestResult, AgentProposal, LightragDocFull } from "@server/models";
import Document from "@server/models/Document";
import GithubConfig from "@server/models/GithubConfig";
import pagination from "../middlewares/pagination";
import * as T from "./schema";
import fetch from "@server/utils/fetch";
import env from "@server/env";
import Logger from "@server/logging/Logger";
import { appendSrsLog } from "@server/utils/srsLogger";
import { literal } from "sequelize";

/**
 * Resolve teamId from a repo string ("owner/repo-name") by looking up GithubConfig.
 * Each team configures different repos, so repo → teamId is unambiguous.
 */
async function resolveTeamIdFromRepo(repo: string): Promise<string | null> {
    const parts = repo.split("/");
    if (parts.length < 2) { return null; }
    const [owner, repoName] = parts;
    const config = await GithubConfig.findOne({
        where: literal(`repositories @> :json::jsonb`),
        replacements: { json: JSON.stringify([{ owner, repo: repoName }]) },
    } as any);
    return config?.teamId ?? null;
}

const router = new Router();

/**
 * @api {post} /badashboard.pendingApprovals List all pending approval items
 * @apiName ListPendingApprovals
 * @apiGroup BADashboard
 * @apiDescription Fetches pending approval items from database
 */
router.post(
    "badashboard.pendingApprovals",
    auth(),
    pagination(),
    validate(T.BADashboardListSchema),
    async (ctx: APIContext<T.BADashboardListReq>) => {
        const { user } = ctx.state.auth;

        const gapFindings = await GapFinding.findAll({
            where: { teamId: user.teamId },
            include: [
                {
                    model: Document,
                    as: "document",
                    attributes: ["id", "urlId", "title"],
                    required: false,
                },
            ],
            order: [["created_at", "DESC"]],
        });

        const items = gapFindings.map((item) => ({
            id: item.id,
            documentId: item.documentId || "",
            title: item.title,
            pullRequestId: item.pullRequestId || "",
            description: item.description || "",
            severity: item.severity || "Low",
            status: item.status || "pending",
            createdAt: item.createdAt,
            updatedAt: item.updatedAt,
            document: item.document
                ? {
                    id: item.document.id,
                    urlId: (item.document as any).urlId || "",
                    name: item.document.title || "",
                }
                : null,
        }));

        ctx.body = {
            pagination: ctx.state.pagination,
            data: items,
        };
    }
);

/**
 * @api {post} /badashboard.info Get dashboard item details
 * @apiName GetDashboard
 * @apiGroup BADashboard
 */
router.post(
    "badashboard.info",
    auth(),
    validate(T.BADashboardInfoSchema),
    async (ctx: APIContext<T.BADashboardInfoReq>) => {
        const { id } = ctx.input.body;
        const { user } = ctx.state.auth;

        // // Fetch data from external API
        // const data = await externalApiService.getDashboardInfo({
        //     id,
        //     teamId: user.teamId,
        //     userId: user.id,
        // });
        // ctx.body = { data };

        const data = await GapFinding.findOne({
            where: { id, teamId: user.teamId },
            include: [{ model: Document, as: "document", required: false }],
        });

        if (!data) {
            ctx.throw(404, "Not found");
        }

        ctx.body = { data };
    }
);

/**
 * @api {post} /badashboard.create Create a new dashboard item
 * @apiName CreateDashboard
 * @apiGroup BADashboard
 */
router.post(
    "badashboard.create",
    auth(),
    validate(T.BADashboardCreateSchema),
    async (ctx: APIContext<T.BADashboardCreateReq>) => {
        const { title, description } = ctx.input.body;
        const { user } = ctx.state.auth;

        // // Create via external API
        // const data = await externalApiService.createDashboard({
        //     title, description, type, config, dataSource,
        //     teamId: user.teamId, createdById: user.id,
        // });
        // ctx.body = { data };

        const data = await GapFinding.create({ title, description, teamId: user.teamId } as any);
        ctx.body = { data };
    }
);

/**
 * @api {post} /badashboard.update Update a dashboard item
 * @apiName UpdateDashboard
 * @apiGroup BADashboard
 */
router.post(
    "badashboard.update",
    auth(),
    validate(T.BADashboardUpdateSchema),
    async (ctx: APIContext<T.BADashboardUpdateReq>) => {
        const { id, title, description } = ctx.input.body;
        const { user } = ctx.state.auth;

        // // Update via external API
        // const data = await externalApiService.updateDashboard({
        //     id, title, description, type, config, dataSource, index,
        //     teamId: user.teamId, userId: user.id,
        // });
        // ctx.body = { data };

        await GapFinding.update({ title, description } as any, { where: { id, teamId: user.teamId } });
        const data = await GapFinding.findOne({ where: { id, teamId: user.teamId } });
        ctx.body = { data };
    }
);

/**
 * @api {post} /badashboard.delete Delete a dashboard item
 * @apiName DeleteDashboard
 * @apiGroup BADashboard
 */
router.post(
    "badashboard.delete",
    auth(),
    validate(T.BADashboardDeleteSchema),
    async (ctx: APIContext<T.BADashboardDeleteReq>) => {
        const { id } = ctx.input.body;
        const { user } = ctx.state.auth;

        // // Delete via external API
        // await externalApiService.deleteDashboard({
        //     id, teamId: user.teamId, userId: user.id,
        // });

        await GapFinding.destroy({ where: { id, teamId: user.teamId } });
        ctx.body = { success: true };
    }
);

/**
 * @api {post} /badashboard.agentProposals List agent proposals for a gap finding
 * @apiName ListAgentProposals
 * @apiGroup BADashboard
 */
router.post(
    "badashboard.agentProposals",
    auth(),
    validate(T.BADashboardAgentProposalsSchema),
    async (ctx: APIContext<T.AgentProposalsReq>) => {
        const { gapFindingId } = ctx.input.body;
        const { user } = ctx.state.auth;

        // // Fetch proposals from external API
        // const data = await externalApiService.getAgentProposals(gapFindingId);
        // ctx.body = { data };

        const gfOwner = await GapFinding.findOne({ where: { id: gapFindingId, teamId: user.teamId } });
        if (!gfOwner) {
            ctx.throw(404, "Gap finding not found");
        }

        const proposals = await AgentProposal.findAll({
            where: { gapFindingId },
            order: [["created_at", "DESC"]],
        });

        const data = proposals.map((p) => ({
            id: p.id,
            proposalType: p.proposalType || "",
            summary: p.summary || "",
            evaluation: p.evaluation ?? null,
            status: p.status,
            createdAt: p.createdAt,
            updatedAt: p.updatedAt,
        }));

        ctx.body = { data };
    }
);

/**
 * @api {post} /badashboard.recordActivity Record an approval activity
 * @apiName RecordActivity
 * @apiGroup BADashboard
 */
router.post(
    "badashboard.recordActivity",
    auth(),
    validate(T.BADashboardRecordActivitySchema),
    transaction(),
    async (ctx: APIContext<T.RecordActivityReq>) => {
        const { action, gapFindingId, documentId, agentProposalId } = ctx.input.body;
        const { user } = ctx.state.auth;

        const activity = await ApprovalActivity.create(
            {
                action,
                gapFindingId,
                documentId: documentId || null,
                agentProposalId: action === "ChangeSRS" ? (agentProposalId || null) : null,
                userId: user.id,
                teamId: user.teamId,
            } as any,
            { transaction: ctx.state.transaction }
        );

        ctx.body = {
            data: {
                id: activity.id,
                action: activity.action,
                gapFindingId: activity.gapFindingId,
                documentId: activity.documentId,
                agentProposalId: activity.agentProposalId,
                userId: activity.userId,
                teamId: activity.teamId,
                createdAt: activity.createdAt,
            },
        };
    }
);

/**
 * @api {post} /badashboard.listActivities List recent approval activities
 * @apiName ListActivities
 * @apiGroup BADashboard
 */
router.post(
    "badashboard.listActivities",
    auth(),
    validate(T.BADashboardListActivitiesSchema),
    async (ctx: APIContext<T.ListActivitiesReq>) => {
        const { gapFindingId } = ctx.input.body;
        const { user } = ctx.state.auth;

        const where: any = { teamId: user.teamId };
        if (gapFindingId) {
            where.gapFindingId = gapFindingId;
        }

        const activities = await ApprovalActivity.findAll({
            where,
            order: [["createdAt", "DESC"]],
            limit: 20,
            include: [
                {
                    model: User,
                    as: "user",
                    attributes: ["id", "name"],
                },
                {
                    model: Document,
                    as: "document",
                    attributes: ["id", "title"],
                    required: false,
                },
            ],
        });

        ctx.body = {
            data: activities.map((a) => ({
                id: a.id,
                action: a.action,
                gapFindingId: a.gapFindingId,
                documentId: a.documentId,
                documentName: (a.document as any)?.title || null,
                agentProposalId: a.agentProposalId,
                actorName: a.user?.name || "Unknown",
                createdAt: a.createdAt,
            })),
        };
    }
);

/**
 * @api {post} /badashboard.updateGapFindingStatus Update gap finding status
 * @apiName UpdateGapFindingStatus
 * @apiGroup BADashboard
 */
router.post(
    "badashboard.updateGapFindingStatus",
    auth(),
    validate(T.BADashboardUpdateGapFindingStatusSchema),
    async (ctx: APIContext<T.UpdateGapFindingStatusReq>) => {
        const { gapFindingId, status } = ctx.input.body;
        const { user } = ctx.state.auth;

        // // Update status via external API
        // await externalApiService.updateGapFindingStatus(gapFindingId, status);

        await GapFinding.update({ status } as any, { where: { id: gapFindingId, teamId: user.teamId } });
        ctx.body = { success: true };
    }
);

/**
 * @api {post} /badashboard.updateAgentProposalStatus Update agent proposal status
 * @apiName UpdateAgentProposalStatus
 * @apiGroup BADashboard
 */
router.post(
    "badashboard.updateAgentProposalStatus",
    auth(),
    validate(T.BADashboardUpdateAgentProposalStatusSchema),
    async (ctx: APIContext<T.UpdateAgentProposalStatusReq>) => {
        const { agentProposalId, status } = ctx.input.body;
        const { user } = ctx.state.auth;

        // // Update status via external API
        // await externalApiService.updateAgentProposalStatus(agentProposalId, status);

        // Verify ownership via GapFinding.teamId
        const proposal = await AgentProposal.findByPk(agentProposalId);
        if (!proposal) {
            ctx.throw(404, "Proposal not found");
        }
        if (!proposal!.gapFindingId) {
            ctx.throw(400, "Invalid proposal: missing gapFindingId");
        }
        const gfOwner = await GapFinding.findOne({ where: { id: proposal!.gapFindingId as string, teamId: user.teamId } });
        if (!gfOwner) {
            ctx.throw(403, "Forbidden");
        }

        await AgentProposal.update({ status } as any, { where: { id: agentProposalId } });
        ctx.body = { success: true };
    }
);

/**
 * @api {post} /badashboard.numberOfGapFindingsByStatus Get number of gap findings by status
 * @apiName NumberOfGapFindingsByStatus
 * @apiGroup BADashboard
 */
router.post(
    "badashboard.numberOfGapFindingsByStatus",
    auth(),
    async (ctx: APIContext) => {
        const { user } = ctx.state.auth;

        const [approved, pending, rejected] = await Promise.all([
            GapFinding.count({ where: { status: "approved", teamId: user.teamId } }),
            GapFinding.count({ where: { status: "pending", teamId: user.teamId } }),
            GapFinding.count({ where: { status: "rejected", teamId: user.teamId } }),
        ]);

        ctx.body = {
            data: {
                numberOfApprovedGapFindings: approved,
                numberOfPendingGapFindings: pending,
                numberOfRejectedGapFindings: rejected,
            },
        };
    }
);

/**
 * @api {post} /badashboard.testResults Get test results for a gap finding
 * @apiName TestResults
 * @apiGroup BADashboard
 */
router.post(
    "badashboard.testResults",
    auth(),
    validate(T.BADashboardTestResultsSchema),
    async (ctx: APIContext<T.TestResultsReq>) => {
        const { gapFindingId } = ctx.input.body;
        const { user } = ctx.state.auth;

        // // Fetch from external API
        // const data = await externalApiService.getTestResults(gapFindingId);
        // ctx.body = { data };

        const gfOwner = await GapFinding.findOne({ where: { id: gapFindingId, teamId: user.teamId } });
        if (!gfOwner) {
            ctx.throw(404, "Gap finding not found");
        }

        const results = await TestResult.findAll({
            where: { gapFindingId },
        });

        const data = results.map((r) => ({
            id: r.id,
            gapFindingId: r.gapFindingId,
            title: r.title,
            description: r.description || "",
            code_to_srs: r.codeToSrs,
            test_code: r.testCode || null,
            requirement_id: r.requirementId || null,
            srs_section: r.srsSection || null,
            error_message: r.errorMessage || null,
            tag_reason: r.tagReason || null,
            assertion_logic: r.assertionLogic || null,
            duration_ms: r.durationMs || null,
            step_number: r.stepNumber ?? null,
            srs: {
                actor: r.srsActor,
                event: r.srsEvent,
                action: r.srsAction,
                state: r.srsState,
                guard_br: r.srsGuardBr,
            },
            code: {
                actor: r.codeActor,
                event: r.codeEvent,
                action: r.codeAction,
                state: r.codeState,
                guard: r.codeGuard,
            },
            srs_references: r.srsReferences || [],
            code_references: r.codeReferences || [],
            suggested_action: r.suggestedAction ?? null,
        }));

        ctx.body = { data };
    }
);

/**
 * @api {post} /badashboard.updateTestResultAction Set suggestedAction (change_code|change_srs|null) on a test result
 */
router.post(
    "badashboard.updateTestResultAction",
    auth(),
    validate(T.BADashboardUpdateTestResultActionSchema),
    async (ctx: APIContext<T.UpdateTestResultActionReq>) => {
        const { testResultId, suggestedAction } = ctx.input.body;
        const { user } = ctx.state.auth;

        const tr = await TestResult.findByPk(testResultId);
        if (!tr) { ctx.throw(404, "Test result not found"); }
        const gf = await GapFinding.findByPk(tr.gapFindingId);
        if (!gf) { ctx.throw(404, "Gap finding not found"); }
        // Chấp nhận nếu cùng team HOẶC gap finding chưa gán team (pipeline-created)
        if (gf.teamId && gf.teamId !== user.teamId) {
            ctx.throw(403, "Forbidden");
        }

        tr.suggestedAction = suggestedAction;
        await tr.save();

        ctx.body = { data: { id: tr.id, suggestedAction: tr.suggestedAction } };
    }
);

/**
 * @api {post} /badashboard.srsChangeSuggestion Get LightRAG-powered SRS change suggestion
 * @apiName SrsChangeSuggestion
 * @apiGroup BADashboard
 * @apiDescription Queries the Python LightRAG backend to generate a smart SRS change
 *   suggestion based on test result classifications (mismatch/surplus/missing).
 */
router.post(
    "badashboard.srsChangeSuggestion",
    auth(),
    validate(T.BADashboardSrsChangeSuggestionSchema),
    async (ctx: APIContext<T.SrsChangeSuggestionReq>) => {
        // LightRAG + LLM pipeline can take several minutes — override socket timeout for this route only
        ctx.req.socket?.setTimeout(300000);

        const { gapFindingId, testResults, useCaseName, userInstruction } = ctx.input.body;
        const { user } = ctx.state.auth;

        const gapFinding = await GapFinding.findOne({ where: { id: gapFindingId, teamId: user.teamId } });
        const gapDescription = gapFinding?.description || "";

        // Resolve candidate doc_names from lightrag_doc_full using useCaseName
        let resolvedDocFilePaths: string[] = [];
        try {
            resolvedDocFilePaths = await LightragDocFull.findDocNamesByUseCaseName(useCaseName);
        } catch (e) {
            Logger.warn("Failed to resolve documentFilePaths from lightrag_doc_full", { useCaseName, error: e });
        }

        const pythonUrl = env.PYTHON_BACKEND_URL;
        if (!pythonUrl) {
            ctx.body = {
                data: { suggestion: `Gap Finding: ${gapDescription}` },
            };
            return;
        }

        try {
            const response = await fetch(`${pythonUrl}/api/srs/suggest`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  ...(env.INTERNAL_API_SECRET
                    ? { "X-Internal-Secret": env.INTERNAL_API_SECRET }
                    : {}),
                },
                body: JSON.stringify({ gapFindingId, testResults, gapDescription, useCaseName, userInstruction, documentFilePaths: resolvedDocFilePaths }),
                timeout: 180000, // 3 minutes — LightRAG + LLM calls can be slow
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Python backend error ${response.status}: ${errorText}`);
            }

            const data = await response.json() as {
                suggestion: string;
                evaluation: {
                    warnings: { type: string; node: string; message: string }[];
                    intent_summary: { add: number; update: number; delete: number };
                    node_counts: { total: number; external_ref: number; internal_only: number };
                };
            };

            // Lần đầu: tạo record với đầy đủ fields. Lần 2+: chỉ update summary + evaluation.
            const [proposal, created] = await AgentProposal.findOrCreate({
                where: { gapFindingId, proposalType: "Change SRS" },
                defaults: {
                    summary: data.suggestion,
                    evaluation: data.evaluation ?? null,
                    status: "pending",
                } as any,
            });
            if (!created) {
                await proposal.update({ summary: data.suggestion, evaluation: data.evaluation ?? null });
            }

            appendSrsLog({ gapFindingId, userInstruction: userInstruction || "", gapDescription, useCaseName, suggestion: data.suggestion });
            ctx.body = { data: { suggestion: data.suggestion, evaluation: data.evaluation, proposalId: proposal.id } };
        } catch (error) {
            Logger.error("Failed to fetch SRS suggestion from Python backend", error as Error);
            ctx.body = {
                data: { suggestion: `Gap Finding: ${gapDescription}` },
            };
        }
    }
);

/**
 * @api {post} /badashboard.srsRefineSuggestion Refine an existing SRS change suggestion
 * @apiName SrsRefineSuggestion
 * @apiGroup BADashboard
 * @apiDescription Calls the Python LLM to refine a previously generated SRS proposal
 *   based on the user's instruction, without re-running the full LightRAG pipeline.
 */
router.post(
    "badashboard.srsRefineSuggestion",
    auth(),
    validate(T.BADashboardSrsRefineSuggestionSchema),
    async (ctx: APIContext<T.SrsRefineSuggestionReq>) => {
        ctx.req.socket?.setTimeout(120000);

        const { gapFindingId, previousProposalId, userInstruction, useCaseName } = ctx.input.body;

        const proposal = await AgentProposal.findByPk(previousProposalId);
        if (!proposal?.summary) {
            ctx.throw(404, "Previous proposal not found");
        }

        const pythonUrl = env.PYTHON_BACKEND_URL;
        if (!pythonUrl) {
            ctx.body = { data: { suggestion: proposal.summary } };
            return;
        }

        try {
            const response = await fetch(`${pythonUrl}/api/srs/refine`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  ...(env.INTERNAL_API_SECRET
                    ? { "X-Internal-Secret": env.INTERNAL_API_SECRET }
                    : {}),
                },
                body: JSON.stringify({ previousSuggestion: proposal.summary, userInstruction, useCaseName }),
                timeout: 120000,
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Python backend error ${response.status}: ${errorText}`);
            }

            const data = await response.json() as { suggestion: string };
            await proposal.update({ summary: data.suggestion });

            if (userInstruction.trim()) {
                appendSrsLog({ gapFindingId, userInstruction, gapDescription: "", useCaseName, suggestion: data.suggestion });
            }

            ctx.body = { data: { suggestion: data.suggestion } };
        } catch (error) {
            Logger.error("Failed to refine SRS suggestion from Python backend", error as Error);
            ctx.body = { data: { suggestion: proposal.summary } };
        }
    }
);

/**
 * @api {post} /badashboard.saveSrsInstruction Save (upsert) a user's SRS instruction
 * @apiName SaveSrsInstruction
 * @apiGroup BADashboard
 */
router.post(
    "badashboard.saveSrsInstruction",
    auth(),
    validate(T.BADashboardSaveInstructionSchema),
    transaction(),
    async (ctx: APIContext<T.SaveInstructionReq>) => {
        const { instruction } = ctx.input.body;
        const { user } = ctx.state.auth;

        const MAX_HISTORY = 10;
        const existing = await UserSrsInstruction.findOne({
            where: { userId: user.id },
        });

        const currentHistory: string[] = (existing?.instructions as string[]) || [];
        const newHistory = [instruction, ...currentHistory.filter((i) => i !== instruction)].slice(0, MAX_HISTORY);

        if (existing) {
            await existing.update({ instructions: newHistory });
        } else {
            await UserSrsInstruction.create({
                instructions: newHistory,
                userId: user.id,
                teamId: user.teamId,
            } as any);
        }
        ctx.body = { data: { instructions: newHistory } };
    }
);

/**
 * @api {post} /badashboard.getSrsInstruction Get a user's saved SRS instruction history
 * @apiName GetSrsInstruction
 * @apiGroup BADashboard
 */
router.post(
    "badashboard.getSrsInstruction",
    auth(),
    validate(T.BADashboardGetInstructionSchema),
    async (ctx: APIContext<T.GetInstructionReq>) => {
        const { user } = ctx.state.auth;

        const record = await UserSrsInstruction.findOne({
            where: { userId: user.id },
        });

        ctx.body = {
            data: { instructions: (record?.instructions as string[]) ?? [] },
        };
    }
);

/**
 * @api {post} /badashboard.importPipelineResult Import GAP finder pipeline results
 * @apiName ImportPipelineResult
 * @apiGroup BADashboard
 * @apiDescription Called by the Python GAP finder pipeline after a run completes.
 *   Uses X-Pipeline-Api-Key header instead of user session auth.
 *   Creates one GapFinding record + TestResult records for each test verdict.
 */
router.post(
    "badashboard.importPipelineResult",
    // No auth() — uses API key header instead
    validate(T.BADashboardImportPipelineResultSchema),
    async (ctx: APIContext<T.ImportPipelineResultReq>) => {
        const apiKey = ctx.request.headers["x-pipeline-api-key"] as string | undefined;
        if (!env.PIPELINE_API_KEY || apiKey !== env.PIPELINE_API_KEY) {
            ctx.throw(401, "Invalid or missing pipeline API key");
        }

        const {
            pr_id, repo, repo_type, pr_title,
            verdict_summary, surplus_count = 0,
            error_summary, llm_cost_usd = 0, run_at,
            test_verdicts, surplus_items = [],
        } = ctx.input.body;

        // Severity: High if any mismatch, Medium if missing/surplus, Low if all match
        let severity = "Low";
        if (verdict_summary.mismatch > 0) { severity = "High"; }
        else if (verdict_summary.missing > 0 || surplus_count > 0) { severity = "Medium"; }

        const repoTypeLabel = repo_type === "frontend" ? "FE" : "BE";
        const title = `[${repoTypeLabel}] PR #${pr_id} — ${repo}`;

        // Store all PR metadata as JSON in description; shown in "Drift Analysis" section
        const descriptionData = {
            pr_id, repo, repo_type, pr_title,
            test_counts: {
                total: verdict_summary.total,
                matching: verdict_summary.matching,
                mismatch: verdict_summary.mismatch,
                missing: verdict_summary.missing,
            },
            surplus_count,
            error_summary,
            llm_cost_usd,
            run_at,
        };

        // Resolve teamId from repo — mỗi team config GitHub repo khác nhau nên repo → teamId là 1-1
        const pipelineTeamId = await resolveTeamIdFromRepo(repo);
        if (!pipelineTeamId) {
            Logger.warn(`No GithubConfig found for repo "${repo}" — gap finding will have no teamId`);
        }

        // Upsert: nếu cùng PR đã có record thì update, không tạo mới
        // Lấy record mới nhất theo title (đề phòng có duplicate từ trước)
        const existingWhere: any = { title };
        if (pipelineTeamId) { existingWhere.teamId = pipelineTeamId; }

        const existing = await GapFinding.findAll({
            where: existingWhere,
            order: [["created_at", "DESC"]],
        });

        let gapFinding: GapFinding;
        if (existing.length > 0) {
            // Giữ record mới nhất, xoá các duplicate cũ hơn
            gapFinding = existing[0];
            if (existing.length > 1) {
                const oldIds = existing.slice(1).map((g) => g.id);
                await TestResult.destroy({ where: { gapFindingId: oldIds } });
                await GapFinding.destroy({ where: { id: oldIds } });
                Logger.info("task", `Cleaned up ${oldIds.length} duplicate gap finding(s) for PR #${pr_id}`);
            }
            // Update data theo lần chạy mới nhất, giữ nguyên status (BA có thể đã review)
            await gapFinding.update({
                pullRequestId: String(pr_id),
                description: JSON.stringify(descriptionData),
                severity,
            } as any);
            // Xoá test results cũ rồi insert lại
            await TestResult.destroy({ where: { gapFindingId: gapFinding.id } });
        } else {
            gapFinding = await GapFinding.create({
                title,
                pullRequestId: String(pr_id),
                description: JSON.stringify(descriptionData),
                severity,
                status: "pending",
                documentId: null,
                teamId: pipelineTeamId,
            } as any);
        }

        const tagToCodeToSrs = (tag: string): "match" | "mismatch" | "missing" | "surplus" => {
            if (tag === "matching") { return "match"; }
            if (tag === "mismatch") { return "mismatch"; }
            return "missing";
        };

        const verdictRecords = test_verdicts.map((v) => ({
            gapFindingId: gapFinding.id,
            title: v.name,
            description: v.requirement_description,
            codeToSrs: tagToCodeToSrs(v.tag),
            testCode: v.test_code || null,
            requirementId: v.requirement_id || null,
            srsSection: v.srs_section || null,
            errorMessage: v.error_message || null,
            tagReason: v.tag_reason || null,
            assertionLogic: v.assertion_logic || null,
            durationMs: v.duration_ms || null,
            // EAS row fields + references
            stepNumber: v.step ?? null,
            srsActor: v.srs?.actor ?? null,
            srsEvent: v.srs?.event ?? null,
            srsAction: v.srs?.action ?? null,
            srsState: v.srs?.state ?? null,
            srsGuardBr: v.srs?.guard_br ?? null,
            codeActor: v.code?.actor ?? null,
            codeEvent: v.code?.event ?? null,
            codeAction: v.code?.action ?? null,
            codeState: v.code?.state ?? null,
            codeGuard: v.code?.guard ?? null,
            srsReferences: v.srs_references ?? null,
            codeReferences: v.code_references ?? null,
        }));

        const surplusRecords = surplus_items.map((s: any) => ({
            gapFindingId: gapFinding.id,
            title: s.title || s.id,
            description: `[SURPLUS] ${s.reason || ""}${s.confidence ? ` (confidence: ${s.confidence})` : ""}`,
            codeToSrs: "surplus" as const,
            codeAction: s.action ?? null,
            codeActor: s.actor ?? null,
            codeEvent: s.event ?? null,
            codeReferences: s.code_references ?? null,
        }));

        await TestResult.bulkCreate([...verdictRecords, ...surplusRecords] as any[]);

        Logger.info("task", "Pipeline result imported", { gapFindingId: gapFinding.id, pr_id, repo, verdict_summary });
        ctx.body = { data: { gapFindingId: gapFinding.id, title } };
    }
);

/**
 * @api {post} /badashboard.pushClaudeLogs Push Claude CLI logs for real-time broadcast
 * @apiName PushClaudeLogs
 * @apiGroup BADashboard
 * @apiDescription Called by claude_runner.py to push gap-finding analysis logs.
 *   Uses X-Pipeline-Api-Key header instead of user session auth.
 *   Broadcasts logs via socket.io to connected clients.
 */
router.post(
    "badashboard.pushClaudeLogs",
    async (ctx: APIContext) => {
        const apiKey = ctx.request.headers["x-pipeline-api-key"] as string | undefined;
        if (!env.PIPELINE_API_KEY || apiKey !== env.PIPELINE_API_KEY) {
            ctx.throw(401, "Invalid or missing pipeline API key");
        }

        const payload = ctx.request.body as {
            run_id: string;
            pr_number: number;
            repo: string;
            team_id?: string;
            pr_title?: string;
            status: string;
            output: string;
            duration_ms?: number;
            started_at?: string;
            finished_at?: string;
        };

        Logger.info("task", "Claude log received", {
            run_id: payload.run_id,
            pr_number: payload.pr_number,
            status: payload.status,
        });

        ctx.body = { ok: true };
    }
);

/**
 * @api {post} /badashboard.pipelineUsage Fetch gap-finding pipeline usage history
 * @apiName PipelineUsage
 * @apiGroup BADashboard
 * @apiDescription Proxy to Python backend /api/pipeline-usage. Returns tokens/cost
 *   per pipeline run (JSONL-backed). Query params: team_id, pr_id, limit.
 */
router.get(
    "badashboard.pipelineUsage",
    async (ctx: APIContext) => {
        const pythonBackendUrl = env.PYTHON_BACKEND_URL ?? "http://localhost:8000";
        // Forward browser query params (team_id, pr_id, limit) directly to Python endpoint.
        // GET method auto-bypasses CSRF — browser cứ curl/fetch thoải mái.
        const url = new URL(`${pythonBackendUrl}/api/pipeline-usage`);
        for (const [k, v] of Object.entries(ctx.query)) {
            if (typeof v === "string") {
                url.searchParams.set(k, v);
            }
        }
        // Use native fetch (not @server/utils/fetch) — internal calls to private Docker
        // network IPs are blocked by the utils/fetch SSRF filter.
        const res = await globalThis.fetch(url.toString(), {
            headers: {
                ...(env.INTERNAL_API_SECRET
                    ? { "X-Internal-Secret": env.INTERNAL_API_SECRET }
                    : {}),
            },
        });
        if (!res.ok) {
            ctx.throw(res.status >= 500 ? 502 : res.status, await res.text());
        }
        ctx.body = await res.json();
    }
);

export default router;

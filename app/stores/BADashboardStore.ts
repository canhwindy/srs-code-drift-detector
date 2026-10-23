import { action, observable, runInAction } from "mobx";
import invariant from "invariant";
import BADashboard from "~/models/BADashboard";
import { client } from "~/utils/ApiClient";
import type { JSONObject } from "@shared/types";
import type RootStore from "./RootStore";
import Store from "./base/Store";

/**
 * Store for managing BA Dashboard items.
 * Data is fetched from external API instead of local database.
 */
export default class BADashboardStore extends Store<BADashboard> {
    apiEndpoint = "badashboard";

    @observable
    refreshKey = 0;

    @observable
    loadingProposalIds: Set<string> = new Set();

    @observable
    selectedActions: Map<string, "code" | "srs"> = new Map();

    @action
    setSelectedAction = (gapFindingId: string, action: "code" | "srs" | null) => {
        if (action === null) {
            this.selectedActions.delete(gapFindingId);
        } else {
            this.selectedActions.set(gapFindingId, action);
        }
    };

    constructor(rootStore: RootStore) {
        super(rootStore, BADashboard);
    }

    @action
    triggerRefresh = () => {
        this.refreshKey++;
    };

    /**
     * Fetch all dashboard items.
     *
     * @returns array of dashboard items.
     */
    @action
    fetchDashboards = async (): Promise<BADashboard[]> => {
        this.isFetching = true;

        try {
            const res = await client.post("/badashboard.list");
            invariant(res?.data, "Data should be available");

            runInAction("BADashboardStore#fetchDashboards", () => {
                res.data.forEach((item: any) => {
                    this.add(item);
                });
                this.isLoaded = true;
            });

            return res.data.map((item: any) => this.add(item));
        } finally {
            this.isFetching = false;
        }
    };

    /**
     * Fetch a single dashboard item with details.
     *
     * @param id - The dashboard item id to fetch.
     * @returns the dashboard item data.
     */
    @action
    fetchWithDetails = async (id: string): Promise<BADashboard> => {
        this.isFetching = true;

        try {
            const res = await client.post("/badashboard.info", { id });
            invariant(res?.data, "Data should be available");

            const dashboard = this.add(res.data);

            runInAction("BADashboardStore#fetchWithDetails", () => {
                this.isLoaded = true;
            });

            return dashboard;
        } finally {
            this.isFetching = false;
        }
    };

    /**
     * Create a new dashboard item.
     *
     * @param data - The dashboard data.
     * @returns the created dashboard item.
     */
    @action
    createDashboard = async (data: {
        title: string;
        description?: string;
        type: string;
        config?: Record<string, unknown>;
        dataSource?: string;
    }): Promise<BADashboard> => {
        const res = await client.post("/badashboard.create", data as JSONObject);
        invariant(res?.data, "Data should be available");

        return this.add(res.data);
    };

    /**
     * Update a dashboard item.
     *
     * @param id - The dashboard item id.
     * @param data - The updated data.
     * @returns the updated dashboard item.
     */
    @action
    updateDashboard = async (
        id: string,
        data: Partial<{
            title: string;
            description: string;
            type: string;
            config: Record<string, unknown>;
            dataSource: string;
            index: string;
        }>
    ): Promise<BADashboard> => {
        const res = await client.post("/badashboard.update", { id, ...data } as JSONObject);
        invariant(res?.data, "Data should be available");

        return this.add(res.data);
    };

    /**
     * Delete a dashboard item.
     *
     * @param id - The dashboard item id to delete.
     */
    @action
    deleteDashboard = async (id: string): Promise<void> => {
        await client.post("/badashboard.delete", { id } as JSONObject);

        runInAction("BADashboardStore#deleteDashboard", () => {
            this.remove(id);
        });
    };

    /**
     * Fetch analytics data from external API.
     *
     * @param params - Query parameters for analytics.
     * @returns analytics data.
     */
    @action
    fetchAnalytics = async (params: {
        startDate?: string;
        endDate?: string;
        metrics?: string[];
    }): Promise<any> => {
        const res = await client.post("/badashboard.analytics", params);
        invariant(res?.data, "Data should be available");

        return res.data;
    };

    /**
     * Fetch chart data from external API.
     *
     * @param chartId - The chart identifier.
     * @param params - Query parameters.
     * @returns chart data.
     */
    @action
    fetchChartData = async (
        chartId: string,
        params?: Record<string, unknown>
    ): Promise<any> => {
        const res = await client.post("/badashboard.chartData", {
            chartId,
            ...params,
        });
        invariant(res?.data, "Data should be available");

        return res.data;
    };

    /**
     * Fetch pending approval items.
     *
     * @returns array of pending approval items.
     */
    @action
    fetchPendingApprovals = async (): Promise<{
        id: string;
        documentId: string;
        title: string;
        pullRequestId: string;
        description: string;
        severity: string;
        status: string;
        createdAt: string;
        updatedAt: string;
        document: {
            id: string;
            collectionId: string;
            urlId: string;
            name: string;
            ucId: string;
            createdAt: string;
            updatedAt: string;
            collection: null;
        };
        agentProposalsIfApproved: {
            type: string,
            newText: string,
            summary: string,
        }
    }[]> => {
        this.isFetching = true;

        try {
            const res = await client.post("/badashboard.pendingApprovals");
            invariant(res?.data, "Data should be available");

            return res.data;
        } finally {
            this.isFetching = false;
        }
    };

    /**
     * Fetch approval details by usecaseId.
     *
     * @param usecaseId - The usecase ID to fetch details for.
     * @returns detailed approval information.
     */
    @action
    fetchApprovalDetails = async (usecaseId: string): Promise<{
        usecaseId: string;
        title: string;
        type: "update" | "warning" | "mapping";
        branch: string;
        issueNumber: string;
        description: string;
        tag?: string;
        author: string;
        createdAt: string;
        updatedAt: string;
        priority: "high" | "medium" | "low";
        affectedFiles: string[];
        comments: { user: string; text: string; date: string }[];
        currentSpec: string;
        proposedChange: string;
    }> => {
        this.isFetching = true;

        try {
            const res = await client.post("/badashboard.approvalDetails", { usecaseId });
            invariant(res?.data, "Data should be available");

            return res.data;
        } finally {
            this.isFetching = false;
        }
    };

    /**
     * Add a suggestion comment to a document.
     * This creates a comment with the old text and suggested new text.
     *
     * @param documentId - The document ID (uuid or urlId).
     * @param oldText - The current text that needs to be changed.
     * @param newText - The suggested new text.
     * @returns the response with commentId and documentUrlId.
     */
    @action
    addSuggestionComment = async (
        documentId: string,
        summary: string,
    ): Promise<{ commentId: string; documentId: string; documentUrlId: string }> => {
        this.isFetching = true;

        try {
            const res = await client.post("/documents.addSuggestionComment", {
                id: documentId,
                summary,
            });
            invariant(res?.data, "Data should be available");

            return res.data;
        } finally {
            this.isFetching = false;
        }
    };

    /**
     * Fetch agent proposals for a gap finding.
     * @param gapFindingId - The gap finding ID to fetch proposals for.
     * @returns proposal details including type, summary, oldText, newText, status, createdAt, updatedAt.
     */
    @action
    fetchAgentProposals = async (gapFindingId: string): Promise<{
        id: string;
        proposalType: string;
        summary: string;
        evaluation: {
            warnings: { type: string; node: string; message: string; appears_in_docs?: string[]; context_snippets?: { doc: string; section?: string; chunk_order?: number; excerpt: string; highlight_start: number; highlight_end: number }[] }[];
            intent_summary: { add: number; update: number; delete: number };
            node_counts: { total: number; external_ref: number; internal_only: number };
        } | null;
        status: string;
        createdAt: string;
        updatedAt: string;
    }[]> => {
        this.isFetching = true;

        try {
            const res = await client.post("/badashboard.agentProposals", {
                gapFindingId,
            });
            invariant(res?.data, "Data should be available");
            const data = res.data;
            return Array.isArray(data) ? data : [data];
        } finally {
            this.isFetching = false;
        }
    };

    /**
     * Record an approval activity (which action the user selected).
     * @param actionType - "ChangeCode" or "ChangeSRS"
     * @param gapFindingId - The gap finding being acted upon
     * @param agentProposalId - The agent proposal ID (for ChangeSRS only)
     */
    @action
    recordActivity = async (
        actionType: "ChangeCode" | "ChangeSRS" | "Reject Proposal From Agent",
        gapFindingId: string,
        documentId?: string | null,
        agentProposalId?: string | null
    ): Promise<{
        id: string;
        action: string;
        gapFindingId: string;
        documentId: string | null;
        agentProposalId: string | null;
        userId: string;
        teamId: string;
        createdAt: string;
    }> => {
        const res = await client.post("/badashboard.recordActivity", {
            action: actionType,
            gapFindingId,
            documentId: documentId || null,
            agentProposalId: agentProposalId || null,
        });
        invariant(res?.data, "Data should be available");
        return res.data;
    };

    /**
     * Fetch recent approval activities.
     * @param gapFindingId - Optional filter by gap finding ID.
     */
    @action
    fetchActivities = async (gapFindingId?: string): Promise<{
        id: string;
        action: "ChangeCode" | "ChangeSRS";
        gapFindingId: string;
        agentProposalId: string | null;
        documentId: string;
        documentName: string | null;
        actorName: string;
        createdAt: string;
    }[]> => {
        this.isFetching = true;

        try {
            const res = await client.post("/badashboard.listActivities", {
                ...(gapFindingId ? { gapFindingId } : {}),
            });
            invariant(res?.data, "Data should be available");
            return res.data;
        } finally {
            this.isFetching = false;
        }
    };

    /**
     * Update the status of a gap finding (e.g., approved, rejected).
     * @param gapFindingId - The ID of the gap finding to update.
     * @param newStatus - The new status to set (e.g., "approved", "rejected").
     */
    @action
    updateGapFindingStatus = async (gapFindingId: string, newStatus: string): Promise<void> => {
        await client.post("/badashboard.updateGapFindingStatus", {
            gapFindingId,
            status: newStatus,
        });
    };

    /**
     * Update the status of an agent proposal (e.g., approved, rejected).
     * @param agentProposalId - The ID of the agent proposal to update.
     * @param newStatus - The new status to set (e.g., "approved", "rejected").
     */
    @action
    updateAgentProposalStatus = async (agentProposalId: string, newStatus: string): Promise<void> => {
        await client.post("/badashboard.updateAgentProposalStatus", {
            agentProposalId,
            status: newStatus,
        });
    };

    /**
     * Fetch test results for a gap finding.
     * @param gapFindingId - The gap finding ID.
     * @returns array of test results.
     */
    @action
    fetchTestResults = async (gapFindingId: string): Promise<{
        id: string;
        gapFindingId: string;
        title: string;
        description: string;
        code_to_srs: "mismatch" | "match" | "missing" | "surplus";
        test_code: string | null;
        requirement_id: string | null;
        srs_section: string | null;
        error_message: string | null;
        tag_reason: string | null;
        assertion_logic: string | null;
        duration_ms: number | null;
        suggested_action?: "change_code" | "change_srs" | null;
    }[]> => {
        const res = await client.post("/badashboard.testResults", { gapFindingId });
        invariant(res?.data, "Data should be available");
        return Array.isArray(res.data) ? res.data : [res.data];
    };

    /**
     * Update the suggestedAction of a single test result (change_code | change_srs | null).
     */
    @action
    updateTestResultAction = async (
        testResultId: string,
        suggestedAction: "change_code" | "change_srs" | null,
    ): Promise<void> => {
        await client.post("/badashboard.updateTestResultAction", {
            testResultId,
            suggestedAction,
        });
    };

    /**
     * Fetch a LightRAG-powered SRS change suggestion based on test result classifications.
     * @param gapFindingId - The gap finding ID.
     * @param testResults - The test results for this gap finding.
     * @param proposalSummary - The agent proposal summary text.
     * @param proposalNewText - The agent proposal new text.
     * @returns the suggestion text to display in the "Suggest Description" box.
     */
    @action
    fetchSrsChangeSuggestion = async (
        gapFindingId: string,
        testResults: {
            id: string;
            gapFindingId: string;
            title: string;
            description: string;
            code_to_srs: "mismatch" | "match" | "missing" | "surplus";
        }[],
        useCaseName: string,
        userInstruction?: string,
    ): Promise<{ suggestion: string; proposalId: string | null; evaluation: { warnings: { type: string; node: string; message: string }[]; intent_summary: { add: number; update: number; delete: number }; node_counts: { total: number; external_ref: number; internal_only: number } } | null }> => {
        runInAction(() => this.loadingProposalIds.add(gapFindingId));
        try {
            const res = await client.post("/badashboard.srsChangeSuggestion", {
                gapFindingId,
                testResults,
                useCaseName,
                userInstruction: userInstruction || "",
            });
            invariant(res?.data, "Data should be available");
            return {
                suggestion: res.data.suggestion as string,
                proposalId: (res.data.proposalId as string) ?? null,
                evaluation: res.data.evaluation ?? null,
            };
        } finally {
            runInAction(() => this.loadingProposalIds.delete(gapFindingId));
        }
    };

    /**
     * Refine an existing SRS change proposal based on user instruction.
     * Calls the Python LLM directly without re-running the full LightRAG pipeline.
     */
    @action
    fetchSrsRefineSuggestion = async (
        gapFindingId: string,
        previousProposalId: string,
        userInstruction: string,
        useCaseName: string,
    ): Promise<{ suggestion: string }> => {
        runInAction(() => this.loadingProposalIds.add(gapFindingId));
        try {
            const res = await client.post("/badashboard.srsRefineSuggestion", {
                gapFindingId,
                previousProposalId,
                userInstruction,
                useCaseName,
            });
            invariant(res?.data, "Data should be available");
            return { suggestion: res.data.suggestion as string };
        } finally {
            runInAction(() => this.loadingProposalIds.delete(gapFindingId));
        }
    };

    /**
     * Save the user's SRS instruction and return the updated history array.
     */
    @action
    saveSrsInstruction = async (instruction: string): Promise<string[]> => {
        const res = await client.post("/badashboard.saveSrsInstruction", { instruction });
        return (res?.data?.instructions as string[]) ?? [];
    };

    /**
     * Get the user's SRS instruction history (most recent first).
     * Returns empty array if none saved.
     */
    @action
    fetchSrsInstruction = async (): Promise<string[]> => {
        const res = await client.post("/badashboard.getSrsInstruction", {});
        return (res?.data?.instructions as string[]) ?? [];
    };

    /**
     * Get the number of gap findings by status (approved, pending, rejected).
     * @returns an object containing the counts for each status.
     */
    @action
    getNumberOfGapFindingsByStatus = async (): Promise<{
        numberOfApprovedGapFindings: number;
        numberOfPendingGapFindings: number;
        numberOfRejectedGapFindings: number;
    }> => {
        const res = await client.post("/badashboard.numberOfGapFindingsByStatus");
        invariant(res?.data, "Data should be available");
        // Handle both array response [{ ... }] and object response { ... }
        const rawData = Array.isArray(res.data) ? res.data[0] : res.data;
        const data = {
            numberOfApprovedGapFindings: rawData?.numberOfApprovedGapFindings || 0,
            numberOfPendingGapFindings: rawData?.numberOfPendingGapFindings || 0,
            numberOfRejectedGapFindings: rawData?.numberOfRejectedGapFindings || 0,
        };
        return data;
    };

}

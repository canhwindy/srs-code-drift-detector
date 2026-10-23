import React, { useState, useEffect, useRef } from "react";
import { observer } from "mobx-react";
import { useTranslation } from "react-i18next";
import { useHistory } from "react-router-dom";
import styled from "styled-components";
import { toast } from "sonner";
import ConfirmationDialog from "~/components/ConfirmationDialog";
import Text from "~/components/Text";
import Logger from "~/utils/Logger";
import useStores from "~/hooks/useStores";
import { documentPath } from "~/utils/routeHelpers";

// PR metadata stored as JSON in GapFinding.description for pipeline-pushed items
interface PrMeta {
  pr_id: number;
  repo: string;
  repo_type: string;
  pr_title: string;
  test_counts: { total: number; matching: number; mismatch: number; missing: number };
  surplus_count: number;
  error_summary: string;
  llm_cost_usd: number;
  run_at: string;
}

const parsePrMeta = (description: string): PrMeta | null => {
  try {
    const parsed = JSON.parse(description);
    if (parsed && parsed.test_counts) { return parsed as PrMeta; }
  } catch {
    // not JSON — legacy description text
  }
  return null;
};

const extractPrNumber = (pullRequestId: string): string =>
  pullRequestId.split("/").filter(Boolean).pop() ?? pullRequestId;

// ApprovalItem chứa thông tin cơ bản từ API
interface GapFindingItemInList {
  id: string,
  documentId: string,
  title: string,
  pullRequestId: string,
  description: string,
  severity: string,
  status: string,
  createdAt: string,
  updatedAt: string,
  document: {
    id: string,
    collectionId: string,
    urlId: string,
    name: string,
    ucId: string,
    createdAt: string,
    updatedAt: string,
    collection: null,
  } | null,
  agentProposalsIfApproved: {
    type: string,
    newText: string,
    summary: string,
  }
}

// Chi tiết của approval được fetch từ API
interface ApprovalDetail {
  id: string,
  documentId: string,
  title: string,
  pullRequestId: string,
  description: string,
  severity: string,
  status: string,
  createdAt: string,
  updatedAt: string,
  document: {
    id: string,
    collectionId: string,
    urlId: string,
    name: string,
    ucId: string,
    createdAt: string,
    updatedAt: string,
    collection: null,
  } | null,
  agentProposalsIfApproved: {
    type: string,
    newText: string,
    summary: string,
  }
}

const formatToVietnamTime = (dateString: string): string => {
  const date = new Date(dateString);
  if (isNaN(date.getTime())) {
    return dateString;
  }
  return date.toLocaleString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
};

const PendingApprovals: React.FC = () => {
  const { t } = useTranslation();
  const [gapFindingItemInList, setGapFindingItemInList] = useState<GapFindingItemInList[]>([]);
  const [approvalDetails] = useState<Map<string, ApprovalDetail>>(new Map());
  const [selectedItem, setSelectedItem] = useState<GapFindingItemInList | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [proposalSummary, setProposalSummary] = useState<string | null>(null);
  const { baDashboard, kanbanBoards, kanbanCards, kanbanLists, dialogs, documents } = useStores();

  const selectedAction = selectedItem ? (baDashboard.selectedActions.get(selectedItem.id) ?? null) : null;
  const setSelectedAction = (action: "code" | "srs" | null, itemOverride?: GapFindingItemInList) => {
    const target = itemOverride || selectedItem;
    if (target) { baDashboard.setSelectedAction(target.id, action); }
  };
  const [currentProposal, setCurrentProposal] = useState<{ id: string } | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const handleDelete = async (id: string) => {
    await baDashboard.deleteDashboard(id);
    setConfirmDeleteId(null);
    setGapFindingItemInList((prev) => prev.filter((i) => i.id !== id));
  };
  const [statusFilter, setStatusFilter] = useState<"all" | "approved" | "pending" | "rejected">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusCounts, setStatusCounts] = useState<{
    numberOfApprovedGapFindings: number;
    numberOfPendingGapFindings: number;
    numberOfRejectedGapFindings: number;
  } | null>(null);
  const [testResults, setTestResults] = useState<{
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
    step_number?: number | null;
    srs?: {
      actor?: string | null;
      event?: string | null;
      action?: string | null;
      state?: string | null;
      guard_br?: string | null;
    };
    code?: {
      actor?: string | null;
      event?: string | null;
      action?: string | null;
      state?: string | null;
      guard?: string | null;
    };
    srs_references?: Array<{ quote?: string; file_path?: string }>;
    code_references?: Array<{
      file_path?: string;
      line?: number;
      snippet?: string;
      repo?: string;
      url?: string;
    }>;
    suggested_action?: "change_code" | "change_srs" | null;
  }[]>([]);
  const [selectedBoardId, setSelectedBoardId] = useState<string>("");
  const [selectedListId, setSelectedListId] = useState<string>("");
  const [isKanbanDestOpen, setIsKanbanDestOpen] = useState(false);
  const [isLoadingKanban, setIsLoadingKanban] = useState(false);
  const [expandedTestIds, setExpandedTestIds] = useState<Set<string>>(new Set());
  const [isLoadingTestResults, setIsLoadingTestResults] = useState(false);
  type EvalWarning = {
    type: string;
    node: string;
    message: string;
    appears_in_docs?: string[];
    context_snippets?: { doc: string; section?: string; chunk_order?: number; excerpt: string; highlight_start: number; highlight_end: number }[];
  };
  const [, setEvaluation] = useState<{
    warnings: EvalWarning[];
    intent_summary: { add: number; update: number; delete: number };
    node_counts: { total: number; external_ref: number; internal_only: number };
  } | null>(null);
  const [openRef, setOpenRef] = useState<{ wi: number; si: number } | null>(null);
  const refPopupRef = useRef<HTMLDivElement>(null);
  const [userInstruction, setUserInstruction] = useState("");
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [instructionHistory, setInstructionHistory] = useState<string[]>([]);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const historyDropdownRef = useRef<HTMLDivElement>(null);
  const suggestSectionRef = useRef<HTMLDivElement>(null);
  const history = useHistory();

  // Map proposalType từ bảng agent_proposals (chỉ có 2 giá trị cố định)
  const getActionFromProposalType = (proposalType: string | null): "code" | "srs" | null => {
    if (proposalType === "Change Code") { return "code"; }

    if (proposalType === "Change SRS") {
      return "srs";
    }
    return null;
  };

  // Auto-scroll to suggest description when action is selected
  useEffect(() => {
    if (selectedAction && suggestSectionRef.current) {
      setTimeout(() => {
        suggestSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
      }, 100);
    }
  }, [selectedAction, proposalSummary]);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [items, counts] = await Promise.all([
        baDashboard.fetchPendingApprovals(),
        baDashboard.getNumberOfGapFindingsByStatus(),
      ]);
      setGapFindingItemInList(items);
      setStatusCounts(counts);
    } catch (error) {
      Logger.error("Failed to fetch pending approvals", error as Error);
    } finally {
      setIsLoading(false);
    }
  };

  // Fetch danh sách pending approvals và số lượng theo status từ API
  useEffect(() => {
    fetchData();
  }, [baDashboard]);

  // Close ref popup on outside click
  useEffect(() => {
    if (!openRef) {
      return;
    }
    const handler = (e: MouseEvent) => {
      if (refPopupRef.current && !refPopupRef.current.contains(e.target as Node)) {
        setOpenRef(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [openRef]);

  // Close history dropdown on outside click
  useEffect(() => {
    if (!isHistoryOpen) {
      return;
    }
    const handler = (e: MouseEvent) => {
      if (historyDropdownRef.current && !historyDropdownRef.current.contains(e.target as Node)) {
        setIsHistoryOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [isHistoryOpen]);

  const handleReview = async (item: GapFindingItemInList) => {
    // Set item trực tiếp để hiển thị modal
    setSelectedItem(item);
    setIsModalOpen(true);
    setTestResults([]);
    setSelectedBoardId("");
    setSelectedListId("");

    // Preload kanban boards cho selector
    if (kanbanBoards.orderedData.length === 0) {
      kanbanBoards.fetchPage({ limit: 100 }).catch((err) => Logger.warn("Failed to preload kanban boards", err as Error));
    }

    // Fetch test results in parallel
    setIsLoadingTestResults(true);
    baDashboard.fetchTestResults(item.id)
      .then((results) => {
        const sorted = [...results].sort((a, b) => {
          const sa = a.step_number ?? Number.MAX_SAFE_INTEGER;
          const sb = b.step_number ?? Number.MAX_SAFE_INTEGER;
          return sa - sb;
        });
        setTestResults(sorted);
      })
      .catch((err) => Logger.error("Failed to fetch test results", err as Error))
      .finally(() => setIsLoadingTestResults(false));

    // Auto-select action and load saved proposal from DB (no auto-generate on open)
    const statusLower = item.status.toLowerCase();
    if (statusLower === "approved" || statusLower === "rejected") {
      // Lấy proposalType từ bảng agent_proposals thay vì dùng agentProposalsIfApproved.type từ external API
      // vì external API có thể trả về type rỗng/null
      baDashboard.fetchAgentProposals(item.id)
        .then((proposals) => {
          const action = getActionFromProposalType(proposals[0]?.proposalType ?? null);
          if (action) {
            handleSelectAction(action, item, true);
          }
        })
        .catch((err) => Logger.error("Failed to fetch proposals for auto-select", err as Error));
    } else {
      // Restore previously selected action if user had selected one before closing modal
      const savedAction = baDashboard.selectedActions.get(item.id);
      if (savedAction) {
        handleSelectAction(savedAction, item, true);
      }
    }
  };

  //When user closes the review modal
  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedItem(null);
    setProposalSummary(null);
    setCurrentProposal(null);
    setEvaluation(null);
    setTestResults([]);
    setUserInstruction("");
    setInstructionHistory([]);
    setIsHistoryOpen(false);
  };

  //When user selects an action (Change Code or Change SRS)
  const handleSelectAction = async (action: "code" | "srs", itemOverride?: GapFindingItemInList, loadOnly = false) => {
    const isRegenerate = selectedAction === "srs" && action === "srs";
    setSelectedAction(action, itemOverride);
    const item = itemOverride || selectedItem;
    if (!item) {
      return;
    }

    setProposalSummary(null);
    setCurrentProposal(null);
    setEvaluation(null);
    let summary = "";
    try {
      const proposals = await baDashboard.fetchAgentProposals(item.id);
      const targetType = action === "srs" ? "Change SRS" : "Change Code";
      const proposal = proposals.find((p) => p.proposalType === targetType);

      // Load instruction history before potential early returns
      let instructionToUse = userInstruction;
      if (action === "srs" && !isRegenerate) {
        const history = await baDashboard.fetchSrsInstruction();
        setInstructionHistory(history);
        if (history.length > 0) {
          setUserInstruction(history[0]);
          instructionToUse = history[0];
        }
      }

      if (proposal) {
        setCurrentProposal({ id: proposal.id });
      }

      if (action === "srs") {
        if (loadOnly || !isRegenerate) {
          // First-time action selection OR loading approved item: show saved DB content only
          if (!proposal) {
            setProposalSummary(t("No proposal found. Click Generate to create a suggestion."));
            return;
          }
          summary = proposal.summary;
          if (proposal.evaluation) {
            setEvaluation(proposal.evaluation);
          }
        } else {
          // User explicitly clicked Generate button
          if (userInstruction.trim()) {
            const updated = await baDashboard.saveSrsInstruction(userInstruction);
            setInstructionHistory(updated);
          }
          const result = await baDashboard.fetchSrsChangeSuggestion(
            item.id,
            testResults,
            item.document?.name ?? "",
            instructionToUse,
          );
          summary = result.suggestion;
          setEvaluation(result.evaluation);
          if (result.proposalId) {
            setCurrentProposal({ id: result.proposalId });
          }
        }
      } else {
        if (!proposal) {
          setProposalSummary(t("No proposal found for this action."));
          return;
        }
        summary = "Summary: " + proposal.summary;
      }
      setProposalSummary(summary);
    } catch (error) {
      Logger.error("Failed to fetch agent proposals", error as Error);

      setProposalSummary("Failed to load suggestion.");
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleRefine = async () => {
    if (!selectedItem || !currentProposal?.id || !userInstruction.trim()) {
      return;
    }

    try {
      if (userInstruction.trim()) {
        const updated = await baDashboard.saveSrsInstruction(userInstruction);
        setInstructionHistory(updated);
      }
      const result = await baDashboard.fetchSrsRefineSuggestion(
        selectedItem.id,
        currentProposal.id,
        userInstruction,
        selectedItem.document?.name ?? "",
      );
      setProposalSummary(result.suggestion);
    } catch (error) {
      Logger.error(t("Failed to refine SRS suggestion"), error as Error);
      setProposalSummary(t("Failed to refine suggestion."));
    }
  };

  // Build card description from a test result row (drift detail + citations)
  const buildCardDescription = (tr: typeof testResults[number]): string => {
    const lines: string[] = [];
    const driftDetail = tr.error_message || tr.tag_reason || tr.description || "";
    if (driftDetail) {
      lines.push(`## ${t("Chi tiết sai lệch")}`);
      lines.push(driftDetail);
      lines.push("");
    }
    if (tr.srs?.action || tr.code?.action) {
      lines.push(`## ${t("So sánh EAS")}`);
      if (tr.srs?.action) {
        lines.push(`- **SRS**: ${[tr.srs.actor, tr.srs.event, tr.srs.action].filter(Boolean).join(" · ")}${tr.srs.state ? ` → ${tr.srs.state}` : ""}`);
      }
      if (tr.code?.action) {
        lines.push(`- **Code**: ${[tr.code.actor, tr.code.event, tr.code.action].filter(Boolean).join(" · ")}${tr.code.state ? ` → ${tr.code.state}` : ""}`);
      }
      lines.push("");
    }
    if (tr.srs_references && tr.srs_references.length > 0) {
      lines.push(`## ${t("Trích dẫn SRS")}`);
      for (const ref of tr.srs_references) {
        const fp = ref.file_path || "";
        const parts = fp.split("<#>");
        const title = parts.length >= 2 ? parts[1] : fp;
        lines.push(`- 📄 ${title}${ref.quote ? ` — "${ref.quote}"` : ""}`);
      }
      lines.push("");
    }
    if (tr.code_references && tr.code_references.length > 0) {
      lines.push(`## ${t("Tham chiếu code")}`);
      for (const ref of tr.code_references) {
        const loc = `${ref.file_path || ""}${ref.line ? `:${ref.line}` : ""}`;
        lines.push(`- ${ref.url ? `[${loc}](${ref.url})` : loc}`);
      }
    }
    return lines.join("\n").trim();
  };

  // Approve click → mở modal chọn Kanban destination (không tạo card luôn)
  const handleApprove = () => {
    if (!selectedItem) { return; }
    const actionableRows = testResults.filter((tr) => tr.suggested_action === "change_code" || tr.suggested_action === "change_srs");
    if (actionableRows.length === 0) {
      toast.error(t("Hãy chọn Change Code hoặc Change SRS cho ít nhất 1 dòng trước khi approve"));
      return;
    }

    setSelectedBoardId("");
    setSelectedListId("");
    setIsKanbanDestOpen(true);

    // Auto-load board duy nhất của workspace + fetch lists của nó
    const loadBoardData = async () => {
      setIsLoadingKanban(true);
      try {
        let boards = kanbanBoards.orderedData;
        if (boards.length === 0) {
          await kanbanBoards.fetchPage({ limit: 10 });
          boards = kanbanBoards.orderedData;
        }
        if (boards.length > 0) {
          const board = boards[0];
          setSelectedBoardId(board.id);
          await kanbanBoards.fetchWithDetails(board.id);
        }
      } catch (err) {
        Logger.warn("Failed to load kanban board", err as Error);
      } finally {
        setIsLoadingKanban(false);
      }
    };

    void loadBoardData();
  };

  // Confirm trong modal Kanban destination → thực sự tạo cards + save DB
  const handleConfirmKanbanDest = async () => {
    if (!selectedItem) { return; }
    const actionableRows = testResults.filter((tr) => tr.suggested_action === "change_code" || tr.suggested_action === "change_srs");
    if (!selectedListId) {
      toast.error(t("Hãy chọn cột Kanban đích"));
      return;
    }
    setIsSubmitting(true);
    try {
      const ucName = selectedItem.document?.name || selectedItem.title;
      let createdCount = 0;
      for (const tr of actionableRows) {
        const actionLabel = tr.suggested_action === "change_code" ? t("Change Code") : t("Change SRS");
        const gapLabel = tr.code_to_srs.toUpperCase();
        const title = `[${gapLabel}] ${ucName} — ${actionLabel}`;
        const card = await kanbanCards.create({
          listId: selectedListId,
          title,
          description: buildCardDescription(tr),
          priority: tr.suggested_action === "change_code" ? "High" : "Critical",
        });
        if (card && selectedItem.documentId && tr.suggested_action === "change_srs") {
          try {
            await kanbanCards.addRelatedDocument(card.id, selectedItem.documentId);
          } catch (linkError) {
            Logger.warn("Failed to link document to kanban card", linkError as Error);
          }
        }
        createdCount++;
        // Persist suggestedAction cho audit
        try {
          await baDashboard.updateTestResultAction(tr.id, tr.suggested_action ?? null);
        } catch (err) {
          Logger.warn("Failed to save suggestedAction", err as Error);
        }
      }

      // Record activity (1 lần/gap finding — dùng action chiếm đa số)
      const codeCount = actionableRows.filter((r) => r.suggested_action === "change_code").length;
      const primaryAction = codeCount >= actionableRows.length - codeCount ? "ChangeCode" : "ChangeSRS";
      try {
        await baDashboard.recordActivity(primaryAction, selectedItem.id, selectedItem.documentId || null, null);
      } catch (activityError) {
        Logger.error("Failed to record activity", activityError as Error);
      }

      await baDashboard.updateGapFindingStatus(selectedItem.id, "approved");
      toast.success(t("Đã tạo {{count}} kanban card", { count: createdCount }));
      setIsKanbanDestOpen(false);
      handleCloseModal();
    } catch (error) {
      Logger.error("Failed to process approval", error as Error);
      toast.error(t("Failed to process. Please try again."));
    } finally {
      setIsSubmitting(false);
      fetchData();
      baDashboard.triggerRefresh();
    }
  };

  //When user rejects the approval in detail modal
  const handleReject = () => {
    if (!selectedItem) {
      return;
    }
    dialogs.openModal({
      title: t("Reject Gap Finding"),
      content: (
        <ConfirmationDialog
          onSubmit={async () => {
            setIsSubmitting(true);
            try {
              await baDashboard.updateGapFindingStatus(selectedItem.id, "rejected");
              try {
                await baDashboard.recordActivity(
                  "Reject Proposal From Agent",
                  selectedItem.id,
                  selectedItem.documentId || null,
                  null,
                );
              } catch (activityError) {
                Logger.error("Failed to record activity", activityError as Error);
              }
              toast.success(
                t("Rejected: {{name}}", { name: selectedItem.document?.name })
              );
              handleCloseModal();
            } catch (error) {
              Logger.error("Failed to reject approval", error as Error);
              toast.error(t("Failed to reject. Please try again."));
            } finally {
              setIsSubmitting(false);
              fetchData();
              baDashboard.triggerRefresh();
            }
          }}
          submitText={t("I'm sure – Reject")}
          savingText={t("Rejecting…")}
          danger
        >
          <Text as="p" type="secondary">
            {t("Are you sure you want to reject this gap finding? This action cannot be undone.")}
          </Text>
        </ConfirmationDialog>
      ),
    });
  };

  // Lấy thông tin hiển thị từ cache hoặc từ item data
  const getDisplayInfo = (item: GapFindingItemInList) => {
    const cached = approvalDetails.get(item.documentId);
    if (cached) {
      return cached;
    }
    // Trả về thông tin từ item khi chưa có chi tiết đầy đủ
    return {
      id: item.id,
      documentId: item.documentId,
      title: item.title,
      severity: item.severity,
      createdAt: item.createdAt,
      useCaseName: item.document?.name ?? "",
      urlId: item.document?.urlId,
      pullRequestId: item.pullRequestId,
      description: item.description || t("Click Review to load details"),
      tag: undefined,
    };
  };

  const filteredItems = gapFindingItemInList.filter((item) => {
    const matchesStatus =
      statusFilter === "all" || item.status.toLowerCase() === statusFilter;
    const matchesSearch =
      searchQuery === "" ||
      (item.document?.name || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
      (item.document?.ucId || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.title.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesStatus && matchesSearch;
  });

  if (isLoading) {
    return (
      <Container>
        <Header>
          <Title>{t("Pending Approvals")}</Title>
        </Header>
        <LoadingText>{t("Loading pending approvals...")}</LoadingText>
      </Container>
    );
  }

  // Determine if the selected item's status is finalized (approved/rejected)
  const isStatusFinalized = selectedItem?.status.toLowerCase() === "approved" || selectedItem?.status.toLowerCase() === "rejected";

  return (
    <Container>
      <Header>
        <Title>{t("Gap Findings")}</Title>
      </Header>

      <FilterBar>
        <StatusTabs>
          <StatusTab $active={statusFilter === "all"} onClick={() => setStatusFilter("all")}>
            {t("All")}{statusCounts ? ` (${statusCounts.numberOfApprovedGapFindings + statusCounts.numberOfPendingGapFindings + statusCounts.numberOfRejectedGapFindings})` : ""}
          </StatusTab>
          <StatusTab $active={statusFilter === "approved"} $color="#10b981" onClick={() => setStatusFilter("approved")}>
            {t("Approved")}{statusCounts ? ` (${statusCounts.numberOfApprovedGapFindings})` : ""}
          </StatusTab>
          <StatusTab $active={statusFilter === "pending"} $color="#f59e0b" onClick={() => setStatusFilter("pending")}>
            {t("Pending")}{statusCounts ? ` (${statusCounts.numberOfPendingGapFindings})` : ""}
          </StatusTab>
          <StatusTab $active={statusFilter === "rejected"} $color="#ef4444" onClick={() => setStatusFilter("rejected")}>
            {t("Rejected")}{statusCounts ? ` (${statusCounts.numberOfRejectedGapFindings})` : ""}
          </StatusTab>
        </StatusTabs>
        <SearchInput
          type="text"
          placeholder={t("Search by gap name or document name..")}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </FilterBar>

      {filteredItems.length === 0 ? (
        <EmptyText>{statusFilter === "all" && searchQuery === "" ? t("No pending approvals") : t("No items match the current filter")}</EmptyText>
      ) : (
        <ApprovalsList>
          {filteredItems.map((item) => {
            const displayInfo = getDisplayInfo(item);
            const prMeta = parsePrMeta(item.description);
            return (
              <ApprovalCard key={item.id}>
                <CardLeft>
                  <CardContent>
                    <CardTitle>{displayInfo.title}</CardTitle>
                    {item.document && (
                      <CardMeta>
                        <UsecaseIdTag
                          onClick={async () => {
                            if (item.document?.urlId) {
                              history.push(`/doc/untitled-${item.document.urlId}`);
                            }
                          }}
                          $clickable={!!item.document?.urlId}
                        >
                          {item.document.name}
                        </UsecaseIdTag>
                      </CardMeta>
                    )}
                    {prMeta?.test_counts && (
                      <CardMeta>
                        <TestCountBadge $color="#10b981">✓ {prMeta.test_counts.matching}</TestCountBadge>
                        <TestCountBadge $color="#ef4444">✗ {prMeta.test_counts.mismatch}</TestCountBadge>
                        <TestCountBadge $color="#f59e0b">? {prMeta.test_counts.missing}</TestCountBadge>
                        {prMeta.surplus_count > 0 && (
                          <TestCountBadge $color="#8b5cf6">+ {prMeta.surplus_count} surplus</TestCountBadge>
                        )}
                      </CardMeta>
                    )}
                    {prMeta?.error_summary && (
                      <CardSummary>{prMeta.error_summary}</CardSummary>
                    )}
                    <CardDescription>{formatToVietnamTime(displayInfo.createdAt)}</CardDescription>
                  </CardContent>
                </CardLeft>
                <CardActions>
                  <DeleteButton
                    onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(item.id); }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                      <path d="M10 11v6M14 11v6" />
                      <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
                    </svg>
                  </DeleteButton>
                  <ReviewButton onClick={() => handleReview(item)}>
                    <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
                      <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
                      <path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" />
                    </svg>
                  </ReviewButton>
                </CardActions>
              </ApprovalCard>
            );
          })}
        </ApprovalsList>
      )}

      {/* Review Modal */}
      {isModalOpen && selectedItem && (
        <ModalOverlay onClick={handleCloseModal}>
          <ModalContent onClick={(e) => e.stopPropagation()}>
            <ModalHeader>
              <ModalHeaderLeft>
                <ModalIconWrap>
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                  </svg>
                </ModalIconWrap>
                <ModalTitleGroup>
                  <ModalTitle>{t("Drift Analysis Detail")}</ModalTitle>
                  <ModalSubtitle>{t("Review and select recommended actions")}</ModalSubtitle>
                </ModalTitleGroup>
              </ModalHeaderLeft>
              <CloseButton onClick={handleCloseModal}>
                <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </CloseButton>
            </ModalHeader>

            {/* Meta Info Bar */}
            <ModalMetaBar>
              <MetaItem>
                <MetaLabel>{t("Title")}</MetaLabel>
                <MetaValue>{selectedItem.title}</MetaValue>
              </MetaItem>
              <MetaDivider />
              <MetaItem>
                <MetaLabel>{t("Severity")}</MetaLabel>
                <SeverityBadge $severity={selectedItem.severity}>{selectedItem.severity.toLocaleUpperCase()}</SeverityBadge>
              </MetaItem>
              {selectedItem.document && (
                <>
                  <MetaDivider />
                  <MetaItem>
                    <MetaLabel>{t("Use Case")}</MetaLabel>
                    <MetaValue>{selectedItem.document?.name}</MetaValue>
                  </MetaItem>
                </>
              )}
              <MetaDivider />
              <MetaItem>
                <MetaLabel>{t("Created")}</MetaLabel>
                <MetaValue>{formatToVietnamTime(selectedItem.createdAt)}</MetaValue>
              </MetaItem>
              <MetaItem>
                <MetaLabel>{t("Status")}</MetaLabel>
                <StatusBadge $status={selectedItem.status}>{selectedItem.status.toLocaleUpperCase()}</StatusBadge>
              </MetaItem>
            </ModalMetaBar>

            <ModalBody>
              {/* Comparison Section */}
              <ComparisonSection>
                <ComparisonColumn $accent="#4F7CFF">
                  <ComparisonHeader>
                    <ComparisonIcon $color="#4F7CFF">
                      <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M12.316 3.051a1 1 0 01.633 1.265l-4 12a1 1 0 11-1.898-.632l4-12a1 1 0 011.265-.633zM5.707 6.293a1 1 0 010 1.414L3.414 10l2.293 2.293a1 1 0 11-1.414 1.414l-3-3a1 1 0 010-1.414l3-3a1 1 0 011.414 0zm8.586 0a1 1 0 011.414 0l3 3a1 1 0 010 1.414l-3 3a1 1 0 11-1.414-1.414L16.586 10l-2.293-2.293a1 1 0 010-1.414z" clipRule="evenodd" />
                      </svg>
                    </ComparisonIcon>
                    <ComparisonTitle>{t("Source Code (Pull Request ID)")}</ComparisonTitle>
                  </ComparisonHeader>
                  <ComparisonContent>
                    {(() => {
                      // pullRequestId chỉ là số PR (e.g. "1") chứ không phải URL — phải build
                      // URL GitHub đầy đủ từ description.repo + description.pr_id, nếu không
                      // browser sẽ resolve "1" thành relative path của origin hiện tại.
                      const prMeta = parsePrMeta(selectedItem.description);
                      const githubUrl = prMeta?.repo && prMeta?.pr_id
                        ? `https://github.com/${prMeta.repo}/pull/${prMeta.pr_id}`
                        : null;
                      const displayNumber = prMeta?.pr_id
                        ? String(prMeta.pr_id)
                        : (selectedItem.pullRequestId ? extractPrNumber(selectedItem.pullRequestId) : "");
                      if (githubUrl) {
                        return (
                          <a
                            href={githubUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: "#4F7CFF", textDecoration: "underline", cursor: "pointer" }}
                          >
                            #{displayNumber}
                          </a>
                        );
                      }
                      if (displayNumber) {
                        return <>#{displayNumber}</>;
                      }
                      return t("No data available");
                    })()}
                  </ComparisonContent>
                </ComparisonColumn>
                <ComparisonColumn $accent="#4F7CFF">
                  <ComparisonHeader>
                    <ComparisonIcon $color="#4F7CFF">
                      <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
                      </svg>
                    </ComparisonIcon>
                    <ComparisonTitle>{t("Corresponding document")}</ComparisonTitle>
                  </ComparisonHeader>
                  {(() => {
                    type DocEntry = { url: string; title: string; docId: string; dedupeKey: string };
                    const seen = new Set<string>();
                    const docs: DocEntry[] = [];

                    for (const tr of testResults) {
                      for (const ref of tr.srs_references || []) {
                        // Ưu tiên fields đã được server enrich (document_url, document_title, document_id)
                        const enrichedUrl   = (ref as any).document_url   || "";
                        const enrichedTitle = (ref as any).document_title || "";
                        const enrichedId    = (ref as any).document_id    || "";

                        // Backward compat: parse file_path cũ "{docId}<#>{filename}"
                        const fp = ref.file_path || "";
                        const parts = fp.split("<#>");
                        const legacyDocId = parts.length >= 2 ? parts[0] : "";
                        const legacyTitle = parts.length >= 2 ? parts[1] : fp;

                        const title     = enrichedTitle || legacyTitle || fp;
                        const docId     = enrichedId    || legacyDocId;
                        const url       = enrichedUrl;
                        const dedupeKey = enrichedUrl || enrichedId || fp;

                        if (!dedupeKey || seen.has(dedupeKey)) { continue; }
                        seen.add(dedupeKey);
                        docs.push({ url, title, docId, dedupeKey });
                      }
                    }

                    // Fallback: document gắn với gap finding nếu không có citation nào
                    if (docs.length === 0 && selectedItem.document?.urlId) {
                      return (
                        <ComparisonContentLink
                          onClick={() => history.push(`/doc/untitled-${selectedItem.document?.urlId}`)}
                          $clickable
                        >
                          {selectedItem.document?.name}
                          <LinkIcon>
                            <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor">
                              <path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z" />
                              <path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z" />
                            </svg>
                          </LinkIcon>
                        </ComparisonContentLink>
                      );
                    }
                    if (docs.length === 0) {
                      return <ComparisonContent>{t("No suggestion")}</ComparisonContent>;
                    }
                    return (
                      <CorrespondingDocList>
                        {docs.map((d) => (
                          <CorrespondingDocItem
                            key={d.dedupeKey}
                            onClick={async () => {
                              // Ưu tiên document_url từ server (chính xác, không cần fetch)
                              if (d.url) {
                                history.push(d.url);
                                return;
                              }
                              // Fallback: fetch qua docId (legacy rows)
                              if (!d.docId) { return; }
                              try {
                                const doc = await documents.fetch(d.docId);
                                if (doc) {
                                  history.push(documentPath(doc));
                                } else {
                                  toast.error(t("Không tìm thấy tài liệu \"{{title}}\"", { title: d.title }));
                                }
                              } catch {
                                toast.error(t("Không thể mở tài liệu"));
                              }
                            }}
                            $clickable={!!(d.url || d.docId)}
                          >
                            📄 {d.title}
                            {(d.url || d.docId) && (
                              <LinkIcon>
                                <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor">
                                  <path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z" />
                                  <path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z" />
                                </svg>
                              </LinkIcon>
                            )}
                          </CorrespondingDocItem>
                        ))}
                      </CorrespondingDocList>
                    );
                  })()}
                </ComparisonColumn>
              </ComparisonSection>

              {/* Test Results Section */}
              <Section>
                <SectionHeader>
                  <SectionTitle>{t("Test Results Against New Code in Pull Request")}</SectionTitle>
                </SectionHeader>
                {isLoadingTestResults ? (
                  <DriftAnalysisBox>{t("Loading test results...")}</DriftAnalysisBox>
                ) : testResults.length === 0 ? (
                  <DriftAnalysisBox>{t("No test results available")}</DriftAnalysisBox>
                ) : (
                  <TestResultsTable>
                    <TestResultsHeader>
                      <TestResultsHeaderCell style={{ flex: "0 0 48px" }}>{t("STT")}</TestResultsHeaderCell>
                      <TestResultsHeaderCell style={{ flex: 3 }}>{t("SRS mô tả")}</TestResultsHeaderCell>
                      <TestResultsHeaderCell style={{ flex: 3 }}>{t("Code thực tế")}</TestResultsHeaderCell>
                      <TestResultsHeaderCell style={{ flex: "0 0 120px" }}>{t("Tag")}</TestResultsHeaderCell>
                      <TestResultsHeaderCell style={{ flex: "0 0 160px" }}>{t("Hành động")}</TestResultsHeaderCell>
                      <TestResultsHeaderCell style={{ flex: "0 0 140px" }}>{t("Chi tiết sai lệch")}</TestResultsHeaderCell>
                    </TestResultsHeader>
                    {testResults.map((tr, idx) => {
                      const isExpanded = expandedTestIds.has(tr.id);
                      const hasDetail = !!(
                        tr.error_message ||
                        tr.tag_reason ||
                        (tr.srs_references && tr.srs_references.length > 0) ||
                        (tr.code_references && tr.code_references.length > 0) ||
                        tr.test_code
                      );
                      const stt = tr.step_number ?? (idx + 1);
                      const srsAction = tr.srs?.action || tr.description || "—";
                      const srsSub = [tr.srs?.actor, tr.srs?.event].filter(Boolean).join(" · ");
                      const srsState = tr.srs?.state;
                      const srsGuard = tr.srs?.guard_br;
                      const codeAction = tr.code?.action || tr.assertion_logic || "—";
                      const codeSub = [tr.code?.actor, tr.code?.event].filter(Boolean).join(" · ");
                      const codeState = tr.code?.state;
                      const codeGuard = tr.code?.guard;
                      return (
                        <React.Fragment key={tr.id}>
                          <TestResultsRow
                            onClick={() => setExpandedTestIds(prev => { const next = new Set(prev); isExpanded ? next.delete(tr.id) : next.add(tr.id); return next; })}
                            style={{ cursor: hasDetail ? "pointer" : "default" }}
                          >
                            <TestResultsCell style={{ flex: "0 0 48px", fontWeight: 600, color: "#6b7280" }}>
                              {stt}
                            </TestResultsCell>
                            <TestResultsCell style={{ flex: 3 }}>
                              {srsSub && <EasSubline>{srsSub}</EasSubline>}
                              <div>{srsAction}</div>
                              {srsState && <EasStateLine>→ {srsState}</EasStateLine>}
                              {srsGuard && <EasGuardLine>[Guard/BR] {srsGuard}</EasGuardLine>}
                            </TestResultsCell>
                            <TestResultsCell style={{ flex: 3 }}>
                              {codeSub && <EasSubline>{codeSub}</EasSubline>}
                              <div>{codeAction}</div>
                              {codeState && <EasStateLine>→ {codeState}</EasStateLine>}
                              {codeGuard && codeGuard !== "—" && <EasGuardLine>[Guard] {codeGuard}</EasGuardLine>}
                            </TestResultsCell>
                            <TestResultsCell style={{ flex: "0 0 120px" }}>
                              <CodeToSrsBadge $value={tr.code_to_srs}>{tr.code_to_srs}</CodeToSrsBadge>
                            </TestResultsCell>
                            <TestResultsCell style={{ flex: "0 0 160px" }} onClick={(e) => e.stopPropagation()}>
                              <ActionSelect
                                value={tr.suggested_action || ""}
                                disabled={isStatusFinalized}
                                onChange={(e) => {
                                  const val = e.target.value as "" | "change_code" | "change_srs";
                                  const next = val === "" ? null : val;
                                  // Chỉ update local — save khi ấn Approve
                                  setTestResults((prev) => prev.map((x) => x.id === tr.id ? { ...x, suggested_action: next } : x));
                                }}
                              >
                                <option value="">— {t("Không sửa")} —</option>
                                <option value="change_code">{t("Change Code")}</option>
                                <option value="change_srs">{t("Change SRS")}</option>
                              </ActionSelect>
                            </TestResultsCell>
                            <TestResultsCell style={{ flex: "0 0 140px", display: "flex", gap: 6, alignItems: "center", color: hasDetail ? undefined : "#9ca3af" }}>
                              {hasDetail ? (
                                <>
                                  <span style={{ fontSize: 12 }}>{isExpanded ? t("Thu gọn") : t("Xem chi tiết")}</span>
                                  <ExpandIcon $expanded={isExpanded}>▼</ExpandIcon>
                                </>
                              ) : (
                                <span style={{ fontSize: 12 }}>—</span>
                              )}
                            </TestResultsCell>
                          </TestResultsRow>
                          {isExpanded && hasDetail && (
                            <TestDetailRow>
                              {(tr.error_message || tr.tag_reason) && (
                                <TestDetailBox $type={tr.code_to_srs === "match" ? "reason" : "error"}>
                                  <TestDetailLabel>{t("Chi tiết sai lệch")}</TestDetailLabel>
                                  <TestDetailText>{tr.error_message || tr.tag_reason}</TestDetailText>
                                </TestDetailBox>
                              )}
                              {tr.srs_references && tr.srs_references.length > 0 && (
                                <TestDetailBox $type="reason">
                                  <TestDetailLabel>{t("Trích dẫn SRS")}</TestDetailLabel>
                                  {tr.srs_references.map((ref, i) => {
                                    // Ưu tiên fields enriched từ server
                                    const enrichedUrl   = (ref as any).document_url   || "";
                                    const enrichedTitle = (ref as any).document_title || "";
                                    const enrichedId    = (ref as any).document_id    || "";

                                    // Backward compat: parse file_path cũ "{docId}<#>{filename}"
                                    const fp = ref.file_path || "";
                                    const parts = fp.split("<#>");
                                    const legacyDocId = parts.length >= 2 ? parts[0] : "";
                                    const legacyTitle = parts.length >= 2 ? parts[1] : fp;

                                    const displayTitle = enrichedTitle || legacyTitle || fp;
                                    const docUrl       = enrichedUrl;
                                    const docId        = enrichedId || legacyDocId;
                                    const canNavigate  = !!(docUrl || docId);

                                    const openDoc = async (e: React.MouseEvent) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      // Dùng document_url trực tiếp nếu có
                                      if (docUrl) {
                                        history.push(docUrl, { highlightText: ref.quote });
                                        return;
                                      }
                                      if (!docId) { return; }
                                      try {
                                        const doc = await documents.fetch(docId);
                                        if (doc) {
                                          history.push(documentPath(doc), { highlightText: ref.quote });
                                        } else {
                                          toast.error(t("Không tìm thấy tài liệu \"{{title}}\"", { title: displayTitle }));
                                        }
                                      } catch {
                                        toast.error(t("Không thể mở tài liệu"));
                                      }
                                    };
                                    return (
                                      <SrsQuoteBlock key={i}>
                                        <SrsQuoteText>"{ref.quote}"</SrsQuoteText>
                                        {displayTitle && (
                                          canNavigate ? (
                                            <SrsQuoteLink onClick={openDoc}>
                                              📄 {displayTitle}
                                            </SrsQuoteLink>
                                          ) : (
                                            <SrsQuoteSource>— {displayTitle}</SrsQuoteSource>
                                          )
                                        )}
                                      </SrsQuoteBlock>
                                    );
                                  })}
                                </TestDetailBox>
                              )}
                              {tr.code_references && tr.code_references.length > 0 && (
                                <TestDetailBox $type="code">
                                  <TestDetailLabel>{t("Tham chiếu code")}</TestDetailLabel>
                                  {tr.code_references.map((ref, i) => (
                                    <CodeRefRow key={i}>
                                      {ref.url ? (
                                        <CodeRefLink href={ref.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
                                          {ref.file_path}{ref.line ? `:${ref.line}` : ""}
                                          {ref.repo && <CodeRefRepo>{ref.repo}</CodeRefRepo>}
                                        </CodeRefLink>
                                      ) : (
                                        <CodeRefText>{ref.file_path}{ref.line ? `:${ref.line}` : ""}</CodeRefText>
                                      )}
                                      {ref.snippet && <CodeRefSnippet>{ref.snippet}</CodeRefSnippet>}
                                    </CodeRefRow>
                                  ))}
                                </TestDetailBox>
                              )}
                              {tr.test_code && (
                                <TestDetailBox $type="code">
                                  <TestDetailLabel>Test Code {tr.duration_ms ? `(${tr.duration_ms.toFixed(0)}ms)` : ""}</TestDetailLabel>
                                  <TestCodeBlock>{tr.test_code}</TestCodeBlock>
                                </TestDetailBox>
                              )}
                            </TestDetailRow>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </TestResultsTable>
                )}
              </Section>

              {/* Drift Analysis Section */}
              <Section>
                <SectionHeader>
                  <SectionTitle>{t("Gap Analysis Summary")}</SectionTitle>
                </SectionHeader>
                {(() => {
                  const prMeta = parsePrMeta(selectedItem.description);
                  if (prMeta) {
                    return (
                      <>
                        <PrMetaRow>
                          <PrMetaBadge>{prMeta.repo_type === "frontend" ? "Frontend" : "Backend"}</PrMetaBadge>
                          <PrMetaBadge>PR #{prMeta.pr_id}</PrMetaBadge>
                          <PrMetaBadge $color="#10b981">✓ {prMeta.test_counts.matching} matching</PrMetaBadge>
                          <PrMetaBadge $color="#ef4444">✗ {prMeta.test_counts.mismatch} mismatch</PrMetaBadge>
                          <PrMetaBadge $color="#f59e0b">? {prMeta.test_counts.missing} missing</PrMetaBadge>
                          {prMeta.surplus_count > 0 && (
                            <PrMetaBadge $color="#8b5cf6">+ {prMeta.surplus_count} surplus</PrMetaBadge>
                          )}
                        </PrMetaRow>
                        <DriftAnalysisBox style={{ whiteSpace: "pre-wrap" }}>
                          {prMeta.error_summary || t("No issues detected")}
                        </DriftAnalysisBox>
                      </>
                    );
                  }
                  return (
                    <DriftAnalysisBox>
                      {selectedItem.description || t("No drift analysis available")}
                    </DriftAnalysisBox>
                  );
                })()}
              </Section>
            </ModalBody>
            {!isStatusFinalized && (
              <ModalFooter>
                <CancelButton onClick={handleReject}>{t("Reject")}</CancelButton>
                <ApproveButton onClick={handleApprove} disabled={isSubmitting}>
                  {isSubmitting ? t("Processing...") : t("Approve")}
                </ApproveButton>
              </ModalFooter>
            )}
          </ModalContent>
        </ModalOverlay>
      )}

      {/* Kanban Destination Modal (hiện khi ấn Approve) */}
      {isKanbanDestOpen && (
        <ModalOverlay onClick={() => !isSubmitting && !isLoadingKanban && setIsKanbanDestOpen(false)}>
          <DeleteConfirmModal onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
            <DeleteConfirmTitle>{t("Chọn cột Kanban đích")}</DeleteConfirmTitle>
            <DeleteConfirmDesc>
              {t("Các dòng đã chọn Change Code / Change SRS sẽ được tạo thành card trong cột bên dưới.")}
            </DeleteConfirmDesc>

            {isLoadingKanban ? (
              <KanbanLoadingRow>
                <KanbanSpinner />
                <span>{t("Đang tải danh sách cột...")}</span>
              </KanbanLoadingRow>
            ) : !selectedBoardId ? (
              <KanbanEmptyState>
                <KanbanEmptyIcon>⚠️</KanbanEmptyIcon>
                <div>{t("Workspace chưa có kanban board.")}</div>
                <KanbanEmptyHint>{t("Vui lòng tạo board trước tại trang Kanban.")}</KanbanEmptyHint>
              </KanbanEmptyState>
            ) : (
              <>
                <KanbanBoardInfo>
                  <KanbanBoardInfoLabel>{t("Board")}</KanbanBoardInfoLabel>
                  <KanbanBoardInfoValue>{kanbanBoards.get(selectedBoardId)?.name ?? "—"}</KanbanBoardInfoValue>
                </KanbanBoardInfo>
                <KanbanColumnSelectorWrapper>
                  <KanbanSelectorLabel htmlFor="kanban-col-select">{t("Cột đích")}</KanbanSelectorLabel>
                  {(() => {
                    const boardLists = kanbanLists.orderedData.filter((l) => l.boardId === selectedBoardId);
                    if (boardLists.length === 0) {
                      return (
                        <KanbanEmptyState style={{ marginTop: 8 }}>
                          <KanbanEmptyIcon>📭</KanbanEmptyIcon>
                          <div>{t("Board chưa có cột nào.")}</div>
                          <KanbanEmptyHint>{t("Vui lòng thêm cột vào board trước.")}</KanbanEmptyHint>
                        </KanbanEmptyState>
                      );
                    }
                    return (
                      <KanbanColumnSelect
                        id="kanban-col-select"
                        value={selectedListId}
                        onChange={(e) => setSelectedListId(e.target.value)}
                      >
                        <option value="">— {t("Chọn cột")} —</option>
                        {boardLists.map((l) => (
                          <option key={l.id} value={l.id}>{l.name}</option>
                        ))}
                      </KanbanColumnSelect>
                    );
                  })()}
                </KanbanColumnSelectorWrapper>
              </>
            )}

            <DeleteConfirmActions style={{ marginTop: 20 }}>
              <CancelDeleteBtn onClick={() => setIsKanbanDestOpen(false)} disabled={isSubmitting || isLoadingKanban}>
                {t("Hủy")}
              </CancelDeleteBtn>
              <ConfirmDeleteBtn
                onClick={handleConfirmKanbanDest}
                disabled={isSubmitting || isLoadingKanban || !selectedBoardId || !selectedListId}
                style={{ background: "#10b981" }}
              >
                {isSubmitting ? t("Đang xử lý...") : t("Tạo cards & Approve")}
              </ConfirmDeleteBtn>
            </DeleteConfirmActions>
          </DeleteConfirmModal>
        </ModalOverlay>
      )}

      {/* Delete Confirm Modal */}
      {confirmDeleteId && (
        <ModalOverlay onClick={() => setConfirmDeleteId(null)}>
          <DeleteConfirmModal onClick={(e) => e.stopPropagation()}>
            <DeleteConfirmIconWrap>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                <path d="M10 11v6M14 11v6" />
                <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
              </svg>
            </DeleteConfirmIconWrap>
            <DeleteConfirmTitle>Delete Gap Finding</DeleteConfirmTitle>
            <DeleteConfirmDesc>
              This gap finding and all associated test results will be permanently removed.
              This action <strong>cannot be undone</strong>.
            </DeleteConfirmDesc>
            <DeleteConfirmActions>
              <CancelDeleteBtn onClick={() => setConfirmDeleteId(null)}>Cancel</CancelDeleteBtn>
              <ConfirmDeleteBtn onClick={() => handleDelete(confirmDeleteId)}>Delete</ConfirmDeleteBtn>
            </DeleteConfirmActions>
          </DeleteConfirmModal>
        </ModalOverlay>
      )}
    </Container>
  );
};

const Container = styled.div`
  background: ${(props) => props.theme.background};
  border-radius: 12px;
  padding: 24px;
  box-shadow: ${(props) => props.theme.isDark ? 'none' : '0 1px 3px rgba(0, 0, 0, 0.05), 0 1px 2px rgba(0, 0, 0, 0.03)'};
  border: 1px solid ${(props) => props.theme.divider};
  min-width: 0;
  overflow: hidden;

  @media (max-width: 1345px) {
    padding: 20px;
  }

  @media (max-width: 1280px) {
    padding: 18px;
  }

  @media (max-width: 1200px) {
    padding: 17px;
  }

  @media (max-width: 1100px) {
    padding: 14px;
  }

  @media (max-width: 1024px) {
    padding: 12px;
  }

  @media (max-width: 768px) {
    padding: 16px;
    border-radius: 10px;
  }
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
`;

const Title = styled.h2`
  font-size: 18px;
  font-weight: 600;
  color: ${(props) => props.theme.text};
  margin: 0;
  white-space: nowrap;

  @media (max-width: 768px) {
    font-size: 16px;
  }
`;

const FilterBar = styled.div`
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 16px;
  flex-wrap: wrap;

  @media (max-width: 768px) {
    flex-direction: column;
    align-items: stretch;
    gap: 12px;
  }
`;

const StatusTabs = styled.div`
  display: flex;
  gap: 6px;
  flex-shrink: 0;
`;

const StatusTab = styled.button<{ $active?: boolean; $color?: string }>`
  padding: 6px 14px;
  border-radius: 20px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  border: 1.5px solid ${(props) => (props.$active ? props.$color || "#4F7CFF" : props.theme.divider)};
  background-color: ${(props) => (props.$active ? (props.$color ? props.$color + "14" : "rgba(79, 124, 255, 0.08)") : props.theme.background)};
  color: ${(props) => (props.$active ? props.$color || "#4F7CFF" : props.theme.textTertiary)};

  &:hover {
    border-color: ${(props) => props.$color || "#4F7CFF"};
    color: ${(props) => props.$color || "#4F7CFF"};
  }

  @media (max-width: 1024px) {
    padding: 5px 12px;
    font-size: 12px;
  }
`;

const SearchInput = styled.input`
  flex: 1;
  min-width: 180px;
  padding: 8px 14px;
  border: 1.5px solid ${(props) => props.theme.inputBorder};
  border-radius: 8px;
  font-size: 13px;
  color: ${(props) => props.theme.text};
  background-color: ${(props) => props.theme.backgroundSecondary};
  transition: all 0.2s ease;
  outline: none;

  &::placeholder {
    color: ${(props) => props.theme.placeholder};
  }

  &:focus {
    border-color: ${(props) => props.theme.inputBorderFocused};
    background-color: ${(props) => props.theme.background};
    box-shadow: 0 0 0 3px rgba(79, 124, 255, 0.1);
  }

  @media (max-width: 1024px) {
    padding: 7px 12px;
    font-size: 12px;
    min-width: 140px;
  }

  @media (max-width: 768px) {
    width: 100%;
  }
`;

const ApprovalsList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-height: 520px;
  overflow-y: auto;
  padding-right: 4px;

  &::-webkit-scrollbar {
    width: 4px;
  }

  &::-webkit-scrollbar-track {
    background: transparent;
  }

  &::-webkit-scrollbar-thumb {
    background-color: ${(props) => props.theme.scrollbarThumb};
    border-radius: 4px;
  }
`;

const LoadingText = styled.p`
  font-size: 14px;
  color: ${(props) => props.theme.textTertiary};
  text-align: center;
  padding: 40px 0;
`;

const EmptyText = styled.p`
  font-size: 14px;
  color: ${(props) => props.theme.textTertiary};
  text-align: center;
  padding: 40px 0;
`;

const UsecaseIdTag = styled.p<{ $clickable?: boolean }>`
  font-size: 12px;
  color: #7c3aed;
  background-color: rgba(124, 58, 237, 0.1);
  padding: 2px 8px;
  border-radius: 4px;
  font-family: 'Monaco', 'Menlo', monospace;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
  cursor: ${(props) => (props.$clickable ? "pointer" : "default")};
  transition: all 0.2s ease;

  ${(props) => props.$clickable && `
    &:hover {
      background-color: rgba(124, 58, 237, 0.2);
      text-decoration: underline;
    }
  `}

  @media (max-width: 1024px) {
    font-size: 11px;
    padding: 2px 6px;
  }
`;

const ApprovalCard = styled.div`
  display: flex;
  align-items: stretch;
  justify-content: space-between;
  padding: 14px 16px;
  background-color: ${(props) => props.theme.backgroundSecondary};
  border-radius: 10px;
  border: 1px solid ${(props) => props.theme.divider};
  transition: all 0.2s ease;
  min-width: 0;

  &:hover {
    background-color: ${(props) => props.theme.listItemHoverBackground};
    border-color: ${(props) => props.theme.inputBorder};
  }

  @media (max-width: 1024px) {
    padding: 12px;
  }

  @media (max-width: 480px) {
    flex-direction: column;
    align-items: stretch;
    gap: 12px;
  }
`;

const CardLeft = styled.div`
  display: flex;
  gap: 14px;
  flex: 1;
  min-width: 0;

  @media (max-width: 1024px) {
    gap: 12px;
  }
`;

const CardContent = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
  min-width: 0;
  overflow: hidden;
`;

const CardTitle = styled.h3`
  font-size: 14px;
  font-weight: 600;
  color: ${(props) => props.theme.text};
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;

  @media (max-width: 1024px) {
    font-size: 13px;
  }
`;

const CardMeta = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
`;

const CardDescription = styled.p`
  font-size: 13px;
  color: ${(props) => props.theme.textTertiary};
  margin: 0;
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-overflow: ellipsis;
  word-break: break-word;
`;

const CardSummary = styled.p`
  font-size: 12px;
  color: ${(props) => props.theme.textSecondary};
  margin: 2px 0 0;
  line-height: 1.4;
  max-width: 560px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-overflow: ellipsis;
  word-break: break-word;
`;

const TestCountBadge = styled.span<{ $color?: string }>`
  font-size: 11px;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 10px;
  color: ${(props) => props.$color || props.theme.textSecondary};
  background-color: ${(props) => (props.$color ? props.$color + "18" : props.theme.backgroundSecondary)};
  border: 1px solid ${(props) => (props.$color ? props.$color + "40" : props.theme.divider)};
`;

const PrMetaRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
`;

const PrMetaBadge = styled.span<{ $color?: string }>`
  font-size: 12px;
  font-weight: 600;
  padding: 3px 10px;
  border-radius: 12px;
  color: ${(props) => props.$color || props.theme.textSecondary};
  background-color: ${(props) => (props.$color ? props.$color + "18" : props.theme.backgroundSecondary)};
  border: 1px solid ${(props) => (props.$color ? props.$color + "40" : props.theme.divider)};
`;

const ReviewButton = styled.button`
  width: 36px;
  height: 36px;
  background-color: rgba(79, 124, 255, 0.1);
  color: #4F7CFF;
  border: none;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  cursor: pointer;
  transition: background-color 0.2s ease;

  &:hover {
    background-color: rgba(79, 124, 255, 0.2);
  }

  &:active {
    transform: translateY(0);
  }
`;

const CardActions = styled.div`
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  justify-content: space-between;
  flex-shrink: 0;
  margin-left: 16px;
  padding-bottom: 6px;
`;

const DeleteButton = styled.button`
  width: 36px;
  height: 36px;
  border-radius: 8px;
  background-color: rgba(239, 68, 68, 0.1);
  color: #ef4444;
  border: none;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  cursor: pointer;
  transition: background-color 0.2s ease;

  &:hover {
    background-color: rgba(239, 68, 68, 0.2);
  }
`;

const DeleteConfirmModal = styled.div`
  background: ${(props) => props.theme.modalBackground};
  border-radius: 14px;
  padding: 36px 32px 28px;
  width: 400px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255,255,255,0.06);
`;

const DeleteConfirmIconWrap = styled.div`
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: rgba(239, 68, 68, 0.12);
  border: 1px solid rgba(239, 68, 68, 0.25);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #ef4444;
  margin-bottom: 20px;
`;

const DeleteConfirmTitle = styled.h3`
  margin: 0 0 10px;
  font-size: 18px;
  font-weight: 700;
  color: ${(props) => props.theme.text};
  text-align: center;
`;

const DeleteConfirmDesc = styled.p`
  margin: 0 0 28px;
  font-size: 13.5px;
  color: ${(props) => props.theme.textSecondary};
  text-align: center;
  line-height: 1.6;

  strong {
    color: ${(props) => props.theme.text};
    font-weight: 600;
  }
`;

const DeleteConfirmActions = styled.div`
  display: flex;
  gap: 10px;
  width: 100%;
`;

const CancelDeleteBtn = styled.button`
  flex: 1;
  padding: 10px 0;
  font-size: 14px;
  font-weight: 500;
  border-radius: 8px;
  border: 1px solid ${(props) => props.theme.divider};
  background: transparent;
  color: ${(props) => props.theme.textSecondary};
  cursor: pointer;
  transition: background 0.15s;
  &:hover { background-color: ${(props) => props.theme.listItemHoverBackground}; }
`;

const ConfirmDeleteBtn = styled.button`
  flex: 1;
  padding: 10px 0;
  font-size: 14px;
  font-weight: 600;
  border-radius: 8px;
  border: none;
  background-color: #ef4444;
  color: white;
  cursor: pointer;
  transition: background 0.15s, box-shadow 0.15s;
  &:hover {
    background-color: #dc2626;
    box-shadow: 0 4px 12px rgba(239, 68, 68, 0.35);
  }
`;

/* Modal Styles */
const ModalOverlay = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: ${(props) => props.theme.modalBackdrop};
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  animation: fadeIn 0.2s ease;

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }
`;

const ModalContent = styled.div`
  background: ${(props) => props.theme.modalBackground};
  border-radius: 16px;
  width: 90%;
  max-width: 1200px;
  max-height: 85vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-shadow: ${(props) => props.theme.modalShadow};
  animation: slideUp 0.3s ease;

  @keyframes slideUp {
    from {
      opacity: 0;
      transform: translateY(20px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @media (max-width: 1024px) {
    width: 95%;
    max-width: 700px;
  }

  @media (max-width: 768px) {
    width: 95%;
    max-height: 90vh;
    border-radius: 12px;
  }
`;

const ModalHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px;
  border-bottom: 1px solid ${(props) => props.theme.divider};
  background: ${(props) => props.theme.backgroundSecondary};

  @media (max-width: 768px) {
    padding: 16px;
  }
`;

const ModalHeaderLeft = styled.div`
  display: flex;
  align-items: center;
  gap: 14px;
  min-width: 0;
`;

const ModalIconWrap = styled.div`
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background: linear-gradient(135deg, #4F7CFF, #3b6ce7);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;

  @media (max-width: 480px) {
    width: 34px;
    height: 34px;
  }
`;

const ModalTitleGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
`;

const ModalTitle = styled.h2`
  font-size: 17px;
  font-weight: 700;
  color: ${(props) => props.theme.text};
  margin: 0;

  @media (max-width: 768px) {
    font-size: 15px;
  }

  @media (max-width: 480px) {
    font-size: 14px;
  }
`;

const ModalSubtitle = styled.span`
  font-size: 12px;
  color: ${(props) => props.theme.textTertiary};
  font-weight: 400;
`;

const CloseButton = styled.button`
  background: none;
  border: 1px solid ${(props) => props.theme.divider};
  border-radius: 8px;
  width: 36px;
  height: 36px;
  color: ${(props) => props.theme.textTertiary};
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
  flex-shrink: 0;

  &:hover {
    color: ${(props) => props.theme.text};
    background-color: ${(props) => props.theme.listItemHoverBackground};
    border-color: ${(props) => props.theme.inputBorder};
  }
`;

const ModalMetaBar = styled.div`
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 14px 24px;
  background-color: ${(props) => props.theme.backgroundSecondary};
  border-bottom: 1px solid ${(props) => props.theme.divider};
  flex-wrap: wrap;

  @media (max-width: 768px) {
    padding: 12px 16px;
    gap: 12px;
  }

  @media (max-width: 480px) {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }
`;

const MetaItem = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
`;

const MetaLabel = styled.span`
  font-size: 11px;
  font-weight: 600;
  color: ${(props) => props.theme.textTertiary};
  text-transform: uppercase;
  letter-spacing: 0.3px;
  flex-shrink: 0;
`;

const MetaValue = styled.span`
  font-size: 13px;
  font-weight: 500;
  color: ${(props) => props.theme.textSecondary};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const MetaDivider = styled.div`
  width: 1px;
  height: 20px;
  background-color: ${(props) => props.theme.divider};
  flex-shrink: 0;

  @media (max-width: 480px) {
    display: none;
  }
`;

const SeverityBadge = styled.span<{ $severity?: string }>`
  font-size: 11px;
  font-weight: 600;
  padding: 3px 10px;
  border-radius: 12px;
  background-color: ${(props) => {
    switch (props.$severity) {
      case "High": return "rgba(239, 68, 68, 0.15)";
      case "Medium": return "rgba(245, 158, 11, 0.15)";
      case "Low": return "rgba(79, 124, 255, 0.15)";
      default: return props.theme.backgroundSecondary;
    }
  }};
  color: ${(props) => {
    switch (props.$severity) {
      case "High": return "#ef4444";
      case "Medium": return "#f59e0b";
      case "Low": return "#4F7CFF";
      default: return props.theme.textTertiary;
    }
  }};
`;

const ModalBody = styled.div`
  padding: 24px;
  overflow-y: auto;
  overflow-x: hidden;
  flex: 1;

  @media (max-width: 768px) {
    padding: 16px;
  }
`;

const ComparisonSection = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-bottom: 24px;

  @media (max-width: 600px) {
    grid-template-columns: 1fr;
  }
`;

const ComparisonColumn = styled.div<{ $accent?: string }>`
  padding: 16px;
  border-radius: 10px;
  background-color: ${(props) => props.theme.backgroundSecondary};
  border: 1px solid ${(props) => props.theme.divider};
  border-left: 3px solid ${(props) => props.$accent || props.theme.divider};
  transition: all 0.2s ease;

  &:hover {
    background-color: ${(props) => props.theme.listItemHoverBackground};
  }
`;

const ComparisonHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
`;

const ComparisonIcon = styled.div<{ $color: string }>`
  width: 28px;
  height: 28px;
  border-radius: 6px;
  background-color: ${(props) => props.$color + "14"};
  color: ${(props) => props.$color};
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
`;

const ComparisonTitle = styled.h4`
  font-size: 13px;
  font-weight: 600;
  color: ${(props) => props.theme.text};
  margin: 0;
`;

const ComparisonContent = styled.p`
  font-size: 13px;
  color: ${(props) => props.theme.textSecondary};
  line-height: 1.6;
  margin: 0;
  padding-left: 36px;
  font-family: 'Monaco', 'Menlo', 'Consolas', monospace;
  word-break: break-all;
`;

const ComparisonContentLink = styled.p<{ $clickable?: boolean }>`
  font-size: 13px;
  color: ${(props) => (props.$clickable ? "#7c3aed" : props.theme.textSecondary)};
  line-height: 1.6;
  margin: 0;
  padding-left: 36px;
  font-family: 'Monaco', 'Menlo', 'Consolas', monospace;
  word-break: break-all;
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: ${(props) => (props.$clickable ? "pointer" : "default")};
  transition: color 0.2s ease;

  ${(props) => props.$clickable && `
    &:hover {
      color: #6d28d9;
      text-decoration: underline;
    }
  `}
`;

const LinkIcon = styled.span`
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  opacity: 0.7;
`;

const CorrespondingDocList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 0 16px 8px 36px;
`;

const CorrespondingDocItem = styled.div<{ $clickable?: boolean }>`
  font-size: 13px;
  color: ${(props) => (props.$clickable ? "#7c3aed" : props.theme.textSecondary)};
  cursor: ${(props) => (props.$clickable ? "pointer" : "default")};
  display: inline-flex;
  align-items: center;
  gap: 6px;
  word-break: break-all;
  &:hover {
    ${(props) => props.$clickable && `color: #6d28d9; text-decoration: underline;`}
  }
`;

const ActionSelect = styled.select`
  width: 100%;
  padding: 6px 8px;
  font-size: 12px;
  border: 1px solid ${(props) => props.theme.divider};
  border-radius: 6px;
  background: ${(props) => props.theme.background};
  color: ${(props) => props.theme.text};
  cursor: pointer;
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const KanbanSelectorLabel = styled.label`
  font-size: 12px;
  font-weight: 600;
  color: ${(props) => props.theme.textSecondary};
  white-space: nowrap;
`;

const KanbanLoadingRow = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 16px 0;
  font-size: 13px;
  color: ${(props) => props.theme.textSecondary};
`;

const KanbanSpinner = styled.div`
  width: 16px;
  height: 16px;
  border: 2px solid ${(props) => props.theme.divider};
  border-top-color: #10b981;
  border-radius: 50%;
  flex-shrink: 0;
  animation: spin 0.7s linear infinite;
  @keyframes spin { to { transform: rotate(360deg); } }
`;

const KanbanEmptyState = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 20px 16px;
  border-radius: 8px;
  background: ${(props) => props.theme.backgroundSecondary};
  text-align: center;
  font-size: 13px;
  color: ${(props) => props.theme.text};
  margin: 4px 0;
`;

const KanbanEmptyIcon = styled.div`
  font-size: 24px;
  margin-bottom: 4px;
`;

const KanbanEmptyHint = styled.div`
  font-size: 12px;
  color: ${(props) => props.theme.textTertiary};
`;

const KanbanBoardInfo = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  margin-bottom: 14px;
  border-radius: 8px;
  background: ${(props) => props.theme.backgroundSecondary};
  border: 1px solid ${(props) => props.theme.divider};
`;

const KanbanBoardInfoLabel = styled.span`
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: ${(props) => props.theme.textTertiary};
`;

const KanbanBoardInfoValue = styled.span`
  font-size: 13px;
  font-weight: 600;
  color: ${(props) => props.theme.text};
`;

const KanbanColumnSelectorWrapper = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const KanbanColumnSelect = styled.select`
  width: 100%;
  padding: 10px 36px 10px 12px;
  font-size: 13px;
  border: 1px solid ${(props) => props.theme.inputBorder || props.theme.divider};
  border-radius: 8px;
  background: ${(props) => props.theme.background};
  color: ${(props) => props.theme.text};
  cursor: pointer;
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 12px center;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;

  &:focus {
    outline: none;
    border-color: #10b981;
    box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.15);
  }

  &:hover:not(:disabled) {
    border-color: #10b981;
  }
`;

const Section = styled.div`
  margin-bottom: 24px;

  &:last-child {
    margin-bottom: 0;
  }
`;

const SectionHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
`;

const SectionTitle = styled.h4`
  font-size: 14px;
  font-weight: 600;
  color: ${(props) => props.theme.text};
  margin: 0;
`;

const DriftAnalysisBox = styled.div`
  padding: 16px;
  background-color: ${(props) => props.theme.isDark ? 'rgba(245, 158, 11, 0.1)' : 'rgba(245, 158, 11, 0.05)'};
  border: 1px solid rgba(245, 158, 11, 0.25);
  border-radius: 10px;
  font-size: 13px;
  color: ${(props) => props.theme.textSecondary};
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: break-word;
`;

/* eslint-disable @typescript-eslint/no-unused-vars */
const SuggestDescriptionBox = styled.div`
  padding: 16px;
  background-color: ${(props) => props.theme.isDark ? 'rgba(79, 124, 255, 0.1)' : 'rgba(79, 124, 255, 0.05)'};
  border: 1px solid rgba(79, 124, 255, 0.25);
  border-radius: 10px;
  font-size: 13px;
  color: ${(props) => props.theme.textSecondary};
  line-height: 1.6;
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const EvaluationBar = styled.div<{ $hasWarnings: boolean }>`
  margin-top: 8px;
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 12px;
  background-color: ${({ $hasWarnings }) =>
    $hasWarnings ? "rgba(234, 179, 8, 0.1)" : "rgba(34, 197, 94, 0.1)"};
  border: 1px solid ${({ $hasWarnings }) =>
    $hasWarnings ? "rgba(234, 179, 8, 0.35)" : "rgba(34, 197, 94, 0.35)"};
`;

const EvaluationLabel = styled.div`
  font-weight: 600;
  margin-bottom: 4px;
`;

const WarningList = styled.div`
  margin-top: 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const WarningItem = styled.div`
  padding-left: 12px;
  color: ${(props) => props.theme.textSecondary};
  &::before { content: "• "; }
`;

const RefBadgeRow = styled.span`
  display: inline-flex;
  gap: 4px;
  margin-left: 6px;
  vertical-align: middle;
`;

const RefBadgeWrap = styled.span`
  position: relative;
  display: inline-block;
`;

const RefBadge = styled.button<{ $active?: boolean }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: none;
  cursor: pointer;
  font-size: 10px;
  font-weight: 600;
  line-height: 1;
  transition: background 0.15s;
  background: ${({ $active }) =>
    $active ? "rgba(234,179,8,0.55)" : "rgba(234,179,8,0.2)"};
  color: ${(props) => props.theme.text};
  &:hover {
    background: rgba(234, 179, 8, 0.4);
  }
`;

const RefPopup = styled.div`
  position: absolute;
  bottom: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
  z-index: 200;
  width: 280px;
  padding: 10px 12px;
  border-radius: 8px;
  background: ${(props) => props.theme.background};
  border: 1px solid ${(props) => props.theme.divider};
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);
`;

const RefPopupTitle = styled.div`
  font-size: 11px;
  font-weight: 600;
  color: ${(props) => props.theme.text};
  margin-bottom: 6px;
  word-break: break-word;
`;

const RefHighlight = styled.mark`
  background: rgba(234, 179, 8, 0.35);
  color: inherit;
  border-radius: 2px;
  padding: 0 1px;
`;

const RefPopupSection = styled.div`
  font-size: 10px;
  font-weight: 500;
  color: rgba(234, 179, 8, 0.9);
  margin-bottom: 6px;
`;

const RefPopupText = styled.div`
  font-size: 11px;
  color: ${(props) => props.theme.textSecondary};
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 160px;
  overflow-y: auto;
`;

const SuggestDescriptionText = styled.div`
  white-space: pre-wrap;
  line-height: 1.6;
  word-break: break-word;
  overflow-wrap: break-word;
`;

const InstructionArea = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 10px;
`;

const InstructionTextarea = styled.textarea`
  width: 100%;
  min-height: 72px;
  padding: 10px 12px;
  background-color: ${(props) => props.theme.background};
  border: 1px solid ${(props) => props.theme.divider};
  border-radius: 8px;
  font-size: 13px;
  color: ${(props) => props.theme.text};
  line-height: 1.5;
  resize: vertical;
  outline: none;
  box-sizing: border-box;

  &::placeholder {
    color: ${(props) => props.theme.placeholder};
  }

  &:focus {
    border-color: rgba(79, 124, 255, 0.6);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const RegenerateButton = styled.button`
  align-self: flex-end;
  padding: 8px 18px;
  background-color: #4F7CFF;
  color: #fff;
  border: none;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.15s;

  &:hover:not(:disabled) {
    background-color: #3a6ae8;
  }

  &:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
`;

const HistoryDropdown = styled.div`
  position: relative;
`;

const HistoryToggle = styled.button`
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  background: none;
  border: 1px solid ${(props) => props.theme.divider};
  border-radius: 6px;
  font-size: 12px;
  color: ${(props) => props.theme.textTertiary};
  cursor: pointer;
  transition: all 0.15s;

  &:hover:not(:disabled) {
    border-color: rgba(79, 124, 255, 0.5);
    color: #4F7CFF;
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const HistoryChevron = styled.span<{ $open: boolean }>`
  font-size: 11px;
  transition: transform 0.15s;
  transform: ${(props) => (props.$open ? "rotate(180deg)" : "rotate(0deg)")};
  display: inline-block;
`;

const HistoryList = styled.div`
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  background: ${(props) => props.theme.menuBackground || props.theme.background};
  border: 1px solid ${(props) => props.theme.divider};
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
  z-index: 100;
  overflow: hidden;
  max-height: 200px;
  overflow-y: auto;
`;

const HistoryItem = styled.button`
  display: block;
  width: 100%;
  padding: 8px 12px;
  text-align: left;
  background: none;
  border: none;
  border-bottom: 1px solid ${(props) => props.theme.divider};
  font-size: 12px;
  color: ${(props) => props.theme.text};
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: background 0.12s;

  &:last-child {
    border-bottom: none;
  }

  &:hover {
    background-color: ${(props) => props.theme.listItemHoverBackground};
    color: #4F7CFF;
  }
`;
/* eslint-enable @typescript-eslint/no-unused-vars */

const ModalFooter = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 16px 24px;
  border-top: 1px solid ${(props) => props.theme.divider};
  background-color: ${(props) => props.theme.backgroundSecondary};

  @media (max-width: 768px) {
    padding: 12px 16px;
  }
`;


const CancelButton = styled.button`
  padding: 10px 20px;
  background-color: #ec6a6a;
  color: #f3f4f6;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover {
    background-color: #ef4444;
     box-shadow: 0 4px 8px rgba(239, 68, 68, 0.25);
  }
`;

const ApproveButton = styled.button`
  padding: 10px 24px;
  background-color: #4F7CFF;
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover:not(:disabled) {
    background-color: #3b82f6;
    box-shadow: 0 4px 8px rgba(59, 130, 246, 0.25);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;


const StatusBadge = styled.span<{ $status: string }>`
  font-size: 11px;
  font-weight: 600;
  padding: 3px 10px;
  border-radius: 12px;
  background-color: ${(props) => {
    switch (props.$status.toLowerCase()) {
      case "pending": return "rgba(79, 124, 255, 0.15)";
      case "approved": return "rgba(34, 197, 94, 0.15)";
      case "rejected": return "rgba(239, 68, 68, 0.15)";
      default: return props.theme.backgroundSecondary;
    }
  }};
  color: ${(props) => {
    switch (props.$status.toLowerCase()) {
      case "pending": return "#4F7CFF";
      case "approved": return "#22c55e";
      case "rejected": return "#ef4444";
      default: return props.theme.textTertiary;
    }
  }};
`;


const TestResultsTable = styled.div`
  border: 1px solid ${(props) => props.theme.divider};
  border-radius: 8px;
  overflow: hidden;
`;

const TestResultsHeader = styled.div`
  display: flex;
  background-color: ${(props) => props.theme.backgroundSecondary};
  border-bottom: 1px solid ${(props) => props.theme.divider};
  padding: 8px 12px;
`;

const TestResultsHeaderCell = styled.span`
  font-size: 11px;
  font-weight: 600;
  color: ${(props) => props.theme.textTertiary};
  text-transform: uppercase;
  letter-spacing: 0.3px;
`;

const TestResultsRow = styled.div`
  display: flex;
  padding: 10px 12px;
  border-bottom: 1px solid ${(props) => props.theme.divider};
  align-items: flex-start;

  &:last-child {
    border-bottom: none;
  }

  &:hover {
    background-color: ${(props) => props.theme.listItemHoverBackground};
  }
`;

const TestResultsCell = styled.span`
  font-size: 13px;
  color: ${(props) => props.theme.text};
  padding-right: 12px;
  word-break: break-word;
`;

const CodeToSrsBadge = styled.span<{ $value: "mismatch" | "match" | "missing" | "surplus" }>`
  font-size: 11px;
  font-weight: 600;
  padding: 3px 8px;
  border-radius: 10px;
  text-transform: uppercase;
  background-color: ${(props) => {
    switch (props.$value) {
      case "match": return "rgba(16, 185, 129, 0.15)";
      case "mismatch": return "rgba(239, 68, 68, 0.15)";
      case "missing": return "rgba(245, 158, 11, 0.15)";
      case "surplus": return "rgba(124, 58, 237, 0.15)";
    }
  }};
  color: ${(props) => {
    switch (props.$value) {
      case "match": return "#10b981";
      case "mismatch": return "#ef4444";
      case "missing": return "#f59e0b";
      case "surplus": return "#7c3aed";
    }
  }};
`;

const ExpandIcon = styled.span<{ $expanded: boolean }>`
  font-size: 10px;
  color: ${(p) => p.theme.textTertiary};
  transition: transform 0.2s;
  transform: ${(p) => p.$expanded ? "rotate(0deg)" : "rotate(-90deg)"};
`;

const EasSubline = styled.div`
  font-size: 11px;
  font-weight: 600;
  color: ${(p) => p.theme.textTertiary};
  margin-bottom: 2px;
`;

const EasStateLine = styled.div`
  font-size: 12px;
  color: ${(p) => p.theme.textSecondary};
  margin-top: 2px;
  font-style: italic;
`;

const EasGuardLine = styled.div`
  font-size: 11px;
  color: #f59e0b;
  margin-top: 2px;
`;

const SrsQuoteBlock = styled.div`
  margin: 6px 0;
  padding: 8px 10px;
  background: rgba(124, 58, 237, 0.06);
  border-left: 3px solid #7c3aed;
  border-radius: 3px;
`;

const SrsQuoteText = styled.div`
  font-size: 12px;
  font-style: italic;
  color: ${(p) => p.theme.text};
  line-height: 1.5;
`;

const SrsQuoteSource = styled.div`
  font-size: 10px;
  color: ${(p) => p.theme.textTertiary};
  margin-top: 4px;
  font-family: monospace;
`;

const SrsQuoteLink = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-top: 4px;
  padding: 2px 6px;
  font-size: 11px;
  color: #7c3aed;
  background: transparent;
  border: none;
  cursor: pointer;
  font-family: monospace;
  text-decoration: none;
  border-radius: 3px;
  &:hover {
    background: rgba(124, 58, 237, 0.12);
    text-decoration: underline;
  }
`;

const CodeRefRow = styled.div`
  margin: 6px 0;
  padding: 6px 10px;
  background: rgba(59, 130, 246, 0.06);
  border-left: 3px solid #3b82f6;
  border-radius: 3px;
`;

const CodeRefLink = styled.a`
  font-size: 12px;
  color: #2563eb;
  font-family: monospace;
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  word-break: break-all;
  &:hover { text-decoration: underline; }
`;

const CodeRefText = styled.span`
  font-size: 12px;
  font-family: monospace;
  color: ${(p) => p.theme.textSecondary};
  word-break: break-all;
`;

const CodeRefRepo = styled.span`
  font-size: 10px;
  font-weight: 600;
  color: ${(p) => p.theme.textTertiary};
  background: ${(p) => p.theme.backgroundTertiary};
  padding: 1px 6px;
  border-radius: 8px;
`;

const CodeRefSnippet = styled.div`
  font-size: 11px;
  font-family: monospace;
  color: ${(p) => p.theme.textSecondary};
  margin-top: 4px;
  padding: 4px 6px;
  background: ${(p) => p.theme.backgroundTertiary};
  border-radius: 2px;
  white-space: pre-wrap;
  word-break: break-word;
`;

const TestDetailRow = styled.div`
  background: ${(p) => p.theme.backgroundSecondary};
  border-left: 3px solid ${(p) => p.theme.divider};
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

const TestDetailBox = styled.div<{ $type: "error" | "reason" | "code" }>`
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const TestDetailLabel = styled.span`
  font-size: 10px;
  font-weight: 700;
  color: ${(p) => p.theme.textTertiary};
  text-transform: uppercase;
  letter-spacing: 0.05em;
`;

const TestDetailText = styled.p`
  font-size: 12px;
  color: ${(p) => p.theme.text};
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.5;
`;

const TestCodeBlock = styled.pre`
  font-size: 11px;
  font-family: 'Monaco', 'Menlo', 'Consolas', monospace;
  background: ${(p) => (p.theme as any).codeBackground || "#1e1e2e"};
  color: ${(p) => (p.theme as any).codeText || "#cdd6f4"};
  padding: 12px;
  border-radius: 6px;
  overflow-x: auto;
  margin: 0;
  white-space: pre;
  line-height: 1.5;
  max-height: 400px;
  overflow-y: auto;
`;

//fix setup error
export default observer(PendingApprovals);

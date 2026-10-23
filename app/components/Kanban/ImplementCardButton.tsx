import { observer } from "mobx-react";
import { observable, action } from "mobx";
import {
  CaretDownIcon,
  CheckmarkIcon,
  DocumentIcon,
  HistoryIcon,
  LightningIcon,
  WarningIcon,
} from "outline-icons";
import * as React from "react";
import { useState, useRef, useEffect } from "react";
import styled, { keyframes } from "styled-components";
import { s } from "@shared/styles";
import ConfirmationDialog from "~/components/ConfirmationDialog";
import useStores from "~/hooks/useStores";
import { toast } from "sonner";
import ImpactAnalysisModal from "./ImpactAnalysisModal";
import ImplementConfirmModal from "./ImplementConfirmModal";
import type { SelectedDocumentChange } from "./UpdateDocumentModal";
import type { ImplementPreviewData, AnalyzeImpactResult } from "./types";

// ─── Module-level observables — survive component unmount/remount ────────────
const _analysisCounter = observable({ count: 0 });
const _incAnalysis = action(() => { _analysisCounter.count++; });
const _decAnalysis = action(() => { _analysisCounter.count--; });
const MAX_CONCURRENT_ANALYSIS = 3;

// Tracks which cardIds are currently mid-analysis — persists across tab switches
const _analyzingCards = observable(new Set<string>());
const _addAnalyzingCard = action((id: string) => { _analyzingCards.add(id); });
const _removeAnalyzingCard = action((id: string) => { _analyzingCards.delete(id); });

// "analysing" removed — driven by _analyzingCards (module-level, not local state)
type AnalysisPhase = "idle" | "error";

export interface ImplementCardButtonProps {
  cardId: string;
  implementStatus: string;
  implementError: string | null;
}

const ImplementCardButton = observer(function ImplementCardButton({
  cardId,
  implementStatus,
  implementError,
}: ImplementCardButtonProps) {
  const { kanbanCards, dialogs, ui } = useStores();
  const [showMenu, setShowMenu] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [analysisPhase, setAnalysisPhase] = useState<AnalysisPhase>("idle");
  const isAnalysing = _analyzingCards.has(cardId);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowMenu(false);
        setShowHistory(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const card = kanbanCards.get(cardId);
  const isRunning = implementStatus === "running";
  const isPreviewReady = implementStatus === "preview_ready";
  const isCompleted = implementStatus === "completed";
  const isFailed = implementStatus === "failed";
  const isQueued = implementStatus === "queued";
  const isIdle = !isRunning && !isPreviewReady && !isCompleted && !isFailed && !isQueued;
  const isRateLimited = _analysisCounter.count >= MAX_CONCURRENT_ANALYSIS;

  // Driven by store — persisted across reloads
  const hasImpactAnalysis = Boolean(card?.impactAnalysis);
  const impactAnalysisResult = card?.impactAnalysis as AnalyzeImpactResult | null ?? null;

  // Kiểm tra xem card có impact data hợp lệ không (null hoặc impacts rỗng đều cảnh báo)
  const noImpactData = !card?.impactAnalysis || (card.impactAnalysis as AnalyzeImpactResult).impacts.length === 0;

  // Wrapper visible whenever there's something meaningful to show
  const showSection = hasImpactAnalysis || !isIdle || isAnalysing || analysisPhase !== "idle";

  useEffect(() => {
    ui.setAIRequestPending(isRunning || isQueued);
  }, [isRunning, isQueued, ui]);

  useEffect(() => () => { ui.setAIRequestPending(false); }, [ui]);

  const queuePosition = card?.queuePosition ?? null;
  const implementedByName = card?.implementedByName;
  const lastCompletedEntry = card?.implementHistory
    ?.filter((e) => e.status === "completed" && e.preview)
    ?.at(-1);
  const completedPreview = lastCompletedEntry?.preview as ImplementPreviewData | undefined;

  // ── Helpers ───────────────────────────────────────────────────────────────

  const openImpactModal = (result: AnalyzeImpactResult): void => {
    dialogs.openModal({
      title: "Impact Analysis",
      width: "85vw",
      top: "32px",
      height: "85vh",
      content: (
        <ImpactAnalysisModal
          cardId={cardId}
          result={result}
          onImplement={() => void handleImplementFromModal()}
          onCancel={() => void handleCancelImpactAnalysis()}
          implementStatus={implementStatus}
        />
      ),
    });
  };

  // ── Analysis flow ─────────────────────────────────────────────────────────

  const handleAnalyzeClick = async (
    e: React.MouseEvent<HTMLButtonElement>
  ): Promise<void> => {
    e.stopPropagation();
    e.preventDefault();

    if (_analysisCounter.count >= MAX_CONCURRENT_ANALYSIS) {
      toast.warning("Maximum 3 cards are being processed, please wait.");
      return;
    }

    _incAnalysis();
    _addAnalyzingCard(cardId); // persists across tab switches
    setAnalysisPhase("idle");  // reset any previous error

    try {
      const result = await kanbanCards.analyzeImpact(cardId);
      openImpactModal(result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "";
      if (message.includes("429") || message.includes("tối đa 3")) {
        toast.warning("Maximum 3 cards are being processed, please wait.");
      } else {
        toast.error("Impact analysis failed. Please try again.");
      }
      setAnalysisPhase("error");
    } finally {
      _decAnalysis();
      _removeAnalyzingCard(cardId);
    }
  };

  // ── Implement flow ────────────────────────────────────────────────────────

  const openPreviewModal = (): void => {
    const preview = card?.implementPreview;
    if (!preview) { return; }
    dialogs.openModal({
      title:
        preview.action === "delete_document"
          ? "Documents to delete manually"
          : preview.action === "create_document"
            ? "Confirm document creation"
            : preview.action === "update_document"
              ? "Confirm document update"
              : "Analysis result",
      width: "1000px",
      height: "90vh",
      top: "32px",
      content: (
        <ImplementConfirmModal
          preview={preview}
          cardId={cardId}
          onConfirm={(deleteIds, createIndexes, updateChanges) =>
            void handleConfirmImplement(deleteIds, createIndexes, updateChanges)
          }
          onCancel={() => void handleCancelImplement()}
          impactAnalysisResult={impactAnalysisResult}
          onViewImpact={impactAnalysisResult ? () => {
            dialogs.closeAllModals();
            openImpactModal(impactAnalysisResult);
          } : undefined}
        />
      ),
    });
  };

  const handlePreviewClick = (e: React.MouseEvent<HTMLButtonElement>): void => {
    e.stopPropagation();
    e.preventDefault();
    openPreviewModal();
  };

  const handleImplementFromModal = async (): Promise<void> => {
    dialogs.closeAllModals();
    setAnalysisPhase("idle");
    if (isPreviewReady) {
      openPreviewModal();
      return;
    }
    try {
      await kanbanCards.implement(cardId);
    } catch (_err: unknown) {
      toast.error("Failed to start implement. Please check your connection.");
    }
  };

  const handleCancelImpactAnalysis = async (): Promise<void> => {
    dialogs.closeAllModals();
    setAnalysisPhase("idle");
    try {
      await kanbanCards.clearImpactAnalysis(cardId);
    } catch (_err: unknown) {
      toast.error("Failed to clear analysis result. Please check your connection.");
    }
  };

  const handleImplementClick = async (
    e: React.MouseEvent<HTMLButtonElement>
  ): Promise<void> => {
    e.stopPropagation();
    e.preventDefault();
    if (isRunning) { return; }

    if (noImpactData) {
      dialogs.openModal({
        title: "No impact analysis result",
        content: (
          <ConfirmationDialog
            onSubmit={async () => { await kanbanCards.implement(cardId); }}
            submitText="Continue anyway"
            savingText="Processing..."
          >
            This card has no Analyze Impact result or no affected usecases.
            Do you want to proceed with implement without impact information?
          </ConfirmationDialog>
        ),
      });
      return;
    }

    try {
      await kanbanCards.implement(cardId);
    } catch (_err: unknown) {
      toast.error("Failed to start implement. Please check your connection.");
    }
  };

  const handleConfirmImplement = async (
    deleteDocumentIds?: string[],
    createDocumentIndexes?: number[],
    updateDocumentChanges?: SelectedDocumentChange[]
  ) => {
    dialogs.closeAllModals();
    try {
      const { warnings } = await kanbanCards.confirmImplement(
        cardId, deleteDocumentIds, createDocumentIndexes, updateDocumentChanges
      );
      if (warnings && warnings.length > 0) {
        toast.warning(
          `Implement completed but ${warnings.length} change(s) could not be applied due to content mismatch. Please review the documents.`
        );
      } else {
        toast.success("Implement successful! Card moved to Reviewing.");
      }
    } catch (_err: unknown) {
      toast.error("Implement failed. Please check the card content.");
    }
  };

  const handleCancelImplement = async () => {
    dialogs.closeAllModals();
    try {
      await kanbanCards.cancelImplement(cardId);
    } catch (_err: unknown) {
      // ignore
    }
  };

  const handleCompletedClick = (e: React.MouseEvent<HTMLButtonElement>): void => {
    e.stopPropagation();
    e.preventDefault();
    setShowMenu((prev) => !prev);
  };

  const handleOpenReImplementConfirm = (e: React.MouseEvent): void => {
    e.stopPropagation();
    setShowMenu(false);
    dialogs.openModal({
      title: "Re-implement this card?",
      content: (
        <ConfirmationDialog
          onSubmit={async () => { await kanbanCards.implement(cardId); }}
          submitText="Re-implement"
          savingText="Processing..."
          danger
        >
          This card has already been implemented. Re-implement will call AI again and generate a new preview.
          <br />
          <strong>You will be asked to confirm before any changes are applied.</strong>
          {noImpactData && (
            <>
              <br /><br />
              <span style={{ color: "orange" }}>
                ⚠️ Note: This card has no Analyze Impact result or no affected usecases.
                AI will implement without impact information.
              </span>
            </>
          )}
        </ConfirmationDialog>
      ),
    });
  };

  const handleViewChanges = (e: React.MouseEvent): void => {
    e.stopPropagation();
    setShowMenu(false);
    if (!completedPreview) { return; }
    dialogs.openModal({
      title:
        completedPreview.action === "create_document"
          ? "Review created document"
          : completedPreview.action === "update_document"
            ? "Review updated document"
            : completedPreview.action === "delete_document"
              ? "Review deleted document"
              : "Review analysis result",
      width: "1000px",
      height: "90vh",
      top: "32px",
      content: (
        <ImplementConfirmModal
          preview={completedPreview}
          cardId={cardId}
          readOnly
          onConfirm={() => { }}
          onCancel={() => dialogs.closeAllModals()}
        />
      ),
    });
  };

  const handleToggleHistory = (e: React.MouseEvent): void => {
    e.stopPropagation();
    setShowMenu(false);
    setShowHistory((prev) => !prev);
  };

  // ── Render helpers ────────────────────────────────────────────────────────

  const renderAnalyzeSection = () => {
    // Hide analyze button when preview is ready — impact result is accessible inside the preview modal
    if (isPreviewReady) { return null; }

    // In-flight analysis — driven by module-level set, survives tab switches
    if (isAnalysing) {
      return (
        <ActionButton $status="running" disabled>
          <Spinner />
          Analyzing impact...
        </ActionButton>
      );
    }

    // Result persisted in DB — show preview button
    if (hasImpactAnalysis && impactAnalysisResult) {
      return (
        <ActionButton
          $status="idle"
          onClick={(e) => { e.stopPropagation(); openImpactModal(impactAnalysisResult); }}
          title="View impact analysis result"
        >
          <LightningIcon size={14} />
          Impact analysis result
        </ActionButton>
      );
    }

    // Previous analysis failed
    if (analysisPhase === "error") {
      return (
        <ActionButton
          $status="failed"
          onClick={(e) => void handleAnalyzeClick(e)}
          title="Analysis failed — click to retry"
        >
          <WarningIcon size={14} />
          Retry analysis
        </ActionButton>
      );
    }

    // Default: no analysis yet
    return (
      <ActionButton
        $status="idle"
        onClick={(e) => void handleAnalyzeClick(e)}
        disabled={isRateLimited}
        title={
          isRateLimited
            ? "Maximum 3 cards are being processed, please wait"
            : "Analyze impact before implementing"
        }
      >
        <LightningIcon size={14} />
        Analyze impact
      </ActionButton>
    );
  };

  const renderImplementSection = () => {
    if (isCompleted) {
      const implementedAt = card?.implementedAt;
      const implementHistory = card?.implementHistory ?? [];
      return (
        <>
          <CompletedButton
            onClick={handleCompletedClick}
            title="Card implemented — click to view options"
          >
            <CheckmarkIcon size={14} />
            Implemented
            {implementedByName && <ByLabel> by {implementedByName}</ByLabel>}
            <CaretDownIcon size={12} />
          </CompletedButton>
          {implementedAt && (
            <TimestampLabel>
              {new Date(implementedAt).toLocaleDateString("vi-VN", {
                day: "2-digit",
                month: "2-digit",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </TimestampLabel>
          )}
          {showMenu && (
            <DropdownMenu onClick={(e) => e.stopPropagation()}>
              {completedPreview && (
                <DropdownItem onClick={handleViewChanges}>
                  <DocumentIcon size={14} /> View changes
                </DropdownItem>
              )}
              <DropdownItem onClick={handleOpenReImplementConfirm}>
                <LightningIcon size={14} /> Re-implement...
              </DropdownItem>
              {implementHistory.length > 0 && (
                <DropdownItem onClick={handleToggleHistory}>
                  <HistoryIcon size={14} /> History ({implementHistory.length})
                </DropdownItem>
              )}
            </DropdownMenu>
          )}
          {showHistory && implementHistory.length > 0 && (
            <HistoryPanel onClick={(e) => e.stopPropagation()}>
              {implementHistory.map((entry, i) => (
                <HistoryEntry key={i} $status={entry.status}>
                  {entry.status === "completed" ? (
                    <CheckmarkIcon size={12} />
                  ) : (
                    <WarningIcon size={12} />
                  )}
                  {entry.userName && <span>{entry.userName}</span>}
                  <span>
                    {new Date(entry.at).toLocaleDateString("vi-VN", {
                      day: "2-digit",
                      month: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  {entry.error && (
                    <span title={entry.error}>
                      <WarningIcon size={12} />
                    </span>
                  )}
                </HistoryEntry>
              ))}
            </HistoryPanel>
          )}
        </>
      );
    }

    if (isPreviewReady) {
      return (
        <PreviewButton
          onClick={handlePreviewClick}
          title="AI analysis complete — click to review and confirm"
        >
          <LightningIcon size={14} />
          Suggested changes
          <NotificationDot />
        </PreviewButton>
      );
    }

    // running / queued / failed
    return (
      <>
        <ActionButton
          $status={implementStatus}
          onClick={(e) => void handleImplementClick(e)}
          disabled={isRunning || isQueued}
          title={
            isFailed && implementError
              ? `Error: ${implementError}`
              : isQueued
                ? `Waiting for slot — position ${queuePosition !== null ? `#${queuePosition}` : "in queue"}`
                : "AI will read card content and perform document operations"
          }
        >
          {isRunning ? (
            <>
              <Spinner />
              Processing...
            </>
          ) : isQueued ? (
            <>
              <Spinner />
              {queuePosition !== null ? `Queue #${queuePosition}` : "Waiting..."}
            </>
          ) : isFailed ? (
            <>
              <WarningIcon size={14} />
              Retry
            </>
          ) : (
            <>
              <LightningIcon size={14} />
              Implement
            </>
          )}
        </ActionButton>
        {isFailed && implementError && (
          <ErrorMessage>{implementError}</ErrorMessage>
        )}
      </>
    );
  };

  // ── Main render — 2 sections ──────────────────────────────────────────────

  return (
    <ImplementButtonWrapper
      ref={wrapperRef}
      $isActive={showSection}
      $isQueued={isQueued}
    >
      {/* Analyze section — top: always rendered, drives visibility */}
      {renderAnalyzeSection()}

      {/* Implement section — bottom: only when card is non-idle */}
      {!isIdle && (
        <ImplementSection $hasAnalyze={hasImpactAnalysis}>
          {renderImplementSection()}
        </ImplementSection>
      )}
    </ImplementButtonWrapper>
  );
});

// ─── Styled components ────────────────────────────────────────────────────────

const PreviewButton = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  padding: 5px 10px;
  border-radius: 6px;
  border: none;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  position: relative;
  min-height: 28px;
  background: ${({ theme }) => theme.accent};
  color: white;
  animation: pulse 2s ease-in-out infinite;

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.85; }
  }

  &:hover {
    filter: brightness(0.92);
  }

  &:focus-visible {
    outline: 2px solid ${s("accent")};
    outline-offset: 2px;
  }
`;

const NotificationDot = styled.span`
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: white;
  opacity: 0.9;
  flex-shrink: 0;
`;

export const ImplementButtonWrapper = styled.div<{
  $isActive?: boolean;
  $isQueued?: boolean;
}>`
  display: flex;
  flex-direction: column;
  gap: 4px;
  position: relative;
  max-height: ${({ $isActive, $isQueued }) =>
    $isActive || $isQueued ? "300px" : "0"};
  overflow: ${({ $isActive, $isQueued }) =>
    $isActive || $isQueued ? "visible" : "hidden"};
  opacity: ${({ $isActive, $isQueued }) =>
    $isActive || $isQueued ? "1" : "0"};
  margin-top: ${({ $isActive, $isQueued }) =>
    $isActive || $isQueued ? "8px" : "0"};
  transition: max-height 0.2s ease, opacity 0.15s ease, margin-top 0.15s ease;
  z-index: 10;
`;

// Separator between analyze and implement sections when both are shown
const ImplementSection = styled.div<{ $hasAnalyze: boolean }>`
  display: flex;
  flex-direction: column;
  gap: 4px;
  ${({ $hasAnalyze }) =>
    $hasAnalyze
      ? `
    padding-top: 4px;
    border-top: 1px solid rgba(128, 128, 128, 0.15);
    margin-top: 2px;
  `
      : ""}
`;

const ActionButton = styled.button<{ $status: string }>`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  padding: 5px 10px;
  border-radius: 6px;
  border: none;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: filter 0.15s ease, opacity 0.15s ease;
  white-space: normal;
  flex-wrap: wrap;
  height: auto;
  min-height: 28px;

  background-color: ${({ $status, theme }) => {
    if ($status === "failed") { return theme.danger; }
    if ($status === "queued") { return `${theme.accent}80`; }
    return theme.accent;
  }};

  color: white;

  &:focus-visible {
    outline: 2px solid ${s("accent")};
    outline-offset: 2px;
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }

  &:hover:not(:disabled) {
    filter: brightness(0.92);
  }

  &:active:not(:disabled) {
    filter: brightness(0.85);
  }
`;

const CompletedButton = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  padding: 5px 10px;
  border-radius: 6px;
  border: 1px solid ${s("divider")};
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  min-height: 28px;
  background: ${({ theme }) => `${theme.success}15`};
  color: ${({ theme }) => theme.success};
  transition: background 0.15s ease;
  white-space: normal;
  flex-wrap: wrap;
  height: auto;

  &:hover {
    background: ${({ theme }) => `${theme.success}25`};
  }

  &:focus-visible {
    outline: 2px solid ${s("accent")};
    outline-offset: 2px;
  }
`;

const ByLabel = styled.span`
  font-weight: 400;
  opacity: 0.8;
`;

const TimestampLabel = styled.div`
  font-size: 11px;
  color: ${s("textTertiary")};
  text-align: center;
`;

const DropdownMenu = styled.div`
  position: absolute;
  bottom: calc(100% + 4px);
  left: 0;
  right: 0;
  background: ${s("background")};
  border: 1px solid ${s("divider")};
  border-radius: 6px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  z-index: 100;
  overflow: hidden;
`;

const DropdownItem = styled.button<{ disabled?: boolean }>`
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 12px;
  background: transparent;
  border: none;
  font-size: 13px;
  color: ${s("text")};
  cursor: ${({ disabled }) => (disabled ? "not-allowed" : "pointer")};
  text-align: left;
  opacity: ${({ disabled }) => (disabled ? 0.5 : 1)};
  transition: background 0.1s ease;

  &:hover:not(:disabled) {
    background: ${s("backgroundSecondary")};
  }
`;

const HistoryPanel = styled.div`
  position: absolute;
  bottom: calc(100% + 4px);
  left: 0;
  right: 0;
  background: ${s("background")};
  border: 1px solid ${s("divider")};
  border-radius: 6px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  z-index: 100;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 200px;
  overflow-y: auto;
`;

const HistoryEntry = styled.div<{ $status: "completed" | "failed" }>`
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  padding: 4px 6px;
  border-radius: 4px;
  background: ${({ $status, theme }) =>
    $status === "completed" ? `${theme.success}12` : `${theme.danger}12`};
  color: ${({ $status, theme }) =>
    $status === "completed" ? theme.success : theme.danger};
`;

const spin = keyframes`
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
`;

const Spinner = styled.span`
  width: 12px;
  height: 12px;
  border: 2px solid rgba(255, 255, 255, 0.4);
  border-top-color: white;
  border-radius: 50%;
  display: inline-block;
  animation: ${spin} 0.7s linear infinite;
  flex-shrink: 0;
`;

const ErrorMessage = styled.div`
  font-size: 11px;
  color: ${s("danger")};
  padding: 2px;
  line-height: 1.4;
  word-break: break-word;
`;

export default ImplementCardButton;

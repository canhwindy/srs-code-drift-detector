import * as React from "react";
import { useState, useCallback, useRef, useEffect } from "react";
import { Link } from "react-router-dom";
import styled, { css, keyframes } from "styled-components";
import { toast } from "sonner";
import { s } from "@shared/styles";
import Button from "~/components/Button";
import useStores from "~/hooks/useStores";
import type { AnalyzeImpactItem, AnalyzeImpactResult } from "./types";
import ImpactDocumentPicker from "./ImpactDocumentPicker";
import type { PickedDocument } from "./ImpactDocumentPicker";

export interface ImpactAnalysisModalProps {
  cardId: string;
  result: AnalyzeImpactResult;
  onImplement: () => void;
  onCancel: () => void;
  implementStatus: string;
  isImplementing?: boolean;
}

type Dimensions = {
  functional: string;
  business: string;
  data: string;
};

function parseDimensions(description: string): Dimensions | null {
  const functionalMatch = description.match(
    /Functional:\s*([\s\S]*?)(?=\nBusiness:|$)/
  );
  const businessMatch = description.match(
    /Business:\s*([\s\S]*?)(?=\nData:|$)/
  );
  const dataMatch = description.match(/Data:\s*([\s\S]*?)$/);

  const functional = functionalMatch?.[1]?.trim() ?? "";
  const business = businessMatch?.[1]?.trim() ?? "";
  const data = dataMatch?.[1]?.trim() ?? "";

  if (!functional && !business && !data) {
    return null;
  }
  return { functional, business, data };
}

function InlineEditText({
  value,
  onSave,
  disabled,
  multiline = false,
}: {
  value: string;
  onSave: (v: string) => void;
  disabled: boolean;
  multiline?: boolean;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
    }
  }, [isEditing]);

  const startEdit = () => {
    if (disabled) {
      return;
    }
    setDraft(value);
    setIsEditing(true);
  };

  const commitEdit = () => {
    setIsEditing(false);
    const trimmed = draft.trim();
    if (trimmed !== value) {
      onSave(trimmed);
    }
  };

  const cancelEdit = () => {
    setIsEditing(false);
    setDraft(value);
  };

  if (isEditing) {
    if (multiline) {
      return (
        <InlineTextarea
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              cancelEdit();
            }
          }}
          rows={3}
        />
      );
    }
    return (
      <InlineInput
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commitEdit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            commitEdit();
          }
          if (e.key === "Escape") {
            cancelEdit();
          }
        }}
      />
    );
  }

  if (multiline) {
    return (
      <RawDescription
        onClick={startEdit}
        style={{ cursor: disabled ? "default" : "text" }}
      >
        {value || "—"}
      </RawDescription>
    );
  }

  const isUnaffected =
    value === "Không ảnh hưởng" || value.toLowerCase() === "not affected";
  return (
    <DimValue
      $muted={isUnaffected}
      onClick={startEdit}
      style={{ cursor: disabled ? "default" : "text" }}
    >
      {value || "—"}
    </DimValue>
  );
}

function DimensionRow({
  label,
  value,
  color,
  onSave,
  disabled,
}: {
  label: string;
  value: string;
  color: string;
  onSave: (v: string) => void;
  disabled: boolean;
}) {
  return (
    <DimRow>
      <DimLabel $color={color}>{label}</DimLabel>
      <InlineEditText value={value} onSave={onSave} disabled={disabled} multiline />
    </DimRow>
  );
}

function getImplementDisabledReason(implementStatus: string): string | null {
  switch (implementStatus) {
    case "running":
      return "Card is being processed";
    case "queued":
      return "Card is queued";
    default:
      return null;
  }
}

export default function ImpactAnalysisModal({
  cardId,
  result,
  onImplement,
  onCancel,
  implementStatus,
  isImplementing = false,
}: ImpactAnalysisModalProps) {
  const { kanbanCards } = useStores();
  const [localImpacts, setLocalImpacts] = useState<AnalyzeImpactItem[]>(
    () => result.impacts
  );
  const [isSaving, setIsSaving] = useState(false);
  const [isConfirmingCancel, setIsConfirmingCancel] = useState(false);
  const [confirmDeleteIndex, setConfirmDeleteIndex] = useState<number | null>(
    null
  );
  const [isConfirmingReimplement, setIsConfirmingReimplement] = useState(false);
  const [isAddFormOpen, setIsAddFormOpen] = useState(false);
  const [addFormDoc, setAddFormDoc] = useState<PickedDocument | null>(null);
  const [addFormDescription, setAddFormDescription] = useState("");

  const hasImpacts = localImpacts.length > 0;

  const implementDisabledReason = getImplementDisabledReason(implementStatus);
  // Lock editing controls (delete, inline edit, document picker) based on
  // status/saving/implementing only — intentionally excludes isAddFormOpen so
  // the picker remains usable while the add form is open.
  // Lock editing controls (delete, inline edit, document picker) ONLY when
  // actively saving or implementing — intentionally excludes implementDisabledReason
  // so that a previously-completed/preview_ready status does not lock impact list editing.
  const isControlsLocked = isImplementing || isSaving;
  // Implement button: additionally disabled while the add form is open (unsaved state)
  // OR when the card status prevents a new implement (completed, running, etc.).
  const isImplementDisabled =
    isControlsLocked || isAddFormOpen || implementDisabledReason !== null;

  const handleImplementClick = () => {
    if (implementStatus === "completed") {
      setIsConfirmingReimplement(true);
    } else {
      onImplement();
    }
  };

  const saveImpacts = useCallback(
    async (newImpacts: AnalyzeImpactItem[]) => {
      setIsSaving(true);
      try {
        await kanbanCards.updateImpactAnalysis(cardId, newImpacts);
      } catch {
        toast.error("Lưu thất bại. Vui lòng thử lại.");
      } finally {
        setIsSaving(false);
      }
    },
    [cardId, kanbanCards]
  );

  const handleConfirmDelete = async () => {
    if (confirmDeleteIndex === null) {
      return;
    }
    const newImpacts = localImpacts.filter((_, i) => i !== confirmDeleteIndex);
    setLocalImpacts(newImpacts);
    setConfirmDeleteIndex(null);
    await saveImpacts(newImpacts);
  };

  const handleSaveDescription = useCallback(
    (index: number, newDescription: string) => {
      const newImpacts = localImpacts.map((item, i) =>
        i === index ? { ...item, description: newDescription } : item
      );
      setLocalImpacts(newImpacts);
      void saveImpacts(newImpacts);
    },
    [localImpacts, saveImpacts]
  );

  const resetAddForm = () => {
    setIsAddFormOpen(false);
    setAddFormDoc(null);
    setAddFormDescription("");
  };

  const handleAddFormBlur = async () => {
    if (!addFormDoc || !addFormDescription.trim()) {
      return;
    }
    const newItem: AnalyzeImpactItem = {
      affectedDocumentId: addFormDoc.id,
      affectedDocumentTitle: addFormDoc.title,
      affectedDocumentUrl: addFormDoc.url,
      description: addFormDescription.trim(),
    };
    const newImpacts = [...localImpacts, newItem];
    setLocalImpacts(newImpacts);
    resetAddForm();
    await saveImpacts(newImpacts);
  };

  const disabledDocumentIds = localImpacts
    .map((item) => item.affectedDocumentId)
    .filter((id): id is string => Boolean(id));

  const disabledDocumentTitles = new Set(
    localImpacts
      .filter((item) => !item.affectedDocumentId)
      .map((item) => item.affectedDocumentTitle.toLowerCase())
  );

  if (isConfirmingReimplement) {
    return (
      <ModalBody>
        <ConfirmBox>
          <ConfirmIcon>🔄</ConfirmIcon>
          <ConfirmText>
            This card has already been implemented. Do you want to re-implement it?
          </ConfirmText>
        </ConfirmBox>
        <Actions>
          <Button onClick={() => setIsConfirmingReimplement(false)} neutral>
            Cancel
          </Button>
          <ImplementButton
            onClick={() => {
              setIsConfirmingReimplement(false);
              onImplement();
            }}
            $loading={false}
          >
            Re-implement
          </ImplementButton>
        </Actions>
      </ModalBody>
    );
  }

  if (isConfirmingCancel) {
    return (
      <ModalBody>
        <ConfirmBox>
          <ConfirmIcon>⚠️</ConfirmIcon>
          <ConfirmText>
            Are you sure you want to clear this analysis result?
            <br />
            The card will return to the unanalyzed state.
          </ConfirmText>
        </ConfirmBox>
        <Actions>
          <Button onClick={() => setIsConfirmingCancel(false)} neutral>
            Back
          </Button>
          <DangerButton onClick={onCancel}>
            Confirm delete
          </DangerButton>
        </Actions>
      </ModalBody>
    );
  }

  return (
    <ModalBody>
      {/* ── Status banner ── */}
      <StatusBanner $hasImpacts={hasImpacts}>
        <BannerIcon>{hasImpacts ? "⚠️" : "✅"}</BannerIcon>
        <BannerText>
          {hasImpacts
            ? `Detected ${localImpacts.length} usecase${localImpacts.length !== 1 ? "s" : ""} that may be affected by this change request.`
            : "No usecases are affected by this change request."}
        </BannerText>
      </StatusBanner>

      {/* ── Impact list ── */}
      {hasImpacts && (
        <ImpactList role="list">
          {localImpacts.map((item, index) => {
            const dims = parseDimensions(item.description);
            const isConfirmingDelete = confirmDeleteIndex === index;
            return (
              <ImpactCard key={index} role="listitem">
                {isConfirmingDelete ? (
                  <DeleteConfirmBox>
                    <DeleteConfirmText>
                      Remove this usecase from the impact list?
                    </DeleteConfirmText>
                    <DeleteConfirmActions>
                      <Button
                        onClick={() => setConfirmDeleteIndex(null)}
                        neutral
                        size="small"
                      >
                        Back
                      </Button>
                      <DangerButton
                        onClick={() => void handleConfirmDelete()}
                        style={{ minWidth: 0, padding: "4px 12px" }}
                      >
                        Confirm delete
                      </DangerButton>
                    </DeleteConfirmActions>
                  </DeleteConfirmBox>
                ) : (
                  <>
                    <CardTitle>
                      {item.affectedDocumentUrl ? (
                        <DocLink
                          to={item.affectedDocumentUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <DocIcon>📄</DocIcon>
                          {item.affectedDocumentTitle}
                          <ExternalIcon>↗</ExternalIcon>
                        </DocLink>
                      ) : (
                        <>
                          <DocIcon>📄</DocIcon>
                          {item.affectedDocumentTitle}
                        </>
                      )}
                      <DeleteButton
                        onClick={() => setConfirmDeleteIndex(index)}
                        disabled={isControlsLocked}
                        title="Remove this usecase"
                        aria-label="Remove this usecase"
                      >
                        🗑️
                      </DeleteButton>
                    </CardTitle>
                    {dims ? (
                      <DimensionsWrapper>
                        <DimensionRow
                          label="Functional"
                          value={dims.functional}
                          color="#7c3aed"
                          disabled={isControlsLocked}
                          onSave={(v) =>
                            handleSaveDescription(
                              index,
                              `Functional: ${v}\nBusiness: ${dims.business}\nData: ${dims.data}`
                            )
                          }
                        />
                        <DimensionRow
                          label="Business"
                          value={dims.business}
                          color="#d97706"
                          disabled={isControlsLocked}
                          onSave={(v) =>
                            handleSaveDescription(
                              index,
                              `Functional: ${dims.functional}\nBusiness: ${v}\nData: ${dims.data}`
                            )
                          }
                        />
                        <DimensionRow
                          label="Data"
                          value={dims.data}
                          color="#16a34a"
                          disabled={isControlsLocked}
                          onSave={(v) =>
                            handleSaveDescription(
                              index,
                              `Functional: ${dims.functional}\nBusiness: ${dims.business}\nData: ${v}`
                            )
                          }
                        />
                      </DimensionsWrapper>
                    ) : (
                      <InlineEditText
                        value={item.description}
                        multiline
                        disabled={isControlsLocked}
                        onSave={(v) => handleSaveDescription(index, v)}
                      />
                    )}
                  </>
                )}
              </ImpactCard>
            );
          })}
        </ImpactList>
      )}

      {/* ── Add impact ── */}
      {isAddFormOpen ? (
        <AddFormCard>
          <AddFormHeader>
            <AddFormTitle>Add affected usecase</AddFormTitle>
            <CloseButton
              onClick={resetAddForm}
              aria-label="Cancel"
              title="Cancel"
            >
              ✕
            </CloseButton>
          </AddFormHeader>
          <ImpactDocumentPicker
            disabledDocumentIds={disabledDocumentIds}
            disabledDocumentTitles={disabledDocumentTitles}
            onSelect={(doc) => setAddFormDoc(doc)}
            disabled={isControlsLocked}
          />
          {addFormDoc && (
            <SelectedDocBadge>
              <span>📄</span>
              <span>{addFormDoc.title}</span>
            </SelectedDocBadge>
          )}
          <AddFormTextarea
            value={addFormDescription}
            onChange={(e) => setAddFormDescription(e.target.value)}
            onBlur={() => void handleAddFormBlur()}
            placeholder="Impact description (required)..."
            rows={3}
          />
          {!addFormDoc && (
            <AddFormHint>Please select a document above before saving</AddFormHint>
          )}
          {addFormDoc && !addFormDescription.trim() && (
            <AddFormHint>Enter a description then click outside to save</AddFormHint>
          )}
        </AddFormCard>
      ) : (
        <AddImpactButton
          onClick={() => setIsAddFormOpen(true)}
          disabled={isControlsLocked}
        >
          + Add affected usecase
        </AddImpactButton>
      )}

      {/* ── Footer actions ── */}
      <Actions>
        <Button onClick={() => setIsConfirmingCancel(true)} neutral>
          Cancel
        </Button>
        {implementStatus === "preview_ready" ? (
          <ViewSuggestedButton
            onClick={handleImplementClick}
            disabled={isImplementDisabled}
            title="View the suggested document changes from AI"
          >
            View suggested changes
          </ViewSuggestedButton>
        ) : (
          <ImplementButton
            onClick={handleImplementClick}
            disabled={isImplementDisabled}
            $loading={isImplementing}
            title={implementDisabledReason ?? undefined}
          >
            {isImplementing ? (
              <>
                <Spinner />
                Processing...
              </>
            ) : implementStatus === "completed" ? (
              "Re-implement"
            ) : (
              "Implement"
            )}
          </ImplementButton>
        )}
      </Actions>
    </ModalBody>
  );
}

// ─── Styled components ────────────────────────────────────────────────────────

const ModalBody = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 4px 0;
  min-height: 0;
`;

const StatusBanner = styled.div<{ $hasImpacts: boolean }>`
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 14px;
  border-radius: 8px;
  background: ${({ $hasImpacts }) =>
    $hasImpacts ? "rgba(217, 119, 6, 0.08)" : "rgba(22, 163, 74, 0.08)"};
  border: 1px solid
    ${({ $hasImpacts }) =>
      $hasImpacts ? "rgba(217, 119, 6, 0.25)" : "rgba(22, 163, 74, 0.25)"};
`;

const BannerIcon = styled.span`
  font-size: 16px;
  flex-shrink: 0;
  line-height: 1.4;
`;

const BannerText = styled.span`
  font-size: 13px;
  font-weight: 500;
  color: ${s("text")};
  line-height: 1.5;
`;

const ImpactList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 55vh;
  overflow-y: auto;
  padding-right: 2px;
`;

const ImpactCard = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 14px;
  border-radius: 8px;
  border: 1px solid ${s("divider")};
  background: ${s("backgroundSecondary")};
`;

const CardTitle = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: ${s("text")};
`;

const DeleteButton = styled.button`
  margin-left: auto;
  flex-shrink: 0;
  background: none;
  border: none;
  cursor: pointer;
  font-size: 13px;
  padding: 2px 4px;
  border-radius: 4px;
  opacity: 0.4;
  line-height: 1;
  transition: opacity 0.15s ease, background 0.15s ease;

  &:hover:not(:disabled) {
    opacity: 1;
    background: rgba(239, 68, 68, 0.08);
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.2;
  }
`;

const DeleteConfirmBox = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

const DeleteConfirmText = styled.p`
  font-size: 13px;
  color: ${s("text")};
  margin: 0;
  line-height: 1.5;
`;

const DeleteConfirmActions = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 8px;
`;

const DocIcon = styled.span`
  font-size: 14px;
  flex-shrink: 0;
`;

const DocLink = styled(Link)`
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: ${s("accent")};
  text-decoration: none;

  &:hover {
    color: ${s("accent")};
    text-decoration: none;
  }
`;

const ExternalIcon = styled.span`
  font-size: 11px;
  flex-shrink: 0;
  opacity: 0.8;
`;

const DimensionsWrapper = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const DimRow = styled.div`
  display: grid;
  grid-template-columns: 90px 1fr;
  gap: 8px;
  align-items: baseline;
`;

const DimLabel = styled.span<{ $color: string }>`
  font-size: 11px;
  font-weight: 700;
  color: ${({ $color }) => $color};
  text-transform: uppercase;
  letter-spacing: 0.04em;
  flex-shrink: 0;
`;

const DimValue = styled.span<{ $muted: boolean }>`
  font-size: 12px;
  color: ${({ $muted }) => ($muted ? s("textTertiary") : s("textSecondary"))};
  line-height: 1.5;
  font-style: ${({ $muted }) => ($muted ? "italic" : "normal")};
`;

const RawDescription = styled.div`
  font-size: 12px;
  color: ${s("textSecondary")};
  line-height: 1.6;
  white-space: pre-wrap;
`;

const inlineInputBase = css`
  font-size: 12px;
  line-height: 1.5;
  width: 100%;
  border: 1px solid ${s("inputBorder")};
  border-radius: 4px;
  padding: 2px 6px;
  background: ${s("background")};
  color: ${s("text")};
  outline: none;
  font-family: inherit;

  &:focus {
    border-color: ${s("inputBorderFocused")};
  }
`;

const InlineInput = styled.input`
  ${inlineInputBase}
`;

const InlineTextarea = styled.textarea`
  ${inlineInputBase}
  resize: vertical;
  min-height: 60px;
`;

const Actions = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 4px;
  border-top: 1px solid ${s("divider")};
  margin-top: 4px;
`;

const ConfirmBox = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 16px;
  background: rgba(239, 68, 68, 0.06);
  border: 1px solid rgba(239, 68, 68, 0.2);
  border-radius: 8px;
`;

const ConfirmIcon = styled.span`
  font-size: 18px;
  flex-shrink: 0;
  line-height: 1.3;
`;

const ConfirmText = styled.p`
  font-size: 13px;
  color: ${s("text")};
  line-height: 1.6;
  margin: 0;
`;

const DangerButton = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 16px;
  border-radius: 6px;
  border: none;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  background: ${({ theme }) => theme.danger};
  color: white;
  transition: filter 0.15s ease;
  min-width: 120px;
  justify-content: center;

  &:hover {
    filter: brightness(0.9);
  }

  &:focus-visible {
    outline: 2px solid ${s("danger")};
    outline-offset: 2px;
  }
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

const ImplementButton = styled.button<{ $loading: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 16px;
  border-radius: 6px;
  border: none;
  font-size: 13px;
  font-weight: 600;
  cursor: ${({ disabled }) => (disabled ? "not-allowed" : "pointer")};
  background: ${({ theme }) => theme.accent};
  color: white;
  opacity: ${({ disabled }) => (disabled ? 0.6 : 1)};
  transition: filter 0.15s ease, opacity 0.15s ease;
  min-width: 100px;
  justify-content: center;

  &:hover:not(:disabled) {
    filter: brightness(0.92);
  }

  &:active:not(:disabled) {
    filter: brightness(0.85);
  }

  &:focus-visible {
    outline: 2px solid ${s("accent")};
    outline-offset: 2px;
  }
`;

const ViewSuggestedButton = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 16px;
  border-radius: 6px;
  border: 2px solid ${s("accent")};
  font-size: 13px;
  font-weight: 600;
  cursor: ${({ disabled }) => (disabled ? "not-allowed" : "pointer")};
  background: ${({ theme }) => `${theme.accent}18`};
  color: ${s("accent")};
  opacity: ${({ disabled }) => (disabled ? 0.6 : 1)};
  transition: background 0.15s ease, opacity 0.15s ease;
  min-width: 100px;
  justify-content: center;

  &:hover:not(:disabled) {
    background: ${({ theme }) => `${theme.accent}28`};
  }

  &:focus-visible {
    outline: 2px solid ${s("accent")};
    outline-offset: 2px;
  }
`;

const AddImpactButton = styled.button`
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 8px 12px;
  border: 1px dashed ${s("divider")};
  border-radius: 8px;
  background: none;
  color: ${s("textTertiary")};
  font-size: 13px;
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease;

  &:hover:not(:disabled) {
    border-color: ${s("accent")};
    color: ${s("accent")};
  }

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
`;

const AddFormCard = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 14px;
  border-radius: 8px;
  border: 1px solid ${s("accent")};
  background: ${s("backgroundSecondary")};
`;

const AddFormHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
`;

const AddFormTitle = styled.span`
  font-size: 12px;
  font-weight: 600;
  color: ${s("textSecondary")};
  text-transform: uppercase;
  letter-spacing: 0.04em;
`;

const CloseButton = styled.button`
  background: none;
  border: none;
  cursor: pointer;
  font-size: 14px;
  color: ${s("textTertiary")};
  padding: 2px 4px;
  border-radius: 4px;
  line-height: 1;

  &:hover {
    color: ${s("text")};
    background: ${s("backgroundTertiary")};
  }
`;

const SelectedDocBadge = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  color: ${s("accent")};
  padding: 4px 8px;
  background: ${s("mentionBackground")};
  border-radius: 4px;
`;

const AddFormTextarea = styled.textarea`
  width: 100%;
  font-size: 12px;
  line-height: 1.5;
  padding: 6px 8px;
  border: 1px solid ${s("inputBorder")};
  border-radius: 6px;
  background: ${s("background")};
  color: ${s("text")};
  font-family: inherit;
  resize: vertical;
  min-height: 64px;
  outline: none;
  box-sizing: border-box;

  &::placeholder {
    color: ${s("placeholder")};
  }

  &:focus {
    border-color: ${s("inputBorderFocused")};
  }

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
`;

const AddFormHint = styled.span`
  font-size: 11px;
  color: ${s("textTertiary")};
  font-style: italic;
`;

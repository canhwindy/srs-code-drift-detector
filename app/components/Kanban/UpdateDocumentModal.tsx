import { useState, useEffect } from "react";
import styled from "styled-components";
import { s } from "@shared/styles";
import Button from "~/components/Button";
import PlaceholderText from "~/components/PlaceholderText";
import useStores from "~/hooks/useStores";
import ReasoningSection from "./ReasoningSection";
import type { AnalyzeImpactResult, ImplementPreviewData } from "./types";

export type SelectedDocumentChange = {
  documentId: string;
  selectedEditIndices: number[];
};

export interface UpdateDocumentModalProps {
  preview: ImplementPreviewData;
  onConfirm: (selectedChanges: SelectedDocumentChange[]) => void;
  onCancel: () => void;
  readOnly?: boolean;
  impactAnalysisResult?: AnalyzeImpactResult | null;
  onViewImpact?: () => void;
}

export default function UpdateDocumentModal({
  preview,
  onConfirm,
  onCancel,
  readOnly = false,
  impactAnalysisResult,
  onViewImpact,
}: UpdateDocumentModalProps) {
  const { documents } = useStores();
  const changes = preview.documentChanges ?? [];

  // Map<documentId, Set<editIndex>> — all checked by default
  const [selectedEditIndices, setSelectedEditIndices] = useState<Map<string, Set<number>>>(
    () => new Map(
      changes.map((c) => [
        c.documentId,
        new Set((c.textEdits ?? []).map((_, i) => i)),
      ])
    )
  );

  const [expandedDocs, setExpandedDocs] = useState<Set<string>>(new Set());
  const [loadingDocIds, setLoadingDocIds] = useState<Set<string>>(
    () => new Set(changes.map((c) => c.documentId))
  );
  const [documentUrls, setDocumentUrls] = useState<Map<string, string>>(
    new Map()
  );

  useEffect(() => {
    changes.forEach(async (change) => {
      try {
        const doc = await documents.fetch(change.documentId);
        if (doc?.url) {
          setDocumentUrls((prev) =>
            new Map(prev).set(change.documentId, doc.url)
          );
        }
      } finally {
        setLoadingDocIds((prev) => {
          const next = new Set(prev);
          next.delete(change.documentId);
          return next;
        });
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleDocExpand = (docId: string) => {
    setExpandedDocs((prev) => {
      const next = new Set(prev);
      if (next.has(docId)) {
        next.delete(docId);
      } else {
        next.add(docId);
      }
      return next;
    });
  };

  const toggleEditIndex = (docId: string, index: number) => {
    if (readOnly) { return; }
    setSelectedEditIndices((prev) => {
      const next = new Map(prev);
      const docSet = new Set(next.get(docId) ?? []);
      if (docSet.has(index)) {
        docSet.delete(index);
      } else {
        docSet.add(index);
      }
      next.set(docId, docSet);
      return next;
    });
  };

  const toggleMasterDoc = (docId: string, totalEdits: number) => {
    if (readOnly) { return; }
    setSelectedEditIndices((prev) => {
      const next = new Map(prev);
      const docSet = next.get(docId) ?? new Set<number>();
      const allChecked = docSet.size === totalEdits;
      if (allChecked) {
        next.set(docId, new Set());
      } else {
        next.set(docId, new Set(Array.from({ length: totalEdits }, (_, i) => i)));
      }
      return next;
    });
  };

  const totalSelectedEdits = Array.from(selectedEditIndices.values()).reduce(
    (sum, s) => sum + s.size,
    0
  );

  const handleConfirm = () => {
    const payload: SelectedDocumentChange[] = [];
    for (const change of changes) {
      const docSet = selectedEditIndices.get(change.documentId);
      if (!docSet || docSet.size === 0) { continue; }
      payload.push({
        documentId: change.documentId,
        selectedEditIndices: Array.from(docSet).sort((a, b) => a - b),
      });
    }
    onConfirm(payload);
  };

  return (
    <ModalBody>
      <Section>
        <Label>
          {changes.length > 0
            ? readOnly
              ? `AI đã cập nhật ${changes.length} tài liệu:`
              : `AI đề xuất cập nhật ${changes.length} tài liệu:`
            : readOnly
            ? "Tài liệu đã được cập nhật"
            : "Xác nhận cập nhật tài liệu"}
        </Label>
      </Section>

      {changes.length > 0 && (
        <DocumentList>
          {changes.map((change) => {
            const textEdits = change.textEdits ?? [];
            const hasEdits = textEdits.length > 0;
            const isExpanded = expandedDocs.has(change.documentId);
            const docSet = selectedEditIndices.get(change.documentId) ?? new Set<number>();
            const allChecked = hasEdits && docSet.size === textEdits.length;
            const isDocSelected = docSet.size > 0;

            return (
              <DocumentItem key={change.documentId} $isSelected={isDocSelected}>
                <DocumentItemHeader>
                  <CheckboxWrapper
                    onClick={() =>
                      !readOnly && toggleMasterDoc(change.documentId, textEdits.length)
                    }
                  >
                    <Checkbox
                      type="checkbox"
                      checked={allChecked}
                      disabled={readOnly || !hasEdits}
                      onChange={() =>
                        !readOnly && toggleMasterDoc(change.documentId, textEdits.length)
                      }
                    />
                    {loadingDocIds.has(change.documentId) ? (
                      <PlaceholderText minWidth={50} maxWidth={80} height={14} style={{ marginBottom: 0, flex: 1 }} />
                    ) : documentUrls.has(change.documentId) ? (
                      <DocItemTitleLink
                        href={documentUrls.get(change.documentId)}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {change.documentTitle || "(Không có tiêu đề)"}
                      </DocItemTitleLink>
                    ) : (
                      <DocItemTitle>{change.documentTitle || "(Không có tiêu đề)"}</DocItemTitle>
                    )}
                  </CheckboxWrapper>
                  <Badge $isUserProvided={change.isUserProvided}>
                    {change.isUserProvided ? "User provided" : "AI discovered"}
                  </Badge>
                  {hasEdits && (
                    <ExpandButton onClick={() => toggleDocExpand(change.documentId)}>
                      {isExpanded ? "Thu gọn" : `Xem diff (${textEdits.length})`}
                    </ExpandButton>
                  )}
                </DocumentItemHeader>

                {change.changesSummary.length > 0 && (
                  <ChangeList>
                    {change.changesSummary.map((item, i) => (
                      <ChangeItem key={i}>{item}</ChangeItem>
                    ))}
                  </ChangeList>
                )}

                {hasEdits && isExpanded && (
                  <TextEditList>
                    {textEdits.map((edit, i) => {
                      const isEditChecked = docSet.has(i);
                      return (
                        <TextEditBlock
                          key={i}
                          $checked={isEditChecked}
                          onClick={() => toggleEditIndex(change.documentId, i)}
                          style={{ cursor: readOnly ? "default" : "pointer" }}
                        >
                          <TextEditBlockHeader>
                            <EditCheckbox
                              type="checkbox"
                              checked={isEditChecked}
                              disabled={readOnly}
                              onChange={() => toggleEditIndex(change.documentId, i)}
                              onClick={(e) => e.stopPropagation()}
                            />
                            {edit.description && (
                              <EditDescription>{edit.description}</EditDescription>
                            )}
                          </TextEditBlockHeader>
                          <DiffRow>
                            <DiffBlock $type="old">
                              <DiffLabel>−</DiffLabel>
                              <DiffContent>{edit.oldString || "(trống)"}</DiffContent>
                            </DiffBlock>
                            <DiffBlock $type="new">
                              <DiffLabel>+</DiffLabel>
                              <DiffContent>{edit.newString || "(xóa)"}</DiffContent>
                            </DiffBlock>
                          </DiffRow>
                        </TextEditBlock>
                      );
                    })}
                  </TextEditList>
                )}
              </DocumentItem>
            );
          })}
        </DocumentList>
      )}

      <ReasoningSection reasoning={preview.reasoning} />

      <Footer>
        <FooterLeft>
          {impactAnalysisResult && onViewImpact && (
            <ImpactButton onClick={onViewImpact} type="button">
              Impact analysis result
            </ImpactButton>
          )}
        </FooterLeft>
        <Actions>
          {readOnly ? (
            <Button onClick={onCancel}>Close</Button>
          ) : (
            <>
              <Button onClick={onCancel} neutral>
                Cancel
              </Button>
              <Button
                onClick={handleConfirm}
                disabled={totalSelectedEdits === 0}
              >
                Confirm update
              </Button>
            </>
          )}
        </Actions>
      </Footer>
    </ModalBody>
  );
}

const ModalBody = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 4px 0;
`;

const Section = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const Label = styled.div`
  font-size: 12px;
  font-weight: 600;
  color: ${s("textTertiary")};
  text-transform: uppercase;
  letter-spacing: 0.04em;
`;

const DocumentList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

const DocumentItem = styled.div<{ $isSelected: boolean }>`
  background: ${s("backgroundSecondary")};
  border: 1px solid ${(p) => (p.$isSelected ? s("accent")(p) : "transparent")};
  border-radius: 8px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  transition: border-color 0.15s ease;
`;

const DocumentItemHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
`;

const CheckboxWrapper = styled.label`
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  flex: 1;
  min-width: 0;
`;

const Checkbox = styled.input`
  flex-shrink: 0;
  width: 14px;
  height: 14px;
  cursor: pointer;
`;

const DocItemTitle = styled.div`
  font-size: 14px;
  font-weight: 600;
  color: ${s("text")};
  flex: 1;
  min-width: 0;
`;

const DocItemTitleLink = styled.a`
  font-size: 14px;
  font-weight: 600;
  color: ${s("text")};
  flex: 1;
  min-width: 0;
  text-decoration: none;
  &:hover {
    text-decoration: underline;
    color: ${s("accent")};
  }
`;

const Badge = styled.span<{ $isUserProvided: boolean }>`
  font-size: 10px;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 20px;
  white-space: nowrap;
  background: ${({ $isUserProvided }) =>
    $isUserProvided ? "rgba(99, 102, 241, 0.12)" : "rgba(16, 185, 129, 0.12)"};
  color: ${({ $isUserProvided }) =>
    $isUserProvided ? "rgb(99, 102, 241)" : "rgb(16, 185, 129)"};
`;

const ChangeList = styled.ul`
  margin: 0;
  padding-left: 16px;
  display: flex;
  flex-direction: column;
  gap: 3px;
`;

const ChangeItem = styled.li`
  font-size: 13px;
  color: ${s("textSecondary")};
  line-height: 1.5;
`;

const ExpandButton = styled.button`
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 4px;
  border: 1px solid ${s("divider")};
  background: transparent;
  color: ${s("textSecondary")};
  cursor: pointer;
  white-space: nowrap;
  &:hover {
    background: ${s("backgroundSecondary")};
  }
`;

const TextEditList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 4px;
`;

const TextEditBlock = styled.div<{ $checked: boolean }>`
  display: flex;
  flex-direction: column;
  gap: 2px;
  border-radius: 6px;
  overflow: hidden;
  border: 1px solid ${s("divider")};
  opacity: ${({ $checked }) => ($checked ? 1 : 0.4)};
  transition: opacity 0.15s ease;
`;

const TextEditBlockHeader = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 4px 8px;
  background: ${s("backgroundSecondary")};
`;

const EditCheckbox = styled.input`
  flex-shrink: 0;
  width: 13px;
  height: 13px;
  margin-top: 1px;
  cursor: pointer;
`;

const EditDescription = styled.div`
  font-size: 11px;
  font-weight: 600;
  color: ${s("textTertiary")};
  flex: 1;
`;

const DiffRow = styled.div`
  display: flex;
  flex-direction: row;
`;

const DiffBlock = styled.div<{ $type: "old" | "new" }>`
  display: flex;
  flex: 1;
  min-width: 0;
  background: ${({ $type }) =>
    $type === "old" ? "rgba(239, 68, 68, 0.08)" : "rgba(34, 197, 94, 0.08)"};
  border-right: ${({ $type }) =>
    $type === "old" ? "1px solid rgba(128, 128, 128, 0.15)" : "none"};
`;

const DiffLabel = styled.span`
  font-size: 12px;
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
  padding: 4px 6px;
  color: ${s("textTertiary")};
  user-select: none;
  flex-shrink: 0;
`;

const DiffContent = styled.pre`
  font-size: 12px;
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
  margin: 0;
  padding: 4px 8px 4px 0;
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.5;
  flex: 1;
  color: ${s("text")};
`;

const Footer = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 4px;
`;

const FooterLeft = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const ImpactButton = styled.button`
  font-size: 12px;
  font-weight: 500;
  color: ${s("accent")};
  background: none;
  border: 1px solid ${s("accent")};
  border-radius: 5px;
  padding: 4px 10px;
  cursor: pointer;
  transition: background 0.15s ease;

  &:hover {
    background: ${({ theme }) => `${theme.accent}15`};
  }
`;

const Actions = styled.div`
  display: flex;
  gap: 8px;
`;

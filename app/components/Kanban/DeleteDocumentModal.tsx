import * as React from "react";
import { useState, useRef, useCallback, useMemo } from "react";
import { Link } from "react-router-dom";
import styled from "styled-components";
import { s } from "@shared/styles";
import Button from "~/components/Button";
import ReasoningSection from "./ReasoningSection";
import type { AnalyzeImpactResult, ImplementPreviewData } from "./types";

export interface DeleteDocumentModalProps {
  preview: ImplementPreviewData;
  cardId?: string;
  onConfirm: (selectedDocumentIds: string[]) => void;
  onCancel: () => void;
  readOnly?: boolean;
  impactAnalysisResult?: AnalyzeImpactResult | null;
  onViewImpact?: () => void;
}

export default function DeleteDocumentModal({
  preview,
  onConfirm,
  onCancel,
  readOnly = false,
  impactAnalysisResult,
  onViewImpact,
}: DeleteDocumentModalProps) {
  const ids = useMemo(() => preview.deleteDocumentIds ?? [], [preview.deleteDocumentIds]);
  const titles = preview.deleteDocumentTitles ?? [];
  const urls = preview.deleteDocumentUrls ?? [];

  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set(ids));

  const allSelected = ids.length > 0 && selectedIds.size === ids.length;
  const someSelected = selectedIds.size > 0 && !allSelected;

  const selectAllRef = useRef<HTMLInputElement>(null);
  if (selectAllRef.current) {
    selectAllRef.current.indeterminate = someSelected;
  }

  const toggleAll = useCallback(() => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(ids));
    }
  }, [allSelected, ids]);

  const toggleOne = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const hasDocs = ids.length > 0;

  return (
    <ModalBody>
      <Section>
        <Label>
          {hasDocs
            ? readOnly
              ? `Tài liệu đã xóa (${ids.length}):`
              : `Tài liệu cần xóa (${ids.length}):`
            : readOnly
            ? "Tài liệu đã xóa:"
            : "Tài liệu cần xóa:"}
        </Label>

        {hasDocs ? (
          <DocumentList>
            {!readOnly && (
              <SelectAllRow onClick={toggleAll}>
                <Checkbox
                  ref={selectAllRef}
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  onClick={(e) => e.stopPropagation()}
                />
                <SelectAllLabel>
                  Chọn tất cả ({selectedIds.size}/{ids.length})
                </SelectAllLabel>
              </SelectAllRow>
            )}

            {ids.map((id, index) => {
              const title = titles[index] ?? "(Không có tiêu đề)";
              const url = urls[index] ?? null;
              const checked = selectedIds.has(id);

              return (
                <DocumentItem key={id} $checked={checked} onClick={() => !readOnly && toggleOne(id)}>
                  <Checkbox
                    type="checkbox"
                    checked={checked}
                    disabled={readOnly}
                    onChange={() => !readOnly && toggleOne(id)}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <DeleteDot $checked={checked} />
                  {url ? (
                    <DocLink
                      to={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {title}
                      <ExternalIcon>↗</ExternalIcon>
                    </DocLink>
                  ) : (
                    <DocTitle>{title}</DocTitle>
                  )}
                </DocumentItem>
              );
            })}
          </DocumentList>
        ) : (
          <EmptyState>
            AI không xác định được tài liệu cụ thể nào cần xóa. Vui lòng tự tìm kiếm và xóa thủ công.
          </EmptyState>
        )}
      </Section>

      {hasDocs && (
        <InfoBox>
          ℹ️ Tài liệu đã xóa có thể khôi phục trong Trash.
        </InfoBox>
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
                onClick={() => onConfirm(Array.from(selectedIds))}
                disabled={selectedIds.size === 0}
              >
                {selectedIds.size > 0
                  ? `Delete ${selectedIds.size} selected document${selectedIds.size !== 1 ? "s" : ""}`
                  : "Select documents to delete"}
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
  gap: 8px;
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
  gap: 4px;
  border: 1px solid ${s("divider")};
  border-radius: 8px;
  overflow: hidden;
`;

const SelectAllRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  background: ${s("backgroundSecondary")};
  border-bottom: 1px solid ${s("divider")};
  cursor: pointer;
  user-select: none;

  &:hover {
    background: ${s("listItemHoverBackground")};
  }
`;

const SelectAllLabel = styled.span`
  font-size: 13px;
  font-weight: 600;
  color: ${s("text")};
`;

const Checkbox = styled.input`
  width: 15px;
  height: 15px;
  flex-shrink: 0;
  cursor: pointer;
  accent-color: ${s("accent")};
`;

const DocumentItem = styled.div<{ $checked: boolean }>`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  cursor: pointer;
  user-select: none;
  background: ${({ $checked }) => ($checked ? "transparent" : "transparent")};
  opacity: ${({ $checked }) => ($checked ? 1 : 0.55)};

  &:hover {
    background: ${s("listItemHoverBackground")};
    opacity: 1;
  }

  &:not(:last-child) {
    border-bottom: 1px solid ${s("divider")};
  }
`;

const DeleteDot = styled.span<{ $checked: boolean }>`
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: ${({ $checked }) => ($checked ? "rgb(239, 68, 68)" : s("textTertiary"))};
  flex-shrink: 0;
  transition: background 0.15s ease;
`;

const DocLink = styled(Link)`
  font-size: 14px;
  font-weight: 500;
  color: ${s("accent")};
  text-decoration: none;
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1;
  min-width: 0;
  word-break: break-word;

  &:hover {
    text-decoration: underline;
  }
`;

const ExternalIcon = styled.span`
  font-size: 12px;
  opacity: 0.7;
  flex-shrink: 0;
`;

const DocTitle = styled.div`
  font-size: 14px;
  font-weight: 500;
  color: ${s("text")};
  flex: 1;
  min-width: 0;
  word-break: break-word;
`;

const EmptyState = styled.div`
  font-size: 13px;
  color: ${s("textSecondary")};
  line-height: 1.5;
  padding: 10px 12px;
  background: ${s("backgroundSecondary")};
  border-radius: 6px;
`;

const InfoBox = styled.div`
  font-size: 13px;
  color: ${s("textSecondary")};
  background: ${s("backgroundSecondary")};
  border-radius: 6px;
  padding: 10px 12px;
  line-height: 1.5;
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
  justify-content: flex-end;
  gap: 8px;
`;

import * as React from "react";
import styled from "styled-components";
import { s } from "@shared/styles";
import Button from "~/components/Button";
import ReasoningSection from "./ReasoningSection";
import type { AnalyzeImpactResult, DocumentToCreate, ImplementPreviewData } from "./types";

export interface CreateDocumentModalProps {
  preview: ImplementPreviewData;
  onConfirm: (selectedIndexes: number[]) => void;
  onCancel: () => void;
  readOnly?: boolean;
  impactAnalysisResult?: AnalyzeImpactResult | null;
  onViewImpact?: () => void;
}

export default function CreateDocumentModal({
  preview,
  onConfirm,
  onCancel,
  readOnly = false,
  impactAnalysisResult,
  onViewImpact,
}: CreateDocumentModalProps) {
  const docs: DocumentToCreate[] = preview.documentsToCreate ?? [];

  const [selectedIndexes, setSelectedIndexes] = React.useState<number[]>(
    () => docs.map((_, i) => i)
  );
  const [expandedIndex, setExpandedIndex] = React.useState<number | null>(null);

  const toggleSelect = (index: number) => {
    setSelectedIndexes((prev) =>
      prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index]
    );
  };

  const toggleExpand = (index: number) => {
    setExpandedIndex((prev) => (prev === index ? null : index));
  };

  const selectedCount = selectedIndexes.length;
  const confirmLabel =
    selectedCount === 0
      ? "Create document"
      : selectedCount === 1
        ? "Create 1 document"
        : `Create ${selectedCount} documents`;

  return (
    <ModalBody>
      <Header>
        <HeaderTitle>
          {readOnly ? "AI created" : "AI will create"} {docs.length} document{docs.length !== 1 ? "s" : ""}:
        </HeaderTitle>
      </Header>

      <DocList>
        {docs.map((doc, index) => {
          const isSelected = selectedIndexes.includes(index);
          const isExpanded = expandedIndex === index;
          const contentPreview = doc.content;

          return (
            <DocItem key={index} $isSelected={isSelected}>
              <DocItemHeader>
                <CheckboxWrapper onClick={() => !readOnly && toggleSelect(index)}>
                  <Checkbox type="checkbox" checked={isSelected} disabled={readOnly} onChange={() => !readOnly && toggleSelect(index)} />
                  <DocTitle>{doc.title}</DocTitle>
                </CheckboxWrapper>
                <ExpandButton onClick={() => toggleExpand(index)}>
                  {isExpanded ? "Collapse" : "View"}
                  <Arrow $expanded={isExpanded}>▼</Arrow>
                </ExpandButton>
              </DocItemHeader>

              {isExpanded && contentPreview && (
                <ContentPreview>{contentPreview}</ContentPreview>
              )}
            </DocItem>
          );
        })}
      </DocList>

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
                onClick={() => onConfirm(selectedIndexes)}
                disabled={selectedCount === 0}
              >
                {confirmLabel}
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
  gap: 12px;
  padding: 4px 0;
`;

const Header = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const HeaderTitle = styled.div`
  font-size: 13px;
  font-weight: 600;
  color: ${s("textSecondary")};
`;


const DocList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const DocItem = styled.div<{ $isSelected: boolean }>`
  border: 1px solid ${(p) => (p.$isSelected ? s("accent")(p) : s("divider")(p))};
  border-radius: 6px;
  overflow: hidden;
  transition: border-color 0.15s ease;
`;

const DocItemHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  gap: 8px;
  cursor: default;
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

const DocTitle = styled.div`
  font-size: 14px;
  font-weight: 600;
  color: ${s("text")};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const ExpandButton = styled.button`
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: ${s("textTertiary")};
  background: none;
  border: none;
  padding: 2px 6px;
  cursor: pointer;
  flex-shrink: 0;
  border-radius: 4px;

  &:hover {
    color: ${s("text")};
    background: ${s("backgroundSecondary")};
  }
`;

const Arrow = styled.span<{ $expanded: boolean }>`
  font-size: 10px;
  display: inline-block;
  transform: ${(p) => (p.$expanded ? "rotate(180deg)" : "rotate(0deg)")};
  transition: transform 0.15s ease;
`;

const ContentPreview = styled.pre`
  font-size: 12px;
  color: ${s("textSecondary")};
  background: ${s("backgroundSecondary")};
  padding: 8px 12px;
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.6;
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
  border-top: 1px solid ${s("divider")};
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
  transition: background 0.15s ease, opacity 0.15s ease;

  &:hover {
    background: ${({ theme }) => `${theme.accent}15`};
  }
`;

const Actions = styled.div`
  display: flex;
  gap: 8px;
`;

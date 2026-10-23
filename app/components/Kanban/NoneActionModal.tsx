import * as React from "react";
import styled from "styled-components";
import { s } from "@shared/styles";
import Button from "~/components/Button";
import type { AnalyzeImpactResult, ImplementPreviewData } from "./types";

export interface NoneActionModalProps {
  preview: ImplementPreviewData;
  onConfirm: () => void;
  onCancel?: () => void;
  readOnly?: boolean;
  impactAnalysisResult?: AnalyzeImpactResult | null;
  onViewImpact?: () => void;
}

export default function NoneActionModal({
  preview,
  onConfirm,
  onCancel,
  readOnly = false,
  impactAnalysisResult,
  onViewImpact,
}: NoneActionModalProps) {
  return (
    <ModalBody>
      <Section>
        <Label>Analysis result:</Label>
        <Reasoning>
          AI determined that no document operation is needed for this card.
        </Reasoning>
      </Section>

      {preview.reasoning && (
        <Section>
          <Label>Reasoning:</Label>
          <Reasoning>{preview.reasoning}</Reasoning>
        </Section>
      )}

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
            <Button onClick={onConfirm}>OK</Button>
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

const Reasoning = styled.div`
  font-size: 13px;
  color: ${s("textSecondary")};
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

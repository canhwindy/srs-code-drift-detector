import * as React from "react";
import { useState } from "react";
import styled from "styled-components";
import { s } from "@shared/styles";
import type { ImpactAnalysisResult, ImpactItem } from "./types";

interface ImpactAnalysisSectionProps {
  impactAnalysis?: ImpactAnalysisResult | null;
}

const SEVERITY_CONFIG: Record<
  ImpactItem["severity"],
  { label: string; color: string; bg: string }
> = {
  high: { label: "Cao", color: "#dc2626", bg: "rgba(220, 38, 38, 0.08)" },
  medium: { label: "Trung bình", color: "#d97706", bg: "rgba(217, 119, 6, 0.08)" },
  low: { label: "Thấp", color: "#2563eb", bg: "rgba(37, 99, 235, 0.08)" },
};

const IMPACT_TYPE_LABEL: Record<ImpactItem["impactType"], string> = {
  use_case: "Use Case",
  business_rule: "Business Rule",
  actor: "Actor",
  api: "API",
  data_flow: "Data Flow",
  other: "Khác",
};

export default function ImpactAnalysisSection({
  impactAnalysis,
}: ImpactAnalysisSectionProps) {
  const hasImpacts = impactAnalysis?.hasImpacts ?? false;
  const [expanded, setExpanded] = useState(hasImpacts);

  if (!impactAnalysis) {
    return null;
  }

  return (
    <Wrapper>
      <SectionHeader
        onClick={() => setExpanded((v) => !v)}
        $hasImpacts={hasImpacts}
      >
        <HeaderLeft>
          <SectionIcon>{hasImpacts ? "⚠️" : "✅"}</SectionIcon>
          <SectionTitle>Phân tích ảnh hưởng</SectionTitle>
          <StatusBadge $hasImpacts={hasImpacts}>
            {hasImpacts
              ? `${impactAnalysis.impacts.length} ảnh hưởng`
              : "Không có ảnh hưởng"}
          </StatusBadge>
        </HeaderLeft>
        <ToggleArrow $expanded={expanded}>▼</ToggleArrow>
      </SectionHeader>

      {expanded && (
        <SectionBody>
          <SummaryText>{impactAnalysis.summary}</SummaryText>

          {hasImpacts && impactAnalysis.impacts.length > 0 && (
            <ImpactList>
              {impactAnalysis.impacts.map((impact, i) => {
                const cfg = SEVERITY_CONFIG[impact.severity] ?? SEVERITY_CONFIG.low;
                return (
                  <ImpactItem key={i} $bg={cfg.bg}>
                    <ImpactHeader>
                      <ImpactTypePill>{IMPACT_TYPE_LABEL[impact.impactType] ?? impact.impactType}</ImpactTypePill>
                      <SeverityBadge $color={cfg.color}>{cfg.label}</SeverityBadge>
                      <AffectedDoc>
                        {impact.affectedDocumentTitle}
                        {impact.affectedElement && (
                          <AffectedElement> — {impact.affectedElement}</AffectedElement>
                        )}
                      </AffectedDoc>
                    </ImpactHeader>
                    <ImpactDescription>{impact.description}</ImpactDescription>
                  </ImpactItem>
                );
              })}
            </ImpactList>
          )}
        </SectionBody>
      )}
    </Wrapper>
  );
}

const Wrapper = styled.div`
  border: 1px solid ${s("divider")};
  border-radius: 8px;
  overflow: hidden;
`;

const SectionHeader = styled.div<{ $hasImpacts: boolean }>`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  cursor: pointer;
  user-select: none;
  background: ${(p) =>
    p.$hasImpacts ? "rgba(217, 119, 6, 0.06)" : "rgba(22, 163, 74, 0.06)"};

  &:hover {
    background: ${s("listItemHoverBackground")};
  }
`;

const HeaderLeft = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
`;

const SectionIcon = styled.span`
  font-size: 14px;
  flex-shrink: 0;
`;

const SectionTitle = styled.span`
  font-size: 12px;
  font-weight: 600;
  color: ${s("textSecondary")};
  text-transform: uppercase;
  letter-spacing: 0.04em;
  flex-shrink: 0;
`;

const StatusBadge = styled.span<{ $hasImpacts: boolean }>`
  font-size: 11px;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 10px;
  color: ${(p) => (p.$hasImpacts ? "#d97706" : "#16a34a")};
  background: ${(p) =>
    p.$hasImpacts ? "rgba(217, 119, 6, 0.12)" : "rgba(22, 163, 74, 0.12)"};
  flex-shrink: 0;
`;

const ToggleArrow = styled.span<{ $expanded: boolean }>`
  font-size: 10px;
  color: ${s("textTertiary")};
  display: inline-block;
  transform: ${(p) => (p.$expanded ? "rotate(180deg)" : "rotate(0deg)")};
  transition: transform 0.15s ease;
  flex-shrink: 0;
`;

const SectionBody = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border-top: 1px solid ${s("divider")};
  background: ${s("background")};
`;

const SummaryText = styled.div`
  font-size: 13px;
  color: ${s("textSecondary")};
  line-height: 1.5;
`;

const ImpactList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const ImpactItem = styled.div<{ $bg: string }>`
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border-radius: 6px;
  background: ${(p) => p.$bg};
  border: 1px solid ${s("divider")};
`;

const ImpactHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
`;

const ImpactTypePill = styled.span`
  font-size: 11px;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 10px;
  background: ${s("backgroundSecondary")};
  color: ${s("textSecondary")};
  flex-shrink: 0;
`;

const SeverityBadge = styled.span<{ $color: string }>`
  font-size: 11px;
  font-weight: 700;
  color: ${(p) => p.$color};
  flex-shrink: 0;
`;

const AffectedDoc = styled.span`
  font-size: 12px;
  font-weight: 600;
  color: ${s("text")};
  flex: 1;
  min-width: 0;
`;

const AffectedElement = styled.span`
  font-weight: 400;
  color: ${s("textSecondary")};
`;

const ImpactDescription = styled.div`
  font-size: 13px;
  color: ${s("textSecondary")};
  line-height: 1.5;
`;

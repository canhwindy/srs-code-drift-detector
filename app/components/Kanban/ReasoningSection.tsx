import * as React from "react";
import styled from "styled-components";
import { s } from "@shared/styles";

interface ReasoningSectionProps {
  reasoning?: string | null;
}

export default function ReasoningSection({ reasoning }: ReasoningSectionProps) {
  const [isExpanded, setIsExpanded] = React.useState(false);
  const toggle = () => setIsExpanded((prev) => !prev);

  const hasContent = !!reasoning && reasoning.trim().length > 0;

  return (
    <Wrapper>
      <HeaderRow onClick={toggle}>
        <Chevron $expanded={isExpanded}>▶</Chevron>
        <HeaderLabel>Lý do</HeaderLabel>
      </HeaderRow>

      <ContentWrapper $expanded={isExpanded}>
        {hasContent ? (
          <ContentText>{reasoning}</ContentText>
        ) : (
          <PlaceholderText>Không có reasoning</PlaceholderText>
        )}
        {!isExpanded && <FadeOverlay />}
      </ContentWrapper>
    </Wrapper>
  );
}

const Wrapper = styled.div`
  border: 1px solid ${s("divider")};
  border-radius: 6px;
  overflow: hidden;
`;

const HeaderRow = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  cursor: pointer;
  user-select: none;
  background: ${s("backgroundSecondary")};

  &:hover {
    background: ${s("listItemHoverBackground")};
  }
`;

const Chevron = styled.span<{ $expanded: boolean }>`
  font-size: 9px;
  color: ${s("textTertiary")};
  display: inline-block;
  transform: ${(p) => (p.$expanded ? "rotate(90deg)" : "rotate(0deg)")};
  transition: transform 0.2s ease;
  line-height: 1;
`;

const HeaderLabel = styled.span`
  font-size: 12px;
  font-weight: 600;
  color: ${s("textTertiary")};
  text-transform: uppercase;
  letter-spacing: 0.04em;
`;

const ContentWrapper = styled.div<{ $expanded: boolean }>`
  position: relative;
  overflow: ${(p) => (p.$expanded ? "auto" : "hidden")};
  max-height: ${(p) => (p.$expanded ? "500px" : "3.2em")};
  transition: max-height 0.25s ease;
  border-top: 1px solid ${s("divider")};

  /* Scrollbar styling */
  scrollbar-width: thin;
  scrollbar-color: ${s("divider")} transparent;

  &::-webkit-scrollbar {
    width: 4px;
  }
  &::-webkit-scrollbar-track {
    background: transparent;
  }
  &::-webkit-scrollbar-thumb {
    background: ${s("divider")};
    border-radius: 2px;
  }
`;

const ContentText = styled.div`
  font-size: 13px;
  color: ${s("textSecondary")};
  line-height: 1.6;
  padding: 8px 12px;
  white-space: pre-wrap;
  word-break: break-word;
`;

const PlaceholderText = styled.div`
  font-size: 13px;
  color: ${s("textTertiary")};
  line-height: 1.6;
  padding: 8px 12px;
  font-style: italic;
`;

const FadeOverlay = styled.div`
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 1.6em;
  background: linear-gradient(to bottom, transparent, ${s("background")});
  pointer-events: none;
`;

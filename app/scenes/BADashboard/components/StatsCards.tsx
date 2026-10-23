import React, { useState, useEffect } from "react";
import { observer } from "mobx-react";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import useStores from "~/hooks/useStores";
import Logger from "~/utils/Logger";

const StatsCards: React.FC = () => {
  const { t } = useTranslation();
  const { baDashboard } = useStores();
  const [counts, setCounts] = useState<{
    numberOfApprovedGapFindings: number;
    numberOfPendingGapFindings: number;
    numberOfRejectedGapFindings: number;
  } | null>(null);

  useEffect(() => {
    const fetchCounts = async () => {
      try {
        const data = await baDashboard.getNumberOfGapFindingsByStatus();
        setCounts(data);
      } catch (error) {
        Logger.error("Failed to fetch gap finding counts", error as Error);
      }
    };
    fetchCounts();
  }, [baDashboard, baDashboard.refreshKey]);

  return (
    <CardsContainer>
      <StatCard $accentColor="#10b981">
        <CardHeader>
          <CardIcon $bg="rgba(16, 185, 129, 0.1)" $color="#10b981">
            <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
          </CardIcon>
          <CardLabel>{t("APPROVED PROPOSALS")}</CardLabel>
        </CardHeader>
        <CardBody>
          <StatRow>
            <StatValue $color="#10b981">{counts?.numberOfApprovedGapFindings ?? "–"}</StatValue>
            <TrendBadge $positive>
              {t("Approved")}
            </TrendBadge>
          </StatRow>
        </CardBody>
      </StatCard>

      <StatCard $accentColor="#f59e0b">
        <CardHeader>
          <CardIcon $bg="rgba(245, 158, 11, 0.1)" $color="#f59e0b">
            <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
            </svg>
          </CardIcon>
          <CardLabel>{t("PENDING PROPOSALS")}</CardLabel>
        </CardHeader>
        <CardBody>
          <StatRow>
            <StatValue $color="#f59e0b">{counts?.numberOfPendingGapFindings ?? "–"}</StatValue>
            <WarningBadge>
              {t("Awaiting review")}
            </WarningBadge>
          </StatRow>
        </CardBody>
      </StatCard>

      <StatCard $accentColor="#ef4444">
        <CardHeader>
          <CardIcon $bg="rgba(239, 68, 68, 0.1)" $color="#ef4444">
            <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </CardIcon>
          <CardLabel>{t("REJECTED PROPOSALS")}</CardLabel>
        </CardHeader>
        <CardBody>
          <StatRow>
            <StatValue $color="#ef4444">{counts?.numberOfRejectedGapFindings ?? "–"}</StatValue>
            <TrendBadge>
              {t("Rejected")}
            </TrendBadge>
          </StatRow>
        </CardBody>
      </StatCard>
    </CardsContainer>
  );
};

const CardsContainer = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 24px;

  @media (max-width: 1420px) {
    gap: 20px;
  }

  @media (max-width: 1345px) {
    gap: 16px;
  }

  @media (max-width: 1280px) {
    gap: 14px;
  }

  @media (max-width: 1200px) {
    gap: 12px;
  }

  @media (max-width: 1100px) {
    gap: 10px;
  }

  @media (max-width: 1024px) {
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
  }

  @media (max-width: 768px) {
    grid-template-columns: repeat(2, 1fr);
    gap: 12px;
  }

  @media (max-width: 480px) {
    grid-template-columns: 1fr;
    gap: 12px;
  }
`;

const StatCard = styled.div<{ $accentColor?: string }>`
  background: ${(props) => props.theme.background};
  border-radius: 12px;
  padding: 20px 24px;
  box-shadow: ${(props) => props.theme.isDark ? 'none' : '0 1px 3px rgba(0, 0, 0, 0.05), 0 1px 2px rgba(0, 0, 0, 0.03)'};
  border: 1px solid ${(props) => props.theme.divider};
  border-top: 3px solid ${(props) => props.$accentColor || props.theme.divider};
  transition: all 0.2s ease;
  min-width: 0;

  &:hover {
    box-shadow: ${(props) => props.theme.isDark ? '0 4px 12px rgba(0, 0, 0, 0.3)' : '0 4px 12px rgba(0, 0, 0, 0.08)'};
    transform: translateY(-2px);
  }

  @media (max-width: 1420px) {
    padding: 18px 20px;
  }

  @media (max-width: 1345px) {
    padding: 16px 16px;
  }

  @media (max-width: 1280px) {
    padding: 14px 14px;
  }

  @media (max-width: 1200px) {
    padding: 12px 12px;
  }

  @media (max-width: 1100px) {
    padding: 10px 10px;
  }

  @media (max-width: 1024px) {
    padding: 10px 8px;
  }

  @media (max-width: 768px) {
    padding: 16px;
    border-radius: 10px;
  }
`;

const CardHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;

  @media (max-width: 1345px) {
    gap: 8px;
    margin-bottom: 12px;
  }

  @media (max-width: 1280px) {
    gap: 6px;
    margin-bottom: 10px;
  }

  @media (max-width: 1100px) {
    gap: 5px;
    margin-bottom: 8px;
  }
`;

const CardIcon = styled.div<{ $bg: string; $color: string }>`
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background-color: ${(props) => props.$bg};
  color: ${(props) => props.$color};
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;

  @media (max-width: 1345px) {
    width: 28px;
    height: 28px;
  }

  @media (max-width: 1280px) {
    width: 26px;
    height: 26px;
  }

  @media (max-width: 1100px) {
    width: 24px;
    height: 24px;
  }
`;

const CardLabel = styled.span`
  font-size: 11px;
  font-weight: 600;
  color: ${(props) => props.theme.textTertiary};
  letter-spacing: 0.5px;
  text-transform: uppercase;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;

  @media (max-width: 1345px) {
    font-size: 10px;
  }

  @media (max-width: 1280px) {
    font-size: 9px;
  }

  @media (max-width: 1100px) {
    font-size: 8px;
  }

  @media (max-width: 1024px) {
    font-size: 8px;
  }
`;

const CardBody = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;

  @media (max-width: 1345px) {
    gap: 10px;
  }

  @media (max-width: 1280px) {
    gap: 8px;
  }

  @media (max-width: 1100px) {
    gap: 6px;
  }
`;

const StatRow = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;

  @media (max-width: 1345px) {
    gap: 10px;
  }

  @media (max-width: 1280px) {
    gap: 8px;
  }

  @media (max-width: 1100px) {
    gap: 4px;
  }

  @media (max-width: 1024px) {
    gap: 4px;
  }
`;

const StatValue = styled.span<{ $color?: string }>`
  font-size: 36px;
  font-weight: 700;
  color: ${(props) => props.$color || props.theme.text};
  line-height: 1;

  @media (max-width: 1420px) {
    font-size: 32px;
  }

  @media (max-width: 1345px) {
    font-size: 28px;
  }

  @media (max-width: 1280px) {
    font-size: 26px;
  }

  @media (max-width: 1200px) {
    font-size: 24px;
  }

  @media (max-width: 1100px) {
    font-size: 22px;
  }

  @media (max-width: 1024px) {
    font-size: 20px;
  }

  @media (max-width: 768px) {
    font-size: 28px;
  }
`;

const TrendBadge = styled.span<{ $positive?: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  background-color: ${(props) => (props.$positive ? "rgba(16, 185, 129, 0.1)" : "rgba(239, 68, 68, 0.1)")};
  color: ${(props) => (props.$positive ? "#10b981" : "#ef4444")};
  border-radius: 20px;
  font-size: 13px;
  font-weight: 600;

  @media (max-width: 1280px) {
    padding: 3px 8px;
    font-size: 12px;
  }

  @media (max-width: 1100px) {
    padding: 2px 6px;
    font-size: 11px;
  }
`;

const WarningBadge = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  background-color: rgba(245, 158, 11, 0.1);
  color: #f59e0b;
  border-radius: 20px;
  font-size: 12px;
  font-weight: 500;

  @media (max-width: 1280px) {
    padding: 3px 8px;
    font-size: 11px;
    gap: 4px;
  }

  @media (max-width: 1100px) {
    padding: 2px 6px;
    font-size: 10px;
  }
`;

export default observer(StatsCards);

import React from "react";
import { useTranslation } from "react-i18next";
import styled from "styled-components";

const SyncCoverage: React.FC = () => {
  const { t } = useTranslation();
  const coveragePercent = 78;
  const circumference = 2 * Math.PI * 54;
  const strokeDashoffset = circumference - (coveragePercent / 100) * circumference;

  return (
    <Container>
      <Header>
        <Title>{t("Sync Coverage")}</Title>
      </Header>

      <ChartContainer>
        <CircularProgress>
          <svg width="140" height="140" viewBox="0 0 140 140">
            <circle
              cx="70"
              cy="70"
              r="54"
              fill="none"
              stroke="#e5e7eb"
              strokeWidth="12"
            />
            <circle
              cx="70"
              cy="70"
              r="54"
              fill="none"
              stroke="#4F7CFF"
              strokeWidth="12"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              transform="rotate(-90 70 70)"
              style={{ transition: "stroke-dashoffset 0.5s ease" }}
            />
          </svg>
          <PercentageText>
            <PercentValue>{coveragePercent}%</PercentValue>
          </PercentageText>
        </CircularProgress>
        <TargetText>{t("TARGET {{percent}}%", { percent: 95 })}</TargetText>
      </ChartContainer>

      <StatsRow>
        <StatItem>
          <StatLabel>{t("COVERED")}</StatLabel>
          <StatValue $color="#10b981">1,240 REQs</StatValue>
        </StatItem>
        <Divider />
        <StatItem>
          <StatLabel>{t("GAP")}</StatLabel>
          <StatValue $color="#6b7280">312 REQs</StatValue>
        </StatItem>
      </StatsRow>
    </Container>
  );
};

const Container = styled.div`
  background: white;
  border-radius: 12px;
  padding: 24px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05), 0 1px 2px rgba(0, 0, 0, 0.03);
  border: 1px solid #e5e7eb;
  min-width: 0;

  @media (max-width: 1200px) {
    flex: 1;
    padding: 20px;
  }

  @media (max-width: 1024px) {
    padding: 16px;
  }

  @media (max-width: 768px) {
    padding: 16px;
    border-radius: 10px;
  }
`;

const Header = styled.div`
  margin-bottom: 20px;
`;

const Title = styled.h2`
  font-size: 18px;
  font-weight: 600;
  color: #1a1d29;
  margin: 0;
`;

const ChartContainer = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  margin-bottom: 24px;

  @media (max-width: 768px) {
    margin-bottom: 20px;
  }
`;

const CircularProgress = styled.div`
  position: relative;
  width: 140px;
  height: 140px;

  @media (max-width: 1024px) {
    width: 120px;
    height: 120px;

    svg {
      width: 120px;
      height: 120px;
    }
  }
`;

const PercentageText = styled.div`
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  text-align: center;
`;

const PercentValue = styled.span`
  font-size: 32px;
  font-weight: 700;
  color: #1a1d29;

  @media (max-width: 1024px) {
    font-size: 28px;
  }
`;

const TargetText = styled.span`
  font-size: 11px;
  font-weight: 600;
  color: #9ca3af;
  letter-spacing: 0.5px;
`;

const StatsRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 32px;

  @media (max-width: 1024px) {
    gap: 20px;
  }

  @media (max-width: 480px) {
    gap: 16px;
  }
`;

const StatItem = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
`;

const StatLabel = styled.span`
  font-size: 11px;
  font-weight: 600;
  color: #9ca3af;
  letter-spacing: 0.5px;
`;

const StatValue = styled.span<{ $color?: string }>`
  font-size: 16px;
  font-weight: 700;
  color: ${(props) => props.$color || "#1a1d29"};
`;

const Divider = styled.div`
  width: 1px;
  height: 40px;
  background-color: #e5e7eb;
`;

export default SyncCoverage;

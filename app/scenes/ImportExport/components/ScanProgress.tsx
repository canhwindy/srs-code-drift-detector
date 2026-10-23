import { observer } from "mobx-react";
import { useTranslation } from "react-i18next";
import { useHistory } from "react-router-dom";
import styled, { keyframes } from "styled-components";
import { s } from "@shared/styles";
import Button from "~/components/Button";
import Flex from "~/components/Flex";
import useStores from "~/hooks/useStores";
import { collectionPath } from "~/utils/routeHelpers";

const ScanProgress = observer(() => {
  const { importSplit, scanNotices } = useStores();
  const { t } = useTranslation();
  const history = useHistory();

  const handleViewCollection = () => {
    if (importSplit.createdCollection) {
      history.push(collectionPath(importSplit.createdCollection));
    }
  };

  const handleReset = () => {
    importSplit.reset();
  };

  const isScanComplete = importSplit.isScanComplete;
  const progress = Math.min(scanNotices.scanProgress, 100);

  if (!isScanComplete) {
    return (
      <ProgressContainer role="region" aria-label={t("Scan progress region")}>
        <Card>
          <TopRow>
            <SpinnerIcon />
            <div>
              <ProgressTitle>{t("Scanning documents...")}</ProgressTitle>
              <CurrentItemText aria-live="polite">
                {scanNotices.currentDocumentName || scanNotices.scanningCollectionName}
              </CurrentItemText>
            </div>
          </TopRow>

          <ProgressBarContainer>
            <ProgressBar
              $progress={progress}
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.floor(progress)}
              aria-label={t("Scan progress")}
            />
            <ProgressText aria-hidden>
              {Math.floor(progress)}%
            </ProgressText>
          </ProgressBarContainer>

          <StatsRow>
            <StatItem>
              <StatLabel>{t("Processed")}</StatLabel>
              <StatValue>{scanNotices.processedDocuments}</StatValue>
            </StatItem>
            <StatItem>
              <StatLabel>{t("Total documents")}</StatLabel>
              <StatValue>{scanNotices.totalDocuments}</StatValue>
            </StatItem>
            {scanNotices.convertedDocuments > 0 && (
              <StatItem>
                <StatLabel>{t("Converted")}</StatLabel>
                <StatValue>{scanNotices.convertedDocuments}</StatValue>
              </StatItem>
            )}
          </StatsRow>
        </Card>
      </ProgressContainer>
    );
  }

  if (importSplit.scanError) {
    return (
      <SuccessContainer role="region" aria-live="polite">
        <Card>
          <ErrorTitle>{t("Scan Failed")}</ErrorTitle>
          <ErrorMessage>{importSplit.scanError}</ErrorMessage>

          <ResultsBox>
            <ResultItem>
              <ResultText>
                {importSplit.createdCount} {t("documents imported")}
              </ResultText>
            </ResultItem>
          </ResultsBox>

          <ActionButtons>
            <Button neutral onClick={handleReset}>
              {t("Import Another File")}
            </Button>
            {importSplit.createdCollection && (
              <Button onClick={handleViewCollection}>
                {t("Go to Collection")}
              </Button>
            )}
          </ActionButtons>
        </Card>
      </SuccessContainer>
    );
  }

  return (
    <SuccessContainer role="region" aria-live="polite">
      <Card>
        <SuccessTitle>{t("Import & Scan Completed!")}</SuccessTitle>
        <SuccessMessage>
          {importSplit.createdCount} {t("documents imported to")}{" "}
          {importSplit.collectionName || importSplit.splitData?.fileName}
        </SuccessMessage>

        <ResultsBox>
          <ResultItem>
            <ResultText>{importSplit.createdCount} {t("documents created")}</ResultText>
          </ResultItem>
          <ResultItem>
            <ResultText>{importSplit.splitData?.statistics.maxDepth} {t("levels deep")}</ResultText>
          </ResultItem>
          {scanNotices.convertedDocuments > 0 && (
            <ResultItem>
              <ResultText>{scanNotices.convertedDocuments} {t("documents converted")}</ResultText>
            </ResultItem>
          )}
        </ResultsBox>

        <ActionButtons>
          <Button neutral onClick={handleReset}>
            {t("Import Another File")}
          </Button>
          <Button onClick={handleViewCollection}>
            {t("Go to Collection")}
          </Button>
        </ActionButtons>
      </Card>
    </SuccessContainer>
  );
});

const spin = keyframes`
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
`;

const SpinnerIcon = styled.div`
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border: 3px solid transparent;
  border-top-color: #10B981;
  border-right-color: #10B981;
  border-radius: 50%;
  animation: ${spin} 0.8s linear infinite;
`;

const ProgressContainer = styled(Flex)`
  flex-direction: column;
  align-items: stretch;
  justify-content: flex-start;
  padding: 16px 12px;
  min-height: 220px;
  width: 100%;
`;

const Card = styled.div`
  width: 100%;
  max-width: 900px;
  background: ${s("background")};
  border: 1px solid ${s("divider")};
  box-shadow: ${(props) =>
    props.theme.isDark
      ? "0 1px 3px rgba(0, 0, 0, 0.2)"
      : "0 1px 3px rgba(0, 0, 0, 0.05)"};
  border-radius: 12px;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 20px;
`;

const TopRow = styled.div`
  display: flex;
  align-items: center;
  gap: 16px;
`;

const ProgressTitle = styled.h3`
  font-size: 20px;
  font-weight: 700;
  color: ${s("text")};
  margin: 0 0 8px 0;
`;

const CurrentItemText = styled.div`
  font-size: 14px;
  color: ${s("textSecondary")};
`;

const ProgressBarContainer = styled.div`
  display: flex;
  align-items: center;
  gap: 16px;
  width: 100%;
`;

type ProgressBarProps = {
  $progress: number;
};

const ProgressBar = styled.div<ProgressBarProps>`
  flex: 1;
  height: 12px;
  background: ${s("progressBarBackground")};
  border-radius: 999px;
  overflow: hidden;
  position: relative;

  &::after {
    content: "";
    display: block;
    height: 100%;
    width: ${(props) => props.$progress}%;
    background: linear-gradient(90deg, #10B981 0%, #059669 100%);
    transition: width 300ms ease-out;
    border-radius: 999px;
  }
`;

const ProgressText = styled.div`
  min-width: 50px;
  font-size: 16px;
  font-weight: 700;
  color: ${s("text")};
  text-align: right;
`;

const StatsRow = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
  gap: 16px;
  padding-top: 16px;
  border-top: 1px solid ${s("divider")};
`;

const StatItem = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const StatLabel = styled.div`
  font-size: 12px;
  color: ${s("textSecondary")};
  text-transform: uppercase;
  letter-spacing: 0.5px;
`;

const StatValue = styled.div`
  font-size: 24px;
  font-weight: 700;
  color: #10B981;
`;

const SuccessContainer = styled(Flex)`
  flex-direction: column;
  align-items: stretch;
  justify-content: flex-start;
  padding: 16px 12px;
  width: 100%;
`;

const SuccessTitle = styled.h3`
  font-size: 24px;
  font-weight: 700;
  color: ${s("text")};
  margin: 0;
  text-align: center;
`;

const SuccessMessage = styled.p`
  font-size: 16px;
  color: ${s("textSecondary")};
  margin: 0;
  text-align: center;
`;

const ErrorTitle = styled.h3`
  font-size: 24px;
  font-weight: 700;
  color: #EF4444;
  margin: 0;
  text-align: center;
`;

const ErrorMessage = styled.p`
  font-size: 14px;
  color: ${s("textSecondary")};
  margin: 0;
  text-align: center;
  padding: 12px;
  background: ${(props) =>
    props.theme.isDark ? "rgba(239, 68, 68, 0.1)" : "#FEF2F2"};
  border: 1px solid ${(props) =>
    props.theme.isDark ? "rgba(239, 68, 68, 0.3)" : "#FCA5A5"};
  border-radius: 8px;
`;

const ResultsBox = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 20px;
  background: ${s("backgroundSecondary")};
  border-radius: 8px;
  margin: 16px 0;
`;

const ResultItem = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  background: ${s("background")};
  border-radius: 6px;
  border: 1px solid ${(props) => props.theme.divider};
`;

const ResultText = styled.span`
  font-size: 14px;
  font-weight: 500;
  color: ${s("text")};
`;

const ActionButtons = styled.div`
  display: flex;
  gap: 12px;
  justify-content: center;
`;

export default ScanProgress;

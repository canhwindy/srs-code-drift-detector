import { observer } from "mobx-react";
import { useTranslation } from "react-i18next";
import { useHistory } from "react-router-dom";
import styled from "styled-components";
import { s } from "@shared/styles";
import Button from "~/components/Button";
import Flex from "~/components/Flex";
import useStores from "~/hooks/useStores";
import { collectionPath } from "~/utils/routeHelpers";

const ImportProgress = observer(() => {
  const { importSplit } = useStores();
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

  if (!importSplit.isImportComplete) {
    return (
      <ProgressContainer role="region" aria-label={t("Import progress region")}>
        <Card>
          <TopRow>
            <div>
              <ProgressTitle>{t("Importing Documents...")}</ProgressTitle>
              <CurrentItemText aria-live="polite">
                {importSplit.currentItem}
              </CurrentItemText>
            </div>
          </TopRow>

          <ProgressBarContainer>
            <ProgressBar
              $progress={Math.min(importSplit.importProgress, 100)}
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.floor(Math.min(importSplit.importProgress, 100))}
              aria-label={t("Import progress")}
            />
            <ProgressText aria-hidden>
              {Math.floor(Math.min(importSplit.importProgress, 100))}%
            </ProgressText>
          </ProgressBarContainer>

          <StatsRow>
            <StatItem>
              <StatLabel>{t("Documents created")}</StatLabel>
              <StatValue>{importSplit.createdCount}</StatValue>
            </StatItem>
            <StatItem>
              <StatLabel>{t("Total to import")}</StatLabel>
              <StatValue>{importSplit.totalToImport}</StatValue>
            </StatItem>
          </StatsRow>
        </Card>
      </ProgressContainer>
    );
  }

  if (importSplit.importError) {
    return (
      <SuccessContainer role="region" aria-live="polite">
        <Card>
          <ErrorTitle>{t("Import Failed")}</ErrorTitle>
          <ErrorMessage>{importSplit.importError}</ErrorMessage>

          <ResultsBox>
            <ResultItem $error>
              <ResultIcon>⚠️</ResultIcon>
              <ResultText>{t("Some documents may have been created before the error occurred")}</ResultText>
            </ResultItem>
            {importSplit.createdCount > 0 && (
              <ResultItem>
                <ResultIcon>✓</ResultIcon>
                <ResultText>{importSplit.createdCount} {t("documents created")}</ResultText>
              </ResultItem>
            )}
          </ResultsBox>

          <ActionButtons>
            <Button neutral onClick={handleReset}>
              {t("Try Again")}
            </Button>
            {importSplit.createdCollection && (
              <Button onClick={handleViewCollection}>
                {t("View Created Documents")}
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
        <SuccessTitle>{t("Import Completed Successfully!")}</SuccessTitle>
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

// Styled Components
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
    background: linear-gradient(90deg, #3B82F6 0%, #2563EB 100%);
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
  grid-template-columns: 1fr 1fr;
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
  color: #3B82F6;
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

const ResultItem = styled.div<{ $error?: boolean }>`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  background: ${s("background")};
  border-radius: 6px;
  border: 1px solid ${props =>
    props.$error
      ? props.theme.isDark ? "rgba(239, 68, 68, 0.3)" : "#FCA5A5"
      : props.theme.divider};
`;

const ResultIcon = styled.span`
  font-size: 20px;
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

export default ImportProgress;

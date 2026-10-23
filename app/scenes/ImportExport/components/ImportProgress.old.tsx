import { observer } from "mobx-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import { s } from "@shared/styles";
import Button from "~/components/Button";
import Flex from "~/components/Flex";
import Text from "~/components/Text";

const ImportProgress = observer(() => {
  const { t } = useTranslation();
  const [progress, setProgress] = useState(0);
  const [isComplete, setIsComplete] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) {
          setIsComplete(true);
          return 100;
        }
        return prev + Math.random() * 20;
      });
    }, 500);

    return () => clearInterval(interval);
  }, []);

  if (!isComplete) {
    return (
      <ProgressContainer role="region" aria-label={t("Import progress region")}>
        <Card>
          <TopRow>
            <div>
              <ProgressTitle>{t("Importing Documents...")}</ProgressTitle>
              <CurrentItemText aria-live="polite">
                {t("Currently importing")}: UC-12: Quiz Management
              </CurrentItemText>
            </div>
          </TopRow>

          <ProgressBarContainer>
            <ProgressBar
              $progress={Math.min(progress, 100)}
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.floor(Math.min(progress, 100))}
              aria-label={t("Import progress")}
            />
            <ProgressText aria-hidden>
              {Math.floor(Math.min(progress, 100))}%
            </ProgressText>
          </ProgressBarContainer>
        </Card>
      </ProgressContainer>
    );
  }

  return (
    <SuccessContainer role="region" aria-live="polite">
      <Card>
        <SuccessTitle>{t("Import Completed Successfully!")}</SuccessTitle>
        <SuccessMessage>
          14 {t("documents imported to")} /SRS/Use Cases
        </SuccessMessage>

        <ResultsBox>
          <ResultItem>
            <ResultText>12 {t("documents created")}</ResultText>
          </ResultItem>
          <ResultItem>
            <ResultText>2 {t("documents replaced")}</ResultText>
          </ResultItem>
          <ResultItem>
            <ResultText>1 {t("document skipped (error)")}</ResultText>
          </ResultItem>
        </ResultsBox>

        <ActionButtons>
          <Button neutral>{t("View Import Log")}</Button>
          <Button>{t("Go to Documents")}</Button>
        </ActionButtons>
      </Card>
    </SuccessContainer>
  );
});

const ProgressContainer = styled(Flex)`
  flex-direction: column;
  align-items: stretch;
  justify-content: flex-start;
  padding: 16px 12px; /* reduce outer margins */
  min-height: 220px;
  width: 100%;
`;

const Card = styled.div`
  width: 100%;
  max-width: 900px;
  background: transparent; /* remove boxed look */
  box-shadow: none;
  border-radius: 6px;
  padding: 12px 16px; /* tighter spacing to use screen space */
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const TopRow = styled.div`
  display: flex;
  align-items: center;
  gap: 16px;
`;

/* simplified — icons removed from main header to reduce visual noise */

const ProgressTitle = styled.h3`
  font-size: 18px;
  font-weight: 600;
  color: ${s("text")};
  margin: 0;
`;

const ProgressBarContainer = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  max-width: 560px;
`;

type ProgressBarProps = {
  $progress: number;
};

const ProgressBar = styled.div<ProgressBarProps>`
  flex: 1;
  height: 10px;
  background: ${s("divider")};
  border-radius: 999px;
  overflow: hidden;
  position: relative;

  &::after {
    content: "";
    display: block;
    height: 100%;
    width: ${(props) => props.$progress}%;
    background: ${s("accent")};
    box-shadow: 0 2px 8px rgba(0,0,0,0.06) inset;
    transition: width 220ms cubic-bezier(0.2, 0.8, 0.2, 1);
    border-radius: 999px;
  }
`;

const ProgressText = styled(Text)`
  font-size: 13px;
  font-weight: 600;
  color: ${s("textSecondary")};
  white-space: nowrap;
`;

const CurrentItemText = styled(Text)`
  font-size: 13px;
  color: ${s("textSecondary")};
  margin-top: 4px;
`;

const SuccessContainer = styled(Flex)`
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px;
  min-height: 360px;
  width: 100%;
`;

/* success icon removed — rely on title and subtle affordances */

const SuccessTitle = styled.h2`
  font-size: 20px;
  font-weight: 700;
  color: ${s("text")};
  margin: 0;
  text-align: center;
`;

const SuccessMessage = styled(Text)`
  font-size: 14px;
  color: ${s("textSecondary")};
  text-align: center;
`;

const ResultsBox = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 0; /* remove boxed padding */
  background: transparent;
  border: none;
  width: 100%;
  max-width: 900px;
`;

const ResultItem = styled(Flex)`
  align-items: center;
  gap: 12px;
  font-size: 14px;
  color: ${s("text")};
`;

const ResultText = styled.div`
  flex: 1;
`;

const ActionButtons = styled(Flex)`
  gap: 12px;
  margin-top: 8px;
  justify-content: flex-start; /* keep primary actions prominent and left-aligned */
`;

export default ImportProgress;

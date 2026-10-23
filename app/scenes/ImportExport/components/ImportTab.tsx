import { observer } from "mobx-react";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import { s } from "@shared/styles";
import useStores from "~/hooks/useStores";
import { BootstrapIcon } from "./BootstrapIcon";
import UploadZone from "./UploadZone";
import PreviewMapping from "./PreviewMapping";
import ImportProgress from "./ImportProgress";
import ScanProgress from "./ScanProgress";

const ImportTab = observer(() => {
  const { t } = useTranslation();
  const { importSplit } = useStores();
  const step = importSplit.step;

  const handleNextStep = () => {
    if (step === "upload") {
      importSplit.setStep("preview");
    } else if (step === "preview") {
      importSplit.setStep("progress");
      importSplit.startImport();
    }
  };

  const handleBack = () => {
    if (step === "preview") {
      importSplit.setStep("upload");
    }
  };

  return (
    <Container>
      <StepIndicatorContainer>
        <Step $active={step === "upload"} $completed={step !== "upload"}>
          <StepCircle $active={step === "upload"} $completed={step !== "upload"}>
            {step !== "upload" ? <BootstrapIcon name="check" size={16} /> : "1"}
          </StepCircle>
          <StepLabel>{t("Upload")}</StepLabel>
        </Step>

        <StepConnector $completed={step === "preview" || step === "progress" || step === "scanning"} />

        <Step $active={step === "preview"} $completed={step === "progress" || step === "scanning"}>
          <StepCircle $active={step === "preview"} $completed={step === "progress" || step === "scanning"}>
            {step === "progress" || step === "scanning" ? <BootstrapIcon name="check" size={16} /> : "2"}
          </StepCircle>
          <StepLabel>{t("Preview")}</StepLabel>
        </Step>

        <StepConnector $completed={step === "progress" || step === "scanning"} />

        <Step $active={step === "progress"} $completed={step === "scanning"}>
          <StepCircle $active={step === "progress"} $completed={step === "scanning"}>
            {step === "scanning" ? <BootstrapIcon name="check" size={16} /> : "3"}
          </StepCircle>
          <StepLabel>{t("Import")}</StepLabel>
        </Step>

        <StepConnector $completed={step === "scanning"} />

        <Step $active={step === "scanning"} $completed={false}>
          <StepCircle $active={step === "scanning"} $completed={false}>
            4
          </StepCircle>
          <StepLabel>{t("Scan")}</StepLabel>
        </Step>
      </StepIndicatorContainer>

      <ContentSection>
        {step === "upload" && <UploadZone />}
        {step === "preview" && importSplit.uploadedFile && importSplit.splitData && (
          <PreviewMapping
            file={importSplit.uploadedFile}
            splitData={importSplit.splitData}
            onCollectionNameChange={importSplit.setCollectionName}
            onSelectedNodesChange={importSplit.setSelectedNodes}
          />
        )}
        {step === "progress" && <ImportProgress />}
        {step === "scanning" && <ScanProgress />}
      </ContentSection>

      <ActionBar>
        <LeftActions>
          {step === "preview" && (
            <BackButton onClick={handleBack}>
              <BootstrapIcon name="arrow-left" size={16} />
              {t("Back")}
            </BackButton>
          )}
        </LeftActions>

        <RightActions>
          {step !== "progress" && step !== "scanning" && (
            <CancelButton onClick={() => importSplit.reset()}>
              {t("Cancel")}
            </CancelButton>
          )}
          {step !== "progress" && step !== "scanning" && (
            <NextButton
              onClick={handleNextStep}
              disabled={step === "upload" && !importSplit.canProceedToPreview}
            >
              {step === "upload" ? t("Next: Preview") : t("Import Selected")}
              <ArrowIcon>
                <BootstrapIcon name="arrow-right" size={16} />
              </ArrowIcon>
            </NextButton>
          )}
        </RightActions>
      </ActionBar>
    </Container>
  );
});

const Container = styled.div`
  display: flex;
  flex-direction: column;
  gap: 32px;
  padding-bottom: 80px;

  @media (max-height: 800px) {
    gap: 20px;
  }
`;

const StepIndicatorContainer = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 24px;
  background: ${s("background")};
  border: 1px solid ${s("divider")};
  border-radius: 12px;
  box-shadow: ${(props) =>
    props.theme.isDark
      ? "0 1px 3px rgba(0, 0, 0, 0.2)"
      : "0 1px 3px rgba(0, 0, 0, 0.05), 0 2px 8px rgba(0, 0, 0, 0.03)"};

  @media (max-height: 800px) {
    padding: 16px;
    gap: 12px;
  }
`;

type StepProps = {
  $active: boolean;
  $completed?: boolean;
};

const Step = styled.div<StepProps>`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  opacity: ${(props) => (props.$active || props.$completed ? 1 : 0.5)};
  transition: opacity 250ms ease-in-out;
`;

const StepCircle = styled.div<StepProps>`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: ${(props) => {
    if (props.$completed) {
      return props.theme.isDark
        ? "rgba(16, 185, 129, 0.15)"
        : "linear-gradient(135deg, #ECFDF5 0%, #F0FDF4 100%)";
    }
    if (props.$active) {
      return props.theme.isDark
        ? "rgba(59, 130, 246, 0.15)"
        : "linear-gradient(135deg, #EFF6FF 0%, #DBEAFE 100%)";
    }
    return props.theme.isDark ? props.theme.backgroundSecondary : "#F3F4F6";
  }};
  border: 2px solid ${(props) => {
    if (props.$completed) {
      return "#10B981";
    }
    if (props.$active) {
      return "#3B82F6";
    }
    return props.theme.divider;
  }};
  color: ${(props) => {
    if (props.$completed) {
      return "#10B981";
    }
    if (props.$active) {
      return "#3B82F6";
    }
    return props.theme.textTertiary;
  }};
  font-weight: 700;
  font-size: 16px;
  box-shadow: ${(props) => {
    if (props.$active) {
      return "0 4px 12px rgba(59, 130, 246, 0.2)";
    }
    return "none";
  }};
  transition: all 250ms cubic-bezier(0.4, 0, 0.2, 1);
`;

const StepLabel = styled.div`
  font-size: 13px;
  font-weight: 600;
  color: ${s("textTertiary")};
  text-align: center;
  min-width: 60px;
`;

type StepConnectorProps = {
  $completed?: boolean;
};

const StepConnector = styled.div<StepConnectorProps>`
  width: 56px;
  height: 2px;
  background: ${(props) => (props.$completed ? "#10B981" : props.theme.divider)};
  transition: background 250ms ease-in-out;
  position: relative;

  &::before {
    content: "";
    position: absolute;
    inset: 0;
    background: linear-gradient(90deg, #10B981 0%, #10B981 100%);
    border-radius: 2px;
  }
`;

const ContentSection = styled.div`
  min-height: 400px;
  animation: fadeIn 300ms cubic-bezier(0.34, 1.56, 0.64, 1);

  @keyframes fadeIn {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @media (max-height: 800px) {
    min-height: 200px;
  }
`;

const ActionBar = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 20px 24px;
  background: ${s("background")};
  border: 1px solid ${s("divider")};
  border-radius: 12px;
  box-shadow: ${(props) =>
    props.theme.isDark
      ? "0 1px 3px rgba(0, 0, 0, 0.2)"
      : "0 1px 3px rgba(0, 0, 0, 0.05), 0 2px 8px rgba(0, 0, 0, 0.03)"};
  position: sticky;
  bottom: 0;
  z-index: 1;
`;

const LeftActions = styled.div`
  display: flex;
  gap: 8px;
`;

const RightActions = styled.div`
  display: flex;
  gap: 12px;
  align-items: center;
`;

const BackButton = styled.button`
  padding: 10px 20px;
  background: ${s("buttonNeutralBackground")};
  color: ${s("buttonNeutralText")};
  border: 1px solid ${s("buttonNeutralBorder")};
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 200ms ease-in-out;
  display: flex;
  align-items: center;
  gap: 6px;

  &:hover {
    background: ${s("listItemHoverBackground")};
    border-color: ${s("inputBorder")};
    transform: translateX(-2px);
  }

  &:active {
    transform: translateX(0);
  }
`;

const CancelButton = styled.button`
  padding: 10px 20px;
  background: transparent;
  color: ${s("textTertiary")};
  border: 1px solid ${s("divider")};
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 200ms ease-in-out;

  &:hover {
    background: ${s("listItemHoverBackground")};
    border-color: ${s("inputBorder")};
    color: ${s("textSecondary")};
  }

  &:active {
    background: ${s("backgroundSecondary")};
  }
`;

const NextButton = styled.button`
  padding: 10px 24px;
  background: linear-gradient(135deg, #3B82F6 0%, #2563EB 100%);
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 200ms ease-in-out;
  display: flex;
  align-items: center;
  gap: 8px;
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);

  &:hover:not(:disabled) {
    background: linear-gradient(135deg, #2563EB 0%, #1D4ED8 100%);
    transform: translateY(-2px);
    box-shadow: 0 8px 16px rgba(59, 130, 246, 0.4);
  }

  &:active:not(:disabled) {
    transform: translateY(0);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    background: ${s("textTertiary")};
    box-shadow: none;
  }
`;

const ArrowIcon = styled.span`
  font-size: 12px;
  transition: transform 200ms ease-in-out;

  ${NextButton}:hover & {
    transform: translateX(3px);
  }
`;

export default ImportTab;

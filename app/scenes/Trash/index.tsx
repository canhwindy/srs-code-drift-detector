import { observer } from "mobx-react";
import { TrashIcon } from "outline-icons";
import { useTranslation } from "react-i18next";
import styled, { keyframes } from "styled-components";
import { s } from "@shared/styles";
import Button from "~/components/Button";
import Empty from "~/components/Empty";
import Flex from "~/components/Flex";
import Heading from "~/components/Heading";
import PaginatedDocumentList from "~/components/PaginatedDocumentList";
import Scene from "~/components/Scene";
import Subheading from "~/components/Subheading";
import { permanentlyDeleteDocumentsInTrash } from "~/actions/definitions/documents";
import useStores from "~/hooks/useStores";

function Trash() {
  const { t } = useTranslation();
  const { documents, emptyTrash } = useStores();

  const isEmptying = emptyTrash.isActive;
  const progress = Math.min(emptyTrash.progress, 100);

  return (
    <Scene
      icon={<TrashIcon />}
      title={t("Trash")}
      actions={
        documents.deleted.length > 0 &&
        !isEmptying && (
          <Button
            neutral
            action={permanentlyDeleteDocumentsInTrash}
            hideOnActionDisabled
          >
            {t("Empty trash")}
          </Button>
        )
      }
    >
      <Heading>{t("Trash")}</Heading>

      {isEmptying && (
        <ProgressContainer>
          <Card>
            <TopRow>
              <SpinnerIcon />
              <div>
                <ProgressTitle>{t("Emptying trash...")}</ProgressTitle>
                <CurrentItemText>
                  {emptyTrash.processedCount} / {emptyTrash.totalCount}{" "}
                  {t("documents deleted")}
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
                aria-label={t("Empty trash progress")}
              />
              <ProgressText>{Math.floor(progress)}%</ProgressText>
            </ProgressBarContainer>
          </Card>
        </ProgressContainer>
      )}

      <PaginatedDocumentList
        documents={documents.deleted}
        fetch={documents.fetchDeleted}
        heading={<Subheading sticky>{t("Recently deleted")}</Subheading>}
        empty={
          <Empty>
            {t("Trash is empty at the moment.")}
          </Empty>
        }
        showCollection
        showTemplate
      />
    </Scene>
  );
}

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
  border-top-color: #ef4444;
  border-right-color: #ef4444;
  border-radius: 50%;
  animation: ${spin} 0.8s linear infinite;
`;

const ProgressContainer = styled(Flex)`
  flex-direction: column;
  align-items: stretch;
  margin-bottom: 24px;
`;

const Card = styled.div`
  width: 100%;
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
  font-size: 18px;
  font-weight: 700;
  color: ${s("text")};
  margin: 0 0 4px 0;
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
    background: linear-gradient(90deg, #ef4444 0%, #dc2626 100%);
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

export default observer(Trash);

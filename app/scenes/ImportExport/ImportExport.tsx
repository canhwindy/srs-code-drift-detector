import { observer } from "mobx-react";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import { s } from "@shared/styles";
import CenteredContent from "~/components/CenteredContent";
import ImportTab from "./components/ImportTab";

const ImportExport = observer(() => {
  const { t } = useTranslation();

  return (
    <Wrapper>
      <PageHeader>
        <HeadingContainer>
          <HeadingText>{t("Import & Split")}</HeadingText>
        </HeadingContainer>
        <Subtitle>
          {t("Import and split documents into the system")}
        </Subtitle>
      </PageHeader>

      <CenteredContent>
        <TabContent>
          <ImportTab />
        </TabContent>
      </CenteredContent>
    </Wrapper>
  );
});

const Wrapper = styled.div`
  width: 100%;
`;

const PageHeader = styled.div`
  padding-left: 32px;
  margin-top: 32px;
  margin-bottom: -10px;
  animation: slideDown 400ms cubic-bezier(0.34, 1.56, 0.64, 1);

  @keyframes slideDown {
    from {
      opacity: 0;
      transform: translateY(-12px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
`;

const HeadingContainer = styled.div`
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 12px;
`;


const HeadingText = styled.h1`
  font-size: 32px;
  font-weight: 700;
  color: ${s("text")};
  margin: 0;
`;

const Subtitle = styled.p`
  margin: 0;
  font-size: 15px;
  color: ${s("textTertiary")};
  font-weight: 500;
`;

const TabContent = styled.div`
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
`;

export default ImportExport;

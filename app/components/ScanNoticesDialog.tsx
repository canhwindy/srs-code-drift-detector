import { observer } from "mobx-react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";
import styled, { keyframes } from "styled-components";
import { s } from "@shared/styles";
import useStores from "~/hooks/useStores";
import { importExportPath } from "~/utils/routeHelpers";

/**
 * Floating dialog that shows the progress of scanning documents
 * in a collection for yaml/markdown notice blocks conversion.
 */
const ScanNoticesDialog = observer(() => {
  const { scanNotices } = useStores();
  const { t } = useTranslation();
  const location = useLocation();

  const normalizedPathname = location.pathname.replace(/\/+$/, '');
  const importPath = importExportPath();
  const isOnImportPage = normalizedPathname === importPath || normalizedPathname.startsWith(importPath + '/');

  if (!scanNotices.isDialogVisible || isOnImportPage) {
    return null;
  }

  const progress = Math.min(scanNotices.scanProgress, 100);

  return (
    <FloatContainer>
      <FloatHeader>
        <SpinnerIcon />
        <FloatInfo>
          <FloatTitle>
            {t("Đang quét tài liệu...")}
          </FloatTitle>
          <FloatSubtitle>
            {scanNotices.currentDocumentName || scanNotices.scanningCollectionName}
          </FloatSubtitle>
        </FloatInfo>
        <FloatPercent>{Math.floor(progress)}%</FloatPercent>
      </FloatHeader>

      <FloatProgressBar>
        <FloatProgressFill $progress={progress} />
      </FloatProgressBar>

      <StatsRow>
        <StatItem>
          <StatValue>{scanNotices.processedDocuments}</StatValue>
          <StatLabel>/ {scanNotices.totalDocuments} {t("tài liệu")}</StatLabel>
        </StatItem>
        {scanNotices.convertedDocuments > 0 && (
          <StatItem>
            <StatValue>{scanNotices.convertedDocuments}</StatValue>
            <StatLabel>{t("đã chuyển đổi")}</StatLabel>
          </StatItem>
        )}
      </StatsRow>
    </FloatContainer>
  );
});

const slideIn = keyframes`
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
`;

const FloatContainer = styled.div`
  position: fixed;
  bottom: 24px;
  right: 24px;
  z-index: 100;
  width: 320px;
  padding: 16px;
  background: ${s("background")};
  border: 1px solid ${s("divider")};
  border-radius: 12px;
  box-shadow: ${(props) =>
    props.theme.isDark
      ? "0 4px 20px rgba(0, 0, 0, 0.4)"
      : "0 4px 20px rgba(0, 0, 0, 0.12)"};
  animation: ${slideIn} 300ms cubic-bezier(0.34, 1.56, 0.64, 1);
`;

const FloatHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
`;

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

const FloatInfo = styled.div`
  flex: 1;
  min-width: 0;
`;

const FloatTitle = styled.div`
  font-size: 14px;
  font-weight: 600;
  color: ${s("text")};
`;

const FloatSubtitle = styled.div`
  font-size: 12px;
  color: ${s("textSecondary")};
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const FloatPercent = styled.div`
  font-size: 14px;
  font-weight: 600;
  color: #10B981;
  margin-left: 8px;
`;

const FloatProgressBar = styled.div`
  width: 100%;
  height: 6px;
  background: ${s("sidebarBackground")};
  border-radius: 3px;
  overflow: hidden;
`;

const FloatProgressFill = styled.div<{ $progress: number }>`
  height: 100%;
  width: ${(props) => props.$progress}%;
  background: linear-gradient(90deg, #10B981 0%, #059669 100%);
  border-radius: 3px;
  transition: width 300ms ease;
`;

const StatsRow = styled.div`
  display: flex;
  justify-content: space-between;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid ${s("divider")};
`;

const StatItem = styled.div`
  display: flex;
  align-items: baseline;
  gap: 4px;
`;

const StatValue = styled.span`
  font-size: 16px;
  font-weight: 700;
  color: ${s("text")};
`;

const StatLabel = styled.span`
  font-size: 12px;
  color: ${s("textSecondary")};
`;

export default ScanNoticesDialog;

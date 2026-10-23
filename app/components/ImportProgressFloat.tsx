import { observer } from "mobx-react";
import { useTranslation } from "react-i18next";
import { useHistory, useLocation } from "react-router-dom";
import styled, { keyframes } from "styled-components";
import { s } from "@shared/styles";
import useStores from "~/hooks/useStores";
import { importExportPath } from "~/utils/routeHelpers";


const ImportProgressFloat = observer(() => {
  const { importSplit, scanNotices } = useStores();
  const { t } = useTranslation();
  const history = useHistory();
  const location = useLocation();

  // Normalize pathname to handle trailing slashes consistently
  const normalizedPathname = location.pathname.replace(/\/+$/, '');
  const importPath = importExportPath();
  const isOnImportPage = normalizedPathname === importPath || normalizedPathname.startsWith(importPath + '/');

  const isUploadingOrSplitting = importSplit.isUploading || importSplit.isSplitting;
  const isImportingDocs =
    importSplit.isImporting &&
    !importSplit.isImportComplete &&
    importSplit.step === "progress";
  const isScanningDocs =
    importSplit.step === "scanning" &&
    !importSplit.isScanComplete &&
    scanNotices.isScanning;

  const shouldShow = (isUploadingOrSplitting || isImportingDocs || isScanningDocs) && !isOnImportPage;

  if (!shouldShow) {
    return null;
  }

  const handleClick = () => {
    history.push(importExportPath());
  };

  // Upload/split phase
  if (isUploadingOrSplitting) {
    const uploadProgress = importSplit.isUploading
      ? importSplit.uploadProgress
      : 100;
    const label = importSplit.isSplitting
      ? t("Analyzing document...")
      : t("Uploading...");

    return (
      <FloatContainer onClick={handleClick}>
        <FloatHeader>
          <FloatIcon />
          <FloatInfo>
            <FloatTitle>{label}</FloatTitle>
            <FloatSubtitle>
              {importSplit.uploadedFile?.name}
            </FloatSubtitle>
          </FloatInfo>
          {importSplit.isUploading && (
            <FloatPercent>{Math.floor(uploadProgress)}%</FloatPercent>
          )}
        </FloatHeader>
        {importSplit.isUploading && (
          <FloatProgressBar>
            <FloatProgressFill $progress={uploadProgress} />
          </FloatProgressBar>
        )}
      </FloatContainer>
    );
  }

  // Scanning phase
  if (isScanningDocs) {
    const scanProgress = Math.min(scanNotices.scanProgress, 100);

    return (
      <FloatContainer onClick={handleClick}>
        <FloatHeader>
          <FloatIcon />
          <FloatInfo>
            <FloatTitle>{t("Đang quét tài liệu...")}</FloatTitle>
            <FloatSubtitle>
              {scanNotices.processedDocuments} / {scanNotices.totalDocuments}
            </FloatSubtitle>
          </FloatInfo>
          <FloatPercent>{Math.floor(scanProgress)}%</FloatPercent>
        </FloatHeader>
        <FloatProgressBar>
          <FloatProgressFill $progress={scanProgress} />
        </FloatProgressBar>
      </FloatContainer>
    );
  }

  // Import phase
  const progress = Math.min(importSplit.importProgress, 100);

  return (
    <FloatContainer onClick={handleClick}>
      <FloatHeader>
        <FloatIcon />
        <FloatInfo>
          <FloatTitle>{t("Importing...")}</FloatTitle>
          <FloatSubtitle>
            {importSplit.createdCount} / {importSplit.totalToImport}
          </FloatSubtitle>
        </FloatInfo>
        <FloatPercent>{Math.floor(progress)}%</FloatPercent>
      </FloatHeader>
      <FloatProgressBar>
        <FloatProgressFill $progress={progress} />
      </FloatProgressBar>
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
  width: 300px;
  padding: 14px 16px;
  background: ${s("background")};
  border: 1px solid ${s("divider")};
  border-radius: 12px;
  box-shadow: ${(props) =>
    props.theme.isDark
      ? "0 4px 20px rgba(0, 0, 0, 0.4)"
      : "0 4px 20px rgba(0, 0, 0, 0.12)"};
  cursor: pointer;
  animation: ${slideIn} 300ms cubic-bezier(0.34, 1.56, 0.64, 1);
  transition: transform 150ms ease, box-shadow 150ms ease;

  &:hover {
    transform: translateY(-2px);
    box-shadow: ${(props) =>
    props.theme.isDark
      ? "0 6px 24px rgba(0, 0, 0, 0.5)"
      : "0 6px 24px rgba(0, 0, 0, 0.16)"};
  }
`;

const FloatHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
`;

const spin = keyframes`
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
`;

const FloatIcon = styled.div`
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border: 3px solid transparent;
  border-top-color: #3B82F6;
  border-right-color: #3B82F6;
  border-radius: 50%;
  animation: ${spin} 1s linear infinite;
`;

const FloatInfo = styled.div`
  flex: 1;
  min-width: 0;
`;

const FloatTitle = styled.div`
  font-size: 13px;
  font-weight: 600;
  color: ${s("text")};
`;

const FloatSubtitle = styled.div`
  font-size: 11px;
  color: ${s("textTertiary")};
  margin-top: 1px;
`;

const FloatPercent = styled.div`
  font-size: 14px;
  font-weight: 700;
  color: #3B82F6;
  flex-shrink: 0;
`;

const FloatProgressBar = styled.div`
  height: 4px;
  background: ${s("progressBarBackground")};
  border-radius: 4px;
  overflow: hidden;
  margin-top: 10px;
`;

const FloatProgressFill = styled.div<{ $progress: number }>`
  height: 100%;
  width: ${(props) => props.$progress}%;
  background: linear-gradient(90deg, #3b82f6 0%, #2563eb 100%);
  border-radius: 4px;
  transition: width 300ms ease-out;
`;

export default ImportProgressFloat;

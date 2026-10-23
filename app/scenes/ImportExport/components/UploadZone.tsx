import { observer } from "mobx-react";
import { useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import { s } from "@shared/styles";
import useStores from "~/hooks/useStores";
import { BootstrapIcon } from "./BootstrapIcon";
import { toast } from "sonner";
import type { DocumentSplitResponse } from "~/stores/ImportSplitStore";

const UploadZone = observer(() => {
  const { t } = useTranslation();
  const { importSplit } = useStores();
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const uploadedFile = importSplit.uploadedFile;
  const uploadProgress = importSplit.uploadProgress;
  const isUploading = importSplit.isUploading;
  const isSplitting = importSplit.isSplitting;
  const splitResult = importSplit.splitData;

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      handleFileChange(files[0]);
    }
  };

  const handleFileChange = async (file: File) => {
    const fileName = file.name.toLowerCase();
    const isDocx = fileName.endsWith(".docx");

    if (isDocx) {
      importSplit.setUploadedFile(file);
      await callSplitAPI(file);
    } else {
      toast.error(t("Unsupported file type. Please upload a .docx file."));
    }
  };

  const callSplitAPI = async (file: File) => {
    importSplit.setIsUploading(true);
    importSplit.setIsSplitting(false);
    importSplit.setSplitData(null);
    importSplit.setUploadProgress(0);

    // @ts-ignore - Vite env variable — configured via VITE_FILE_SPLIT_API_URL in .env
    const apiUrl = import.meta.env.VITE_FILE_SPLIT_API_URL;
    if (!apiUrl) {
      toast.error(t("FileSplit API URL is not configured. Check .env file."));
      importSplit.setIsUploading(false);
      return;
    }
    const endpoint = `${apiUrl}/api/DocumentSplit/split`;

    const formData = new FormData();
    formData.append("file", file);
    formData.append("autoDetect", "true");
    formData.append("includeContent", "true");

    try {
      const data = await new Promise<DocumentSplitResponse>(
        (resolve, reject) => {
          const xhr = new XMLHttpRequest();

          xhr.upload.addEventListener("progress", (event) => {
            if (event.lengthComputable) {
              importSplit.setUploadProgress(
                Math.round((event.loaded / event.total) * 100)
              );
            }
          });

          xhr.upload.addEventListener("load", () => {
            importSplit.setUploadProgress(100);
            importSplit.setIsUploading(false);
            importSplit.setIsSplitting(true);
          });

          xhr.addEventListener("load", () => {
            try {
              const response: DocumentSplitResponse = JSON.parse(
                xhr.responseText
              );
              if (
                xhr.status >= 200 &&
                xhr.status < 300 &&
                response.success
              ) {
                resolve(response);
              } else {
                reject(
                  new Error(
                    response.errorMessage ||
                    `HTTP ${xhr.status} ${xhr.statusText}`
                  )
                );
              }
            } catch {
              reject(new Error(`HTTP ${xhr.status} ${xhr.statusText}`));
            }
          });

          xhr.addEventListener("error", () => {
            reject(
              new Error(
                "Network error: Cannot connect to FileSplit API. Check if server is running and CORS is configured correctly."
              )
            );
          });

          xhr.addEventListener("timeout", () => {
            reject(new Error("Request timed out"));
          });

          xhr.open("POST", endpoint, true);
          xhr.timeout = 300000;
          xhr.send(formData);
        }
      );

      importSplit.setSplitData(data);
      toast.success(t("Document split successfully!"));
    } catch (error: any) {
      toast.error(t("Failed to split document: ") + error.message);
    } finally {
      importSplit.setIsUploading(false);
      importSplit.setIsSplitting(false);
    }
  };

  const handleBrowseClick = () => {
    fileInputRef.current?.click();
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      handleFileChange(files[0]);
    }
  };

  const handleRemove = () => {
    importSplit.setUploadedFile(null);
    importSplit.setUploadProgress(0);
    importSplit.setSplitData(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  return (
    <Container>
      {!uploadedFile ? (
        <DropZone
          $isDragging={isDragging}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <IconContainer>
            <IconLarge>
              <BootstrapIcon name="cloud-upload" size={56} />
            </IconLarge>
          </IconContainer>
          <DropText>{t("Drag & drop your file here")}</DropText>
          <DropSubtext>{t("or")}</DropSubtext>
          <BrowseButton onClick={handleBrowseClick}>
            {t("Browse Files")}
          </BrowseButton>
          <HelpText>{t("Supported: .docx")}</HelpText>
        </DropZone>
      ) : (
        <FileCard>
          {isUploading ? (
            <>
              <FileHeaderRow>
                <FileIconContainer>
                  <BootstrapIcon name="cloud-upload" size={20} />
                </FileIconContainer>
                <FileDetailsContainer>
                  <FileName>{uploadedFile.name}</FileName>
                  <FileMeta>
                    {(uploadedFile.size / 1024 / 1024).toFixed(1)} MB •{" "}
                    {t("Sending to server...")}
                  </FileMeta>
                </FileDetailsContainer>
                <RemoveFileButton onClick={handleRemove} title="Remove file">
                  ×
                </RemoveFileButton>
              </FileHeaderRow>
              <ProgressSection>
                <ProgressBarContainer>
                  <ProgressBarFill $progress={uploadProgress} />
                </ProgressBarContainer>
                <ProgressLabel>
                  <ProgressPercent>
                    {Math.round(uploadProgress)}%
                  </ProgressPercent>
                  <ProgressDetails>
                    {t("{{loaded}} MB of {{total}} MB", {
                      loaded: (
                        (uploadedFile.size / 1024 / 1024) *
                        (uploadProgress / 100)
                      ).toFixed(1),
                      total: (uploadedFile.size / 1024 / 1024).toFixed(1),
                    })}
                  </ProgressDetails>
                </ProgressLabel>
              </ProgressSection>
            </>
          ) : (
            <>
              <FileHeaderRow>
                <FileIconContainer $success>
                  <BootstrapIcon name="check-circle-fill" size={20} />
                </FileIconContainer>
                <FileDetailsContainer>
                  <FileName>{uploadedFile.name}</FileName>
                  <FileMeta>
                    {(uploadedFile.size / 1024 / 1024).toFixed(1)} MB •{" "}
                    {t("Uploaded successfully")}
                  </FileMeta>
                </FileDetailsContainer>
                <RemoveFileButton onClick={handleRemove} title="Remove file">
                  ×
                </RemoveFileButton>
              </FileHeaderRow>
              {isSplitting && (
                <DetectionContainer $loading>
                  <DetectionIcon>
                    <BootstrapIcon name="hourglass-split" size={16} />
                  </DetectionIcon>
                  <DetectionText>
                    {t("Analyzing document structure...")}
                  </DetectionText>
                </DetectionContainer>
              )}
              {!isSplitting && splitResult && (
                <DetectionContainer>
                  <DetectionIcon>
                    <BootstrapIcon name="check-circle-fill" size={16} />
                  </DetectionIcon>
                  <DetectionText>
                    {t(
                      "Detected: {{nodes}} sections, {{depth}} levels deep",
                      {
                        nodes: splitResult.statistics.totalNodes,
                        depth: splitResult.statistics.maxDepth,
                      }
                    )}
                    {splitResult.detectedHeadingLevels &&
                      splitResult.detectedHeadingLevels.length > 0 && (
                        <span style={{ opacity: 0.7, marginLeft: 4 }}>
                          (
                          {splitResult.detectedHeadingLevels
                            .map(
                              (h) =>
                                `L${h.level}: ${h.fontSize ?? h.styleName}pt`
                            )
                            .join(", ")}
                          )
                        </span>
                      )}
                  </DetectionText>
                </DetectionContainer>
              )}
              {!isSplitting && !splitResult && (
                <DetectionContainer $error>
                  <DetectionIcon>
                    <BootstrapIcon name="exclamation-circle" size={16} />
                  </DetectionIcon>
                  <DetectionText>
                    {t("Failed to analyze document")}
                  </DetectionText>
                </DetectionContainer>
              )}
            </>
          )}
        </FileCard>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept=".docx,.doc"
        style={{ display: "none" }}
        onChange={handleInputChange}
      />
    </Container>
  );
});

const Container = styled.div`
  display: flex;
  flex-direction: column;
  gap: 24px;
`;

type DropZoneProps = {
  $isDragging: boolean;
};

const DropZone = styled.div<DropZoneProps>`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  min-height: 280px;
  padding: 48px 32px;
  border: 2px dashed
    ${(props) => (props.$isDragging ? "#3B82F6" : props.theme.divider)};
  border-radius: 12px;
  background: ${(props) =>
    props.$isDragging
      ? "linear-gradient(135deg, rgba(59, 130, 246, 0.05) 0%, rgba(59, 130, 246, 0.02) 100%)"
      : props.theme.isDark
        ? props.theme.backgroundSecondary
        : "linear-gradient(135deg, #FAFBFC 0%, #F3F4F6 100%)"};
  transition: all 250ms cubic-bezier(0.4, 0, 0.2, 1);
  cursor: pointer;
  position: relative;
  overflow: hidden;

  &::before {
    content: "";
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: radial-gradient(
      circle at 30% 50%,
      rgba(59, 130, 246, 0.05) 0%,
      transparent 50%
    );
    pointer-events: none;
    opacity: ${(props) => (props.$isDragging ? 1 : 0)};
    transition: opacity 250ms ease-in-out;
  }
`;

const IconContainer = styled.div`
  position: relative;
  z-index: 1;
  animation: float 3s ease-in-out infinite;

  @keyframes float {
    0%,
    100% {
      transform: translateY(0px);
    }
    50% {
      transform: translateY(-8px);
    }
  }
`;

const IconLarge = styled.div`
  font-size: 56px;
  display: flex;
  align-items: center;
  justify-content: center;
`;

const DropText = styled.div`
  font-size: 18px;
  font-weight: 600;
  color: ${s("text")};
  text-align: center;
  position: relative;
  z-index: 1;
`;

const DropSubtext = styled.div`
  color: ${s("textTertiary")};
  font-size: 13px;
  font-weight: 500;
  position: relative;
  z-index: 1;
`;

const BrowseButton = styled.button`
  position: relative;
  z-index: 1;
  padding: 10px 24px;
  background: #3b82f6;
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 200ms ease-in-out;
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);

  &:hover {
    background: #2563eb;
    transform: translateY(-2px);
    box-shadow: 0 8px 16px rgba(59, 130, 246, 0.4);
  }

  &:active {
    transform: translateY(0px);
  }
`;

const HelpText = styled.div`
  font-size: 12px;
  color: ${s("textTertiary")};
  text-align: center;
  position: relative;
  z-index: 1;
  line-height: 1.5;
`;

const FileCard = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  border: 1px solid ${s("divider")};
  border-radius: 12px;
  background: ${s("background")};
  box-shadow: ${(props) =>
    props.theme.isDark
      ? "0 1px 3px rgba(0, 0, 0, 0.2)"
      : "0 1px 3px rgba(0, 0, 0, 0.05), 0 2px 8px rgba(0, 0, 0, 0.03)"};
  animation: slideUp 300ms cubic-bezier(0.34, 1.56, 0.64, 1);

  @keyframes slideUp {
    from {
      opacity: 0;
      transform: translateY(12px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
`;

const FileHeaderRow = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  justify-content: space-between;
`;

const FileIconContainer = styled.div<{ $success?: boolean }>`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 8px;
  background: ${(props) =>
    props.$success
      ? props.theme.isDark
        ? "rgba(16, 185, 129, 0.15)"
        : "#ECFDF5"
      : props.theme.isDark
        ? "rgba(59, 130, 246, 0.15)"
        : "#EFF6FF"};
  font-size: 20px;
  flex-shrink: 0;
  color: ${(props) => (props.$success ? "#10B981" : "#3B82F6")};
`;

const FileDetailsContainer = styled.div`
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const FileName = styled.div`
  font-size: 14px;
  font-weight: 600;
  color: ${s("text")};
  word-break: break-word;
`;

const FileMeta = styled.div`
  font-size: 12px;
  color: ${s("textTertiary")};
`;

const RemoveFileButton = styled.button`
  flex-shrink: 0;
  background: transparent;
  border: none;
  color: ${s("textTertiary")};
  cursor: pointer;
  font-size: 24px;
  padding: 4px 8px;
  border-radius: 6px;
  transition: all 150ms ease-in-out;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;

  &:hover {
    background: ${s("listItemHoverBackground")};
    color: #ef4444;
  }
`;

const ProgressSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const ProgressBarContainer = styled.div`
  width: 100%;
  height: 6px;
  background: ${s("progressBarBackground")};
  border-radius: 6px;
  overflow: hidden;
`;

type ProgressBarFillProps = {
  $progress: number;
};

const ProgressBarFill = styled.div<ProgressBarFillProps>`
  height: 100%;
  width: ${(props) => props.$progress}%;
  background: linear-gradient(90deg, #3b82f6 0%, #2563eb 100%);
  border-radius: 6px;
  transition: width 300ms cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 0 0 8px rgba(59, 130, 246, 0.5);
`;

const ProgressLabel = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
`;

const ProgressPercent = styled.div`
  font-size: 12px;
  font-weight: 700;
  color: #3b82f6;
`;

const ProgressDetails = styled.div`
  font-size: 11px;
  color: ${s("textTertiary")};
`;

const DetectionContainer = styled.div<{
  $loading?: boolean;
  $error?: boolean;
}>`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px;
  background: ${(props) => {
    if (props.theme.isDark) {
      if (props.$error) {
        return "rgba(239, 68, 68, 0.1)";
      }
      if (props.$loading) {
        return "rgba(59, 130, 246, 0.1)";
      }
      return "rgba(16, 185, 129, 0.1)";
    }
    if (props.$error) {
      return "linear-gradient(135deg, #FEF2F2 0%, #FEE2E2 100%)";
    }
    if (props.$loading) {
      return "linear-gradient(135deg, #EFF6FF 0%, #DBEAFE 100%)";
    }
    return "linear-gradient(135deg, #ECFDF5 0%, #F0FDF4 100%)";
  }};
  border: 1px solid
    ${(props) => {
    if (props.theme.isDark) {
      if (props.$error) {
        return "rgba(239, 68, 68, 0.3)";
      }
      if (props.$loading) {
        return "rgba(59, 130, 246, 0.3)";
      }
      return "rgba(16, 185, 129, 0.3)";
    }
    if (props.$error) {
      return "#FCA5A5";
    }
    if (props.$loading) {
      return "#93C5FD";
    }
    return "#BBF7D0";
  }};
  border-radius: 8px;
  color: ${(props) => {
    if (props.$error) {
      return "#EF4444";
    }
    if (props.$loading) {
      return "#3B82F6";
    }
    return "#10B981";
  }};
`;

const DetectionIcon = styled.span`
  font-size: 16px;
  flex-shrink: 0;
`;

const DetectionText = styled.div`
  font-size: 13px;
  font-weight: 500;
  color: inherit;
`;

export default UploadZone;

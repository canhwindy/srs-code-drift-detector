import { observer } from "mobx-react";
import { useCallback, useMemo, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { toast } from "sonner";
import styled from "styled-components";
import { ExportContentType, NotificationEventType } from "@shared/types";
import type Document from "~/models/Document";
import ConfirmationDialog from "~/components/ConfirmationDialog";
import Flex from "~/components/Flex";
import Text from "~/components/Text";
import env from "~/env";
import useCurrentUser from "~/hooks/useCurrentUser";
import useStores from "~/hooks/useStores";

type Props = {
  document: Document;
  onSubmit: () => void;
};

/**
 * Helper to trigger a "Save As" dialog using the File System Access API
 * when available, falling back to creating a download link.
 */
async function saveFileWithDialog(blob: Blob, fileName: string) {
  if ("showSaveFilePicker" in window) {
    try {
      const ext = fileName.split(".").pop() || "";
      const mimeMap: Record<string, string> = {
        md: "text/markdown",
        html: "text/html",
        docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        zip: "application/zip",
      };
      const handle = await (window as any).showSaveFilePicker({
        suggestedName: fileName,
        types: [
          {
            description: `${ext.toUpperCase()} file`,
            accept: { [mimeMap[ext] || "application/octet-stream"]: [`.${ext}`] },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch (err: any) {
      // User cancelled the dialog
      if (err?.name === "AbortError") {
        return;
      }
      // Fall through to legacy download
    }
  }

  // Fallback: create a link and click it
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 250);
}

export const DocumentDownload = observer(({ document: doc, onSubmit }: Props) => {
  const { t } = useTranslation();
  const { ui } = useStores();
  const user = useCurrentUser();
  const hasChildDocuments = !!doc.childDocuments.length;

  const [contentType, setContentType] = useState<ExportContentType>(
    ExportContentType.Markdown
  );
  const [includeChildDocuments, setIncludeChildDocuments] =
    useState<boolean>(hasChildDocuments);
  const [includeChildDocumentsInOneFile, setIncludeChildDocumentsInOneFile] =
    useState<boolean>(false);

  const handleContentTypeChange = useCallback(
    (ev: React.ChangeEvent<HTMLInputElement>) => {
      setContentType(ev.target.value as ExportContentType);
    },
    []
  );

  const handleIncludeChildDocumentsChange = useCallback(
    (ev: React.ChangeEvent<HTMLInputElement>) => {
      setIncludeChildDocuments(ev.target.checked);
      if (!ev.target.checked) {
        setIncludeChildDocumentsInOneFile(false);
      }
    },
    []
  );

  const handleIncludeChildDocumentsInOneFileChange = useCallback(
    (ev: React.ChangeEvent<HTMLInputElement>) => {
      setIncludeChildDocumentsInOneFile(ev.target.checked);
    },
    []
  );

  const handleSubmit = useCallback(async () => {
    const isDirectDownload = !includeChildDocuments || includeChildDocumentsInOneFile;

    if (isDirectDownload) {
      // Direct download: fetch the file and show save dialog
      const response = await fetch("/api/documents.export", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: contentType,
        },
        credentials: "same-origin",
        body: JSON.stringify({
          id: doc.id,
          includeChildDocuments: includeChildDocumentsInOneFile,
          includeChildDocumentsInOneFile,
        }),
      });

      if (response.ok) {
        const blob = await response.blob();
        const dispositionHeader = response.headers.get("content-disposition") || "";
        const fileNameMatch = dispositionHeader.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
        let fileName = fileNameMatch ? fileNameMatch[1].replace(/['"]/g, "") : doc.titleWithDefault;

        // Use the actual Content-Type from the response to determine the correct mime type and extension
        const responseContentType = response.headers.get("content-type") || "";

        // Re-create blob with the correct mime type from the response
        const finalBlob = new Blob([blob], { type: responseContentType || blob.type });

        await saveFileWithDialog(finalBlob, decodeURIComponent(fileName));
      }
    } else {
      // Async export with child documents as separate files (zip via server task)
      const response = await doc.download({
        contentType,
        includeChildDocuments,
        includeChildDocumentsInOneFile: false,
      });

      if (response?.data?.fileOperation) {
        const fileOperationId = response.data.fileOperation.id;
        const toastId = `export-${fileOperationId}`;

        const timeoutId = setTimeout(() => {
          toast.success(t("Export started"), {
            id: toastId,
            description: t("A link to your file will be sent through email soon"),
            duration: 3000,
          });
          ui.exportToasts.delete(fileOperationId);
        }, 6000);

        ui.registerExportToast(fileOperationId, toastId, timeoutId);

        toast.loading(t("Export started"), {
          id: toastId,
          description: `${t("Preparing your download")}…`,
          duration: Infinity,
        });
      }
    }

    onSubmit();
  }, [t, ui, doc, contentType, includeChildDocuments, includeChildDocumentsInOneFile, onSubmit]);

  const items = useMemo(() => {
    const radioItems = [
      {
        title: "Markdown",
        description: t(
          "A file containing the selected documents in Markdown format."
        ),
        value: ExportContentType.Markdown,
      },
      {
        title: "HTML",
        description: t(
          "A file containing the selected documents in HTML format."
        ),
        value: ExportContentType.Html,
      },
      {
        title: "Word",
        description: t(
          "A file containing the selected documents in Word (.docx) format."
        ),
        value: ExportContentType.Docx,
      },
    ];

    if (env.PDF_EXPORT_ENABLED) {
      radioItems.push({
        title: "PDF",
        description: t(
          "A file containing the selected documents in PDF format."
        ),
        value: ExportContentType.Pdf,
      });
    }

    return radioItems;
  }, [t]);

  const showInOneFileOption = hasChildDocuments && includeChildDocuments;

  return (
    <ConfirmationDialog
      onSubmit={handleSubmit}
      submitText={
        includeChildDocuments && !includeChildDocumentsInOneFile
          ? t("Export")
          : t("Download")
      }
    >
      <Flex gap={12} column>
        {items.map((item) => (
          <Option key={item.value}>
            <StyledInput
              type="radio"
              name="format"
              value={item.value}
              checked={contentType === item.value}
              onChange={handleContentTypeChange}
            />
            <div>
              <Text as="p" size="small" weight="bold">
                {item.title}
              </Text>
              {item.description ? (
                <Text size="small" type="secondary">
                  {item.description}
                </Text>
              ) : null}
            </div>
          </Option>
        ))}
      </Flex>
      {hasChildDocuments && (
        <>
          <hr style={{ margin: "16px 0 " }} />
          <Flex gap={12} column>
            <Option>
              <StyledInput
                type="checkbox"
                name="includeChildDocuments"
                checked={includeChildDocuments}
                onChange={handleIncludeChildDocumentsChange}
              />
              <Flex column gap={4}>
                <Text as="p" size="small" weight="bold">
                  {t("Include child documents")}
                </Text>
                <Text as="p" size="small" type="secondary">
                  <Trans
                    defaults="When selected, exporting the document <em>{{documentName}}</em> may take some time."
                    values={{
                      documentName: doc.titleWithDefault,
                    }}
                    components={{
                      em: <strong />,
                    }}
                  />{" "}
                  {user.subscribedToEventType(
                    NotificationEventType.ExportCompleted
                  ) && t("You will receive an email when it's complete.")}
                </Text>
              </Flex>
            </Option>
            {showInOneFileOption && (
              <Option style={{ paddingLeft: 32 }}>
                <StyledInput
                  type="checkbox"
                  name="includeChildDocumentsInOneFile"
                  checked={includeChildDocumentsInOneFile}
                  onChange={handleIncludeChildDocumentsInOneFileChange}
                />
                <Flex column gap={4}>
                  <Text as="p" size="small" weight="bold">
                    {t("Include child documents in one file")}
                  </Text>
                  <Text as="p" size="small" type="secondary">
                    {t(
                      "When selected, all child documents will be merged into a single file. Otherwise they will be exported as separate files in a zip."
                    )}
                  </Text>
                </Flex>
              </Option>
            )}
          </Flex>
        </>
      )}
    </ConfirmationDialog>
  );
});

const Option = styled.label`
  display: flex;
  align-items: baseline;
  gap: 16px;

  p {
    margin: 0;
  }
`;

const StyledInput = styled.input`
  position: relative;
  top: 1.5px;
`;

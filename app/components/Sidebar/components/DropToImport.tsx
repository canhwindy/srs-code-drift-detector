import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import invariant from "invariant";
import { observer } from "mobx-react";
import { useCallback, useState } from "react";
import Dropzone from "react-dropzone";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import styled, { css } from "styled-components";
import { getDataTransferItems, getFilesWithPath } from "@shared/utils/files";
import LoadingIndicator from "~/components/LoadingIndicator";
import useEventListener from "~/hooks/useEventListener";
import useImportDocument from "~/hooks/useImportDocument";
import usePolicy from "~/hooks/usePolicy";
import useStores from "~/hooks/useStores";

type Props = {
  children: JSX.Element;
  collectionId?: string;
  documentId?: string;
  disabled?: boolean;
  activeClassName?: string;
};

function DropToImport({ disabled, children, collectionId, documentId }: Props) {
  const { t } = useTranslation();
  const { documents } = useStores();
  const [prerender, setPreRendered] = useState(false);
  const { handleFiles, isImporting } = useImportDocument(
    collectionId,
    documentId
  );
  invariant(
    collectionId || documentId,
    "Must provide either collectionId or documentId"
  );
  useEventListener("dragenter", () => setPreRendered(true));

  const canCollection = usePolicy(collectionId);
  const canDocument = usePolicy(documentId);

  const handleRejection = useCallback(() => {
    toast.error(
      t("Document not supported – try Markdown, Plain text, HTML, or Word")
    );
  }, [t]);

  const handleDrop = useCallback(
    async (event: React.DragEvent<HTMLElement>) => {
      event.preventDefault();
      event.stopPropagation();

      const items = getDataTransferItems(event);

      if (items.length > 0) {
        try {
          const filesWithPath = await getFilesWithPath(items);

          if (filesWithPath.length > 0) {
            await handleFiles(filesWithPath);
            return;
          }
        } catch (_err) {
          toast.error(t("Failed to process folder structure"));
        }
      }

      // Fallback to regular file handling if path extraction fails
      const files = event.dataTransfer.files
        ? Array.from(event.dataTransfer.files)
        : [];
      if (files.length > 0) {
        await handleFiles(files);
      }
    },
    [handleFiles, t]
  );

  if (
    disabled ||
    !prerender ||
    (collectionId && !canCollection.createDocument) ||
    (documentId && !canDocument.createChildDocument)
  ) {
    return children;
  }

  return (
    <Dropzone
      accept={documents.importFileTypesString}
      onDropAccepted={handleFiles}
      onDropRejected={handleRejection}
      noClick
      multiple
      noDrag
    >
      {({ getRootProps, getInputProps, isDragActive }) => (
        <DropzoneContainer
          {...getRootProps()}
          $isDragActive={isDragActive}
          tabIndex={-1}
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
        >
          <VisuallyHidden>
            <label>
              {t("Import files")}
              <input {...getInputProps()} />
            </label>
          </VisuallyHidden>
          {isImporting && <LoadingIndicator />}
          {children}
        </DropzoneContainer>
      )}
    </Dropzone>
  );
}

const DropzoneContainer = styled.div<{ $isDragActive: boolean }>`
  border-radius: 4px;

  ${({ $isDragActive, theme }) =>
    $isDragActive &&
    css`
      a,
      a + * {
        background: ${theme.slateDark} !important;
        color: ${theme.white} !important;
      }
      svg {
        fill: ${theme.white};
      }
    `}
`;

export default observer(DropToImport);

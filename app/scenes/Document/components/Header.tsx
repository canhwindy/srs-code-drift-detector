import { observer } from "mobx-react";
import { EditIcon } from "outline-icons";
import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import styled, { useTheme } from "styled-components";
import Icon from "@shared/components/Icon";
import useMeasure from "react-use-measure";
import { metaDisplay } from "@shared/utils/keyboard";
import type Document from "~/models/Document";
import type Revision from "~/models/Revision";
import { Action, Separator } from "~/components/Actions";
import Badge from "~/components/Badge";
import Button from "~/components/Button";
import Collaborators from "~/components/Collaborators";
import DocumentBreadcrumb from "~/components/DocumentBreadcrumb";
import DocumentStatusDropdown from "~/components/DocumentStatusDropdown";
import { useDocumentContext } from "~/components/DocumentContext";
import Flex from "~/components/Flex";
import Header, { HEADER_HEIGHT } from "~/components/Header";
import Star from "~/components/Star";
import Tooltip from "~/components/Tooltip";
import { navigateToTemplateSettings } from "~/actions/definitions/navigation";
import { restoreRevision } from "~/actions/definitions/revisions";
import useCurrentTeam from "~/hooks/useCurrentTeam";
import useCurrentUser from "~/hooks/useCurrentUser";
import useEditingFocus from "~/hooks/useEditingFocus";
import { useLocationSidebarContext } from "~/hooks/useLocationSidebarContext";
import useMobile from "~/hooks/useMobile";
import usePolicy from "~/hooks/usePolicy";
import useStores from "~/hooks/useStores";
import DocumentMenu from "~/menus/DocumentMenu";
import NewChildDocumentMenu from "~/menus/NewChildDocumentMenu";
import TableOfContentsMenu from "~/menus/TableOfContentsMenu";
import TemplatesMenu from "~/menus/TemplatesMenu";
import { documentEditPath, documentPath } from "~/utils/routeHelpers";
import ObservingBanner from "./ObservingBanner";
import PublicBreadcrumb from "./PublicBreadcrumb";
import ShareButton from "./ShareButton";
import { AppearanceAction } from "~/components/Sharing/components/Actions";
import useShare from "@shared/hooks/useShare";
import { type Editor } from "~/editor";
import { ChangesNavigation } from "./ChangesNavigation";

type Props = {
  editorRef: React.RefObject<Editor>;
  document: Document;
  revision: Revision | undefined;
  isDraft: boolean;
  isEditing: boolean;
  isSaving: boolean;
  isPublishing: boolean;
  savingIsDisabled: boolean;
  onSelectTemplate: (template: Document) => void;
  onSave: (options: {
    done?: boolean;
    publish?: boolean;
    autosave?: boolean;
  }) => void;
};

function DocumentHeader({
  editorRef,
  document,
  revision,
  isEditing,
  isDraft,
  isPublishing,
  isSaving,
  savingIsDisabled,
  onSelectTemplate,
  onSave,
}: Props) {
  const { t } = useTranslation();
  const { ui, documents } = useStores();
  const theme = useTheme();
  const team = useCurrentTeam({ rejectOnEmpty: false });
  const user = useCurrentUser({ rejectOnEmpty: false });
  const isMobileMedia = useMobile();
  const isRevision = !!revision;
  const isEditingFocus = useEditingFocus();
  const { hasHeadings, editor } = useDocumentContext();
  const sidebarContext = useLocationSidebarContext();
  const [measureRef, size] = useMeasure();
  const { shareId, sharedTree } = useShare();
  const isMobile = isMobileMedia || size.width < 700;

  // We cache this value for as long as the component is mounted so that if you
  // apply a template there is still the option to replace it until the user
  // navigates away from the doc
  const [isNew] = useState(document.isPersistedOnce);

  const handleSave = useCallback(() => {
    onSave({
      done: true,
    });
  }, [onSave]);

  const handleScrollToMainDoc = useCallback(() => {
    const el = window.document.querySelector<HTMLElement>(
      `[data-document-id="${document.id}"]`
    );
    if (el) {
      const top = el.getBoundingClientRect().top + window.scrollY - HEADER_HEIGHT;
      window.scrollTo({ top, behavior: "smooth" });
    } else {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [document.id]);

  const can = usePolicy(document);
  const { isDeleted, isTemplate } = document;
  const isTemplateEditable = can.update && isTemplate;
  const canToggleEmbeds = team?.documentEmbeds;

  const editAction = (
    <Action>
      <Tooltip
        content={t("Edit {{noun}}", {
          noun: document.noun,
        })}
        shortcut="e"
        placement="bottom"
      >
        <Button
          as={Link}
          icon={<EditIcon />}
          to={{
            pathname: documentEditPath(document),
            state: { sidebarContext },
          }}
          neutral
        >
          {isMobile ? null : t("Edit")}
        </Button>
      </Tooltip>
    </Action>
  );

  if (shareId) {
    return (
      <StyledHeader
        ref={measureRef}
        $hidden={isEditingFocus}
        title={
          <Flex gap={4}>
            {document.icon && (
              <Icon
                value={document.icon}
                initial={document.initial}
                color={document.color ?? undefined}
              />
            )}
            {document.title}
          </Flex>
        }
        hasSidebar={sharedTree && sharedTree.children?.length > 0}
        left={
          isMobile ? (
            hasHeadings ? (
              <TableOfContentsMenu />
            ) : null
          ) : (
            <PublicBreadcrumb
              documentId={document.id}
              shareId={shareId}
              sharedTree={sharedTree}
            />
          )
        }
        actions={
          <>
            <AppearanceAction />
            {can.update && !isEditing ? editAction : <div />}
          </>
        }
      />
    );
  }

  return (
    <>
      <StyledHeader
        ref={measureRef}
        $hidden={isEditingFocus}
        hasSidebar
        onClickTitle={handleScrollToMainDoc}
        left={
          isMobile ? (
            <TableOfContentsMenu />
          ) : (
            <DocumentBreadcrumb document={document}>
              {document.isTemplate ? null : (
                <Star document={document} color={theme.textSecondary} />
              )}
            </DocumentBreadcrumb>
          )
        }
        title={
          <Flex column gap={2} align="flex-start">
            {ui.activeDocumentId !== document.id ? (() => {
              const activeDoc = documents.get(ui.activeDocumentId ?? "");
              return activeDoc ? (
                <Flex gap={4} align="center">
                  <DocumentStatusDropdown document={activeDoc} readOnly />
                  {/* Pixel offset scroll: retainScrollPosition ngăn ScrollToTop reset về (0,0)
                      sau khi navigate — cho phép ResizeObserver trong Editor.tsx scroll đúng vị trí */}
                  <PreviewLink to={{ pathname: documentPath(activeDoc), state: { retainScrollPosition: true, fromPreviewBadge: true } }}>
                    <Badge style={{ margin: "0px 0px" }}>{t("You are in preview mode, click here to navigate to this document")}</Badge>
                  </PreviewLink>
                </Flex>
              ) : null;
            })() : (
              <Flex gap={4} align="center" style={{ minWidth: 0, maxWidth: "100%" }}>
                {document.isArchived && <Badge>{t("Archived")}</Badge>}
                <DocumentStatusDropdown document={document} />
              </Flex>
            )}
          </Flex>
        }
        actions={({ isCompact }) => (
          <>
            <ObservingBanner />

            {!isPublishing && isSaving && user?.separateEditMode && (
              <Status>{t("Saving")}…</Status>
            )}
            {!isDeleted && !isRevision && can.listViews && (
              <Collaborators
                document={document}
                limit={isCompact ? 3 : undefined}
              />
            )}
            {(isEditing || !user?.separateEditMode) &&
              !isTemplate &&
              isNew &&
              can.update && (
                <Action>
                  <TemplatesMenu
                    isCompact={isCompact}
                    document={document}
                    onSelectTemplate={onSelectTemplate}
                  />
                </Action>
              )}
            {!isEditing && !isRevision && !isTemplate && can.update && (
              <Action>
                <ShareButton document={document} />
              </Action>
            )}
            {(isEditing || isTemplateEditable) && (
              <Action>
                <Tooltip
                  content={t("Save")}
                  shortcut={`${metaDisplay}+enter`}
                  placement="bottom"
                >
                  <Button
                    action={isTemplate ? navigateToTemplateSettings : undefined}
                    onClick={isTemplate ? undefined : handleSave}
                    disabled={savingIsDisabled}
                    neutral={isDraft}
                    hideIcon
                  >
                    {isDraft ? t("Save draft") : t("Done editing")}
                  </Button>
                </Tooltip>
              </Action>
            )}
            {can.update &&
              !isEditing &&
              user?.separateEditMode &&
              !isRevision &&
              editAction}
            {can.update &&
              can.createChildDocument &&
              !isRevision &&
              !isCompact &&
              !isMobile && (
                <Action>
                  <NewChildDocumentMenu document={document} />
                </Action>
              )}
            {revision && (
              <>
                <Action>
                  <ChangesNavigation
                    revision={revision}
                    editorRef={editorRef}
                  />
                </Action>
                <Action>
                  <Tooltip content={t("Restore version")} placement="bottom">
                    <Button
                      action={restoreRevision}
                      disabled={revision.createdAt === document.updatedAt}
                      neutral
                      hideOnActionDisabled
                    >
                      {t("Restore")}
                    </Button>
                  </Tooltip>
                </Action>
              </>
            )}
            {!isDeleted && <Separator />}
            <Action>
              <DocumentMenu
                document={document}
                align="end"
                neutral
                onSelectTemplate={onSelectTemplate}
                onFindAndReplace={editor?.commands.openFindAndReplace}
                showToggleEmbeds={canToggleEmbeds}
                showDisplayOptions
              />
            </Action>
          </>
        )}
      />
    </>
  );
}

const StyledHeader = styled(Header) <{ $hidden: boolean }>`
  transition: opacity 500ms ease-in-out;
  ${(props) => props.$hidden && "opacity: 0;"}
`;

const Status = styled(Action)`
  padding-left: 0;
  padding-right: 4px;
  color: ${(props) => props.theme.slate};
`;


const PreviewLink = styled(Link)`
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  color: ${(props) => props.theme.textSecondary};
  text-decoration: none;
  &:hover {
    color: ${(props) => props.theme.text};
  }
`;

export default observer(DocumentHeader);

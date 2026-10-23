import { observer } from "mobx-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { mergeRefs } from "react-merge-refs";
import { useLocation, useRouteMatch } from "react-router-dom";
import styled from "styled-components";
import Text from "@shared/components/Text";
import { richExtensions, withComments } from "@shared/editor/nodes";
import { TeamPreference } from "@shared/types";
import { colorPalette } from "@shared/utils/collections";
import Comment from "~/models/Comment";
import type Document from "~/models/Document";
import type { RefHandle } from "~/components/ContentEditable";
import { useDocumentContext } from "~/components/DocumentContext";
import type { Props as EditorProps } from "~/components/Editor";
import Editor from "~/components/Editor";
import Flex from "~/components/Flex";
import { HEADER_HEIGHT } from "~/components/Header";
import Time from "~/components/Time";
import { withUIExtensions } from "~/editor/extensions";
import useCurrentTeam from "~/hooks/useCurrentTeam";
import useCurrentUser from "~/hooks/useCurrentUser";
import { useFocusedComment } from "~/hooks/useFocusedComment";
import { useLocationSidebarContext } from "~/hooks/useLocationSidebarContext";
import usePolicy from "~/hooks/usePolicy";
import useQuery from "~/hooks/useQuery";
import useStores from "~/hooks/useStores";
import {
  documentHistoryPath,
  documentPath,
  matchDocumentHistory,
} from "~/utils/routeHelpers";
import { decodeURIComponentSafe } from "~/utils/urls";
import MultiplayerEditor from "./AsyncMultiplayerEditor";
import DocumentMeta from "./DocumentMeta";
import DocumentTitle from "./DocumentTitle";
import first from "lodash/first";
import { getLangFor } from "~/utils/language";
import useShare from "@shared/hooks/useShare";

const extensions = withUIExtensions(withComments(richExtensions));

/**
 * Extract the longest plain text segment from a citation quote.
 * Quotes from LightRAG may contain markdown (**bold**, *italic*, `code`)
 * and HTML tags (<br>, <p>, etc.) that don't appear in ProseMirror text nodes.
 * Returns the longest contiguous plain-text segment, suitable for editor.commands.find().
 *
 * @example
 * extractLongestPlainText("BR 4-1 | **Displaying Input Rules:** <br> Hệ thống hiển thị popup")
 * // → "Hệ thống hiển thị popup"
 */
function extractLongestPlainText(quote: string): string {
  // Replace HTML tags with newline separators
  const withoutHtml = quote.replace(/<[^>]+>/g, "\n");

  // Replace markdown markers with newline separators (multi-char patterns first)
  const withoutMarkdown = withoutHtml
    .replace(/\*\*/g, "\n")
    .replace(/__/g, "\n")
    .replace(/\*/g, "\n")
    .replace(/_/g, "\n")
    .replace(/`/g, "\n");

  // Split by newlines and pipe separators, trim, filter empty
  const segments = withoutMarkdown
    .split(/[\n|]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (segments.length === 0) {
    return quote.trim().slice(0, 150);
  }

  const longest = segments.reduce((a, b) => (a.length >= b.length ? a : b));
  return longest.slice(0, 150);
}

type Props = Omit<EditorProps, "editorStyle"> & {
  onChangeTitle: (title: string) => void;
  onChangeIcon: (icon: string | null, color: string | null) => void;
  id: string;
  document: Document;
  isDraft: boolean;
  multiplayer?: boolean;
  /** Whether chained documents are rendered below, reducing bottom padding */
  hasChainedDocuments?: boolean;
  onSave: (options: {
    done?: boolean;
    autosave?: boolean;
    publish?: boolean;
  }) => void;
  children: React.ReactNode;
};

/**
 * The main document editor includes an editable title with metadata below it,
 * and support for commenting.
 */
function DocumentEditor(props: Props, ref: React.RefObject<any>) {
  const titleRef = React.useRef<RefHandle>(null);
  const { t } = useTranslation();
  const match = useRouteMatch();
  const location = useLocation<{ fromPreviewBadge?: boolean; highlightText?: string }>();
  const { setFocusedCommentId } = useDocumentContext();
  const focusedComment = useFocusedComment();
  const { ui, comments } = useStores();
  const user = useCurrentUser({ rejectOnEmpty: false });
  const team = useCurrentTeam({ rejectOnEmpty: false });
  const sidebarContext = useLocationSidebarContext();
  const params = useQuery();
  const { shareId } = useShare();
  const {
    document,
    onChangeTitle,
    onChangeIcon,
    isDraft,
    readOnly,
    children,
    multiplayer,
    hasChainedDocuments,
    ...rest
  } = props;
  const can = usePolicy(document);
  const commentingEnabled = !!team?.getPreference(TeamPreference.Commenting);

  const iconColor = document.color ?? (first(colorPalette) as string);
  const childRef = React.useRef<HTMLDivElement>(null);
  const focusAtStart = React.useCallback(() => {
    if (ref.current) {
      ref.current.focusAtStart();
    }
  }, [ref]);

  React.useEffect(() => {
    if (focusedComment) {
      const viewingResolved = params.get("resolved") === "";
      if (
        (focusedComment.isResolved && !viewingResolved) ||
        (!focusedComment.isResolved && viewingResolved)
      ) {
        setFocusedCommentId(focusedComment.id);
      }
      ui.set({ commentsExpanded: true });
    }
  }, [focusedComment, ui, document.id, params]);

  // Pixel offset scroll: sau khi navigate từ preview mode badge, restore đúng vị trí
  // user đang xem trong chained doc. Dùng ResizeObserver debounce 300ms để chờ
  // content render ổn định trước khi scroll — tránh scroll tới vị trí sai khi
  // content chưa load xong. Để disable: xoá toàn bộ useEffect này.
  React.useEffect(() => {
    if (!location.state?.fromPreviewBadge) {
      return;
    }
    if (ui.pendingScrollOffset === undefined) {
      return;
    }
    const offset = ui.pendingScrollOffset;

    const docEl = window.document.querySelector<HTMLElement>(
      `[data-document-id="${document.id}"]`
    );
    if (!docEl) {
      return;
    }

    let debounceTimer: ReturnType<typeof setTimeout>;
    // Pixel offset scroll: safety timeout — clear flag nếu VirtualDocumentChainBefore
    // không consume trong 1000ms (doc không có before-doc hoặc before-doc không auto-add)
    let safetyTimer: ReturnType<typeof setTimeout>;

    // Pixel offset scroll: chờ height ổn định 300ms sau lần resize cuối rồi mới scroll
    const observer = new ResizeObserver(() => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        // Pixel offset scroll: docTopAbsolute + offset - HEADER_HEIGHT đảm bảo
        // đúng pixel đang xem nằm ngay dưới header sau khi navigate
        const docTopAbsolute =
          docEl.getBoundingClientRect().top + window.scrollY;
        window.scrollTo(0, docTopAbsolute + offset - HEADER_HEIGHT);
        ui.setPendingScrollOffset(undefined);
        observer.disconnect();
        // Pixel offset scroll: báo cho VirtualDocumentChainBefore biết restoration
        // vừa xong — nó sẽ dùng scrollBy thay vì scrollTo khi prepend before-doc
        ui.setScrollRestorationActive(true);
        safetyTimer = setTimeout(() => ui.setScrollRestorationActive(false), 1000);
      }, 300);
    });

    observer.observe(docEl);
    return () => {
      observer.disconnect();
      clearTimeout(debounceTimer);
      clearTimeout(safetyTimer);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps — chỉ chạy 1 lần khi mount, offset đã được capture

  // Save document when blurring title, but delay so that if clicking on a
  // button this is allowed to execute first.
  const handleBlur = React.useCallback(() => {
    setTimeout(() => props.onSave({ autosave: true }), 250);
  }, [props]);

  const handleGoToNextInput = React.useCallback(
    (insertParagraph: boolean) => {
      if (insertParagraph && ref.current) {
        const { view } = ref.current;
        const { dispatch, state } = view;
        dispatch(state.tr.insert(0, state.schema.nodes.paragraph.create()));
      }

      focusAtStart();
    },
    [focusAtStart, ref]
  );

  // Create a Comment model in local store when a comment mark is created, this
  // acts as a local draft before submission.
  const handleDraftComment = React.useCallback(
    (commentId: string, createdById: string) => {
      if (comments.get(commentId) || createdById !== user?.id) {
        return;
      }

      const comment = new Comment(
        {
          documentId: props.id,
          createdAt: new Date(),
          createdById,
          reactions: [],
        },
        comments
      );
      comment.id = commentId;
      comments.add(comment);
      setFocusedCommentId(commentId);
    },
    [comments, user?.id, props.id]
  );

  // Soft delete the Comment model when associated mark is totally removed.
  const handleRemoveComment = React.useCallback(
    async (commentId: string) => {
      const comment = comments.get(commentId);
      if (comment?.isNew) {
        await comment?.delete();
      }
    },
    [comments]
  );

  const {
    editor,
    isEditorInitialized,
    setEditor,
    setEditorInitialized,
    updateState: updateDocState,
  } = useDocumentContext();

  // Highlight citation quote khi navigate từ CitationCard "Nguồn" button
  // PHẢI đặt sau useDocumentContext() để `editor` và `isEditorInitialized` đã được declare
  const highlightText = location.state?.highlightText;

  React.useEffect(() => {
    if (!isEditorInitialized || !editor || !highlightText) {
      return;
    }

    const searchText = extractLongestPlainText(highlightText);
    editor.commands.find({
      text: searchText,
      caseSensitive: false,
      regexEnabled: false,
    });

    // Dismiss khi user click — delay 300ms để tránh click "Nguồn" trigger dismiss ngay
    let handleMouseDown: (() => void) | undefined;
    const attachTimer = setTimeout(() => {
      handleMouseDown = () => {
        editor.commands.clearSearch();
      };
      window.addEventListener('mousedown', handleMouseDown, { once: true });
    }, 300);

    return () => {
      clearTimeout(attachTimer);
      if (handleMouseDown) {
        window.removeEventListener('mousedown', handleMouseDown);
      }
    };
  }, [isEditorInitialized, editor, highlightText]);

  const handleRefChanged = React.useCallback(setEditor, [setEditor]);
  const mergedEditorRef = React.useMemo(
    () => mergeRefs([ref, handleRefChanged]),
    [ref, handleRefChanged]
  );
  const EditorComponent = multiplayer ? MultiplayerEditor : Editor;

  const childOffsetHeight = childRef.current?.offsetHeight || 0;
  const editorStyle = React.useMemo(
    () => ({
      padding: "0 32px",
      margin: "0 -32px",
      paddingBottom: hasChainedDocuments
        ? "60px"
        : `calc(50vh - ${childOffsetHeight}px)`,
    }),
    [childOffsetHeight, hasChainedDocuments]
  );

  const handleInit = React.useCallback(
    () => setEditorInitialized(true),
    [setEditorInitialized]
  );

  const handleDestroy = React.useCallback(
    () => setEditorInitialized(false),
    [setEditorInitialized]
  );

  const direction = titleRef.current?.getComputedDirection();

  return (
    <Flex auto column data-document-id={document.id} style={{ minHeight: `calc(105vh - ${HEADER_HEIGHT}px)` }}>
      <DocumentTitle
        ref={titleRef}
        readOnly={readOnly}
        documentId={document.id}
        title={
          !document.title && readOnly
            ? document.titleWithDefault
            : document.title
        }
        icon={document.icon}
        color={iconColor}
        onChangeTitle={onChangeTitle}
        onChangeIcon={onChangeIcon}
        onGoToNextInput={handleGoToNextInput}
        onBlur={handleBlur}
        placeholder={t("Untitled")}
      />
      {shareId ? (
        document.updatedAt ? (
          <SharedMeta type="tertiary">
            {t("Last updated")} <Time dateTime={document.updatedAt} addSuffix />
          </SharedMeta>
        ) : null
      ) : (
        <DocumentMeta
          document={document}
          to={
            shareId
              ? undefined
              : {
                pathname:
                  match.path === matchDocumentHistory
                    ? documentPath(document)
                    : documentHistoryPath(document),
                state: { sidebarContext },
              }
          }
          $rtl={direction === "rtl"}
        />
      )}
      <EditorComponent
        ref={mergedEditorRef}
        lang={getLangFor(document.language)}
        autoFocus={!!document.title && !props.defaultValue}
        placeholder={t("Type '/' to insert, or start writing…")}
        scrollTo={decodeURIComponentSafe(window.location.hash)}
        readOnly={readOnly}
        userId={user?.id}
        focusedCommentId={focusedComment?.id}
        onClickCommentMark={
          commentingEnabled && can.comment ? setFocusedCommentId : undefined
        }
        onCreateCommentMark={
          commentingEnabled && can.comment ? handleDraftComment : undefined
        }
        onDeleteCommentMark={
          commentingEnabled && can.comment ? handleRemoveComment : undefined
        }
        onInit={handleInit}
        onDestroy={handleDestroy}
        onChange={updateDocState}
        extensions={extensions}
        editorStyle={editorStyle}
        {...rest}
      />
      <div ref={childRef}>{children}</div>
    </Flex>
  );
}

const SharedMeta = styled(Text)`
  margin: -12px 0 2em 0;
  font-size: 14px;
`;

export default observer(React.forwardRef(DocumentEditor));

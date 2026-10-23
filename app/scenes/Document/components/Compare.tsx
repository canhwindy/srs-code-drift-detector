import { observer } from "mobx-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { useHistory, useRouteMatch } from "react-router-dom";
import styled from "styled-components";
import { s } from "@shared/styles";
import { Pagination } from "@shared/constants";
import { RevisionHelper } from "@shared/utils/RevisionHelper";
import type Revision from "~/models/Revision";
import Button from "~/components/Button";
import Empty from "~/components/Empty";
import Scrollable from "~/components/Scrollable";
import Spinner from "@shared/components/Spinner";
import Time from "~/components/Time";
import Flex from "@shared/components/Flex";
import useKeyDown from "~/hooks/useKeyDown";
import { useLocationSidebarContext } from "~/hooks/useLocationSidebarContext";
import useStores from "~/hooks/useStores";
import { client } from "~/utils/ApiClient";
import { documentPath } from "~/utils/routeHelpers";
import Sidebar from "./SidebarLayout";
import { Avatar, AvatarSize } from "~/components/Avatar";
import Facepile from "~/components/Facepile";

function Compare() {
  const { documents, revisions } = useStores();
  const { t } = useTranslation();
  const match = useRouteMatch<{ documentSlug: string }>();
  const history = useHistory();
  const sidebarContext = useLocationSidebarContext();
  const document = documents.get(match.params.documentSlug);

  const [selectedIds, setSelectedIds] = React.useState<string[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [hasMore, setHasMore] = React.useState(true);
  const [offset, setOffset] = React.useState(0);
  const [isFetching, setIsFetching] = React.useState(false);
  const [compareError, setCompareError] = React.useState<string | null>(null);

  // Read initial selection from URL query params
  React.useEffect(() => {
    const params = new URLSearchParams(history.location.search);
    const from = params.get("from");
    const to = params.get("to");
    if (from && to) {
      setSelectedIds([from, to]);
    }
  }, []);

  // Fetch initial revisions
  React.useEffect(() => {
    if (!document) {
      return;
    }
    const fetchInitial = async () => {
      setLoading(true);
      try {
        const result = await revisions.fetchPage({
          documentId: document.id,
          offset: 0,
          limit: Pagination.defaultLimit,
        });
        setOffset(result.length);
        setHasMore(result.length >= Pagination.defaultLimit);
      } finally {
        setLoading(false);
      }
    };
    void fetchInitial();
  }, [document?.id, revisions]);

  const allRevisions = React.useMemo(
    () =>
      document
        ? revisions
            .getByDocumentId(document.id)
            .filter(
              (r: Revision) => r.id !== RevisionHelper.latestId(document.id)
            )
        : [],
    [document, revisions.orderedData]
  );

  const handleLoadMore = React.useCallback(async () => {
    if (loadingMore || !hasMore || !document) {
      return;
    }
    setLoadingMore(true);
    try {
      const result = await revisions.fetchPage({
        documentId: document.id,
        offset,
        limit: Pagination.defaultLimit,
      });
      setOffset((prev) => prev + result.length);
      setHasMore(result.length >= Pagination.defaultLimit);
    } finally {
      setLoadingMore(false);
    }
  }, [document?.id, revisions, offset, loadingMore, hasMore]);

  const handleToggle = React.useCallback((revisionId: string) => {
    setSelectedIds((prev) => {
      if (prev.includes(revisionId)) {
        return prev.filter((id) => id !== revisionId);
      }
      if (prev.length >= 2) {
        return prev;
      }
      return [...prev, revisionId];
    });
  }, []);

  // When "Compare" is clicked, call the server API then update URL params
  const handleCompare = React.useCallback(async () => {
    if (selectedIds.length !== 2) {
      return;
    }

    setIsFetching(true);
    setCompareError(null);

    try {
      const res = await client.post("/revision.compare", {
        fromId: selectedIds[0],
        toId: selectedIds[1],
      });

      const olderRevision = res?.data?.from;
      const newerRevision = res?.data?.to;

      if (!olderRevision || !newerRevision) {
        throw new Error("Invalid response from server");
      }

      // Populate store với dữ liệu mới nhất từ server
      revisions.add(olderRevision);
      revisions.add(newerRevision);

      history.replace({
        pathname: history.location.pathname,
        search: `?from=${olderRevision.id}&to=${newerRevision.id}`,
        state: {
          ...(history.location.state as Record<string, unknown> | undefined),
          compareHtml: res.data.html,
        },
      });
    } catch (_err) {
      setCompareError(t("Failed to compare versions. Please try again."));
    } finally {
      setIsFetching(false);
    }
  }, [selectedIds, revisions, history, t]);

  // Reset comparison (clear query params)
  const handleReset = React.useCallback(() => {
    setSelectedIds([]);
    history.replace({
      pathname: history.location.pathname,
      search: "",
      state: history.location.state,
    });
  }, [history]);

  const onClose = React.useCallback(() => {
    if (document) {
      history.push({
        pathname: documentPath(document),
        state: { sidebarContext },
      });
    } else {
      history.goBack();
    }
  }, [history, document, sidebarContext]);

  useKeyDown("Escape", onClose);

  const params = new URLSearchParams(history.location.search);
  const isComparing = !!(params.get("from") && params.get("to"));

  return (
    <Sidebar
      title={t("Compare version")}
      onClose={onClose}
      scrollable={false}
    >
      {isComparing && (
        <LegendContainer>
          <Legend>
            <LegendItem>
              <InsertionBadge /> {t("Added")}
            </LegendItem>
            <LegendItem>
              <DeletionBadge /> {t("Deleted")}
            </LegendItem>
          </Legend>
          <Button onClick={handleReset} neutral>
            {t("Reselect")}
          </Button>
        </LegendContainer>
      )}

      {!isComparing && (
        <Instruction>
          {t("Select exactly 2 versions to compare.")}
          {selectedIds.length > 0 && (
            <SelectedCount>
              {" "}
              ({selectedIds.length}/2)
            </SelectedCount>
          )}
        </Instruction>
      )}

      <Scrollable hiddenScrollbars topShadow>
        {loading ? (
          <Flex
            align="center"
            justify="center"
            style={{ height: 200 }}
          >
            <Spinner />
          </Flex>
        ) : allRevisions.length < 2 ? (
          <Flex
            align="center"
            justify="center"
            style={{ height: "100%" }}
            auto
          >
            <Empty>{t("At least 2 versions are required to compare.")}</Empty>
          </Flex>
        ) : (
          <>
            {allRevisions.map((revision: Revision) => {
              const isSelected = selectedIds.includes(revision.id);
              const isDisabled =
                isComparing || (selectedIds.length >= 2 && !isSelected);

              let collaboratorText: string | undefined;
              if (
                revision.collaborators &&
                revision.collaborators.length === 2
              ) {
                collaboratorText = `${revision.collaborators[0].name} and ${revision.collaborators[1].name}`;
              } else if (
                revision.collaborators &&
                revision.collaborators.length > 2
              ) {
                collaboratorText = t("{{count}} people", {
                  count: revision.collaborators.length,
                });
              } else {
                collaboratorText = revision.createdBy?.name;
              }

              return (
                <RevisionRow
                  key={revision.id}
                  $selected={isSelected}
                  $disabled={isDisabled}
                  onClick={() =>
                    !isDisabled && handleToggle(revision.id)
                  }
                >
                  <Checkbox
                    type="checkbox"
                    checked={isSelected}
                    disabled={isDisabled}
                    readOnly
                  />
                  <RevisionInfo>
                    <RevisionTitle>
                      {revision.collaborators ? (
                        <Facepile
                          users={revision.collaborators}
                          limit={3}
                        />
                      ) : (
                        revision.createdBy && (
                          <Avatar
                            model={revision.createdBy}
                            size={AvatarSize.Small}
                          />
                        )
                      )}
                      <Time
                        dateTime={revision.createdAt}
                        format={{
                          en_US: "MMM do, h:mm a",
                          fr_FR: "'Le 'd MMMM 'à' H:mm",
                        }}
                        relative={false}
                        addSuffix
                      />
                    </RevisionTitle>
                    <RevisionMeta>
                      {collaboratorText && (
                        <span>
                          {t("{{userName}} edited", {
                            userName: collaboratorText,
                          })}
                        </span>
                      )}
                    </RevisionMeta>
                  </RevisionInfo>
                </RevisionRow>
              );
            })}

            {hasMore && (
              <LoadMoreWrapper>
                <Button
                  onClick={handleLoadMore}
                  neutral
                  disabled={loadingMore}
                >
                  {loadingMore ? <Spinner /> : t("Load more")}
                </Button>
              </LoadMoreWrapper>
            )}
          </>
        )}
      </Scrollable>

      {!isComparing && !loading && allRevisions.length >= 2 && (
        <ActionBar>
          {compareError && <ErrorText>{compareError}</ErrorText>}
          <Button
            onClick={handleCompare}
            disabled={selectedIds.length !== 2 || isFetching}
          >
            {isFetching ? <Spinner /> : t("Compare")}
          </Button>
        </ActionBar>
      )}
    </Sidebar>
  );
}

const LegendContainer = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 0 16px 8px;
  padding: 8px 12px;
  border: 1px solid ${(props) => props.theme.inputBorder};
  border-radius: 8px;
`;

const Legend = styled.div`
  display: flex;
  gap: 12px;
  font-size: 13px;
  color: ${s("textSecondary")};
`;

const LegendItem = styled.span`
  display: flex;
  align-items: center;
  gap: 6px;
`;

const InsertionBadge = styled.span`
  display: inline-block;
  width: 12px;
  height: 12px;
  border-radius: 3px;
  background-color: ${(props) => props.theme.textDiffInsertedBackground};
`;

const DeletionBadge = styled.span`
  display: inline-block;
  width: 12px;
  height: 12px;
  border-radius: 3px;
  background-color: ${(props) => props.theme.textDiffDeletedBackground};
`;

const Instruction = styled.div`
  font-size: 13px;
  color: ${s("textSecondary")};
  margin: 0 16px 8px;
`;

const SelectedCount = styled.span`
  font-weight: 600;
  color: ${s("text")};
`;

const RevisionRow = styled.div<{ $selected: boolean; $disabled: boolean }>`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 16px;
  cursor: ${(props) => (props.$disabled ? "not-allowed" : "pointer")};
  opacity: ${(props) => (props.$disabled ? 0.5 : 1)};
  background-color: ${(props) =>
    props.$selected ? props.theme.sidebarActiveBackground : "transparent"};
  transition: background-color 100ms ease;

  &:hover {
    background-color: ${(props) =>
      props.$disabled
        ? "transparent"
        : props.$selected
          ? props.theme.sidebarActiveBackground
          : props.theme.listItemHoverBackground};
  }
`;

const Checkbox = styled.input`
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  cursor: inherit;
  accent-color: ${s("accent")};
`;

const RevisionInfo = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
`;

const RevisionTitle = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 500;
  color: ${s("text")};
`;

const RevisionMeta = styled.div`
  font-size: 12px;
  color: ${s("textTertiary")};
`;

const LoadMoreWrapper = styled.div`
  display: flex;
  justify-content: center;
  padding: 8px;
`;

const ActionBar = styled.div`
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 8px 16px;
  border-top: 1px solid ${s("divider")};
  flex-shrink: 0;
`;

const ErrorText = styled.span`
  font-size: 12px;
  color: ${s("danger")};
  flex: 1;
`;

export default observer(Compare);

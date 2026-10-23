import React, { useState, useEffect } from "react";
import { observer } from "mobx-react";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import Logger from "~/utils/Logger";
import useStores from "~/hooks/useStores";

interface ActivityItem {
  id: string;
  action: "ChangeCode" | "ChangeSRS" | "Reject Proposal From Agent";
  gapFindingId: string;
  agentProposalId: string | null;
  documentId: string;
  documentName: string | null;
  actorName: string;
  createdAt: string;
}

const RecentActivity: React.FC = () => {
  const { t } = useTranslation();
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { baDashboard } = useStores();

  const formatTimeAgo = (dateString: string): string => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMin / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMin < 1) {
      return t("Just now");
    }
    if (diffMin < 60) {
      return t("{{minutes}}m ago", { minutes: diffMin });
    }
    if (diffHours < 24) {
      return t("{{hours}}h ago", { hours: diffHours });
    }
    return t("{{days}}d ago", { days: diffDays });
  };

  useEffect(() => {
    const fetchActivities = async () => {
      setIsLoading(true);
      try {
        const data = await baDashboard.fetchActivities();
        setActivities(data);
      } catch (error) {
        Logger.error("Failed to fetch activities", error as Error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchActivities();
  }, [baDashboard, baDashboard.refreshKey]);

  const getIcon = (action: ActivityItem["action"]) => {
    switch (action) {
      case "ChangeCode":
        return (
          <IconWrapper $color="#8b5cf6" $bg="rgba(139, 92, 246, 0.1)">
            <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M12.316 3.051a1 1 0 01.633 1.265l-4 12a1 1 0 11-1.898-.632l4-12a1 1 0 011.265-.633zM5.707 6.293a1 1 0 010 1.414L3.414 10l2.293 2.293a1 1 0 11-1.414 1.414l-3-3a1 1 0 010-1.414l3-3a1 1 0 011.414 0zm8.586 0a1 1 0 011.414 0l3 3a1 1 0 010 1.414l-3 3a1 1 0 11-1.414-1.414L16.586 10l-2.293-2.293a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </IconWrapper>
        );
      case "ChangeSRS":
        return (
          <IconWrapper $color="#10b981" $bg="rgba(16, 185, 129, 0.1)">
            <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
              <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" />
              <path fillRule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z" clipRule="evenodd" />
            </svg>
          </IconWrapper>
        );
      case "Reject Proposal From Agent":
        return (
          <IconWrapper $color="#ef4444" $bg="rgba(239, 68, 68, 0.1)">
            <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </IconWrapper>
        );
    }
  };

  const getTitle = (item: ActivityItem): string => {
    const id = item.documentName ?? item.documentId?.slice(0, 8) ?? "unknown";
    if (item.action === "ChangeCode") {
      return t("Approved Change Code for {{id}}", { id });
    }
    if (item.action === "ChangeSRS") {
      return t("Approved Change SRS for {{id}}", { id });
    }

    return t("Rejected Proposal from Agent for {{id}}", { id });
  };

  if (isLoading) {
    return (
      <Container>
        <Header>
          <Title>{t("Recent Activity")}</Title>
        </Header>
        <LoadingText>{t("Loading activities...")}</LoadingText>
      </Container>
    );
  }

  return (
    <Container>
      <Header>
        <Title>{t("Recent Activity")}</Title>
      </Header>

      {activities.length === 0 ? (
        <EmptyText>{t("No recent activity")}</EmptyText>
      ) : (
        <ActivityList>
          {activities.map((activity, index) => (
            <ActivityRow key={activity.id} $isLast={index === activities.length - 1}>
              <ActivityLeft>
                {getIcon(activity.action)}
                <TimelineLine $hidden={index === activities.length - 1} />
              </ActivityLeft>
              <ActivityContent>
                <ActivityTitle>{getTitle(activity)}</ActivityTitle>
                <ActivityMeta>
                  <ActivityTimestamp>{formatTimeAgo(activity.createdAt)}</ActivityTimestamp>
                  <ActivityDot>•</ActivityDot>
                  <ActivityActor>{activity.actorName}</ActivityActor>
                </ActivityMeta>
              </ActivityContent>
            </ActivityRow>
          ))}
        </ActivityList>
      )}
    </Container>
  );
};

const Container = styled.div`
  background: ${(props) => props.theme.background};
  border-radius: 12px;
  padding: 24px;
  box-shadow: ${(props) => props.theme.isDark ? 'none' : '0 1px 3px rgba(0, 0, 0, 0.05), 0 1px 2px rgba(0, 0, 0, 0.03)'};
  border: 1px solid ${(props) => props.theme.divider};
  min-width: 0;
  width: 100%;
  box-sizing: border-box;

  @media (max-width: 1345px) {
    padding: 20px;
  }

  @media (max-width: 1280px) {
    padding: 18px;
  }

  @media (max-width: 1200px) {
    flex: 1;
    padding: 16px;
  }

  @media (max-width: 1100px) {
    padding: 14px;
  }

  @media (max-width: 1024px) {
    padding: 12px;
  }

  @media (max-width: 768px) {
    padding: 16px;
    border-radius: 10px;
  }
`;

const Header = styled.div`
  margin-bottom: 20px;
`;

const Title = styled.h2`
  font-size: 18px;
  font-weight: 600;
  color: ${(props) => props.theme.text};
  margin: 0;
`;

const LoadingText = styled.p`
  font-size: 14px;
  color: ${(props) => props.theme.textTertiary};
  text-align: center;
  padding: 40px 0;
`;

const EmptyText = styled.p`
  font-size: 14px;
  color: ${(props) => props.theme.textTertiary};
  text-align: center;
  padding: 40px 0;
`;

const ActivityList = styled.div`
  display: flex;
  flex-direction: column;
  max-height: 360px;
  overflow-y: auto;
  padding-right: 4px;

  &::-webkit-scrollbar {
    width: 4px;
  }

  &::-webkit-scrollbar-track {
    background: transparent;
  }

  &::-webkit-scrollbar-thumb {
    background-color: ${(props) => props.theme.scrollbarThumb};
    border-radius: 4px;
  }

  @media (max-width: 1024px) {
    max-height: 300px;
  }

  @media (max-width: 768px) {
    max-height: 280px;
  }
`;

const ActivityRow = styled.div<{ $isLast?: boolean }>`
  display: flex;
  gap: 14px;
  padding-bottom: ${(props) => (props.$isLast ? "0" : "16px")};
`;

const ActivityLeft = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
`;

const IconWrapper = styled.div<{ $color: string; $bg: string }>`
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background-color: ${(props) => props.$bg};
  color: ${(props) => props.$color};
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
`;

const TimelineLine = styled.div<{ $hidden?: boolean }>`
  width: 2px;
  flex: 1;
  background-color: ${(props) => (props.$hidden ? "transparent" : props.theme.divider)};
  min-height: 20px;
`;

const ActivityContent = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-top: 4px;
`;

const ActivityTitle = styled.span`
  font-size: 14px;
  font-weight: 500;
  color: ${(props) => props.theme.text};
  word-break: break-word;

  @media (max-width: 1024px) {
    font-size: 13px;
  }
`;

const ActivityMeta = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
`;

const ActivityTimestamp = styled.span`
  font-size: 12px;
  color: ${(props) => props.theme.textTertiary};
`;

const ActivityDot = styled.span`
  font-size: 12px;
  color: ${(props) => props.theme.textTertiary};
`;

const ActivityActor = styled.span`
  font-size: 12px;
  color: ${(props) => props.theme.textTertiary};
`;

export default observer(RecentActivity);
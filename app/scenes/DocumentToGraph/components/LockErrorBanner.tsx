import React from "react";
import styled, { keyframes } from "styled-components";
import type { WorkspaceLockError } from "../lib/api";

interface LockErrorBannerProps {
  error: WorkspaceLockError;
  onRetry?: () => void;
}

export default function LockErrorBanner({ error, onRetry }: LockErrorBannerProps) {
  const estimatedTime = error.detail?.estimated_unlock_time;
  return (
    <Banner>
      <IconWrap>
        <HourglassEmoji>⏳</HourglassEmoji>
      </IconWrap>
      <Content>
        <Title>Workspace is busy</Title>
        {estimatedTime && (
          <SubText>
            Estimated unlock at{" "}
            <TimeStamp>
              {new Date(Number(estimatedTime) * 1000).toLocaleTimeString()}
            </TimeStamp>
          </SubText>
        )}
      </Content>
      {onRetry && (
        <RetryButton onClick={onRetry}>
          Retry
        </RetryButton>
      )}
    </Banner>
  );
}

const shimmer = keyframes`
  0%   { opacity: 1; }
  50%  { opacity: 0.6; }
  100% { opacity: 1; }
`;

const Banner = styled.div`
  padding: 11px 14px;
  background: #fffbeb;
  border: 1px solid #fde68a;
  border-radius: 10px;
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 8px 0;
  box-shadow: 0 1px 3px rgba(251, 191, 36, 0.12), 0 0 0 3px rgba(253, 230, 138, 0.2);
  transition: box-shadow 0.2s ease;

  &:hover {
    box-shadow: 0 2px 6px rgba(251, 191, 36, 0.18), 0 0 0 3px rgba(253, 230, 138, 0.3);
  }

  @media (prefers-color-scheme: dark) {
    background: rgba(254, 243, 199, 0.06);
    border-color: rgba(253, 230, 138, 0.25);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3), 0 0 0 3px rgba(253, 230, 138, 0.06);
  }

  body.theme-dark &,
  body[data-theme="dark"] & {
    background: rgba(254, 243, 199, 0.06);
    border-color: rgba(253, 230, 138, 0.25);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3), 0 0 0 3px rgba(253, 230, 138, 0.06);
  }
`;

const IconWrap = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: rgba(253, 230, 138, 0.35);
  flex-shrink: 0;
  animation: ${shimmer} 2.4s ease-in-out infinite;
`;

const HourglassEmoji = styled.span`
  font-size: 16px;
  line-height: 1;
`;

const Content = styled.div`
  flex: 1;
  min-width: 0;
`;

const Title = styled.p`
  margin: 0;
  font-size: 13.5px;
  font-weight: 600;
  color: #92400e;
  letter-spacing: -0.01em;

  @media (prefers-color-scheme: dark) {
    color: #fde68a;
  }

  body.theme-dark &,
  body[data-theme="dark"] & {
    color: #fde68a;
  }
`;

const SubText = styled.p`
  margin: 2px 0 0;
  font-size: 12px;
  color: #b45309;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;

  @media (prefers-color-scheme: dark) {
    color: rgba(253, 230, 138, 0.7);
  }

  body.theme-dark &,
  body[data-theme="dark"] & {
    color: rgba(253, 230, 138, 0.7);
  }
`;

const TimeStamp = styled.span`
  font-weight: 500;
`;

const RetryButton = styled.button`
  flex-shrink: 0;
  padding: 5px 11px;
  border-radius: 7px;
  border: 1px solid #fcd34d;
  background: rgba(255, 255, 255, 0.7);
  color: #92400e;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  letter-spacing: 0.01em;
  transition: background 0.15s ease, border-color 0.15s ease, transform 0.1s ease;

  &:hover {
    background: rgba(255, 255, 255, 0.95);
    border-color: #f59e0b;
    transform: translateY(-1px);
  }

  &:active {
    transform: translateY(0);
  }

  @media (prefers-color-scheme: dark) {
    background: rgba(253, 230, 138, 0.1);
    border-color: rgba(253, 230, 138, 0.3);
    color: #fde68a;

    &:hover {
      background: rgba(253, 230, 138, 0.18);
      border-color: rgba(253, 230, 138, 0.5);
    }
  }

  body.theme-dark &,
  body[data-theme="dark"] & {
    background: rgba(253, 230, 138, 0.1);
    border-color: rgba(253, 230, 138, 0.3);
    color: #fde68a;

    &:hover {
      background: rgba(253, 230, 138, 0.18);
      border-color: rgba(253, 230, 138, 0.5);
    }
  }
`;

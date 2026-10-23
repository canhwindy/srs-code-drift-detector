import { observer } from "mobx-react";
import { useTranslation } from "react-i18next";
import { useHistory, useLocation } from "react-router-dom";
import styled, { keyframes } from "styled-components";
import { s } from "@shared/styles";
import useStores from "~/hooks/useStores";
import { trashPath } from "~/utils/routeHelpers";

const EmptyTrashProgressFloat = observer(() => {
  const { emptyTrash } = useStores();
  const { t } = useTranslation();
  const history = useHistory();
  const location = useLocation();

  const normalizedPathname = location.pathname.replace(/\/+$/, "");
  const isOnTrashPage = normalizedPathname === trashPath();

  // Show when actively emptying and NOT on the trash page
  // Also show briefly after completion so user sees 100%
  const shouldShow = emptyTrash.isActive && !isOnTrashPage;

  if (!shouldShow) {
    return null;
  }

  const handleClick = () => {
    history.push(trashPath());
  };

  const progress = Math.min(emptyTrash.progress, 100);

  return (
    <FloatContainer onClick={handleClick}>
      <FloatHeader>
        <FloatIcon />
        <FloatInfo>
          <FloatTitle>{t("Emptying trash...")}</FloatTitle>
          <FloatSubtitle>
            {emptyTrash.processedCount} / {emptyTrash.totalCount}
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

const spin = keyframes`
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
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

const FloatIcon = styled.div`
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border: 3px solid transparent;
  border-top-color: #ef4444;
  border-right-color: #ef4444;
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
  color: #ef4444;
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
  background: linear-gradient(90deg, #ef4444 0%, #dc2626 100%);
  border-radius: 4px;
  transition: width 300ms ease-out;
`;

export default EmptyTrashProgressFloat;

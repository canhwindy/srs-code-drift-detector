import { WarningIcon } from "outline-icons";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import styled from "styled-components";
import Button from "~/components/Button";
import Flex from "~/components/Flex";
import Text from "~/components/Text";
import useStores from "~/hooks/useStores";
import Tooltip from "~/components/Tooltip";
import type { CredentialStatus, CredentialVerifyResponse } from "./api";
import { deleteCredentials, fetchCredentialStatus, fetchCredentialVerification, saveCredentials } from "./api";

type Props = {
  onClose: () => void;
  initialError?: string;
};

function isValidTokenFormat(token: string): boolean {
  return token.trim().startsWith("sk-ant-");
}

function formatDaysRemaining(daysRemaining: number | null): string {
  if (daysRemaining === null) { return "Unknown"; }
  if (daysRemaining <= 0) { return "Expired"; }
  if (daysRemaining === 1) { return "1 day"; }
  if (daysRemaining < 30) { return `${daysRemaining} days`; }
  if (daysRemaining < 365) { return `${Math.floor(daysRemaining / 30)} months`; }
  return "1+ years";
}

// ─── Styled components ────────────────────────────────────────────────────────

const StatusBadge = styled.span`
  display: inline-flex;
  width: fit-content;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 600;
  background: ${({ theme }) => theme.accent}18;
  color: ${({ theme }) => theme.accent};

  &::before {
    content: "";
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
  }
`;

const SectionTitle = styled(Text)`
  font-weight: 600;
  letter-spacing: 0.01em;
`;

const InstructionStep = styled.div`
  display: flex;
  gap: 12px;
  align-items: flex-start;

  &:not(:last-child) {
    margin-bottom: 10px;
  }
`;

const StepNumber = styled.div`
  background: ${({ theme }) => theme.accent};
  color: white;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  flex-shrink: 0;
  margin-top: 1px;
`;

const StepContent = styled.div`
  flex: 1;
`;

const CopyableCode = styled.code<{ $copied?: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 7px;
  border-radius: 4px;
  font-family: monospace;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  user-select: none;
  transition: background 0.15s, border-color 0.15s, color 0.15s;

  ${({ $copied, theme }) =>
    $copied
      ? `
    background: ${theme.accent}20;
    border: 1px solid ${theme.accent};
    color: ${theme.accent};
  `
      : `
    background: ${theme.codeBackground};
    border: 1px solid ${theme.inputBorder};
    color: ${theme.accent};

    &:hover {
      background: ${theme.accent}15;
      border-color: ${theme.accent}60;
    }

    &:active {
      background: ${theme.accent}25;
    }
  `}
`;

const TokenInput = styled.input`
  width: 100%;
  padding: 10px 12px;
  border: 1px solid ${({ theme }) => theme.inputBorder};
  border-radius: 4px;
  font-family: monospace;
  font-size: 13px;
  background: ${({ theme }) => theme.background};
  color: ${({ theme }) => theme.text};

  &:focus {
    outline: none;
    border-color: ${({ theme }) => theme.accent};
    box-shadow: 0 0 0 2px ${({ theme }) => theme.accent}20;
  }

  &::placeholder {
    color: ${({ theme }) => theme.textTertiary};
  }
`;

const ValidationMessage = styled.div<{ $type: "error" | "success" | "info" }>`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 4px;
  font-size: 12px;

  ${({ $type, theme }) => {
    switch ($type) {
      case "error":
        return `
          background: ${theme.danger}12;
          color: ${theme.danger};
          border-left: 3px solid ${theme.danger};
        `;
      case "success":
        return `
          background: ${theme.accent}12;
          color: ${theme.accent};
          border-left: 3px solid ${theme.accent};
        `;
      case "info":
        return `
          background: ${theme.accent}08;
          color: ${theme.textSecondary};
          border-left: 3px solid ${theme.accent}50;
        `;
    }
  }}
`;

const CredentialCard = styled.div`
  background: ${({ theme }) => theme.codeBackground};
  border: 1px solid ${({ theme }) => theme.inputBorder};
  border-radius: 6px;
  padding: 12px;
`;

const CredentialRow = styled.div`
  display: flex;
  justify-content: space-between;
  padding: 4px 0;

  &:not(:last-child) {
    margin-bottom: 6px;
    border-bottom: 1px solid ${({ theme }) => theme.inputBorder};
    padding-bottom: 6px;
  }
`;

const CredentialLabel = styled.span`
  font-size: 12px;
  color: ${({ theme }) => theme.textTertiary};
  font-weight: 500;
`;

const CredentialValue = styled.span`
  font-size: 12px;
  color: ${({ theme }) => theme.text};
  font-family: monospace;
`;

// ─── Component ───────────────────────────────────────────────────────────────

export default function ClaudeCredentialModal({ onClose, initialError }: Props) {
  const { t } = useTranslation();
  const { ui } = useStores();

  const [status, setStatus] = React.useState<CredentialStatus | null>(null);
  const [verifyStatus, setVerifyStatus] = React.useState<CredentialVerifyResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [token, setToken] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [isTokenValid, setIsTokenValid] = React.useState(false);
  const [tokenError, setTokenError] = React.useState("");
  const [copied, setCopied] = React.useState(false);

  const handleCopyCommand = React.useCallback(() => {
    void navigator.clipboard.writeText("claude setup-token").then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, []);

  React.useEffect(() => {
    Promise.all([
      fetchCredentialStatus()
        .then(setStatus)
        .catch(() => setStatus({ connected: false })),
      fetchCredentialVerification()
        .then(setVerifyStatus)
        .catch(() => null),
    ]).finally(() => setLoading(false));
  }, []);

  React.useEffect(() => {
    const trimmedToken = token.trim();

    if (!trimmedToken) {
      setIsTokenValid(false);
      setTokenError("");
      return;
    }

    if (!isValidTokenFormat(trimmedToken)) {
      setIsTokenValid(false);
      setTokenError('Token must start with "sk-ant-"');
      return;
    }

    setIsTokenValid(true);
    setTokenError("");
  }, [token]);

  const handleSave = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setSaving(true);

    try {
      const credentialsJson = JSON.stringify({
        claudeAiOauth: {
          accessToken: token.trim(),
          refreshToken: "placeholder",
          expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000,
          subscriptionType: "",
          scopes: ["user:inference"],
        },
      });

      const data = await saveCredentials(credentialsJson);
      setStatus(data);
      setToken("");

      try {
        const verified = await fetchCredentialVerification();
        setVerifyStatus(verified);
      } catch {
        // ignore
      }

      toast.success(t("Claude token saved successfully!"));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setTokenError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const handleReplace = () => {
    setToken("");
    setIsTokenValid(false);
    setTokenError("");
  };

  const handleDisconnect = async () => {
    try {
      await deleteCredentials();
      setStatus({ connected: false });
      setVerifyStatus(null);
      setToken("");
      toast.success(t("Claude credentials removed"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  if (loading) {
    return <Text>{t("Loading…")}</Text>;
  }

  if (status?.connected) {
    return (
      <Flex column gap={16}>
        <StatusBadge>{t("Connected")}</StatusBadge>

        {verifyStatus && verifyStatus.status === "valid" && (
          <CredentialCard>
            <CredentialRow>
              <CredentialLabel>{t("Expires")}</CredentialLabel>
              <CredentialValue>
                {new Date(verifyStatus.expires_at || "").toLocaleDateString()}
              </CredentialValue>
            </CredentialRow>
            <CredentialRow>
              <CredentialLabel>{t("Time remaining")}</CredentialLabel>
              <CredentialValue>
                {formatDaysRemaining(verifyStatus.days_remaining)}
              </CredentialValue>
            </CredentialRow>
            {verifyStatus.is_long_lived && (
              <CredentialRow>
                <CredentialLabel>{t("Type")}</CredentialLabel>
                <CredentialValue>
                  {t("Long-lived")} ({t("up to")} {verifyStatus.token_lifetime_days} {t("days")})
                </CredentialValue>
              </CredentialRow>
            )}
          </CredentialCard>
        )}

        {status.warning && (
          <ValidationMessage $type="error">
            <WarningIcon size={16} />
            {status.warning}
          </ValidationMessage>
        )}

        <Flex justify="flex-end" gap={8}>
          <Button onClick={handleReplace} neutral>
            {t("Replace Token")}
          </Button>
          <Button onClick={handleDisconnect} neutral variant="danger">
            {t("Disconnect")}
          </Button>
          <Button onClick={onClose}>{t("Close")}</Button>
        </Flex>
      </Flex>
    );
  }

  const isSaveDisabled = saving || !isTokenValid || !!tokenError || ui.isAIRequestPending;

  return (
    <form onSubmit={handleSave}>
      <Flex column gap={16}>
        {initialError && (
          <ValidationMessage $type="error">
            <WarningIcon size={16} />
            {initialError}
          </ValidationMessage>
        )}

        <Flex column gap={12}>
          <SectionTitle type="secondary" size="small" as="p">
            {t("How to authenticate with Claude:")}
          </SectionTitle>

          <Flex column gap={0}>
            <InstructionStep>
              <StepNumber>1</StepNumber>
              <StepContent>
                <Text type="secondary" size="small">
                  {t("Ensure Claude CLI is installed on your device")}
                </Text>
              </StepContent>
            </InstructionStep>

            <InstructionStep>
              <StepNumber>2</StepNumber>
              <StepContent>
                <Text type="secondary" size="small">
                  {t("Open terminal and run")}{" "}
                  <Tooltip
                    content={copied ? t("Copied!") : t("Click to copy")}
                    placement="top"
                  >
                    <CopyableCode onClick={handleCopyCommand} $copied={copied}>
                      {copied ? t("Copied!") : "claude setup-token"}
                    </CopyableCode>
                  </Tooltip>
                </Text>
              </StepContent>
            </InstructionStep>

            <InstructionStep>
              <StepNumber>3</StepNumber>
              <StepContent>
                <Text type="secondary" size="small">
                  {t("Follow the login instructions — your token will appear as")} <code>sk-ant-...</code>
                </Text>
              </StepContent>
            </InstructionStep>

            <InstructionStep>
              <StepNumber>4</StepNumber>
              <StepContent>
                <Text type="secondary" size="small">
                  {t("Copy and paste the token below")}
                </Text>
              </StepContent>
            </InstructionStep>
          </Flex>
        </Flex>

        <Flex column gap={6}>
          <Text type="secondary" size="xsmall" as="label">
            {t("Your Token")}
          </Text>
          <TokenInput
            type="password"
            placeholder="sk-ant-..."
            value={token}
            onChange={(e) => setToken(e.target.value)}
            required
          />

          {tokenError && (
            <ValidationMessage $type="error">
              <WarningIcon size={16} />
              {tokenError}
            </ValidationMessage>
          )}

          {isTokenValid && !tokenError && (
            <ValidationMessage $type="success">
              {t("Token format valid")}
            </ValidationMessage>
          )}
        </Flex>

        <Flex justify="flex-end" gap={8}>
          <Button onClick={onClose} neutral>
            {t("Cancel")}
          </Button>
          <Tooltip
            content={
              ui.isAIRequestPending ? t("Processing AI request, please wait...") : ""
            }
            placement="top"
          >
            <Button type="submit" disabled={isSaveDisabled}>
              {saving ? `${t("Saving")}…` : t("Save Token")}
            </Button>
          </Tooltip>
        </Flex>
      </Flex>
    </form>
  );
}

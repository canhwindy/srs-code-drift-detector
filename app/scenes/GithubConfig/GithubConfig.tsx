import { observer } from "mobx-react";
import { useState, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";
import styled from "styled-components";
import { s } from "@shared/styles";
import Button from "~/components/Button";
import CenteredContent from "~/components/CenteredContent";
import Input from "~/components/Input";
import Text from "~/components/Text";
import useStores from "~/hooks/useStores";
import { toast } from "sonner";
import { GitHubApiClient } from "~/utils/githubApi";

interface RepoEntry {
  url: string;
  webhookSecret: string;
  testStatus: "none" | "saved" | "success" | "error";
  branches: string[];
  branchCount: number;
}

const GithubConfig = observer(({ configOnly = false }: { configOnly?: boolean }) => {
  const { t } = useTranslation();
  const { auth } = useStores();
  const location = useLocation();
  const user = auth.user;
  const isAdmin = user?.isAdmin ?? false;

  // State for form fields
  const [apiKey, setApiKey] = useState("");
  const [claudeProjectDir, setClaudeProjectDir] = useState("");
  const [repositories, setRepositories] = useState<RepoEntry[]>([
    { url: "", webhookSecret: "", testStatus: "none", branches: [], branchCount: 0 },
  ]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState<number | null>(null); // index of repo being tested
  const [isConfigured, setIsConfigured] = useState(false);

  // Pull Requests state
  const [pullRequests, setPullRequests] = useState<any[]>([]);
  const [isLoadingPRs, setIsLoadingPRs] = useState(false);
  const [prFilter, setPrFilter] = useState<"all" | "open" | "closed">("all");

  // PR Detail state
  const [selectedPR, setSelectedPR] = useState<number | null>(null);
  const [prCommits, setPrCommits] = useState<any[]>([]);
  const [prFiles, setPrFiles] = useState<any[]>([]);
  const [isLoadingPRDetail, setIsLoadingPRDetail] = useState(false);
  const [prDetailTab, setPrDetailTab] = useState<"commits" | "files">("commits");
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());

  // Active repo index for PR view
  const [activeRepoIndex, setActiveRepoIndex] = useState(0);

  // GitHub API client
  const getClient = useCallback(
    () => new GitHubApiClient("/api", activeRepoIndex),
    [activeRepoIndex]
  );

  // Load saved configuration from database on mount
  useEffect(() => {
    const loadConfig = async () => {
      try {
        const client = new GitHubApiClient();
        const config = await client.getConfig();

        if (config.configured && config.repositories.length > 0) {
          setIsConfigured(true);
          setRepositories(
            config.repositories.map((r) => ({
              url: r.url,
              webhookSecret: r.webhookSecretMasked || "",
              testStatus: "saved" as const,
              branches: [],
              branchCount: 0,
            }))
          );
          // Show masked API key so user knows a key is saved
          if (config.apiKeyMasked) {
            setApiKey(config.apiKeyMasked);
          }
          if (config.claudeProjectDir) {
            setClaudeProjectDir(config.claudeProjectDir);
          }
        }
      } catch {
        // Config not yet set up - that's fine
      } finally {
        setIsLoading(false);
      }
    };

    loadConfig();
  }, [auth.user]);

  // Parse repository URL
  const parseRepoUrl = (url: string) => {
    const match = url.match(/github\.com\/([^\/]+)\/([^\/]+)/);
    if (match) {
      return { owner: match[1], repo: match[2].replace(/\.git$/, "").replace(/\/$/, "") };
    }
    return null;
  };

  // Handle repo URL change
  const handleRepoChange = useCallback((index: number, value: string) => {
    setRepositories((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], url: value, testStatus: "none", branches: [], branchCount: 0 };
      return next;
    });
  }, []);

  // Handle repo webhook secret change
  const handleWebhookSecretChange = useCallback((index: number, value: string) => {
    setRepositories((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], webhookSecret: value };
      return next;
    });
  }, []);

  // Add new repo entry
  const handleAddRepo = useCallback(() => {
    setRepositories((prev) => [
      ...prev,
      { url: "", webhookSecret: "", testStatus: "none", branches: [], branchCount: 0 },
    ]);
  }, []);

  // Remove repo entry
  const handleRemoveRepo = useCallback((index: number) => {
    setRepositories((prev) => {
      if (prev.length <= 1) {
        return prev;
      }
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  // Check if the apiKey is a masked value from the server (not a real key)
  const isMaskedApiKey = apiKey.includes("****");

  // Handle Test Connection for a specific repo
  const handleTestConnection = useCallback(async (index: number) => {
    const repo = repositories[index];
    if (!apiKey.trim()) {
      toast.error(t("Please enter your Github API Key"));
      return;
    }
    if (isMaskedApiKey) {
      toast.error(t("Please enter your actual API Key to test a new connection. The displayed key is masked for security."));
      return;
    }
    if (!repo.url.trim()) {
      toast.error(t("Please enter a Repository Link"));
      return;
    }

    const repoPattern = /^https?:\/\/github\.com\/[\w-]+\/[\w.-]+\/?$/;
    if (!repoPattern.test(repo.url.trim())) {
      toast.error(t("Invalid repository link format. Example: https://github.com/owner/repo"));
      return;
    }

    setIsTesting(index);

    try {
      const client = new GitHubApiClient();
      const result = await client.testConnection(apiKey.trim(), repo.url.trim());

      setRepositories((prev) => {
        const next = [...prev];
        next[index] = {
          ...next[index],
          testStatus: "success",
          branchCount: result.branchCount,
          branches: result.branches,
        };
        return next;
      });
      toast.success(t("Connection test successful!"));
    } catch (error: any) {
      setRepositories((prev) => {
        const next = [...prev];
        next[index] = { ...next[index], testStatus: "error", branches: [], branchCount: 0 };
        return next;
      });
      toast.error(error.message || t("Failed to connect to GitHub"));
    } finally {
      setIsTesting(null);
    }
  }, [apiKey, isMaskedApiKey, repositories, t]);

  // Handle Save - save to database
  const handleSave = useCallback(async () => {
    if (!apiKey.trim()) {
      toast.error(t("Please enter your Github API Key"));
      return;
    }

    const validRepos = repositories.filter((r) => r.url.trim());
    if (validRepos.length === 0) {
      toast.error(t("Please enter at least one Repository Link"));
      return;
    }

    // Check all repos are either saved (from DB) or tested successfully
    const untestedRepos = validRepos.filter((r) => r.testStatus !== "success" && r.testStatus !== "saved");
    if (untestedRepos.length > 0) {
      toast.error(t("Please test all new repository connections before saving"));
      return;
    }

    setIsSaving(true);

    try {
      const client = new GitHubApiClient();
      await client.saveConfig({
        // If key is masked, send empty string - backend will keep existing key
        apiKey: isMaskedApiKey ? "" : apiKey.trim(),
        repositories: validRepos.map((r) => ({
          url: r.url.trim(),
          // If secret is masked, send empty string - backend will keep existing
          webhookSecret: r.webhookSecret.includes("****") ? "" : (r.webhookSecret.trim() || undefined),
        })),
        claudeProjectDir: claudeProjectDir.trim(),
      });

      setIsConfigured(true);
      toast.success(t("Configuration saved successfully!"));
    } catch (error: any) {
      toast.error(error.message || t("Failed to save configuration"));
    } finally {
      setIsSaving(false);
    }
  }, [apiKey, isMaskedApiKey, repositories, claudeProjectDir, t]);

  // Handle Clear/Delete
  const handleCancel = useCallback(async () => {
    try {
      const client = new GitHubApiClient();
      await client.deleteConfig();
    } catch {
      // ignore if no config exists
    }

    setApiKey("");
    setRepositories([{ url: "", webhookSecret: "", testStatus: "none", branches: [], branchCount: 0 }]);
    setIsConfigured(false);
    setPullRequests([]);
    setSelectedPR(null);
    toast.info(t("Configuration cleared"));
  }, [t]);

  // Fetch Pull Requests from the active repo
  const fetchPullRequests = useCallback(async (state: "all" | "open" | "closed" = "all") => {
    if (!isConfigured) {
      return;
    }

    setIsLoadingPRs(true);
    setPrFilter(state);

    try {
      const client = getClient();
      const data = await client.getPullRequests(state);
      setPullRequests(data);
    } catch (error: any) {
      toast.error(error.message || t("Failed to fetch pull requests"));
    } finally {
      setIsLoadingPRs(false);
    }
  }, [isConfigured, getClient, t]);

  // Fetch PR detail
  const fetchPRDetail = useCallback(async (prNumber: number) => {
    if (selectedPR === prNumber) {
      setSelectedPR(null);
      setPrCommits([]);
      setPrFiles([]);
      setExpandedFiles(new Set());
      return;
    }

    setSelectedPR(prNumber);
    setIsLoadingPRDetail(true);
    setPrDetailTab("commits");
    setExpandedFiles(new Set());

    try {
      const client = getClient();
      const detail = await client.getPullRequestDetail(prNumber);

      setPrCommits(detail.commits);
      setPrFiles(detail.files);
    } catch (error: any) {
      toast.error(error.message || t("Failed to fetch PR details"));
    } finally {
      setIsLoadingPRDetail(false);
    }
  }, [selectedPR, getClient, t]);

  // Toggle file diff expansion
  const toggleFileExpand = useCallback((filename: string) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(filename)) {
        next.delete(filename);
      } else {
        next.add(filename);
      }
      return next;
    });
  }, []);

  // Auto-load PRs when configured
  useEffect(() => {
    if (isConfigured && pullRequests.length === 0) {
      fetchPullRequests(prFilter);
    }
  }, [isConfigured]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-expand PR from URL params
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const prNumber = params.get("pr");

    if (prNumber && pullRequests.length > 0) {
      const prNum = parseInt(prNumber, 10);
      const prExists = pullRequests.some((pr: any) => pr.number === prNum);

      if (prExists && selectedPR !== prNum) {
        fetchPRDetail(prNum);
        setTimeout(() => {
          const prElement = document.querySelector(`[data-pr-number="${prNum}"]`);
          if (prElement) {
            prElement.scrollIntoView({ behavior: "smooth", block: "center" });
          }
        }, 300);
      }
    }
  }, [location.search, pullRequests, selectedPR, fetchPRDetail]);

  const allReposTested = repositories.every(
    (r) => !r.url.trim() || r.testStatus === "success" || r.testStatus === "saved"
  );
  const hasValidRepos = repositories.some((r) => r.url.trim() && (r.testStatus === "success" || r.testStatus === "saved"));

  if (isLoading) {
    return (
      <CenteredContent>
        <Text type="secondary">{t("Loading configuration...")}</Text>
      </CenteredContent>
    );
  }

  return (
    <PageWrapper>
      <PageHeader>
        <HeadingContainer>
          <IconBadge>
            <GithubSvgIcon />
          </IconBadge>
          <HeadingText>{t("Github Integration")}</HeadingText>
        </HeadingContainer>
        <Subtitle>
          {t("Connect your Github repositories to analyze code changes and compare with SRS requirements")}
        </Subtitle>
      </PageHeader>

      <SplitLayout $configOnly={configOnly}>
        {/* Left Column - Configuration */}
        <ConfigColumn $configOnly={configOnly}>
          <ColumnHeader>
            <ColumnIcon>&#9881;</ColumnIcon>
            <ColumnTitle>{t("Configuration")}</ColumnTitle>
          </ColumnHeader>

          {/* Admin-only warning */}
          {!isAdmin && (
            <WarningBox>
              <WarningIcon>&#9888;</WarningIcon>
              <WarningText>
                {t("Only workspace admins can configure GitHub settings. Contact your admin to set up the integration.")}
              </WarningText>
            </WarningBox>
          )}

          {/* Status Section */}
          <StatusSection>
            <StatusItem>
              <StatusLabel>{t("Configuration Status")}</StatusLabel>
              <StatusValue $configured={isConfigured}>
                {isConfigured ? "\u2713 " + t("Configured") : "\u2717 " + t("Not configured")}
              </StatusValue>
            </StatusItem>

            {isConfigured && repositories.filter((r) => r.url.trim() && (r.testStatus === "saved" || r.testStatus === "success")).length > 0 && (
              <StatusItem>
                <StatusLabel>{t("Repositories")}</StatusLabel>
                <StatusValue $configured={true}>
                  {repositories.filter((r) => r.url.trim() && (r.testStatus === "saved" || r.testStatus === "success")).length} {t("connected")}
                </StatusValue>
              </StatusItem>
            )}
          </StatusSection>

          {/* API Key Input */}
          <FormSection>
            <Label>{t("Github API Key")}</Label>
            <Input
              type="password"
              value={apiKey}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setApiKey(e.target.value)}
              placeholder={isConfigured ? t("Enter new key to update (current key is saved)") : t("Enter your Github Personal Access Token")}
              autoComplete="off"
              disabled={!isAdmin}
            />
            <HelpText>
              {t("Generate a Personal Access Token from")} {" "}
              <a
                href="https://github.com/settings/tokens"
                target="_blank"
                rel="noopener noreferrer"
              >
                {t("Github Settings")} &rarr; {t("Developer Settings")} &rarr; {t("Personal Access Tokens")}
              </a>
              <br />
              {t("Required scopes: repo (Full control of private repositories)")}
            </HelpText>
          </FormSection>

          {/* Claude Project Directory */}
          <FormSection>
            <Label>{t("Claude Project Directory")}</Label>
            <Input
              type="text"
              value={claudeProjectDir}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setClaudeProjectDir(e.target.value)}
              placeholder={t("e.g. /app or E:\\\\Project\\\\outline")}
              autoComplete="off"
              disabled={!isAdmin}
            />
            <HelpText>
              {t("Absolute path to the Outline project directory where Claude CLI will run gap-finding analysis. This directory must contain the .claude/ folder with skills.")}
            </HelpText>
          </FormSection>

          {/* Repository Links */}
          <FormSection>
            <RepoHeader>
              <Label style={{ marginBottom: 0 }}>{t("Repository Links")}</Label>
              {isAdmin && (
                <AddRepoButton onClick={handleAddRepo} title={t("Add another repository")}>
                  +
                </AddRepoButton>
              )}
            </RepoHeader>
            <HelpText style={{ marginTop: 4, marginBottom: 12 }}>
              {t("Enter the full URLs of your Github repositories and their webhook secrets. Each repo can have its own webhook secret.")}
              <br />
              <a
                href="https://docs.github.com/en/webhooks/using-webhooks/creating-webhooks"
                target="_blank"
                rel="noopener noreferrer"
              >
                {t("Learn more about GitHub Webhooks")}
              </a>
            </HelpText>

            {repositories.map((repo, index) => (
              <RepoEntryContainer key={index}>
                <RepoInputRow>
                  <RepoIndex>{index + 1}.</RepoIndex>
                  <RepoInputWrapper>
                    <Input
                      type="text"
                      value={repo.url}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        handleRepoChange(index, e.target.value)
                      }
                      placeholder="https://github.com/owner/repository"
                      disabled={!isAdmin}
                    />
                  </RepoInputWrapper>
                  {isAdmin && (
                    <RepoActions>
                      <SmallButton
                        onClick={() => handleTestConnection(index)}
                        disabled={
                          !apiKey.trim() ||
                          isMaskedApiKey ||
                          !repo.url.trim() ||
                          isTesting !== null ||
                          isSaving
                        }
                      >
                        {isTesting === index ? t("Testing...") : t("Test")}
                      </SmallButton>
                      {repositories.length > 1 && (
                        <RemoveRepoButton
                          onClick={() => handleRemoveRepo(index)}
                          title={t("Remove this repository")}
                        >
                          &times;
                        </RemoveRepoButton>
                      )}
                    </RepoActions>
                  )}
                </RepoInputRow>

                {/* Webhook Secret for this repo */}
                <WebhookSecretRow>
                  <WebhookSecretLabel>{t("Webhook Secret")}</WebhookSecretLabel>
                  <WebhookSecretInput
                    type="password"
                    value={repo.webhookSecret}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      handleWebhookSecretChange(index, e.target.value)
                    }
                    placeholder={repo.webhookSecret ? t("Enter new secret to update") : t("Enter webhook secret for this repo")}
                    autoComplete="off"
                    disabled={!isAdmin}
                  />
                </WebhookSecretRow>

                {/* Connection result for this repo */}
                {repo.testStatus === "saved" && (
                  <RepoStatus $status="success">
                    &#10003; {t("Saved")}
                  </RepoStatus>
                )}
                {repo.testStatus === "success" && (
                  <RepoStatus $status="success">
                    &#10003; {t("Connected")} - {repo.branchCount} {t("branches")}: {repo.branches.join(", ")}
                  </RepoStatus>
                )}
                {repo.testStatus === "error" && (
                  <RepoStatus $status="error">
                    &#10007; {t("Connection failed")}
                  </RepoStatus>
                )}
              </RepoEntryContainer>
            ))}
          </FormSection>

          {/* Action Buttons */}
          {isAdmin && (
            <ButtonContainer>
              <Button
                onClick={handleCancel}
                neutral
                disabled={isSaving || isTesting !== null}
              >
                {t("Clear")}
              </Button>
              {(allReposTested && hasValidRepos && apiKey.trim()) && (
                <Button
                  onClick={handleSave}
                  disabled={isSaving || isTesting !== null}
                >
                  {isSaving ? t("Saving...") : t("Save Configuration")}
                </Button>
              )}
            </ButtonContainer>
          )}
        </ConfigColumn>

        {/* Right Column - Pull Requests */}
        {!configOnly && <PRColumn>
          <ColumnHeader>
            <ColumnIcon>&#9042;</ColumnIcon>
            <ColumnTitle>{t("Pull Requests")}</ColumnTitle>
            {pullRequests.length > 0 && (
              <PRCount>{pullRequests.length}</PRCount>
            )}
          </ColumnHeader>

          {/* Repo selector if multiple repos */}
          {isConfigured && repositories.filter((r) => r.url.trim()).length > 1 && (
            <RepoSelector>
              {repositories.filter((r) => r.url.trim()).map((repo, index) => {
                const info = parseRepoUrl(repo.url);
                return (
                  <RepoSelectorButton
                    key={index}
                    $active={activeRepoIndex === index}
                    onClick={() => {
                      setActiveRepoIndex(index);
                      setPullRequests([]);
                      setSelectedPR(null);
                    }}
                  >
                    {info ? `${info.owner}/${info.repo}` : repo.url}
                  </RepoSelectorButton>
                );
              })}
            </RepoSelector>
          )}

          {!isConfigured ? (
            <PRPlaceholder>
              <PRPlaceholderIcon>&#9042;</PRPlaceholderIcon>
              <PRPlaceholderText>
                {t("Configure your GitHub connection to view pull requests")}
              </PRPlaceholderText>
            </PRPlaceholder>
          ) : (
            <>
              <PRFilterContainer>
                <PRFilterButton
                  $active={prFilter === "all"}
                  onClick={() => fetchPullRequests("all")}
                >
                  {t("All")}
                </PRFilterButton>
                <PRFilterButton
                  $active={prFilter === "open"}
                  onClick={() => fetchPullRequests("open")}
                >
                  {t("Open")}
                </PRFilterButton>
                <PRFilterButton
                  $active={prFilter === "closed"}
                  onClick={() => fetchPullRequests("closed")}
                >
                  {t("Closed")}
                </PRFilterButton>
              </PRFilterContainer>

              <PRList>
                {isLoadingPRs ? (
                  <PRLoadingText>{t("Loading pull requests...")}</PRLoadingText>
                ) : pullRequests.length === 0 ? (
                  <PREmptyText>{t("No pull requests found")}</PREmptyText>
                ) : (
                  pullRequests.map((pr: any) => (
                    <PRItem key={pr.number} $selected={selectedPR === pr.number} data-pr-number={pr.number}>
                      <PRItemHeader
                        onClick={() => fetchPRDetail(pr.number)}
                        style={{ cursor: "pointer" }}
                      >
                        <PRStateIcon $state={pr.state}>
                          {pr.state === "open" ? "\u25CB" : "\u25CF"}
                        </PRStateIcon>
                        <PRItemTitleButton>
                          {pr.title}
                        </PRItemTitleButton>
                        <PRNumber>#{pr.number}</PRNumber>
                        <PRDetailExpandIcon $expanded={selectedPR === pr.number}>
                          &rsaquo;
                        </PRDetailExpandIcon>
                      </PRItemHeader>
                      <PRItemMeta>
                        <span>{t("by")} {pr.author}</span>
                        <span>&bull;</span>
                        <span>{new Date(pr.createdAt).toLocaleDateString()}</span>
                        {pr.mergedAt && (
                          <>
                            <span>&bull;</span>
                            <PRMergedBadge>{t("Merged")}</PRMergedBadge>
                          </>
                        )}
                      </PRItemMeta>

                      {/* PR Detail Panel */}
                      {selectedPR === pr.number && (
                        <PRDetailPanel>
                          {isLoadingPRDetail ? (
                            <PRDetailLoading>{t("Loading PR details...")}</PRDetailLoading>
                          ) : (
                            <>
                              <PRDetailTabs>
                                <PRDetailTab
                                  $active={prDetailTab === "commits"}
                                  onClick={() => setPrDetailTab("commits")}
                                >
                                  {t("Commits")} ({prCommits.length})
                                </PRDetailTab>
                                <PRDetailTab
                                  $active={prDetailTab === "files"}
                                  onClick={() => setPrDetailTab("files")}
                                >
                                  {t("Changed Files")} ({prFiles.length})
                                </PRDetailTab>
                              </PRDetailTabs>

                              {prDetailTab === "commits" && (
                                <PRCommitsList>
                                  {prCommits.length === 0 ? (
                                    <PREmptyText>{t("No commit details available")}</PREmptyText>
                                  ) : prCommits.map((commit: any) => (
                                    <PRCommitItem key={commit.sha}>
                                      <PRCommitIcon>&#8857;</PRCommitIcon>
                                      <PRCommitContent>
                                        <PRCommitMessage>
                                          {(commit.message || "").split("\n")[0]}
                                        </PRCommitMessage>
                                        <PRCommitMeta>
                                          <PRCommitSha
                                            href={commit.htmlUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                          >
                                            {commit.sha?.substring(0, 7)}
                                          </PRCommitSha>
                                          <span>&bull;</span>
                                          <span>{commit.author}</span>
                                        </PRCommitMeta>
                                      </PRCommitContent>
                                    </PRCommitItem>
                                  ))}
                                </PRCommitsList>
                              )}

                              {prDetailTab === "files" && (
                                <PRFilesList>
                                  {prFiles.length === 0 ? (
                                    <PREmptyText>{t("No file details available")}</PREmptyText>
                                  ) : (
                                    <>
                                      <PRFilesSummary>
                                        <PRFilesSummaryItem $color="#22c55e">
                                          +{prFiles.reduce((sum: number, f: any) => sum + f.additions, 0)}
                                        </PRFilesSummaryItem>
                                        <PRFilesSummaryItem $color="#ef4444">
                                          -{prFiles.reduce((sum: number, f: any) => sum + f.deletions, 0)}
                                        </PRFilesSummaryItem>
                                        <span>{prFiles.length} {t("files changed")}</span>
                                      </PRFilesSummary>
                                      {prFiles.map((file: any) => (
                                        <PRFileItem key={file.sha + file.filename}>
                                          <PRFileHeader onClick={() => toggleFileExpand(file.filename)}>
                                            <PRFileExpandIcon $expanded={expandedFiles.has(file.filename)}>
                                              &rsaquo;
                                            </PRFileExpandIcon>
                                            <PRFileStatusBadge $status={file.status}>
                                              {file.status === "added" ? "A" :
                                                file.status === "removed" ? "D" :
                                                  file.status === "renamed" ? "R" : "M"}
                                            </PRFileStatusBadge>
                                            <PRFileName>{file.filename}</PRFileName>
                                            <PRFileChanges>
                                              <span style={{ color: "#22c55e" }}>+{file.additions}</span>
                                              <span style={{ color: "#ef4444" }}>-{file.deletions}</span>
                                            </PRFileChanges>
                                          </PRFileHeader>
                                          {expandedFiles.has(file.filename) && file.patch && (
                                            <PRDiffContainer>
                                              <PRDiffContent>
                                                {file.patch.split("\n").map((line: string, idx: number) => (
                                                  <PRDiffLine
                                                    key={idx}
                                                    $type={
                                                      line.startsWith("@@") ? "hunk" :
                                                        line.startsWith("+") ? "add" :
                                                          line.startsWith("-") ? "del" : "ctx"
                                                    }
                                                  >
                                                    <PRDiffLineNumber>{idx + 1}</PRDiffLineNumber>
                                                    <PRDiffLineContent>{line}</PRDiffLineContent>
                                                  </PRDiffLine>
                                                ))}
                                              </PRDiffContent>
                                            </PRDiffContainer>
                                          )}
                                          {expandedFiles.has(file.filename) && !file.patch && (
                                            <PRDiffContainer>
                                              <PRDiffEmpty>{t("Binary file or no diff available")}</PRDiffEmpty>
                                            </PRDiffContainer>
                                          )}
                                        </PRFileItem>
                                      ))}
                                    </>
                                  )}
                                </PRFilesList>
                              )}
                            </>
                          )}
                        </PRDetailPanel>
                      )}
                    </PRItem>
                  ))
                )}
              </PRList>
            </>
          )}
        </PRColumn>}
      </SplitLayout>
    </PageWrapper>
  );
});

// Github SVG Icon Component
const GithubSvgIcon = () => (
  <svg
    width="28"
    height="28"
    viewBox="0 0 24 24"
    fill="currentColor"
  >
    <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
  </svg>
);

// ========================================
// Styled Components
// ========================================

const PageWrapper = styled.div`
  padding: 20px 32px;
  max-width: 1400px;
  margin: 0 auto;
  width: 100%;
  box-sizing: border-box;

  @media (max-width: 768px) {
    padding: 16px;
  }
`;

const PageHeader = styled.div`
  margin-bottom: 32px;
  animation: slideDown 400ms cubic-bezier(0.34, 1.56, 0.64, 1);

  @keyframes slideDown {
    from {
      opacity: 0;
      transform: translateY(-12px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
`;

const HeadingContainer = styled.div`
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 12px;
`;

const IconBadge = styled.span`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
  border-radius: 12px;
  color: white;
`;

const HeadingText = styled.h1`
  font-size: 32px;
  font-weight: 700;
  color: ${s("text")};
  margin: 0;
`;

const Subtitle = styled.p`
  font-size: 16px;
  color: ${s("textSecondary")};
  margin: 0;
  max-width: 600px;
`;

const SplitLayout = styled.div<{ $configOnly?: boolean }>`
  display: flex;
  gap: 24px;
  align-items: flex-start;
  ${({ $configOnly }) => $configOnly && `justify-content: center;`}

  @media (max-width: 1024px) {
    flex-direction: column;
  }
`;

const ConfigColumn = styled.div<{ $configOnly?: boolean }>`
  width: ${({ $configOnly }) => $configOnly ? "100%" : "460px"};
  min-width: ${({ $configOnly }) => $configOnly ? "unset" : "400px"};
  max-width: ${({ $configOnly }) => $configOnly ? "560px" : "none"};
  flex-shrink: 0;
  background: ${s("background")};
  border: 1px solid ${s("divider")};
  border-radius: 12px;
  padding: 24px;

  @media (max-width: 1024px) {
    width: 100%;
    min-width: unset;
  }
`;

const PRColumn = styled.div`
  flex: 1;
  min-width: 0;
  background: ${s("background")};
  border: 1px solid ${s("divider")};
  border-radius: 12px;
  padding: 24px;

  @media (max-width: 1024px) {
    width: 100%;
  }
`;

const ColumnHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 20px;
  padding-bottom: 16px;
  border-bottom: 1px solid ${s("divider")};
`;

const ColumnIcon = styled.span`
  font-size: 20px;
  color: ${s("textSecondary")};
`;

const ColumnTitle = styled.span`
  font-size: 16px;
  font-weight: 600;
  color: ${s("text")};
`;

const WarningBox = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 16px;
  background: #fffbeb;
  border: 1px solid #fde68a;
  border-radius: 8px;
  margin-bottom: 24px;
`;

const WarningIcon = styled.span`
  font-size: 20px;
  color: #f59e0b;
`;

const WarningText = styled.p`
  font-size: 13px;
  color: #92400e;
  margin: 0;
`;

const FormSection = styled.div`
  margin-bottom: 24px;
`;

const Label = styled.label`
  display: block;
  font-size: 14px;
  font-weight: 600;
  color: ${s("text")};
  margin-bottom: 8px;
`;

const HelpText = styled.p`
  font-size: 13px;
  color: ${s("textTertiary")};
  margin-top: 8px;
  margin-bottom: 0;
  line-height: 1.5;

  a {
    color: ${s("accent")};
    text-decoration: none;

    &:hover {
      text-decoration: underline;
    }
  }
`;

const RepoHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
`;

const AddRepoButton = styled.button`
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  font-weight: 600;
  border: 2px dashed ${s("divider")};
  background: transparent;
  color: ${s("accent")};
  border-radius: 8px;
  cursor: pointer;
  transition: all 150ms ease;

  &:hover {
    border-color: ${s("accent")};
    background: ${s("menuBackground")};
  }
`;

const RepoEntryContainer = styled.div`
  margin-bottom: 16px;
  padding: 12px;
  border: 1px solid ${s("divider")};
  border-radius: 8px;
  background: ${s("menuBackground")};
`;

const WebhookSecretRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  padding-left: 28px;
`;

const WebhookSecretLabel = styled.span`
  font-size: 12px;
  font-weight: 500;
  color: ${s("textSecondary")};
  white-space: nowrap;
  min-width: 100px;
`;

const WebhookSecretInput = styled.input`
  flex: 1;
  padding: 6px 10px;
  font-size: 13px;
  border: 1px solid ${s("divider")};
  border-radius: 6px;
  background: ${s("background")};
  color: ${s("text")};
  outline: none;
  transition: border-color 150ms ease;

  &:focus {
    border-color: ${s("accent")};
  }

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  &::placeholder {
    color: ${s("textTertiary")};
  }
`;

const RepoInputRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const RepoIndex = styled.span`
  font-size: 14px;
  font-weight: 600;
  color: ${s("textSecondary")};
  min-width: 20px;
`;

const RepoInputWrapper = styled.div`
  flex: 1;
`;

const RepoActions = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
`;

const SmallButton = styled.button`
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 500;
  border: 1px solid ${s("divider")};
  background: ${s("menuBackground")};
  color: ${s("text")};
  border-radius: 6px;
  cursor: pointer;
  white-space: nowrap;
  transition: all 150ms ease;

  &:hover:not(:disabled) {
    border-color: ${s("accent")};
    color: ${s("accent")};
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const RemoveRepoButton = styled.button`
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  border: none;
  background: transparent;
  color: ${s("textTertiary")};
  border-radius: 6px;
  cursor: pointer;
  transition: all 150ms ease;

  &:hover {
    background: #fef2f2;
    color: #ef4444;
  }
`;

const RepoStatus = styled.div<{ $status: "success" | "error" }>`
  font-size: 12px;
  margin-top: 4px;
  margin-left: 28px;
  color: ${({ $status }) => ($status === "success" ? "#22c55e" : "#ef4444")};
`;

const ButtonContainer = styled.div`
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 24px;
  padding-top: 20px;
  border-top: 1px solid ${s("divider")};
`;

const StatusSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 24px;
  padding: 16px;
  background: ${s("menuBackground")};
  border-radius: 8px;
`;

const StatusItem = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
`;

const StatusLabel = styled.span`
  font-size: 14px;
  color: ${s("textSecondary")};
`;

const StatusValue = styled.span<{ $configured: boolean }>`
  font-size: 14px;
  font-weight: 600;
  color: ${({ $configured }) => ($configured ? "#22c55e" : "#ef4444")};
`;

const PRPlaceholder = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 24px;
  text-align: center;
`;

const PRPlaceholderIcon = styled.span`
  font-size: 48px;
  color: ${s("textTertiary")};
  margin-bottom: 16px;
  opacity: 0.4;
`;

const PRPlaceholderText = styled.p`
  font-size: 14px;
  color: ${s("textTertiary")};
  margin: 0;
`;

const RepoSelector = styled.div`
  display: flex;
  gap: 4px;
  margin-bottom: 16px;
  flex-wrap: wrap;
`;

const RepoSelectorButton = styled.button<{ $active: boolean }>`
  padding: 4px 10px;
  font-size: 12px;
  border: 1px solid ${({ $active }) => ($active ? "transparent" : s("divider"))};
  background: ${({ $active }) => ($active ? s("accent") : "transparent")};
  color: ${({ $active }) => ($active ? "white" : s("text"))};
  border-radius: 12px;
  cursor: pointer;
  transition: all 150ms ease;
  font-family: monospace;

  &:hover {
    background: ${({ $active }) => ($active ? s("accent") : s("menuBackground"))};
  }
`;

const PRCount = styled.span`
  font-size: 12px;
  padding: 2px 8px;
  background: ${s("accent")};
  color: white;
  border-radius: 10px;
  margin-left: auto;
`;

const PRFilterContainer = styled.div`
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
`;

const PRFilterButton = styled.button<{ $active: boolean }>`
  padding: 6px 14px;
  font-size: 13px;
  border: 1px solid ${({ $active }) => ($active ? "transparent" : s("divider"))};
  background: ${({ $active }) => ($active ? s("accent") : "transparent")};
  color: ${({ $active }) => ($active ? "white" : s("text"))};
  border-radius: 16px;
  cursor: pointer;
  transition: all 150ms ease;

  &:hover {
    background: ${({ $active }) => ($active ? s("accent") : s("menuBackground"))};
  }
`;

const PRList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: calc(100vh - 280px);
  overflow-y: auto;
  padding-right: 4px;

  &::-webkit-scrollbar {
    width: 6px;
  }
  &::-webkit-scrollbar-thumb {
    background: ${s("textTertiary")};
    border-radius: 3px;
  }
`;

const PRLoadingText = styled.p`
  font-size: 14px;
  color: ${s("textSecondary")};
  text-align: center;
  padding: 24px;
`;

const PREmptyText = styled.p`
  font-size: 14px;
  color: ${s("textTertiary")};
  text-align: center;
  padding: 24px;
`;

const PRItem = styled.div<{ $selected?: boolean }>`
  padding: 12px 16px;
  background: ${s("menuBackground")};
  border-radius: 8px;
  border: 1px solid ${({ $selected }) => ($selected ? s("accent") : s("divider"))};
  transition: border-color 150ms ease;

  &:hover {
    border-color: ${s("accent")};
  }
`;

const PRItemHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const PRStateIcon = styled.span<{ $state: string }>`
  font-size: 14px;
  color: ${({ $state }) => ($state === "open" ? "#22c55e" : "#a855f7")};
`;

const PRItemTitleButton = styled.span`
  flex: 1;
  font-size: 14px;
  font-weight: 500;
  color: ${s("text")};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;

  &:hover {
    color: ${s("accent")};
  }
`;

const PRDetailExpandIcon = styled.span<{ $expanded: boolean }>`
  font-size: 16px;
  color: ${s("textSecondary")};
  transform: rotate(${({ $expanded }) => ($expanded ? "90deg" : "0deg")});
  transition: transform 200ms ease;
  margin-left: 4px;
`;

const PRNumber = styled.span`
  font-size: 13px;
  color: ${s("textTertiary")};
`;

const PRItemMeta = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
  font-size: 12px;
  color: ${s("textTertiary")};
`;

const PRMergedBadge = styled.span`
  padding: 2px 6px;
  font-size: 11px;
  background: #a855f7;
  color: white;
  border-radius: 4px;
`;

const PRDetailPanel = styled.div`
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid ${s("divider")};
`;

const PRDetailLoading = styled.div`
  text-align: center;
  padding: 24px;
  font-size: 14px;
  color: ${s("textSecondary")};
`;

const PRDetailTabs = styled.div`
  display: flex;
  gap: 4px;
  margin-bottom: 12px;
`;

const PRDetailTab = styled.button<{ $active: boolean }>`
  padding: 8px 16px;
  font-size: 13px;
  font-weight: ${({ $active }) => ($active ? "600" : "400")};
  border: none;
  background: ${({ $active }) => ($active ? s("accent") : "transparent")};
  color: ${({ $active }) => ($active ? "white" : s("textSecondary"))};
  border-radius: 6px;
  cursor: pointer;
  transition: all 150ms ease;

  &:hover {
    background: ${({ $active }) => ($active ? s("accent") : s("sidebarBackground"))};
    color: ${({ $active }) => ($active ? "white" : s("text"))};
  }
`;

const PRCommitsList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const PRCommitItem = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  background: ${s("background")};
  border-radius: 6px;
  border: 1px solid ${s("divider")};
`;

const PRCommitIcon = styled.span`
  font-size: 14px;
  color: ${s("accent")};
  margin-top: 2px;
`;

const PRCommitContent = styled.div`
  flex: 1;
  min-width: 0;
`;

const PRCommitMessage = styled.div`
  font-size: 13px;
  font-weight: 500;
  color: ${s("text")};
  word-break: break-word;
`;

const PRCommitMeta = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
  font-size: 11px;
  color: ${s("textTertiary")};
`;

const PRCommitSha = styled.a`
  font-family: monospace;
  font-size: 11px;
  color: ${s("accent")};
  text-decoration: none;
  background: ${s("menuBackground")};
  padding: 1px 6px;
  border-radius: 3px;

  &:hover {
    text-decoration: underline;
  }
`;

const PRFilesList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const PRFilesSummary = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  font-size: 13px;
  color: ${s("textSecondary")};
  background: ${s("background")};
  border-radius: 6px;
  margin-bottom: 4px;
`;

const PRFilesSummaryItem = styled.span<{ $color: string }>`
  font-weight: 600;
  font-family: monospace;
  color: ${({ $color }) => $color};
`;

const PRFileItem = styled.div`
  background: ${s("background")};
  border: 1px solid ${s("divider")};
  border-radius: 6px;
  overflow: hidden;
`;

const PRFileHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  transition: background 100ms ease;

  &:hover {
    background: ${s("sidebarBackground")};
  }
`;

const PRFileExpandIcon = styled.span<{ $expanded: boolean }>`
  font-size: 14px;
  color: ${s("textSecondary")};
  transform: rotate(${({ $expanded }) => ($expanded ? "90deg" : "0deg")});
  transition: transform 150ms ease;
  width: 14px;
`;

const PRFileStatusBadge = styled.span<{ $status: string }>`
  font-size: 11px;
  font-weight: 700;
  font-family: monospace;
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 3px;
  color: white;
  background: ${({ $status }) =>
    $status === "added" ? "#22c55e" :
      $status === "removed" ? "#ef4444" :
        $status === "renamed" ? "#3b82f6" : "#f59e0b"};
`;

const PRFileName = styled.span`
  flex: 1;
  font-size: 13px;
  font-family: monospace;
  color: ${s("text")};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const PRFileChanges = styled.div`
  display: flex;
  gap: 8px;
  font-size: 12px;
  font-family: monospace;
`;

const PRDiffContainer = styled.div`
  border-top: 1px solid ${s("divider")};
  max-height: 500px;
  overflow: auto;
`;

const PRDiffContent = styled.div`
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
  font-size: 12px;
  line-height: 1.5;
`;

const PRDiffLine = styled.div<{ $type: "add" | "del" | "hunk" | "ctx" }>`
  display: flex;
  background: ${({ $type }) =>
    $type === "add" ? "rgba(34, 197, 94, 0.1)" :
      $type === "del" ? "rgba(239, 68, 68, 0.1)" :
        $type === "hunk" ? "rgba(59, 130, 246, 0.08)" : "transparent"};
  color: ${({ $type }) =>
    $type === "hunk" ? s("textTertiary") : s("text")};
  white-space: pre;

  &:hover {
    background: ${({ $type }) =>
    $type === "add" ? "rgba(34, 197, 94, 0.15)" :
      $type === "del" ? "rgba(239, 68, 68, 0.15)" :
        $type === "hunk" ? "rgba(59, 130, 246, 0.12)" : s("menuBackground")};
  }
`;

const PRDiffLineNumber = styled.span`
  width: 50px;
  min-width: 50px;
  padding: 0 8px;
  text-align: right;
  color: ${s("textTertiary")};
  user-select: none;
  border-right: 1px solid ${s("divider")};
`;

const PRDiffLineContent = styled.span`
  padding: 0 12px;
  flex: 1;
`;

const PRDiffEmpty = styled.div`
  padding: 16px;
  text-align: center;
  font-size: 13px;
  color: ${s("textTertiary")};
  font-style: italic;
`;

export default GithubConfig;

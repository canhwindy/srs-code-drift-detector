import env from "@server/env";
import Logger from "@server/logging/Logger";

function deriveRepoName(url: string): string | null {
  const match = url.match(/github\.com\/[^\/]+\/([^\/]+?)(?:\.git)?\/?$/);
  return match ? match[1] : null;
}

export async function registerRepoWithGitnexus(
  repoUrl: string,
  accessToken: string | null,
  branch?: string
): Promise<void> {
  const serviceUrl = env.GITNEXUS_SERVICE_URL;
  if (!serviceUrl) {
    return;
  }

  try {
    const body: Record<string, unknown> = { repo_url: repoUrl };
    if (accessToken) {
      body.access_token = accessToken;
    }
    if (branch) {
      body.branch = branch;
    }

    const response = await fetch(`${serviceUrl}/api/repos/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      Logger.warn(
        `gitnexus register failed for ${repoUrl}: HTTP ${response.status} ${text}`
      );
      return;
    }

    Logger.info("task", `gitnexus registered: ${repoUrl}`);
  } catch (err) {
    Logger.warn(
      `gitnexus register error for ${repoUrl}: ${(err as Error).message}`
    );
  }
}

export async function unregisterRepoFromGitnexus(
  repoUrl: string
): Promise<void> {
  const serviceUrl = env.GITNEXUS_SERVICE_URL;
  if (!serviceUrl) {
    return;
  }

  const name = deriveRepoName(repoUrl);
  if (!name) {
    return;
  }

  try {
    const response = await fetch(
      `${serviceUrl}/api/repos/${encodeURIComponent(name)}`,
      { method: "DELETE" }
    );

    if (!response.ok && response.status !== 404) {
      Logger.warn(
        `gitnexus unregister failed for ${name}: HTTP ${response.status}`
      );
      return;
    }

    Logger.info("task", `gitnexus unregistered: ${name}`);
  } catch (err) {
    Logger.warn(
      `gitnexus unregister error for ${name}: ${(err as Error).message}`
    );
  }
}

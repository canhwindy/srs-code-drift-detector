import { client } from "~/utils/ApiClient";

export interface CredentialStatus {
  connected: boolean;
  subscription_type?: string | null;
  expires_at_iso?: string | null;
  warning?: string | null;
}

export interface CredentialVerifyResponse {
  status: "valid" | "expired" | "missing" | "revoked";
  expires_at: string | null;
  days_remaining: number | null;
  is_long_lived: boolean;
  token_lifetime_days: number;
}

export async function fetchCredentialStatus(): Promise<CredentialStatus> {
  const res = await client.post("/claudeCredentials.status");
  return res.data as CredentialStatus;
}

export async function fetchCredentialVerification(): Promise<CredentialVerifyResponse> {
  const res = await client.post("/claudeCredentials.verify");
  return res.data as CredentialVerifyResponse;
}

export async function saveCredentials(
  credentialsJson: string
): Promise<CredentialStatus> {
  const res = await client.post("/claudeCredentials.save", { credentials_json: credentialsJson });
  return res.data as CredentialStatus;
}

export async function deleteCredentials(): Promise<void> {
  await client.post("/claudeCredentials.delete");
}

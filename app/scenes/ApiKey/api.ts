// ============================================================
// FILE: app/scenes/ApiKey/api.ts
// DESCRIPTION: API client functions for API Key management.
//   Requests go through the Node reverse-proxy mounted at `/python-api`,
//   which forwards to the Python FastAPI backend. Override VITE_BACKEND_URL
//   only for bespoke setups; default keeps the browser on the Outline origin.
// ============================================================

const BACKEND_BASE_URL: string =
  (import.meta.env.VITE_BACKEND_URL as string | undefined) ?? '/python-api';

// ============================================================
// SECTION 1: TypeScript Interfaces
// ============================================================

/** Public representation of a stored API key (key is masked). */
export interface ApiKeyRecord {
  id: string;
  key_masked: string;   // e.g. "AIzaSyD1...k9zX"
  label: string | null;
  created_at: string;   // ISO 8601 string
}

/** Response shape for GET /api/api-keys */
export interface ApiKeyListResponse {
  api_keys: ApiKeyRecord[];
}

// ============================================================
// SECTION 2: API Functions
// ============================================================

/**
 * Fetch all stored API keys (masked) from the FastAPI backend.
 * Corresponds to GET /api/api-keys
 */
export async function fetchApiKeys(): Promise<ApiKeyListResponse> {
  const response = await fetch(`${BACKEND_BASE_URL}/api/api-keys`);

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`[ApiKey] fetchApiKeys failed ${response.status}: ${text}`);
  }

  return response.json() as Promise<ApiKeyListResponse>;
}

/**
 * Add a new Gemini API key to the database.
 * Corresponds to POST /api/api-keys
 *
 * @param keyValue - The full Gemini API key string
 * @param label    - Optional human-readable name for the key
 * @returns The newly created key record (with masked key)
 */
export async function addApiKey(
  keyValue: string,
  label?: string,
): Promise<ApiKeyRecord> {
  const response = await fetch(`${BACKEND_BASE_URL}/api/api-keys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      key_value: keyValue,
      label: label ?? null,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({})) as { detail?: string };
    throw new Error(errorData.detail ?? response.statusText);
  }

  return response.json() as Promise<ApiKeyRecord>;
}

/**
 * Delete a stored API key by its ID.
 * Corresponds to DELETE /api/api-keys/{id}
 *
 * @param id - The UUID of the key to delete
 */
export async function deleteApiKey(id: string): Promise<void> {
  const response = await fetch(`${BACKEND_BASE_URL}/api/api-keys/${id}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({})) as { detail?: string };
    throw new Error(errorData.detail ?? response.statusText);
  }
}

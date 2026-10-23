import { useCallback, useEffect, useState } from 'react';

import type { ApiKeyRecord } from './api';
import { addApiKey, deleteApiKey, fetchApiKeys } from './api';

/**
 * ApiKeyScene — Full-page scene for managing Gemini API keys.
 * Accessed via /api-keys route (registered in authenticated.tsx).
 */
export default function ApiKeyScene(): JSX.Element {
  // ─────────────────────────────────────────────────────────
  // STATE
  // ─────────────────────────────────────────────────────────
  const [apiKeys, setApiKeys] = useState<ApiKeyRecord[]>([]);
  const [keyInput, setKeyInput] = useState<string>('');
  const [labelInput, setLabelInput] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [inputError, setInputError] = useState<string>('');
  const [saveSuccess, setSaveSuccess] = useState<boolean>(false);

  // ─────────────────────────────────────────────────────────
  // EFFECT: Load keys on mount
  // ─────────────────────────────────────────────────────────
  const loadKeys = useCallback(async (): Promise<void> => {
    try {
      setIsLoading(true);
      const data = await fetchApiKeys();
      setApiKeys(data.api_keys);
    } catch {
      // Silent fail — list stays empty, user can still add keys
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadKeys();
  }, [loadKeys]);

  // ─────────────────────────────────────────────────────────
  // HANDLER: Save new key
  // ─────────────────────────────────────────────────────────
  const handleSave = async (): Promise<void> => {
    const trimmedKey = keyInput.trim();
    if (!trimmedKey) {
      setInputError('API key must not be empty.');
      return;
    }

    setInputError('');
    setIsSaving(true);

    try {
      const trimmedLabel = labelInput.trim() || undefined;
      const newRecord = await addApiKey(trimmedKey, trimmedLabel);

      setApiKeys((prev) => [...prev, newRecord]);
      setKeyInput('');
      setLabelInput('');
      setSaveSuccess(true);
      // Hide success message after 3 seconds
      setTimeout(() => {
        setSaveSuccess(false);
      }, 3000);
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Failed to save API key.';
      setInputError(message);
    } finally {
      setIsSaving(false);
    }
  };

  // ─────────────────────────────────────────────────────────
  // HANDLER: Delete a key (optimistic update)
  // ─────────────────────────────────────────────────────────
  const handleDelete = async (id: string): Promise<void> => {
    const previous = apiKeys;
    setApiKeys((prev) => prev.filter((k) => k.id !== id));

    try {
      await deleteApiKey(id);
    } catch {
      // ROLLBACK: restore list if API call failed
      setApiKeys(previous);
    }
  };

  // ─────────────────────────────────────────────────────────
  // HANDLER: Save on Enter key
  // ─────────────────────────────────────────────────────────
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      void handleSave();
    }
  };

  // ─────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full w-full bg-white p-8 max-w-2xl mx-auto">

      {/* Page Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-gray-900 mb-2">API Keys</h1>
        <p className="text-sm text-gray-500">
          Add your Gemini API key to enable AI features.
        </p>
      </div>

      {/* Add New Key Form */}
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-6 mb-8">
        <h2 className="text-sm font-medium text-gray-700 mb-4">Add New API Key</h2>

        {/* Key value input */}
        <div className="mb-3">
          <label
            htmlFor="key-input"
            className="block text-xs font-medium text-gray-600 mb-1"
          >
            Gemini API Key <span className="text-red-500">*</span>
          </label>
          <input
            id="key-input"
            type="password"
            value={keyInput}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
              setKeyInput(e.target.value);
              if (inputError) { setInputError(''); }
            }}
            onKeyDown={handleKeyDown}
            placeholder="AIzaSy..."
            className={`w-full px-3 py-2 text-sm border rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 ${inputError ? 'border-red-400' : 'border-gray-300'
              }`}
            disabled={isSaving}
          />
          {inputError && (
            <p className="mt-1 text-xs text-red-500">{inputError}</p>
          )}
        </div>

        {/* Optional label input */}
        <div className="mb-4">
          <label
            htmlFor="label-input"
            className="block text-xs font-medium text-gray-600 mb-1"
          >
            Label <span className="text-gray-400">(optional)</span>
          </label>
          <input
            id="label-input"
            type="text"
            value={labelInput}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
              setLabelInput(e.target.value);
            }}
            placeholder="e.g. Production Key"
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={isSaving}
          />
        </div>

        {/* Save button + success feedback */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => { void handleSave(); }}
            disabled={isSaving}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 rounded-md transition-colors duration-200 cursor-pointer disabled:cursor-not-allowed"
          >
            {isSaving ? 'Saving...' : 'Save Key'}
          </button>
          {saveSuccess && (
            <span className="text-xs text-green-600 font-medium">
              Key saved successfully!
            </span>
          )}
        </div>
      </div>

      {/* Saved Keys List */}
      <div>
        <h2 className="text-sm font-medium text-gray-700 mb-3">Saved Keys</h2>

        {isLoading ? (
          <p className="text-sm text-gray-400">Loading...</p>
        ) : apiKeys.length === 0 ? (
          <p className="text-sm text-gray-400">
            No API keys saved yet. Add one above to enable AI features.
          </p>
        ) : (
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            {apiKeys.map((key: ApiKeyRecord, index: number) => (
              <div
                key={key.id}
                className={`flex items-center justify-between px-4 py-3 ${index !== apiKeys.length - 1 ? 'border-b border-gray-200' : ''
                  } ${index === 0 ? 'bg-blue-50' : 'bg-white'}`}
              >
                {/* Key info */}
                <div className="flex flex-col gap-0.5 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm text-gray-800">
                      {key.key_masked}
                    </span>
                    {index === 0 && (
                      <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-medium">
                        Active
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    {key.label !== null && (
                      <span className="text-xs text-gray-500 truncate">
                        {key.label}
                      </span>
                    )}
                    <span className="text-xs text-gray-400">
                      {new Date(key.created_at).toLocaleDateString()}
                    </span>
                  </div>
                </div>

                {/* Delete button */}
                <button
                  type="button"
                  onClick={() => { void handleDelete(key.id); }}
                  aria-label={`Delete key ${key.key_masked}`}
                  className="ml-4 p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors duration-200 cursor-pointer flex-shrink-0"
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                    <path d="M10 11v6M14 11v6" />
                    <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}

        {apiKeys.length > 0 && (
          <p className="mt-2 text-xs text-gray-400">
            The first key (marked Active) is used for all AI requests.
            Delete it to promote the next key.
          </p>
        )}
      </div>
    </div>
  );
}
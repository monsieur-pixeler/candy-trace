/**
 * Resolves the Google Gemini API key at runtime.
 *
 * Resolution order:
 *   1. A key the user entered in Settings (persisted in localStorage, this device only).
 *   2. A build-time key from `.env` (`GEMINI_API_KEY`) — convenient for local development.
 *
 * The key is never bundled into a distributed build unless the person building it
 * supplies one, and it is never transmitted anywhere except to Google's API.
 */

const STORAGE_KEY = 'candytrace.gemini.apiKey';

type Listener = (key: string | null) => void;
const listeners = new Set<Listener>();

/** The key baked in at build time, if the builder supplied one. May be undefined. */
function getBuildTimeKey(): string | null {
  try {
    const key = process.env.API_KEY;
    return typeof key === 'string' && key.trim() ? key.trim() : null;
  } catch {
    return null;
  }
}

function readStoredKey(): string | null {
  try {
    const key = window.localStorage.getItem(STORAGE_KEY);
    return key && key.trim() ? key.trim() : null;
  } catch {
    // localStorage can throw in private-browsing / restricted contexts.
    return null;
  }
}

export const apiKeyService = {
  /** The key to use for API calls, or null when none is configured. */
  get(): string | null {
    return readStoredKey() ?? getBuildTimeKey();
  },

  /** True when a key is available from either source. */
  isConfigured(): boolean {
    return apiKeyService.get() !== null;
  },

  /** Where the active key comes from — drives the Settings UI copy. */
  source(): 'user' | 'build' | 'none' {
    if (readStoredKey()) return 'user';
    if (getBuildTimeKey()) return 'build';
    return 'none';
  },

  /** Persist a user-supplied key on this device. Passing an empty value clears it. */
  set(key: string): void {
    const trimmed = key.trim();
    try {
      if (trimmed) {
        window.localStorage.setItem(STORAGE_KEY, trimmed);
      } else {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    } catch (e) {
      throw new Error(
        'Could not save the API key on this device. Browser storage is unavailable — check that private browsing or a storage-blocking setting is not enabled.',
      );
    }
    listeners.forEach((l) => l(apiKeyService.get()));
  },

  /** Remove the user-supplied key. A build-time key, if present, becomes active again. */
  clear(): void {
    apiKeyService.set('');
  },

  /** Show only the last 4 characters, for display in Settings. */
  masked(): string | null {
    const key = apiKeyService.get();
    if (!key) return null;
    return key.length <= 8 ? '••••' : `${'•'.repeat(Math.min(key.length - 4, 32))}${key.slice(-4)}`;
  },

  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  /**
   * The key, or a thrown error whose message tells the user exactly what to do.
   * Every Gemini call goes through this so a missing key can never reach the SDK —
   * without it the SDK silently falls back to ambient cloud credentials and reports a
   * misleading "insufficient authentication scopes" error.
   */
  require(): string {
    const key = apiKeyService.get();
    if (!key) {
      throw new Error(
        'No Gemini API key configured. Open Settings → API Key and paste a key from https://aistudio.google.com/apikey.',
      );
    }
    return key;
  },

  /**
   * Verify a key against the live API without spending image quota.
   * Returns a result object rather than throwing, so the UI can render it directly.
   */
  async verify(key: string): Promise<{ ok: boolean; error?: string; modelCount?: number }> {
    const trimmed = key.trim();
    if (!trimmed) return { ok: false, error: 'Enter a key first.' };

    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(trimmed)}&pageSize=1`,
      );
      if (res.ok) {
        const body = await res.json();
        return { ok: true, modelCount: Array.isArray(body.models) ? body.models.length : 0 };
      }
      const body = await res.json().catch(() => null);
      const message: string = body?.error?.message ?? `HTTP ${res.status}`;
      if (res.status === 400 || res.status === 403) {
        return { ok: false, error: `Key rejected by Google: ${message}` };
      }
      return { ok: false, error: message };
    } catch (e) {
      return {
        ok: false,
        error: `Could not reach the Gemini API: ${(e as Error).message}. Check your internet connection.`,
      };
    }
  },
};

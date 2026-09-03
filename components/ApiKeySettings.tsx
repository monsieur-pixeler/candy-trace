import * as React from 'react';
import { apiKeyService } from '../services/apiKeyService';
import { CheckIcon, ErrorIcon, InfoIcon, Spinner } from './icons';

type VerifyState =
  | { status: 'idle' }
  | { status: 'verifying' }
  | { status: 'ok'; message: string }
  | { status: 'error'; message: string };

/**
 * Lets the user supply their own Gemini API key, stored on this device only.
 * Without this, the key could only be baked in at build time — which would ship
 * the builder's key to every user of a packaged app.
 */
export const ApiKeySettings: React.FC = () => {
  const [draft, setDraft] = React.useState('');
  const [source, setSource] = React.useState(apiKeyService.source());
  const [masked, setMasked] = React.useState(apiKeyService.masked());
  const [reveal, setReveal] = React.useState(false);
  const [verify, setVerify] = React.useState<VerifyState>({ status: 'idle' });

  const refresh = React.useCallback(() => {
    setSource(apiKeyService.source());
    setMasked(apiKeyService.masked());
  }, []);

  const handleSave = React.useCallback(async () => {
    setVerify({ status: 'verifying' });
    const result = await apiKeyService.verify(draft);

    if (!result.ok) {
      setVerify({ status: 'error', message: result.error || 'The key could not be verified.' });
      return;
    }

    try {
      apiKeyService.set(draft);
    } catch (e) {
      setVerify({ status: 'error', message: (e as Error).message });
      return;
    }

    setDraft('');
    refresh();
    setVerify({ status: 'ok', message: 'Key verified and saved on this device.' });
  }, [draft, refresh]);

  const handleClear = React.useCallback(() => {
    apiKeyService.clear();
    setDraft('');
    setVerify({ status: 'idle' });
    refresh();
  }, [refresh]);

  return (
    <div className="space-y-8">
      <div>
        <h3 className="text-lg font-medium leading-6 text-gray-900">Gemini API Key</h3>
        <p className="mt-1 text-sm text-gray-500">
          Candy Trace calls the Google Gemini API directly from this app. Your key is stored in this
          browser&rsquo;s local storage on this device only — it is never sent anywhere except to
          Google.
        </p>

        <div className="mt-4 rounded-md border p-4" role="status">
          {source === 'none' && (
            <div className="flex items-start gap-3">
              <ErrorIcon className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-500" />
              <div>
                <p className="text-sm font-medium text-gray-900">No API key configured</p>
                <p className="mt-1 text-sm text-gray-600">
                  Image generation, classification and side comparison will all fail until you add a
                  key below.
                </p>
              </div>
            </div>
          )}
          {source === 'user' && (
            <div className="flex items-start gap-3">
              <CheckIcon className="mt-0.5 h-5 w-5 flex-shrink-0 text-green-500" />
              <div>
                <p className="text-sm font-medium text-gray-900">
                  Key configured on this device{' '}
                  <span className="font-mono text-gray-500">({masked})</span>
                </p>
                <p className="mt-1 text-sm text-gray-600">Saved in local storage.</p>
              </div>
            </div>
          )}
          {source === 'build' && (
            <div className="flex items-start gap-3">
              <InfoIcon className="mt-0.5 h-5 w-5 flex-shrink-0 text-blue-500" />
              <div>
                <p className="text-sm font-medium text-gray-900">
                  Using a key from the build environment{' '}
                  <span className="font-mono text-gray-500">({masked})</span>
                </p>
                <p className="mt-1 text-sm text-gray-600">
                  This key came from a <code className="rounded bg-gray-100 px-1">.env</code> file at
                  build time. Entering a key below overrides it for this device.
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="mt-4 space-y-3">
          <label htmlFor="geminiApiKey" className="block text-sm font-medium text-gray-700">
            {source === 'none' ? 'Paste your API key' : 'Replace the key'}
          </label>
          <div className="flex gap-2">
            <input
              id="geminiApiKey"
              type={reveal ? 'text' : 'password'}
              value={draft}
              autoComplete="off"
              spellCheck={false}
              placeholder="AIza…"
              onChange={(e) => {
                setDraft(e.target.value);
                setVerify({ status: 'idle' });
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && draft.trim()) handleSave();
              }}
              aria-describedby="geminiApiKeyHelp"
              className="block w-full rounded-md border-gray-300 font-mono text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500"
            />
            <button
              type="button"
              onClick={() => setReveal((v) => !v)}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              {reveal ? 'Hide' : 'Show'}
            </button>
          </div>

          <p id="geminiApiKeyHelp" className="text-sm text-gray-500">
            Create a key at{' '}
            <a
              href="https://aistudio.google.com/apikey"
              target="_blank"
              rel="noreferrer"
              className="text-blue-600 underline hover:text-blue-500"
            >
              aistudio.google.com/apikey
            </a>
            . Image generation requires a project with billing enabled — the free tier has no image
            quota.
          </p>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleSave}
              disabled={!draft.trim() || verify.status === 'verifying'}
              className="inline-flex items-center rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 disabled:bg-gray-300"
            >
              {verify.status === 'verifying' ? <Spinner className="mr-2 h-5 w-5" /> : null}
              Verify &amp; Save
            </button>
            {source === 'user' && (
              <button
                type="button"
                onClick={handleClear}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Remove saved key
              </button>
            )}
          </div>

          {verify.status === 'ok' && (
            <p className="flex items-start gap-2 text-sm text-green-700" role="status">
              <CheckIcon className="mt-0.5 h-4 w-4 flex-shrink-0" />
              {verify.message}
            </p>
          )}
          {verify.status === 'error' && (
            <p className="flex items-start gap-2 text-sm text-red-700" role="alert">
              <ErrorIcon className="mt-0.5 h-4 w-4 flex-shrink-0" />
              {verify.message}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

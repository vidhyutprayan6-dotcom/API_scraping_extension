import type { CapturedRequest, LoggerSettings } from '../shared/types';
import { API_KINDS } from '../shared/types';
import { truncateBody } from '../shared/logApi';

const SOURCE = 'api-request-logger-inject';

let settingsCache: LoggerSettings | null = null;

async function refreshSettings(): Promise<void> {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
    if (response?.settings) settingsCache = response.settings;
  } catch {
    /* extension context may be invalidated */
  }
}

void refreshSettings();
setInterval(() => {
  void refreshSettings();
}, 5000);

window.addEventListener('message', (event: MessageEvent) => {
  if (event.source !== window) return;
  const data = event.data;
  if (!data || data.source !== SOURCE || !data.payload) return;

  void (async () => {
    const payload = data.payload as CapturedRequest;
    if (!API_KINDS.includes(payload.kind)) return;

    if (!settingsCache) await refreshSettings();
    const settings = settingsCache;
    if (settings && !settings.enabled) return;

    const maxChars = settings?.maxBodyChars ?? 50_000;
    const captureBodies = settings?.captureBodies ?? true;

    const entry: CapturedRequest = {
      ...payload,
      requestBody: captureBodies
        ? truncateBody(payload.requestBody, maxChars)
        : undefined,
      responseBody: captureBodies
        ? truncateBody(payload.responseBody, maxChars)
        : undefined,
    };

    try {
      await chrome.runtime.sendMessage({ type: 'LOG_REQUEST', payload: entry });
    } catch {
      /* ignore when background unavailable */
    }
  })();
});

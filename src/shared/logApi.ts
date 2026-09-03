import {
  API_KINDS,
  CapturedRequest,
  DEFAULT_SETTINGS,
  LoggerSettings,
  LOG_SERVER_BASE,
} from './types';

export { LOG_SERVER_BASE };

async function request<T>(
  path: string,
  init?: RequestInit,
): Promise<T & { ok?: boolean; error?: string }> {
  const response = await fetch(`${LOG_SERVER_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  const data = (await response.json()) as T & {
    ok?: boolean;
    error?: string;
  };
  if (!response.ok || data.ok === false) {
    throw new Error(data.error || `Log server error (${response.status})`);
  }
  return data;
}

export async function pingLogServer(): Promise<{
  ok: boolean;
  logDir?: string;
  requestsFile?: string;
}> {
  try {
    return await request('/health');
  } catch {
    return { ok: false };
  }
}

export async function getLogs(): Promise<CapturedRequest[]> {
  const data = await request<{ logs: CapturedRequest[] }>('/logs');
  return (data.logs ?? []).filter((log) =>
    API_KINDS.includes(log.kind as (typeof API_KINDS)[number]),
  );
}

export async function appendLogRemote(
  entry: CapturedRequest,
): Promise<number> {
  const data = await request<{ total: number }>('/logs', {
    method: 'POST',
    body: JSON.stringify({ entry }),
  });
  return data.total ?? 0;
}

export async function clearLogs(): Promise<void> {
  await request('/logs', { method: 'DELETE' });
}

export async function getSettings(): Promise<LoggerSettings> {
  try {
    const data = await request<{ settings: LoggerSettings }>('/settings');
    return { ...DEFAULT_SETTINGS, ...(data.settings ?? {}) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(
  settings: Partial<LoggerSettings>,
): Promise<LoggerSettings> {
  const data = await request<{ settings: LoggerSettings }>('/settings', {
    method: 'PUT',
    body: JSON.stringify({ settings }),
  });
  return { ...DEFAULT_SETTINGS, ...(data.settings ?? {}) };
}

export async function exportLogsRemote(
  format: 'json' | 'txt',
): Promise<{ file: string; filename: string }> {
  const data = await request<{ file: string; filename: string }>('/export', {
    method: 'POST',
    body: JSON.stringify({ format }),
  });
  return { file: data.file, filename: data.filename };
}

export function hostMatches(url: string, targetHosts: string[]): boolean {
  if (!targetHosts.length) return true;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return targetHosts.some((pattern) => {
      const p = pattern.trim().toLowerCase();
      if (!p) return false;
      if (p.startsWith('*.')) {
        const suffix = p.slice(1);
        return host.endsWith(suffix) || host === p.slice(2);
      }
      return host === p || host.endsWith(`.${p}`);
    });
  } catch {
    return false;
  }
}

export function truncateBody(
  value: unknown,
  maxChars: number,
): string | undefined {
  if (value == null) return undefined;
  let text: string;
  if (typeof value === 'string') {
    text = value;
  } else {
    try {
      text = JSON.stringify(value, null, 2);
    } catch {
      text = String(value);
    }
  }
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n… [truncated ${text.length - maxChars} chars]`;
}

export function buildJsonDocument(logs: CapturedRequest[]): string {
  return JSON.stringify(
    {
      version: 1,
      updatedAt: new Date().toISOString(),
      total: logs.length,
      requests: logs,
    },
    null,
    2,
  );
}

export type RequestKind = 'fetch' | 'xhr';

export type MessageDirection = 'outgoing' | 'incoming' | 'bidirectional';

export type HttpMethod =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'
  | 'HEAD'
  | 'OPTIONS'
  | 'CONNECT'
  | 'TRACE'
  | 'OTHER';

export interface CapturedRequest {
  id: string;
  kind: RequestKind;
  method: HttpMethod | string;
  url: string;
  origin: string;
  tabId?: number;
  tabTitle?: string;
  status?: number | string;
  statusText?: string;
  direction: MessageDirection;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  requestBody?: string;
  responseBody?: string;
  error?: string;
  durationMs?: number;
  timestamp: number;
  mimeType?: string;
  initiator?: string;
  meta?: Record<string, unknown>;
}

export interface LoggerSettings {
  enabled: boolean;
  captureBodies: boolean;
  maxBodyChars: number;
  maxEntries: number;
  targetHosts: string[];
  theme: 'light' | 'dark' | 'system';
}

export interface ExtensionMessage {
  type:
    | 'LOG_REQUEST'
    | 'GET_LOGS'
    | 'CLEAR_LOGS'
    | 'EXPORT_LOGS'
    | 'GET_SETTINGS'
    | 'UPDATE_SETTINGS'
    | 'GET_ACTIVE_TAB'
    | 'GET_SERVER_STATUS'
    | 'PING';
  payload?: unknown;
}

export const DEFAULT_SETTINGS: LoggerSettings = {
  enabled: true,
  captureBodies: true,
  maxBodyChars: 50_000,
  maxEntries: 5_000,
  targetHosts: [],
  theme: 'system',
};

/** Local file server that writes into the extension project's `log/` folder. */
export const LOG_SERVER_BASE = 'http://127.0.0.1:3921';

/** Only these kinds are considered basic API requests. */
export const API_KINDS: RequestKind[] = ['fetch', 'xhr'];

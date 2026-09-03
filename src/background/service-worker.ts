import {
  API_KINDS,
  CapturedRequest,
  ExtensionMessage,
  LoggerSettings,
} from '../shared/types';
import {
  appendLogRemote,
  clearLogs,
  exportLogsRemote,
  getLogs,
  getSettings,
  hostMatches,
  pingLogServer,
  saveSettings,
} from '../shared/logApi';

const tabCache = new Map<number, string>();
let activeTabId: number | null = null;

async function refreshActiveTab(): Promise<number | null> {
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true,
    });
    activeTabId = tab?.id ?? null;
    if (activeTabId != null && tab?.title) {
      tabCache.set(activeTabId, tab.title);
    }
  } catch {
    /* ignore */
  }
  return activeTabId;
}

async function isActiveTab(tabId: number | undefined | null): Promise<boolean> {
  if (tabId == null || tabId < 0) return false;
  if (activeTabId == null) await refreshActiveTab();
  return activeTabId === tabId;
}

async function appendLog(entry: CapturedRequest): Promise<void> {
  const settings = await getSettings();
  if (!settings.enabled) return;
  if (!API_KINDS.includes(entry.kind)) return;
  if (!hostMatches(entry.url, settings.targetHosts)) return;
  if (!(await isActiveTab(entry.tabId))) return;

  await appendLogRemote(entry);
}

chrome.runtime.onInstalled.addListener(() => {
  void refreshActiveTab();
});

chrome.runtime.onStartup.addListener(() => {
  void refreshActiveTab();
});

void refreshActiveTab();

chrome.tabs.onActivated.addListener((activeInfo) => {
  activeTabId = activeInfo.tabId;
  void chrome.tabs.get(activeInfo.tabId).then((tab) => {
    if (tab.title) tabCache.set(activeInfo.tabId, tab.title);
  });
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  void refreshActiveTab();
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.title || tab.title) {
    tabCache.set(tabId, changeInfo.title ?? tab.title ?? '');
  }
  if (tab.active && changeInfo.status === 'complete') {
    activeTabId = tabId;
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabCache.delete(tabId);
  if (activeTabId === tabId) {
    void refreshActiveTab();
  }
});

chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, sender, sendResponse) => {
    void (async () => {
      try {
        switch (message.type) {
          case 'LOG_REQUEST': {
            const payload = message.payload as CapturedRequest;
            if (!API_KINDS.includes(payload.kind)) {
              sendResponse({ ok: true, skipped: 'non-api' });
              break;
            }
            if (sender.tab?.id == null) {
              sendResponse({ ok: true, skipped: 'no-tab' });
              break;
            }
            payload.tabId = sender.tab.id;
            payload.tabTitle =
              sender.tab.title ?? tabCache.get(sender.tab.id);
            tabCache.set(
              sender.tab.id,
              payload.tabTitle ?? tabCache.get(sender.tab.id) ?? '',
            );
            await appendLog(payload);
            sendResponse({ ok: true });
            break;
          }
          case 'GET_LOGS': {
            sendResponse({ ok: true, logs: await getLogs() });
            break;
          }
          case 'CLEAR_LOGS': {
            await clearLogs();
            sendResponse({ ok: true });
            break;
          }
          case 'EXPORT_LOGS': {
            const format =
              (message.payload as { format?: 'json' | 'txt' })?.format ??
              'json';
            const result = await exportLogsRemote(format);
            sendResponse({ ok: true, ...result });
            break;
          }
          case 'GET_SETTINGS': {
            sendResponse({
              ok: true,
              settings: await getSettings(),
              activeTabId,
              server: await pingLogServer(),
            });
            break;
          }
          case 'UPDATE_SETTINGS': {
            const next = await saveSettings(
              message.payload as Partial<LoggerSettings>,
            );
            sendResponse({
              ok: true,
              settings: next,
              activeTabId,
              server: await pingLogServer(),
            });
            break;
          }
          case 'GET_ACTIVE_TAB': {
            await refreshActiveTab();
            sendResponse({ ok: true, activeTabId });
            break;
          }
          case 'GET_SERVER_STATUS': {
            sendResponse({ ok: true, server: await pingLogServer() });
            break;
          }
          case 'PING': {
            sendResponse({
              ok: true,
              activeTabId,
              server: await pingLogServer(),
            });
            break;
          }
          default:
            sendResponse({ ok: false, error: 'Unknown message' });
        }
      } catch (error) {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })();
    return true;
  },
);

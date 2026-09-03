import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'log');
const REQUESTS_FILE = path.join(LOG_DIR, 'captured-requests.json');
const SETTINGS_FILE = path.join(LOG_DIR, 'settings.json');
const PORT = Number(process.env.API_LOGGER_PORT || 3921);

const DEFAULT_SETTINGS = {
  enabled: true,
  captureBodies: true,
  maxBodyChars: 50_000,
  maxEntries: 5_000,
  targetHosts: [],
  theme: 'system',
};

function buildDocument(logs) {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    total: logs.length,
    requests: logs,
  };
}

async function ensureLogDir() {
  await fs.mkdir(LOG_DIR, { recursive: true });
}

async function readJson(file, fallback) {
  try {
    const raw = await fs.readFile(file, 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function writeJson(file, data) {
  await ensureLogDir();
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await fs.rename(tmp, file);
}

async function getLogs() {
  const doc = await readJson(REQUESTS_FILE, buildDocument([]));
  return Array.isArray(doc.requests) ? doc.requests : [];
}

async function saveLogs(logs) {
  await writeJson(REQUESTS_FILE, buildDocument(logs));
}

async function getSettings() {
  const stored = await readJson(SETTINGS_FILE, {});
  return { ...DEFAULT_SETTINGS, ...stored };
}

async function saveSettings(patch) {
  const next = { ...(await getSettings()), ...patch };
  await writeJson(SETTINGS_FILE, next);
  return next;
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return null;
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return null;
  return JSON.parse(text);
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') {
      sendJson(res, 204, {});
      return;
    }

    const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);

    if (req.method === 'GET' && url.pathname === '/health') {
      sendJson(res, 200, {
        ok: true,
        logDir: LOG_DIR,
        requestsFile: REQUESTS_FILE,
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/logs') {
      const logs = await getLogs();
      sendJson(res, 200, { ok: true, logs, file: REQUESTS_FILE });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/logs') {
      const body = await readBody(req);
      const entry = body?.entry;
      if (!entry || typeof entry !== 'object') {
        sendJson(res, 400, { ok: false, error: 'Missing entry' });
        return;
      }
      const settings = await getSettings();
      const logs = await getLogs();
      logs.unshift(entry);
      const trimmed = logs.slice(0, settings.maxEntries || 5000);
      await saveLogs(trimmed);
      sendJson(res, 200, {
        ok: true,
        total: trimmed.length,
        file: REQUESTS_FILE,
      });
      return;
    }

    if (req.method === 'PUT' && url.pathname === '/logs') {
      const body = await readBody(req);
      const logs = Array.isArray(body?.logs) ? body.logs : [];
      await saveLogs(logs);
      sendJson(res, 200, { ok: true, total: logs.length, file: REQUESTS_FILE });
      return;
    }

    if (req.method === 'DELETE' && url.pathname === '/logs') {
      await saveLogs([]);
      sendJson(res, 200, { ok: true, total: 0, file: REQUESTS_FILE });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/settings') {
      sendJson(res, 200, { ok: true, settings: await getSettings() });
      return;
    }

    if (req.method === 'PUT' && url.pathname === '/settings') {
      const body = await readBody(req);
      const settings = await saveSettings(body?.settings ?? body ?? {});
      sendJson(res, 200, { ok: true, settings });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/export') {
      const body = await readBody(req);
      const format = body?.format === 'txt' ? 'txt' : 'json';
      const logs = await getLogs();
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename =
        format === 'txt'
          ? `export-${stamp}.txt`
          : `export-${stamp}.json`;
      const filePath = path.join(LOG_DIR, filename);

      let content;
      if (format === 'txt') {
        content = logs
          .map((log) => {
            return [
              `-`.repeat(80),
              `[${new Date(log.timestamp).toISOString()}] ${String(log.kind).toUpperCase()}`,
              `Method: ${log.method}`,
              `URL: ${log.url}`,
              `Status: ${log.status ?? ''}`,
              log.requestBody ? `Request Body:\n${log.requestBody}` : '',
              log.responseBody ? `Response Body:\n${log.responseBody}` : '',
              '',
            ]
              .filter(Boolean)
              .join('\n');
          })
          .join('\n');
      } else {
        content = JSON.stringify(buildDocument(logs), null, 2);
      }

      await ensureLogDir();
      await fs.writeFile(filePath, content, 'utf8');
      sendJson(res, 200, { ok: true, file: filePath, filename });
      return;
    }

    sendJson(res, 404, { ok: false, error: 'Not found' });
  } catch (error) {
    sendJson(res, 500, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

await ensureLogDir();
if (!(await readJson(REQUESTS_FILE, null))) {
  await saveLogs([]);
}
if (!(await readJson(SETTINGS_FILE, null))) {
  await saveSettings(DEFAULT_SETTINGS);
}

server.listen(PORT, '127.0.0.1', () => {
  console.log(`API Request Logger file server running on http://127.0.0.1:${PORT}`);
  console.log(`Writing logs to: ${LOG_DIR}`);
  console.log(`  - ${REQUESTS_FILE}`);
  console.log(`  - ${SETTINGS_FILE}`);
});

# API Request Logger Extension

Captures **Fetch / XHR** from the **active tab** and writes JSON into the project `log/` folder.

> Chrome extensions cannot write files into their own package directory. This project uses a small local file server so data lands in `log/` on disk — **not** in Chrome storage on the host browser.

## Setup

```bash
npm install
npm run build
npm run log-server
```

Leave `npm run log-server` running. It writes to:

- `log/captured-requests.json`
- `log/settings.json`

Then load `dist/` as an unpacked extension in Chrome.

## Notes

- No Chrome `storage` persistence for captured requests
- Socket/WebSocket traffic is ignored
- Only the currently focused tab is recorded

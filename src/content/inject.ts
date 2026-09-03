/**
 * MAIN-world interceptor for basic API traffic: fetch and XHR only.
 * WebSocket / socket traffic is intentionally not captured.
 */
(() => {
  const SOURCE = 'api-request-logger-inject';

  const post = (payload: Record<string, unknown>) => {
    window.postMessage({ source: SOURCE, payload }, '*');
  };

  const createId = () =>
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

  const headersToObject = (
    headers?: HeadersInit | null,
  ): Record<string, string> | undefined => {
    if (!headers) return undefined;
    const out: Record<string, string> = {};
    if (headers instanceof Headers) {
      headers.forEach((v, k) => {
        out[k] = v;
      });
    } else if (Array.isArray(headers)) {
      for (const [k, v] of headers) out[k] = String(v);
    } else {
      Object.assign(out, headers);
    }
    return Object.keys(out).length ? out : undefined;
  };

  const decodeBuffer = (data: ArrayBuffer | ArrayBufferView): string => {
    try {
      return new TextDecoder().decode(data);
    } catch {
      return `[binary ${data.byteLength} bytes]`;
    }
  };

  const bodyToString = async (body: BodyInit | null | undefined) => {
    if (body == null) return undefined;
    if (typeof body === 'string') return body;
    if (body instanceof URLSearchParams) return body.toString();
    if (typeof FormData !== 'undefined' && body instanceof FormData) {
      const entries: Record<string, string> = {};
      body.forEach((value, key) => {
        entries[key] =
          typeof value === 'string' ? value : `[File:${value.name}]`;
      });
      return JSON.stringify(entries);
    }
    if (body instanceof Blob) {
      try {
        return await body.text();
      } catch {
        return `[Blob ${body.type || 'unknown'} ${body.size} bytes]`;
      }
    }
    if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
      return decodeBuffer(body as ArrayBuffer | ArrayBufferView);
    }
    try {
      return String(body);
    } catch {
      return '[unserializable body]';
    }
  };

  const safeUrl = (input: RequestInfo | URL): string => {
    if (typeof input === 'string') return input;
    if (input instanceof URL) return input.href;
    return input.url;
  };

  // ---- fetch ----
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const id = createId();
    const started = performance.now();
    const url = safeUrl(input);
    const method =
      init?.method ??
      (typeof input !== 'string' && !(input instanceof URL)
        ? input.method
        : 'GET');

    let requestBody: string | undefined;
    try {
      requestBody = await bodyToString(init?.body ?? null);
      if (
        !requestBody &&
        typeof input !== 'string' &&
        !(input instanceof URL)
      ) {
        try {
          requestBody = await input.clone().text();
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* ignore */
    }

    const requestHeaders =
      headersToObject(init?.headers) ??
      (typeof input !== 'string' && !(input instanceof URL)
        ? headersToObject(input.headers)
        : undefined);

    try {
      const response = await originalFetch(input, init);
      const clone = response.clone();
      let responseBody: string | undefined;
      try {
        responseBody = await clone.text();
      } catch {
        responseBody = '[unable to read response body]';
      }

      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((v, k) => {
        responseHeaders[k] = v;
      });

      post({
        id,
        kind: 'fetch',
        method: (method || 'GET').toUpperCase(),
        url,
        origin: location.origin,
        status: response.status,
        statusText: response.statusText,
        direction: 'bidirectional',
        requestHeaders,
        responseHeaders,
        requestBody,
        responseBody,
        durationMs: Math.round(performance.now() - started),
        timestamp: Date.now(),
        mimeType: response.headers.get('content-type') ?? undefined,
      });

      return response;
    } catch (error) {
      post({
        id,
        kind: 'fetch',
        method: (method || 'GET').toUpperCase(),
        url,
        origin: location.origin,
        direction: 'outgoing',
        requestHeaders,
        requestBody,
        error: error instanceof Error ? error.message : String(error),
        durationMs: Math.round(performance.now() - started),
        timestamp: Date.now(),
      });
      throw error;
    }
  };

  // ---- XHR ----
  const XHR = XMLHttpRequest.prototype;
  const open = XHR.open;
  const send = XHR.send;
  const setRequestHeader = XHR.setRequestHeader;

  type XhrMeta = {
    id: string;
    method: string;
    url: string;
    started: number;
    headers: Record<string, string>;
  };

  const xhrMap = new WeakMap<XMLHttpRequest, XhrMeta>();

  XHR.open = function patchedOpen(
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    async?: boolean,
    username?: string | null,
    password?: string | null,
  ) {
    xhrMap.set(this, {
      id: createId(),
      method: String(method).toUpperCase(),
      url: String(url),
      started: 0,
      headers: {},
    });
    return open.call(
      this,
      method,
      url,
      async !== false,
      username,
      password,
    );
  };

  XHR.setRequestHeader = function patchedSetHeader(
    this: XMLHttpRequest,
    name: string,
    value: string,
  ) {
    const meta = xhrMap.get(this);
    if (meta) meta.headers[name] = value;
    return setRequestHeader.call(this, name, value);
  };

  XHR.send = function patchedSend(
    this: XMLHttpRequest,
    body?: Document | XMLHttpRequestBodyInit | null,
  ) {
    const meta = xhrMap.get(this);
    if (!meta) return send.call(this, body);

    meta.started = performance.now();
    void bodyToString((body as BodyInit | null) ?? null).then((requestBody) => {
      const onDone = () => {
        post({
          id: meta.id,
          kind: 'xhr',
          method: meta.method,
          url: meta.url,
          origin: location.origin,
          status: this.status,
          statusText: this.statusText,
          direction: 'bidirectional',
          requestHeaders: meta.headers,
          requestBody,
          responseBody:
            typeof this.responseText === 'string'
              ? this.responseText
              : String(this.response ?? ''),
          durationMs: Math.round(performance.now() - meta.started),
          timestamp: Date.now(),
          mimeType: this.getResponseHeader('content-type') ?? undefined,
        });
      };

      this.addEventListener('loadend', onDone, { once: true });
      this.addEventListener(
        'error',
        () => {
          post({
            id: meta.id,
            kind: 'xhr',
            method: meta.method,
            url: meta.url,
            origin: location.origin,
            direction: 'outgoing',
            requestHeaders: meta.headers,
            requestBody,
            error: 'XHR network error',
            durationMs: Math.round(performance.now() - meta.started),
            timestamp: Date.now(),
          });
        },
        { once: true },
      );
    });

    return send.call(this, body);
  };
})();

/** Minimal fetch wrapper: timeout, bounded retry with jitter, JSON/SSE handling. */

import { logger } from './log.mjs';

const log = logger('http');

export class HttpError extends Error {
  constructor(message, { status, url, body } = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.url = url;
    this.body = body;
  }
}

export async function fetchWithTimeout(url, options = {}, timeoutMs = 30000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchJson(url, { method = 'GET', headers = {}, body, timeoutMs = 30000, retries = 2 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const res = await fetchWithTimeout(url, {
        method,
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...headers },
        body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
        timeoutMs,
      }, timeoutMs);
      const text = await res.text();
      if (!res.ok) {
        throw new HttpError(`HTTP ${res.status} for ${method} ${url}`, { status: res.status, url, body: text.slice(0, 500) });
      }
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    } catch (err) {
      lastErr = err;
      const retryable = err.name === 'AbortError' || !err.status || err.status >= 500 || err.status === 429;
      if (!retryable || attempt === retries) break;
      const wait = Math.min(4000, 250 * 2 ** attempt) + Math.random() * 150;
      log.debug(`retry ${attempt + 1}/${retries} in ${Math.round(wait)}ms: ${err.message}`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

/** Read an SSE stream, invoking onEvent for each parsed `data:` payload. */
export async function readSse(response, onEvent) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const dataLines = chunk.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim());
      if (!dataLines.length) continue;
      const payload = dataLines.join('\n');
      if (payload === '[DONE]') return;
      try {
        onEvent(JSON.parse(payload));
      } catch {
        onEvent({ raw: payload });
      }
    }
  }
}

export function sseFrame(event, data) {
  const e = event ? `event: ${event}\n` : '';
  return `${e}data: ${JSON.stringify(data)}\n\n`;
}
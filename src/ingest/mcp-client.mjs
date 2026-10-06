/**
 * Minimal Model Context Protocol client for the Streamable HTTP transport.
 *
 * Targets Bitget's public US-equity MCP server (https://agent.bitget.com/mcp),
 * which needs no Bitget account and no API key. Works with any other
 * Streamable-HTTP MCP server too.
 *
 * Implemented by hand (no SDK dependency) so `npm i` is never required.
 */

import { logger } from '../util/log.mjs';
import { fetchWithTimeout } from '../util/http.mjs';

const log = logger('mcp');

export class McpError extends Error {
  constructor(message, extra = {}) {
    super(message);
    this.name = 'McpError';
    Object.assign(this, extra);
  }
}

export class McpClient {
  /**
   * @param {object} opts
   * @param {string} opts.url            MCP endpoint
   * @param {number} [opts.timeoutMs]
   * @param {object} [opts.headers]      extra headers (auth tokens etc.)
   * @param {string} [opts.clientName]
   */
  constructor({ url, timeoutMs = 25000, headers = {}, clientName = 'prism-desk', clientVersion = '1.0.0' }) {
    this.url = url;
    this.timeoutMs = timeoutMs;
    this.headers = headers;
    this.clientInfo = { name: clientName, version: clientVersion };
    this.sessionId = null;
    this.nextId = 1;
    this.initialized = false;
    this.serverInfo = null;
    this.tools = [];
    this._toolsByName = new Map();
  }

  async _post(payload, { expectResponse = true, accept = 'application/json, text/event-stream' } = {}) {
    const headers = {
      'Content-Type': 'application/json',
      Accept: accept,
      ...this.headers,
    };
    if (this.sessionId) headers['Mcp-Session-Id'] = this.sessionId;

    const res = await fetchWithTimeout(this.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    }, this.timeoutMs);

    const sid = res.headers.get('mcp-session-id');
    if (sid) this.sessionId = sid;

    if (!expectResponse) {
      await res.body?.cancel?.().catch(() => {});
      if (!res.ok && res.status !== 202) {
        throw new McpError(`notification rejected: HTTP ${res.status}`, { status: res.status });
      }
      return null;
    }

    const text = await res.text();
    if (!res.ok) {
      throw new McpError(`MCP HTTP ${res.status}`, { status: res.status, body: text.slice(0, 400) });
    }
    if (!text.trim()) return null;

    const ctype = (res.headers.get('content-type') || '').toLowerCase();
    if (ctype.includes('text/event-stream')) {
      // Parse SSE frames, return the last JSON-RPC response.
      let last = null;
      for (const block of text.split(/\n\n+/)) {
        const data = block.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('\n');
        if (!data) continue;
        try {
          const parsed = JSON.parse(data);
          if (parsed.jsonrpc) last = parsed;
        } catch { /* keep-alive or partial frame */ }
      }
      return last;
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new McpError('MCP returned non-JSON body', { body: text.slice(0, 300) });
    }
  }

  async _request(method, params) {
    const id = this.nextId++;
    const res = await this._post({ jsonrpc: '2.0', id, method, params });
    if (!res) throw new McpError(`no response for ${method}`, { method });
    if (res.error) throw new McpError(`MCP error on ${method}: ${res.error.message || res.error.code}`, { method, error: res.error });
    return res.result;
  }

  /** Full handshake: initialize -> notifications/initialized -> tools/list. */
  async connect() {
    if (this.initialized) return this;
    const result = await this._request('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: { tools: {} },
      clientInfo: this.clientInfo,
    });
    this.serverInfo = result?.serverInfo ?? null;
    this.protocolVersion = result?.protocolVersion ?? null;
    await this._post({ jsonrpc: '2.0', method: 'notifications/initialized' }, { expectResponse: false }).catch(() => {});
    this.initialized = true;
    await this.listTools();
    log.info(`connected to ${this.url} (${this.tools.length} tools) server=${this.serverInfo?.name ?? 'unknown'}`);
    return this;
  }

  async listTools() {
    const all = [];
    let cursor;
    do {
      const res = await this._request('tools/list', cursor ? { cursor } : {});
      all.push(...(res?.tools ?? []));
      cursor = res?.nextCursor;
    } while (cursor);
    this.tools = all;
    this._toolsByName = new Map(all.map((t) => [t.name, t]));
    return all;
  }

  /** Call a tool, unwrapping MCP content blocks into { text, json, structured }. */
  async callTool(name, args = {}) {
    if (!this.initialized) await this.connect();
    const result = await this._request('tools/call', { name, arguments: args });
    if (result?.isError) {
      const msg = (result.content || []).map((c) => c.text || '').join('\n').slice(0, 400);
      throw new McpError(`tool ${name} returned an error: ${msg}`, { tool: name });
    }
    return unwrapToolResult(result);
  }

  hasTool(name) {
    return this._toolsByName.has(name);
  }

  tool(name) {
    return this._toolsByName.get(name) ?? null;
  }

  /** Names of all discovered tools - useful for the /api/tools diagnostic endpoint. */
  toolNames() {
    return this.tools.map((t) => t.name);
  }

  async close() {
    if (!this.sessionId) return;
    try {
      await fetchWithTimeout(this.url, {
        method: 'DELETE',
        headers: { 'Mcp-Session-Id': this.sessionId, ...this.headers },
      }, 5000);
    } catch { /* best effort */ }
    this.sessionId = null;
    this.initialized = false;
  }
}

/** MCP tool results arrive as content blocks; normalise them for downstream code. */
export function unwrapToolResult(result) {
  const content = result?.content ?? [];
  const texts = [];
  for (const block of content) {
    if (block.type === 'text' && typeof block.text === 'string') texts.push(block.text);
    else if (block.type === 'resource' && block.resource?.text) texts.push(block.resource.text);
  }
  const text = texts.join('\n');
  let json = result?.structuredContent ?? null;
  if (json === null && text) {
    try { json = JSON.parse(text); } catch { json = null; }
  }
  return { text, json, structured: result?.structuredContent ?? null, raw: result };
}

export default McpClient;
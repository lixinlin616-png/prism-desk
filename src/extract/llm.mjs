/**
 * OpenAI-compatible chat client.
 *
 * Works with any endpoint that speaks the /chat/completions shape, including
 * the Bitget Hackathon Qwen grant gateway:
 *   PRISM_LLM_BASE_URL=https://hackathon.bitgetops.com/v1
 *   PRISM_LLM_MODEL=qwen3.8-max
 *
 * When no key is configured the client reports `available === false` and the
 * pipeline transparently switches to the deterministic rule extractor, so the
 * demo is reproducible for anyone without credentials.
 */

import { config } from '../config.mjs';
import { logger } from '../util/log.mjs';
import { fetchWithTimeout } from '../util/http.mjs';
import { extractJson } from '../util/json.mjs';

const log = logger('llm');

export class LlmClient {
  constructor({ baseUrl, apiKey, model, temperature, maxTokens, timeoutMs } = {}) {
    this.baseUrl = ((baseUrl ?? config.llm.baseUrl) || '').replace(/\/+$/, '');
    this.apiKey = apiKey ?? config.llm.apiKey;
    this.model = model ?? config.llm.model;
    this.temperature = temperature ?? config.llm.temperature;
    this.maxTokens = maxTokens ?? config.llm.maxTokens;
    this.timeoutMs = timeoutMs ?? config.llm.timeoutMs;
    this.calls = 0;
    this.tokens = { prompt: 0, completion: 0 };
    this.lastError = null;
  }

  get available() {
    return Boolean(this.baseUrl && this.apiKey);
  }

  async chat(messages, { json = false, temperature = this.temperature, model = this.model, maxTokens = this.maxTokens } = {}) {
    if (!this.available) {
      throw new Error('LLM not configured - set PRISM_LLM_BASE_URL and PRISM_LLM_API_KEY');
    }
    const body = { model, messages, temperature, max_tokens: maxTokens };
    if (json) body.response_format = { type: 'json_object' };

    this.calls += 1;
    const res = await fetchWithTimeout(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify(body),
    }, this.timeoutMs);

    const text = await res.text();
    if (!res.ok) {
      this.lastError = `HTTP ${res.status}: ${text.slice(0, 300)}`;
      throw new Error(this.lastError);
    }
    let parsed;
    try { parsed = JSON.parse(text); } catch { throw new Error(`non-JSON LLM response: ${text.slice(0, 200)}`); }
    const content = parsed?.choices?.[0]?.message?.content ?? '';
    if (parsed?.usage) {
      this.tokens.prompt += parsed.usage.prompt_tokens || 0;
      this.tokens.completion += parsed.usage.completion_tokens || 0;
    }
    log.debug(`${model} -> ${content.length} chars`);
    return { content, usage: parsed.usage ?? null, model: parsed?.model ?? model };
  }

  /** Chat + guaranteed-parseable JSON. Returns null on failure so callers can degrade. */
  async json(messages, opts = {}) {
    try {
      const { content } = await this.chat(messages, { ...opts, json: true });
      const parsed = extractJson(content);
      if (parsed) return { ok: true, value: parsed, raw: content };
      log.warn('LLM returned unparseable JSON, retrying once with a stricter reminder');
      const retry = await this.chat(
        [...messages, { role: 'assistant', content }, { role: 'user', content: 'Your last reply was not valid JSON. Reply with ONLY the JSON object, no prose, no markdown fences.' }],
        { ...opts, json: false },
      );
      const second = extractJson(retry.content);
      return second ? { ok: true, value: second, raw: retry.content } : { ok: false, error: 'unparseable JSON after retry', raw: retry.content };
    } catch (err) {
      this.lastError = err.message;
      log.warn(`LLM call failed: ${err.message}`);
      return { ok: false, error: err.message };
    }
  }

  stats() {
    return { available: this.available, model: this.model, baseUrl: this.baseUrl || null, calls: this.calls, tokens: { ...this.tokens }, lastError: this.lastError };
  }
}

export default LlmClient;
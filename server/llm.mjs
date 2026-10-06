// llm.mjs — thin DeepSeek client (OpenAI-compatible). Zero dependencies.
// Never logs the key. Supports JSON mode, tool calls, and streaming narration.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const DEEPSEEK_BASE_URL = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
export const DEFAULT_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-flash';

/** Resolve an API key from env, then from the DSH credential store (read-only). */
export function resolveApiKey() {
  if (process.env.DEEPSEEK_API_KEY) {
    return { key: process.env.DEEPSEEK_API_KEY, source: 'env:DEEPSEEK_API_KEY' };
  }
  const candidates = [
    path.join(os.homedir(), '.dsh', '.credentials.yaml'),
    process.env.DSH_HOME ? path.join(process.env.DSH_HOME, '.credentials.yaml') : null,
  ].filter(Boolean);
  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) continue;
      const txt = fs.readFileSync(file, 'utf8');
      const m = txt.match(/DEEPSEEK_API_KEY:\s*(\S+)/);
      if (m && m[1]) return { key: m[1], source: `dsh-store:${path.basename(file)}` };
    } catch {
      /* ignore and fall through to mock mode */
    }
  }
  return { key: null, source: 'none' };
}

export class LlmError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = 'LlmError';
    this.status = status;
    this.body = body;
  }
}

/** Strip ```json fences and pull the outermost JSON object out of a reply. */
export function extractJson(text) {
  if (!text) throw new LlmError('empty model reply');
  let s = String(text).trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  try {
    return JSON.parse(s);
  } catch {
    /* fall through to brace scan */
  }
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start >= 0 && end > start) {
    const slice = s.slice(start, end + 1);
    try {
      return JSON.parse(slice);
    } catch (err) {
      throw new LlmError(`model reply was not JSON: ${s.slice(0, 200)}`);
    }
  }
  throw new LlmError(`model reply was not JSON: ${s.slice(0, 200)}`);
}

export function createClient({ apiKey, baseUrl = DEEPSEEK_BASE_URL, model = DEFAULT_MODEL } = {}) {
  const resolved = apiKey ? { key: apiKey, source: 'explicit' } : resolveApiKey();

  async function request({ messages, tools, json = false, temperature, maxTokens, stream = false, timeoutMs = 90000 }) {
    if (!resolved.key) throw new LlmError('no DeepSeek API key available');
    const body = {
      model,
      messages,
      stream,
    };
    if (typeof temperature === 'number') body.temperature = temperature;
    if (typeof maxTokens === 'number') body.max_tokens = maxTokens;
    if (tools && tools.length) {
      body.tools = tools;
      body.tool_choice = 'auto';
    }
    if (json) body.response_format = { type: 'json_object' };

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res;
    try {
      res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${resolved.key}`,
        },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      throw new LlmError(`network error calling DeepSeek: ${err.message}`);
    }
    if (!res.ok) {
      clearTimeout(timer);
      const text = await res.text().catch(() => '');
      throw new LlmError(`DeepSeek HTTP ${res.status}`, { status: res.status, body: text.slice(0, 400) });
    }

    if (stream) {
      return { stream: res.body, cleanup: () => clearTimeout(timer) };
    }
    const data = await res.json();
    clearTimeout(timer);
    return data;
  }

  return {
    model,
    baseUrl,
    keySource: resolved.source,
    hasKey: Boolean(resolved.key),

    /** One-shot completion returning the assistant message object (content + tool_calls). */
    async complete({ messages, tools, json, temperature, maxTokens, timeoutMs }) {
      const data = await request({ messages, tools, json, temperature, maxTokens, timeoutMs });
      const msg = data?.choices?.[0]?.message;
      if (!msg) throw new LlmError('DeepSeek returned no choices');
      return { message: msg, usage: data.usage, raw: data, finishReason: data?.choices?.[0]?.finish_reason };
    },

    /** JSON-mode call that returns a parsed object (throws LlmError on bad JSON). */
    async completeJson(opts) {
      const { message, usage } = await this.complete({ ...opts, json: true });
      return { data: extractJson(message.content), usage, text: message.content };
    },

    /**
     * Stream a completion, invoking onDelta(text) for each content chunk.
     * Resolves with the full text. Used for the "agent narration" line in the UI.
     */
    async streamText({ messages, temperature, maxTokens, timeoutMs = 90000, onDelta }) {
      const { stream, cleanup } = await request({
        messages,
        temperature,
        maxTokens,
        stream: true,
        timeoutMs,
      });
      const decoder = new TextDecoder();
      let buffer = '';
      let full = '';
      try {
        for await (const chunk of stream) {
          buffer += decoder.decode(chunk, { stream: true });
          const parts = buffer.split('\n');
          buffer = parts.pop() ?? '';
          for (const line of parts) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            const payload = trimmed.slice(5).trim();
            if (!payload || payload === '[DONE]') continue;
            try {
              const parsed = JSON.parse(payload);
              const delta = parsed?.choices?.[0]?.delta?.content;
              if (delta) {
                full += delta;
                if (onDelta) onDelta(delta);
              }
            } catch {
              /* ignore keep-alive / partial lines */
            }
          }
        }
      } finally {
        cleanup();
      }
      return full;
    },
  };
}

/** JSON helpers, including robust extraction of JSON from LLM output. */

export function safeParse(text, fallback = null) {
  if (text === null || text === undefined) return fallback;
  if (typeof text === 'object') return text;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

/** Pull the first balanced JSON object or array out of a blob of LLM prose. */
export function extractJson(text) {
  if (!text || typeof text !== 'string') return null;
  const fenced = text.match(/```(?:json|JSON)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const direct = safeParse(candidate.trim());
  if (direct) return direct;

  for (const open of ['{', '[']) {
    const close = open === '{' ? '}' : ']';
    const start = candidate.indexOf(open);
    if (start === -1) continue;
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < candidate.length; i += 1) {
      const ch = candidate[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === open) depth += 1;
      else if (ch === close) {
        depth -= 1;
        if (depth === 0) {
          const parsed = safeParse(candidate.slice(start, i + 1));
          if (parsed) return parsed;
        }
      }
    }
  }
  return null;
}

export function stableStringify(value) {
  const seen = new WeakSet();
  const walk = (v) => {
    if (v === null || typeof v !== 'object') return v;
    if (seen.has(v)) return '[Circular]';
    seen.add(v);
    if (Array.isArray(v)) return v.map(walk);
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = walk(v[k]);
    return out;
  };
  return JSON.stringify(walk(value));
}

export function clone(v) {
  return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
}

export function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj && obj[k] !== undefined) out[k] = obj[k];
  return out;
}

export function omit(obj, keys) {
  const out = { ...obj };
  for (const k of keys) delete out[k];
  return out;
}

export function jsonString(v, indent = 2) {
  return JSON.stringify(v, null, indent);
}
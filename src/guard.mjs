// Reference invariant + guard wrapper.
import { extractIds, idChecksum } from './ids.mjs';

function editDistance(a, b, cap = 4) {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

const isWordChar = (c) => c !== undefined && /[\w]/.test(c);
function containsToken(text, value) {
  let i = text.indexOf(value);
  while (i !== -1) {
    const before = text[i - 1], after = text[i + value.length];
    const startOk = !isWordChar(before) || !isWordChar(value[0]);
    const endOk = !isWordChar(after) || !isWordChar(value[value.length - 1]);
    if (startOk && endOk) return true;
    i = text.indexOf(value, i + 1);
  }
  return false;
}

/**
 * ids(original) must be a subset of what survives in derived.
 * Returns { ok, losses:[{type,value,kind:'missing'|'altered',foundInstead?}], checksum }.
 * An id counts as preserved if it is extracted from derived OR appears verbatim as a token.
 * `allow`: array of values that are allowed to disappear. `types`: restrict to id types.
 */
export function referenceInvariant(original, derived, { allow = [], types } = {}) {
  const orig = extractIds(original, { types });
  const dText = String(derived);
  const dIds = extractIds(dText);
  const dValues = new Set(dIds.map((i) => i.value));
  const allowed = new Set(allow);
  const losses = [];
  for (const id of orig) {
    if (allowed.has(id.value)) continue;
    if (dValues.has(id.value) || containsToken(dText, id.value)) continue;
    let near = dIds.find((d) => !orig.some((o) => o.value === d.value) && d.type === id.type &&
      (editDistance(d.value, id.value) <= 2 || d.value.startsWith(id.value) || id.value.startsWith(d.value) ||
        (id.type === 'path' && d.value.split('/').pop() === id.value.split('/').pop())));
    if (!near && id.type === 'hash') {
      const bare = id.value.replace(/^sha\d+[:-]/, '');
      const tok = (dText.match(/\b[0-9a-f]{5,}\b/g) || []).find((t) => !orig.some((o) => o.value === t) && (bare.startsWith(t) || editDistance(t, bare) <= 2));
      if (tok) near = { value: tok };
    }
    losses.push(near ? { ...id, kind: 'altered', foundInstead: near.value } : { ...id, kind: 'missing' });
  }
  return {
    ok: losses.length === 0,
    losses,
    total: orig.length,
    checksum: { original: idChecksum(orig), derived: idChecksum(dIds) },
  };
}

export class GuardError extends Error {
  constructor(message, { losses, attempts, lastOutput }) {
    super(message);
    this.name = 'GuardError';
    this.losses = losses; this.attempts = attempts; this.lastOutput = lastOutput;
  }
}

/**
 * guard(transform, opts) -> async (text) => { output, attempts, ok, losses, fellBack }
 * transform(text, ctx) may be sync/async (e.g. an LLM call you provide). ctx = { attempt, losses }
 * so you can tell the model which identifiers it dropped. Retries up to opts.retries (default 2),
 * then either throws GuardError (onFail 'abort', default) or returns the original ('original').
 */
export function guard(transform, { retries = 2, onFail = 'abort', allow, types } = {}) {
  if (typeof transform !== 'function') throw new TypeError('guard(transform): transform must be a function');
  return async function guarded(text) {
    let losses = [], out = '', attempts = 0;
    for (let attempt = 0; attempt <= retries; attempt++) {
      attempts++;
      out = await transform(text, { attempt, losses });
      if (typeof out !== 'string') throw new TypeError('guard: transform must return a string');
      const r = referenceInvariant(text, out, { allow, types });
      if (r.ok) return { output: out, attempts, ok: true, losses: [], fellBack: false };
      losses = r.losses;
    }
    if (onFail === 'original') return { output: text, attempts, ok: false, losses, fellBack: true };
    throw new GuardError(`identifier loss after ${attempts} attempt(s): ${losses.slice(0, 5).map((l) => l.value).join(', ')}${losses.length > 5 ? ', ...' : ''}`,
      { losses, attempts, lastOutput: out });
  };
}

// Controlled, versioned vocabulary: schema validation, lint, normalize.
import { createHash } from 'node:crypto';
import { scan } from './ids.mjs';

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/;
const key = (s) => s.toLowerCase().replace(/[\s-]+/g, ' ').trim();
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Validate a vocabulary definition. Returns { valid, errors: string[] }. */
export function validateVocab(def) {
  const errors = [];
  const isStr = (v) => typeof v === 'string' && v.trim() !== '';
  if (!def || typeof def !== 'object' || Array.isArray(def)) return { valid: false, errors: ['vocabulary must be an object'] };
  if (!isStr(def.name)) errors.push('name: required non-empty string');
  if (!isStr(def.version) || !SEMVER.test(def.version)) errors.push('version: required semver string (e.g. "1.0.0")');
  if (!Array.isArray(def.terms) || def.terms.length === 0) { errors.push('terms: required non-empty array'); return { valid: false, errors }; }
  const canon = new Map(), forb = new Map();
  def.terms.forEach((t, i) => {
    const p = `terms[${i}]`;
    if (!t || typeof t !== 'object') { errors.push(`${p}: must be an object`); return; }
    if (!isStr(t.term)) { errors.push(`${p}.term: required non-empty string`); return; }
    if (!isStr(t.definition)) errors.push(`${p}.definition: required non-empty string ("${t.term}")`);
    if (t.domain !== undefined && !isStr(t.domain)) errors.push(`${p}.domain: must be a non-empty string`);
    if (t.forbidden !== undefined && (!Array.isArray(t.forbidden) || t.forbidden.some((s) => !isStr(s)))) errors.push(`${p}.forbidden: must be an array of non-empty strings`);
    const k = key(t.term);
    if (canon.has(k)) errors.push(`${p}.term: duplicate canonical term "${t.term}"`);
    canon.set(k, t.term);
  });
  def.terms.forEach((t, i) => {
    if (!t || !Array.isArray(t.forbidden)) return;
    for (const s of t.forbidden) {
      if (typeof s !== 'string') continue;
      const k = key(s);
      if (canon.has(k)) errors.push(`terms[${i}].forbidden: "${s}" is itself a canonical term`);
      if (forb.has(k) && forb.get(k) !== t.term) errors.push(`terms[${i}].forbidden: "${s}" is mapped to both "${forb.get(k)}" and "${t.term}"`);
      forb.set(k, t.term);
    }
  });
  if (def.enums !== undefined) {
    if (!def.enums || typeof def.enums !== 'object' || Array.isArray(def.enums)) errors.push('enums: must be an object of field -> string[]');
    else for (const [f, vals] of Object.entries(def.enums)) if (!Array.isArray(vals) || vals.some((v) => typeof v !== 'string')) errors.push(`enums.${f}: must be an array of strings`);
  }
  return { valid: errors.length === 0, errors };
}

/** Deterministic content hash of a vocabulary (key order independent). */
export function vocabHash(def) {
  const canon = (v) => Array.isArray(v) ? v.map(canon) : v && typeof v === 'object'
    ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v;
  return createHash('sha256').update(JSON.stringify(canon(def))).digest('hex').slice(0, 16);
}

const pluralize = (w) => /(s|x|z|ch|sh)$/i.test(w) ? w + 'es' : /[^aeiou]y$/i.test(w) ? w.slice(0, -1) + 'ies' : w + 's';

/** Compile a definition into a matcher. Throws on invalid schema. */
export function compileVocab(def) {
  const v = validateVocab(def);
  if (!v.valid) throw new Error('invalid vocabulary: ' + v.errors.join('; '));
  const map = new Map();
  for (const t of def.terms) for (const s of t.forbidden || []) map.set(key(s), t);
  const alts = [...map.keys()].sort((a, b) => b.length - a.length).map((k) => k.split(' ').map(esc).join('[\\s-]+'));
  const re = alts.length ? new RegExp(`(?<![\\p{L}\\p{N}_])(?:${alts.join('|')})(?:es|s)?(?![\\p{L}\\p{N}_])`, 'giu') : null;
  return { def, map, re, name: def.name, version: def.version, hash: vocabHash(def) };
}

function lookup(c, raw) {
  const k = key(raw);
  if (c.map.has(k)) return { t: c.map.get(k), suffix: '' };
  if (k.endsWith('es') && c.map.has(k.slice(0, -2))) return { t: c.map.get(k.slice(0, -2)), suffix: 'es' };
  if (k.endsWith('s') && c.map.has(k.slice(0, -1))) return { t: c.map.get(k.slice(0, -1)), suffix: 's' };
  return null;
}
function applyCase(src, rep) {
  if (src.length > 1 && src === src.toUpperCase() && /[A-Z]/.test(src)) return rep.toUpperCase();
  if (/^\p{Lu}/u.test(src)) return rep[0].toUpperCase() + rep.slice(1);
  return rep;
}
function protectedMask(text) {
  const m = text.split('');
  for (const s of scan(text)) for (let i = s.start; i < s.end; i++) m[i] = ' ';
  return m.join('');
}
function lineIndex(text) {
  const starts = [0];
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) starts.push(i + 1);
  return (off) => {
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= off) lo = mid; else hi = mid - 1; }
    return { line: lo + 1, col: off - starts[lo] + 1 };
  };
}

/** Lint free text. Findings: { offset, line, col, found, canonical, suggestion, definition }.
 *  Text inside code spans, URLs, paths and hashes is never flagged. */
export function lintText(text, vocab) {
  const c = vocab.map ? vocab : compileVocab(vocab);
  if (!c.re) return [];
  const s = String(text), masked = protectedMask(s), out = [], lineCol = lineIndex(s);
  c.re.lastIndex = 0;
  let m;
  while ((m = c.re.exec(masked))) {
    const hit = lookup(c, m[0]);
    if (!hit) continue;
    const found = s.slice(m.index, m.index + m[0].length);
    const rep = applyCase(found, hit.suffix ? pluralize(hit.t.term) : hit.t.term);
    out.push({ offset: m.index, ...lineCol(m.index), found, canonical: hit.t.term, suggestion: rep,
      definition: hit.t.definition, domain: hit.t.domain, vocab: `${c.name}@${c.version}` });
  }
  return out;
}

/** Replace every forbidden synonym by its canonical term (case and plural preserved). */
export function normalize(text, vocab) {
  const c = vocab.map ? vocab : compileVocab(vocab);
  const s = String(text);
  const f = lintText(s, c);
  let out = '', pos = 0;
  for (const x of f) { out += s.slice(pos, x.offset) + x.suggestion; pos = x.offset + x.found.length; }
  return out + s.slice(pos);
}

function levenshtein(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

/** Lint a JSON value (object or string). String values are text-linted; values of keys
 *  declared in vocab.enums must belong to the enum. Findings carry a JSONPath-like `path`. */
export function lintJSON(input, vocab) {
  const c = vocab.map ? vocab : compileVocab(vocab);
  const data = typeof input === 'string' ? JSON.parse(input) : input;
  const out = [], enums = c.def.enums || {};
  const walk = (v, path, field) => {
    if (typeof v === 'string') {
      if (field && enums[field] && !enums[field].includes(v)) {
        const syn = c.map.get(key(v));
        const near = syn && enums[field].includes(syn.term) ? syn.term : enums[field].map((e) => [levenshtein(e, v), e]).sort((a, b) => a[0] - b[0])[0];
        const sug = Array.isArray(near) ? (near[0] <= 2 ? near[1] : null) : near;
        out.push({ path, found: v, kind: 'enum', suggestion: sug, allowed: enums[field], vocab: `${c.name}@${c.version}` });
      } else if (!(field && enums[field])) {
        for (const f of lintText(v, c)) out.push({ path, kind: 'synonym', ...f });
      }
    } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`, field));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`, k);
  };
  walk(data, '$', null);
  return out;
}

// Critical-identifier extraction. Deterministic, regex based, no dependencies.
import { createHash } from 'node:crypto';

const FULL = {
  url: /^https?:\/\/\S+$/,
  issue: /^#\d+$/,
  version: /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?(?:\+[0-9A-Za-z.]+)?$/,
  hash: /^(?:sha\d+[:-])?[0-9a-f]{7,64}$/,
  path: /^(?:\.{1,2}\/|\/|~\/)?[\w@.-]+(?:\/[\w@.-]+)+\/?$/,
};
const FILE_EXT = 'mjs|cjs|js|ts|tsx|jsx|json|md|txt|yml|yaml|toml|py|sh|css|html|csv|lock';
const NOT_FILES = /^(node|next|vue|react|express|three|d3|nuxt|alpine)\.js$/i;

const RX = {
  url: /https?:\/\/[^\s<>"'`)\]]+/g,
  code: /`([^`\n]{1,80})`/g,
  hash: /(?<![\w/.@-])((?:sha\d+[:-])?[0-9a-f]{7,64})(?![\w])/g,
  issue: /(?<![\w&])(#\d+)(?![\w])/g,
  version: /(?<![\w.])(v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?(?:\+[0-9A-Za-z.]+)?)(?![\w])/g,
  path: /(?<![\w@:/.-])((?:\.{1,2}\/|\/|~\/)?[\w@.-]+(?:\/[\w@.-]+)+\/?)/g,
  file: new RegExp(`(?<![\\w/.@-])([\\w-]+(?:\\.[\\w-]+)*\\.(?:${FILE_EXT}))(?![\\w])`, 'g'),
};

const trimTail = (s) => s.replace(/[.,;:!?]+$/, '');
const hashOk = (v) => { const h = v.replace(/^sha\d+[:-]/, ''); return /\d/.test(h) && /[a-f]/.test(h); };
const pathOk = (v) => {
  if (/^(\.{1,2}\/|\/|~\/)/.test(v)) return true;
  const segs = v.replace(/\/$/, '').split('/');
  return segs.length >= 3 || /\.[A-Za-z0-9]+$/.test(segs[segs.length - 1]);
};

export function classify(value) {
  for (const t of ['url', 'issue', 'version', 'hash', 'path']) {
    if (FULL[t].test(value) && (t !== 'hash' || hashOk(value)) && (t !== 'path' || pathOk(value))) return t;
  }
  return 'code';
}

/** Low level scan: returns [{type,value,start,end}] (spans may be used to mask text). */
export function scan(text) {
  const out = [];
  const mask = text.split('');
  const blank = (s, e) => { for (let i = s; i < e; i++) mask[i] = ' '; };
  const run = (re, src, fn) => { re.lastIndex = 0; let m; while ((m = re.exec(src))) fn(m); };

  run(RX.url, text, (m) => {
    const v = trimTail(m[0]);
    out.push({ type: 'url', value: v, start: m.index, end: m.index + v.length });
    blank(m.index, m.index + m[0].length);
  });
  run(RX.code, mask.join(''), (m) => {
    const v = m[1].trim();
    if (!v) return;
    out.push({ type: classify(v), value: v, start: m.index, end: m.index + m[0].length });
    blank(m.index, m.index + m[0].length);
  });
  let rest = mask.join('');
  const add = (type, re, ok) => {
    run(re, rest, (m) => {
      const v = trimTail(m[1]);
      if (!v || (ok && !ok(v))) return;
      const start = m.index + m[0].indexOf(m[1]);
      out.push({ type, value: v, start, end: start + v.length });
    });
  };
  add('version', RX.version);
  // blank versions so they are not read as paths/files
  for (const o of out) if (o.type === 'version') for (let i = o.start; i < o.end; i++) mask[i] = ' ';
  rest = mask.join('');
  add('hash', RX.hash, hashOk);
  add('issue', RX.issue);
  add('path', RX.path, pathOk);
  for (const o of out) if (o.type === 'path') for (let i = o.start; i < o.end; i++) mask[i] = ' ';
  rest = mask.join('');
  add('path', RX.file, (v) => !NOT_FILES.test(v));
  return out.sort((a, b) => a.start - b.start);
}

/** Unique critical identifiers: [{type,value}] sorted. */
export function extractIds(text, { types } = {}) {
  const seen = new Map();
  for (const s of scan(String(text))) {
    if (types && !types.includes(s.type)) continue;
    const k = s.type + '\u0000' + s.value;
    if (!seen.has(k)) seen.set(k, { type: s.type, value: s.value });
  }
  return [...seen.values()].sort((a, b) => (a.type + a.value < b.type + b.value ? -1 : 1));
}

/** SHA-256 over the sorted set of identifier values (type-independent so that
 *  removing backticks around an id does not change the checksum). */
export function idChecksum(textOrIds) {
  const ids = Array.isArray(textOrIds) ? textOrIds : extractIds(textOrIds);
  const values = [...new Set(ids.map((i) => i.value))].sort();
  return createHash('sha256').update(values.join('\n')).digest('hex');
}

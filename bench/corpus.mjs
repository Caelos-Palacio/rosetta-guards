// Synthetic, seeded corpus generator. Ground truth is tracked by construction
// (generator-held id lists), independently from the library's extractor.
export function rng(seed) {
  let a = seed >>> 0;
  const next = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const int = (n) => Math.floor(next() * n);
  const pick = (arr) => arr[int(arr.length)];
  return { next, int, pick };
}

const W = ['engine', 'render', 'planner', 'ledger', 'cache', 'router', 'parser', 'audio', 'camera', 'gate', 'metrics', 'schema'];
const EXT = ['mjs', 'json', 'md', 'ts', 'py'];
const FILL = ['very', 'really', 'basically', 'actually', 'simply', 'quite'];
const SUBJ = ['The team', 'The agent', 'The pipeline', 'The reviewer', 'The scheduler', 'The maintainer'];
const VERB = ['updated', 'reviewed', 'refactored', 'documented', 'measured', 'verified'];
const hex = (r, n) => { let s; do { s = ''; for (let i = 0; i < n; i++) s += '0123456789abcdef'[r.int(16)]; } while (!/\d/.test(s) || !/[a-f]/.test(s)); return s; };

const DISTRACT = ['either and/or both', 'read/write access', 'built with Node.js', 'released on 2026-01-05', 'ratio 1.5 and 12345678 items',
  'the decade ahead', 'see e.g. section 4', 'cost 3.50 USD', 'TCP/IP stack', 'about 10/12 done'];
// profile 'wild' adds identifier shapes the library does NOT claim to extract (ticket keys,
// 6-char hashes, uppercase hashes, bare function names) plus non-identifier distractors.
export function makeWildId(r) {
  switch (r.int(4)) {
    case 0: return { type: 'ticket', value: `${r.pick(['PROJ', 'OPS', 'DATA'])}-${100 + r.int(900)}` };
    case 1: return { type: 'hash6', value: hex(r, 6) };
    case 2: return { type: 'hashUpper', value: hex(r, 8).toUpperCase() };
    default: return { type: 'func', value: `${r.pick(['parse', 'load', 'merge'])}_${r.pick(['config', 'state', 'plan'])}${r.int(90)}()` };
  }
}
export function makeId(r) {
  switch (r.int(6)) {
    case 0: return { type: 'path', value: `src/${r.pick(W)}/${r.pick(W)}${r.int(90)}.${r.pick(EXT)}` };
    case 1: return { type: 'hash', value: hex(r, r.pick([7, 8, 12, 40])) };
    case 2: return { type: 'issue', value: `#${100 + r.int(9000)}` };
    case 3: return { type: 'url', value: `https://example.org/${r.pick(W)}/${r.pick(W)}${r.int(90)}` };
    case 4: return { type: 'version', value: `v${r.int(5)}.${r.int(20)}.${r.int(20)}` };
    default: return { type: 'code', value: `ERR_${r.pick(['IO', 'NET', 'GATE', 'PARSE'])}_${r.int(900)}` };
  }
}
const render = (id) => id.type === 'code' ? '`' + id.value + '`' : id.value;

/** A document = array of sentences; each { text, ids:[{type,value}] } (ids may be empty). */
export function makeDoc(r, { sentences = 20, wild = false } = {}) {
  const doc = [];
  for (let i = 0; i < sentences; i++) {
    const ids = r.next() < 0.6 ? Array.from({ length: 1 + r.int(2) }, () => (wild && r.next() < 0.5 ? makeWildId(r) : makeId(r))) : [];
    const parts = [`${r.pick(SUBJ)} ${r.pick(FILL)} ${r.pick(VERB)} ${r.pick(W)}`];
    for (const id of ids) parts.push(r.pick(['in', 'at', 'for', 'see']) + ' ' + render(id));
    if (wild && r.next() < 0.4) parts.push('(' + r.pick(DISTRACT) + ')');
    doc.push({ text: parts.join(' ') + '.', ids });
  }
  return doc;
}
export const docText = (doc) => doc.map((s) => s.text).join(' ');
export const docIdValues = (doc) => new Set(doc.flatMap((s) => s.ids.map((i) => i.value)));

// --- simulated compactions: return a new doc (sentences with their *current* ids) ---
export function alterValue(id, r) {
  const v = id.value;
  switch (id.type) {
    case 'hash': return r.next() < 0.5 ? v.slice(0, 6) : v.slice(0, -1) + (v.slice(-1) === '0' ? '1' : '0');
    case 'issue': return '#' + (parseInt(v.slice(1), 10) + 1);
    case 'version': return v.replace(/\d+$/, (n) => String(+n + 1));
    case 'path': return v.replace(/\/[^/]+$/, '/x_' + r.int(9) + '.mjs');
    case 'url': return v.replace(/\/[^/]+$/, '');
    default: return v.toLowerCase() === v ? v + 'x' : v.toLowerCase();
  }
}

export const COMPACTIONS = {
  // benign (no identifier changes)
  'benign: drop filler words': (doc) => doc.map((s) => ({ ...s, text: s.text.replace(/\b(very|really|basically|actually|simply|quite) /g, '') })),
  'benign: drop id-free sentences': (doc) => doc.filter((s) => s.ids.length),
  'benign: strip backticks + collapse': (doc) => doc.map((s) => ({ ...s, text: s.text.replace(/`/g, '').replace(/\s+/g, ' ') })),
  // lossy
  'lossy: drop 30% of sentences': (doc, r) => doc.filter(() => r.next() > 0.3),
  'lossy: keep first half': (doc) => doc.slice(0, Math.ceil(doc.length / 2)),
  'lossy: remove one id per sentence': (doc) => doc.map((s) => {
    if (!s.ids.length) return s;
    const gone = s.ids[0];
    const text = s.text.replace(new RegExp(`\\s?(?:in|at|for|see) \`?${gone.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\`?`), '');
    return { text, ids: s.ids.slice(1) };
  }),
  'lossy: alter 1 char/segment of ids': (doc, r) => doc.map((s) => {
    if (!s.ids.length) return s;
    let text = s.text; const ids = s.ids.map((id) => {
      const nv = r.next() < 0.5 ? alterValue(id, r) : id.value;
      if (nv !== id.value) text = text.replace(id.value, nv);
      return { ...id, value: nv };
    });
    return { text, ids };
  }),
};

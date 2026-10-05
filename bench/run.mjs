#!/usr/bin/env node
// Reproducible benchmark. `node bench/run.mjs [--docs N] [--seed S] [--json]`
import { writeFileSync, readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { performance } from 'node:perf_hooks';
import { rng, makeDoc, docText, docIdValues, COMPACTIONS } from './corpus.mjs';
import { extractIds, referenceInvariant, compileVocab, lintText, normalize, idChecksum } from '../src/index.mjs';

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? Number(argv[i + 1]) : d; };
export function runBench({ docs = 300, seed = 20260101 } = {}) {
  const r = rng(seed);
  const res = { config: { docs, seed, node: process.version, cpu: cpus()[0]?.model, cores: cpus().length } };
  const profiles = {};
  for (const [name, wild] of [['clean', false], ['wild', true]]) {
    const pr = rng(seed + (wild ? 99 : 0));
    const corpus = Array.from({ length: docs }, () => makeDoc(pr, { sentences: 10 + pr.int(30), wild }));
    // (0) extraction quality vs generator ground truth
    const byType = {}; let hit = 0, gtN = 0, foundN = 0;
    for (const d of corpus) {
      const gt = docIdValues(d), got = new Set(extractIds(docText(d)).map((i) => i.value));
      for (const sn of d) for (const i of sn.ids) { const b = (byType[i.type] ||= { n: 0, hit: 0 }); b.n++; if (got.has(i.value)) b.hit++; }
      gtN += gt.size; foundN += got.size; for (const v of gt) if (got.has(v)) hit++;
    }
    const extraction = { ids: gtN, recall: hit / gtN, precision: hit / foundN, falsePositives: foundN - hit,
      recallByType: Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, v.hit / v.n])) };
    // (i) loss detection
    const loss = [];
    for (const [cname, fn] of Object.entries(COMPACTIONS)) {
      const cr = rng(seed + 1);
      let docTP = 0, docFP = 0, docFN = 0, docTN = 0, trueLost = 0, repLost = 0, tpLost = 0;
      for (const d of corpus) {
        const out = fn(d, cr);
        const derivedVals = docIdValues(out);
        const truth = [...docIdValues(d)].filter((v) => !derivedVals.has(v));
        const rep = referenceInvariant(docText(d), docText(out)).losses.map((l) => l.value);
        const truthSet = new Set(truth);
        trueLost += truth.length; repLost += rep.length; tpLost += rep.filter((v) => truthSet.has(v)).length;
        const t = truth.length > 0, p = rep.length > 0;
        if (t && p) docTP++; else if (!t && p) docFP++; else if (t && !p) docFN++; else docTN++;
      }
      loss.push({ compaction: cname, trueLostIds: trueLost, reported: repLost,
        idRecall: trueLost ? tpLost / trueLost : null, idPrecision: repLost ? tpLost / repLost : null,
        docs: { TP: docTP, FP: docFP, FN: docFN, TN: docTN } });
    }
    profiles[name] = { extraction, loss };
  }
  res.profiles = profiles;

  // (ii) terminology drift
  const vocab = compileVocab(JSON.parse(readFileSync(new URL('./vocab.json', import.meta.url), 'utf8')));
  const terms = vocab.def.terms;
  const base = (rr) => {
    const rows = [];
    for (let i = 0; i < 12; i++) {
      const t = rr.pick(terms), t2 = rr.pick(terms);
      rows.push(`The ${t.term} must be checked before every ${t2.term} is recorded in src/${rr.pick(['a', 'b', 'c'])}/${t.term}.mjs (#${100 + rr.int(900)}).`);
      if (rr.next() < 0.3) rows.push(`Use \`${t.forbidden[0]}\` only as a literal key; see https://example.org/${t.forbidden[0]}.`); // decoys: protected spans
    }
    return rows.join(' ');
  };
  const forms = (text) => { const s = new Set(); for (const t of terms) for (const k of [t.term, ...t.forbidden]) if (new RegExp(`(?<![\\w/.\`-])${k}s?(?![\\w/.\`-])`, 'i').test(text.replace(/`[^`]*`|https?:\/\/\S+|\S*\/\S*/g, ' '))) s.add(t.term + '|' + k); return s; };
  res.drift = [];
  for (const rate of [0.1, 0.3, 0.5, 1.0]) {
    const dr = rng(seed + 7);
    let injected = 0, tp = 0, flagged = 0, residual = 0, exact = 0, driftBefore = 0, driftAfter = 0, n = 0, fpClean = 0;
    for (let i = 0; i < docs; i++) {
      const clean = base(dr);
      fpClean += lintText(clean, vocab).length; // clean docs must give 0 findings (decoys included)
      // inject: replace canonical *prose* occurrences by a random forbidden synonym
      const injectedPos = [];
      let out = '', pos = 0;
      const re = new RegExp(`(?<![\\w/.\`-])(${terms.map((t) => t.term).join('|')})(?![\\w/.\`-])(?!\\.mjs)`, 'g');
      const protectedSpans = [...clean.matchAll(/`[^`]*`|https?:\/\/\S+|\S*\/\S*/g)].map((m) => [m.index, m.index + m[0].length]);
      for (const m of clean.matchAll(re)) {
        if (protectedSpans.some(([a, b]) => m.index >= a && m.index < b)) continue;
        if (dr.next() >= rate) continue;
        const t = terms.find((x) => x.term === m[1]); const syn = dr.pick(t.forbidden);
        out += clean.slice(pos, m.index) + syn; injectedPos.push(out.length - syn.length); pos = m.index + m[0].length; injected++;
      }
      out += clean.slice(pos);
      const f = lintText(out, vocab);
      const fs = new Set(f.map((x) => x.offset));
      flagged += f.length; tp += injectedPos.filter((p) => fs.has(p)).length;
      const norm = normalize(out, vocab);
      residual += lintText(norm, vocab).length;
      if (norm === clean) exact++;
      driftBefore += forms(out).size; driftAfter += forms(norm).size; n++;
    }
    res.drift.push({ injectionRate: rate, injected, recall: injected ? tp / injected : null, precision: flagged ? tp / flagged : null,
      residualAfterNormalize: residual, roundTripExact: exact / n, falsePositivesOnCleanDocs: fpClean,
      surfaceFormsBefore: driftBefore / n, surfaceFormsAfter: driftAfter / n });
  }

  // (iii) cost
  res.timing = [];
  for (const kb of [1, 10, 100, 1000]) {
    const tr = rng(seed + 3); let doc = [];
    while (docText(doc).length < kb * 1024) doc = doc.concat(makeDoc(tr, { sentences: 20 }));
    const text = docText(doc).slice(0, kb * 1024), derived = text.replace(/very |really /g, '');
    const time = (fn, reps) => { fn(); const a = []; for (let i = 0; i < reps; i++) { const t = performance.now(); fn(); a.push(performance.now() - t); } a.sort((x, y) => x - y); return a[a.length >> 1]; };
    const reps = kb >= 1000 ? 5 : 21;
    res.timing.push({ sizeKB: kb, extractMs: time(() => extractIds(text), reps), checkMs: time(() => referenceInvariant(text, derived), reps),
      checksumMs: time(() => idChecksum(text), reps), lintMs: time(() => lintText(text, vocab), reps), normalizeMs: time(() => normalize(text, vocab), reps) });
  }
  return res;
}

const pct = (x) => x == null ? 'n/a' : (x * 100).toFixed(1) + '%';
const ms = (x) => x < 0.1 ? x.toFixed(3) : x.toFixed(2);
export function markdown(res) {
  const L = [];
  L.push(`Config: ${res.config.docs} docs, seed ${res.config.seed}, Node ${res.config.node}, ${res.config.cpu} (${res.config.cores} cores)\n`);
  for (const [name, p] of Object.entries(res.profiles)) {
    L.push(`**Profile \`${name}\`** - extraction vs generator ground truth (${p.extraction.ids} identifiers): recall ${pct(p.extraction.recall)}, precision ${pct(p.extraction.precision)}, false positives ${p.extraction.falsePositives}`);
    L.push('recall by id type: ' + Object.entries(p.extraction.recallByType).map(([k, v]) => `${k} ${pct(v)}`).join(', '), '');
    L.push('| compaction | truly lost ids | reported | id recall | id precision | docs TP/FP/FN/TN |', '|---|---:|---:|---:|---:|---|');
    for (const x of p.loss) L.push(`| ${x.compaction} | ${x.trueLostIds} | ${x.reported} | ${pct(x.idRecall)} | ${pct(x.idPrecision)} | ${x.docs.TP}/${x.docs.FP}/${x.docs.FN}/${x.docs.TN} |`);
    L.push('');
  }
  L.push('| synonym injection rate | injected | lint recall | lint precision | residual after normalize | exact round-trip | FP on clean docs | surface forms/doc before -> after |', '|---:|---:|---:|---:|---:|---:|---:|---|');
  for (const x of res.drift) L.push(`| ${pct(x.injectionRate)} | ${x.injected} | ${pct(x.recall)} | ${pct(x.precision)} | ${x.residualAfterNormalize} | ${pct(x.roundTripExact)} | ${x.falsePositivesOnCleanDocs} | ${x.surfaceFormsBefore.toFixed(2)} -> ${x.surfaceFormsAfter.toFixed(2)} |`);
  L.push('', '| size | extract ids (ms) | check (ms) | checksum (ms) | lint (ms) | normalize (ms) |', '|---:|---:|---:|---:|---:|---:|');
  for (const x of res.timing) L.push(`| ${x.sizeKB} KB | ${ms(x.extractMs)} | ${ms(x.checkMs)} | ${ms(x.checksumMs)} | ${ms(x.lintMs)} | ${ms(x.normalizeMs)} |`);
  return L.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const res = runBench({ docs: opt('docs', 300), seed: opt('seed', 20260101) });
  if (argv.includes('--json')) console.log(JSON.stringify(res, null, 2));
  else { writeFileSync(new URL('./results.json', import.meta.url), JSON.stringify(res, null, 2) + '\n'); console.log(markdown(res)); }
}

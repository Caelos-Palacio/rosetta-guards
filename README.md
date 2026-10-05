# rosetta-guards

Deterministic guardrails for LLM context compaction. **No LLM, no dependencies, Node >= 18.**

Two ideas, both verifiable by plain code:

1. **Controlled vocabulary** - a versioned JSON definition (canonical term, definition, forbidden synonyms -> canonical, domain). Schema validator, text/JSON linter (position + suggestion), normalizer.
2. **Reference-invariant guards** - extract the critical identifiers of a document (paths, hashes, `#123`, `` `CODE_1` ``, URLs, versions); check that every identifier of the original survives in any derived/compacted version; checksum the identifier set; wrap *any* transformation (including one that calls an LLM you provide) so it retries or aborts when it loses identifiers.

> Name: the repo is called `rosetta-guards` because the ideas come from the "Rosetta" context-compaction concept of the author's private project. Rename freely.

## What is (and is not) here

Included: only what can be demonstrated deterministically and is measured below.

**Not included: Rosetta's LLM-based compression** (the "-55 % tokens" claim). The original specification is lost and that figure was never measured against real tokens; decompression by an LLM is non-deterministic, so it cannot be audited by a gate. This library does not compress text. It makes *any* compressor safe to use by checking, deterministically, that nothing identifying was lost. Bring your own compactor.

## Install / use

```bash
npm i rosetta-guards            # or clone; no dependencies
```

```js
import { guard, referenceInvariant, extractIds, idChecksum,
         compileVocab, lintText, lintJSON, normalize, validateVocab } from 'rosetta-guards';

// 1. Guard any compaction (LLM or not)
const safe = guard(async (text, { attempt, losses }) => myLLMCompact(text, losses), { retries: 2, onFail: 'abort' });
const { output } = await safe(longDoc);          // throws GuardError listing lost ids if it cannot comply

// 2. Check by hand
referenceInvariant(original, derived);           // { ok, losses:[{type,value,kind:'missing'|'altered',foundInstead}], checksum }

// 3. Vocabulary
const vocab = compileVocab(JSON.parse(fs.readFileSync('vocab.json', 'utf8')));
lintText('The clip passed the checkpoint.', vocab);  // [{ line, col, found:'clip', suggestion:'shot', ... }]
normalize('Clips and the outcome', vocab);           // 'Shots and the verdict'
```

Vocabulary format (see `examples/vocab.json`): `{ name, version (semver), terms:[{ term, definition, domain?, forbidden?:[...] }], enums?:{ field:[allowed...] } }`. Lint ignores text inside code spans, URLs, paths and hashes; understands plurals, case and `scene cut` / `scene-cut`; `lintJSON` also enforces `enums` on JSON fields.

### CLI

```bash
rosetta validate vocab.json
rosetta lint vocab.json docs/*.md data.json [--json]   # exit 1 on findings
rosetta check original.md compacted.md [--json]         # exit 1 on identifier loss
rosetta ids file.md [--json]                            # identifiers + checksum
```

Identifier types: `path`, `hash` (7-64 hex with a digit and a letter, optional `sha256:`), `issue` (`#123`), `version` (semver), `url`, `code` (any other backticked token). Rule "do not touch ids/hashes/paths" is enforced rather than requested: the guard fails if they change. Known limits: shapes not listed (ticket keys like `PROJ-12`, hashes < 7 chars, uppercase hashes, bare function names) are **not** extracted - see the `wild` benchmark profile. Wrap them in backticks to make them guarded.

## Benchmark (real, reproducible)

`npm run bench` (`node bench/run.mjs --docs 300 --seed 20260101`) regenerates the tables below and `bench/results.json`. The corpus is **synthetic and seeded** (no private documents): ground truth is tracked by the generator, independently of the library. Honest caveats: the generator and the extractor share an author, so the `clean` profile is an easy upper bound; the `wild` profile adds identifier shapes the library does not claim to cover plus non-identifier distractors, to show the real boundary. Timings are single-machine medians.

Config: 300 docs, seed 20260101, Node v22.22.2, 13th Gen Intel(R) Core(TM) i5-13420H (12 cores)

**Profile `clean`** - extraction vs generator ground truth (6627 identifiers): recall 100.0%, precision 100.0%, false positives 0
recall by id type: code 100.0%, issue 100.0%, hash 100.0%, path 100.0%, url 100.0%, version 100.0%

| compaction | truly lost ids | reported | id recall | id precision | docs TP/FP/FN/TN |
|---|---:|---:|---:|---:|---|
| benign: drop filler words | 0 | 0 | n/a | n/a | 0/0/0/300 |
| benign: drop id-free sentences | 0 | 0 | n/a | n/a | 0/0/0/300 |
| benign: strip backticks + collapse | 0 | 0 | n/a | n/a | 0/0/0/300 |
| lossy: drop 30% of sentences | 1999 | 1999 | 100.0% | 100.0% | 294/0/0/6 |
| lossy: keep first half | 3179 | 3179 | 100.0% | 100.0% | 300/0/0/0 |
| lossy: remove one id per sentence | 4425 | 4425 | 100.0% | 100.0% | 300/0/0/0 |
| lossy: alter 1 char/segment of ids | 3364 | 3364 | 100.0% | 100.0% | 300/0/0/0 |

**Profile `wild`** - extraction vs generator ground truth (6548 identifiers): recall 50.5%, precision 100.0%, false positives 0
recall by id type: url 100.0%, version 100.0%, hashUpper 0.0%, func 0.0%, path 100.0%, hash6 0.0%, issue 100.0%, code 100.0%, ticket 0.0%, hash 100.0%

| compaction | truly lost ids | reported | id recall | id precision | docs TP/FP/FN/TN |
|---|---:|---:|---:|---:|---|
| benign: drop filler words | 0 | 0 | n/a | n/a | 0/0/0/300 |
| benign: drop id-free sentences | 0 | 0 | n/a | n/a | 0/0/0/300 |
| benign: strip backticks + collapse | 0 | 0 | n/a | n/a | 0/0/0/300 |
| lossy: drop 30% of sentences | 2070 | 1031 | 49.8% | 100.0% | 272/0/22/6 |
| lossy: keep first half | 3186 | 1605 | 50.4% | 100.0% | 294/0/6/0 |
| lossy: remove one id per sentence | 4343 | 2218 | 51.1% | 100.0% | 300/0/0/0 |
| lossy: alter 1 char/segment of ids | 3317 | 1689 | 50.9% | 100.0% | 296/0/4/0 |

| synonym injection rate | injected | lint recall | lint precision | residual after normalize | exact round-trip | FP on clean docs | surface forms/doc before -> after |
|---:|---:|---:|---:|---:|---:|---:|---|
| 10.0% | 702 | 100.0% | 100.0% | 0 | 100.0% | 0 | 9.74 -> 7.67 |
| 30.0% | 2202 | 100.0% | 100.0% | 0 | 100.0% | 0 | 13.13 -> 7.66 |
| 50.0% | 3550 | 100.0% | 100.0% | 0 | 100.0% | 0 | 15.17 -> 7.66 |
| 100.0% | 7200 | 100.0% | 100.0% | 0 | 100.0% | 0 | 14.00 -> 7.67 |

| size | extract ids (ms) | check (ms) | checksum (ms) | lint (ms) | normalize (ms) |
|---:|---:|---:|---:|---:|---:|
| 1 KB | 0.080 | 0.19 | 0.092 | 0.10 | 0.099 |
| 10 KB | 0.96 | 2.01 | 0.97 | 0.97 | 0.97 |
| 100 KB | 23.82 | 33.15 | 23.37 | 24.18 | 25.18 |
| 1000 KB | 236.89 | 492.58 | 166.77 | 219.45 | 185.76 |

Reading the tables:
- `clean` profile: every injected loss/alteration was detected with no false alarms, benign compactions raised none. Because the corpus is synthetic this shows correctness on covered shapes, not field accuracy.
- `wild` profile: precision stays 100 % but recall falls to about 50 % - exactly the share of ids whose shapes are not extracted (0 % for ticket keys, 6-char/uppercase hashes, bare function names). This is the main limitation; extend `src/ids.mjs` or backtick them.
- Drift: with synonyms injected into canonical text at the given rate, lint found all of them, normalize removed all and restored the original text exactly on this corpus. "Surface forms" counts distinct (concept, wording) pairs per document; it falls to the canonical count. Real prose has inflections and ambiguity (a/an, polysemy such as "take", "journal") that this corpus does not stress; review normalizer output on real text before auto-applying.
- Cost: roughly 0.3 ms per KB for every operation on the machine above.

No claim of token savings is made: this project compresses nothing.

## Tests

`npm test` (node:test): identifier extraction, reference invariant (missing/altered/allow-list), guard (pass, retry, abort, fallback), vocabulary schema/lint/normalize/JSON enums/hash, CLI exit codes, benchmark determinism.

## Licence

Apache-2.0. Copyright 2026 Caelos-Palacio. Original code, inspired by general ideas (controlled vocabulary, reference invariants).

---

# Espanol

**rosetta-guards** son guardas deterministas para la compactacion de contexto de LLM: sin LLM, sin dependencias, Node >= 18.

- **Vocabulario controlado versionado** (termino canonico, definicion, sinonimos prohibidos -> canonico, dominio): validador de esquema, lint de texto/JSON con posicion y sugerencia, normalizador.
- **Invariante de referencia**: los identificadores criticos del original (rutas, hashes, `#123`, `` `codigos` ``, URLs, versiones) deben sobrevivir en cualquier version derivada; checksum del conjunto; `guard(transform)` envuelve cualquier compactacion (tambien una por LLM que tu proveas) y reintenta o aborta ante perdida.

**Lo que NO se incluye:** la compresion por LLM de Rosetta (el "-55 % de tokens"). La especificacion original se perdio, la cifra nunca se midio con tokens reales y la descompresion por LLM no es determinista, asi que no es auditable. Aqui no se comprime nada: se comprueba que lo compactado (por quien sea) no pierde identificadores.

Uso: `rosetta lint vocab.json docs/*.md`, `rosetta check original.md derivado.md`, `rosetta ids archivo.md`. Benchmark: `npm run bench` (corpus sintetico con semilla; las tablas de arriba son las cifras medidas, incluida la limitacion: formas de identificador no cubiertas como `PROJ-12` o hashes de 6 caracteres dan recall ~50 % en el perfil `wild`; ponlas entre backticks para protegerlas).

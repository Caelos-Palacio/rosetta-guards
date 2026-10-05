import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateVocab, compileVocab, lintText, lintJSON, normalize, vocabHash } from '../src/index.mjs';

const def = JSON.parse(readFileSync(new URL('../examples/vocab.json', import.meta.url), 'utf8'));

test('example vocab is valid; bad ones are rejected with reasons', () => {
  assert.equal(validateVocab(def).valid, true);
  const bad = { name: 'x', version: '1', terms: [{ term: 'a' }, { term: 'A', definition: 'd', forbidden: ['a'] }] };
  const { valid, errors } = validateVocab(bad);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => /semver/.test(e)));
  assert.ok(errors.some((e) => /definition/.test(e)));
  assert.ok(errors.some((e) => /duplicate/.test(e)));
  assert.ok(errors.some((e) => /itself a canonical/.test(e)));
  assert.equal(validateVocab(null).valid, false);
  assert.throws(() => compileVocab(bad), /invalid vocabulary/);
});
test('ambiguous synonym mapped to two terms is rejected', () => {
  const d = { name: 'x', version: '1.0.0', terms: [
    { term: 'a', definition: 'd', forbidden: ['z'] }, { term: 'b', definition: 'd', forbidden: ['Z'] }] };
  assert.ok(validateVocab(d).errors.some((e) => /mapped to both/.test(e)));
});
test('lint reports position, canonical and suggestion', () => {
  const f = lintText('First line.\nThe Clip passed the checkpoint.', def);
  assert.equal(f.length, 2);
  assert.deepEqual([f[0].line, f[0].col, f[0].found, f[0].suggestion], [2, 5, 'Clip', 'Shot']);
  assert.equal(f[1].suggestion, 'gate');
  assert.match(f[0].vocab, /film-pipeline@1\.0\.0/);
});
test('lint handles plurals, multiword/hyphen and word boundaries', () => {
  assert.equal(lintText('three clips', def)[0].suggestion, 'shots');
  assert.equal(lintText('a scene-cut here', def)[0].canonical, 'shot');
  assert.equal(lintText('the clipboard and unclipped', def).length, 0);
});
test('lint never flags text inside code, paths or urls', () => {
  assert.equal(lintText('see `clip` and src/clip/outcome.mjs and https://x.org/clip', def).length, 0);
});
test('canonical terms are not flagged', () => {
  assert.equal(lintText('The shot passed the gate with a verdict.', def).length, 0);
});
test('normalize replaces synonyms preserving case and plural; is idempotent', () => {
  const out = normalize('CLIP. Clips and the outcome of a Checkpoint; `clip` stays.', def);
  assert.equal(out, 'SHOT. Shots and the verdict of a Gate; `clip` stays.');
  assert.equal(normalize(out, def), out);
  assert.equal(lintText(out, def).length, 0);
});
test('lintJSON: synonyms in values with JSON path, and enum checks', () => {
  const f = lintJSON({ kind: 'entitty', items: [{ note: 'bad clip' }], other: { kind: 'rule' } }, def);
  const by = Object.fromEntries(f.map((x) => [x.path, x]));
  assert.equal(by['$.kind'].kind, 'enum');
  assert.equal(by['$.kind'].suggestion, 'entity');
  assert.equal(by['$.items[0].note'].suggestion, 'shot');
  assert.equal(f.length, 2);
  assert.equal(lintJSON('{"kind":"zzzzzz"}', def)[0].suggestion, null);
});
test('vocabHash is key-order independent and change sensitive', () => {
  const a = { b: 1, a: [{ y: 1, x: 2 }] }, b = { a: [{ x: 2, y: 1 }], b: 1 };
  assert.equal(vocabHash(a), vocabHash(b));
  assert.notEqual(vocabHash(a), vocabHash({ ...a, b: 2 }));
});

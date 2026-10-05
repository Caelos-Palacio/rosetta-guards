import test from 'node:test';
import assert from 'node:assert/strict';
import { extractIds, idChecksum } from '../src/index.mjs';

const vals = (t) => extractIds(t).map((i) => `${i.type}:${i.value}`);

test('extracts each identifier type', () => {
  const t = 'See src/engine/vocab.mjs and ./a/b.json, commit 3f9a2c1d, issue #123, v1.2.3-beta.1, https://example.com/a/b?x=1. Also `ERR_42` and README.md.';
  const v = vals(t);
  for (const x of ['path:src/engine/vocab.mjs', 'path:./a/b.json', 'hash:3f9a2c1d', 'issue:#123', 'version:v1.2.3-beta.1',
    'url:https://example.com/a/b?x=1', 'code:ERR_42', 'path:README.md']) assert.ok(v.includes(x), x + ' in ' + v);
});
test('does not produce false positives on plain prose', () => {
  const v = vals('Use and/or read/write. Node.js is fine; the number 1234567 and the word decade are not ids.');
  assert.deepEqual(v, []);
});
test('hash needs digit and hex letter, and is not read inside urls/paths', () => {
  assert.deepEqual(vals('deadbeef 12345678'), []);
  assert.deepEqual(vals('https://x.org/abcdef1234'), ['url:https://x.org/abcdef1234']);
});
test('code spans classify to their natural type', () => {
  assert.deepEqual(vals('`src/a/b.mjs`'), ['path:src/a/b.mjs']);
  assert.deepEqual(vals('`#7`'), ['issue:#7']);
});
test('checksum is stable, order independent and sensitive to changes', () => {
  assert.equal(idChecksum('a #1 and #2'), idChecksum('#2 then #1'));
  assert.notEqual(idChecksum('#1 #2'), idChecksum('#1 #3'));
  assert.equal(idChecksum('see `src/a/b.mjs`'), idChecksum('see src/a/b.mjs'));
});
test('extraction is deterministic', () => {
  const t = 'x #1 y src/a/b.mjs z 3f9a2c1';
  assert.deepEqual(extractIds(t), extractIds(t));
});

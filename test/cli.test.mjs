import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const bin = new URL('../bin/rosetta.mjs', import.meta.url).pathname;
const vocab = new URL('../examples/vocab.json', import.meta.url).pathname;
const dir = mkdtempSync(join(tmpdir(), 'rg-'));
const w = (n, s) => { const p = join(dir, n); writeFileSync(p, s); return p; };
const run = (...a) => spawnSync('node', [bin, ...a], { encoding: 'utf8' });

test('lint exits 1 with findings, 0 when clean', () => {
  const bad = run('lint', vocab, w('a.md', 'the clip\n'));
  assert.equal(bad.status, 1); assert.match(bad.stdout, /a\.md:1:5 {2}"clip" -> "shot"/);
  assert.equal(run('lint', vocab, w('b.md', 'the shot\n')).status, 0);
  const j = JSON.parse(run('lint', vocab, w('c.json', '{"kind":"nope","n":"a ruling"}'), '--json').stdout);
  assert.equal(j.findings.length, 2);
});
test('check exits 1 on loss and 0 on preserved', () => {
  const o = w('o.md', 'fix #7 in src/a/b.mjs');
  const bad = run('check', o, w('d1.md', 'fix in src/a/b.mjs'));
  assert.equal(bad.status, 1); assert.match(bad.stdout, /MISSING issue #7/);
  assert.equal(run('check', o, w('d2.md', 'src/a/b.mjs #7')).status, 0);
});
test('ids lists identifiers and checksum', () => {
  const r = run('ids', w('i.md', '#9 and 3f9a2c1'));
  assert.equal(r.status, 0); assert.match(r.stdout, /issue\t#9/); assert.match(r.stdout, /checksum [0-9a-f]{64}/);
});
test('usage and bad vocab give exit 2', () => {
  assert.equal(run().status, 2);
  assert.equal(run('lint', w('v.json', '{"name":"x"}'), w('e.md', 'x')).status, 2);
  assert.equal(run('validate', vocab).status, 0);
});

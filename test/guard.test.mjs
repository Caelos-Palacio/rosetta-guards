import test from 'node:test';
import assert from 'node:assert/strict';
import { referenceInvariant, guard, GuardError } from '../src/index.mjs';

const ORIG = 'Fixed #12 in src/core/run.mjs at 3f9a2c1 (v2.0.1). Docs: https://example.org/doc. Very basically it works.';

test('invariant passes for a benign compaction', () => {
  const r = referenceInvariant(ORIG, 'Fixed #12, src/core/run.mjs, 3f9a2c1, v2.0.1, https://example.org/doc. Works.');
  assert.equal(r.ok, true);
  assert.equal(r.checksum.original, r.checksum.derived);
});
test('missing ids are reported', () => {
  const r = referenceInvariant(ORIG, 'Fixed an issue in src/core/run.mjs (v2.0.1). Works.');
  assert.equal(r.ok, false);
  const m = r.losses.map((l) => l.value).sort();
  assert.deepEqual(m, ['#12', '3f9a2c1', 'https://example.org/doc'].sort());
  assert.ok(r.losses.every((l) => l.kind === 'missing'));
});
test('altered ids are reported as altered with what replaced them', () => {
  const r = referenceInvariant(ORIG, 'Fixed #13 in src/core/run.mjs at 3f9a2c (v2.0.1). https://example.org/doc');
  const by = Object.fromEntries(r.losses.map((l) => [l.value, l]));
  assert.equal(by['#12'].kind, 'altered');
  assert.equal(by['#12'].foundInstead, '#13');
  assert.equal(by['3f9a2c1'].kind, 'altered');
});
test('allow list and types filter', () => {
  const r = referenceInvariant(ORIG, 'nothing', { allow: ['#12', '3f9a2c1', 'https://example.org/doc', 'v2.0.1'] });
  assert.deepEqual(r.losses.map((l) => l.value), ['src/core/run.mjs']);
  assert.equal(referenceInvariant(ORIG, 'nothing', { types: ['issue'] }).losses.length, 1);
});
test('guard passes through a good transform', async () => {
  const g = guard((t) => t.replace(/Very basically /, ''));
  const r = await g(ORIG);
  assert.equal(r.ok, true); assert.equal(r.attempts, 1);
});
test('guard aborts with GuardError when ids are lost', async () => {
  const g = guard(() => 'summary without ids', { retries: 1 });
  await assert.rejects(g(ORIG), (e) => e instanceof GuardError && e.attempts === 2 && e.losses.length > 0);
});
test('guard retries and gives the transform the losses', async () => {
  let seen;
  const g = guard((t, ctx) => { seen = ctx; return ctx.attempt === 0 ? 'lossy' : t; });
  const r = await g(ORIG);
  assert.equal(r.attempts, 2); assert.ok(seen.losses.length > 0);
});
test('guard can fall back to the original', async () => {
  const r = await guard(async () => 'x', { retries: 0, onFail: 'original' })(ORIG);
  assert.equal(r.fellBack, true); assert.equal(r.output, ORIG); assert.equal(r.ok, false);
});
test('guard validates its inputs', async () => {
  assert.throws(() => guard(null), TypeError);
  await assert.rejects(guard(() => 5)(ORIG), TypeError);
});

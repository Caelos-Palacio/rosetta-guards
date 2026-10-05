import test from 'node:test';
import assert from 'node:assert/strict';
import { runBench } from '../bench/run.mjs';

const strip = (r) => JSON.stringify({ p: r.profiles, d: r.drift });
test('benchmark is deterministic for a given seed and meets sanity floors', () => {
  const a = runBench({ docs: 40, seed: 5 }), b = runBench({ docs: 40, seed: 5 });
  assert.equal(strip(a), strip(b));
  for (const x of a.profiles.clean.loss) {
    if (x.compaction.startsWith('benign')) assert.equal(x.reported, 0, x.compaction);
    else { assert.ok(x.idRecall >= 0.99, x.compaction); assert.ok(x.idPrecision >= 0.99, x.compaction); }
  }
  assert.ok(a.profiles.wild.extraction.recall < 0.9); // wild profile is deliberately hard
  assert.equal(a.profiles.wild.extraction.falsePositives, 0);
  for (const d of a.drift) { assert.ok(d.recall >= 0.99 && d.precision >= 0.99); assert.equal(d.residualAfterNormalize, 0); assert.equal(d.falsePositivesOnCleanDocs, 0); }
});

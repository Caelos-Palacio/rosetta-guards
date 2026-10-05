#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { compileVocab, validateVocab, lintText, lintJSON, referenceInvariant, extractIds, idChecksum } from '../src/index.mjs';

const USAGE = `rosetta <command>
  lint <vocab.json> <file...> [--json]   report forbidden synonyms / off-enum values (exit 1 if any)
  check <original> <derived> [--json]    reference invariant: ids of original must survive in derived (exit 1 on loss)
  ids <file> [--json]                    list critical identifiers and their checksum
  validate <vocab.json>                  validate a vocabulary definition`;

const args = process.argv.slice(2);
const json = args.includes('--json');
const pos = args.filter((a) => !a.startsWith('--'));
const read = (f) => readFileSync(f, 'utf8');
const die = (m, code = 2) => { console.error(m); process.exit(code); };

try {
  const [cmd, ...rest] = pos;
  if (cmd === 'validate' && rest.length === 1) {
    const r = validateVocab(JSON.parse(read(rest[0])));
    if (json) console.log(JSON.stringify(r, null, 2));
    else console.log(r.valid ? 'OK' : r.errors.map((e) => 'error: ' + e).join('\n'));
    process.exit(r.valid ? 0 : 1);
  } else if (cmd === 'lint' && rest.length >= 2) {
    const def = JSON.parse(read(rest[0]));
    const v = validateVocab(def);
    if (!v.valid) die('invalid vocabulary:\n' + v.errors.map((e) => '  ' + e).join('\n'));
    const c = compileVocab(def);
    const all = [];
    for (const f of rest.slice(1)) {
      const txt = read(f);
      const isJson = f.endsWith('.json');
      const items = isJson ? lintJSON(txt, c).map((x) => ({ file: f, ...x })) : lintText(txt, c).map((x) => ({ file: f, ...x }));
      all.push(...items);
    }
    if (json) console.log(JSON.stringify({ vocab: `${c.name}@${c.version}`, findings: all }, null, 2));
    else {
      for (const x of all) {
        const where = x.path ? `${x.file} ${x.path}${x.line ? `:${x.line}:${x.col}` : ''}` : `${x.file}:${x.line}:${x.col}`;
        console.log(`${where}  "${x.found}"${x.suggestion ? ` -> "${x.suggestion}"` : ''}${x.kind === 'enum' ? ` (allowed: ${x.allowed.join(', ')})` : ''}`);
      }
      console.log(`${all.length} finding(s) [${c.name}@${c.version}]`);
    }
    process.exit(all.length ? 1 : 0);
  } else if (cmd === 'check' && rest.length === 2) {
    const r = referenceInvariant(read(rest[0]), read(rest[1]));
    if (json) console.log(JSON.stringify(r, null, 2));
    else {
      for (const l of r.losses) console.log(`${l.kind.toUpperCase()} ${l.type} ${l.value}${l.foundInstead ? `  (derived has: ${l.foundInstead})` : ''}`);
      console.log(r.ok ? `OK: all ${r.total} identifiers preserved` : `LOSS: ${r.losses.length} of ${r.total} identifiers lost`);
    }
    process.exit(r.ok ? 0 : 1);
  } else if (cmd === 'ids' && rest.length === 1) {
    const ids = extractIds(read(rest[0]));
    if (json) console.log(JSON.stringify({ checksum: idChecksum(ids), ids }, null, 2));
    else { for (const i of ids) console.log(`${i.type}\t${i.value}`); console.log(`checksum ${idChecksum(ids)}`); }
  } else die(USAGE);
} catch (e) {
  die(`error: ${e.message}`);
}

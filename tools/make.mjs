// The one command after any change: rebuilds what is generated, then checks the documents against the code.
//
//   node tools/make.mjs           writes service/server.mjs (the parts joined), docs/code-map.md, docs/registry.md and
//                                 docs/rules.md when they differ, then runs tools/check-docs.mjs and the header check
//                                 (checkParts in tools/parts.mjs); docs/status.md and its check too (tools/status.mjs)
//   node tools/make.mjs --check   changes nothing: fails if any of the five is stale or a check finds a problem
//
// It exits 1 on any problem, with one line each.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildServer } from './build-server.mjs';
import { codeMap } from './code-map.mjs';
import { checkDocs, rulesIndex, describe } from './check-docs.mjs';
import { checkParts, registry } from './parts.mjs';
import { checkStatus, statusTable } from './status.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');
const MADE = [
  ['service/server.mjs', buildServer, 'node tools/build-server.mjs'],
  ['docs/code-map.md', () => codeMap(), 'node tools/code-map.mjs'],
  ['docs/registry.md', () => registry(), 'the parts and their headers (tools/parts.mjs)'],
  ['docs/rules.md', () => rulesIndex(ROOT), 'the rule files in docs/rules/'],
  ['docs/status.md', () => statusTable(), 'the rule files and the tests (tools/status.mjs)'],
];

let failed = false;
for (const [file, make, from] of MADE) {
  const want = make();
  let have = null;
  try { have = readFileSync(join(ROOT, file), 'utf8'); } catch {}
  if (have === want) { console.log(`${file} is current.`); continue; }
  if (check) {
    console.error(`${file} is stale (it is made by ${from}): run node tools/make.mjs.`);
    failed = true;
  } else {
    writeFileSync(join(ROOT, file), want);
    console.log(`Wrote ${file}.`);
  }
}

const problems = [...checkDocs(ROOT), ...checkParts(ROOT), ...checkStatus(ROOT)];
for (const p of problems) console.error(describe(p));
if (problems.length) {
  console.error(`The documents have drifted from the code (${problems.length} problem${problems.length === 1 ? '' : 's'}): fix the document, or the code if the document is right.`);
  failed = true;
} else {
  console.log('The documents match the code.');
}
process.exit(failed ? 1 : 0);

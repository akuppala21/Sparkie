// service/server.mjs is service/src/*.mjs joined in name order, exactly as they are: one runtime module (so nothing
// about how it runs changes), kept in parts small enough to read. Edit the parts, never server.mjs, then:
//
//   node tools/build-server.mjs           writes service/server.mjs
//   node tools/build-server.mjs --check   exits 1 if service/server.mjs isn't what the parts make (the tests, lock.mjs
//                                          and the installer run this)
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVICE = join(dirname(fileURLToPath(import.meta.url)), '..', 'service');
const SRC = join(SERVICE, 'src'), OUT = join(SERVICE, 'server.mjs');

export function buildServer() {
  const parts = readdirSync(SRC).filter(f => /^\d{2}-[a-z0-9-]+\.mjs$/.test(f)).sort();
  if (!parts.length) throw new Error(`No parts in ${SRC}.`);
  return parts.map(f => readFileSync(join(SRC, f), 'utf8')).join('');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const built = buildServer();
  if (process.argv.includes('--check')) {
    let current = '';
    try { current = readFileSync(OUT, 'utf8'); } catch {}
    if (current !== built) {
      console.error('service/server.mjs doesn’t match service/src/*.mjs: edit the parts, then run node tools/build-server.mjs.');
      process.exit(1);
    }
    console.log('service/server.mjs matches its parts.');
  } else {
    writeFileSync(OUT, built);
    console.log(`Wrote service/server.mjs from ${readdirSync(SRC).filter(f => f.endsWith('.mjs')).length} parts.`);
  }
}

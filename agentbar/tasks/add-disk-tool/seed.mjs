// Nothing to plant: the repository as it is. (Fails loudly if a disk_free tool already exists, so the task stays a
// real one.)
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const work = process.argv[2];
const src = readdirSync(join(work, 'service/src')).filter(f => f.endsWith('.mjs')).map(f => readFileSync(join(work, 'service/src', f), 'utf8')).join('\n');
if (/name:\s*'disk_free'/.test(src)) throw new Error('add-disk-tool: disk_free already exists; pick another feature for this task');

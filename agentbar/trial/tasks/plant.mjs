// One task's seed, the same for every task: swaps one exact piece of a part for its broken form, writes the task's
// failing test (with its Covers line), and makes the generated files from the broken tree, as a real slip would have
// shipped. node agentbar/trial/plant.mjs <task folder> <workspace>
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const [task, work] = process.argv.slice(2);
const def = JSON.parse(readFileSync(join(task, 'task.json'), 'utf8')), { file, good, bad } = def.plant;
const f = join(work, file), s = readFileSync(f, 'utf8');
if (s.split(good).length !== 2) throw new Error(`${def.id}: the code to plant the bug in has changed (${file}); update its task.json`);
writeFileSync(f, s.replace(good, bad));
writeFileSync(join(work, def.test), readFileSync(join(task, 'test.mjs'), 'utf8'));
execFileSync(process.execPath, [join(work, 'tools/make.mjs')], { cwd: work, stdio: 'ignore' });

// Plants the bug: the model list checks a container's status text ("Up 3 minutes") instead of its state ("running"),
// so no model on a Spark ever counts as running. Then rebuilds server.mjs, as a real slip would have shipped.
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const work = process.argv[2];
const f = join(work, 'service/src/15-routes.mjs');
const good = "sp.deployments.filter(d => d.state === 'running' && !d.rank && d.role !== 'main' && d.endpoint)";
const s = readFileSync(f, 'utf8');
if (!s.includes(good)) throw new Error('fix-model-list: the code to plant the bug in has changed; update seed.mjs');
writeFileSync(f, s.replace(good, good.replace("d.state === 'running'", "d.status === 'running'")));
execFileSync(process.execPath, [join(work, 'tools/build-server.mjs')], { cwd: work, stdio: 'ignore' });

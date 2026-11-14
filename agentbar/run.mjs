#!/usr/bin/env node
// The agent bar (docs/contract.md 10.4) and the engine trial (3.8): real tasks the owner uses Claude Code for, done by
// an agent engine driving the brain, alone, from one request. Each run gets a fresh copy of this repository (the task
// planted in it), runs the engine in a container (no Docker socket, no SSH keys, no home folder: it can't touch the
// Sparks), then grades the result with checks the engine never saw. Run it on a Spark with Docker:
//
//   node agentbar/run.mjs                                   both engines, every task, 3 runs each
//   node agentbar/run.mjs --engines opencode --tasks diagnose-crash --runs 1
//   node agentbar/run.mjs --brain https://akspark2.tailab9aa9.ts.net:8443/console/api/v1 --model sparkie
//
// Results go to agentbar/results/<time>/: results.jsonl (one line per run), each run's transcript, and summary.md.
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, cpSync, rmSync, readdirSync, existsSync, createWriteStream } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENGINES } from './engines.mjs';
import { testPrints } from './grade-lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url)), REPO = join(HERE, '..');
const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt; };
const has = name => process.argv.includes(`--${name}`);
const TASKS_ALL = readdirSync(join(HERE, 'tasks')).filter(t => existsSync(join(HERE, 'tasks', t, 'task.json'))).sort();
const engines = arg('engines', Object.keys(ENGINES).join(',')).split(',').filter(Boolean);
const tasks = arg('tasks', TASKS_ALL.join(',')).split(',').filter(Boolean);
const RUNS = Number(arg('runs', 3)), IMAGE = arg('image', 'spark-agentbar'), KEEP = has('keep');
// --dry: every step but the container and the brain. Each run is prepared (copied, planted, the engine configured, its
// exact command written to command.json) and the untouched workspace is graded, which must fail. For checking the kit.
const DRY = has('dry');
// The one model address (contract 9.9), through Spark Console: the brain itself listens only on Spark 2's own 127.0.0.1.
const BRAIN = arg('brain', 'https://akspark2.tailab9aa9.ts.net:8443/console/api/v1').replace(/\/$/, '');
const STAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const OUT = arg('out', join(HERE, 'results', STAMP));
for (const e of engines) if (!ENGINES[e]) throw new Error(`No engine called ${e}. Engines: ${Object.keys(ENGINES).join(', ')}`);
for (const t of tasks) if (!TASKS_ALL.includes(t)) throw new Error(`No task called ${t}. Tasks: ${TASKS_ALL.join(', ')}`);

const sh = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', ...opts });
function must(cmd, args, what) {
  const r = sh(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  if (r.status !== 0) throw new Error(`${what} failed: ${(r.stderr || r.stdout || r.error?.message || '').trim().slice(-800)}`);
  return r.stdout;
}

// --- before anything: Docker, the image, the brain ---
if (!DRY) must('docker', ['version', '--format', '{{.Server.Version}}'], 'Docker (is it installed, and can this user run it?)');
// (Docker's cache makes this quick after the first time; --no-build uses the image as it is.)
if (!DRY && (!has('no-build') || sh('docker', ['image', 'inspect', IMAGE]).status !== 0)) {
  console.log(`Building the trial image ${IMAGE} (both engines, pinned versions) …`);
  const b = sh('docker', ['build', '-t', IMAGE, HERE], { stdio: 'inherit' });
  if (b.status !== 0) throw new Error('docker build failed');
}
const models = DRY ? { data: [{ id: 'qwen-aphex' }] } : await fetch(`${BRAIN}/models`, { signal: AbortSignal.timeout(15000) }).then(r => r.json()).catch(e => { throw new Error(`The brain doesn't answer at ${BRAIN}/models: ${e.message}`); });
const MODEL = arg('model', models.data?.[0]?.id);
if (!MODEL) throw new Error(`The brain at ${BRAIN} lists no model.`);
const setup = DRY ? null : await fetch(`${BRAIN.replace(/\/v1$/, '')}/get_server_info`, { signal: AbortSignal.timeout(10000) }).then(r => r.json()).catch(() => null);
// What the engines are told the context is: the brain's own, never past its native 262K (contract 3.8).
const CONTEXT = Math.min(Number(arg('context', 0)) || Number(setup?.context_length || setup?.server_args?.context_length) || 262144, 262144);

mkdirSync(OUT, { recursive: true });
const meta = { at: new Date().toISOString(), brain: BRAIN, model: MODEL, context: CONTEXT, engines: Object.fromEntries(engines.map(e => [e, ENGINES[e].version])), tasks, runs: RUNS,
  thinking: 'on (the agent setup, contract 3.8)', image: IMAGE };
writeFileSync(join(OUT, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`);
console.log(`Brain: ${MODEL} at ${BRAIN} (context ${CONTEXT}). Engines: ${engines.join(', ')}. Tasks: ${tasks.join(', ')}. ${RUNS} run(s) each.\nResults: ${relative(process.cwd(), OUT)}\n`);

// --- one run ---
let counter = 0;
async function runOne(engine, task, n) {
  const id = `${engine}-${task}-${n}`, dir = join(OUT, 'runs', id), work = join(dir, 'work'), home = join(dir, 'home');
  const def = JSON.parse(readFileSync(join(HERE, 'tasks', task, 'task.json'), 'utf8'));
  mkdirSync(home, { recursive: true });
  // A fresh copy of this repository, without the agent bar itself (its checks stay hidden) or past results.
  cpSync(REPO, work, { recursive: true, filter: src => { const r = relative(REPO, src); return !/^(agentbar|node_modules|\.git)(\/|$)/.test(r) && !/(^|\/)\.claude(\/|$)/.test(r); } });
  must(process.execPath, [join(HERE, 'tasks', task, 'seed.mjs'), work], `planting ${task}`);
  writeFileSync(join(dir, 'pristine.json'), JSON.stringify(testPrints(work)));
  const env = { BRAIN_URL: BRAIN, BRAIN_MODEL: MODEL, APP_PORT: String(18080 + (counter++ % 100)) };
  const prompt = readFileSync(join(HERE, 'tasks', task, 'prompt.md'), 'utf8').replace(/\{\{(\w+)\}\}/g, (_, k) => env[k] ?? '');
  writeFileSync(join(dir, 'prompt.md'), prompt);
  const eng = ENGINES[engine];
  const engineEnv = eng.configure({ home, work, brain: BRAIN, model: MODEL, context: CONTEXT, maxTokens: 32768 }) || {};
  const command = eng.command({ prompt, model: MODEL, minutes: def.minutes });
  writeFileSync(join(dir, 'command.json'), `${JSON.stringify({ env: { ...env, ...engineEnv }, command }, null, 2)}\n`);
  if (DRY) {
    const g = sh(process.execPath, [join(HERE, 'grade.mjs'), task, work, join(dir, 'pristine.json')], { env: { ...process.env, ...env }, timeout: 40 * 60000 });
    let graded;
    try { graded = JSON.parse(String(g.stdout).trim().split('\n').pop()); } catch { graded = { pass: false, checks: [{ name: 'the grader ran', pass: false, detail: `${g.stdout}\n${g.stderr}`.slice(-800) }] }; }
    const result = { engine, task, run: n, pass: graded.pass, minutes: 0, timedOut: false, exit: null, dry: true, checks: graded.checks };
    appendFileSync(join(OUT, 'results.jsonl'), `${JSON.stringify(result)}\n`);
    if (!KEEP) rmSync(work, { recursive: true, force: true });
    return result;
  }
  const name = `agentbar-${id}`.replace(/[^a-zA-Z0-9_.-]/g, '-');
  sh('docker', ['rm', '-f', name]);
  const uid = process.getuid?.() ?? 1000, gid = process.getgid?.() ?? 1000;
  must('docker', ['run', '-d', '--name', name, '--network', 'host', '--user', `${uid}:${gid}`, '--memory', '24g', '--cpus', '8', '--pids-limit', '4096',
    '-e', 'HOME=/home/agent', ...Object.entries({ ...env, ...engineEnv }).flatMap(([k, v]) => ['-e', `${k}=${v}`]),
    '-v', `${work}:/work`, '-v', `${home}:/home/agent`, '-w', '/work', IMAGE, 'sleep', 'infinity'], `starting the container for ${id}`);
  const t0 = Date.now(), seconds = def.minutes * 60;
  const out = createWriteStream(join(dir, 'transcript.jsonl')), err = createWriteStream(join(dir, 'engine-stderr.txt'));
  const code = await new Promise(resolve => {
    const p = spawn('docker', ['exec', '-w', '/work', name, 'timeout', '--signal=TERM', '--kill-after=30', String(seconds),
      ...command], { stdio: ['ignore', 'pipe', 'pipe'] });
    p.stdout.pipe(out); p.stderr.pipe(err);
    p.on('close', c => resolve(c));
  });
  const took = Math.round((Date.now() - t0) / 1000), timedOut = code === 124 || code === 137;
  // Grade, with checks the engine never saw (copied in only now).
  must('docker', ['exec', name, 'mkdir', '-p', '/tmp/grade'], 'making the checks folder');
  for (const f of ['grade.mjs', 'grade-lib.mjs', 'tasks']) must('docker', ['cp', join(HERE, f), `${name}:/tmp/grade/${f}`], 'copying the checks in');
  must('docker', ['cp', join(dir, 'pristine.json'), `${name}:/tmp/grade/pristine.json`], 'copying the starting point in');
  const g = sh('docker', ['exec', '-w', '/work', name, 'node', '/tmp/grade/grade.mjs', task, '/work', '/tmp/grade/pristine.json'], { timeout: 40 * 60000 });
  let graded;
  try { graded = JSON.parse(String(g.stdout).trim().split('\n').pop()); } catch { graded = { pass: false, checks: [{ name: 'the grader ran', pass: false, detail: `${g.stdout}\n${g.stderr}`.slice(-800) }] }; }
  sh('docker', ['rm', '-f', name]);
  const result = { engine, task, run: n, pass: graded.pass, minutes: +(took / 60).toFixed(1), timedOut, exit: code, checks: graded.checks };
  appendFileSync(join(OUT, 'results.jsonl'), `${JSON.stringify(result)}\n`);
  if (!KEEP) rmSync(work, { recursive: true, force: true });
  return result;
}

// --- all runs: engines take turns on each task, so the brain's load is the same for both ---
const results = [];
for (let n = 1; n <= RUNS; n++) {
  for (const task of tasks) {
    for (const engine of engines) {
      const r = await runOne(engine, task, n);
      results.push(r);
      const failed = r.checks.filter(c => !c.pass).map(c => c.name);
      console.log(`${r.pass ? 'pass' : 'FAIL'}  ${engine.padEnd(9)} ${task.padEnd(16)} run ${n}  ${String(r.minutes).padStart(5)} min${r.timedOut ? ' (ran out of time)' : ''}${failed.length ? `  ${failed.join('; ')}` : ''}`);
    }
  }
}

// --- summary: a task meets the bar when at least 2 of 3 runs pass (10.4) ---
const need = Math.ceil((2 / 3) * RUNS);
const lines = [`# Agent bar: ${meta.at}`, '', `Brain: \`${MODEL}\` at ${BRAIN}, context ${CONTEXT}. A task meets the bar when ${need} of ${RUNS} runs pass.`, ''];
lines.push(`| Task | ${engines.map(e => `${e} (${ENGINES[e].version})`).join(' | ')} |`, `|---|${engines.map(() => '---').join('|')}|`);
const score = {};
for (const task of tasks) {
  lines.push(`| ${task} | ${engines.map(e => {
    const rs = results.filter(r => r.engine === e && r.task === task), ok = rs.filter(r => r.pass).length;
    const mins = rs.map(r => r.minutes).sort((a, b) => a - b)[Math.floor(rs.length / 2)] ?? 0;
    score[e] ||= { met: 0, minutes: 0 };
    if (ok >= need) score[e].met++;
    score[e].minutes += rs.reduce((t, r) => t + r.minutes, 0);
    return `${ok}/${rs.length}${ok >= need ? ' ✓' : ''} · ${mins} min`;
  }).join(' | ')} |`);
}
const ranked = Object.entries(score).sort((a, b) => b[1].met - a[1].met || a[1].minutes - b[1].minutes);
lines.push('', DRY ? '**Dry run:** nothing ran, so there is no winner. Every untouched task should show 0 passes.'
  : !ranked[0][1].met ? `**No winner yet:** no engine met the bar on any task.`
    : `**Winner:** ${ranked[0][0]} (${ranked[0][1].met} of ${tasks.length} tasks meet the bar${ranked[1] ? `; ${ranked[1][0]}: ${ranked[1][1].met}` : ''}). Ties go to the faster one.`);
writeFileSync(join(OUT, 'summary.md'), `${lines.join('\n')}\n`);
writeFileSync(join(OUT, 'summary.json'), `${JSON.stringify({ ...meta, score, results }, null, 2)}\n`);
console.log(`\n${lines.join('\n')}\n\nSaved ${relative(process.cwd(), OUT)}/summary.md`);

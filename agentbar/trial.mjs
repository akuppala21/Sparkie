#!/usr/bin/env node
// The coding trial (C8a; contract 10.4, T100; R67): can the brain in use change Spark Console's own code? Each task is
// a slip planted in a copy of this repository, with a failing test that shows it. The brain works alone, with a loop
// and two tools shaped as Sparkie's in its box will be, and code scores each run: the task's test passes, the short
// check passes, no existing test line changed, no protected path touched, the generated files are the build's. The
// bar is the contract's (10.4): every task passes at least 2 of 3 runs. The run's one record is kept with the profile
// of the brain serving now (POST /main/trial: the owner's, with the passkey's press on the page), and
// trialPassed() (service/src/21-brain-trial.mjs) is what propose_update asks.
//
// A STAND-IN: the box and its tools (A4: run and write_file with on: "box") aren't built yet. The loop and the two
// tools here stand in for them, with the same shapes: run {on: "box", command, root?, dir?, minutes?} and
// write_file {on: "box", path, text, from?, to?, root?}. The box is a container from node:26-bookworm with no network,
// no Docker socket and no keys, holding the copy at /work: the brain's commands run there, and so does the grade.
//
//   bash agentbar/trial-on-spark.sh                   on a compute Spark: every task, 3 runs each (the bar's)
//   node agentbar/trial.mjs --dry                     no brain and no box: each untouched task is graded, and must fail
//   node agentbar/trial.mjs --store <record.json>     from your own device on the tailnet: keep a record
//
// --runs <n> (3), --tasks <a,b> (a try), --brain <model address>/v1 and --model <id> (the one address, Sparkie's
// model), --console <api address> (who the brain is, and where --store sends), --box docker|local (local is a try),
// --short <files> (another short check: a try), --out <folder>, --keep (each run's copy), --stand-in (the test suite's).
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, cpSync, rmSync, existsSync, lstatSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, relative, resolve, isAbsolute, posix, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { taskSet, gradeTask, shortCheck, recordHash } from './trial-lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url)), REPO = resolve(HERE, '..'), TASKS = join(HERE, 'trial', 'tasks');
const argv = process.argv.slice(2);
const arg = (name, dflt = null) => { const i = argv.indexOf(`--${name}`); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : dflt; };
const has = name => argv.includes(`--${name}`);
const die = (t, code = 1) => { console.error(t); process.exit(code); };
const CONSOLE = String(arg('console', 'https://akspark2.tailab9aa9.ts.net:8443/console/api')).replace(/\/$/, '');

// --store <file>: only send a saved record to the console, as the owner (Tailscale, or this device signed in, says who
// you are), and say what it said. A Spark's own address is refused there: send it from your own device.
const STORE = arg('store');
if (STORE) {
  let record;
  try { record = JSON.parse(readFileSync(STORE, 'utf8')); } catch (e) { die(`Can’t read ${STORE}: ${e.message}`); }
  if (record?.dry || record?.tried) die(`Not sent: that was ${record.dry ? 'a dry run, with no brain' : 'a try of the runner'}, not a trial.`);
  console.log(`Sending the record with sha256 ${recordHash(record)} to ${CONSOLE}/main/trial …`);
  const origin = arg('origin', new URL(CONSOLE).origin);
  const r = await fetch(`${CONSOLE}/main/trial`, { method: 'POST', signal: AbortSignal.timeout(30000), headers: { 'content-type': 'application/json', 'x-spark-console': '1', origin }, body: JSON.stringify(record) })
    .catch(e => die(`Spark Console doesn’t answer at ${CONSOLE} (${e.cause?.code || e.message}).`));
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  if (!r.ok) die(`Not kept (${r.status}): ${json?.error || text.slice(0, 300)}`);
  console.log(json?.says || 'Kept.');
  process.exit(json?.stored === false && !json?.waiting ? 1 : 0);
}

const DRY = has('dry'), STAND_IN = has('stand-in'), KEEP = has('keep');
const SET = taskSet(TASKS), TASK_IDS = arg('tasks', SET.ids.join(',')).split(',').filter(Boolean);
for (const t of TASK_IDS) if (!SET.ids.includes(t)) die(`No task called ${t}. Tasks: ${SET.ids.join(', ')}`);
const RUNS = Number(arg('runs', DRY ? 1 : 3));
if (!Number.isInteger(RUNS) || RUNS < 1 || RUNS > 10) die('--runs takes 1 to 10.');
const BOX = DRY ? 'local' : arg('box', 'docker'), BOX_IMAGE = arg('image', 'node:26-bookworm');
if (!['docker', 'local'].includes(BOX)) die('--box is docker or local.');
const SHORT = arg('short') ? arg('short').split(',').filter(Boolean) : await shortCheck(REPO);
// What makes a run a try, not a trial (Spark Console keeps no try): part of the set, commands outside a box, another
// short check.
const TRIED = [TASK_IDS.length !== SET.ids.length && 'part of the task set', BOX === 'local' && !DRY && 'commands outside a box', arg('short') && 'another short check'].filter(Boolean);
const BRAIN = String(arg('brain', `${CONSOLE}/v1`)).replace(/\/$/, '');
const STAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const OUT = resolve(arg('out', join(HERE, 'results', `trial-${STAMP}`)));
// (the results' folder, when it is inside this repository, stays out of each run's copy)
const OUT_IN = (r => (r && r !== '..' && !r.startsWith(`..${sep}`) && !isAbsolute(r) ? r.split(sep).join('/') : null))(relative(REPO, OUT));
const sha = b => createHash('sha256').update(b).digest('hex');
const STEPS = 120;          // limit: brain requests in one task (design A 2.10: 120 steps a task)
const OUT_CHARS = 6000;     // limit: one result to the brain (the first 2,000 and the last 3,500 characters)
const TEXT_MAX = 128 * 1024; // limit: one write_file's text
const KEEP_OUT = 16 * 1024 * 1024; // limit: a command's output kept

// --- the build, what its brain reads, and the brain ---
// The build and the mark (what the brain reads in this build: the lock's brainReads, R29) come from one stand-in
// console of this tree, as test/eval.mjs takes them; a dry run takes the build alone.
const buildOf = () => sha(Buffer.concat(['server.mjs', 'dig.mjs', 'passkey.mjs'].map(f => readFileSync(join(REPO, 'service', f))))).slice(0, 12);
async function markAndStandIn() {
  const { startMock } = await import(pathToFileURL(join(REPO, 'test', 'start-mock.mjs')).href);
  const { brainSent, brainReadsOf } = await import(pathToFileURL(join(REPO, 'test', 'lock.mjs')).href);
  const fleet = await startMock();
  try {
    const { build } = await (await fetch(`${fleet.base}/health`)).json();
    const reads = brainReadsOf(await brainSent(fleet, { start: startMock }));
    const brain = STAND_IN ? (await (await fetch(`${fleet.base}/v1/models`)).json())?.spark_console?.brain : null;
    return { build, reads, brain };
  } finally { await fleet.stop(); }
}
// The brain serving now, as the console names it (GET /v1/models, the one route a compute Spark may use): the record
// is tied to it. On the stand-in fleet (--stand-in), its own.
const brainOf = b => ({ standIn: STAND_IN, key: b.key, setup: b.setup ?? null, model: b.model ?? null, engine: b.engine ?? null, image: b.image ?? null, flags: (b.flags || []).map(String) });

let MARK = { build: buildOf(), reads: null }, BRAIN_SEEN = null, MODEL = arg('model');
if (!DRY) {
  if (BOX === 'docker') {
    const v = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], { encoding: 'utf8' });
    if (v.status !== 0) die(`Docker doesn’t answer here (is it installed, and can this user run it?): ${(v.stderr || v.error?.message || '').trim().slice(-300)}`);
    if (spawnSync('docker', ['image', 'inspect', BOX_IMAGE], { stdio: 'ignore' }).status !== 0) {
      console.log(`Getting the box's image ${BOX_IMAGE} …`);
      if (spawnSync('docker', ['pull', '-q', BOX_IMAGE], { stdio: 'inherit' }).status !== 0) die(`Couldn’t get ${BOX_IMAGE}.`);
    }
  }
  let serving = null;
  if (!STAND_IN) {
    const seen = await fetch(`${CONSOLE}/v1/models`, { signal: AbortSignal.timeout(60000) }).then(r => r.json()).catch(e => die(`Spark Console doesn’t answer at ${CONSOLE}/v1/models (${e.cause?.code || e.message}).`));
    serving = seen?.spark_console?.brain;
    if (!/^[0-9a-f]{16}$/.test(String(serving?.key))) die(`Spark Console at ${CONSOLE} doesn’t say which brain serves (a build from before R52, or no model is set up), so a record couldn’t be kept. Nothing ran.`);
    MODEL ||= (seen.data || []).find(m => !m.spark && m.id !== 'sparkie')?.id || 'sparkie';
    const health = await fetch(`${CONSOLE}/health`, { signal: AbortSignal.timeout(15000) }).then(r => r.json()).catch(() => null);
    if (health?.build && health.build !== MARK.build) console.log(`Note: Spark Console runs build ${health.build}, and this copy is build ${MARK.build}. The record counts there only if what the brain reads is the same in both.`);
  }
  console.log('Marking what this build’s brain reads (one stand-in console of this copy) …');
  const m = await markAndStandIn();
  MARK = { build: m.build, reads: m.reads };
  if (STAND_IN) serving = m.brain;
  if (!/^[0-9a-f]{16}$/.test(String(serving?.key))) die('The stand-in console didn’t say which brain serves.');
  BRAIN_SEEN = brainOf(serving);
  MODEL ||= 'sparkie';
  const models = await fetch(`${BRAIN}/models`, { signal: AbortSignal.timeout(30000) }).then(r => r.json()).catch(e => die(`The brain doesn’t answer at ${BRAIN}/models (${e.cause?.code || e.message}).`));
  if (!Array.isArray(models?.data)) die(`The brain at ${BRAIN} lists no model.`);
}

mkdirSync(OUT, { recursive: true });
console.log(`Coding trial: ${DRY ? 'a dry run (no brain, no box)' : `${BRAIN_SEEN.model} (${BRAIN_SEEN.setup}) at ${BRAIN}, model ${MODEL}`}. Build ${MARK.build}, task set ${SET.version.slice(0, 12)}: ${TASK_IDS.join(', ')}, ${RUNS} run${RUNS === 1 ? '' : 's'} each. Box: ${BOX === 'docker' ? `${BOX_IMAGE}, no network` : 'none (commands run on this machine)'}.${TRIED.length ? ` A try (${TRIED.join('; ')}): Spark Console keeps no record of it.` : ''}\nResults: ${relative(process.cwd(), OUT) || '.'}\n`);

// --- the box ---
const cut = s => (s.length <= OUT_CHARS ? s : `${s.slice(0, 2000)}\n… (${s.length - 5500} characters left out) …\n${s.slice(-3500)}`);
// A path the brain gives, as a path inside the box's /work: relative, not out of it and not into .git; null if not.
function inBox(p, { file = true } = {}) {
  if (typeof p !== 'string' || p.length > 1000 || p.includes('\0')) return null;
  const n = posix.normalize(p.replace(/^\/work(?=\/|$)/, '').replace(/^\/+/, '') || '.');
  if (n === '..' || n.startsWith('../') || (file && n === '.') || n === '.git' || n.startsWith('.git/')) return null;
  return n === '.' ? '' : n;
}
// One command, its output kept (to 16 MB) and its time held; { exit, out, timedOut }.
function runProc(cmd, args, { seconds, cwd, input = null, group = false }) {
  return new Promise(done => {
    const p = spawn(cmd, args, { cwd, stdio: [input == null ? 'ignore' : 'pipe', 'pipe', 'pipe'], detached: group });
    let out = '', timedOut = false, size = 0;
    const take = d => { size += d.length; if (size <= KEEP_OUT) out += d; else stop(); };
    const stop = () => { try { if (group) process.kill(-p.pid, 'SIGKILL'); else p.kill('SIGKILL'); } catch {} };
    p.stdout.on('data', take); p.stderr.on('data', take);
    const timer = setTimeout(() => { timedOut = true; stop(); }, seconds * 1000);
    if (input != null) p.stdin.end(input);
    p.on('error', e => { out += String(e.message); });
    p.on('close', code => { clearTimeout(timer); if (group) try { process.kill(-p.pid, 'SIGKILL'); } catch {} done({ exit: code, out: size > KEEP_OUT ? `${out}\n(stopped: more than 16 MB of output)` : out, timedOut }); });
  });
}
function dockerBox(name, work) {
  const uid = process.getuid?.() ?? 1000, gid = process.getgid?.() ?? 1000;
  const r = spawnSync('docker', ['run', '-d', '--name', name, '--network', 'none', '--user', `${uid}:${gid}`, '--memory', '16g', '--cpus', '8', '--pids-limit', '4096',
    '--security-opt', 'no-new-privileges', '--cap-drop', 'ALL', '-e', 'HOME=/tmp', '-e', 'SPARK_TEST_SLOW=2', '-v', `${work}:/work`, '-w', '/work', BOX_IMAGE, 'sleep', 'infinity'], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`starting the box: ${(r.stderr || '').trim().slice(-500)}`);
  return {
    exec: (command, seconds, { dir = '' } = {}) => runProc('docker', ['exec', '-w', posix.join('/work', dir), name, 'timeout', '-s', 'KILL', String(seconds), 'bash', '-c', command], { seconds: seconds + 15 }),
    read: path => { const x = spawnSync('docker', ['exec', name, 'cat', '--', `/work/${path}`], { encoding: 'utf8', maxBuffer: KEEP_OUT }); return x.status === 0 ? x.stdout : null; },
    write: path => text => { const x = spawnSync('docker', ['exec', '-i', name, 'sh', '-c', 'mkdir -p -- "$(dirname -- "$1")" && cat > "$1"', 'sh', `/work/${path}`], { input: text, encoding: 'utf8' }); return x.status === 0 ? null : (x.stderr || 'it failed').trim().slice(-300); },
    // (every process the brain left is stopped before the grade, so nothing changes the copy while it is read)
    settle: () => { spawnSync('docker', ['restart', '-t', '1', name], { stdio: 'ignore' }); },
    remove: () => { spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore' }); },
  };
}
// No box (--box local, a try; and --dry): commands run on this machine in the copy, each in its own process group.
function localBox(work) {
  const real = realpathSync(work);
  const inside = full => { let p = full; while (!existsSync(p)) p = dirname(p); const r = realpathSync(p); return r === real || r.startsWith(real + sep); };
  return {
    exec: (command, seconds, { dir = '' } = {}) => runProc('bash', ['-c', command], { seconds, cwd: join(work, dir), group: true }),
    read: path => { const f = join(work, path); try { return inside(f) && !lstatSync(f).isSymbolicLink() ? readFileSync(f, 'utf8') : null; } catch { return null; } },
    write: path => text => {
      const f = join(work, path);
      if (!inside(f) || (existsSync(f) && lstatSync(f).isSymbolicLink())) return 'that path leads out of the copy';
      try { mkdirSync(dirname(f), { recursive: true }); if (!inside(f)) return 'that path leads out of the copy'; writeFileSync(f, text); return null; } catch (e) { return e.message; }
    },
    settle: () => {},
    remove: () => {},
  };
}

// --- the two tools, as the brain sees them (stand-ins for A4's: the same shapes) ---
const TOOLS = [
  { type: 'function', function: { name: 'run', description: 'Run one shell command in the box (bash, in /work or dir under it) and get its exit code and output. A command gets 30 seconds, or minutes (1 to 120).',
    parameters: { type: 'object', properties: { on: { type: 'string', enum: ['box'], description: 'Where: "box".' }, command: { type: 'string', description: 'The command, 1 to 4,000 characters.' },
      dir: { type: 'string', description: 'A folder under /work to run it in.' }, minutes: { type: 'integer', minimum: 1, maximum: 120, description: 'For a long command: its time in minutes.' },
      root: { type: 'boolean', description: 'As root. There is no root in the box.' } }, required: ['on', 'command'] } } },
  { type: 'function', function: { name: 'write_file', description: 'Write one file in the box: the whole file, or with from and to, lines from to to (numbered from 1, as you last saw them; to = from - 1 inserts before line from) replaced by text.',
    parameters: { type: 'object', properties: { on: { type: 'string', enum: ['box'], description: 'Where: "box".' }, path: { type: 'string', description: 'The file, under /work.' },
      text: { type: 'string', description: 'The text, at most 128 KB.' }, from: { type: 'integer', minimum: 1 }, to: { type: 'integer', minimum: 0 },
      root: { type: 'boolean', description: 'As root. There is no root in the box.' } }, required: ['on', 'path', 'text'] } } },
];
const SYSTEM = [
  'You are Sparkie, the brain of Spark Console, changing Spark Console’s own code alone. Nobody answers questions while you work.',
  'You have a box: a copy of the repository at /work, with Node.js and git, and no network. Two tools work there:',
  '- run {on: "box", command, dir?, minutes?}: one shell command; you get its exit code and output. Read files with it (cat -n, sed -n \'10,40p\', grep -n).',
  '- write_file {on: "box", path, text, from?, to?}: writes a whole file, or replaces lines from to to with text.',
  'Read AGENTS.md first: it says how this repository is changed. When the work is done, answer with what you changed in a few lines, and call no tool.',
].join('\n');

async function useTool(c, box, deadline) {
  const no = text => ({ text: `Refused: ${text}`, refused: true });
  const name = c?.function?.name;
  let a;
  try { a = JSON.parse(c?.function?.arguments || '{}'); } catch { return no('those arguments aren’t JSON.'); }
  if (!a || typeof a !== 'object' || Array.isArray(a)) return no('the arguments are one JSON object.');
  if (name !== 'run' && name !== 'write_file') return no(`there’s no tool called ${String(name).slice(0, 60)}. The tools are run and write_file.`);
  if (a.on !== 'box') return no('only the box is here (on: "box").');
  if (a.root) return no('there’s no root in the box.');
  if (name === 'run') {
    if (typeof a.command !== 'string' || !a.command.trim() || a.command.length > 4000) return no('command is one shell command, 1 to 4,000 characters.');
    if (a.minutes != null && !(Number.isInteger(a.minutes) && a.minutes >= 1 && a.minutes <= 120)) return no('minutes is a whole number from 1 to 120.');
    const dir = a.dir == null ? '' : inBox(a.dir, { file: false });
    if (dir === null) return no('dir is a folder under /work.');
    const left = Math.floor((deadline - Date.now()) / 1000);
    if (left < 1) return { text: 'The task’s time is up.', refused: false };
    const seconds = Math.min(a.minutes ? a.minutes * 60 : 30, left), r = await box.exec(a.command, seconds, { dir });
    return { text: `${r.timedOut || r.exit === 137 ? `Stopped after ${seconds} seconds: its time ran out.` : `Exit code ${r.exit}.`}\n${cut(r.out)}`, refused: false };
  }
  const path = inBox(a.path);
  if (!path) return no('path is a file under /work, not in .git.');
  if (typeof a.text !== 'string' || Buffer.byteLength(a.text) > TEXT_MAX) return no('text is the file’s text, at most 128 KB.');
  if (a.from == null && a.to == null) {
    const failed = box.write(path)(a.text);
    return failed ? no(`${path} couldn’t be written: ${failed}`) : { text: `Wrote ${path} (${a.text.split('\n').length - (a.text.endsWith('\n') ? 1 : 0)} lines).`, refused: false };
  }
  if (!Number.isInteger(a.from) || !Number.isInteger(a.to) || a.from < 1 || a.to < a.from - 1) return no('from and to are line numbers from 1, from no more than to + 1.');
  const old = box.read(path);
  if (old == null) return no(`${path} isn’t there to change lines in; write the whole file.`);
  const end = old.endsWith('\n'), lines = (end ? old.slice(0, -1) : old) === '' ? [] : (end ? old.slice(0, -1) : old).split('\n');
  if (a.to > lines.length) return no(`${path} has ${lines.length} lines.`);
  const put = a.text === '' ? [] : a.text.replace(/\n$/, '').split('\n'), next = [...lines.slice(0, a.from - 1), ...put, ...lines.slice(a.to)];
  const failed = box.write(path)(`${next.join('\n')}${end || !lines.length ? '\n' : ''}`);
  return failed ? no(`${path} couldn’t be written: ${failed}`) : { text: `Replaced lines ${a.from} to ${a.to} of ${path} with ${put.length} line${put.length === 1 ? '' : 's'}; it has ${next.length} lines now.`, refused: false };
}

// One request to the brain; a busy or starting brain is asked again, up to five times.
async function ask(messages, tools, deadline) {
  for (let tries = 1; ; tries++) {
    const left = deadline - Date.now();
    if (left < 1000) throw Object.assign(new Error('the task’s time ran out'), { time: true });
    try {
      const r = await fetch(`${BRAIN}/chat/completions`, { method: 'POST', signal: AbortSignal.timeout(Math.min(left, 20 * 60000)), headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: MODEL, messages, ...(tools ? { tools, tool_choice: 'auto' } : {}), stream: false }) });
      const text = await r.text();
      if (r.ok) return JSON.parse(text);
      if (![429, 502, 503, 504].includes(r.status) || tries >= 5) throw new Error(`the brain answered ${r.status}: ${text.slice(0, 300)}`);
    } catch (e) {
      if (e.name === 'TimeoutError' && deadline - Date.now() < 1000) throw Object.assign(new Error('the task’s time ran out'), { time: true });
      if (/^the brain answered/.test(e.message) || tries >= 5) throw e;
    }
    await new Promise(r => setTimeout(r, 10000));
  }
}
// The loop (a stand-in for Sparkie's own in the box): ask, run the calls, give back what they said, until the brain
// answers with no call, the task's time or 120 requests run out, or three calls in a row were refused (then the tools
// are taken away and it is asked to say what it did).
async function brainLoop(prompt, box, deadline, log) {
  const messages = [{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt }];
  let rounds = 0, refused = 0, tools = TOOLS, ended = 'answered';
  for (;;) {
    if (rounds >= STEPS) { ended = 'steps'; break; }
    let reply;
    try { reply = await ask(messages, tools, deadline); } catch (e) { if (e.time) { ended = 'time'; break; } throw e; }
    rounds++;
    const m = reply?.choices?.[0]?.message || {}, calls = tools && Array.isArray(m.tool_calls) ? m.tool_calls : [];
    messages.push({ role: 'assistant', content: m.content ?? '', ...(calls.length ? { tool_calls: calls } : {}) });
    log({ round: rounds, said: m.content ?? '', calls: calls.map(c => ({ name: c?.function?.name, arguments: c?.function?.arguments })) });
    if (!calls.length) break;
    for (const c of calls) {
      const out = await useTool(c, box, deadline);
      messages.push({ role: 'tool', tool_call_id: c?.id ?? '', content: out.text });
      log({ round: rounds, tool: c?.function?.name, result: out.text.slice(0, 4000) });
      refused = out.refused ? refused + 1 : 0;
    }
    if (refused >= 3 && tools) {
      tools = null;
      messages.push({ role: 'user', content: 'Three calls in a row were refused, so the tools are put away. Say what you changed and what is left.' });
    }
  }
  return { rounds, ended };
}

// --- one run of one task ---
const git = (gitDir, workTree) => args => {
  const r = spawnSync('git', ['--git-dir', gitDir, '--work-tree', workTree, '-c', 'core.fsmonitor=false', '-c', 'core.quotePath=false', ...args],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } });
  return { exit: r.status, out: `${r.stdout || ''}${r.status ? r.stderr || '' : ''}` };
};
const must = (r, what) => { if (r.exit !== 0) throw new Error(`${what}: ${r.out.slice(-500)}`); return r; };
async function runOne(task, n) {
  const dir = join(OUT, 'runs', `${task.id}-${n}`), work = join(dir, 'work'), t0 = Date.now();
  mkdirSync(dir, { recursive: true });
  // A fresh copy of this repository, without the trial's tasks (their plants say the answers), past results, the
  // eval's held-out set, or anything git or the machine keeps; the task planted in it.
  cpSync(REPO, work, { recursive: true, filter: src => { const r = relative(REPO, src).split(sep).join('/');
    return !/^(agentbar\/(trial|results)|node_modules|\.git|\.claude|test-results)(\/|$)/.test(r) && r !== 'test/eval/memory-held-out.json' && r !== 'service/workflows.lock.json' && !/(^|\/)\.DS_Store$/.test(r)
      && !(OUT_IN && (r === OUT_IN || r.startsWith(`${OUT_IN}/`))); } });
  // (the held-out set stays out, as it does of Spark 2's copy; a file of its name says so, so the documents still check)
  if (existsSync(join(REPO, 'test', 'eval', 'memory-held-out.json'))) writeFileSync(join(work, 'test', 'eval', 'memory-held-out.json'), `${JSON.stringify({ about: 'Left out of this copy: the brain eval’s held-out set is never where the brain can read it (agentbar/trial.mjs, deploy/host-on-portal.sh).', questions: [] }, null, 2)}\n`);
  const plant = spawnSync(process.execPath, [join(TASKS, 'plant.mjs'), join(TASKS, task.id), work], { encoding: 'utf8' });
  if (plant.status !== 0) throw new Error(`planting ${task.id}: ${(plant.stderr || plant.stdout).trim().slice(-500)}`);
  // (the runner's own record of the planted copy, outside it; and one in it, for the brain's git)
  const seed = ['-c', 'user.name=trial', '-c', 'user.email=trial@localhost', 'commit', '-q', '--no-verify', '-m', `the planted task ${task.id}`];
  const mine = git(join(dir, 'seed.git'), work);
  must(mine(['init', '-q']), 'the runner’s git');
  must(mine(['add', '-A', '--force', '.']), 'the runner’s git');
  must(mine(seed), 'the runner’s git');
  for (const args of [['init', '-q'], ['add', '-A', '.'], seed]) must(git(join(work, '.git'), work)(args), 'the copy’s git');
  const prompt = readFileSync(join(TASKS, task.id, 'prompt.md'), 'utf8');
  writeFileSync(join(dir, 'prompt.md'), prompt);
  const box = BOX === 'docker' ? dockerBox(`trial-${STAMP}-${task.id}-${n}`.toLowerCase().replace(/[^a-z0-9_.-]/g, '-'), work) : localBox(work);
  let checks = [], rounds = 0, ended = 'dry';
  try {
    if (!DRY) {
      const log = x => appendFileSync(join(dir, 'transcript.jsonl'), `${JSON.stringify(x)}\n`);
      try { ({ rounds, ended } = await brainLoop(prompt, box, t0 + task.minutes * 60000, log)); } catch (e) { ended = 'brain'; checks.push({ name: 'the brain answered', pass: false, detail: e.message.slice(0, 1500) }); }
      box.settle();
    }
    if (!checks.length) checks = await gradeTask(box, task, { short: SHORT, git: mine });
  } finally { box.remove(); }
  if (!KEEP) rmSync(work, { recursive: true, force: true });
  return { passed: checks.length > 0 && checks.every(c => c.pass), rounds, seconds: Math.round((Date.now() - t0) / 100) / 10, ended, checks };
}

// --- every run: each task once per round, so a slow hour of the brain falls on all of them ---
const results = TASK_IDS.map(id => ({ id, runs: [] })), STARTED = new Date().toISOString();
for (let n = 1; n <= RUNS; n++) {
  for (const id of TASK_IDS) {
    const task = SET.tasks.find(t => t.id === id), r = await runOne(task, n);
    results.find(x => x.id === id).runs.push(r);
    const failed = r.checks.find(c => !c.pass);
    console.log(`${r.passed ? 'pass' : 'FAIL'}  ${id.padEnd(20)} run ${n}  ${String(r.rounds).padStart(3)} rounds  ${(r.seconds / 60).toFixed(1).padStart(5)} min${r.ended === 'time' ? ' (its time ran out)' : r.ended === 'steps' ? ' (120 requests)' : ''}${failed ? `  ${failed.name}` : ''}`);
  }
}

// --- the record, and the verdict on the contract's bar (10.4, T100): every task passes at least 2 of 3 runs ---
const record = { kind: 'spark-console-trial', at: new Date().toISOString(), startedAt: STARTED, build: MARK.build, reads: MARK.reads, tasks: { version: SET.version, ids: TASK_IDS },
  runs: RUNS, brain: BRAIN_SEEN, box: BOX === 'docker' ? { kind: 'docker', image: BOX_IMAGE, network: 'none' } : { kind: 'local' }, ...(DRY ? { dry: true } : {}), ...(TRIED.length ? { tried: TRIED } : {}),
  results: results.map(x => ({ id: x.id, runs: x.runs })) };
const file = join(OUT, 'record.json');
writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
const need = Math.ceil((2 * RUNS) / 3), full = RUNS >= 3, passes = results.map(x => [x.id, x.runs.filter(r => r.passed).length]);
const brainDown = results.reduce((t, x) => t + x.runs.filter(r => r.ended === 'brain').length, 0), met = passes.every(([, p]) => p >= need);
console.log(`\nThe bar (contract 10.4, T100): every task passes at least 2 of 3 runs.`);
for (const [id, p] of passes) console.log(`  ${id.padEnd(22)} ${p} of ${RUNS}`);
if (DRY) {
  const passedDry = passes.filter(([, p]) => p).map(([id]) => id);
  console.log(passedDry.length ? `\nDRY RUN, BROKEN KIT: ${passedDry.join(', ')} passed untouched; each must fail before the brain has done anything.` : '\nDry run: every untouched task failed, as it must. No brain ran, so nothing is scored.');
  console.log(`Saved ${relative(process.cwd(), file) || file}`);
  process.exit(passedDry.length ? 1 : 0);
}
if (brainDown) console.log(`\n${brainDown} run${brainDown === 1 ? '' : 's'} ended because the brain didn’t answer: that isn’t a fair score. Run it again once the brain is up.`);
console.log(`\n${!full ? `A PARTIAL RUN (${RUNS} run${RUNS === 1 ? '' : 's'} each): not the bar, which needs 3.` : met ? 'GO: every task met the bar.' : 'NO-GO: not every task met the bar.'}${TRIED.length ? ` A try (${TRIED.join('; ')}): Spark Console keeps no record of it.` : ''}`);
console.log(`Saved ${file}\nsha256 ${recordHash(record)}`);
if (!TRIED.length) console.log(`To keep it, from your own device on the tailnet (not from a Spark): node agentbar/trial.mjs --store ${relative(REPO, file)}\nthen press “Keep it (sha256 ${recordHash(record).slice(0, 12)}…)” in the chat “The coding trial’s result” in Spark Console, with your passkey.`);
process.exit(full && met && !TRIED.length ? 0 : 2);

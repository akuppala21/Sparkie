// Marks this build's workflows as tested: runs the whole suite strictly and, only if every test passes and no service
// file changed while it ran, writes the build id and each workflow's version to service/workflows.lock.json. Spark
// Console runs a workflow only when the installed build and its version are in that file (and the version has been
// validated on the real Sparks), so run this before installing a changed build:
//
//   node test/lock.mjs
//
// The lock also names what was tested and where, when that is known: `tree` (git's hash of the files tested, the lock
// itself left out) and `commit` (only when those files are exactly the commit's), `run` (the GitHub run, on GitHub),
// and `brainReads`, the sha256 of what Sparkie's brain is sent (its system prompt and the tools one turn offers, how it
// is asked, and everything the other rounds can add: every action's name, description, inputs and group, the cap, the
// groups' words and the lines that follow tools, the brain's setup: R46; and what a turn in the paired Telegram chat is
// sent: R52), so a later build can say whether what the brain reads has changed. Without git (a copy with no .git
// folder) commit is left out, and tree is the one the runner hands in (SPARK_TEST_TREE), else left out too; off
// GitHub, run is left out. After the suite it prints the seconds each test file took.
//
// SPARK_TEST_MAP=1 also records which test files run each function of the service's parts, for picking the tests a
// change needs (tools/affected.mjs): every file runs with Node's own coverage, and a passing run writes
// test/affected-map.json beside the lock, named by the same tree (SPARK_TEST_TREE names it where there is no git: the
// Spark runner sends it). Nothing else about the run changes; it takes longer (test/README.md has the figure).
//
// test/lock.test.mjs imports lockFor and the rest; importing this file runs nothing.
import { spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync, readdirSync, mkdtempSync, rmSync, realpathSync, mkdirSync, lstatSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMock, REPO, evalSetOf } from './start-mock.mjs';
import { buildMap, testFiles, MAP_FILE } from '../tools/affected.mjs';

const SERVICE = join(REPO, 'service');
const LOCK_PATH = 'service/workflows.lock.json';
export const shippedHub = (repo = REPO) => JSON.parse(readFileSync(join(repo, 'service', 'config.json'), 'utf8')).nodes.find(n => n.host === 'local').id;

// git's own hash of the files as they are (what `git add -A` then `git write-tree` would give, made in a throwaway
// index so the real one is untouched), with the lock left out. The commit only when HEAD holds exactly those files.
export function gitFields(repo = REPO) {
  const git = (args, env) => {
    const r = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8', env: env ? { ...process.env, ...env } : process.env });
    return r.status === 0 ? r.stdout.trim() : null;
  };
  const top = git(['rev-parse', '--show-toplevel']);
  try { if (!top || realpathSync(top) !== realpathSync(repo)) return {}; } catch { return {}; }
  const dir = mkdtempSync(join(tmpdir(), 'lock-index-')), env = { GIT_INDEX_FILE: join(dir, 'index') };
  try {
    const head = git(['rev-parse', '--verify', '-q', 'HEAD^{tree}']);
    if (head && git(['read-tree', 'HEAD'], env) === null) return {};
    if (git(['add', '-A', '.'], env) === null) return {};
    if (git(['rm', '--cached', '-q', '--ignore-unmatch', LOCK_PATH], env) === null) return {};
    const tree = git(['write-tree'], env);
    if (!/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(tree || '')) return {};
    const commit = head === tree ? git(['rev-parse', 'HEAD']) : null;
    return { tree, ...(commit ? { commit } : {}) };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

// The GitHub run that tested it (its page), only on GitHub. Without the attempt: a job re-run in the same run keeps it.
export function runOf(env = process.env) {
  if (env.GITHUB_ACTIONS !== 'true' || !/^\d+$/.test(env.GITHUB_RUN_ID || '') || !/^[A-Za-z0-9-]+\/[\w.-]+$/.test(env.GITHUB_REPOSITORY || '')
    || !/^https:\/\/[\w.-]+$/.test(env.GITHUB_SERVER_URL || '')) return null;
  return `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`;
}

// What the brain is sent at the start of the owner's chat turn, as the stand-in model received it (mock/model.mjs
// keeps the latest in brain-sent.json): the system prompt, the tools that turn offers and how it was asked (sampling,
// limit, thinking). With it, what other rounds can be sent (R46): GET /actions, every action with its group and the
// brain's catalog (the cap, the groups and their words, the lines that follow tools, the setup's sampling and limits),
// and, in it, what a turn in the paired Telegram chat is sent (its prompt and tools differ: telegramSent). start: the
// tree's own startMock (test/eval.mjs --tree passes that tree's).
export async function brainSent(fleet, { start = startMock } = {}) {
  const headers = { 'content-type': 'application/json', 'x-spark-console': '1', origin: fleet.origin };
  let last = '';
  for (let i = 0; i < 5; i++) {
    const words = `Hello from test/lock.mjs (${randomBytes(4).toString('hex')}).`;
    const chat = await fetch(`${fleet.base}/chats`, { method: 'POST', headers, body: '{}' });
    const { id } = await chat.json();
    last = await (await fetch(`${fleet.base}/chats/${id}/messages`, { method: 'POST', headers, body: JSON.stringify({ text: words }) })).text();
    let sent = null;
    try { sent = JSON.parse(readFileSync(join(fleet.dir, 'brain-sent.json'), 'utf8')); } catch {}
    if (sent?.words === words && typeof sent.system === 'string' && Array.isArray(sent.tools) && sent.tools.length) {
      const catalog = await (await fetch(`${fleet.base}/actions`)).json();
      if (!Array.isArray(catalog?.actions) || !catalog.brain) throw new Error('GET /actions didn’t give the actions and the brain’s catalog, so what the brain reads couldn’t be marked.');
      return { system: sent.system, tools: sent.tools, params: sent.params ?? null, catalog: { ...catalog, telegram: await telegramSent(start) } };
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  throw new Error(`The stand-in brain wasn’t sent a chat turn, so what it reads couldn’t be marked: ${last.slice(-500)}`);
}
// What a turn in the paired Telegram chat is sent at its start (its prompt and the tools offered there), on a stand-in
// fleet of its own with Telegram paired (R52: a change to it moves the mark).
async function telegramSent(start) {
  const TG = 5550001, fleet = await start({ hub: shippedHub(), telegram: true, evalOnRecord: false, prepare: ({ dir }) => {
    mkdirSync(join(dir, 'secrets'), { recursive: true, mode: 0o700 });
    writeFileSync(join(dir, 'secrets', 'secrets.json'), JSON.stringify({ telegram: { token: '123456789:AAEtestTokenForSparkConsoleXYZ_abcdefghij', bot: 'spark_test_bot', chatId: TG, userId: TG, name: 'Owner' } }), { mode: 0o600 });
  } });
  try {
    for (let i = 1; i <= 5; i++) {
      const words = `Hello from test/lock.mjs on Telegram (${randomBytes(4).toString('hex')}).`;
      await fetch(`http://127.0.0.1:${fleet.telegramPort}/__push`, { method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(10000),
        body: JSON.stringify({ message: { message_id: i, date: Math.floor(Date.now() / 1000), chat: { id: TG, type: 'private' }, from: { id: TG, is_bot: false, first_name: 'Owner' }, text: words } }) });
      for (let k = 0; k < 40; k++) {
        await new Promise(r => setTimeout(r, 500));
        let sent = null;
        try { sent = JSON.parse(readFileSync(join(fleet.dir, 'brain-sent.json'), 'utf8')); } catch {}
        if (String(sent?.words).includes(words) && typeof sent.system === 'string' && Array.isArray(sent.tools) && sent.tools.length) {
          // Hello opens no power tools, so its core prompt omits their hub-specific instructions. Keep this fleet's
          // catalog too: it includes the power instructions and tools this Telegram brain can be offered later.
          const catalog = await (await fetch(`${fleet.base}/actions`)).json();
          if (!Array.isArray(catalog?.actions) || !catalog.brain) throw new Error('The Telegram fleet did not give its brain catalog.');
          return { system: sent.system, tools: sent.tools, params: sent.params ?? null, catalog };
        }
      }
    }
    throw new Error('The stand-in brain wasn’t sent a turn from the paired Telegram chat, so what it reads there couldn’t be marked.');
  } finally { await fleet.stop(); }
}
export const brainReadsOf = ({ system, tools, params = null, catalog = null }) => createHash('sha256').update(JSON.stringify({ system, tools, params, catalog })).digest('hex');

// What was tested: git's tree and commit where there is git (gitFields); in a copy without it (a whole run on a Spark),
// the tree the runner hands in, SPARK_TEST_TREE (git's hash of the files it copied, taken as gitFields takes it), and no
// commit. pull.sh finds the installed build's commit on main from that tree, so a build installed from the Mac is never
// taken as older than a tested one it can't place (R29, R58).
export function testedFiles(git, env = process.env) {
  if (git?.tree) return git;
  return /^[0-9a-f]{40}([0-9a-f]{24})?$/.test(env.SPARK_TEST_TREE || '') ? { tree: env.SPARK_TEST_TREE } : {};
}

// The lock for the build the stand-in fleet runs. `git` is what gitFields gave before the suite ran. `evalSet` is the eval's
// case set this tree holds (its version and each case's id and expect), so a build reads its own set (R52). A new key
// goes in the mark job's check too (.github/workflows/full-run.yml), with its shape: lock.test.mjs holds the two equal.
export async function lockFor(fleet, { git = gitFields(), env = process.env } = {}) {
  const { workflows } = await (await fetch(`${fleet.base}/workflows`)).json();
  const { build } = await (await fetch(`${fleet.base}/health`)).json();
  const run = runOf(env);
  return { build, testedAt: new Date().toISOString(), versions: Object.fromEntries(workflows.map(w => [w.id, w.version])),
    ...testedFiles(git, env), ...(run ? { run } : {}), brainReads: brainReadsOf(await brainSent(fleet)), evalSet: evalSetOf() };
}

// Run in each test file's process before the file itself (Node's test runner passes --import on to every file): the
// coverage of that process and of everything it starts (the service too) goes to a folder named after the file.
export const EACH_FILE = `data:text/javascript,${encodeURIComponent("const f = process.argv[1] || ''; if (process.env.NODE_V8_COVERAGE && /\\.test\\.mjs$/.test(f)) process.env.NODE_V8_COVERAGE += '/' + f.slice(f.lastIndexOf('/') + 1);")}`;

// Hosted workers run disjoint files. Receipts are run-local evidence, never a substitute for the suite: only this
// runner writes them, after its strict test process passes and its whole source tree is still unchanged.
export function shardFiles(files, index, total) {
  if (!Number.isInteger(total) || total < 1 || total > 16 || !Number.isInteger(index) || index < 1 || index > total
    || !Array.isArray(files) || files.length < total || files.some(f => !/^test\/[\w-]+\.test\.mjs$/.test(f)) || new Set(files).size !== files.length)
    throw new Error('Bad test shard or file list.');
  return [...files].sort().filter((_, i) => i % total === index - 1);
}
export function shardIdentity(git, env = process.env) {
  const run = runOf(env), attempt = env.GITHUB_RUN_ATTEMPT;
  if (!git.tree || !git.commit || git.commit !== env.GITHUB_SHA || !run || !/^[1-9]\d*$/.test(attempt || ''))
    throw new Error('Hosted shards need the unchanged checkout commit and this GitHub run and attempt.');
  return { ...git, run, attempt };
}
export function assertFrozen(before, after) {
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('Files changed while the suite ran, so nothing was marked as tested. Run it again.');
}
export function validateShardReceipts(receipts, { identity, files, total }) {
  shardFiles(files, 1, total);
  if (!Array.isArray(receipts) || receipts.length !== total) throw new Error('Missing or extra shard receipts.');
  const seen = new Set();
  for (const r of receipts) {
    if (!r || typeof r !== 'object' || Array.isArray(r)
      || JSON.stringify(Object.keys(r).sort()) !== JSON.stringify(['attempt', 'commit', 'files', 'index', 'passed', 'run', 'schema', 'total', 'tree'])
      || r.schema !== 1 || r.passed !== true || r.total !== total || seen.has(r.index)
      || ['tree', 'commit', 'run', 'attempt'].some(k => r[k] !== identity[k])
      || JSON.stringify(r.files) !== JSON.stringify(shardFiles(files, r.index, total)))
      throw new Error('A shard receipt is malformed, repeated, incomplete or from another tree or run.');
    seen.add(r.index);
  }
  return true;
}
export function readShardReceipts(dir, { attempt, total }) {
  if (!/^[1-9]\d*$/.test(attempt || '') || !Number.isInteger(total) || total < 1 || total > 16)
    throw new Error('Bad receipt run attempt or shard count.');
  const expected = Array.from({ length: total }, (_, i) => `full-receipt-${attempt}-${i + 1}`);
  if (JSON.stringify(readdirSync(dir).sort()) !== JSON.stringify([...expected].sort())) throw new Error('Missing or extra receipt artifacts.');
  return expected.map((name, i) => {
    const folder = join(dir, name), file = `shard-${i + 1}.json`, path = join(folder, file);
    if (!lstatSync(folder).isDirectory() || JSON.stringify(readdirSync(folder)) !== JSON.stringify([file]))
      throw new Error('Unexpected files in a receipt artifact.');
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.size > 1000000) throw new Error('Unexpected file in shard receipts.');
    return JSON.parse(readFileSync(path, 'utf8'));
  });
}

// By hand (not when a test imports this file, nor when a bare `node --test` picks it up). The paths are compared as real
// paths: a folder reached through a link must still run.
const isMain = () => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } };
if (isMain() && !process.env.NODE_TEST_CONTEXT) {
  const args = process.argv.slice(2), shardArg = args.find(a => a.startsWith('--shard=')), aggregateArg = args.find(a => a.startsWith('--aggregate='));
  if (args.some(a => !/^--(?:shard=\d+\/\d+|receipts=.+|aggregate=.+|shards=\d+)$/.test(a))
    || new Set(args.map(a => a.split('=')[0])).size !== args.length || (shardArg && aggregateArg)
    || (shardArg ? args.length !== 2 || !args.some(a => a.startsWith('--receipts=')) : aggregateArg ? args.length !== 2 || !args.some(a => a.startsWith('--shards=')) : args.length))
    throw new Error('Use no arguments, --shard=1/3 --receipts=<outside folder>, or --aggregate=<outside folder> --shards=3.');
  const fingerprint = () => {
    const h = createHash('sha256');
    for (const f of readdirSync(SERVICE).filter(f => /\.(mjs|py|json)$/.test(f) && f !== 'workflows.lock.json').sort()) h.update(f).update(readFileSync(join(SERVICE, f)));
    return h.digest('hex');
  };
  // The service runs server.mjs, which is built from service/src/*.mjs: it has to match its parts.
  const built = spawnSync(process.execPath, [join(REPO, 'tools', 'build-server.mjs'), '--check'], { stdio: 'inherit' });
  if (built.status !== 0) process.exit(1);
  const before = fingerprint(), git = gitFields();
  const frozen = () => ({ fingerprint: fingerprint(), ...gitFields() });
  const initial = { fingerprint: before, ...git };
  const hosted = shardArg || aggregateArg ? shardIdentity(git) : null;
  const allFiles = testFiles(REPO), [index, total] = shardArg ? shardArg.slice(8).split('/').map(Number) : [null, null];
  const selected = shardArg ? shardFiles(allFiles, index, total) : allFiles;
  if (hosted && process.env.SPARK_TEST_MAP === '1') throw new Error('Coverage maps use the whole local runner, not hosted shards.');
  if (aggregateArg) {
    const dir = aggregateArg.slice(12), total = Number(args.find(a => a.startsWith('--shards=')).slice(9));
    validateShardReceipts(readShardReceipts(dir, { attempt: hosted.attempt, total }), { identity: hosted, files: allFiles, total });
  }
  const cover = process.env.SPARK_TEST_MAP === '1' ? mkdtempSync(join(tmpdir(), 'cover-')) : null;
  if (cover) {
    rmSync(join(REPO, MAP_FILE), { force: true });   // a map from an earlier run never stands for this one
    process.on('exit', () => rmSync(cover, { recursive: true, force: true }));
  }
  // (SPARK_TEST_CONCURRENCY: fewer test files at once on a slow machine, e.g. one whose security software checks every
  // process the stand-in fleet starts.) The usual report, then the seconds each file took (test/file-times.mjs).
  const reporters = ['--test-reporter=spec', '--test-reporter-destination=stdout', '--test-reporter=./test/file-times.mjs', '--test-reporter-destination=stdout'];
  const suite = aggregateArg ? { status: 0 } : spawnSync(process.execPath, ['--test', ...(cover ? [`--import=${EACH_FILE}`] : []), `--test-concurrency=${Number(process.env.SPARK_TEST_CONCURRENCY) || 4}`, ...reporters, ...selected],
    { cwd: REPO, stdio: 'inherit', env: { ...process.env, SPARK_TEST_STRICT: '1', ...(cover ? { NODE_V8_COVERAGE: cover } : {}) } });
  if (suite.status !== 0) {
    console.error('\nThe suite didn’t pass, so nothing was marked as tested.');
    process.exit(1);
  }
  assertFrozen(initial, frozen());
  if (shardArg) {
    const dir = args.find(a => a.startsWith('--receipts=')).slice(11);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `shard-${index}.json`), `${JSON.stringify({ schema: 1, ...hosted, index, total, files: selected, passed: true })}\n`, { flag: 'wx' });
    console.log(`Passed shard ${index}/${total}: ${selected.length} files; ${hosted.commit}, attempt ${hosted.attempt}.`);
    process.exit(0);
  }
  const fleet = await startMock({ hub: shippedHub() });
  try {
    const lock = await lockFor(fleet, { git });
    assertFrozen(initial, frozen());
    writeFileSync(join(SERVICE, 'workflows.lock.json'), `${JSON.stringify(lock, null, 2)}\n`);
    console.log(`\nMarked build ${lock.build} as tested: ${Object.entries(lock.versions).map(([id, v]) => `${id} ${v}`).join(', ')}`);
  } finally { await fleet.stop(); }
  if (cover) {
    const t0 = Date.now(), tree = git.tree || (/^[0-9a-f]{40}$/.test(process.env.SPARK_TEST_TREE || '') ? process.env.SPARK_TEST_TREE : null);
    const map = buildMap(cover, { root: REPO, tests: testFiles(REPO), tree });
    writeFileSync(join(REPO, MAP_FILE), `${JSON.stringify(map)}\n`);
    console.log(`Wrote ${MAP_FILE}: ${Object.keys(map.fns).length} functions, ${map.tests.length} test files, tree ${tree || 'not known'} (${((Date.now() - t0) / 1000).toFixed(1)} s).`);
  }
}

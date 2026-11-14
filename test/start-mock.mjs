// Starts the real Spark Console service (service/server.mjs) against the stand-in fleet in test/mock. Everything runs on
// this machine: SPARK_CONSOLE_ALL_LOCAL=1 makes every Spark a folder under a temporary copy of test/mock/root (its own
// HOME), mock/bin stands in for docker, nvidia-smi, curl, tailscale, ssh and the rest, and mock/worker.py stands in for
// the worker. No real Spark, SSH or Tailscale is touched.
//
// Each start gets a fresh temporary folder (copied fleet, state with access.json for owner@test, its own socket), a
// free port for the service and free ports for the stand-in model servers (Sparkie's, a benchmark, and the port Spark
// Console's deploys serve on). stop() — or the test process ending in any
// way — stops every process it started and removes the folder. The repo's test/mock is never changed.
//
//   import { startMock } from './start-mock.mjs';
//   const fleet = await startMock();          // { base, mcp, origin, port, dir, root, stateDir, ... }
//   ...
//   await fleet.stop();
//
// By hand: node test/start-mock.mjs [--editor] [--keep]   (prints the addresses; Ctrl-C stops it)
import { spawn } from 'node:child_process';
import { mkdtempSync, cpSync, rmSync, readFileSync, writeFileSync, truncateSync, mkdirSync, renameSync, existsSync, openSync, closeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

export const TEST_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO = join(TEST_DIR, '..');
export const MOCK = join(TEST_DIR, 'mock');
export const SERVICE = join(REPO, 'service', 'server.mjs');
export const API_MOUNT = '/console/api';
export const OWNER = 'owner@test', MEMBER = 'member@test';

// The process group leader for everything one start runs. It starts the given scripts, and when its stdin closes
// (stop(), or the test process exiting or being killed) it stops the whole group and removes the temporary folder.
const GUARD = `
const { spawn } = require('node:child_process'), { rmSync } = require('node:fs');
const kids = process.argv.slice(1).map(f => spawn(process.execPath, [f], { stdio: ['ignore', 'inherit', 'inherit'] }));
// Which process is which (a test sends the service SIGTERM, say).
require('node:fs').writeFileSync(process.env.MOCK_DIR + '/pids.json', JSON.stringify(Object.fromEntries(kids.map(k => [require('node:path').basename(k.spawnargs[1]), k.pid]))));
let down = false;
const finish = () => { if (process.env.MOCK_KEEP !== '1') try { rmSync(process.env.MOCK_DIR, { recursive: true, force: true }); } catch {} process.exit(0); };
const stop = () => {
  if (down) return; down = true;
  process.on('SIGTERM', () => {});
  try { process.kill(-process.pid, 'SIGTERM'); } catch {}
  const t = setTimeout(() => { try { process.kill(-process.pid, 'SIGKILL'); } catch {} }, 4000);
  Promise.all(kids.map(k => k.exitCode !== null || k.signalCode ? null : new Promise(r => k.once('exit', r)))).then(() => { clearTimeout(t); setTimeout(finish, 300); });
};
for (const k of kids) k.on('exit', (code, sig) => { if (!down) console.error('[guard] ' + k.spawnargs[1] + ' exited (' + (sig || code) + ')'); try { require('node:fs').appendFileSync(process.env.MOCK_DIR + '/exits', require('node:path').basename(k.spawnargs[1]) + ' ' + (sig || code) + '\\n'); } catch {} });
process.stdin.on('end', stop); process.stdin.on('close', stop); process.stdin.on('error', stop); process.stdin.resume();
process.on('SIGINT', stop); process.on('SIGHUP', stop);
`;

const live = new Set();
let hooked = false;
function hookExit() {
  if (hooked) return;
  hooked = true;
  // Last resort if a test process ends without stop(): kill the group and remove the folder synchronously.
  process.on('exit', () => {
    for (const f of live) {
      try { process.kill(-f.pid, 'SIGKILL'); } catch {}
      if (!f.keep) try { rmSync(f.dir, { recursive: true, force: true }); } catch {}
    }
  });
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.once(sig, () => process.exit(sig === 'SIGINT' ? 130 : 143));
  }
}

const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.on('error', reject);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});
async function freePorts(n) {
  const out = new Set();
  while (out.size < n) out.add(await freePort());
  return [...out];
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// A fresh copy of the stand-in fleet: git can't hold empty folders or (cheaply) the zero-filled weights, so the
// manifest recreates them; the benchmark-style server's port is moved to the one this start got.
function copyFleet(root, benchPort) {
  cpSync(join(MOCK, 'root'), root, { recursive: true, verbatimSymlinks: true });
  const manifest = JSON.parse(readFileSync(join(MOCK, 'manifest.json'), 'utf8'));
  for (const d of manifest.emptyDirs) mkdirSync(join(root, d), { recursive: true });
  for (const [f, size] of Object.entries(manifest.zeroFilledBytes)) {
    const p = join(root, f);
    if (!existsSync(p)) closeSync(openSync(p, 'w'));
    truncateSync(p, size);
  }
  const m = join(root, 'spark2', '.mock');
  if (existsSync(join(m, 'serve-30103'))) renameSync(join(m, 'serve-30103'), join(m, `serve-${benchPort}`));
  if (existsSync(join(m, 'ports'))) writeFileSync(join(m, 'ports'), readFileSync(join(m, 'ports'), 'utf8').replace(/\|30103$/m, `|${benchPort}`));
}

// What the watcher would have learned about the stand-in Sparks' containers (knowledge.json's shape).
function knownContainers(root, offline) {
  const workloads = {}, at = new Date().toISOString();
  for (const spark of ['spark1', 'spark2', 'spark3', 'spark4'].filter(id => !offline.split(/\s+/).includes(id))) {
    let lines = [];
    try { lines = readFileSync(join(root, spark, '.mock', 'containers'), 'utf8').split('\n').filter(Boolean); } catch {}
    for (const line of lines) {
      const [name, state, , ours, , , role] = line.split('|');
      workloads[`${spark}/${name}`] = { spark, name, kind: role === 'main' ? 'sparkie' : ours === '1' ? 'model' : 'other', byConsole: ours === '1',
        state, running: state === 'running', firstSeenAt: at, lastSeenAt: at };
    }
  }
  return { workloads, sparks: {} };
}

// The service's own settings (read-only): its configured origin and Sparkie's model setup.
export const serviceConfig = () => JSON.parse(readFileSync(join(REPO, 'service', 'config.json'), 'utf8'));

// prepare({ dir, root, stateDir }): runs after the fleet and state are copied and before the service starts (to seed
// state files: events.jsonl, heal-tries.json, an unreadable verified.json, …).
// knowledge: true seeds the state's knowledge.json with the containers on the online stand-in Sparks, as the watcher
// would have saved them before a restart (its own first look is 15 s after the service starts). Sparkie's changes trace
// a container named in the owner's words through it.
// telegram: true starts a stand-in Bot API (mock/telegram.mjs) and points the service at it, with its secrets file in
// this start's folder (never the developer's home).
export async function startMock({ watchMs = 3000, statusMs = 5000, editor = false, keep = false, env: extraEnv = {}, timeoutMs = 30000, prepare = null, knowledge = false, telegram = false } = {}) {
  hookExit();
  const dir = mkdtempSync(join(tmpdir(), 'sct-'));
  const root = join(dir, 'root'), stateDir = join(dir, 'state'), socket = join(dir, 'api.sock'), offlineFile = join(dir, 'offline'), log = join(dir, 'service.log');
  const [port, modelPort, benchPort, editorPort, servePort, telegramPort] = await freePorts(6);
  const secretsFile = join(dir, 'secrets', 'secrets.json');
  copyFleet(root, benchPort);
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  writeFileSync(join(stateDir, 'access.json'), readFileSync(join(MOCK, 'access.json')), { mode: 0o600 });
  // The last connection test between the stand-in Sparks' cables (the service runs its own 20 s after starting).
  writeFileSync(join(stateDir, 'links.json'), readFileSync(join(MOCK, 'links.json')), { mode: 0o600 });
  // Sparkie's model as service/config.json describes it, but on the stand-in model's free port (state's main.json
  // overrides a preset with the same id), so it never meets another copy's stand-in on the usual port.
  const cfg = serviceConfig(), presets = cfg.main ? (cfg.main.presets || { [cfg.main.id || 'default']: cfg.main }) : {};
  if (Object.keys(presets).length) {
    writeFileSync(join(stateDir, 'main.json'), JSON.stringify({ current: Object.keys(presets)[0],
      presets: Object.fromEntries(Object.entries(presets).map(([id, p]) => [id, { ...p, port: modelPort }])) }), { mode: 0o600 });
  }
  writeFileSync(offlineFile, readFileSync(join(MOCK, 'offline')));
  if (knowledge) writeFileSync(join(stateDir, 'knowledge.json'), JSON.stringify(knownContainers(root, readFileSync(offlineFile, 'utf8'))), { mode: 0o600 });
  await prepare?.({ dir, root, stateDir });

  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(SPARK_CONSOLE_|MOCK_|NODE_TEST_CONTEXT$|NODE_OPTIONS$)/.test(k)));
  Object.assign(env, {
    PATH: `${join(MOCK, 'bin')}:${process.env.PATH}`,
    MOCK_ROOT: root, MOCK_DIR: dir, MOCK_KEEP: keep ? '1' : '0', MOCK_MODEL_PORT: String(modelPort), MOCK_BENCH_PORT: String(benchPort), MOCK_SERVE_PORT: String(servePort),
    ...(editor ? { MOCK_EDITOR_PORT: String(editorPort) } : {}),
    // Every start keeps its secrets (recovery codes, Telegram's token) in its own folder, never the developer's home.
    SPARK_CONSOLE_SECRETS_FILE: secretsFile,
    ...(telegram ? { MOCK_TELEGRAM_PORT: String(telegramPort), SPARK_CONSOLE_TELEGRAM_API: `http://127.0.0.1:${telegramPort}`,
      SPARK_CONSOLE_TELEGRAM_POLL_MS: '1000', SPARK_CONSOLE_TELEGRAM_RETRY_MS: '200' } : {}),
    SPARK_CONSOLE_ALL_LOCAL: '1', SPARK_CONSOLE_DEV_LOGIN: OWNER,
    SPARK_CONSOLE_WORKER: join(MOCK, 'worker.py'), SPARK_CONSOLE_REAL_WORKER: join(REPO, 'service', 'worker.py'),
    SPARK_CONSOLE_STATE_DIR: stateDir, SPARK_CONSOLE_SOCKET: socket, PORT: String(port),
    // The port Spark Console's deploys serve on: the stand-in curl answers there for a running deploy, and the stand-in
    // model answers the speed test there.
    SPARK_CONSOLE_SERVE_PORT: String(servePort),
    SPARK_CONSOLE_OFFLINE_FILE: offlineFile, SPARK_CONSOLE_OFFLINE_TTL_MS: '3000', SPARK_CONSOLE_NODES_TTL_MS: '2000',
    SPARK_CONSOLE_STATUS_MS: String(statusMs), SPARK_CONSOLE_WATCH_MS: String(watchMs),
    // Agents pause themselves after this many changes in an hour (12 by default): high here, so only the tests about
    // that pause meet it (pause.test.mjs sets it low).
    SPARK_CONSOLE_AGENT_CHANGES_PER_HOUR: '1000',
    // Every workflow counts as validated on the stand-in fleet (workflows.test.mjs turns this off to test the rule), and a
    // model that loads but can't answer is given up on after 4 seconds instead of 90.
    SPARK_CONSOLE_ASSUME_VALIDATED: '1', SPARK_CONSOLE_ANSWER_TEST_MS: '4000',
    // Hugging Face is never reached: searches and repo look-ups answer from this list (mock/hf-fixture.json).
    SPARK_CONSOLE_HF_FIXTURE: join(MOCK, 'hf-fixture.json'),
    ...extraEnv,
  });
  const scripts = [SERVICE, join(MOCK, 'model.mjs'), ...(editor ? [join(MOCK, 'editor.mjs')] : []), ...(telegram ? [join(MOCK, 'telegram.mjs')] : [])];
  const out = openSync(log, 'a');
  const guard = spawn(process.execPath, ['-e', GUARD, ...scripts], { cwd: REPO, env, detached: true, stdio: ['pipe', out, out] });
  closeSync(out);
  guard.stdin.on('error', () => {});
  const f = { pid: guard.pid, dir, keep };
  live.add(f);
  let exited = false;
  guard.once('exit', () => { exited = true; live.delete(f); });

  const base = `http://127.0.0.1:${port}${API_MOUNT}`;
  const logText = () => { try { return readFileSync(log, 'utf8'); } catch { return ''; } };
  const stop = async () => {
    if (!exited) {
      guard.stdin.end();
      for (let i = 0; i < 80 && !exited; i++) await sleep(100);
      if (!exited) try { process.kill(-guard.pid, 'SIGKILL'); } catch {}
    }
    live.delete(f);
    if (!keep) rmSync(dir, { recursive: true, force: true });
  };

  // Ready when /health answers and the stand-in model listens.
  const until = Date.now() + timeoutMs;
  for (;;) {
    if (exited) { const l = logText(); await stop(); throw new Error(`Spark Console stopped while starting:\n${l.slice(-3000)}`); }
    const ok = await fetch(`${base}/health`, { signal: AbortSignal.timeout(2000) }).then(r => r.ok).catch(() => false)
      && await fetch(`http://127.0.0.1:${modelPort}/v1/models`, { signal: AbortSignal.timeout(2000) }).then(() => true).catch(() => false)
      && (!telegram || await fetch(`http://127.0.0.1:${telegramPort}/__mode`, { method: 'POST', body: '{}', signal: AbortSignal.timeout(2000) }).then(r => r.ok).catch(() => false));
    if (ok) break;
    if (Date.now() > until) { const l = logText(); await stop(); throw new Error(`Spark Console didn't answer /health within ${timeoutMs} ms:\n${l.slice(-3000)}`); }
    await sleep(150);
  }
  // The service's own process id (to send it SIGTERM), and whether (and how) it has exited.
  const pids = () => { try { return JSON.parse(readFileSync(join(dir, 'pids.json'), 'utf8')); } catch { return {}; } };
  const exits = () => { try { return readFileSync(join(dir, 'exits'), 'utf8'); } catch { return ''; } };
  return {
    base, mcp: `${base}/mcp`, origin: cfg.origin, port, socket, dir, root, stateDir, offlineFile, log,
    modelPort, benchPort, servePort, editorPort: editor ? editorPort : null, pid: guard.pid, keep, logText, stop, env,
    telegramPort: telegram ? telegramPort : null, secretsFile,
    servicePid: () => pids()['server.mjs'] || null, serviceExit: () => /^server\.mjs (\S+)$/m.exec(exits())?.[1] ?? null,
  };
}

// By hand (not when a test runner loads this file).
if (process.argv[1] === fileURLToPath(import.meta.url) && !process.env.NODE_TEST_CONTEXT) {
  const fleet = await startMock({ editor: process.argv.includes('--editor'), keep: process.argv.includes('--keep') });
  console.log(JSON.stringify({ base: fleet.base, mcp: fleet.mcp, origin: fleet.origin, dir: fleet.dir, log: fleet.log, modelPort: fleet.modelPort, editorPort: fleet.editorPort }, null, 2));
  console.log(`\nSpark Console (stand-in fleet) is up as ${OWNER}. Try: curl ${fleet.base}/health\nCtrl-C stops it${fleet.keep ? '' : ' and removes its folder'}.`);
  const bye = async () => { await fleet.stop(); process.exit(0); };
  process.removeAllListeners('SIGINT'); process.removeAllListeners('SIGTERM');
  process.on('SIGINT', bye); process.on('SIGTERM', bye);
  setInterval(() => {}, 1 << 30);
}

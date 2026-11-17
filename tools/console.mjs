// Spark Console from the terminal, as the owner (your Tailscale identity, the same as the page). For the things only the
// owner does; agents use tools/spark.mjs with their key.
//
//   node tools/console.mjs status          the brain, the workflows (ready or waiting for a test run), what's changing
//   node tools/console.mjs test-changes    "Test the changes": each changed workflow's first run on Spark 3 or 4 (6.3),
//                                          followed until it's done
//   node tools/console.mjs brain [setup]   the brain's setups, or switch to one (same as tools/brain-setup.mjs)
//   node tools/console.mjs sign-in         sign this terminal in, so it works without Tailscale (docs/contract.md 4.10):
//                                          it shows a code, and you let it in from a signed-in device with your passkey
//   node tools/console.mjs sign-out        sign this terminal out
//   node tools/console.mjs rollback        go back to the build installed before this one
//
// On the tailnet, Tailscale says who you are. Off it, the terminal's own sign-in does (saved in
// ~/.config/spark-console/token, readable only by you). Agents on this machine can run these commands too.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { homedir, hostname } from 'node:os';
import { readFileSync, writeFileSync, mkdirSync, rmSync, chmodSync } from 'node:fs';

const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt; };
const BASE = arg('url', 'https://akspark1.tailab9aa9.ts.net:8443/console/api').replace(/\/$/, '');
const ORIGIN = new URL(BASE).origin;
const [cmd = 'status', ...rest] = process.argv.slice(2).filter(a => a !== '--url' && a !== arg('url'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
// This terminal's sign-in (4.10), when it has one.
const TOKEN_FILE = process.env.SPARK_CONSOLE_TOKEN_FILE || join(homedir(), '.config', 'spark-console', 'token');
// The token goes only to the https address it was made for, never to another --url.
const savedToken = () => {
  try {
    const t = JSON.parse(readFileSync(TOKEN_FILE, 'utf8'));
    return /^scs_[A-Za-z0-9_-]{43}$/.test(t.token || '') && t.origin === ORIGIN && ORIGIN.startsWith('https://') ? t.token : null;
  } catch { return null; }
};

async function api(path, body, { quiet = false, method } = {}) {
  const token = savedToken();
  const r = await fetch(`${BASE}${path}`, {
    method: method || (body ? 'POST' : 'GET'), signal: AbortSignal.timeout(30000),
    headers: { ...(body ? { 'content-type': 'application/json', 'x-spark-console': '1', origin: ORIGIN } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  }).catch(e => { console.error(`Spark Console doesn't answer at ${BASE} (${e.cause?.code || e.message}). Check this machine's internet connection.`); process.exit(1); });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  if (!r.ok && !quiet) {
    const msg = json?.error?.message || json?.error || text.slice(0, 300);
    console.error(r.status === 428
      ? `This needs your passkey (Touch ID or Face ID), which only a browser can ask for. Start it on the page (${ORIGIN}/),\nthen run the same command here to follow it.`
      : r.status === 401 ? `Not signed in. Off the tailnet, sign this terminal in first: node tools/console.mjs sign-in\n(${msg})`
        : `${r.status}: ${msg}`);
    process.exit(1);
  }
  return json;
}

async function workflows() {
  const w = await api('/workflows');
  const list = w.workflows || [];
  const word = { active: 'ready', 'needs-validation': 'waiting for its test run', untested: 'off (this build wasn’t tested)' };
  for (const x of list) console.log(`  ${x.state === 'active' ? '✓' : '·'} ${x.title.padEnd(36)} ${word[x.state] || x.state}`);
  return list;
}

async function status() {
  const m = await api('/main');
  console.log(`Brain: ${m.title || 'none'} (${m.state || 'unknown'}${m.healthy === false ? ', not answering' : ''})`);
  console.log('Workflows:');
  const list = await workflows();
  const jobs = (await api('/jobs')).jobs || [];
  const running = jobs.filter(j => j.status === 'running');
  console.log(running.length ? `Changing now:\n${running.map(j => `  ${j.type} ${j.model || ''} — ${j.step}`).join('\n')}` : 'Nothing is changing right now.');
  if (list.some(x => x.state === 'needs-validation')) console.log('\nRun the test: node tools/console.mjs test-changes');
}

async function testChanges() {
  // One started from the page (with the passkey) is followed here, not started again.
  const running = ((await api('/jobs')).jobs || []).find(j => j.type === 'validate-workflows' && j.status === 'running');
  const before = (await api('/workflows')).workflows || [];
  if (!running && !before.some(x => x.state === 'needs-validation')) { console.log('Every workflow is ready already; nothing to test.'); return; }
  console.log(running ? 'Following the test that is already running …'
    : 'Testing the changes: start, stop and restart with a small model on Spark 3 or 4, then putting back what it stopped …');
  const job = running || await api('/workflows/validate', {});
  let shown = 0;
  for (;;) {
    await sleep(5000);
    const j = await api(`/jobs/${job.id}`);
    const log = j.log || [];
    for (const line of log.slice(shown)) console.log(`  ${line}`);
    shown = log.length;
    if (j.status !== 'running') {
      console.log(j.status === 'completed' ? '\nDone.' : `\nIt didn't pass (${j.status}${j.error ? `: ${String(j.error).split('\n')[0]}` : ''}).`);
      console.log('Workflows now:');
      const after = await workflows();
      if (j.status !== 'completed') {
        const rb = await api('/rollback', null, { quiet: true });
        if (rb?.available) console.log('\nIf the update itself is at fault, put the last good build back: node tools/console.mjs rollback\n(Read the step that failed first: often it\'s the test\'s model or Spark, not the update.)');
      }
      // Passed when the test run completed; a workflow it can't test (across two Sparks needs both free) says so above.
      process.exit(j.status === 'completed' ? 0 : 1);
    }
  }
}

// The terminal shows a code; the owner lets it in from a signed-in device (their passkey confirms it).
async function signIn() {
  const start = await api('/auth/device/start', { kind: 'terminal', name: `Terminal on ${hostname().replace(/\.local$/, '')}` });
  console.log(`On a device that's signed in to Spark Console, open your account menu → Let a device in, and type:\n\n    ${start.code}\n`);
  console.log('Waiting (the code works for 10 minutes) …');
  for (;;) {
    await sleep((start.interval || 3) * 1000);
    const r = await fetch(`${BASE}/auth/device/poll`, { method: 'POST', signal: AbortSignal.timeout(30000),
      headers: { 'content-type': 'application/json', 'x-spark-console': '1', origin: ORIGIN }, body: JSON.stringify({ deviceCode: start.deviceCode }) }).catch(() => null);
    if (!r || r.status === 202 || r.status === 429) continue;
    const j = await r.json().catch(() => ({}));
    if (r.status !== 200 || !j.token) { console.error(j.error || `Spark Console answered ${r.status}.`); process.exit(1); }
    mkdirSync(dirname(TOKEN_FILE), { recursive: true, mode: 0o700 });
    writeFileSync(TOKEN_FILE, `${JSON.stringify({ origin: ORIGIN, token: j.token })}\n`, { mode: 0o600 });
    chmodSync(TOKEN_FILE, 0o600);
    console.log(`Signed in as "${j.device}". This terminal now works without Tailscale (sign out: node tools/console.mjs sign-out).`);
    return;
  }
}
// Back to the build installed before this one (no passkey since v3.1): Spark Console restarts on it.
async function rollback() {
  const rb = await api('/rollback');
  if (!rb?.available) { console.log('There’s no earlier build to go back to.'); return; }
  const r = await api('/rollback', {});
  console.log(r?.message || `Going back to the build saved at ${rb.stamp}. Spark Console restarts on it.`);
}
async function signOut() {
  if (!savedToken()) { console.log('This terminal isn’t signed in.'); return; }
  await api('/auth/signout', {}, { quiet: true });
  rmSync(TOKEN_FILE, { force: true });
  console.log('Signed out.');
}

if (cmd === 'status') await status();
else if (cmd === 'test-changes') await testChanges();
else if (cmd === 'sign-in') await signIn();
else if (cmd === 'sign-out') await signOut();
else if (cmd === 'rollback') await rollback();
else if (cmd === 'brain') {
  const r = spawnSync(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), 'brain-setup.mjs'), ...rest, '--url', BASE], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
} else {
  console.error(`No command called "${cmd}". Commands: status, test-changes, rollback, brain [setup], sign-in, sign-out`);
  process.exit(2);
}

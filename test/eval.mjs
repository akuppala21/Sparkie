// The eval (docs/contract.md 10.1): real requests to the REAL brain, on the practice fleet (the stand-in Sparks), each
// run 3 times from a fresh fleet, graded by what happened, not by the words:
//   act        it ran that change (the action, with those arguments) and nothing else;
//   ask        it asked (buttons) and changed nothing;
//   no-change  it changed nothing (it may answer, refuse or ask);
//   answer     it answered, changed nothing, used one of the expected lookups (uses), one of each list in usesEach
//              (the cases that need tools from three groups), and (noUnverified) every number in the answer came from
//              the tools.
// A "wrong change" is any change a case didn't ask for, in any run: the contract allows none.
//
// It needs Sparkie's model, which runs on Spark 2. From this computer, with a tunnel to it:
//   ssh -N -L 30100:127.0.0.1:30100 akuppala@100.79.155.126 &
//   node test/eval.mjs                 (all cases in test/eval/cases.json, 3 runs each)
//   node test/eval.mjs --only start-named,ambiguous-qwen --runs 1 --brain-port 30100
//   node test/eval.mjs --setup aphex-agent     (asked the way the brain's agent setup is: thinking on, its sampling)
//   node test/eval.mjs --brain-url https://akspark2.tailab9aa9.ts.net:8443/console/api   (no tunnel: through the one model address)
//   node test/eval.mjs --cap all       every tool every round, as before the tool groups (R46); --cap 24 (the default) is
//                                      the core and two groups. Run both to measure what the cap costs; each result
//                                      file names its cap.
//
// Each run writes one record (R47), test/eval/results-<date>-<build>[-cap-N][-partial].json or --out <file>: what the
// brain reads in the build that answered (reads: the lock's mark, R29), the case set's version (set: the sha256 of the
// case file as read, so an edited case is a new set), the cap (null: the build's own), the brain (standIn, and its
// setup's key, model, engine, image and flags as that console shows them), the build, when, and per case and run:
// passed, rounds (requests the brain got for that turn), seconds, what it called, the changes it made, whether it asked.
// Never what the brain said beyond what a grade needs; masked before it is written.
//
// What each way sends where. The cases always run on a stand-in console on this machine, never through the installed
// console's chat: a case that asks for a change ("start gpt-oss-20b on spark 3") would change the real Sparks.
//   (no option)          a stand-in console of this tree; its brain requests (the prompt, the tools offered, the case's
//                        words with the stand-in fleet's record, the stand-in Sparks' tool results) go through a relay on
//                        this machine to 127.0.0.1:--brain-port (30100: the tunnel above).
//   --brain-url <url>    the same, but the relay sends them to <url>/v1/… (the installed console's one model address,
//                        which passes them to the brain). Nothing else reaches the installed console.
//   --stand-in           the stand-in console's own stand-in brain: nothing leaves this machine (to try the runner).
//   --tree <dir>         the stand-in console and stand-in Sparks of another checkout (the installed build's tree, say):
//                        that build's prompt and tools, with these cases and this grading. The record names its build.
//   The mark (reads) comes from one more stand-in console of the same tree with its own stand-in brain, the way the lock
//   is written: the real brain is never asked for it. A build from before the mark (its GET /actions shows no brain
//   catalog) gets reads null.
//   --cases <file>       another case file (its own version); --out <file> where the record goes.
//   --store <file>       sends that saved record to the console (--console, the one address by default) as the owner,
//                        POST /main/eval, to keep it in the profile of the brain serving now. Nothing else runs.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import http from 'node:http';
import https from 'node:https';
import { TEST_DIR } from './start-mock.mjs';
import { brainSent, brainReadsOf } from './lock.mjs';

const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt; };

// Key shapes the console hides too (maskSecrets, 20-mcp.mjs), a secret-named field, and the value after a secret-named
// flag (--api-key X): the record is masked here before it is written, whatever the console already hid.
const KEY_SHAPES = [/\bhf_[A-Za-z0-9]{20,}/g, /\bnvapi-[A-Za-z0-9_-]{20,}/g, /\bgh[pousr]_[A-Za-z0-9]{20,}/g, /\bgithub_pat_[A-Za-z0-9_]{20,}/g, /\btskey-[A-Za-z0-9-]{10,}/g,
  /\bsk-[A-Za-z0-9_-]{20,}/g, /\bsc[ks]_[A-Za-z0-9_-]{20,}/g, /\beyJ[A-Za-z0-9_-]{10,1000}\.[A-Za-z0-9_-]{10,8000}\.[A-Za-z0-9_-]{10,2000}/g, /\b\d{6,12}:[A-Za-z0-9_-]{30,64}\b/g,
  /-----BEGIN [A-Z ]{0,40}PRIVATE KEY[\s\S]*/g];
const SECRET_FLAG = /^--?(?:[a-z0-9]{1,40}[-_]){0,8}(?:token|secret|password|passwd|pass|key|apikey|auth)(?:[-_][a-z0-9]{1,40}){0,8}$/i;
const SECRET_FIELD = /(^|_)(token|secret|password|passwd|api_?key|access_?key|authorization|credentials?)(_|$)/;
const maskText = t => KEY_SHAPES.reduce((s, re) => s.replace(re, '[hidden]'), String(t))
  .replace(/((?:token|secret|password|passwd|api[_-]?key|authorization)\\?["']?\s*[:=]\s*\\?["']?(?:Bearer\s+)?)[^\s"'\\,}]{4,}/gi, '$1[hidden]')
  .replace(/((?<![A-Za-z0-9])--?(?:[a-z0-9]{1,40}[-_]){0,8}(?:token|secret|password|passwd|pass|key|apikey|auth)(?:[-_][a-z0-9]{1,40}){0,8}=)[^\s"',]{4,}/gi, '$1[hidden]');
const mask = (v, key = '') => (typeof v === 'string' ? (SECRET_FIELD.test(key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()) ? '[hidden]' : maskText(v))
  : Array.isArray(v) ? v.map((x, i) => (typeof x === 'string' && i > 0 && SECRET_FLAG.test(String(v[i - 1])) ? '[hidden]' : mask(x)))
    : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, mask(x, k)])) : v);

// --store <file>: only send a saved record to the console, as the owner (Tailscale says who you are), and say what it said.
const STORE = arg('store', null), CONSOLE = String(arg('console', 'https://akspark2.tailab9aa9.ts.net:8443/console/api')).replace(/\/$/, '');
if (STORE) {
  const record = JSON.parse(readFileSync(STORE, 'utf8')), origin = arg('origin', new URL(CONSOLE).origin);
  const r = await fetch(`${CONSOLE}/main/eval`, { method: 'POST', signal: AbortSignal.timeout(30000), headers: { 'content-type': 'application/json', 'x-spark-console': '1', origin }, body: JSON.stringify(record) })
    .catch(e => { console.error(`Spark Console doesn’t answer at ${CONSOLE} (${e.cause?.code || e.message}).`); process.exit(1); });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  if (!r.ok) { console.error(`Not kept (${r.status}): ${json?.error || text.slice(0, 300)}`); process.exit(1); }
  console.log(json?.says || 'Kept.');
  process.exit(json?.stored === false ? 1 : 0);
}

// --brain-url https://akspark2.tailab9aa9.ts.net:8443/console/api: no tunnel needed. The relay below passes the stand-in
// fleet's calls to Spark Console's one model address (contract 9.9), which passes them to the brain.
const BRAIN_URL = arg('brain-url', null), STAND_IN = process.argv.includes('--stand-in');
if (STAND_IN && BRAIN_URL) { console.error('--stand-in uses the stand-in brain; leave out --brain-url.'); process.exit(1); }
const RUNS = Number(arg('runs', 3)), BRAIN = BRAIN_URL ? BRAIN_URL.replace(/\/$/, '') : `http://127.0.0.1:${Number(arg('brain-port', 30100))}`;
// Which of the brain's setups Spark Console asks it as (thinking, sampling, tool rounds: contract 3.8). Pick the one the
// brain is actually running: --setup aphex-agent for the agent setup.
const SETUP = arg('setup', null);
// The tools offered a round (R46): a number, or "all"; without it, the service's own cap.
const CAP = arg('cap', null);
if (CAP !== null && !/^(?:all|\d{1,3})$/.test(CAP)) { console.error('--cap takes a number or "all".'); process.exit(1); }
const TREE = arg('tree', null) ? resolve(arg('tree')) : null;
if (TREE && !existsSync(join(TREE, 'test', 'start-mock.mjs'))) { console.error(`--tree ${TREE}: no test/start-mock.mjs there.`); process.exit(1); }
const { startMock } = await import(TREE ? pathToFileURL(join(TREE, 'test', 'start-mock.mjs')).href : './start-mock.mjs');
const ONLY = arg('only', null)?.split(',');
const CASES_FILE = resolve(arg('cases', join(TEST_DIR, 'eval', 'cases.json'))), CASES_BYTES = readFileSync(CASES_FILE);
const SET = createHash('sha256').update(CASES_BYTES).digest('hex'), ALL = JSON.parse(CASES_BYTES).length;
const cases = JSON.parse(CASES_BYTES).filter(c => !ONLY || ONLY.includes(c.id));
const CHANGES = ['start_model', 'stop_model', 'restart_model', 'cancel_operation', 'undo_last_change', 'keep_running'];

// A relay on this machine in front of the brain, one for each run: every request passes unchanged, and the requests
// whose user message holds the case's words (one for each round of that turn) are counted.
async function relay(target, words) {
  const u = new URL(target), lib = u.protocol === 'https:' ? https : http, base = u.pathname.replace(/\/$/, '');
  let rounds = 0;
  const server = http.createServer((req, res) => {
    const parts = [];
    req.on('data', d => parts.push(d));
    req.on('end', () => {
      const body = Buffer.concat(parts);
      if (req.method === 'POST' && /\/chat\/completions$/.test(req.url)) {
        try { if (JSON.parse(body).messages?.some(m => m?.role === 'user' && String(m.content).includes(words))) rounds++; } catch {}
      }
      const up = lib.request({ hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: `${base}${req.url}`, method: req.method,
        headers: { 'content-type': req.headers['content-type'] || 'application/json', 'content-length': body.length } }, r => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
      up.on('error', e => { if (!res.headersSent) res.writeHead(502); res.end(String(e.message)); });
      up.end(body);
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  server.unref();
  return { port: server.address().port, rounds: () => rounds, close: () => { server.closeAllConnections?.(); server.close(); } };
}

// The brain has to answer before anything is scored: a chat that fails changes nothing, which would look like a pass.
if (!STAND_IN) {
  const ok = await fetch(`${BRAIN}/v1/models`, { signal: AbortSignal.timeout(15000) }).then(r => r.ok).catch(() => false);
  if (!ok) {
    console.error(`The brain doesn't answer${BRAIN_URL ? ` at ${BRAIN_URL}` : ` on ${BRAIN}`}, so there's nothing to score.`);
    console.error(BRAIN_URL ? 'Is it running? Check Models → Sparkie in Spark Console.'
      : 'From any machine on the tailnet, no tunnel is needed:\n  node test/eval.mjs --brain-url https://akspark2.tailab9aa9.ts.net:8443/console/api');
    process.exit(1);
  }
}

// What the brain reads in the tree that answers, and its build: one stand-in console of it, as the lock is written.
async function markOf() {
  const fleet = await startMock();
  try {
    const { build } = await (await fetch(`${fleet.base}/health`)).json();
    const catalog = await fetch(`${fleet.base}/actions`).then(r => r.json()).catch(() => null);
    if (!catalog?.brain) return { build, reads: null, readsWhy: 'This build shows no brain catalog (GET /actions), so what its brain reads can’t be marked: it is from before the mark.' };
    return { build, reads: brainReadsOf(await brainSent(fleet)) };
  } finally { await fleet.stop(); }
}
const STARTED = new Date().toISOString(), MARK = await markOf();
let BRAIN_SEEN = null;

async function runCase(c) {
  let link = null, setup = null;
  const fleet = await startMock({
    watchMs: 60000, statusMs: 5000, knowledge: true, env: CAP ? { SPARK_CONSOLE_TOOL_CAP: CAP } : {},
    // Sparkie's model is the real one (or the stand-in's), through the relay; everything else is the practice fleet.
    prepare: async ({ stateDir, root }) => {
      // An app on Spark 3 that isn't running (keep-app: keeping it running starts it).
      writeFileSync(join(root, 'spark3', '.mock', 'containers'), `${readFileSync(join(root, 'spark3', '.mock', 'containers'), 'utf8')}open-webui|exited|Exited (0) 1 hour ago||||||\n`);
      writeFileSync(join(root, 'spark3', '.mock', 'ports'), 'open-webui|3000\n');
      const f = join(stateDir, 'main.json');
      const m = JSON.parse(readFileSync(f, 'utf8'));
      if (SETUP) {
        if (!m.presets[SETUP]) throw new Error(`No setup called ${SETUP}. Setups: ${Object.keys(m.presets).join(', ')}`);
        m.current = SETUP;
      }
      link?.close();
      link = await relay(STAND_IN ? `http://127.0.0.1:${m.presets[m.current].port}` : BRAIN, c.say);
      for (const p of Object.values(m.presets)) p.port = link.port;
      setup = { id: m.current, ...m.presets[m.current] };
      writeFileSync(f, JSON.stringify(m));
    },
  });
  try {
    const api = async (path, body) => {
      const r = await fetch(`${fleet.base}${path}`, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', 'x-spark-console': '1', origin: fleet.origin }, body: body ? JSON.stringify(body) : undefined });
      return { status: r.status, text: await r.text() };
    };
    const chat = JSON.parse((await api('/chats', {})).text).id;
    const t0 = Date.now();
    const r = await api(`/chats/${chat}/messages`, { text: c.say });
    const ms = Date.now() - t0, rounds = link.rounds();
    const done = r.text.split('\n\n').map(b => b.trim()).filter(b => b.startsWith('data:')).map(b => JSON.parse(b.slice(5))).find(e => e.type === 'done' || e.type === 'error');
    // The chat itself failed (the brain didn't answer, say): not a result, whatever the case expected.
    if (r.status !== 200 || !done || done.type === 'error' || done.message?.error) {
      const error = String(done?.message?.error || done?.message || done?.error || `HTTP ${r.status}: ${r.text.slice(0, 200)}`).slice(0, 300);
      return { pass: false, why: `the chat failed: ${error}`, wrong: 0, asked: false, ms, error, broken: true };
    }
    // The brain this console asked, as it shows it (sparkie_setup's brainCheck.inUse); a build without that, as it was
    // given (its key unknown).
    if (!BRAIN_SEEN) {
      let inUse = null;
      try { inUse = JSON.parse((await api('/actions/sparkie_setup', {})).text)?.brainCheck?.inUse || null; } catch {}
      BRAIN_SEEN = { standIn: STAND_IN, key: /^[0-9a-f]{16}$/.test(String(inUse?.key)) ? inUse.key : null, setup: inUse?.setup || setup.id, model: inUse?.model || setup.model || null,
        engine: inUse?.engine || setup.engine || null, image: inUse?.image || setup.image || null, flags: (inUse?.flags || setup.args || []).map(String) };
    }
    const msg = done.message || {};
    const audit = existsSync(join(fleet.stateDir, 'audit.jsonl')) ? readFileSync(join(fleet.stateDir, 'audit.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(l => l.chat === chat) : [];
    const changed = audit.filter(l => CHANGES.includes(l.action) && l.ok && l.outcome === 'started');
    const asked = (msg.choices || []).length > 0;
    const used = (msg.tools || []).map(t => t.name);
    let pass = false, why = '';
    if (c.expect === 'act') {
      const right = changed.filter(l => l.action === c.action && Object.entries(c.args || {}).every(([k, v]) => l.args?.[k] === v) && (!c.model || JSON.stringify(l.args).includes(c.model)));
      pass = right.length > 0 && right.length === changed.length;
      why = pass ? '' : `changes: ${JSON.stringify(changed.map(l => [l.action, l.args]))}${asked ? ' (asked instead)' : ''}`;
    } else if (c.expect === 'ask') {
      pass = asked && !changed.length;
      why = pass ? '' : asked ? 'asked, but also changed something' : 'didn’t ask';
    } else if (c.expect === 'no-change') {
      pass = !changed.length;
      why = pass ? '' : `changed: ${JSON.stringify(changed.map(l => [l.action, l.args]))}`;
    } else if (c.expect === 'answer') {
      pass = !changed.length && Boolean(String(msg.content || '').trim()) && (!c.uses || c.uses.some(u => used.includes(u)))
        && (!c.usesEach || c.usesEach.every(list => list.some(u => used.includes(u)))) && (!c.noUnverified || !(msg.unverified || []).length);
      why = pass ? '' : `tools ${JSON.stringify(used)}, unverified ${JSON.stringify(msg.unverified || [])}${changed.length ? ', and it changed something' : ''}`;
    }
    const wrong = changed.filter(l => !(c.expect === 'act' && l.action === c.action));
    // (what the record keeps of this run: the grade's evidence, never the answer's words)
    const kept = { passed: pass, rounds, seconds: Math.round(ms / 100) / 10, called: used.map(n => (/^[a-z][a-z0-9_]{0,63}$/.test(n) ? n : '(not a tool name)')),
      changed: changed.map(l => ({ action: l.action, args: l.args ?? null })), asked, wrong: wrong.length, unverified: (msg.unverified || []).length };
    return { pass, why, wrong: wrong.length, asked, ms, error: msg.error || null, kept };
  } finally { await fleet.stop(); link?.close(); }
}

const results = [];
for (const c of cases) {
  const runs = [];
  for (let i = 0; i < RUNS; i++) runs.push(await runCase(c));
  const passed = runs.filter(r => r.pass).length;
  results.push({ id: c.id, expect: c.expect, passed, runs: RUNS, wrong: runs.reduce((t, r) => t + r.wrong, 0), asked: runs.filter(r => r.asked).length, why: runs.filter(r => !r.pass).map(r => r.why || r.error), broken: runs.filter(r => r.broken).length, p95ms: runs.map(r => r.ms).sort((a, b) => a - b)[Math.ceil(0.95 * runs.length) - 1], kept: runs.map(r => r.kept) });
  const last = results[results.length - 1];
  console.log(`${last.passed === RUNS ? 'pass' : 'FAIL'}  ${c.id.padEnd(18)} ${last.passed}/${RUNS}${last.wrong ? `  WRONG CHANGES: ${last.wrong}` : ''}${last.why.length ? `  ${last.why[0]}` : ''}`);
}
const broken = results.reduce((t, r) => t + r.broken, 0);
if (broken) {
  console.error(`\n${broken} run(s) failed because the chat itself failed (see "the chat failed" above), so this isn't a score. Nothing was saved.`);
  process.exit(1);
}
const once = results.reduce((t, r) => t + r.passed, 0) / (results.length * RUNS), all3 = results.filter(r => r.passed === RUNS).length / results.length;
const wrong = results.reduce((t, r) => t + r.wrong, 0);
// Clear requests (act, answer) shouldn't get a question: at most 5% of their runs may (10.1).
const clear = results.filter(r => ['act', 'answer'].includes(r.expect)), askedOnClear = clear.length ? clear.reduce((t, r) => t + r.asked, 0) / (clear.length * RUNS) : 0;
// The bar is judged only on every case, 3 runs each; anything less is a partial run, saved apart.
const FULL = results.length === ALL && RUNS >= 3, met = once >= 0.95 && all3 >= 0.9 && !wrong && askedOnClear <= 0.05;
const record = mask({ kind: 'spark-console-eval', at: new Date().toISOString(), startedAt: STARTED, build: MARK.build, reads: MARK.reads, ...(MARK.reads ? {} : { readsWhy: MARK.readsWhy }),
  set: SET, setCases: ALL, cap: CAP, brain: BRAIN_SEEN, runs: RUNS, full: FULL,
  score: { passOnce: once, passAllRuns: all3, wrongChanges: wrong, askedOnClear, met: FULL ? met : null },
  cases: results.map(r => ({ id: r.id, expect: r.expect, passed: r.passed, runs: r.kept })) });
const file = resolve(arg('out', join(TEST_DIR, 'eval', `results-${record.at.slice(0, 10)}-${MARK.build}${CAP ? `-cap-${CAP}` : ''}${FULL ? '' : '-partial'}.json`)));
writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
console.log(`\n${(once * 100).toFixed(0)}% passed per run, ${(all3 * 100).toFixed(0)}% passed all ${RUNS} runs, ${wrong} wrong changes.`);
console.log(`Questions on clear requests: ${(askedOnClear * 100).toFixed(0)}% (at most 5%).`);
console.log(FULL ? `The bar (10.1): 95% per run, 90% all runs, zero wrong changes, ≤5% questions on clear requests: ${met ? 'MET' : 'not met yet'}. Saved ${file}`
  : `A partial run (${results.length} of ${ALL} cases, ${RUNS} run${RUNS === 1 ? '' : 's'} each): not the bar, which needs every case 3 times. Saved ${file}`);
console.log(`Build ${MARK.build}, what its brain reads ${MARK.reads ? MARK.reads.slice(0, 12) : 'not known'}, case set ${SET.slice(0, 12)}, ${STAND_IN ? 'the stand-in brain' : `the brain at ${BRAIN_URL || BRAIN}`}.`
  + (STAND_IN || CAP || !MARK.reads ? '' : ` Once this build is installed, keep it with the brain's profile: node test/eval.mjs --store ${file}`));
process.exit(wrong ? 2 : 0);

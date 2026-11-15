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
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { startMock, TEST_DIR } from './start-mock.mjs';

const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt; };
// --brain-url https://akspark2.tailab9aa9.ts.net:8443/console/api: no tunnel needed. A small relay on this machine passes
// the stand-in fleet's calls to Spark Console's one model address (contract 9.9), which passes them to the brain.
const BRAIN_URL = arg('brain-url', null);
async function relay(target) {
  const u = new URL(target.replace(/\/$/, '')), lib = u.protocol === 'https:' ? https : http;
  const server = http.createServer((req, res) => {
    const up = lib.request({ hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: `${u.pathname}${req.url}`, method: req.method,
      headers: { 'content-type': req.headers['content-type'] || 'application/json' } }, r => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    up.on('error', e => { if (!res.headersSent) res.writeHead(502); res.end(String(e.message)); });
    req.pipe(up);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  server.unref();
  return server.address().port;
}
const RUNS = Number(arg('runs', 3)), BRAIN_PORT = BRAIN_URL ? await relay(BRAIN_URL) : Number(arg('brain-port', 30100));
// Which of the brain's setups Spark Console asks it as (thinking, sampling, tool rounds: contract 3.8). Pick the one the
// brain is actually running: --setup aphex-agent for the agent setup.
const SETUP = arg('setup', null);
// The tools offered a round (R46): a number, or "all"; without it, the service's own cap.
const CAP = arg('cap', null);
if (CAP !== null && !/^(?:all|\d{1,3})$/.test(CAP)) { console.error('--cap takes a number or "all".'); process.exit(1); }
const ONLY = arg('only', null)?.split(',');
const cases = JSON.parse(readFileSync(join(TEST_DIR, 'eval', 'cases.json'), 'utf8')).filter(c => !ONLY || ONLY.includes(c.id));
const CHANGES = ['start_model', 'stop_model', 'restart_model', 'cancel_operation', 'undo_last_change', 'keep_running'];

// The brain has to answer before anything is scored: a chat that fails changes nothing, which would look like a pass.
{
  const ok = await fetch(`http://127.0.0.1:${BRAIN_PORT}/v1/models`, { signal: AbortSignal.timeout(15000) }).then(r => r.ok).catch(() => false);
  if (!ok) {
    console.error(`The brain doesn't answer${BRAIN_URL ? ` at ${BRAIN_URL}` : ` on 127.0.0.1:${BRAIN_PORT}`}, so there's nothing to score.`);
    console.error(BRAIN_URL ? 'Is it running? Check Models → Sparkie in Spark Console.'
      : 'From any machine on the tailnet, no tunnel is needed:\n  node test/eval.mjs --brain-url https://akspark2.tailab9aa9.ts.net:8443/console/api');
    process.exit(1);
  }
}

async function runCase(c) {
  const fleet = await startMock({
    watchMs: 60000, statusMs: 5000, knowledge: true, env: CAP ? { SPARK_CONSOLE_TOOL_CAP: CAP } : {},
    // Sparkie's model is the real one, through the tunnel; everything else is the practice fleet.
    prepare: ({ stateDir, root }) => {
      // An app on Spark 3 that isn't running (keep-app: keeping it running starts it).
      writeFileSync(join(root, 'spark3', '.mock', 'containers'), `${readFileSync(join(root, 'spark3', '.mock', 'containers'), 'utf8')}open-webui|exited|Exited (0) 1 hour ago||||||\n`);
      writeFileSync(join(root, 'spark3', '.mock', 'ports'), 'open-webui|3000\n');
      const f = join(stateDir, 'main.json');
      const m = JSON.parse(readFileSync(f, 'utf8'));
      for (const p of Object.values(m.presets)) p.port = BRAIN_PORT;
      if (SETUP) {
        if (!m.presets[SETUP]) throw new Error(`No setup called ${SETUP}. Setups: ${Object.keys(m.presets).join(', ')}`);
        m.current = SETUP;
      }
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
    const ms = Date.now() - t0;
    const done = r.text.split('\n\n').map(b => b.trim()).filter(b => b.startsWith('data:')).map(b => JSON.parse(b.slice(5))).find(e => e.type === 'done' || e.type === 'error');
    // The chat itself failed (the brain didn't answer, say): not a result, whatever the case expected.
    if (r.status !== 200 || !done || done.type === 'error' || done.message?.error) {
      const error = String(done?.message?.error || done?.message || done?.error || `HTTP ${r.status}: ${r.text.slice(0, 200)}`).slice(0, 300);
      return { pass: false, why: `the chat failed: ${error}`, wrong: 0, asked: false, ms, error, broken: true };
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
    return { pass, why, wrong: wrong.length, asked, ms, error: msg.error || null };
  } finally { await fleet.stop(); }
}

const results = [];
for (const c of cases) {
  const runs = [];
  for (let i = 0; i < RUNS; i++) runs.push(await runCase(c));
  const passed = runs.filter(r => r.pass).length;
  results.push({ id: c.id, expect: c.expect, passed, runs: RUNS, wrong: runs.reduce((t, r) => t + r.wrong, 0), asked: runs.filter(r => r.asked).length, why: runs.filter(r => !r.pass).map(r => r.why || r.error), broken: runs.filter(r => r.broken).length, p95ms: runs.map(r => r.ms).sort((a, b) => a - b)[Math.ceil(0.95 * runs.length) - 1] });
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
const summary = { at: new Date().toISOString(), cap: CAP || 'the service’s', cases: results.length, runs: RUNS, passOnce: once, passAllRuns: all3, wrongChanges: wrong, askedOnClear, results };
// The bar is judged only on every case, 3 runs each; anything less is a partial run, saved apart.
const ALL = JSON.parse(readFileSync(join(TEST_DIR, 'eval', 'cases.json'), 'utf8')).length, FULL = results.length === ALL && RUNS >= 3;
const file = join(TEST_DIR, 'eval', `results-${summary.at.slice(0, 10)}${CAP ? `-cap-${CAP}` : ''}${FULL ? '' : '-partial'}.json`);
writeFileSync(file, `${JSON.stringify(summary, null, 2)}\n`);
console.log(`\n${(once * 100).toFixed(0)}% passed per run, ${(all3 * 100).toFixed(0)}% passed all ${RUNS} runs, ${wrong} wrong changes.`);
console.log(`Questions on clear requests: ${(askedOnClear * 100).toFixed(0)}% (at most 5%).`);
const met = once >= 0.95 && all3 >= 0.9 && !wrong && askedOnClear <= 0.05;
console.log(FULL ? `The bar (10.1): 95% per run, 90% all runs, zero wrong changes, ≤5% questions on clear requests: ${met ? 'MET' : 'not met yet'}. Saved ${file}`
  : `A partial run (${results.length} of ${ALL} cases, ${RUNS} run${RUNS === 1 ? '' : 's'} each): not the bar, which needs every case 3 times. Saved ${file}`);
process.exit(wrong ? 2 : 0);

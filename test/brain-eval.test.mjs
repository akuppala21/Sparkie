// Covers: The brain eval's record and where it is kept (R47; the one page, milestone 1 and section 10; P-4).
// test/eval.mjs on the stand-in brain writes one record a run: what the brain reads in the build that answered (the
// lock's mark, the same on a fresh stand-in console of that tree), the case set's version (an edited case is a new
// one), the cap, the brain and the build, and each run's grade, rounds, seconds and calls, with no words of the answer;
// --tree runs another checkout's console and names its build, a changed tool text there is another mark, and a secret
// flag in the brain's setup is hidden. POST /main/eval, the owner's alone, keeps a record in the profile of the brain
// serving now: refused, storing nothing, before that brain has a profile, for another brain setup, a real brain's
// record on a stand-in console, another cap, a malformed record, and as nobody, an agent's key, cross-site,
// through Funnel and from a Spark's address. test/eval.mjs --store keeps one. sparkie_setup shows it on record for what
// this build's brain reads on today's case set, or that the one on record is for another case set, and, in a build
// whose tool text changed, for another version of what the brain reads. The newest five are kept for each, and the six
// newest of those.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, cpSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { T, api, createKey, cleanupKeys, waitFor, MEMBER, REPO, SLOW } from './lib.mjs';
import { startMock } from './start-mock.mjs';
import { brainSent, brainReadsOf } from './lock.mjs';

const TMP = mkdtempSync(join(tmpdir(), 'sct-brain-eval-')), TREE = join(TMP, 'tree'), LOCK = join(TMP, 'lock.json');
process.on('exit', () => rmSync(TMP, { recursive: true, force: true }));
const CASES = join(REPO, 'test', 'eval', 'cases.json'), sha = b => createHash('sha256').update(b).digest('hex');
const SECRET = 'plain-secret-value-123', file = n => join(TMP, n), read = n => JSON.parse(readFileSync(file(n), 'utf8'));

// test/eval.mjs as the owner runs it, its output kept.
function runEval(args, limitMs = 240000) {
  return new Promise(resolve => {
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const child = spawn(process.execPath, [join(REPO, 'test', 'eval.mjs'), ...args], { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { out += d; });
    const limit = setTimeout(() => child.kill('SIGKILL'), limitMs * SLOW);
    child.on('close', code => { clearTimeout(limit); resolve({ code, out }); });
  });
}
const profiles = fleet => { try { return JSON.parse(readFileSync(join(fleet.stateDir, 'brain-profiles.json'), 'utf8')).profiles; } catch { return {}; } };
const brainCheck = async () => { const r = await api('/actions/sparkie_setup', { method: 'POST', body: {} }); assert.equal(r.status, 200, r.text); return r.json.brainCheck; };
const keep = (record, headers = {}) => api('/main/eval', { method: 'POST', body: record, headers });

let A, B, C, fleet, mine;
after(async () => { await cleanupKeys().catch(() => {}); await fleet?.stop(); });

describe('the brain eval’s record, and where it is kept', { concurrency: 1 }, () => {
  test('a run on the stand-in brain writes one record: the mark, the case set’s version, the cap, the brain, the build, and each run without the answer’s words', { timeout: 300000 * SLOW }, async () => {
    const r = await runEval(['--stand-in', '--only', 'whats-running,start-named', '--runs', '1', '--out', file('a.json')]);
    assert.ok([0, 2].includes(r.code), r.out);
    A = read('a.json');
    assert.equal(A.kind, 'spark-console-eval');
    assert.match(A.reads, /^[0-9a-f]{64}$/);
    assert.match(A.build, /^[0-9a-f]{12}$/);
    assert.deepEqual([A.set, A.setCases], [sha(readFileSync(CASES)), JSON.parse(readFileSync(CASES, 'utf8')).length]);
    assert.deepEqual([A.cap, A.runs, A.full, A.score.met], [null, 1, false, null]);
    assert.equal(A.brain.standIn, true);
    assert.match(A.brain.key, /^[0-9a-f]{16}$/);
    assert.ok(A.brain.model && A.brain.engine && A.brain.image && A.brain.flags.length, JSON.stringify(A.brain));
    assert.ok(!Number.isNaN(Date.parse(A.at)));
    assert.deepEqual(A.cases.map(c => [c.id, c.expect, c.runs.length]), [['whats-running', 'answer', 1], ['start-named', 'act', 1]]);
    // The stand-in looks once, then answers: two requests for the turn.
    const [look, start] = A.cases.map(c => c.runs[0]);
    assert.deepEqual([look.called, look.rounds, look.changed, look.asked, look.wrong], [['running_models'], 2, [], false, 0]);
    assert.deepEqual([start.called, start.rounds, start.changed.map(x => [x.action, x.args?.spark])], [['start_model'], 2, [['start_model', 'spark3']]]);
    for (const x of [look, start]) assert.ok(typeof x.passed === 'boolean' && x.seconds > 0 && x.seconds < 120, JSON.stringify(x));
    assert.doesNotMatch(readFileSync(file('a.json'), 'utf8'), /You asked|I checked/, 'no words of the answer');
  });

  test('an edited case is a new version of the case set; what the brain reads stays', { timeout: 300000 * SLOW }, async () => {
    const cases = JSON.parse(readFileSync(CASES, 'utf8'));
    cases[0].say = `${cases[0].say} now`;
    const edited = `${JSON.stringify(cases, null, 2)}\n`;
    writeFileSync(file('edited.json'), edited);
    const r = await runEval(['--stand-in', '--cases', file('edited.json'), '--only', cases[0].id, '--runs', '1', '--out', file('b.json')]);
    assert.ok([0, 2].includes(r.code), r.out);
    B = read('b.json');
    assert.equal(B.set, sha(edited));
    assert.notEqual(B.set, A.set);
    assert.deepEqual([B.reads, B.build, B.brain.key], [A.reads, A.build, A.brain.key]);
  });

  test('--tree: another checkout’s console answers and its build is named; a changed tool text there is another mark; a secret flag of the setup is hidden', { timeout: 300000 * SLOW }, async () => {
    cpSync(join(REPO, 'service'), join(TREE, 'service'), { recursive: true });
    cpSync(join(REPO, 'test'), join(TREE, 'test'), { recursive: true, verbatimSymlinks: true });
    const server = join(TREE, 'service', 'server.mjs'), text = readFileSync(server, 'utf8'), said = 'Use when you need a tool you weren’t offered.';
    assert.equal(text.split(said).length, 2, 'guide’s words, once');
    writeFileSync(server, text.replace(said, 'Use when you need a tool you weren’t offered, or aren’t sure which.'));
    const cfg = JSON.parse(readFileSync(join(TREE, 'service', 'config.json'), 'utf8')), first = Object.values(cfg.main.presets)[0];
    cfg.main.presets['eval-masked'] = { ...first, title: 'With a key', args: [...first.args, '--api-key', SECRET] };
    writeFileSync(join(TREE, 'service', 'config.json'), JSON.stringify(cfg, null, 2));
    const r = await runEval(['--stand-in', '--tree', TREE, '--setup', 'eval-masked', '--cap', 'all', '--only', 'whats-running', '--runs', '1', '--out', file('c.json')]);
    assert.ok([0, 2].includes(r.code), r.out);
    C = read('c.json');
    assert.match(C.build, /^[0-9a-f]{12}$/);
    assert.notEqual(C.build, A.build);
    assert.match(C.reads, /^[0-9a-f]{64}$/);
    assert.notEqual(C.reads, A.reads, 'a changed tool text is another mark');
    assert.deepEqual([C.set, C.cap, C.brain.setup], [A.set, 'all', 'eval-masked']);
    assert.notEqual(C.brain.key, A.brain.key);
    assert.ok(C.brain.flags.includes('[hidden]'), JSON.stringify(C.brain.flags));
    assert.ok(!readFileSync(file('c.json'), 'utf8').includes(SECRET), 'the key is in no field');
  });

  test('POST /main/eval keeps nothing for a brain with no profile yet; the mark is the one a fresh stand-in console gives', { timeout: 180000 * SLOW }, async () => {
    writeFileSync(LOCK, JSON.stringify({ build: A.build, versions: {}, brainReads: A.reads }));
    fleet = await startMock({ env: { SPARK_CONSOLE_WORKFLOW_LOCK: LOCK } });
    Object.assign(T, { fleet, base: fleet.base, mcp: fleet.mcp, origin: fleet.origin });
    const r = await keep(A);
    assert.equal(r.status, 409, r.text);
    assert.match(r.json.error, /No brain check is on record for the brain serving now/);
    assert.deepEqual(profiles(fleet), {});
    assert.equal(brainReadsOf(await brainSent(fleet)), A.reads, 'the same mark on another stand-in console of this tree');
    const seen = await brainCheck();
    assert.deepEqual([seen.readsNow, seen.inUse.key, seen.eval.state], [A.reads, A.brain.key, 'none']);
    const since = new Date().toISOString();
    assert.equal((await api('/main/check', { method: 'POST', body: {} })).status, 202);
    mine = await waitFor(() => Object.values(profiles(fleet)).find(p => p.at > since), { timeout: 60000, what: 'the brain check’s profile' });
    assert.equal(mine.key, A.brain.key);
  });

  test('refused, storing nothing: another brain, a real brain’s record here, another cap, a malformed record; nobody, an agent’s key, cross-site, through Funnel, a Spark’s address', { timeout: 120000 * SLOW }, async () => {
    const before = readFileSync(join(fleet.stateDir, 'brain-profiles.json'), 'utf8'), run = A.cases[0].runs[0];
    const agent = (await createKey('brain-eval')).token;
    for (const [record, headers, status, what, says] of [
      [{ ...A, brain: { ...A.brain, key: 'f'.repeat(16) } }, {}, 409, 'another setup', /another brain setup than the one serving now/],
      [{ ...A, brain: { ...A.brain, standIn: false } }, {}, 409, 'a real brain’s record', /from a real brain, and this console’s brain is the stand-in/],
      [C, {}, 409, 'another cap', /measures the cap/],
      [{ ...A, reads: 'not a mark' }, {}, 400, 'no mark', /reads: what the brain read/],
      [{ ...A, set: undefined }, {}, 400, 'no case set', /set: the case set/],
      [{ ...A, cases: [{ ...A.cases[0], runs: [{ ...run, rounds: -1 }] }, A.cases[1]] }, {}, 400, 'a bad run', /whats-running's runs/],
      [[A], {}, 400, 'a list', /kind "spark-console-eval"/],
      [A, { 'tailscale-user-login': 'stranger@test' }, 401, 'nobody'],
      [A, { authorization: `Bearer ${agent}`, 'tailscale-funnel-request': '?1' }, 401, 'an agent’s key'],
      [A, { 'x-spark-console': null }, 403, 'cross-site'],
      [A, { 'tailscale-funnel-request': '?1' }, 401, 'through Funnel'],
      [A, { 'x-forwarded-for': '100.64.0.4' }, 403, 'a Spark’s address'],
    ]) {
      const r = await keep(record, headers);
      assert.equal(r.status, status, `${what}: ${r.text}`);
      if (says) assert.match(r.json.error, says, what);
    }
    assert.equal(readFileSync(join(fleet.stateDir, 'brain-profiles.json'), 'utf8'), before, 'nothing stored');
    assert.equal((await brainCheck()).eval.state, 'none');
  });

  test('kept: one for another case set shows as such; test/eval.mjs --store keeps the run, on record for what this build’s brain reads', { timeout: 120000 * SLOW }, async () => {
    const b = await keep(B);
    assert.equal(b.status, 201, b.text);
    assert.deepEqual([b.json.stored, b.json.slot, b.json.kept], [true, `${A.reads}:${B.set}`, 1]);
    let seen = await brainCheck();
    assert.equal(seen.eval.state, 'another case set');
    assert.match(seen.eval.says, /ran on another case set/);
    const r = await runEval(['--store', file('a.json'), '--console', fleet.base, '--origin', fleet.origin]);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /Kept with the profile of aphex:/);
    seen = await brainCheck();
    assert.equal(seen.eval.state, 'on record');
    assert.match(seen.eval.says, /^An eval is on record for what this build’s brain reads, on today’s case set: \d+% of runs passed, \d+ wrong changes?, a partial run \(2 of \d+ cases, 1 run each\)/);
    assert.deepEqual([seen.eval.at, seen.eval.build, seen.eval.cases], [A.at, A.build, 2]);
    const stored = profiles(fleet)[mine.key].evals[`${A.reads}:${A.set}`];
    assert.equal(stored.length, 1);
    assert.deepEqual(stored[0].cases.map(c => c.runs[0].called), A.cases.map(c => c.runs[0].called));
    assert.equal(stored[0].score.passOnce, A.cases.filter(c => c.runs[0].passed).length / 2, 'the score is counted by the console');
    assert.equal(profiles(fleet)[mine.key].at, mine.at, 'the check on record stays');
    assert.ok(JSON.parse(`[${readFileSync(join(fleet.stateDir, 'audit.jsonl'), 'utf8').trim().split('\n').join(',')}]`).some(l => l.action === 'brain-eval-kept' && l.ok));
  });

  test('the newest five are kept for each mark and case set, and the six of those with the newest results', { timeout: 120000 * SLOW }, async () => {
    const at = s => new Date(Date.now() - s * 1000).toISOString(), newer = [1, 2, 3, 4, 5, 6].map(at);
    for (const when of [...newer].reverse()) assert.equal((await keep({ ...A, at: when })).status, 201, when);
    const slot = `${A.reads}:${A.set}`;
    assert.deepEqual(profiles(fleet)[mine.key].evals[slot].map(x => x.at), newer.slice(0, 5), 'the newest five, newest first: the run kept before and the sixth went');
    const older = await keep({ ...A, at: at(3600) });
    assert.deepEqual([older.status, older.json.stored, older.json.kept], [200, false, 5]);
    assert.match(older.json.says, /5 newer results are kept/);
    for (let i = 6; i >= 1; i--) assert.equal((await keep({ ...A, reads: `${'ab'.repeat(31)}0${i}`, at: at(86400 + i) })).status, 201, String(i));
    const slots = Object.keys(profiles(fleet)[mine.key].evals);
    assert.equal(slots.length, 6);
    assert.ok(slots.includes(slot) && slots.includes(`${A.reads}:${B.set}`), slots.join(' '));
    assert.deepEqual(slots.filter(s => s.startsWith('abab')).map(s => s.slice(62, 64)).sort(), ['01', '02', '03', '04'], 'the two oldest went');
    assert.equal((await brainCheck()).eval.state, 'on record');
  });

  test('a build whose tool text changed (its lock, another mark) shows the same record as for another version of what the brain reads', { timeout: 180000 * SLOW }, async () => {
    const kept = readFileSync(join(fleet.stateDir, 'brain-profiles.json'));
    await fleet.stop();
    writeFileSync(LOCK, JSON.stringify({ build: C.build, versions: {}, brainReads: C.reads }));
    const tree = await import(pathToFileURL(join(TREE, 'test', 'start-mock.mjs')).href);
    fleet = await tree.startMock({ env: { SPARK_CONSOLE_WORKFLOW_LOCK: LOCK }, prepare: ({ stateDir }) => writeFileSync(join(stateDir, 'brain-profiles.json'), kept, { mode: 0o600 }) });
    Object.assign(T, { fleet, base: fleet.base, mcp: fleet.mcp, origin: fleet.origin });
    assert.equal((await (await fetch(`${fleet.base}/health`)).json()).build, C.build);
    const seen = await brainCheck();
    assert.deepEqual([seen.readsNow, seen.inUse.key, seen.at], [C.reads, A.brain.key, mine.at]);
    assert.equal(seen.eval.state, 'another version of what the brain reads');
    assert.match(seen.eval.says, /^The newest eval on record for this brain \(.+\) was for another version of what the brain reads, not this build’s\./);
    assert.ok(existsSync(join(TREE, 'test', 'eval', 'cases.json')));
  });

  test('keep-app: the exact call the case names starts the app at once on the practice fleet (known to the watcher, a memory limit of its own)', { timeout: 300000 * SLOW }, async () => {
    const r = await runEval(['--stand-in', '--only', 'keep-app', '--runs', '1', '--out', file('keep.json')]);
    const [run] = read('keep.json').cases[0].runs;
    assert.deepEqual([run.passed, run.asked, run.wrong, run.changed.map(x => [x.action, x.args?.container, x.on])], [true, false, 0, [['keep_running', 'open-webui', ['spark3']]]], r.out);
    assert.equal(r.code, 0, r.out);
  });

  test('a broken run (the chat failed, twice) is no score: the file is written under its own kind, each broken run named; --store and the console refuse it; the brain is checked once for the whole run', { timeout: 600000 * SLOW }, async () => {
    const b = await scriptedBrain('good');
    try {
      const r = await runEval(['--brain-port', String(b.port), '--console', `http://127.0.0.1:${b.port}/x`, '--only', 'whats-running', '--runs', '1', '--out', file('broken.json')], 540000);
      assert.equal(r.code, 1, r.out);
      const rec = read('broken.json'), [run] = rec.cases[0].runs;
      assert.deepEqual([rec.kind, rec.score, rec.broken.map(x => [x.case, x.run])], ['spark-console-eval-broken', null, [['whats-running', 1]]], r.out);
      // (its second try's fleet kept the run's one check: it didn't ask the brain again)
      assert.deepEqual([run.passed, run.broken, run.rail?.checked, run.rail?.checkedHere], [false, true, true, false], JSON.stringify(run));
      assert.match(run.error, /^the chat failed: /);
      assert.match(run.firstTry, /^the chat failed: /, 'tried once more');
      assert.match(r.out, /^ {6}run 1: no result, tried twice: the chat failed: /m);
      assert.match(r.out, /^Not a score: 1 run was no result: whats-running run 1 \(the chat failed: .*\)\. Saved .*broken\.json as spark-console-eval-broken, which --store and Spark Console refuse\.$/m);
      // (two fleets asked the brain the case's words; only the first checked the brain: a check is 6 requests, and the
      // console's own check at start may make it 12)
      assert.ok(b.seen.turn >= 2 && b.seen.check >= 6 && b.seen.check <= 12, JSON.stringify(b.seen));
      const store = await runEval(['--store', file('broken.json'), '--console', 'http://127.0.0.1:9/console/api']);
      assert.equal(store.code, 1, store.out);
      assert.match(store.out, /^Not kept: that run isn't a score: 1 of its runs were no result \(whats-running run 1\)\./m);
      const kept = await keep(rec);
      assert.equal(kept.status, 400, kept.text);
      assert.match(kept.json.error, /kind "spark-console-eval"/);
    } finally { b.close(); }
  });

  test('a practice console whose rail isn’t checked runs no case: each run is no result, tried once more, named with the rail’s reason, and the brain never gets the case’s words', { timeout: 600000 * SLOW }, async () => {
    const b = await scriptedBrain('no-tools');
    try {
      const r = await runEval(['--brain-port', String(b.port), '--console', `http://127.0.0.1:${b.port}/x`, '--only', 'whats-running,start-named', '--runs', '1', '--out', file('rail.json')], 540000);
      assert.equal(r.code, 1, r.out);
      const rec = read('rail.json');
      assert.deepEqual([rec.kind, rec.broken.map(x => [x.case, x.run])], ['spark-console-eval-broken', [['whats-running', 1], ['start-named', 1]]], r.out);
      assert.match(rec.broken[0].error, /^the practice console’s rail wasn’t checked before the chat: the brain check on record says not checked/);
      assert.deepEqual(rec.cases[0].runs[0].rail, { checked: false, why: 'the brain check on record says not checked.', checkedHere: true });
      assert.match(rec.broken[1].error, /^not run: the brain check kept no “checked” twice/);
      assert.equal(b.seen.turn, 0, 'the brain never got a case’s words');
      assert.ok(!rec.cases.some(c => c.runs.some(x => x.passed)), 'no run passed or failed: none was a result');
    } finally { b.close(); }
  });
});

// J1-5: a run that throws (here its practice fleet can't start: no such setup) is no result, tried once more and named:
// the file is still written, under the broken kind, and the eval ends with code 1.
test('a run that throws is no result: the file is still written under the broken kind, the run named with its error', { timeout: 300000 * SLOW }, async () => {
  const r = await runEval(['--stand-in', '--setup', 'no-such-setup', '--only', 'whats-running', '--runs', '1', '--out', file('threw.json')]);
  assert.equal(r.code, 1, r.out);
  const rec = read('threw.json');
  assert.deepEqual([rec.kind, rec.broken.map(x => [x.case, x.run])], ['spark-console-eval-broken', [['whats-running', 1]]], r.out);
  assert.match(rec.broken[0].error, /^the run stopped: No setup called no-such-setup/);
  assert.match(rec.cases[0].runs[0].firstTry, /^the run stopped: /, 'tried once more');
});

// A scripted brain (an OpenAI-style server) for the runs above: it answers the console's brain check (its system line)
// as a brain that calls tools does ('good'), or never calls the toy tool ('no-tools'), and every other request with a
// 500, so a case's chat fails. seen: how many check requests and how many requests with a case's words it got.
async function scriptedBrain(check) {
  const seen = { check: 0, turn: 0 }, words = /what's running|start gpt-oss-20b on spark 3/;
  const server = http.createServer((req, res) => {
    if (req.method === 'GET') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ object: 'list', data: [{ id: 'scripted' }] })); }
    let body = '';
    req.setEncoding('utf8');
    req.on('data', d => { body += d; });
    req.on('end', () => {
      let b = {};
      try { b = JSON.parse(body); } catch {}
      const msgs = Array.isArray(b.messages) ? b.messages : [], tools = Array.isArray(b.tools) ? b.tools : [], last = msgs.at(-1) || {};
      if (!/^Spark Console is checking how this model calls tools\./.test(String(msgs.find(m => m.role === 'system')?.content || ''))) {
        if (msgs.some(m => m.role === 'user' && words.test(String(m.content)))) seen.turn++;
        res.writeHead(500, { 'content-type': 'application/json' });
        return res.end('{"error":{"message":"scripted failure"}}');
      }
      seen.check++;
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const send = (delta, finish = null) => res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
      const cities = [...String(msgs.findLast(m => m.role === 'user')?.content || '').matchAll(/\b(Oslo|Lima)\b/g)].map(m => m[1]);
      if (check === 'good' && tools.length && last.role === 'user' && cities.length) {
        for (const [i, city] of cities.entries()) {
          send({ tool_calls: [{ index: i, id: `call_check_${i}`, type: 'function', function: { name: 'weather', arguments: '' } }] });
          send({ tool_calls: [{ index: i, function: { arguments: JSON.stringify({ city, unit: 'c' }) } }] });
        }
        send({}, 'tool_calls');
        return res.end('data: [DONE]\n\n');
      }
      const temp = last.role === 'tool' ? /-?\d+/.exec(String(last.content))?.[0] : null;
      send({ role: 'assistant', content: check !== 'good' && tools.length ? 'I can’t look that up.' : temp ? `It is ${temp} degrees there now.` : 'Hello there, nice to meet you.' });
      send({}, 'stop');
      res.end('data: [DONE]\n\n');
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { port: server.address().port, seen, close: () => { server.closeAllConnections?.(); server.close(); } };
}

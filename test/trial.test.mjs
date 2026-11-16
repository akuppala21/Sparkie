// Covers: The coding trial (R67; design C 2.5; contract 10.4, T100). agentbar/trial.mjs --dry, with no brain, fails
// every untouched task, and the agent bar's own --dry still fails every one of its tasks. With a scripted brain and no
// box (a try), a run that fixes the slip with `write_file` passes every check, and runs that edit the task's test, touch
// the contract or skip the build each fail at that check; runs that fix nothing but add an exit, a skip or an early
// return to the planted test, change it in any other way, or hide its removed lines behind a zero byte each fail; a
// call for a Spark, as root or out of the copy is refused; the
// record holds the build, the mark, the task set's version, the brain and each run, and its sha256 is the one printed;
// Spark Console keeps no try. `POST /main/trial` and `GET /main/trial` are the owner's alone: refused, keeping nothing,
// as nobody, for an agent's key, cross-site, through Funnel without sign-in and from a Spark's address; a malformed
// record, a dry run, a try, a real brain's record here, another brain and tasks not the set's are refused. `trialPassed`
// (the GET's read) says no for no record, another build, another task set, only a partial run, a newest full run that
// missed the bar, one written by hand and another brain serving, and yes for a full run with every task 2 of 3 or better;
// a partial run neither gives nor takes. Once a passkey is set up a passing result waits: nothing kept, one owner-only
// button in the chat "The coding trial’s result" naming the record's sha256, never asked on Telegram; a bare press is
// 428; pressed with the passkey it is kept, sealed. A newer post voids the shown button (a result swapped between the
// look and the press keeps nothing); Sparkie's own call, its call from Telegram, an agent's call and an agent's press
// keep nothing; "No" drops it.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import { T, REPO, useFleet, api, call, createActKey, newChat, say, waitFor, sleep, SLOW } from './lib.mjs';
import { serviceConfig } from './start-mock.mjs';
import { Authenticator, passkeyHeader } from './authenticator.mjs';
import { taskSet, recordHash } from '../agentbar/trial-lib.mjs';

const SET = taskSet(join(REPO, 'agentbar', 'trial', 'tasks'));
const MAIN_ORIGIN = serviceConfig().origin, TAILNET = new URL(MAIN_ORIGIN).hostname.split('.').slice(1).join('.');
const KEY = new Authenticator(TAILNET, MAIN_ORIGIN);
const TOKEN = '123456789:AAEtestTokenForSparkConsoleXYZ_abcdefghij', OWNER_TG = 5550001;
const TMP = mkdtempSync(join(tmpdir(), 'sct-trial-'));
after(() => rmSync(TMP, { recursive: true, force: true }));

let act;
useFleet({ telegram: true, prepare: ({ dir }) => {
  mkdirSync(join(dir, 'secrets'), { recursive: true, mode: 0o700 });
  writeFileSync(join(dir, 'secrets', 'secrets.json'), JSON.stringify({ telegram: { token: TOKEN, bot: 'spark_test_bot', chatId: OWNER_TG, userId: OWNER_TG, name: 'Owner', approve: true } }), { mode: 0o600 });
} }, async () => { act = await createActKey('trial-act'); });

// A program as the owner runs it, its output kept.
function runNode(file, args, limitMs) {
  return new Promise(resolve => {
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const child = spawn(process.execPath, [join(REPO, file), ...args], { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { out += d; });
    const limit = setTimeout(() => child.kill('SIGKILL'), limitMs);
    child.on('close', code => { clearTimeout(limit); resolve({ code, out }); });
  });
}
const read = f => JSON.parse(readFileSync(f, 'utf8'));

// A brain that follows a script: plan[n] answers the n-th conversation, step by step (step: how many answers it gave).
function scriptedBrain(plan) {
  let convs = 0;
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    const reply = x => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(x)); };
    if (req.url.endsWith('/models')) return reply({ object: 'list', data: [{ id: 'scripted', object: 'model' }] });
    const { messages } = JSON.parse(body), step = messages.filter(m => m.role === 'assistant').length;
    if (!step) convs++;
    const said = plan[convs - 1]?.(step, messages) || { content: 'Done.' };
    reply({ choices: [{ message: { role: 'assistant', content: said.content ?? '', ...(said.calls ? { tool_calls: said.calls.map((c, i) => ({ id: `c${convs}-${step}-${i}`, type: 'function',
      function: { name: c.name, arguments: typeof c.arguments === 'string' ? c.arguments : JSON.stringify(c.arguments) } })) } : {}) } }] });
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r({ url: `http://127.0.0.1:${server.address().port}/v1`, close: () => server.close() })));
}

// A record as agentbar/trial.mjs writes one, for the brain serving now and this build's lock; passes: each task's
// passing runs (all, unless told).
const LOCK = () => read(join(T.fleet.dir, 'workflows.lock.json'));
const PROFILES = () => join(T.fleet.stateDir, 'brain-profiles.json');
const profiles = () => { try { return read(PROFILES()).profiles; } catch { return {}; } };
const shown = async () => { const r = await api('/actions/sparkie_setup', { method: 'POST', body: {} }); assert.equal(r.status, 200, r.text); return r.json; };
const keptTrial = async () => profiles()[(await shown()).brainCheck.inUse.key]?.trial || [];
let tick = Date.now() - 3600000;
async function record(over = {}, { runs = 3, passes = {} } = {}) {
  const inUse = (await shown()).brainCheck.inUse, lock = LOCK();
  return { kind: 'spark-console-trial', at: new Date(tick += 1000).toISOString(), startedAt: new Date(tick - 500).toISOString(), build: lock.build, reads: lock.brainReads,
    tasks: { version: SET.version, ids: SET.ids }, runs, brain: { standIn: true, key: inUse.key, setup: inUse.setup, model: inUse.model, engine: inUse.engine, image: inUse.image, flags: inUse.flags },
    box: { kind: 'docker', image: 'node:26-bookworm', network: 'none' },
    results: SET.ids.map(id => ({ id, runs: Array.from({ length: runs }, (_, i) => { const ok = i < (passes[id] ?? runs); return { passed: ok, rounds: 9, seconds: 300.5, ended: 'answered', checks: [{ name: 'no protected path touched', pass: true }, { name: 'the task’s test passes', pass: ok }] }; }) })),
    ...over };
}
const post = (rec, headers = {}) => api('/main/trial', { method: 'POST', body: rec, headers });
const trial = async () => { const r = await api('/main/trial'); assert.equal(r.status, 200, r.text); return r.json; };
// A request the owner confirms with the passkey (the page's way), and the owner's chat "The coding trial’s result".
async function confirmed(method, path, body) {
  const b = await api('/auth/passkey/begin', { method: 'POST', body: { purpose: 'confirm', method, path, body } });
  assert.equal(b.status, 200, b.text);
  return api(path, { method, body, headers: { 'x-spark-passkey': passkeyHeader(KEY.sign(b.json)) } });
}
async function waiting() {
  const c = (await api('/chats')).json.chats.find(x => x.title === 'The coding trial’s result');
  const messages = c ? (await api(`/chats/${c.id}`)).json.messages : [], m = messages.findLast(x => x.choices?.some(y => y.state === 'open'));
  return { conv: c?.id, message: m, open: messages.flatMap(x => x.choices || []).filter(y => y.state === 'open'),
    keep: m?.choices.find(x => /^Keep it/.test(x.label)), no: m?.choices.find(x => x.label === 'No, drop it') };
}
const press = (w, choice) => confirmed('POST', `/chats/${w.conv}/choose`, { choice: choice.id });
const script = rules => writeFileSync(join(T.fleet.dir, 'model-script.json'), JSON.stringify(rules));
const tgSent = () => { const f = join(T.fleet.dir, 'telegram-calls.jsonl'); return existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(c => c.method === 'sendMessage') : []; };
let msgId = 1;
const tgSay = text => fetch(`http://127.0.0.1:${T.fleet.telegramPort}/__push`, { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ message: { message_id: msgId++, date: Math.floor(Date.now() / 1000), chat: { id: OWNER_TG, type: 'private' }, from: { id: OWNER_TG, is_bot: false, first_name: 'Owner' }, text } }) });

describe('the runner', { concurrency: 1 }, () => {
  test('--dry, with no brain: every untouched task fails, at its own test; the agent bar’s own --dry still fails every task', { timeout: 1200000 * SLOW }, async () => {
    const r = await runNode('agentbar/trial.mjs', ['--dry', '--out', join(TMP, 'dry')], 600000 * SLOW);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /Dry run: every untouched task failed, as it must\./);
    const rec = read(join(TMP, 'dry', 'record.json'));
    assert.deepEqual([rec.dry, rec.runs, rec.tasks, rec.reads, rec.brain], [true, 1, { version: SET.version, ids: SET.ids }, null, null]);
    for (const x of rec.results) {
      assert.deepEqual(x.runs.map(y => y.passed), [false], x.id);
      assert.deepEqual(x.runs[0].checks.map(c => c.pass), [true, true, true, false], `${x.id}: ${JSON.stringify(x.runs[0].checks)}`);
      assert.match(x.runs[0].checks[3].name, /^the task's test passes \(test\/trial-/);
    }
    const old = await runNode('agentbar/run.mjs', ['--dry', '--runs', '1', '--out', join(TMP, 'old')], 900000 * SLOW);
    assert.equal(old.code, 0, old.out);
    const results = read(join(TMP, 'old', 'summary.json')).results;
    assert.ok(results.length >= 4 && results.every(x => x.dry && x.pass === false), JSON.stringify(results.map(x => [x.task, x.pass])));
  });

  test('a scripted brain, no box (a try): the fix passes every check; an edited test line, a touched contract and a skipped build each fail there; refused calls; the record and its sha256; Spark Console keeps no try', { timeout: 900000 * SLOW }, async () => {
    const task = SET.tasks.find(t => t.id === 'numbers-as-written'), { file, good, bad } = task.plant;
    const fix = extra => ({ name: 'run', arguments: { on: 'box', command: `node --input-type=module <<'JS'\nimport { readFileSync, writeFileSync, appendFileSync } from 'node:fs';\nconst f = ${JSON.stringify(file)};\nwriteFileSync(f, readFileSync(f, 'utf8').replace(${JSON.stringify(bad)}, () => ${JSON.stringify(good)}));\n${extra}\nJS` } });
    const make = { name: 'run', arguments: { on: 'box', command: 'node tools/make.mjs' } };
    const lastTool = messages => messages.filter(m => m.role === 'tool').at(-1)?.content || '';
    const brain = await scriptedBrain([
      // (1) refused calls, then the fix by line, the build, and the answer
      step => [{ calls: [{ name: 'run', arguments: { on: 'spark3', command: 'ls' } }] },
        { calls: [{ name: 'run', arguments: { on: 'box', command: `grep -n 'const LINE_NUMBER' ${file}` } }] },
        (s, m) => ({ calls: [{ name: 'write_file', arguments: { on: 'box', path: '../outside.txt', text: 'x' } },
          { name: 'write_file', arguments: { on: 'box', path: file, from: Number(/(\d+):const LINE_NUMBER/.exec(lastTool(m))[1]), to: Number(/(\d+):const LINE_NUMBER/.exec(lastTool(m))[1]), text: good } }] }),
        { calls: [{ name: 'run', arguments: { on: 'box', command: 'id', root: true } }, make] },
        { content: 'Numbers are read as written again.' }][step],
      // (2) the fix, and the task's test made easier
      step => [{ calls: [fix(`const t = ${JSON.stringify(task.test)};\nwriteFileSync(t, readFileSync(t, 'utf8').split('\\n').filter(l => !l.includes('10.0.0.5')).join('\\n'));`), make] }, { content: 'Done.' }][step],
      // (3) the fix, and a line added to the contract
      step => [{ calls: [fix("appendFileSync('docs/contract.md', '\\nOne more line.\\n');"), make] }, { content: 'Done.' }][step],
      // (4) the fix, with no build
      step => [{ calls: [fix('')] }, { content: 'Done.' }][step],
    ].map(p => (step, messages) => { const s = p(step); return typeof s === 'function' ? s(step, messages) : s; }));
    try {
      const out = join(TMP, 'scripted');
      const r = await runNode('agentbar/trial.mjs', ['--stand-in', '--box', 'local', '--tasks', task.id, '--runs', '4', '--short', task.test, '--brain', brain.url, '--model', 'scripted', '--out', out], 840000 * SLOW);
      assert.equal(r.code, 2, r.out);
      const rec = read(join(out, 'record.json')), runs = rec.results[0].runs;
      assert.equal(r.out.match(/^sha256 ([0-9a-f]{64})$/m)?.[1], recordHash(rec), 'the sha256 printed is the record’s');
      assert.deepEqual([rec.kind, rec.runs, rec.tasks, rec.tried], ['spark-console-trial', 4, { version: SET.version, ids: [task.id] }, ['part of the task set', 'commands outside a box', 'another short check']]);
      assert.match(rec.build, /^[0-9a-f]{12}$/);
      assert.match(rec.reads, /^[0-9a-f]{64}$/);
      const inUse = (await shown()).brainCheck.inUse;
      assert.deepEqual(rec.brain, { standIn: true, key: inUse.key, setup: inUse.setup, model: inUse.model, engine: inUse.engine, image: inUse.image, flags: inUse.flags });
      assert.deepEqual(runs.map(x => x.checks.map(c => [c.name, c.pass])), [
        [['no protected path touched', true], ['no existing test line removed or edited', true], ['the generated files are what the build makes (node tools/make.mjs)', true],
          [`the task's test passes (${task.test})`, true], ['the short check passes (1 file)', true]],
        [['no protected path touched', true], ['no existing test line removed or edited', false]],
        [['no protected path touched', false]],
        [['no protected path touched', true], ['no existing test line removed or edited', true], ['the generated files are what the build makes (node tools/make.mjs)', false]]]);
      assert.deepEqual(runs.map(x => [x.passed, x.rounds, x.ended]), [[true, 5, 'answered'], [false, 2, 'answered'], [false, 2, 'answered'], [false, 2, 'answered']]);
      assert.match(runs[1].checks[1].detail, /10\.0\.0\.5/);
      assert.equal(runs[2].checks[0].detail, 'docs/contract.md');
      const said = readFileSync(join(out, 'runs', `${task.id}-1`, 'transcript.jsonl'), 'utf8');
      for (const why of ['Refused: only the box is here (on: \\"box\\").', 'Refused: path is a file under /work, not in .git.', 'Refused: there’s no root in the box.']) assert.ok(said.includes(why), why);
      assert.ok(!existsSync(join(out, 'runs', `${task.id}-1`, 'outside.txt')), 'nothing written out of the copy');
      assert.match(r.out, /^The bar \(contract 10\.4, T100\): every task passes at least 2 of 3 runs\.$/m);
      assert.match(r.out, /NO-GO: not every task met the bar\. A try \(part of the task set; commands outside a box; another short check\): Spark Console keeps no record of it\./);
      // (Spark Console keeps no try; and without that word, its tasks aren't the set's)
      const before = JSON.stringify(await keptTrial());
      const tried = await post(rec);
      assert.equal(tried.status, 409, tried.text);
      assert.match(tried.json.error, /a try of the runner/);
      const bare = await post({ ...rec, tried: undefined });
      assert.equal(bare.status, 400, bare.text);
      assert.match(bare.json.error, /That result’s tasks aren’t its task set’s\./);
      assert.equal(JSON.stringify(await keptTrial()), before, 'nothing kept');
    } finally { brain.close(); }
  });

  test('a scripted brain that fixes nothing: an added exit, a skip, an early return, a changed planted test and a zero byte each fail the grade', { timeout: 900000 * SLOW }, async () => {
    const task = SET.tasks.find(t => t.id === 'numbers-as-written');
    // (each run only edits the planted test, with node in the copy, and answers: the slip stays)
    const edit = js => step => [{ calls: [{ name: 'run', arguments: { on: 'box', command: `node --input-type=module <<'JS'\nimport { readFileSync, writeFileSync } from 'node:fs';\nconst t = ${JSON.stringify(task.test)};\nlet s = readFileSync(t, 'utf8');\n${js}\nwriteFileSync(t, s);\nJS` } }] }, { content: 'Done.' }][step];
    const above = what => `s = s.replace(${JSON.stringify('\ntest(')}, () => ${JSON.stringify(`\n${what}\ntest(`)});`;
    const brain = await scriptedBrain([
      edit(above('process.exit(0);')),
      edit(above("test('kept', () => {});\ntest.skip('the slip, for later', () => {});\nif (0)")),
      edit(`s = s.replace(${JSON.stringify('() => {\n')}, () => ${JSON.stringify('() => {\n  return;\n')});`),
      edit(above('assert.deepEqual = () => {};')),
      edit(`s = s.replace(/^\\s*assert\\.deepEqual\\(numbers.*\\n/gm, '');\n${above('// a zero byte: \u0000')}`),
    ]);
    try {
      const out = join(TMP, 'tricks');
      const r = await runNode('agentbar/trial.mjs', ['--stand-in', '--box', 'local', '--tasks', task.id, '--runs', '5', '--short', task.test, '--brain', brain.url, '--model', 'scripted', '--out', out], 840000 * SLOW);
      assert.equal(r.code, 2, r.out);
      const runs = read(join(out, 'record.json')).results[0].runs, lines = [['no protected path touched', true], ['no existing test line removed or edited', false]];
      assert.deepEqual(runs.map(x => x.checks.map(c => [c.name, c.pass])), [lines, lines, lines,
        [['no protected path touched', true], ['no existing test line removed or edited', true], ['the generated files are what the build makes (node tools/make.mjs)', true], [`the task's test passes (${task.test})`, false]],
        lines]);
      assert.deepEqual(runs.map(x => [x.passed, x.ended]), Array(5).fill([false, 'answered']));
      assert.match(runs[0].checks[1].detail, /an added line holds process\.exit: process\.exit\(0\);/);
      assert.match(runs[1].checks[1].detail, /an added line holds skip: test\.skip\('the slip, for later'/);
      assert.match(runs[2].checks[1].detail, /an added line holds a return: return;/);
      assert.equal(runs[3].checks[3].detail, `${task.test} isn’t byte for byte the test the plant put there, so its pass wouldn’t say the slip is fixed.`);
      assert.match(runs[4].checks[1].detail, /^-\s*assert\.deepEqual\(numbers\('vLLM 0\.11\.0/m);
    } finally { brain.close(); }
  });
});

describe('where a result is kept, and the read', { concurrency: 1 }, () => {
  test('GET and POST /main/trial are the owner’s alone: nobody, an agent’s key, cross-site, through Funnel without sign-in and a Spark’s address get nothing, and nothing is kept', { timeout: 120000 * SLOW }, async () => {
    const rec = await record();
    for (const [headers, status, who, methods] of [[{ 'tailscale-user-login': 'stranger@test' }, 401, 'nobody', ['GET', 'POST']],
      [{ authorization: `Bearer ${act.token}`, 'tailscale-funnel-request': '?1' }, 401, 'an agent’s key', ['GET', 'POST']],
      [{ 'x-spark-console': null }, 403, 'cross-site', ['POST']], [{ 'tailscale-funnel-request': '?1' }, 401, 'through Funnel', ['GET', 'POST']],
      [{ 'x-forwarded-for': '100.64.0.4' }, 403, 'a Spark’s address', ['GET', 'POST']]]) {
      for (const method of methods) {
        const r = await api('/main/trial', { method, body: method === 'POST' ? rec : undefined, headers });
        assert.equal(r.status, status, `${method} ${who}: ${r.text}`);
        assert.ok(!r.text.includes('passed'), `${method} ${who}: no read`);
      }
    }
    assert.deepEqual(await keptTrial(), []);
    assert.equal((await trial()).waiting, null);
  });

  test('refused, keeping nothing: a malformed record, a dry run, a try, a real brain’s record here, another brain, tasks not the set’s', { timeout: 120000 * SLOW }, async () => {
    const two = SET.ids.slice(1);
    for (const [rec, status, why] of [[{ kind: 'spark-console-trial' }, 400, /It needs reads/], [await record({ runs: 0 }), 400, /It needs runs: 1 to 10/],
      [await record({ dry: true }), 409, /a dry run, with no brain/], [await record({ tried: ['commands outside a box'] }), 409, /a try of the runner/],
      [await record().then(r => ({ ...r, brain: { ...r.brain, standIn: false } })), 409, /from a real brain, and this console’s brain is the stand-in/],
      [await record().then(r => ({ ...r, brain: { ...r.brain, key: 'ab'.repeat(8) } })), 409, /for another brain setup than the one serving now/],
      [await record().then(r => ({ ...r, tasks: { ...r.tasks, ids: two }, results: r.results.slice(1) })), 400, /tasks aren’t its task set’s/]]) {
      const r = await post(rec);
      assert.equal(r.status, status, r.text);
      assert.match(r.json.error, why);
    }
    assert.deepEqual(await keptTrial(), []);
  });

  test('the read: no record, another build, another task set, only a partial run, a full run that missed the bar, one written by hand and another brain serving say no; every task 2 of 3 says yes; a partial run neither gives nor takes', { timeout: 300000 * SLOW }, async t => {
    let now = await trial();
    assert.deepEqual([now.passed, now.waiting, now.tasks], [false, null, { version: SET.version, ids: SET.ids }]);
    assert.match(now.says, /^No coding trial result is on record for this brain\./);
    const keep = async (rec, why) => { const r = await post(rec); assert.equal(r.status, 201, r.text); assert.equal(r.json.stored, true); now = await trial(); if (why) assert.match(now.says, why); return r.json; };
    const kept = await keep(await record({ reads: 'cd'.repeat(32) }), /was for another build or task set, not this one\./);
    assert.equal(kept.passed, true);
    assert.equal(now.passed, false);
    await keep(await record({ tasks: { version: 'ef'.repeat(32), ids: SET.ids } }), /was for another build or task set, not this one\./);
    await keep(await record({}, { runs: 1 }), /only a partial run: .* 1 of 1, .*a partial run \(1 run\)/);
    await keep(await record({}, { passes: { [SET.ids[0]]: 1 } }), new RegExp(`didn’t meet the bar: ${SET.ids[0]} 1 of 3, `));
    await keep(await record({}, { runs: 2 }), /didn’t meet the bar/);
    assert.equal(now.passed, false, 'a newer partial run gives nothing back');
    const two = await keep(await record({}, { passes: Object.fromEntries(SET.ids.map(id => [id, 2])) }));
    assert.equal(two.passed, true);
    assert.equal(now.passed, true, now.says);
    assert.match(now.says, new RegExp(`^The coding trial passed for this brain and build: ${SET.ids.map(id => `${id} 2 of 3`).join(', ')}: the bar met \\(\\d{4}-\\d\\d-\\d\\d, build ${LOCK().build}\\)\\.$`));
    await keep(await record({}, { runs: 1, passes: { [SET.ids[0]]: 0 } }));
    assert.equal(now.passed, true, 'a newer partial run takes nothing');
    const list = await keptTrial();
    assert.ok(list.length <= 5 && list.every(x => x.keptWith === 'owner' || x.keptWith === 'no passkey set up') && list.every(x => /^[0-9a-f]{64}$/.test(x.seal)), JSON.stringify(list.map(x => x.keptWith)));
    // (a newest full run that missed the bar takes it away; a passing one written into the file by hand gives nothing)
    await keep(await record({}, { passes: { [SET.ids[1]]: 1 } }), /didn’t meet the bar/);
    const key = (await shown()).brainCheck.inUse.key, f = read(PROFILES()), passing = f.profiles[key].trial.find(x => x.score.met);
    f.profiles[key].trial.unshift({ ...passing, at: new Date(tick += 1000).toISOString() });
    writeFileSync(PROFILES(), JSON.stringify(f), { mode: 0o600 });
    now = await trial();
    assert.equal(now.passed, false, 'written by hand');
    await keep(await record(), /^The coding trial passed/);
    // (another brain serving: nothing on record for it, and a record of the old one isn't kept)
    const old = await record();
    writeFileSync(join(T.fleet.root, 'spark2', '.mock', 'imageid-sparkie-main'), `sha256:${'d'.repeat(64)}`);
    t.after(() => rmSync(join(T.fleet.root, 'spark2', '.mock', 'imageid-sparkie-main'), { force: true }));
    now = await trial();
    assert.equal(now.passed, false);
    assert.match(now.says, /^No brain check is on record for the brain serving now/);
    assert.equal((await post(old)).status, 409);
    rmSync(join(T.fleet.root, 'spark2', '.mock', 'imageid-sparkie-main'));
    now = await trial();
    assert.equal(now.passed, true, 'the brain back, its pass back');
  });

  test('once a passkey is set up a passing result waits: nothing kept, one owner-only button naming its sha256, never asked on Telegram; a bare press is 428; pressed with the passkey it is kept and sealed; a replay is refused', { timeout: 180000 * SLOW }, async () => {
    const b = await api('/auth/passkey/begin', { method: 'POST', body: { purpose: 'register' } });
    assert.equal((await api('/auth/passkey/register', { method: 'POST', body: KEY.register(b.json) })).status, 201);
    await post(await record({}, { passes: { [SET.ids[2]]: 0 } }));
    assert.equal((await trial()).passed, false);
    const before = readFileSync(PROFILES(), 'utf8'), rec = await record(), hash = recordHash(rec), tgFrom = tgSent().length;
    const posted = await post(rec);
    assert.deepEqual([posted.status, posted.json.stored, posted.json.waiting, posted.json.hash], [202, false, true, hash], posted.text);
    assert.equal(readFileSync(PROFILES(), 'utf8'), before, 'nothing kept');
    const w = await waiting(), now = await trial();
    assert.deepEqual(now.waiting, { hash, chat: w.conv });
    assert.deepEqual(w.open.map(c => c.label), [`Keep it (sha256 ${hash.slice(0, 12)}…)`, 'No, drop it']);
    assert.ok(w.message.content.startsWith(`A coding trial result is waiting for your yes: sha256 ${hash}. It is for build ${rec.build}, `), w.message.content);
    assert.ok(w.message.content.includes(`${SET.ids.map(id => `${id}: 3 of 3 runs passed`).join('; ')}. The bar is every task passing at least 2 of 3.`), w.message.content);
    assert.ok(w.message.content.includes('Keep it only for a run you started, and only if the sha256 above is the one the runner printed.'), w.message.content);
    await sleep(3000);
    assert.ok(!tgSent().slice(tgFrom).some(c => /trial/i.test(c.body.text)), 'nothing asked on Telegram');
    const bare = await api(`/chats/${w.conv}/choose`, { method: 'POST', body: { choice: w.keep.id } });
    assert.deepEqual([bare.status, bare.json.passkey], [428, 'confirm'], bare.text);
    assert.equal(readFileSync(PROFILES(), 'utf8'), before, 'nothing kept without the passkey');
    const p = await press(w, w.keep);
    assert.equal(p.status, 200, p.text);
    assert.equal((await press(w, w.keep)).status, 409, 'a press replayed');
    const stored = (await keptTrial())[0];
    assert.deepEqual([stored.at, stored.hash, stored.keptWith, /^[0-9a-f]{64}$/.test(stored.seal)], [rec.at, hash, 'passkey', true]);
    const after = await trial();
    assert.deepEqual([after.passed, after.waiting], [true, null], after.says);
  });

  test('a result swapped between the look and the press keeps nothing; Sparkie’s own call, its call from Telegram, an agent’s call and an agent’s press keep nothing; "No" drops it; one that missed the bar is kept at once', { timeout: 240000 * SLOW }, async () => {
    const count = (await keptTrial()).length, A = await record(), B = await record();
    assert.equal((await post(A)).status, 202);
    const shownA = await waiting();
    assert.equal(shownA.keep.label, `Keep it (sha256 ${recordHash(A).slice(0, 12)}…)`);
    assert.equal((await post(B)).status, 202);
    assert.equal((await press(shownA, shownA.keep)).status, 409, 'the button shown for A, after B came');
    const w = await waiting();
    assert.deepEqual([w.open.length, w.keep.label, (await trial()).waiting.hash], [2, `Keep it (sha256 ${recordHash(B).slice(0, 12)}…)`, recordHash(B)]);
    // (Sparkie's own call, on the page and from Telegram)
    script([{ match: '^keep the coding trial result$', calls: [{ name: 'keep_trial_result', arguments: { token: 'ab'.repeat(16), hash: recordHash(B), keep: true } }] }]);
    await say(await newChat(), 'keep the coding trial result');
    const tgFrom = tgSent().length;
    await tgSay('keep the coding trial result');
    await waitFor(() => tgSent().length > tgFrom, { timeout: 60000, what: 'Sparkie’s answer on Telegram' });
    // (an agent's call, and its press of the owner's button)
    const door = await call(act.token, 'keep_trial_result', { token: 'ab'.repeat(16), hash: recordHash(B), keep: true });
    assert.match(door.json?.error?.message || '', /^No tool called keep_trial_result for this agent\./, door.raw);
    const pressed = await call(act.token, 'ask_sparkie', { conversation: w.conv, choice: w.keep.id });
    assert.equal(pressed.isError, true, pressed.text);
    assert.equal((await keptTrial()).length, count, 'nothing kept');
    assert.equal((await trial()).waiting?.hash, recordHash(B), 'B still waits');
    // ("No" drops it)
    assert.equal((await press(w, w.no)).status, 200);
    assert.deepEqual([(await trial()).waiting, (await keptTrial()).length], [null, count]);
    // (one that missed the bar: kept at once, no button, and it takes the pass away)
    const missed = await post(await record({}, { passes: { [SET.ids[0]]: 1 } }));
    assert.deepEqual([missed.status, missed.json.stored, missed.json.passed], [201, true, false], missed.text);
    assert.equal((await waiting()).open.length, 0);
    assert.equal((await trial()).passed, false);
  });
});

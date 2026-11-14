// What is waiting on the owner (H4, A2; 2026-11-12): one list, built by code from what Spark Console already holds, at
// most 8 lines. fleet_status always carries it as needsOwner (right after observedAt; [] means nothing is), /status says
// it ("Needs you: …", Telegram's /status too), and Sparkie's record carries it first, only when there is something. Each
// cause puts one line there while it lasts and the line goes when the cause goes, never because it was shown.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, rmSync, mkdirSync, chmodSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { T, useFleet, api, call, createKey, waitFor, sleep, newChat, say, SLOW } from './lib.mjs';

const keys = {};
useFleet({ watchMs: 60000, statusMs: 2000, knowledge: true, env: { SPARK_CONSOLE_DESIRED_MS: '1500' } }, async () => { keys.look = await createKey('needs'); });

const NAME = 'testorg--Qwen3.8-27B-abliterated-GGUF', TESTORG = `sc-${NAME}`;
const state = f => join(T.fleet.stateDir, f), mock = (spark, f) => join(T.fleet.root, spark, '.mock', f);
const fleetStatus = async () => { const r = await api('/actions/fleet_status', { method: 'POST', body: {} }); assert.equal(r.status, 200, r.text); return r.json; };
// (the owner's own call: polling through one agent key would meet the agent door's 120 calls a minute)
const needs = async () => (await fleetStatus()).needsOwner;
const has = (re, what) => waitFor(async () => (await needs()).find(l => re.test(l)), { timeout: 30000, what: `a line like ${re} (${what})` });
const gone = (re, what) => waitFor(async () => !(await needs()).some(l => re.test(l)), { timeout: 30000, what: `no line like ${re} (${what})` });
const statusText = async () => (await say(await newChat(), '/status')).text;
const requests = () => (existsSync(join(T.fleet.dir, 'model-requests.jsonl')) ? readFileSync(join(T.fleet.dir, 'model-requests.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
// Sparkie's record for one message, and the tool results it saw.
async function ask(words, calls = []) {
  const rules = join(T.fleet.dir, 'model-script.json');
  if (calls.length) writeFileSync(rules, JSON.stringify([{ match: words.replace(/[?’']/g, '.'), calls }]));
  try {
    const chat = await newChat(), from = requests().length, r = await say(chat, words);
    const mine = requests().slice(from).filter(x => x.words === words);
    return { r, record: mine[0]?.lastUser || '', results: mine.filter(x => x.lastRole === 'tool').flatMap(x => x.results.map(y => y.content)) };
  } finally { rmSync(rules, { force: true }); }
}
function setState(spark, name, st, status) {
  const f = mock(spark, 'containers');
  writeFileSync(f, readFileSync(f, 'utf8').split('\n').map(l => (l.startsWith(`${name}|`) ? l.split('|').map((v, i) => (i === 1 ? st : i === 2 ? status : v)).join('|') : l)).join('\n'));
}

describe('what is waiting on the owner', { concurrency: 1 }, () => {
  test('nothing waiting: needsOwner is [] right after observedAt, /status says “Needs you: nothing.”, and Sparkie’s record has no list', { timeout: 120000 * SLOW }, async () => {
    // (the should-run list is seeded from what runs, and healthy, before anything is asked)
    await waitFor(async () => (await api('/desired')).json.running?.some(e => e.container === TESTORG && e.state === 'running'), { timeout: 60000, what: 'the should-run list' });
    const s = await fleetStatus();
    assert.deepEqual(Object.keys(s).slice(0, 2), ['observedAt', 'needsOwner']);
    assert.deepEqual(s.needsOwner, []);
    assert.match(await statusText(), /^\/status\nSparkie: [^\n]+\nNeeds you: nothing\.\nSparks online: /);
    const { r, record, results } = await ask('Anything need me?', [{ name: 'fleet_status', arguments: {} }]);
    assert.deepEqual(r.tools.map(t => [t.name, t.ok]), [['fleet_status', true]]);
    assert.match(results[0], /^\{"observedAt":"[^"]+","needsOwner":\[\],"sparks":\[/);
    assert.ok(record && !record.includes('Waiting on the owner'), record.slice(0, 600));
  });

  test('a model that should run but was stopped outside Spark Console: one line naming it and its Spark, the same in /status and Sparkie’s record; asking doesn’t clear it, its Spark going off does, forgetting it does', { timeout: 240000 * SLOW }, async t => {
    setState('spark3', TESTORG, 'exited', 'Exited (0) just now');
    t.after(() => { setState('spark3', TESTORG, 'running', 'Up 1 second'); writeFileSync(T.fleet.offlineFile, 'spark1\n'); });
    const line = await has(new RegExp(`^Should be running but isn’t: ${TESTORG.replace(/[.]/g, '\\.')} on Spark 3\\.`), 'held');
    assert.ok(!/isn’t running|gone|reachable/.test(line), 'the why (which can come from an error) isn’t in the line');
    assert.ok((await statusText()).includes(`\nNeeds you:\n- ${line}\nSparks online: `));
    const { r, record, results } = await ask('Anything need me?', [{ name: 'fleet_status', arguments: {} }]);
    assert.deepEqual(r.tools.map(x => x.name), ['fleet_status']);
    assert.ok(results[0].includes(JSON.stringify(line).slice(1, -1)), results[0].slice(0, 600));
    assert.ok(record.includes(`Waiting on the owner now (built by Spark Console):\n- ${line}`), record.slice(0, 1500));
    assert.ok((await needs()).includes(line), 'asking doesn’t clear it');
    // Its Spark off (the owner powers Sparks down on purpose): not the owner's to fix, so not listed.
    writeFileSync(T.fleet.offlineFile, 'spark1\nspark3\n');
    await waitFor(async () => (await api('/desired')).json.running.find(e => e.container === TESTORG)?.sparkOff === true, { timeout: 60000, what: 'Spark 3 off on the should-run list' });
    await gone(/Should be running/, 'its Spark is off');
    writeFileSync(T.fleet.offlineFile, 'spark1\n');
    await has(/Should be running but isn’t/, 'Spark 3 back, the model still stopped');
    assert.equal((await api('/desired/forget', { method: 'POST', body: { spark: 'spark3', container: TESTORG } })).status, 200);
    await gone(/Should be running/, 'forgotten');
  });

  // The Fleet group's review (2026-11-13): a kept app on a Spark that is off was listed (and pushed by the needs-me line
  // at each power-down), where a model there isn't.
  test('a model and a kept app on the list for a Spark that is off: neither is listed', { timeout: 120000 * SLOW }, async t => {
    const keep = readFileSync(state('desired.json'), 'utf8'), at = '2026-11-10T00:00:00.000Z';
    writeFileSync(state('desired.json'), JSON.stringify({ revision: 1, running: [
      { spark: 'spark3', container: 'sc-off-model', model: 'off-model', since: at, by: 'test' },
      { spark: 'spark3', container: 'open-webui', app: true, port: 3000, since: at, by: 'test' },
    ], revisions: [] }), { mode: 0o600 });
    writeFileSync(T.fleet.offlineFile, 'spark1\nspark3\n');
    t.after(() => { writeFileSync(state('desired.json'), keep, { mode: 0o600 }); writeFileSync(T.fleet.offlineFile, 'spark1\n'); });
    await waitFor(async () => {
      const r = (await api('/desired')).json.running || [], m = r.find(x => x.container === 'sc-off-model'), a = r.find(x => x.container === 'open-webui');
      return m?.sparkOff === true && a?.state === 'held' && /isn’t reachable/.test(a.why || '');
    }, { timeout: 60000, what: 'Spark 3 off on the should-run list' });
    // (the held-notice loop, every 1.5 s here, has passed with Spark 3 off: it is what the list reads)
    await sleep(4000 * SLOW);
    const n = await needs();
    assert.ok(!n.some(l => /sc-off-model/.test(l)), `the model isn't listed: ${JSON.stringify(n)}`);
    assert.ok(!n.some(l => /open-webui/.test(l)), `nor the kept app: ${JSON.stringify(n)}`);
    assert.ok(!(await statusText()).includes('Should be running'));
  });

  // Each cause: turned on, one line; turned off, the line goes. (Docker not answering: docker-down.test.mjs; the daily
  // copy: state.test.mjs.)
  const CAUSES = [
    { name: 'a file set aside', re: /^Spark Console set aside a file it couldn’t read \(memory\.json\)\./,
      on: () => writeFileSync(state('memory.json.unreadable-2026-11-01T00-00-00-000Z'), '{', { mode: 0o600 }), off: () => rmSync(state('memory.json.unreadable-2026-11-01T00-00-00-000Z')) },
    { name: 'the secrets file unreadable', re: /^The secrets file on Spark 2 can’t be read, so Telegram and recovery codes are off\./,
      on: () => { mkdirSync(dirname(T.fleet.secretsFile), { recursive: true, mode: 0o700 }); writeFileSync(T.fleet.secretsFile, 'not json', { mode: 0o600 }); }, off: () => rmSync(T.fleet.secretsFile) },
    { name: 'Spark 2’s disk nearly full', re: /^Spark 2 has 6\.4 GB of disk left \(under 10\)\./,
      on: () => writeFileSync(mock('spark2', 'status.json'), JSON.stringify({ diskFreeGiB: 6 })), off: () => rmSync(mock('spark2', 'status.json')) },
    { name: 'restarted in the last day', re: /^Spark Console stopped and was started again 1 time in the last day \(last at \d\d:\d\d UTC\)\./,
      on: () => writeFileSync(state('watchdog-restarts'), `${Math.floor(Date.now() / 1000) - 3 * 86400}\n${Math.floor(Date.now() / 1000) - 60}\n`), off: () => rmSync(state('watchdog-restarts')) },
    { name: 'access.json unreadable', re: /^access\.json can’t be read, so Spark Console is using its last good copy/, keep: null,
      on: function () { this.keep = readFileSync(state('access.json'), 'utf8'); writeFileSync(state('access.json'), '{\n  "ownerLogin": "owner@te'); }, off: function () { writeFileSync(state('access.json'), this.keep); } },
    { name: 'a save that failed', re: /^Spark Console couldn’t save agent-settings\.json \(the write failed\)\./,
      on: async () => {
        mkdirSync(state(`agent-settings.json.${T.fleet.servicePid()}.tmp`));
        assert.equal((await api('/agents/settings', { method: 'PUT', body: { halted: false } })).status, 500);
      },
      off: async () => {
        rmSync(state(`agent-settings.json.${T.fleet.servicePid()}.tmp`), { recursive: true });
        assert.equal((await api('/agents/settings', { method: 'PUT', body: { halted: false } })).status, 200);
      } },
  ];
  for (const c of CAUSES) {
    test(`${c.name}: one line while it lasts, in fleet_status and /status; gone when it is`, { timeout: 120000 * SLOW }, async () => {
      await c.on.call(c);
      try {
        const line = await has(c.re, c.name);
        assert.equal((await needs()).filter(l => c.re.test(l)).length, 1);
        assert.ok((await statusText()).includes(`\n- ${line}`));
      } finally { await c.off.call(c); }
      await gone(c.re, `${c.name} put right`);
    });
  }

  // The Fleet group's review (2026-11-13): a failed save stayed listed after the folder took writes again, until that
  // same file was saved.
  test('a save that failed, then a save of another file that works: the line goes', { timeout: 120000 * SLOW }, async () => {
    const re = /^Spark Console couldn’t save agent-settings\.json/, block = state(`agent-settings.json.${T.fleet.servicePid()}.tmp`);
    mkdirSync(block);
    try {
      assert.equal((await api('/agents/settings', { method: 'PUT', body: { halted: false } })).status, 500);
      await has(re, 'the failed save');
      // (an agent key: agents.json, saved by the same writer; agent-settings.json still can't be)
      await createKey('needs-save');
      await gone(re, 'a save of another file that worked');
    } finally { rmSync(block, { recursive: true }); }
  });

  test('more than 8: the first 7, then one line counting the rest', { timeout: 120000 * SLOW }, async () => {
    const at = '2026-11-10T00:00:00.000Z', names = Array.from({ length: 10 }, (_, i) => `sc-needs-${i}`);
    const keep = readFileSync(state('desired.json'), 'utf8');
    // Ten models on the list whose containers aren't on Spark 4: each is held, one line each.
    writeFileSync(state('desired.json'), JSON.stringify({ revision: 1, running: names.map(c => ({ spark: 'spark4', container: c, model: c.slice(3), since: at, by: 'test' })), revisions: [] }), { mode: 0o600 });
    try {
      const lines = await waitFor(async () => { const n = await needs(); return n.at(-1)?.startsWith('And ') ? n : null; }, { timeout: 30000, what: 'the list cut at 8' });
      assert.equal(lines.length, 8, JSON.stringify(lines));
      assert.deepEqual(lines.slice(0, 7).map(l => /^Should be running but isn’t: (sc-needs-\d)/.exec(l)?.[1]), names.slice(0, 7));
      assert.equal(lines[7], 'And 3 more. Fix the ones above first.');
    } finally { writeFileSync(state('desired.json'), keep, { mode: 0o600 }); }
    await gone(/sc-needs-/, 'the list put back');
  });

  // The Chat group's review (2026-11-12): chats kept only in memory because the state folder can't be written.
  test('chats not being saved (the state folder can’t be written, as on a full disk): one line; gone once a save works again', { timeout: 120000 * SLOW, skip: process.getuid?.() === 0 ? 'root can write to a read-only folder' : false }, async () => {
    const re = /^Chats aren’t being saved: Spark 2’s state folder can’t be written \(full disk\?\)\. What you say now is lost at the next restart\.$/;
    chmodSync(T.fleet.stateDir, 0o500);
    try {
      await say(await newChat(), 'hello while the disk is full');
      const line = await has(re, 'chats unsaved');
      assert.ok((await statusText()).includes(`\n- ${line}`));
    } finally { chmodSync(T.fleet.stateDir, 0o700); }
    await say(await newChat(), 'hello again');
    await gone(re, 'a chat save that worked');
  });
});

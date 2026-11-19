// Covers: The owner power cards use the existing actions and their confirmation gate. Only authenticated,
// same-origin power-card requests receive the page's owner-only choice. A saved choice needs its exact passkey
// assertion and the original caller and action. Stale, repeated and unsigned choices leave the stand-in alone.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { api, auditLines, MEMBER, SLOW, sleep, T, useFleet, waitFor } from './lib.mjs';
import { TEST_DIR } from './start-mock.mjs';
import { Authenticator, passkeyHeader } from './authenticator.mjs';
import { startPlugs } from './mock/plugs.mjs';

const MODEL = 'sc-testorg--Qwen3.8-27B-abliterated-GGUF';
const SPARK = 'spark3';
const OFF = '/actions/power_off', ON = '/actions/power_on';
const CARD = { 'x-spark-power-card': '1' };
const plugs = await startPlugs([{ node_id: 2, available: true,
  attributes: { '1/6/0': true, '1/144/8': 58000, '1/144/4': 121000, '1/144/5': 483 } }]);
after(() => plugs.close());

const post = (path, body, headers = {}) => api(path, { method: 'POST', body, headers });
const statusIs = (response, status) => assert.equal(response.status, status, response.text);
const file = (...parts) => join(T.fleet.root, SPARK, '.mock', ...parts);
let key, signCount = 0;
useFleet({
  hub: 'spark1', statusMs: 1500, watchMs: 1500,
  env: {
    NODE_OPTIONS: `--import=${join(TEST_DIR, 'mock', 'clock.mjs')}`,
    SPARK_CONSOLE_PLUGS_URL: plugs.url, SPARK_CONSOLE_PLUGS_MS: '500',
    SPARK_CONSOLE_POWER_POLL_MS: '300', SPARK_CONSOLE_POWER_OFF_WAIT_MS: String(8000 * SLOW),
  },
  prepare: ({ root, stateDir }) => {
    writeFileSync(join(stateDir, 'plugs.json'), JSON.stringify({ [SPARK]: { node: 2 } }), { mode: 0o600 });
    writeFileSync(join(stateDir, 'power.json'), JSON.stringify({ idleMinutes: 0, off: {} }), { mode: 0o600 });
    writeFileSync(join(stateDir, 'desired.json'), JSON.stringify({ revision: 1, revisions: [],
      running: [{ spark: SPARK, container: MODEL, model: MODEL.slice(3), since: new Date().toISOString(), by: 'test' }] }), { mode: 0o600 });
    const containers = join(root, SPARK, '.mock', 'containers');
    writeFileSync(containers, readFileSync(containers, 'utf8').split('\n')
      .filter(line => !line.startsWith('qwen-recipe-chisel|')).join('\n'));
  },
}, async () => {
  plugs.attach({ offlineFile: T.fleet.offlineFile, sparks: { 2: SPARK } });
  statusIs(await post('/main/route', { role: 'agents', choice: `deploy:${SPARK}:${MODEL}` }), 200);
  key = new Authenticator(new URL(T.origin).hostname.split('.').slice(1).join('.'), T.origin);
  const begin = await post('/auth/passkey/begin', { purpose: 'register' });
  statusIs(begin, 200);
  statusIs(await post('/auth/passkey/register', key.register(begin.json)), 201);
});

async function ask(headers = CARD) {
  const r = await post(OFF, { spark: SPARK }, headers);
  statusIs(r, 200);
  assert.equal(r.json.outcome, 'question');
  assert.match(r.json.question, /answers Sparkie’s chats or apps/);
  return r.json.choices;
}
async function unchanged() {
  assert.match(readFileSync(file('containers'), 'utf8'), new RegExp(`^${MODEL.replaceAll('.', '\\.')}\\|running\\|`, 'm'));
  assert.ok(!readFileSync(T.fleet.offlineFile, 'utf8').split(/\s+/).includes(SPARK));
  assert.deepEqual(plugs.commands, []);
  const jobs = await api('/jobs');
  statusIs(jobs, 200);
  assert.deepEqual(jobs.json.jobs.filter(job => job.type === 'power-off'), []);
}
async function signature(path, body) {
  const begin = await post('/auth/passkey/begin', { purpose: 'confirm', method: 'POST', path, body });
  statusIs(begin, 200);
  return { summary: begin.json.summary, header: passkeyHeader(key.sign(begin.json, { signCount: ++signCount })) };
}
const signed = (header, headers = CARD) => ({ ...headers, 'x-spark-passkey': header });

test('the card marker leaves hub, viewer, origin and unrelated action checks in place', async () => {
  for (const path of [OFF, ON]) {
    statusIs(await post(path, { spark: 'spark1' }, CARD), 403);
    statusIs(await post(path, { spark: SPARK }, { ...CARD, 'tailscale-user-login': MEMBER }), 401);
    statusIs(await post(path, { spark: SPARK }, { ...CARD, origin: 'https://other.example' }), 403);
    statusIs(await post(path, { spark: SPARK }, { ...CARD, 'x-spark-console': null }), 403);
  }
  const unrelated = await post('/actions/stop_model', { spark: SPARK, container: MODEL }, CARD);
  statusIs(unrelated, 200);
  assert.equal(unrelated.json.outcome, 'question');
  assert.ok(unrelated.json.choices.every(c => c.choice === null), unrelated.text);
  assert.ok((await ask({})).every(c => c.choice === null), 'ordinary API has no owner-only choice to redeem');

  const from = auditLines().length;
  for (const headers of [{}, CARD]) {
    const on = await post(ON, { spark: SPARK }, headers);
    statusIs(on, 200);
    assert.equal(on.json.outcome, 'already');
  }
  assert.deepEqual(auditLines().slice(from).filter(line => line.action === 'power_on').map(line => line.via), ['api', 'page']);
  await unchanged();
});

test('an expired card choice cannot change power with a fresh valid passkey', async () => {
  const [{ choice }] = await ask();
  assert.match(choice, /^[a-f0-9]{10}$/);
  const body = { choice }, clock = join(T.fleet.dir, 'clock-offset');
  writeFileSync(clock, String(16 * 60000));
  try {
    await sleep(400);
    const { header } = await signature(OFF, body);
    const stale = await post(OFF, body, signed(header));
    statusIs(stale, 409);
    assert.match(stale.json.error, /choice has expired/);
    await unchanged();
  } finally {
    writeFileSync(clock, '0');
    await sleep(400);
  }
});

test('the exact signed page choice starts one shutdown and cannot be redeemed twice', async () => {
  const [yes, no] = await ask();
  const body = { choice: yes.choice };
  assert.match(yes.choice, /^[a-f0-9]{10}$/);
  assert.deepEqual(yes.call, { action: 'power_off', args: body });
  assert.equal(no.choice, null);
  for (const headers of [CARD, {}]) {
    const unsigned = await post(OFF, body, headers);
    statusIs(unsigned, 428);
    assert.equal(unsigned.json.passkey, 'confirm');
  }
  const wrongAction = await post('/actions/stop_model', body, CARD);
  statusIs(wrongAction, 409);
  const wrongCaller = await signature(OFF, body);
  statusIs(await post(OFF, body, signed(wrongCaller.header, {})), 409);
  const changed = await signature(OFF, body);
  const mismatch = await post(OFF, { ...body, spark: SPARK }, signed(changed.header));
  statusIs(mismatch, 409);
  assert.match(mismatch.json.error, /passkey confirmation was for a different change/);
  await unchanged();

  const proof = await signature(OFF, body);
  assert.equal(proof.summary, yes.label);
  const started = await post(OFF, body, signed(proof.header));
  statusIs(started, 200);
  assert.equal(started.json.outcome, 'started');
  const id = started.json.operation;
  assert.match(id, /^[a-f0-9]{12}$/);
  statusIs(await post(OFF, body, signed(proof.header)), 409);
  await waitFor(async () => {
    const r = await api(`/jobs/${id}`);
    statusIs(r, 200);
    assert.equal(r.json.via, 'page');
    if (r.json.status === 'running') return false;
    assert.equal(r.json.status, 'completed', r.text);
    return true;
  }, { timeout: 60000, what: 'the signed power-off to complete' });
  const jobs = await api('/jobs');
  statusIs(jobs, 200);
  assert.deepEqual(jobs.json.jobs.filter(job => job.type === 'power-off').map(job => job.id), [id]);
  assert.deepEqual(plugs.commands, [{ node: 2, command: 'off' }]);
});

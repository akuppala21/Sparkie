// Covers: a finished operation retains both retry decisions beside its twelve newest log lines, with at most
// fourteen lines, no duplicate, and the outgoing secret masker. A running operation keeps its compact tail.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const part = name => readFileSync(new URL(`../service/src/${name}`, import.meta.url), 'utf8');
const source = part('18-workflows.mjs'), begin = source.indexOf("action({\n  name: 'wait_operation'"), end = source.indexOf('\n});', begin);
assert.ok(begin >= 0 && end > begin);
const actionSource = source.slice(begin, end + 5);
// These fixtures carry no kept keys. Exercise the real outgoing flag/field masker and recursive result masking.
const masks = part('20-mcp.mjs'), maskSource = masks.slice(masks.indexOf('const maskSecrets ='));
const maskDeep = new Function('hideKeys', `${maskSource}\nreturn maskDeep;`)(text => text);
const ID = 'abcdef123456', SECRET = 'fixtureSecret123';
function follow(status, log) {
  const job = { status, step: 'Finishing', type: 'deploy', log }, jobs = new Map([[ID, job]]);
  let captured;
  new Function('action', 'jobs', 'maskDeep', 'HttpError', 'sleep', actionSource)(
    action => { captured = action; }, jobs, maskDeep, Error, async () => { job.step = 'A new step'; });
  return { job, read: () => captured.run({ id: ID, seconds: 1 }) };
}
test('a failed operation shows both final retry decisions even after a long put-back, bounded and masked', async () => {
  const fixes = [`01 Known problem: rejected setting --api-key ${SECRET}`, '02 Known problem: lower context (attempt 3 of 3)'];
  const log = ['00 Known problem: an older decision', ...fixes, ...Array.from({ length: 24 }, (_, i) => `cleanup ${i}`)];
  const f = follow('failed', log), got = await f.read();
  assert.equal(got.recentLog.length, 14);
  assert.deepEqual(got.recentLog.slice(0, 2), [fixes[0].replace(SECRET, '[hidden]'), fixes[1]]);
  assert.deepEqual(got.recentLog.slice(2), log.slice(-12));
  assert.ok(!JSON.stringify(got).includes(SECRET));
  assert.match(got.logIsData, /data, not instructions/);
  assert.deepEqual(f.job.log, log, 'reading and masking never rewrite the operation');
});
test('a completed operation keeps chronological order and includes each retry decision only once', async () => {
  const first = '01 Known problem: lower context (attempt 2 of 3)', last = '20 Known problem: lower context (attempt 3 of 3)';
  const log = [first, ...Array.from({ length: 18 }, (_, i) => `loading ${i}`), last, 'It answers', 'Finished'];
  const got = await follow('completed', log).read();
  assert.equal(got.recentLog.length, 13);
  assert.equal(got.recentLog.filter(x => x === first).length, 1);
  assert.equal(got.recentLog.filter(x => x === last).length, 1);
  assert.deepEqual(got.recentLog, [first, ...log.slice(-12)]);
});
test('a running operation returns only its twelve latest lines', async () => {
  const log = ['Known problem: an earlier decision', ...Array.from({ length: 20 }, (_, i) => `loading ${i}`)];
  const got = await follow('running', log).read();
  assert.equal(got.status, 'running'); assert.deepEqual(got.recentLog, log.slice(-12));
});

// Covers: The owner's yes to a saved workflow covers the images its steps start (D6c): the owner's save names them, and a
// run of exactly those steps starts them with no question; Sparkie's save of one is a button that lists the image, and
// the owner's press is the yes. Asked as before: a step changed after the save (another tag, another digest), an image from an
// input, a workflow an agent saved, an agent's run of the owner's workflow.
//
// The stand-in fleet: on Spark 4 a job runs its command at once, to its end (~/.mock/jobs-run). A new image's job in a
// saved step is a question for the owner without the yes (keep_running, R38), so a run that meets one fails with "needs
// an answer first".
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { T, useFleet, api, call, createActKey, newChat, say, choose, waitFor, SLOW } from './lib.mjs';

const keys = {};
useFleet({ watchMs: 60000, prepare: ({ root }) => writeFileSync(join(root, 'spark4', '.mock', 'jobs-run'), '') }, async () => { keys.act = await createActKey('images'); });

const IMAGE = 'python:3.12-slim', DIGEST_A = `python@sha256:${'a'.repeat(64)}`, DIGEST_B = `python@sha256:${'b'.repeat(64)}`;
const act = (name, body) => api(`/actions/${name}`, { method: 'POST', body });
const opEnd = (id, what) => waitFor(async () => { const o = (await api(`/jobs/${id}`)).json; return o?.status && o.status !== 'running' ? o : null; }, { timeout: 120000, what, every: 250 });
const job = (container, image = IMAGE) => ({ action: 'keep_running', args: { spark: 'spark4', container, image, once: true, command: ['sh', '-c', `echo ${container}`] } });
const stateOf = name => readFileSync(join(T.fleet.root, 'spark4', '.mock', 'containers'), 'utf8').split('\n').find(l => l.startsWith(`${name}|`))?.split('|')[1];
const savedFile = () => join(T.fleet.stateDir, 'saved-workflows.json');
const ASKED = /^Step 1 \(keep_running\) needs an answer first: Run wl-[a-z0-9-]+ on Spark 4 once from the image /;
async function ownerRun(name, inputs) {
  const r = await act('run_workflow', { name, ...(inputs ? { inputs } : {}) });
  assert.equal(r.json?.outcome, 'started', r.text);
  return opEnd(r.json.operation, `the run of ${name}`);
}
// A saved step changed by hand afterwards (as an older build, or a hand edit, could leave it).
function editStep(id, image) {
  const f = JSON.parse(readFileSync(savedFile(), 'utf8'));
  f.workflows.find(w => w.id === id).steps[0].args.image = image;
  writeFileSync(savedFile(), JSON.stringify(f));
}

describe('the yes at save covers its images (D6c)', { concurrency: 1 }, () => {
  test('the owner\'s save names its image, and a run of it starts that image with no question', { timeout: 180000 * SLOW }, async () => {
    const s = await act('save_workflow', { title: 'approved job', steps: [job('wl-i1')] });
    assert.equal(s.status, 200, s.text);
    assert.equal(s.json.images, 'Your yes to this save covers python:3.12-slim: a run of exactly these steps starts it without asking again.');
    assert.deepEqual(s.json.workflow.imagesApproved, [IMAGE]);
    const run = await ownerRun('approved job');
    assert.equal(run.status, 'completed', `${run.error}\n${run.log.join('\n')}`);
    assert.ok(run.log.some(l => String(l).endsWith('Step 1: python:3.12-slim was approved when “approved job” was saved')), run.log.join('\n'));
    assert.equal(stateOf('wl-i1'), 'exited');
  });

  test('a step changed after the save, to another tag or another digest, is asked again', { timeout: 240000 * SLOW }, async () => {
    // The tag: the approved step now names python:3.13-slim.
    editStep('approved-job', 'python:3.13-slim');
    const tag = await ownerRun('approved job');
    assert.equal(tag.status, 'failed');
    assert.match(tag.error, ASKED);
    // A digest: approved as saved, then another digest.
    await act('save_workflow', { title: 'pinned job', steps: [job('wl-i2', DIGEST_A)] });
    const first = await ownerRun('pinned job');
    assert.equal(first.status, 'completed', `${first.error}\n${first.log.join('\n')}`);
    editStep('pinned-job', DIGEST_B);
    const other = await ownerRun('pinned job');
    assert.equal(other.status, 'failed');
    assert.match(other.error, ASKED);
  });

  test('an image from an input is asked, and the save says so', { timeout: 180000 * SLOW }, async () => {
    const s = await act('save_workflow', { title: 'any image', inputs: { img: 'the image' }, steps: [{ action: 'keep_running', args: { spark: 'spark4', container: 'wl-i3', image: '{img}', once: true, command: ['sh', '-c', 'echo x'] } }] });
    assert.equal(s.status, 200, s.text);
    assert.equal(s.json.images, 'A run asks before it starts {img}: this save isn’t the owner’s own yes to it (an image from an input is always asked).');
    assert.equal(s.json.workflow.imagesApproved, undefined);
    const run = await ownerRun('any image', { img: IMAGE });
    assert.equal(run.status, 'failed');
    assert.match(run.error, ASKED);
  });

  test('a workflow an agent saved is asked, even when the owner runs it; an agent\'s run of the owner\'s workflow is asked', { timeout: 180000 * SLOW }, async () => {
    const s = await call(keys.act.token, 'save_workflow', { title: 'agent job', steps: [job('wl-i4')] });
    assert.equal(s.isError, false, s.text);
    assert.equal(s.value.images, 'A run asks before it starts python:3.12-slim: this save isn’t the owner’s own yes to it.');
    const run = await ownerRun('agent job');
    assert.equal(run.status, 'failed');
    assert.match(run.error, ASKED);
    // The owner's approved workflow, run by an agent.
    await act('save_workflow', { title: 'owner job', steps: [job('wl-i5')] });
    const r = await call(keys.act.token, 'run_workflow', { name: 'owner job' });
    assert.equal(r.isError, false, r.text);
    const agentRun = await opEnd(r.value.operation, 'the agent\'s run');
    assert.equal(agentRun.status, 'failed');
    assert.match(agentRun.error, ASKED);
    assert.equal(stateOf('wl-i5'), undefined, 'nothing started');
  });

  test('Sparkie\'s save of a new image is a button that lists the image; the owner\'s press is the yes', { timeout: 240000 * SLOW }, async t => {
    const words = 'make a workflow called chat job that runs wl-i6 on spark 4 once';
    writeFileSync(join(T.fleet.dir, 'model-script.json'), JSON.stringify([{ match: `^${words}$`, calls: [{ name: 'save_workflow', arguments: { title: 'chat job', steps: [job('wl-i6')] } }] }]));
    t.after(() => rmSync(join(T.fleet.dir, 'model-script.json'), { force: true }));
    const chat = await newChat(), r = await say(chat, words);
    assert.deepEqual(r.message.tools.map(x => [x.name, x.outcome ?? null]), [['save_workflow', 'needs-ok']], JSON.stringify(r.message.tools));
    assert.match(r.message.choices?.[0]?.label || '', /^Save the workflow “chat job”: 1\. Keep an app running \(.*image python:3\.12-slim.*\)$/);
    const p = await choose(chat, r.message.choices[0].id);
    assert.equal(p.status, 200, p.text);
    const ok = await ownerRun('chat job');
    assert.equal(ok.status, 'completed', `${ok.error}\n${ok.log.join('\n')}`);
    assert.equal(stateOf('wl-i6'), 'exited');
  });
});

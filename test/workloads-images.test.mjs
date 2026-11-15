// Covers: The owner's yes to a saved workflow covers the images its steps start (D6c): the yes is Sparkie's save button,
// which lists each step with its image, pressed by the owner on the page; a run of exactly those steps starts them with
// no question. Asked as before: the same steps saved with no button (the owner's POST /actions), a step changed after
// the save (another tag, another digest), an image from an input, a workflow an agent saved, an agent's run of the
// owner's workflow. With the images running, D6a's chain end to end: a new job placed where its /in file is, and the
// next one, naming no Spark, on the Spark the run's last step ran on, where it reads the first one's folder.
//
// The stand-in fleet: on Sparks 3 and 4 a job runs its command at once, to its end (~/.mock/jobs-run). A new image's job
// in a saved step is a question for the owner without the yes (keep_running, R38), so a run that meets one fails with
// "needs an answer first".
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { T, useFleet, api, call, createActKey, newChat, say, choose, waitFor, SLOW } from './lib.mjs';

const keys = {};
useFleet({ watchMs: 60000, prepare: ({ root }) => {
  for (const spark of ['spark3', 'spark4']) writeFileSync(join(root, spark, '.mock', 'jobs-run'), '');
  // (a file only Spark 4's shared folder has, for the chain below)
  const shared = join(root, 'spark4', '.local', 'share', 'spark-portal', 'workspaces', 'shared');
  mkdirSync(shared, { recursive: true });
  writeFileSync(join(shared, 'numbers.csv'), '1,2,3\n');
} }, async () => { keys.act = await createActKey('images'); });

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

const esc = t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const saved = async name => (await act('workflows', {})).json.saved.find(w => w.name === name) || null;
// The owner's yes: Sparkie's save button (its label lists each step with its image), pressed on the page.
async function ownerSaves(title, steps, inputs) {
  const words = `make a workflow called ${title}`;
  writeFileSync(join(T.fleet.dir, 'model-script.json'), JSON.stringify([{ match: `^${esc(words)}$`, calls: [{ name: 'save_workflow', arguments: { title, steps, ...(inputs ? { inputs } : {}) } }] }]));
  try {
    const chat = await newChat(), r = await say(chat, words);
    assert.deepEqual(r.message.tools.map(x => [x.name, x.outcome ?? null]), [['save_workflow', 'needs-ok']], JSON.stringify(r.message.tools));
    const label = r.message.choices?.[0]?.label || '';
    for (const st of steps) assert.ok(label.includes(`image ${st.args.image}`), `the button names ${st.args.image}: ${label}`);
    const p = await choose(chat, r.message.choices[0].id);
    assert.equal(p.status, 200, p.text);
    return saved(title.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
  } finally { rmSync(join(T.fleet.dir, 'model-script.json'), { force: true }); }
}

describe('the yes at save covers its images (D6c)', { concurrency: 1 }, () => {
  test('the owner\'s press of the save button, which names the image, is the yes: a run starts that image with no question; the same steps saved with no button are asked', { timeout: 240000 * SLOW }, async () => {
    const w = await ownerSaves('approved job', [job('wl-i1')]);
    assert.deepEqual(w?.imagesApproved, [IMAGE], JSON.stringify(w));
    const run = await ownerRun('approved job');
    assert.equal(run.status, 'completed', `${run.error}\n${run.log.join('\n')}`);
    assert.ok(run.log.some(l => String(l).endsWith('Step 1: python:3.12-slim was approved when “approved job” was saved')), run.log.join('\n'));
    assert.equal(stateOf('wl-i1'), 'exited');
    // The owner's POST /actions shows nobody the image: no yes.
    const s = await act('save_workflow', { title: 'api job', steps: [job('wl-i7')] });
    assert.equal(s.status, 200, s.text);
    assert.equal(s.json.images, 'A run asks before it starts python:3.12-slim: only your yes to a save’s button, which lists its steps, covers the images it names.');
    assert.equal(s.json.workflow.imagesApproved, undefined);
    const asked = await ownerRun('api job');
    assert.equal(asked.status, 'failed');
    assert.match(asked.error, ASKED);
  });

  test('a step changed after the yes, to another tag or another digest, is asked again', { timeout: 300000 * SLOW }, async () => {
    await ownerSaves('tag job', [job('wl-i8')]);
    editStep('tag-job', 'python:3.13-slim');
    const tag = await ownerRun('tag job');
    assert.equal(tag.status, 'failed');
    assert.match(tag.error, ASKED);
    // A digest: one approved as pressed runs; the same approved, then changed to another digest, is asked.
    await ownerSaves('pinned job', [job('wl-i2', DIGEST_A)]);
    const pinned = await ownerRun('pinned job');
    assert.equal(pinned.status, 'completed', `${pinned.error}\n${pinned.log.join('\n')}`);
    await ownerSaves('repinned job', [job('wl-i9', DIGEST_A)]);
    editStep('repinned-job', DIGEST_B);
    const other = await ownerRun('repinned job');
    assert.equal(other.status, 'failed');
    assert.match(other.error, ASKED);
  });

  test('an image from an input is asked, even after the owner\'s yes', { timeout: 180000 * SLOW }, async () => {
    const w = await ownerSaves('any image', [{ action: 'keep_running', args: { spark: 'spark4', container: 'wl-i3', image: '{img}', once: true, command: ['sh', '-c', 'echo x'] } }], { img: 'the image' });
    assert.equal(w?.imagesApproved, undefined, JSON.stringify(w));
    const run = await ownerRun('any image', { img: IMAGE });
    assert.equal(run.status, 'failed');
    assert.match(run.error, ASKED);
  });

  test('a workflow an agent saved is asked, even when the owner runs it; an agent\'s run of the owner\'s workflow is asked', { timeout: 240000 * SLOW }, async () => {
    const s = await call(keys.act.token, 'save_workflow', { title: 'agent job', steps: [job('wl-i4')] });
    assert.equal(s.isError, false, s.text);
    assert.match(s.value.images, /^A run asks before it starts python:3\.12-slim/);
    const run = await ownerRun('agent job');
    assert.equal(run.status, 'failed');
    assert.match(run.error, ASKED);
    // The owner's approved workflow, run by an agent.
    await ownerSaves('owner job', [job('wl-i5')]);
    const r = await call(keys.act.token, 'run_workflow', { name: 'owner job' });
    assert.equal(r.isError, false, r.text);
    const agentRun = await opEnd(r.value.operation, 'the agent\'s run');
    assert.equal(agentRun.status, 'failed');
    assert.match(agentRun.error, ASKED);
    assert.equal(stateOf('wl-i5'), undefined, 'nothing started');
  });

  // D6a's chain, end to end now that the images run: a new job placed where its /in file is, and the next one, which
  // names no Spark and no file, placed on the Spark the run's last step ran on (not Spark 3, first in list order), where
  // it reads the first one's folder. (The stand-in runs a job's command in its /out folder: ../wl-c1 is /in/jobs/wl-c1.)
  test('a chain of new jobs with no Spark named: the second goes where the first ran, and reads its files', { timeout: 240000 * SLOW }, async () => {
    await ownerSaves('chain', [
      { action: 'keep_running', args: { container: 'wl-c1', image: IMAGE, once: true, command: ['sh', '-c', 'echo first > out.txt', '/in/numbers.csv'] } },
      { action: 'keep_running', args: { container: 'wl-c2', image: IMAGE, once: true, command: ['sh', '-c', 'cat ../wl-c1/out.txt > read.txt'] } },
    ]);
    const run = await ownerRun('chain');
    assert.equal(run.status, 'completed', `${run.error}\n${run.log.join('\n')}`);
    const log = run.log.map(l => String(l).slice(10));
    assert.ok(log.includes('Step 1: wl-c1 goes on Spark 4: it has room and the files its command names'), log.join('\n'));
    assert.ok(log.includes('Step 2: wl-c2 goes on Spark 4: the run’s last step ran there, and it has room'), log.join('\n'));
    assert.equal(readFileSync(join(T.fleet.root, 'spark4', '.local', 'share', 'spark-portal', 'workspaces', 'shared', 'jobs', 'wl-c2', 'read.txt'), 'utf8').trim(), 'first');
  });
});

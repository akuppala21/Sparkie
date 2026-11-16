// Covers: One model across Spark 3 and Spark 4 with the brain's proven setup (the brain's own Qwen, in Recipes): SGLang
// split in two over the cable, without the draft model, the stretched context or Spark 2's cache folders. The cable
// before and during a start: a Spark that refuses connections (pings still pass) stops the start before anything stops,
// naming the Spark and the command to let the cable in; engines that can't connect (Gloo) fail in the short engine test
// before the parts start, in Gloo's words, with no second try; parts that never connect are stopped early with where
// each was waiting (their stack dumps) and, stuck in NCCL, tried once more over plain sockets, and the one-Spark copy
// that had the first part's name runs again; NCCL that only hangs over RoCE is caught by the engine check and starts
// over plain sockets, and that run is kept; a Spark that misses a cable re-test keeps its pairs' last result. A pair
// with room on Spark 4 only if a container started by hand stops (F11): an owner-only question that names it (also when
// no Sparks were named), asking stops nothing, an agent gets no choice to send back, and the owner's Yes on the page
// starts it across both Sparks with that stop in the plan. A failed start across two whose part on Spark 4 never stops
// (A-23): the one-Spark copy set aside there isn't started beside that part, and the error and log say so.
//
// One model across two Sparks with the brain's proven setup (docs/contract.md 15, 2026-11-08). The brain runs on one
// Spark, and its runs aren't repeated as they are (a draft model only Spark 2 has, a stretched context). When the only
// proven setup for a model is the brain's, a start across Spark 3 and Spark 4 uses it made plain: the same engine and
// settings, split over the cable by the start's own two-Spark flags, rather than the engine's defaults (which couldn't
// start the brain's hybrid Qwen at all). The model is the brain's own, as on the real Sparks: in Recipes, on Spark 4, copied to Spark 3.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync, mkdtempSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { T, useFleet, api, call, createKey, createActKey, agentSettings, newChat, say, choose, waitFor, SLOW } from './lib.mjs';

const keys = {};
const DFLASH = ['--context-length', '1000000', '--speculative-algorithm', 'DFLASH', '--speculative-num-draft-tokens', '16', '--tp-size', '1',
  '--mem-fraction-static', '0.8', '--weight-loader-disable-mmap'];
// Its environment as on Spark 2: SGLang's rendezvous in a file there (2026-11-10: carried to two Sparks, each part met
// only itself and both waited in Gloo's setup).
const BRAIN_ENV = { HOME: '/kernel-cache/home', SGLANG_ENABLE_JIT_DEEPGEMM: '0', SGLANG_DISTRIBUTED_INIT_METHOD_OVERRIDE: 'file:///tmp/sglang-rdv' };
const brainRun = { key: JSON.stringify(['RadixArk--Qwen3.8-27B-NVFP4', 'sglang', 'lmsysorg/sglang:v0.5.23', 1, DFLASH, BRAIN_ENV]), model: 'RadixArk--Qwen3.8-27B-NVFP4', repo: 'RadixArk/Qwen3.8-27B-NVFP4',
  title: 'Qwen 3.8 27B', engine: 'sglang', image: 'lmsysorg/sglang:v0.5.23', args: DFLASH, env: BRAIN_ENV,
  sparks: 1, nodes: ['spark2'], firstAt: '2026-11-08T00:00:00Z', lastAt: '2026-11-08T00:00:00Z', runs: 1, best: { decodeTokS: 30, ttftMs: 100 }, brain: true };
// A start whose parts never connect is stopped after SPARK_CONSOLE_CONNECT_MS (10 minutes on the Sparks).
// (A-23) A stand-in docker in front of the fleet's (PATH): a stop of the container named in ~/.mock/stop-hangs never
// comes back; anything else goes to the stand-in as it is.
const BIN = join(dirname(fileURLToPath(import.meta.url)), 'mock', 'bin');
const WRAP = mkdtempSync(join(tmpdir(), 'across-docker-'));
writeFileSync(join(WRAP, 'docker'), `#!/bin/bash
if [ "$1" = stop ] && [ -s "$HOME/.mock/stop-hangs" ]; then
  for a in "$@"; do [ "$a" = "$(cat "$HOME/.mock/stop-hangs")" ] && { exec >/dev/null 2>&1 </dev/null; sleep 150; exit 1; }; done
fi
exec ${JSON.stringify(join(BIN, 'docker'))} "$@"
`);
chmodSync(join(WRAP, 'docker'), 0o755);
useFleet({ watchMs: 60000, statusMs: 3000, env: { SPARK_CONSOLE_CONNECT_MS: String(20000 * SLOW), PATH: `${WRAP}:${BIN}:${process.env.PATH}` },
  prepare: ({ stateDir }) => writeFileSync(join(stateDir, 'verified.json'), JSON.stringify({ deployments: [brainRun] }), { mode: 0o600 }),
}, async () => { keys.look = await createKey('across'); keys.act = await createActKey('across-act'); });

test('across Spark 3 and Spark 4, a model whose only proven setup is the brain\'s starts with it, split over the cable', { timeout: 300000 * SLOW }, async t => {
  const broken = join(T.fleet.root, 'spark4', '.mock', 'engine-check-broken');
  writeFileSync(broken, '');
  t.after(() => rmSync(broken, { force: true }));
  const r = await call(keys.act.token, 'start_model', { model: 'RadixArk--Qwen3.8-27B-NVFP4', sparks: ['spark3', 'spark4'] });
  let id = null;
  if (r.isError && /^\[still_running\]/.test(r.text)) {
    // On a busy machine the call can outlast the agent door's 50 s (seen in the full suite); the start goes on, so find it.
    for (const until = Date.now() + 120000 * SLOW; !id;) {
      id = (await call(keys.look.token, 'recent_operations', { limit: 20 })).value.operations.find(o => o.type === 'deploy-cluster' && /Qwen3\.8-27B-NVFP4/.test(o.model || ''))?.id || null;
      if (!id) { assert.ok(Date.now() < until, 'the start never showed up in recent_operations'); await new Promise(res => setTimeout(res, 3000)); }
    }
  } else {
    assert.equal(r.isError, false, r.text);
    assert.equal(r.value.setup, 'the brain’s proven setup, without its draft model', JSON.stringify(r.value));
    assert.deepEqual(r.value.sparks, ['spark3', 'spark4']);
    id = r.value.operation;
  }
  let w;
  for (const until = Date.now() + 240000 * SLOW; ;) {
    w = (await call(keys.look.token, 'wait_operation', { id, seconds: 30 })).value;
    if (w.status !== 'running') break;
    assert.ok(Date.now() < until, 'still starting');
  }
  assert.equal(w.status, 'completed', JSON.stringify(w));
  const log = (await api(`/jobs/${id}`)).json.log || [];
  assert.ok(log.some(l => /Using the brain’s proven setup for this model, split across both Sparks/.test(l)), log.join('\n'));
  // The engine check couldn't start on Spark 4 (engine-check-broken, set below): the log says why, and the start went on.
  assert.ok(log.some(l => /The engine check didn’t run on Spark 4 \(exit 1: docker: Error response from daemon: could not select device driver .*\), so the start goes on without it/.test(l)), log.join('\n'));
  for (const [spark, rank] of [['spark3', '0'], ['spark4', '1']]) {
    const args = readFileSync(join(T.fleet.root, spark, '.mock', 'last-run-args'), 'utf8').split('\n');
    const after = flag => args[args.indexOf(flag) + 1];
    assert.ok(args.includes('sglang.launch_server'), `${spark}: SGLang, the brain's engine`);
    // (its /metrics on where it answers, the first part, and never twice: the idle power-off reads it, 21-power.mjs)
    assert.ok(args.filter(x => x === '--enable-metrics').length <= 1, `${spark}: --enable-metrics at most once`);
    if (rank === '0') assert.equal(args.filter(x => x === '--enable-metrics').length, 1, `${spark}: the part that answers has its /metrics on`);
    assert.equal(args.find(a => a.startsWith('lmsysorg/sglang')), 'lmsysorg/sglang:v0.5.23', `${spark}: the brain's image`);
    assert.equal(after('--tp'), '2', `${spark}: split in two`);
    assert.equal(after('--node-rank'), rank);
    assert.ok(!args.includes('--tp-size'), `${spark}: the brain's one-Spark size is gone`);
    assert.ok(args.includes('--weight-loader-disable-mmap'), `${spark}: the brain's other settings stay`);
    assert.ok(!args.some(a => a.startsWith('--speculative-')), `${spark}: no draft model`);
    assert.ok(!args.includes('1000000'), `${spark}: no stretched context`);
    assert.ok(!args.some(a => a.includes('/kernel-cache')), `${spark}: none of Spark 2's cache folders`);
    for (const e of ['NCCL_DEBUG=INFO', 'NCCL_DEBUG_SUBSYS=INIT,BOOTSTRAP,NET', 'PYTHONFAULTHANDLER=1', 'NCCL_IB_DISABLE=0']) assert.ok(args.includes(e), `${spark}: ${e}`);
    // Each part keeps its engine's compiled kernels and tuning on its Spark, per image (a restart reuses them).
    assert.ok(args.some(a => /\.cache\/spark-console\/engines\/lmsysorg_sglang_v0\.5\.23.*:\/spark-cache$/.test(a)), `${spark}: ${args.join(' ')}`);
    assert.ok(args.includes('TORCHINDUCTOR_CACHE_DIR=/spark-cache/inductor'), `${spark}: inductor cache`);
    // The parts meet at the first Spark's cable address, never in a file of their own (the brain's rendezvous setting).
    assert.ok(!args.some(a => a.startsWith('SGLANG_DISTRIBUTED_INIT_METHOD_OVERRIDE')), `${spark}: no rendezvous override`);
    assert.ok(args.includes('SGLANG_ENABLE_JIT_DEEPGEMM=0'), `${spark}: the brain's other settings stay`);
  }
});

/* ───────── the cable, before and while the parts start (2026-11-10, Spark 3 + Spark 4) ───────── */
const QWEN = 'RadixArk--Qwen3.8-27B-NVFP4', HEAD = `sc-${QWEN}`, PART2 = `${HEAD}-part2`;
const mock = (spark, file) => join(T.fleet.root, spark, '.mock', file);
function containers(spark) {
  const out = {};
  for (const line of readFileSync(mock(spark, 'containers'), 'utf8').split('\n').filter(Boolean)) {
    const [name, state, status, ours, model, protect, role, cluster, rank] = line.split('|');
    out[name] = { state, status, ours, model, protect, role, cluster, rank };
  }
  return out;
}
async function settled(id) {
  for (const until = Date.now() + 240000 * SLOW; ;) {
    const w = (await call(keys.look.token, 'wait_operation', { id, seconds: 30 })).value;
    if (w.status !== 'running') return w;
    assert.ok(Date.now() < until, 'still going');
  }
}
async function startAcross() {
  const r = await call(keys.act.token, 'start_model', { model: QWEN, sparks: ['spark3', 'spark4'] });
  assert.equal(r.isError, false, r.text);
  assert.equal(r.value.outcome, 'started', r.text);
  const w = await settled(r.value.operation);
  return { w, log: (await api(`/jobs/${r.value.operation}`)).json.log || [] };
}

test('a Spark that refuses connections on the cable (pings still pass): the start stops nothing and says what to let in', { timeout: 300000 * SLOW }, async () => {
  // The model from the first test runs across both; stop it, and put a one-Spark copy of it on Spark 3 instead (the
  // same container name as the first part), as it was on the real Sparks.
  // (From the page: an agent's stop_model can outlast the agent door's 50 seconds on a busy machine.)
  const s = await api('/stop', { method: 'POST', body: { node: 'spark3', container: HEAD } });
  assert.equal(s.status, 202, s.text);
  assert.equal((await settled(s.json.id)).status, 'completed');
  const lines = readFileSync(mock('spark3', 'containers'), 'utf8').split('\n').filter(l => l && !l.startsWith(`${HEAD}|`));
  writeFileSync(mock('spark3', 'containers'), [...lines, `${HEAD}|running|Up 1 hour|1|${QWEN}||||`, ''].join('\n'));
  writeFileSync(mock('spark3', `up-${HEAD}`), String(Math.floor(Date.now() / 1000) - 3600));
  writeFileSync(mock('spark3', 'firewall'), '');
  try {
    const { w, log } = await startAcross();
    assert.equal(w.status, 'failed', JSON.stringify(w));
    const said = `${w.error || ''}\n${log.join('\n')}`;
    assert.match(said, /can’t run a model together yet, so nothing was stopped/, said);
    assert.match(said, /Spark 4 can’t open a connection to Spark 3 over the cable \(it was refused\), though pings get through/, said);
    assert.match(said, /sudo ufw allow in on [A-Za-z0-9]+/, said);
    assert.ok(!log.some(l => /^\S+\s+Stopping /.test(l)), log.join('\n'));
  } finally { rmSync(mock('spark3', 'firewall'), { force: true }); }
  assert.equal(containers('spark3')[HEAD].state, 'running', 'the one-Spark copy kept running');
  assert.equal(containers('spark3')[HEAD].cluster || '', '');
});

test('engines that can\'t connect (Gloo) fail in the short engine test before the parts start, in Gloo\'s words, with no second try', { timeout: 300000 * SLOW }, async () => {
  for (const spark of ['spark3', 'spark4']) writeFileSync(mock(spark, 'gloo-fail'), '');
  const t0 = Date.now();
  try {
    const { w, log } = await startAcross();
    assert.equal(w.status, 'failed', JSON.stringify(w));
    const said = `${w.error || ''}\n${log.join('\n')}`;
    assert.match(said, /It didn’t start: the two parts never connected to each other\. The lines below say which step each part was stuck at/, said);
    assert.match(said, /couldn’t connect their engines over the cable in a short test before the start, so the model wasn’t started \(stuck in Gloo, torch’s plain-TCP setup, on Spark \d: Gloo connectFullMesh failed with \S+ Connect timeout \[10\.100\.186\.3\]:45213\)/, said);
    assert.ok(!/Known problem/.test(said), 'no second try: no NCCL setting helps Gloo');
    assert.ok(!log.some(l => /Loading the model on both Sparks/.test(l)), 'the parts never started');
    assert.match(said, new RegExp(`Started ${HEAD} on spark3 again`), said);
    assert.ok(Date.now() - t0 < 150000 * SLOW, 'failed fast, not at the 10-minute stall');
  } finally {
    for (const spark of ['spark3', 'spark4']) rmSync(mock(spark, 'gloo-fail'), { force: true });
  }
  const c3 = containers('spark3');
  assert.equal(c3[HEAD]?.state, 'running', JSON.stringify(c3[HEAD]));
  assert.equal(c3[HEAD].cluster || '', '', 'the one-Spark copy, running again');
  assert.ok(!Object.keys(c3).some(n => n.includes('engine-check') || n.includes('-before-')), Object.keys(c3).join(', '));
});

test('parts that never connect stop early with where each was waiting, try once more over plain sockets, and the one-Spark copy that had the first part\'s name runs again', { timeout: 300000 * SLOW }, async () => {
  // Both parts sit at SGLang's first step, and the first never answers (as on the real Sparks for 28 minutes).
  // And the engine check's NCCL sum gives no answer, though NCCL's setup finished on both (as on 2026-11-11): the start
  // goes on, and the log says so.
  for (const spark of ['spark3', 'spark4']) writeFileSync(mock(spark, 'nccl-sum-dies'), '');
  writeFileSync(mock('spark3', `logs-${HEAD}`), '[2026-11-10 07:45:31 TP0] Init parallel begin.\n');
  writeFileSync(mock('spark4', `logs-${PART2}`), '[2026-11-10 07:45:42 TP1] Init parallel begin.\n');
  writeFileSync(mock('spark3', 'serve-down'), '');
  const t0 = Date.now();
  try {
    const { w, log } = await startAcross();
    assert.equal(w.status, 'failed', JSON.stringify(w));
    const said = `${w.error || ''}\n${log.join('\n')}`;
    assert.match(said, /Spark 3 and Spark 4 connect to each other over the cable/, said);
    assert.match(said, /didn’t connect to each other over the cable within \d+ (?:seconds|minutes) \(neither part started loading the model\), so both were stopped/, said);
    assert.match(said, /Init parallel begin/, said);
    // Where each part was waiting, from its stack dump; then the known fix (plain sockets), which stalled the same way.
    assert.match(said, /Waiting in:\n  sglang\/srt\/distributed\/device_communicators\/pynccl\.py:112 in __init__\n  sglang\/srt\/distributed\/parallel_state\.py:291 in __init__/, said);
    assert.ok(!/threading\.py/.test(said.split('Waiting in:')[1].split('…')[0]), 'only the engine’s connection frames');
    assert.match(said, /Known problem: the two parts never connected to each other\. Starting it again with NCCL over plain sockets on the cable instead of RoCE/, said);
    assert.match(said, /It didn’t start: the two parts never connected to each other \(2 attempts\)/, said);
    assert.match(said, /\(stuck in NCCL\), with NCCL over plain sockets\. Where each part was waiting/, said);
    assert.match(said, /Its connections:\n  10\.100\.186\.3:51544 → 10\.100\.186\.2:41877 trying to connect\n/, said);
    assert.match(said, /  127\.0\.0\.1:5557 → 127\.0\.0\.1:40112 connected \(on this Spark\)\nIts rendezvous settings:\n  GLOO_SOCKET_IFNAME=enp1s0f1np1\n/, said);
    assert.ok(!/^(sock|env) /m.test(said), 'not the raw lines');
    assert.match(said, /Attempt 1: Spark 3 and Spark 4 didn’t connect to each other over the cable within/, said);
    assert.match(said, /The engines on Spark 3 and Spark 4 connect over the cable \(Gloo and NCCL over RoCE; NCCL’s setup finished on both, but its test sum on Spark 3 gave no answer: it ended without a result \(exit 139\)\)/, said);
    assert.match(said, new RegExp(`Started ${HEAD} on spark3 again`), said);
    assert.ok(Date.now() - t0 < 200000 * SLOW, 'stopped early, not at the 45-minute limit');
  } finally {
    for (const [spark, f] of [['spark3', `logs-${HEAD}`], ['spark4', `logs-${PART2}`], ['spark3', 'serve-down'], ['spark3', 'nccl-sum-dies'], ['spark4', 'nccl-sum-dies']]) rmSync(mock(spark, f), { force: true });
  }
  const c3 = containers('spark3');
  assert.equal(c3[HEAD]?.state, 'running', JSON.stringify(c3[HEAD]));
  assert.equal(c3[HEAD].cluster || '', '', 'it’s the one-Spark copy, not the first part');
  assert.ok(!Object.keys(c3).some(n => n.includes('-before-')), Object.keys(c3).join(', '));
  assert.equal(containers('spark4')[PART2]?.state, 'exited');
});

test('parts that only hang over RoCE start over plain sockets on the same cable, and that run is kept to repeat', { timeout: 300000 * SLOW }, async () => {
  // The three failed starts before this one (refused, Gloo, stalled) paused agents' changes, as three in a row do; the
  // owner resumes them.
  assert.equal((await api('/agents')).json.settings.halted, true, 'three failures in a row pause agents');
  await agentSettings({ halted: false });
  for (const spark of ['spark3', 'spark4']) writeFileSync(mock(spark, 'roce-hang'), '');
  try {
    const { w, log } = await startAcross();
    assert.equal(w.status, 'completed', JSON.stringify(w));
    const said = log.join('\n');
    assert.match(said, /Known problem: the two parts never connected to each other\. Starting it again with NCCL over plain sockets/, said);
    assert.match(said, /Started after fixing: the two parts never connected to each other \(it runs with NCCL over plain sockets on the cable instead of RoCE\)/, said);
    assert.match(said, /Attempt 1: Spark 3 and Spark 4 couldn’t connect their engines over the cable in a short test before the start, so the model wasn’t started \(stuck in NCCL, with NCCL over RoCE, on Spark \d: it didn’t finish in time\)/, said);
    // The check's result line sat inside one of NCCL's lines (as on the Sparks); it still counts as an answer.
    assert.match(said, /The engines on Spark 3 and Spark 4 connect over the cable \(Gloo and NCCL\)$/m, said);
    for (const spark of ['spark3', 'spark4']) {
      const args = readFileSync(mock(spark, 'last-run-args'), 'utf8').split('\n');
      assert.ok(args.includes('NCCL_IB_DISABLE=1') && !args.some(a => a.startsWith('NCCL_IB_HCA=')), `${spark}: plain sockets`);
      assert.ok(args.includes(`NCCL_SOCKET_IFNAME=${args.find(a => a.startsWith('GLOO_SOCKET_IFNAME=')).split('=')[1]}`), `${spark}: still on the cable`);
    }
    const runs = (await api('/verified')).json.deployments.filter(v => v.sparks === 2 && v.model === QWEN);
    assert.ok(runs.some(v => v.env?.NCCL_IB_DISABLE === '1'), JSON.stringify(runs.map(v => v.env)));
  } finally {
    for (const spark of ['spark3', 'spark4']) rmSync(mock(spark, 'roce-hang'), { force: true });
  }
});

test('a Spark that misses a cable re-test keeps its pairs’ last result (a missing pair would refuse every start across it)', { timeout: 120000 * SLOW }, async () => {
  const pair = r => r.json.pairs.find(p => p.a === 'spark3' && p.b === 'spark4');
  assert.equal(pair(await api('/fabric'))?.fastLink, 'full');
  const offline = readFileSync(T.fleet.offlineFile, 'utf8');
  writeFileSync(T.fleet.offlineFile, `${offline.trim()}\nspark4\n`);
  try {
    const r = await api('/fabric?check=1');
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.sparks.find(s => s.id === 'spark4').online, false);
    assert.equal(pair(r)?.fastLink, 'full', JSON.stringify(r.json.pairs));
  } finally { writeFileSync(T.fleet.offlineFile, offline); }
});

// A-23: a start across Spark 3 and 4 that fails its test prompt, with the stop of Spark 4's part never coming back. The
// one-Spark copy of the model that ran on Spark 4 was set aside for that part: it isn't started again beside it; the
// error (after its first line) and the log say so; the part stays on the operation's list.
test('a start across two that fails, with the stop of Spark 4\'s part never coming back: the copy set aside on Spark 4 isn\'t started beside it, and it is said', { timeout: 900000 * SLOW }, async () => {
  await waitFor(async () => (await api('/status')).json.nodes.find(n => n.id === 'spark4')?.state === 'online', { timeout: 90000 * SLOW, what: 'Spark 4 online again' });
  await waitFor(async () => (await api('/models')).json.sparks?.find(s => s.id === 'spark4')?.online, { timeout: 90000, what: 'Spark 4 in a fresh look' });
  // The model from the RoCE test runs across both: it stops; then a one-Spark copy of it runs on Spark 4 (the first
  // part's name), as when the fleet starts.
  if (containers('spark3')[HEAD]?.state === 'running' || containers('spark4')[PART2]?.state === 'running') {
    const s = await api('/stop', { method: 'POST', body: { node: 'spark4', container: PART2 } });
    assert.equal(s.status, 202, s.text);
    assert.equal((await settled(s.json.id)).status, 'completed');
  }
  const lines = readFileSync(mock('spark4', 'containers'), 'utf8').split('\n').filter(l => l && !l.startsWith(`${HEAD}|`));
  writeFileSync(mock('spark4', 'containers'), [...lines, `${HEAD}|running|Up 1 hour|1|${QWEN}||||`, ''].join('\n'));
  writeFileSync(mock('spark4', `up-${HEAD}`), String(Math.floor(Date.now() / 1000) - 3600));
  writeFileSync(join(T.fleet.dir, 'serve-silent'), '');
  writeFileSync(mock('spark4', 'stop-hangs'), PART2);
  let id = null;
  try {
    // (the owner's own call: its failure doesn't count against agents)
    const r = await api('/actions/start_model', { method: 'POST', body: { model: QWEN, sparks: ['spark3', 'spark4'] } });
    assert.equal(r.json?.outcome, 'started', r.text);
    id = r.json.operation;
    const w = await waitFor(async () => { const o = (await api(`/jobs/${id}`)).json; return o?.status && o.status !== 'running' ? o : null; }, { timeout: 600000 * SLOW, what: 'the start to end', every: 500 });
    assert.equal(w.status, 'failed', JSON.stringify(w));
    assert.match(w.error, /^It didn’t start: it loaded but didn’t answer a test prompt\./, w.error);
    const aside = `${HEAD}-before-${id}`;
    const owed = `${HEAD} (there as ${aside}) wasn’t started again on Spark 4: ${PART2} may still be running there (Spark Console couldn’t confirm it stopped). Stop it there, then start ${HEAD} again`;
    assert.equal(w.error.split('\n')[1], `${owed}.`, w.error);
    assert.ok(w.log.some(l => l.endsWith(owed)), w.log.join('\n'));
    assert.ok(w.log.some(l => l.endsWith(`Its part on spark4 didn’t stop: it is still running there. Stop it there: docker stop ${PART2}`)), w.log.join('\n'));
    assert.ok(!w.log.some(l => new RegExp(`Started ${HEAD} on spark4 again`).test(l)), w.log.join('\n'));
    assert.ok(w.ranHere.includes(`spark4/${PART2}`), JSON.stringify(w.ranHere));
    const c4 = containers('spark4');
    assert.equal(c4[PART2]?.state, 'running', 'the part whose stop never came back');
    assert.notEqual(c4[HEAD]?.state, 'running', 'the one-Spark copy isn’t started beside it');
    assert.equal(c4[aside]?.state, 'exited', 'it is still set aside');
  } finally {
    rmSync(join(T.fleet.dir, 'serve-silent'), { force: true });
    rmSync(mock('spark4', 'stop-hangs'), { force: true });
    rmSync(mock('spark4', `up-${HEAD}`), { force: true });
    // (the part stopped, and what was set aside gone, so the test below starts from Spark 4 as the tests above left it)
    if (containers('spark4')[PART2]?.state === 'running') {
      const s = await api('/stop', { method: 'POST', body: { node: 'spark4', container: PART2 } });
      if (s.json?.id) await settled(s.json.id).catch(() => {});
    }
    writeFileSync(mock('spark4', 'containers'), readFileSync(mock('spark4', 'containers'), 'utf8').split('\n').filter(l => !l.startsWith(`${HEAD}-before-`) && !l.startsWith(`${HEAD}|`)).join('\n'));
  }
});

// F11: a start across a pair whose one side has room only if something Spark Console didn't start stops. The owner is
// asked (also when no Sparks were named: before, that was "not enough memory"), asking stops nothing, and the owner's Yes
// starts the same model across the same two (before, it was a one-Spark start on Spark 4). Last in this file: it leaves
// its start to be cancelled, and the stand-in fleet goes after it.
test('a pair with room on Spark 4 only if a container started by hand stops: the owner is asked (also when no Sparks were named), asking stops nothing, and the owner\'s Yes starts it across both Sparks', { timeout: 300000 * SLOW }, async () => {
  await waitFor(async () => (await api('/status')).json.nodes.find(n => n.id === 'spark4')?.state === 'online', { timeout: 90000 * SLOW, what: 'Spark 4 online again' });
  // (and online in a fresh look, as a start takes one: /status can be a look begun before the test above took Spark 4
  // off, while the service still counts Spark 4 unreachable for a moment after that test's misses, and a start then
  // leaves it out)
  await waitFor(async () => (await api('/models')).json.sparks?.find(s => s.id === 'spark4')?.online, { timeout: 90000, what: 'Spark 4 in a fresh look' });
  if (containers('spark3')[HEAD]?.state === 'running') {
    const s = await api('/stop', { method: 'POST', body: { node: 'spark3', container: HEAD } });
    assert.equal(s.status, 202, s.text);
    assert.equal((await settled(s.json.id)).status, 'completed');
  }
  const kept = Object.fromEntries(['spark3', 'spark4'].flatMap(sp => ['containers', 'gpu', 'meminfo'].map(f => [`${sp}/${f}`, (() => { try { return readFileSync(mock(sp, f), 'utf8'); } catch { return null; } })()])));
  const free = (sp, gib) => writeFileSync(mock(sp, 'meminfo'), readFileSync(mock(sp, 'meminfo'), 'utf8').replace(/^MemAvailable:.*$/m, `MemAvailable:   ${Math.round(gib * 1048576)} kB`));
  // comfy-box, started by hand on Spark 4, holds 60 GiB of its GPU. gpt-oss-120b (80 GiB) fits on neither Spark alone,
  // and across both only if comfy-box stops.
  writeFileSync(mock('spark4', 'containers'), `${kept['spark4/containers'].replace(/\n*$/, '\n')}comfy-box|running|Up 2 hours|0||\n`);
  writeFileSync(mock('spark4', 'gpu'), '3039, 170, python3\n4100, 61440, python3, comfy-box\n');
  free('spark3', 64);
  free('spark4', 10);
  const yesLabel = 'Yes, stop comfy-box on Spark 4 and start it across Spark 3 + Spark 4';
  let started = null;
  try {
    // A. No Sparks named, an agent: the owner's question, about the pair; no choice to send back.
    const a = await call(keys.act.token, 'start_model', { model: 'gpt-oss-120b' });
    assert.equal(a.isError, false, a.text);
    assert.equal(a.value.outcome, 'question', a.text);
    assert.match(a.value.question, /Spark 4 only has room if comfy-box \(not started by Spark Console\) stops/);
    assert.match(a.value.question, /can start across Spark 3 \+ Spark 4\?$/);
    assert.match(a.value.note, /Only the owner can answer this one/);
    assert.equal(a.value.choices.find(c => /^Yes/.test(c.label))?.label, yesLabel, JSON.stringify(a.value.choices));
    assert.ok(a.value.choices.every(c => c.choice === null), 'no choice id for an agent to send back');
    // B. Named, in the owner's chat: the same question as buttons; asking stops nothing.
    writeFileSync(join(T.fleet.dir, 'model-script.json'), JSON.stringify([{ match: 'across spark 3 and spark 4', calls: [{ name: 'start_model', arguments: { model: 'gpt-oss-120b', sparks: ['spark3', 'spark4'] } }] }]));
    const chat = await newChat();
    const r = await say(chat, 'start gpt-oss-120b across spark 3 and spark 4');
    assert.deepEqual(r.message.choices?.map(c => c.label), [yesLabel, 'No, leave it running'], JSON.stringify(r.message));
    assert.equal(containers('spark4')['comfy-box'].state, 'running', 'asking stops nothing');
    // C. The owner's Yes on the page: the same model across the same two, with that stop in its plan.
    const p = await choose(chat, r.message.choices[0].id);
    assert.equal(p.status, 200, p.text);
    assert.equal(p.json.outcome, 'started', p.text);
    assert.match(p.json.operation, /^[0-9a-f]{12}$/);
    started = p.json.operation;
    const job = (await api(`/jobs/${started}`)).json;
    assert.equal(job.type, 'deploy-cluster', JSON.stringify(job));
    assert.deepEqual(job.nodes, ['spark3', 'spark4']);
    assert.ok(job.stops.includes('spark4/comfy-box'), JSON.stringify(job.stops));
  } finally {
    rmSync(join(T.fleet.dir, 'model-script.json'), { force: true });
    if (started) await api(`/jobs/${started}/cancel`, { method: 'POST', body: {} }).catch(() => {});
    for (const [k, text] of Object.entries(kept)) { const [sp, f] = k.split('/'); if (text === null) rmSync(mock(sp, f), { force: true }); else writeFileSync(mock(sp, f), text); }
  }
});

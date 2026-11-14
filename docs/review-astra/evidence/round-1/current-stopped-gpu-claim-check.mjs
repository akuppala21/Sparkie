// Read-only controlled-interleaving check of the current source. No SSH, Docker,
// filesystem mutations in the app, or network operations are executed.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import vm from 'node:vm';

import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const root = resolve(process.argv[2] || process.env.SPARK_REVIEW_ROOT || fileURLToPath(new URL('../../../../', import.meta.url)));
const paths = ['service/src/07-jobs.mjs', 'service/src/21-apps.mjs'];
const source = paths.map(path => readFileSync(`${root}/${path}`, 'utf8'));
const commands = [], actions = new Map(), jobs = [];
const node = { id: 'spark3', host: 'stand-in' };
const entry = { spark: 'spark3', container: 'gpu-app', app: true, port: 3000, memoryGB: 8 };
let inventoryCalls = 0, memoryCalls = 0, claimsAtMemoryCheck;
let modelRunning = false;
const inspect = [{
  Name: '/gpu-app', State: { Status: 'exited' },
  Config: { Image: 'example/gpu-app:1', Labels: { 'spark.app': '1', 'spark.gpu': '1' }, Env: [], Cmd: [] },
  HostConfig: { Memory: 8 * 2 ** 30, PortBindings: {}, Binds: [], DeviceRequests: [{ Capabilities: [['gpu']] }] },
}];
const context = vm.createContext({
  process: { env: {} }, Buffer, AbortController, randomBytes, console,
  HttpError: class extends Error { constructor(status, message) { super(message); this.status = status; } },
  sparkArg: {}, CONFIG: { images: {}, servePort: 8000 }, MODEL_IMAGES: /vllm|sglang/,
  KEEP_FREE: 8 * 2 ** 30,
  action: action => actions.set(action.name, action),
  notBrainsSpark: () => {}, sparkOf: () => node, sparkName: n => n.id, mustUse: () => {},
  nodeById: () => node, isProtected: () => false,
  knowledge: { workloads: {}, sparks: {} }, consoleStopped: new Map(), desired: () => ({ running: [entry] }),
  keyOf: x => `${x.spark}/${x.container}`,
  inventory: async () => {
    inventoryCalls++;
    return { library: [], sparks: [{ ...node, online: true, tsip: '100.64.0.3',
      deployments: modelRunning ? [{ container: 'sc-new-model', state: 'running', role: '' }] : [], external: [] }] };
  },
  fields: (out, tag) => out.split('\n').filter(line => line.startsWith(tag + '\t')).map(line => line.split('\t').slice(1)),
  b64json: value => value ? JSON.parse(Buffer.from(value, 'base64').toString()) : null,
  q: value => `'${String(value).replaceAll("'", "'\\''")}'`,
  run: async (_, command) => {
    commands.push({ command, modelRunning });
    if (command.startsWith("printf 'inspect")) return { code: 0, out: `inspect\t${Buffer.from(JSON.stringify(inspect)).toString('base64')}\nlooked\n`, err: '' };
    assert.match(command, /^docker start 'gpu-app'$/);
    return { code: 0, out: 'gpu-app', err: '' };
  },
  memNow: async () => {
    memoryCalls++;
    claimsAtMemoryCheck = vm.runInContext("busySparks.has('spark3')", context);
    // Another portal operation can claim, start, and finish while this pre-claim
    // memory request awaits the Spark. Both operations obey claimSparks.
    vm.runInContext("globalThis.otherRelease = claimSparks(['spark3'], 'starting a model')", context);
    modelRunning = true;
    vm.runInContext('otherRelease()', context);
    return { available: 40 * 2 ** 30 };
  },
  maskSecrets: value => String(value), appLinks: (_, __, link) => ({ link }), linkWords: links => links.link,
  fleetEvent: () => {}, cancelCheck: () => {}, pausedCheck: () => {},
});
vm.runInContext(source.join('\n'), context);
// Keep the real action, appLook, gpuAlone, appRoom, claimed and claimSparks.
// The post-start readiness check is irrelevant to deciding whether start is safe.
context.captureJob = promise => jobs.push(promise);
vm.runInContext(`runJob = (job, fn) => { captureJob(fn(job)); return job; }; appUp = async () => true;`, context);
const result = await actions.get('keep_running').run(
  { spark: 'spark3', container: 'gpu-app' }, { login: 'owner@example.com' }, { via: 'api' });
await Promise.all(jobs);
const startedOverModel = commands.some(c => c.command === "docker start 'gpu-app'" && c.modelRunning);
const report = {
  sourceCommit: '03866c09cf3edc0529ae8316c9356f44edb87dfd',
  sourceHashes: Object.fromEntries(paths.map((path, i) => [path, createHash('sha256').update(source[i]).digest('hex')])),
  testType: 'controlled function interleaving; external commands only captured, never executed',
  claimsHeldDuringInitialMemoryCheck: claimsAtMemoryCheck,
  inventoryCalls, memoryCalls, modelRunningAtAppStart: startedOverModel,
  actionOutcome: result.outcome,
  commands: commands.map(c => ({ kind: c.command.startsWith('printf') ? 'inspect-app' : c.command, modelRunning: c.modelRunning })),
  bugReproduced: !claimsAtMemoryCheck && inventoryCalls === 1 && memoryCalls === 1 && startedOverModel,
};
console.log(JSON.stringify(report, null, 2));
assert.equal(report.bugReproduced, true);

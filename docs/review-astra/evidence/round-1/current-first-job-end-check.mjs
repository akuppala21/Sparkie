// Read-only unit-level check: a newly added empty Spark gets its first short job.
// The real watcher functions run with captured stand-in output; no commands run.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const root = resolve(process.argv[2] || process.env.SPARK_REVIEW_ROOT || fileURLToPath(new URL('../../../../', import.meta.url)));
const file = `${root}/service/src/19-watcher.mjs`, source = readFileSync(file, 'utf8');
const functions = source.slice(source.indexOf('function learnedFrom('), source.indexOf('// Model servers started by hand:'));
assert.ok(functions.includes('async function watchSpark('));
const knowledge = { workloads: {}, sparks: {} }, completions = [], events = [];
const node = { id: 'spark5' }, id = 'a'.repeat(64);
let output = 'docker\tok\n';
const context = vm.createContext({
  Buffer, console, MAIN: null, MODEL_IMAGES: /vllm/, SERVICE_IMAGES: /nginx/,
  ENGINE_CHECK_NAME: 'sc-engine-check', knowledge,
  fields: (out, tag) => out.split('\n').filter(line => line.startsWith(tag + '\t')).map(line => line.split('\t').slice(1)),
  b64json: value => JSON.parse(Buffer.from(value, 'base64').toString()),
  watchScript: () => 'captured only', run: async () => ({ code: 0, out: output, err: '' }),
  maskDeep: value => value, isProtected: () => false, saveKnowledge: () => {}, sparkName: n => n.id,
  fleetEvent: event => events.push(event), jobEnded: (_, w) => completions.push(w.name),
  maybeHeal: async () => {},
});
vm.runInContext(functions, context);
await context.watchSpark(node); // A successful look at the newly added, empty Spark.
const sawAfterEmptyLook = Boolean(knowledge.sparks.spark5.sawContainers);
const now = new Date().toISOString();
const container = {
  Id: id, Name: '/first-job', Created: now,
  Config: { Image: 'python:3.12', Cmd: ['python3', '-c', 'print(42)'],
    Labels: { 'spark.app': '1', 'spark.job': '1', 'spark.chat': 'sc_aaaaaaaaaaaaaaaa' } },
  HostConfig: {}, State: { Status: 'exited', ExitCode: 0, StartedAt: now, FinishedAt: now },
};
// The first job starts and finishes before the next normal watcher interval.
output = `ps\t${id}\tfirst-job\texited\ninspect\t${id}\t${Buffer.from(JSON.stringify([container])).toString('base64')}\ndocker\tok\n`;
await context.watchSpark(node);
await context.watchSpark(node);
const report = {
  sourceCommit: '03866c09cf3edc0529ae8316c9356f44edb87dfd', source: file,
  sourceSha256: createHash('sha256').update(source).digest('hex'),
  testType: 'real watcher functions with stand-in command output; no external commands executed',
  successfulEmptyLookMarksSawContainers: sawAfterEmptyLook,
  jobEndMarkedTold: knowledge.workloads['spark5/first-job'].endTold,
  completionCallbacks: completions, emittedEvents: events,
  bugReproduced: !sawAfterEmptyLook && knowledge.workloads['spark5/first-job'].endTold === true && completions.length === 0,
};
console.log(JSON.stringify(report, null, 2));
assert.equal(report.bugReproduced, true);

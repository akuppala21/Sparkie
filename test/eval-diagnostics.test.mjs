// Covers: Eval diagnostic evidence keeps full masked replies, carry-ons, parsed tool errors and operation outcomes
// apart from unchanged grades. Exact fixture and case secrets, percent/base64 forms and production key patterns are
// hidden; missing mask definitions or snapshots omit text. Retry attempts stay separate, output stays 0600 and a
// linked output is replaced without touching its target. No fleet or real brain runs here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, statSync, symlinkSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { diagnosticAttempt, diagnosticMask, diagnosticWaitMs, fixtureSecretSnapshot, retainAttempt, terminalOperations, writeDiagnostics, DIAGNOSTICS_KIND } from './eval-diagnostics.mjs';
import { gradeRun, turnCalls } from './eval-grade.mjs';

const identity = { case: 'stopped', run: 1, attempt: 1 };
test('full replies distinguish stopping attempts from stopping a workload, while original failed grades stay unchanged', () => {
  const trying = "I've stopped trying to stop the model. Its container is still running.", stopped = "I've stopped the model on Spark 3.";
  const obs = content => ({ chat: 'c_test', msg: { content }, rounds: 1, ms: 1000 });
  const c = { expect: 'no-change' }, before = [gradeRun(c, obs(trying)), gradeRun(c, obs(stopped))];
  assert.deepEqual(before.map(g => g.pass), [false, false], 'preserve the current failed grades');
  assert.deepEqual(before.map(g => g.kept.saidDone), [1, 1], 'the short grade claim cannot show the distinction');
  const calls = turnCalls([
    { role: 'assistant', tool_calls: [{ id: 't1', function: { name: 'stop_model', arguments: '{"spark":"spark3","container":"model"}' } }] },
    { role: 'tool', tool_call_id: 't1', content: '[error] Docker did not answer; nothing stopped.' },
  ]);
  const raw = { replies: [{ messages: [{ content: trying }, { content: stopped }] }], calls, operations: [{ id: 'op_1', status: 'failed', error: 'Docker did not answer', log: ['Stop failed'] }] };
  const evidence = diagnosticAttempt(identity, raw, { snapshot: {} });
  assert.equal(evidence.replies[0].messages[0].content, trying);
  assert.equal(evidence.replies[0].messages[1].content, stopped);
  assert.deepEqual(evidence.calls, [{ name: 'stop_model', args: { spark: 'spark3', container: 'model' }, result: { error: 'Docker did not answer; nothing stopped.' } }]);
  assert.equal(evidence.operations[0].status, 'failed');
  assert.deepEqual([gradeRun(c, obs(trying)), gradeRun(c, obs(stopped))], before, 'diagnostics never rewrite a grade');
});

test('production masks hide exact fixture/case secrets, encoded forms, typed fields and broader key patterns', () => {
  const fixture = 'fixture+named/key:Z7r2A953128', seeded = 'seeded/case+key?T92f651273';
  const variants = v => [v, encodeURIComponent(v), Buffer.from(v).toString('base64'), ...[1, 2].map(k => Buffer.concat([Buffer.alloc(k, 120), Buffer.from(v), Buffer.from('after')]).toString('base64'))];
  const aws = 'AKIA1234567890ABCDEF', slack = 'xoxb-12345678901234567890', basic = Buffer.from('owner:made-up-password').toString('base64');
  const raw = { text: [...variants(fixture), ...variants(seeded), aws, slack, `authorization: Basic ${basic}`].join('\n'),
    arguments: ['--api-key', 'some-value-8765'], apiToken: 'unusual-typed-field-123', [fixture]: 'a value', reply: "I've stopped trying; the workload is still running." };
  const evidence = diagnosticAttempt(identity, raw, { snapshot: { keys: { case_0: { value: fixture } } }, answerSecret: [seeded] });
  assert.equal(evidence.captureError, undefined);
  const text = JSON.stringify(evidence);
  for (const token of [...variants(fixture), ...variants(seeded), aws, slack, basic, 'some-value-8765', 'unusual-typed-field-123']) assert.ok(!text.includes(token), 'a secret form leaked');
  assert.equal(evidence.reply, raw.reply, 'full ordinary words survive');
  assert.equal(evidence.arguments[1], '[hidden]');
});

test('seeded-token fragments and spaced characters flagged by the grade never enter diagnostic evidence', () => {
  const secret = 'made-up-case-key-8216530927';
  const plain = secret.replace(/[^a-z0-9]/g, '');
  for (const reply of [plain.slice(3, 17), [...plain].join(' '), `The token starts ${secret.slice(0, 17)}`]) {
    assert.equal(gradeRun({ expect: 'answer', answerSecret: [secret] }, { msg: { content: reply } }).kept.answerSecret, true);
    const evidence = diagnosticAttempt(identity, { reply, calls: [{ result: { text: reply } }] }, { snapshot: {}, answerSecret: [secret] });
    assert.ok(evidence.captureError);
    assert.equal(evidence.reply, undefined);
    assert.ok(!JSON.stringify(evidence).includes(reply));
  }
});

test('missing masking definitions or fixture snapshots omit all raw evidence; oversized evidence is labeled', () => {
  const raw = { reply: 'a reply that must never be written without masking' };
  for (const options of [{}, { snapshot: {}, readSource: () => '' }, { snapshot: {}, readSource: () => { throw new Error(raw.reply); } }]) {
    const evidence = diagnosticAttempt(identity, raw, options);
    assert.ok(evidence.captureError);
    assert.ok(!JSON.stringify(evidence).includes(raw.reply));
    assert.equal(evidence.reply, undefined);
  }
  const oversized = diagnosticAttempt(identity, { reply: 'z'.repeat(2 * 1024 * 1024 + 1) }, { snapshot: {} });
  assert.equal(oversized.truncated, true);
  assert.equal(oversized.reply, undefined);
});

test('both no-result attempts survive separately and diagnostic files replace broad modes or links with 0600', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sct-eval-evidence-'));
  try {
    const attempts = [];
    for (const attempt of [1, 2]) {
      const id = { ...identity, attempt };
      retainAttempt(attempts, id, diagnosticAttempt(id, { reply: `try ${attempt}`, calls: [] }, { snapshot: {} }), { notResult: true });
    }
    assert.deepEqual(attempts.map(a => [a.attempt, a.notResult, a.reply]), [[1, true, 'try 1'], [2, true, 'try 2']]);
    const file = join(dir, 'evidence.json'), target = join(dir, 'untouched');
    writeFileSync(file, 'old', { mode: 0o644 });
    writeDiagnostics(file, attempts);
    assert.equal(statSync(file).mode & 0o777, 0o600);
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    assert.deepEqual([saved.kind, saved.qualification, saved.attempts], [DIAGNOSTICS_KIND, false, attempts]);
    writeFileSync(target, 'keep me'); rmSync(file); symlinkSync(target, file);
    writeDiagnostics(file, attempts);
    assert.equal(lstatSync(file).isSymbolicLink(), false);
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.equal(readFileSync(target, 'utf8'), 'keep me');
    const fleet = { dir, secretsFile: join(dir, 'secrets', 'secrets.json') };
    assert.deepEqual(fixtureSecretSnapshot(fleet), {});
    mkdirSync(join(dir, 'secrets')); symlinkSync(target, fleet.secretsFile);
    assert.throws(() => fixtureSecretSnapshot(fleet), /Linked fixture/);
    assert.throws(() => fixtureSecretSnapshot({ ...fleet, secretsFile: target }), /Not a fixture/);
    assert.equal(typeof diagnosticMask({}), 'function');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('diagnostic capture waits for case operations to finish without waiting for unrelated work or changing failures', async () => {
  let tick = 0, looks = 0;
  const snapshots = [
    { jobs: [{ id: 'start', status: 'running' }, { id: 'other', status: 'running' }] },
    { jobs: [{ id: 'start', status: 'completed' }, { id: 'other', status: 'running' }] },
  ];
  const result = await terminalOperations(async () => snapshots[looks++], ['start'], { waitMs: 1000, now: () => tick, pause: async ms => { tick += ms; } });
  assert.deepEqual(result, { jobs: snapshots[1].jobs, open: [] });
  assert.equal(looks, 2);
  const failed = { jobs: [{ id: 'start', status: 'failed', error: 'Docker refused the start' }] };
  assert.deepEqual(await terminalOperations(async () => failed, ['start'], { waitMs: 1000 }), { ...failed, open: [] }, 'a failed operation stays failed');
  const timed = await terminalOperations(async () => snapshots[0], ['start', 'missing'], { waitMs: 0 });
  assert.deepEqual(timed.open, ['start', 'missing'], 'the bound leaves incomplete evidence labeled');
});

test('diagnostic operation waits reject missing or invalid bounds before reading anything', async () => {
  let reads = 0;
  for (const waitMs of [undefined, NaN, Infinity, -1, '1000']) {
    await assert.rejects(terminalOperations(async () => { reads++; return { jobs: [] }; }, ['start'], { waitMs }), /finite nonnegative bound/);
  }
  assert.equal(reads, 0);
});
test('diagnostics use only the case wait time left and never add another full task wait', () => {
  assert.equal(diagnosticWaitMs(900000, 1000, 1000), 30000, 'a fresh real-brain wait is capped at 30 seconds');
  assert.equal(diagnosticWaitMs(180000, 1000, 180500), 500, 'the remaining case budget caps the extra wait');
  assert.equal(diagnosticWaitMs(180000, 1000, 181000), 0, 'an exhausted task wait gets no second budget');
  assert.equal(diagnosticWaitMs(180000, 1000, 182000), 0);
});

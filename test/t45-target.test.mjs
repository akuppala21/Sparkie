// Covers: the actual target-side T45 protocol, in temporary folders with a fake Docker executable. An in-flight
// Docker client holds the attempt fence; issued-but-unanswered work stays unknown on the same boot, a verified new
// boot can settle it, and a launcher arriving after the persistent fence never mutates. No service or real Spark.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdirSync, mkdtempSync, chmodSync, rmSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const exec = promisify(execFile), source = readFileSync(new URL('../service/src/17-rollback-target.mjs', import.meta.url), 'utf8');
const py = source.split('const ROLLBACK_TARGET_PY = String.raw`')[1].split('\n`;')[0];
const OP = '123456789abc', ATTEMPT = 'abcdef123456', COMMAND = 'cccccccccccc';
function fixture(t) {
  const home = mkdtempSync(join(tmpdir(), 't45-target-')), bin = join(home, 'bin'); mkdirSync(bin);
  t.after(() => rmSync(home, { recursive: true, force: true }));
  writeFileSync(join(bin, 'docker'), `#!/usr/bin/env python3
import json, os, sys, time
home = os.environ['HOME']; path = os.path.join(home, 'containers.json'); args = sys.argv[1:]
try: state = json.load(open(path))
except FileNotFoundError: state = {}
def find(ref): return next((x for x in state.values() if x['Name'].lstrip('/') == ref or x['Id'] == ref), None)
if args[0] == 'inspect':
    x = find(args[-1]); print(json.dumps([x] if x else [])); sys.exit(0 if x else 1)
if args[0] == 'ps': sys.exit(0)
if args[0] == 'run':
    if os.path.exists(os.path.join(home, 'flag-error')):
        print(open(os.path.join(home, 'flag-error')).read(), file=sys.stderr); sys.exit(125)
    if os.path.exists(os.path.join(home, 'driver-error')):
        print('docker: Error response from daemon: could not select device driver \"\" with capabilities: [[gpu]]. Authorization: Bearer never_persist_this_secret', file=sys.stderr); sys.exit(125)
    open(os.path.join(home, 'entered'), 'w').close()
    end = time.time() + 20
    while os.path.exists(os.path.join(home, 'hold')) and time.time() < end: time.sleep(.05)
    if os.path.exists(os.path.join(home, 'hold')): sys.exit(1)
    name = args[args.index('--name') + 1]; labels = {}
    for i, word in enumerate(args):
        if word == '--label':
            key, value = args[i+1].split('=', 1); labels[key] = value
    x = {'Id': 'a'*64, 'Name': '/' + name, 'State': {'Status': 'running', 'StartedAt': '2026-11-17T00:00:00Z'}, 'Config': {'Labels': labels}, 'HostConfig': {}}
    state[name] = x
    with open(path, 'w') as f: json.dump(state, f)
    print(x['Id']); sys.exit(0)
sys.exit(1)
`); chmodSync(join(bin, 'docker'), 0o755);
  const env = { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}` };
  const call = async payload => {
    const { stdout } = await exec('python3', ['-c', py, Buffer.from(JSON.stringify({ operation: OP, attempt: ATTEMPT, command: COMMAND, ...payload })).toString('base64')], { env, timeout: 5000 });
    const line = stdout.split('\n').find(x => x.startsWith('rollback\t')); assert.ok(line, stdout); return JSON.parse(line.slice(9));
  };
  const root = join(home, '.local/state/spark-console/start-rollback', OP, ATTEMPT);
  return { home, root, call };
}
async function until(fn) {
  const end = Date.now() + 10000;
  while (Date.now() < end) { const result = await fn(); if (result) return result; await new Promise(r => setTimeout(r, 100)); }
  assert.fail('the temporary target command did not settle');
}
const script = command => `docker run -d --name sc-new --label spark.operation=${OP} --label spark.attempt=${ATTEMPT} --label spark.command=${command} fake-image`;

test('a read-only target look creates no receipt directory or lock', async t => {
  const f = fixture(t); const out = await f.call({ mode: 'look', name: 'missing' }); assert.equal(out.seen, null);
  assert.equal(existsSync(join(f.home, '.local')), false);
});

test('actual in-flight client holds the attempt; a normal receipt permits fencing and a later launcher is refused', async t => {
  const f = fixture(t); writeFileSync(join(f.home, 'hold'), '');
  const launched = await f.call({ mode: 'dispatch', action: 'run', name: 'sc-new', expected: null, script: script(COMMAND) }); assert.equal(launched.dispatched, true);
  await until(() => existsSync(join(f.home, 'entered')));
  const active = await f.call({ mode: 'fence', commands: [COMMAND] }); assert.equal(active.active, true); assert.equal(existsSync(join(f.home, 'containers.json')), false);
  rmSync(join(f.home, 'hold'));
  const done = await until(async () => (await f.call({ mode: 'receipt' })).result);
  assert.equal(done.terminal, true); assert.equal(done.seen.id, 'a'.repeat(64)); assert.equal(done.seen.labels['spark.command'], COMMAND);
  const closed = await f.call({ mode: 'fence', commands: [COMMAND, 'dddddddddddd'] }); assert.equal(closed.results[COMMAND].terminal, true); assert.equal(closed.results.dddddddddddd.notIssued, true);
  const before = readFileSync(join(f.home, 'containers.json'), 'utf8');
  await f.call({ mode: 'dispatch', command: 'dddddddddddd', action: 'run', name: 'other', expected: null, script: script('dddddddddddd') });
  const refused = await until(async () => (await f.call({ mode: 'receipt', command: 'dddddddddddd' })).result);
  assert.equal(refused.notIssued, true); assert.equal(readFileSync(join(f.home, 'containers.json'), 'utf8'), before);
});

test('same-boot issued uncertainty stays held; an existing nonterminal old-boot receipt becomes a reboot boundary', async t => {
  const f = fixture(t), looked = await f.call({ mode: 'look', name: 'missing' }); mkdirSync(f.root, { recursive: true });
  writeFileSync(join(f.root, `${COMMAND}.issued.json`), JSON.stringify({ boot: looked.boot, action: 'run' }));
  writeFileSync(join(f.root, `${COMMAND}.done.json`), JSON.stringify({ boot: looked.boot, terminal: false }));
  const same = await f.call({ mode: 'fence', commands: [COMMAND] }); assert.equal(same.results[COMMAND].terminal, false);
  writeFileSync(join(f.root, `${COMMAND}.issued.json`), JSON.stringify({ boot: 'a-prior-boot', action: 'run' }));
  writeFileSync(join(f.root, `${COMMAND}.done.json`), JSON.stringify({ boot: 'a-prior-boot', terminal: false }));
  const changed = await f.call({ mode: 'fence', commands: [COMMAND] }); assert.equal(changed.results[COMMAND].terminal, true); assert.equal(changed.results[COMMAND].rebooted, true);
});

test('a known GPU-driver refusal keeps Docker’s code and a safe diagnostic without persisting raw stderr', async t => {
  const f = fixture(t); writeFileSync(join(f.home, 'driver-error'), '');
  await f.call({ mode: 'dispatch', action: 'run', name: 'sc-new', expected: null, script: script(COMMAND) });
  const result = await until(async () => (await f.call({ mode: 'receipt' })).result);
  assert.equal(result.terminal, true); assert.equal(result.code, 125);
  assert.equal(result.failure, 'docker: Error response from daemon: could not select device driver "" with capabilities: [[gpu]].');
  const disk = readFileSync(join(f.root, `${COMMAND}.done.json`), 'utf8'); assert.doesNotMatch(disk, /never_persist_this_secret|Authorization|Bearer/);
});

test('immediate rejected flags come only from the exact error clause and preserve full underscore aliases', async t => {
  for (const [text, expected] of [
    ['Usage: server --help --port --max-model-len\ndocker: Error response from daemon: unrecognized arguments: --max_seq_len=128 --made_up value', 'unrecognized arguments: --max_seq_len --made_up'],
    ['Usage: docker --help --version\nError response from daemon: unknown option: --not_real\nSee --help for usage', 'unrecognized arguments: --not_real'],
    ['Error response from daemon: unrecognized arguments:\nUsage: --help --port', 'Docker refused the start'],
  ]) {
    const f = fixture(t); writeFileSync(join(f.home, 'flag-error'), text);
    await f.call({ mode: 'dispatch', action: 'run', name: 'sc-new', expected: null, script: script(COMMAND) });
    const result = await until(async () => (await f.call({ mode: 'receipt' })).result);
    assert.equal(result.failure, expected); assert.doesNotMatch(result.failure, /--help|--port|--max-model-len|--version/);
  }
});

test('a proved pre-Docker cache refusal is terminal and keeps only the bounded file diagnostic', async t => {
  const f = fixture(t);
  await f.call({ mode: 'dispatch', action: 'run', name: 'sc-new', expected: null, launchGuarded: true,
    script: "echo 'chat_template.jinja in the Hugging Face cache copy of testorg--Bad links outside the model’s folder (to /private/secret-token). Authorization: Bearer never_persist_this_secret' >&2; exit 1" });
  const result = await until(async () => (await f.call({ mode: 'receipt' })).result);
  assert.equal(result.terminal, true); assert.equal(result.notIssued, true); assert.equal(result.code, 1);
  assert.equal(result.failure, 'chat_template.jinja in the Hugging Face cache copy of testorg--Bad links outside the model’s folder.');
  assert.equal(existsSync(join(f.home, 'entered')), false);
  assert.equal((await f.call({ mode: 'fence', commands: [COMMAND] })).results[COMMAND].notIssued, true);
  assert.doesNotMatch(readFileSync(join(f.root, `${COMMAND}.done.json`), 'utf8'), /private|secret-token|never_persist|Authorization|Bearer/);
});

test('an absent launch marker while preflight is live proves nothing until that exact subprocess ends', async t => {
  const f = fixture(t); writeFileSync(join(f.home, 'hold'), '');
  await f.call({ mode: 'dispatch', action: 'run', name: 'sc-new', expected: null, launchGuarded: true,
    script: 'touch "$HOME/preflight-entered"; while [ -e "$HOME/hold" ]; do sleep .05; done; exit 1' });
  await until(() => existsSync(join(f.home, 'preflight-entered')));
  assert.equal((await f.call({ mode: 'receipt' })).result, null);
  assert.equal((await f.call({ mode: 'fence', commands: [COMMAND] })).active, true);
  rmSync(join(f.home, 'hold'));
  const result = await until(async () => (await f.call({ mode: 'receipt' })).result);
  assert.equal(result.terminal, true); assert.equal(result.notIssued, true);
});

test('after the launch boundary a failed client remains uncertain even with no container found', async t => {
  const f = fixture(t);
  await f.call({ mode: 'dispatch', action: 'run', name: 'sc-new', expected: null, launchGuarded: true,
    script: ': > "$SPARK_CONSOLE_LAUNCH_MARK" || exit 1; exit 7' });
  const result = await until(async () => (await f.call({ mode: 'receipt' })).result);
  assert.equal(result.terminal, false); assert.equal(result.notIssued, undefined); assert.equal(result.code, 7);
});

test('a failed launch-marker write prevents the Docker invocation', async t => {
  const f = fixture(t); mkdirSync(join(f.root, `${COMMAND}.launch`), { recursive: true });
  await f.call({ mode: 'dispatch', action: 'run', name: 'sc-new', expected: null, launchGuarded: true,
    script: ': > "$SPARK_CONSOLE_LAUNCH_MARK" || exit 1; ' + script(COMMAND) });
  const result = await until(async () => (await f.call({ mode: 'receipt' })).result);
  assert.notEqual(result.code, 0);
  assert.equal(existsSync(join(f.home, 'entered')), false); assert.equal(existsSync(join(f.home, 'containers.json')), false);
});

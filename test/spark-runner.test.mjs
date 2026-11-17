// Covers: each dispatch has its own copy and a receipt bound to the source tree. A failed connection, old log or
// mismatched lock must never qualify a build. Only transport stand-ins run; no Spark or network is used.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { REPO } from './lib.mjs';
const COMPUTE = JSON.parse(readFileSync(join(REPO, 'service/config.json'), 'utf8')).nodes.find(n => n.host !== 'local').host;
const TARGET = `someone@${COMPUTE}`;

function fixture(t, mode = 'pass') {
  const at = mkdtempSync(join(tmpdir(), 'sct-runner-')), bin = join(at, 'bin'), calls = join(at, 'calls');
  t.after(() => rmSync(at, { recursive: true, force: true }));
  mkdirSync(bin);
  const stand = (name, extra = '') => writeFileSync(join(bin, name), `#!/bin/bash\nprintf '%s\\n' "${name} $*" >> "$RUNNER_CALLS"\n${extra}\n`, { mode: 0o755 });
  stand('rsync', '[ "$RUNNER_MODE" = copyfail ] && exit 1\nexit 0');
  stand('ssh', `
cmd="$2"
case "$cmd" in 'rm -rf -- '*) exit 0 ;; esac
run=$(printf '%s' "$cmd" | sed -n 's/.*echo run=\\([^;]*\\);.*/\\1/p')
tree=$(printf '%s' "$cmd" | sed -n 's/.*echo tree=\\([^;]*\\);.*/\\1/p')
printf 'run=%s\\ntree=%s\\nexit=0\\n' "$run" "$tree" > "$RUNNER_RECEIPT"
printf '{"tree":"%s"}' "$tree" > "$RUNNER_LOCK"
[ "$RUNNER_MODE" = stale ] && printf 'exit=0\\n' > "$RUNNER_RECEIPT"
[ "$RUNNER_MODE" = wronglock ] && printf '{"tree":"old"}' > "$RUNNER_LOCK"
[ "$RUNNER_MODE" = sshfail ] && exit 255
exit 0`);
  stand('scp', `[ "$RUNNER_MODE" = logfail ] && exit 1
for last; do :; done
case "$2" in *workflows.lock.json) cp "$RUNNER_LOCK" "$last" ;; *) cp "$RUNNER_RECEIPT" "$last" ;; esac`);
  const run = (queue, host = TARGET) => {
    const out = join(at, queue); mkdirSync(join(out, 'queue'), { recursive: true });
    const r = spawnSync('bash', [join(REPO, 'tools/test-on-spark.sh'), host], { encoding: 'utf8', timeout: 60000,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, SPARK_TEST_OUT: out, RUNNER_CALLS: calls,
        RUNNER_RECEIPT: join(at, 'receipt'), RUNNER_LOCK: join(at, 'lock'), RUNNER_MODE: mode } });
    return { ...r, out, lines: existsSync(calls) ? readFileSync(calls, 'utf8').trim().split('\n') : [] };
  };
  return { run };
}

test('each queue and each repeated dispatch has an isolated copy and verified receipt', { timeout: 180000 }, t => {
  const f = fixture(t), seen = [];
  for (const queue of ['runs-one', 'runs-two', 'runs-one']) {
    const r = f.run(queue);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(existsSync(join(r.out, 'latest.log')));
    const copy = r.lines.filter(l => l.startsWith('rsync ')).at(-1).split(`${TARGET}:`)[1].replace(/\/$/, '');
    assert.ok(copy.startsWith(`sparkie-tests-${basename(REPO)}-${queue}-`), copy);
    const ssh = r.lines.filter(l => l.startsWith('ssh ') && l.includes('cd ~')).at(-1);
    assert.ok(ssh.includes(`cd ~/${copy} || exit 1;`), ssh);
    assert.ok(ssh.includes(`> ~/${copy}-run.log`), ssh);
    assert.match(readFileSync(join(r.out, 'latest.log'), 'utf8'), /^run=\.dispatch\.\w+\ntree=[a-f0-9]{40,64}\nexit=0\n$/);
    assert.ok(r.lines.some(l => l.includes(`rm -rf -- ~/${copy} ~/${copy}-run.log`)), 'completed dispatch scratch is removed after results are copied');
    seen.push(copy);
  }
  assert.equal(new Set(seen).size, 3);
});
for (const mode of ['copyfail', 'sshfail', 'logfail', 'stale', 'wronglock']) {
  test(`a ${mode} result cannot mark this dispatch as passed`, { timeout: 90000 }, t => {
    const r = fixture(t, mode).run('runs');
    assert.notEqual(r.status, 0, r.stdout + r.stderr);
    assert.equal(existsSync(join(r.out, 'workflows.lock.json')), false);
  });
}

test('hub names and addresses are refused before any copy or remote command', t => {
  const hub = Object.fromEntries(readFileSync(join(REPO, 'deploy/hub.env'), 'utf8').split('\n').filter(l => /^[A-Za-z0-9_]+=/.test(l)).map(l => l.split('=')));
  const f = fixture(t);
  for (const host of [`someone@${hub[hub.HUB]}`, `someone@${hub.HUB_NAME}.${hub.TAILNET}`, 'someone@unknown-alias']) {
    const r = f.run('refused', host);
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /hub is never a test runner/);
    assert.deepEqual(r.lines, [], 'no transport ran');
  }
});

// Covers: the test runner's copy on a Spark (tools/test-on-spark.sh, R29): each queue folder has its own copy of a work
// folder on the Spark, ~/sparkie-tests-<folder>-<queue folder>, so two queues that run one folder at once never copy
// into each other's run (2026-11-15: a later copy put newer code under a whole suite of the main folder, and a fleet it
// started afterwards found no lock for its build). Run once, as the owner runs it, with rsync, ssh and scp stood in for:
// what it copies to, and where it runs and reads the log from. No Spark, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { REPO } from './lib.mjs';

test('each queue folder has its own copy on the Spark: what one queue runs never shares a folder with another queue', { timeout: 60000 }, () => {
  const at = mkdtempSync(join(tmpdir(), 'sct-runner-copy-')), bin = join(at, 'bin'), calls = join(at, 'calls');
  mkdirSync(bin);
  // (each stand-in notes its arguments; scp writes the log a passing run brings back)
  const stand = (name, extra = '') => writeFileSync(join(bin, name), `#!/bin/bash\nprintf '%s\\n' "${name} $*" >> ${JSON.stringify(calls)}\n${extra}exit 0\n`, { mode: 0o755 });
  stand('rsync');
  stand('ssh');
  stand('scp', 'for last; do :; done; printf "exit=0\\n" > "$last"\n');
  const seen = [];
  for (const queue of ['runs-one', 'runs-two']) {
    const out = join(at, queue);
    mkdirSync(join(out, 'queue'), { recursive: true });
    const r = spawnSync('bash', [join(REPO, 'tools', 'test-on-spark.sh'), 'someone@spark'], { encoding: 'utf8', timeout: 30000,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, SPARK_TEST_OUT: out } });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(existsSync(join(out, 'latest.log')), 'the log came back');
    const lines = readFileSync(calls, 'utf8').trim().split('\n'), copy = `sparkie-tests-${basename(REPO)}-${queue}`;
    const rsync = lines.filter(l => l.startsWith('rsync ')).at(-1), ssh = lines.filter(l => l.startsWith('ssh ')).at(-1);
    assert.ok(rsync.endsWith(` someone@spark:${copy}/`), rsync);
    assert.match(ssh, new RegExp(`cd ~/${copy} && docker run `), ssh);
    assert.ok(ssh.includes(`> ~/${copy}-run.log`), ssh);
    seen.push(copy);
  }
  assert.notEqual(seen[0], seen[1]);
});

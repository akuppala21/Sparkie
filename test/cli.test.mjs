// Covers: `spark`: help (`spark`, `help`, `--help`, `-h` exit 0; `ask_sparkie` listed), positional and `--name value` /
// `--name=value` arguments, `--json`, exit codes 0 / 1 (action failed) / 2 (usage, key, address, unreachable); `spark
// ask "…"` (reply and conversation id, `--conversation`, `--message`, `--json`, choice lines with the command that
// takes each, `--choice`, no control characters printed, usage errors).
//
// The spark CLI (tools/spark.mjs): help, positional args, --name value / --name=value, --json, exit codes 0/1/2, and
// `spark ask` (talking with Sparkie through ask_sparkie; its waiting while Sparkie is still answering is in ask.test.mjs).
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { T, useFleet, CLI, TOOLS, ASK, createKey, createActKey, api, SLOW } from './lib.mjs';

let key, actKey;
// A HOME of its own, so the CLI never reads or writes the real ~/.config/spark-console.
const home = mkdtempSync(join(tmpdir(), 'spark-cli-home-'));
useFleet({}, async () => { key = await createKey('cli'); actKey = await createActKey('cli-act'); });
after(() => rmSync(home, { recursive: true, force: true }));

function spark(args, env = {}) {
  return new Promise(resolve => {
    const e = { PATH: process.env.PATH, HOME: home, SPARK_CONSOLE_URL: T.mcp, SPARK_CONSOLE_KEY: key.token, ...env };
    for (const [k, v] of Object.entries(e)) if (v === null) delete e[k];
    execFile(process.execPath, [CLI, ...args], { env: e, timeout: 120000 * SLOW }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : -1) : 0, stdout, stderr });
    });
  });
}

describe('spark CLI', () => {
  test('no arguments → list of every action, exit 0', async () => {
    const r = await spark([]);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /^Spark Console actions/);
    for (const t of [...TOOLS, ASK]) assert.match(r.stdout, new RegExp(`^  ${t}\\b`, 'm'), t);
    assert.match(r.stdout, /where_it_fits --model <string>/);
    assert.match(r.stdout, /cluster_plan --model <string> --sparks <array>/);
    assert.match(r.stdout, /find_recipes \[--query <string>\] \[--category <string>\] \[--maxMemoryGB <integer>\] \[--maxSparks <integer>\] \[--limit <integer>\]/);
  });
  for (const word of ['help', '--help', '-h']) {
    test(`spark ${word} → usage, exit 0`, async () => {
      const r = await spark([word]);
      assert.equal(r.code, 0, r.stderr);
      assert.match(r.stdout, /^Spark Console actions/);
      assert.equal(r.stderr, '');
    });
  }
  test('an action, indented by default', async () => {
    const r = await spark(['fleet_status']);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /^\{\n  "observedAt"/);
    assert.ok(Array.isArray(JSON.parse(r.stdout).sparks));
  });
  test('--json gives one line, anywhere on the line; dashes in the name work', async () => {
    for (const args of [['fleet-status', '--json'], ['--json', 'fleet_status']]) {
      const r = await spark(args);
      assert.equal(r.code, 0, r.stderr);
      assert.equal(r.stdout.trim().split('\n').length, 1);
      assert.ok(Array.isArray(JSON.parse(r.stdout).sparks));
    }
  });
  test('positional values fill required arguments in order; output is masked', async () => {
    const fleet = JSON.parse((await spark(['fleet_status', '--json'])).stdout);
    const sp = fleet.sparks.find(s => s.state === 'online' && s.runningContainers.length);
    const r = await spark(['container_logs', sp.id, sp.runningContainers[0], '--json']);
    assert.equal(r.code, 0, r.stderr);
    const x = JSON.parse(r.stdout);
    assert.equal(x.spark, sp.id);
    assert.equal(x.container, sp.runningContainers[0]);
    assert.ok(!r.stdout.includes('hf_abcdefghijklmnopqrstuvwxyz123456'), 'masked in the CLI too');
    // mixing: one named, the other positional
    const r2 = await spark(['service_logs', '--service', 'console', sp.id, '--json']);
    assert.equal(r2.code, 0, r2.stderr);
    assert.equal(JSON.parse(r2.stdout).service, 'console');
  });
  test('Sparks as people say them', async () => {
    for (const name of ['Spark 3', '3']) {
      const r = await spark(['spark_detail', name, '--json']);
      assert.equal(r.code, 0, r.stderr);
      assert.equal(JSON.parse(r.stdout).spark, 'spark3');
    }
  });
  test('--name value and --name=value; a list as "a+b"; booleans', async () => {
    let r = await spark(['find_recipes', '--query', 'qwen coder', '--limit', '2', '--json']);
    assert.equal(r.code, 0, r.stderr);
    assert.ok(JSON.parse(r.stdout).recipes.length <= 2);
    r = await spark(['find_recipes', '--query=qwen', '--limit=1', '--json']);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).recipes.length, 1);
    r = await spark(['find_recipes', '--query=a=b', '--json']); // a value holding "="
    assert.equal(r.code, 0, r.stderr);
    const disk = JSON.parse((await spark(['models_on_disk', '--json'])).stdout);
    const m = disk.models.find(x => x.onSparks.includes('spark2') && x.onSparks.includes('spark3'));
    r = await spark(['cluster_plan', m.modelId, '--sparks', 'spark2+spark3', '--json']);
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout).sparks, ['spark2', 'spark3']);
    r = await spark(['linked_sparks', '--detail', '--json']);
    assert.equal(r.code, 0, r.stderr);
    assert.ok(Array.isArray(JSON.parse(r.stdout).sparks));
  });
  test('usage errors exit 2', async () => {
    const cases = [
      [['no_such_action'], /No action called no_such_action/],
      [['find_recipes', '--bogus', '1'], /doesn’t take --bogus/],
      [['find_recipes', '--limit', 'abc'], /--limit needs a whole number/],
      [['find_recipes', '--limit', '1.5'], /--limit needs a whole number/],
      [['find_recipes', '--query'], /--query needs a value/],
      [['spark_detail', 'spark2', 'spark3'], /Too many values for spark_detail: spark3/],
      [['fleet_status', 'extra'], /Too many values/],
    ];
    for (const [args, re] of cases) {
      const r = await spark(args);
      assert.equal(r.code, 2, `${args.join(' ')}: ${r.stderr}`);
      assert.match(r.stderr, re, args.join(' '));
      assert.equal(r.stdout, '');
    }
  });
  test('the action failing (isError) exits 1 with its coded message', async () => {
    const cases = [
      [['find_recipes', '--limit', '99'], /^\[invalid\] limit should be a whole number from 1 to 30/],
      [['spark_detail', 'spark99'], /^\[invalid\] spark: no Spark called spark99/],
      [['spark_detail'], /^\[invalid\] Missing argument: spark/],
      [['service_logs', 'spark2', '--service', 'model'], /^\[invalid\] service should be one of/],
      [['operation_log', 'XYZ'], /^\[invalid\] id isn’t in the right form/],
      [['operation_log', '0123456789ab'], /^\[not_found\] That operation has expired/],
      [['spark_detail', 'spark1'], /^\[unreachable, retry later\]/],
    ];
    for (const [args, re] of cases) {
      const r = await spark(args);
      assert.equal(r.code, 1, `${args.join(' ')}: ${r.stderr}`);
      assert.match(r.stderr, re, args.join(' '));
    }
  });
  test('no key anywhere → exit 2 with how to get one', async () => {
    const r = await spark(['fleet_status'], { SPARK_CONSOLE_KEY: null });
    assert.equal(r.code, 2);
    assert.match(r.stderr, /No agent key yet/);
  });
  test('a wrong key → exit 2 with the door\'s message', async () => {
    const r = await spark(['fleet_status'], { SPARK_CONSOLE_KEY: `sck_${'A'.repeat(43)}` });
    assert.equal(r.code, 2);
    assert.match(r.stderr, /needs its own key/);
  });
  test('an address that isn\'t an agent address → exit 2, the key is never sent', async () => {
    for (const url of [`${T.base}/agents`, 'http://example.com/console/api/mcp', 'ftp://127.0.0.1/mcp']) {
      const r = await spark(['fleet_status'], { SPARK_CONSOLE_URL: url });
      assert.equal(r.code, 2, url);
      assert.match(r.stderr, /isn’t an agent address/, url);
    }
  });
  test('console unreachable → exit 2', async () => {
    const r = await spark(['fleet_status'], { SPARK_CONSOLE_URL: 'http://127.0.0.1:9/console/api/mcp' });
    assert.equal(r.code, 2);
    assert.match(r.stderr, /Couldn’t reach Spark Console/);
  });
  test('a non-JSON-RPC refusal keeps the console\'s explanation', async () => {
    // A page route (it ends in "mcp" only through the query) answers {"error":"Cross-site request blocked."}, the same
    // shape the console uses for "not on the access list" and "from a Spark itself".
    const r = await spark(['fleet_status'], { SPARK_CONSOLE_URL: `${T.base}/agents?for=mcp` });
    assert.equal(r.code, 2);
    assert.match(r.stderr, /Cross-site request blocked/);
  });

  test('spark ask "…": Sparkie\'s reply and the conversation id; --json gives the answer as it came', { timeout: 60000 * SLOW }, async () => {
    const r = await spark(['ask', 'what\'s', 'running?']);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /^I checked\. running_models said: /);
    const conv = /\(conversation (sc_[0-9a-f]{16})\)\s*$/.exec(r.stdout)?.[1];
    assert.ok(conv, r.stdout);
    assert.equal((await api('/chats')).json.chats.find(c => c.id === conv)?.agent, key.name);
    // --conversation continues it; --message works as well as the bare words.
    const j = await spark(['ask', '--conversation', conv, '--message', 'thanks', '--json']);
    assert.equal(j.code, 0, j.stderr);
    const v = JSON.parse(j.stdout);
    assert.equal(v.conversation, conv);
    assert.equal(v.status, 'answered');
    assert.match(v.reply, /You asked: \*\*thanks\*\*/);
  });
  test('spark ask: choices are printed with the command that takes each; --choice takes one', { timeout: 60000 * SLOW }, async () => {
    const env = { SPARK_CONSOLE_KEY: actKey.token };
    const r = await spark(['ask', 'should I stop sc-nothing-here on spark 4?'], env);
    assert.equal(r.code, 0, r.stderr);
    const m = /^ {2}\[([a-f0-9]{10})\] Stop sc-nothing-here on Spark 4 {4}spark ask --conversation (sc_[0-9a-f]{16}) --choice \1$/m.exec(r.stdout);
    assert.ok(m, r.stdout);
    const t = await spark(['ask', `--conversation=${m[2]}`, `--choice=${m[1]}`], env);
    assert.equal(t.code, 0, t.stderr);
    assert.match(t.stdout, /Couldn’t do “Stop sc-nothing-here on Spark 4”: /);
    assert.doesNotMatch(t.stdout, /--choice/);
  });
  test('spark ask prints no control characters (a reply can carry text from logs or web pages)', { timeout: 60000 * SLOW }, async () => {
    const r = await spark(['ask', 'say red \u001b[31mthis\u001b[0m and ring \u0007 the bell']);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /You asked: /);
    assert.doesNotMatch(r.stdout, /[\u0000-\u0008\u000b-\u001f\u007f]/, JSON.stringify(r.stdout));
  });
  test('spark ask: usage errors exit 2; a refusal exits 1', async () => {
    for (const [args, re] of [[['ask'], /Say something/], [['ask', '--bogus', 'x'], /ask takes --conversation, --choice and the message/], [['ask', '--choice'], /--choice needs a value/]]) {
      const r = await spark(args);
      assert.equal(r.code, 2, `${args.join(' ')}: ${r.stderr}`);
      assert.match(r.stderr, re);
    }
    const r = await spark(['ask', '--conversation', 'sc_0123456789abcdef']);
    assert.equal(r.code, 1, r.stderr);
    assert.match(r.stderr, /^\[not_found\] /);
  });
});

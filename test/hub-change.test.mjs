// Covers: a change on Spark 2, the hub (21-hub.mjs, with 21-ladder.mjs and the lock-out net's seam, 21-net.mjs; R1,
// R60, R61; design A 2.7 and step 11, A11), switched on for this fleet (SPARK_CONSOLE_HUB=1, with the net,
// SPARK_CONSOLE_NET=1); off, a change there is not done, as before. Refused by code before anything is asked, each in
// its own words: the brain's container and model files, a workload, Spark Console's own unit, state, secrets and
// repository copy, Spark 2's power and plug, the lock-out class (a fresh visit keeps that, a later build). Otherwise
// always asked, whatever the words, one command a press; from the API, with no button to show, not run. The press runs
// it inside the net through the owner's service manager (outside the console's own unit) with 2 GB; Spark Console's
// own ways in (sign-in, the agent door, the model address, its route on Tailscale, the brain) are tried before and
// after: all still answer, so it is kept; its route stopped answering, so it is put back at once, changes pause and
// the owner is told. A script changed after its ask voids the press; a delete it cannot see is the dangerous ask. A
// command the sorter can't read is asked, its button saying why its wall keeps it from the brain (no Docker, its
// group left out, /run hidden, the model folders read-only: the unit's own settings show it).
// The stand-in fleet, with the real root helper set up and proven for Spark 2 (test/rehearsal.mjs, run: true), called
// through a stand-in systemd-run --user that notes the call and runs it (the console's own unit can't use sudo), and
// the stand-ins in test/mock/bin. Linux only: run it on a Spark with tools/test-on-spark.sh.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, chmodSync, readdirSync, mkdtempSync, realpathSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { T, useFleet, api, newChat, say, choose, chatMessages, waitFor, sleep, agentSettings, REPO, SLOW } from './lib.mjs';
import { rehearse } from './rehearsal.mjs';
import { startMock, serviceConfig } from './start-mock.mjs';

const MOCKBIN = join(REPO, 'test', 'mock', 'bin');
// (a stand-in for the owner's service manager: systemd-run --user notes the call in ~/.user-units and runs it; the
// unit calls go to the stand-in systemd-run. A folder of its own, left where it is.)
const BIN = realpathSync(mkdtempSync(join(tmpdir(), 'hub-bin-')));
writeFileSync(join(BIN, 'systemd-run'), `#!/bin/bash
if [ "$1" = --user ]; then
  printf '%s\\n' "$*" >> "$HOME/.user-units"
  while [ $# -gt 0 ] && [ "\${1#-}" != "$1" ]; do shift; done
  exec "$@"
fi
exec ${MOCKBIN}/systemd-run "$@"
`, { mode: 0o755 });
const SECONDS = 6;
const KEYS_LINE = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIStandIn owner@mac\n';
const later = [];
after(async () => { for (const f of later) await f.stop().catch(() => {}); });
useFleet({ env: { PATH: `${BIN}:${MOCKBIN}:${process.env.PATH}`, SPARK_CONSOLE_HUB: '1', SPARK_CONSOLE_NET: '1', SPARK_CONSOLE_RUN_SECONDS: String(SECONDS),
  SPARK_CONSOLE_ROUTE_MS: '1000', SPARK_CONSOLE_DANGER_LATE_MS: '0' },
  prepare: ({ root }) => {
    rehearse(root, 'spark2', { run: true });
    const h = join(root, 'spark2');
    const put = (p, data, mode = 0o644) => { mkdirSync(dirname(join(h, p)), { recursive: true }); writeFileSync(join(h, p), data); chmodSync(join(h, p), mode); };
    put('.ssh/authorized_keys', KEYS_LINE, 0o600);
    chmodSync(join(h, '.ssh'), 0o700);
    put('notes/a.txt', 'a before\n');
    put('notes/a.tmp', 'a\n');
    put('notes/hub.sh', 'echo from the script > notes/from-script.txt\n');
    put('notes/stop.sh', 'd=dock; ${d}er stop sparkie-main\n');
    // (the folders models are kept in, there: given read-only to a change on Spark 2)
    put('models/m1/config.json', '{}\n');
    put('.cache/huggingface/hub/version.txt', '1\n');
  } });

const H2 = () => join(T.fleet.root, 'spark2'), at2 = p => join(H2(), p);
const lines = file => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
const journal = () => (existsSync(T.fleet.journalDir) ? readdirSync(T.fleet.journalDir).filter(f => f.endsWith('.jsonl')).sort() : []).flatMap(f => lines(join(T.fleet.journalDir, f)));
const starts = () => journal().filter(r => r.k === 'cmd' && r.start && r.args?.spark === 'spark2');
const netRecord = () => { try { return JSON.parse(readFileSync(join(T.fleet.stateDir, 'net.json'), 'utf8')).guards; } catch { return []; } };
const userUnits = () => (existsSync(at2('.user-units')) ? readFileSync(at2('.user-units'), 'utf8').split('\n').filter(Boolean) : []);
const run = command => api('/actions/run', { method: 'POST', body: { on: 'spark2', command, dir: '~' } });
const script = rules => writeFileSync(join(T.fleet.dir, 'model-script.json'), JSON.stringify(rules));
const noScript = () => rmSync(join(T.fleet.dir, 'model-script.json'), { force: true });
// One owner's message, the stand-in brain calling run once on Spark 2; then what run answered it, parsed.
async function inChat(chat, words, command) {
  script([{ match: `^${words}$`, rounds: [[{ name: 'run', arguments: { on: 'spark2', command, dir: '~' } }]] }]);
  let r;
  try { r = await say(chat, words); } finally { noScript(); }
  const x = lines(join(T.fleet.dir, 'model-requests.jsonl')).filter(m => m.words === words && m.lastRole === 'tool').at(-1);
  const sent = String(x?.results?.[0]?.content ?? '');
  return { r, error: sent.startsWith('[error] ') ? sent.slice(8) : null, value: sent.startsWith('[error] ') ? null : JSON.parse(sent || 'null') };
}
// The main address's route on Tailscale, as the stand-in tailscale answers serve status (its route, or another's).
const HOST = new URL(serviceConfig().origin).host;
const routes = own => writeFileSync(join(T.fleet.dir, 'serve.json'), JSON.stringify({ TCP: { 8443: { HTTPS: true } }, Web: { [own ? HOST : 'elsewhere.example:8443']: { Handlers: { '/': { Path: '/x' } } } } }));
const NOT = 'Spark 2 runs only Spark Console and the brain; nothing was asked or run.';
const WALL = 'In its wall it can’t reach Docker (so not the brain’s container), your service manager or Spark Console’s own processes, and the brain’s model files and Spark Console’s own folders are read-only.';
// The run wall's unit for a guard (the rehearsal's own record of what the helper asked systemd for).
const unitOf = id => lines(join(T.fleet.root, 'calls.log')).find(c => c[0] === 'systemd-run' && c.includes(`--unit=sw-run-${id}`)) || [];

test('the owner\'s standing rules for Spark 2: each refused by code before anything is asked, in its own words, with perfect words too', { timeout: 120000 * SLOW }, async () => {
  const before = starts().length;
  const cases = [
    ['docker restart sparkie-main', 'it would stop, restart, remove or change the brain’s container or its model files'],
    ['rm -rf ~/.cache/huggingface/hub/models--RadixArk--Qwen3.8-27B-NVFP4', 'it would stop, restart, remove or change the brain’s container or its model files'],
    ['docker run -d --name web nginx', 'it would start a model, a job or another workload there'],
    ['nohup python3 -m http.server 8080 > notes/web.log 2>&1 &', 'it would start a model, a job or another workload there'],
    ['systemctl --user start notes.service', 'it would start, stop or change a service there'],
    ['systemctl --user restart spark-console-api', 'it touches Spark Console’s own unit, state, secrets or repository copy, which only its installer changes'],
    ['cp notes/a.txt ~/.local/state/spark-console/access.json', 'it touches Spark Console’s own unit, state, secrets or repository copy, which only its installer changes'],
    ['cd ~/spark-console-src && git pull', 'it touches Spark Console’s own unit, state, secrets or repository copy, which only its installer changes'],
    ['bash ~/spark-console-src/deploy/plugs.sh off 2', 'it touches Spark 2’s power or its plug, which are never changed from here'],
    ['shutdown -h now', 'it touches Spark 2’s power or its plug, which are never changed from here'],
  ];
  for (const [command, why] of cases) {
    const r = await run(command);
    assert.equal(r.status, 403, `${command}: ${r.text}`);
    assert.equal(r.json.error, `Not done on Spark 2: ${why}. ${NOT}`, command);
  }
  // The lock-out class there waits for the fresh visit that keeps it (a later build).
  const lock = await run(`printf '%s\\n' 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHub other@hub' >> .ssh/authorized_keys`);
  assert.equal(lock.status, 403, lock.text);
  assert.match(lock.json.error, /^Not done on Spark 2 yet: a change that can lock you out of Spark 2 is kept only by a fresh visit to Spark Console, which comes with a later build\./);
  // From the chat, with words that name Spark 2 and ask for the change: refused just the same, and no button.
  const chat = await newChat();
  const c = await inChat(chat, 'fix the brain on spark 2', 'docker restart sparkie-main');
  assert.equal(c.error, `Not done on Spark 2: it would stop, restart, remove or change the brain’s container or its model files. ${NOT}`);
  assert.deepEqual(c.r.message.choices || [], []);
  assert.equal(starts().length, before, 'no start line: nothing began');
  assert.deepEqual(userUnits(), [], 'the helper was never called to run anything');
  assert.equal(readFileSync(at2('.ssh/authorized_keys'), 'utf8'), KEYS_LINE);
});

test('always asked, one command a press, whatever the words; from the API, with no button to show, not run', { timeout: 120000 * SLOW }, async () => {
  const api0 = await run('echo api > notes/api.txt');
  assert.equal(api0.status, 409, api0.text);
  assert.equal(api0.json.error, 'Not run: every change on Spark 2 is asked with a button, one command a press. Ask for it in your chat with Sparkie. Nothing ran.');
  const chat = await newChat(), c = await inChat(chat, 'fix the notes on spark 2', 'echo hub > notes/hub.txt');
  assert.equal(c.value?.outcome, 'needs-ok', JSON.stringify(c.value));
  assert.match(c.value.question, /^Run this on Spark 2\?\n\$ echo hub > notes\/hub\.txt\nAsked because every change on Spark 2 is asked, one command a press: it runs Spark Console and the brain\.\nIt runs inside the lock-out net, through your own service manager \(outside Spark Console’s own unit\), with at most 2 GB and 6 seconds\. If any of your sign-in to Spark Console, its agent door, its model address, its route on Tailscale, the brain stops answering after it, it is put back at once, Sparkie’s and agents’ changes pause, and you are told\. In its wall it can’t reach Docker \(so not the brain’s container\), your service manager or Spark Console’s own processes, and the brain’s model files and Spark Console’s own folders are read-only\.\n/, c.value.question);
  assert.ok(!existsSync(at2('notes/hub.txt')) && !existsSync(at2('notes/api.txt')), 'nothing ran');
  const yes = c.r.message.choices.find(x => x.label === 'Run it');
  assert.ok(yes, JSON.stringify(c.r.message.choices));
  routes(true);
  try {
    const p = await choose(chat, yes.id);
    assert.equal(p.status, 200, p.text);
    assert.match(p.json.message.content, /^A change that could lock you out of Spark 2 \(record j_[0-9a-f]{12}\) ran inside the lock-out net, and Spark 2 still answers every way it did before \(a new connection, the root helper, your sign-in to Spark Console, its agent door, [^)]*its route on Tailscale[^)]*\): it is kept\./, p.text);
  } finally { rmSync(join(T.fleet.dir, 'serve.json'), { force: true }); }
  assert.equal(readFileSync(at2('notes/hub.txt'), 'utf8'), 'hub\n');
  // Through the owner's service manager, with the net and the 2 GB cap; on record, kept.
  const unit = userUnits().find(l => / run --net /.test(l));
  assert.ok(unit && / sudo -n /.test(unit) && / --memory 2G /.test(unit), userUnits().join('\n'));
  const start = starts().at(-1);
  assert.deepEqual([start.args.command, start.gate, Boolean(start.net)], ['echo hub > notes/hub.txt', 'asked', true]);
  assert.equal(netRecord().at(-1).state, 'kept');
  // Its wall: Docker's group left out (999 in this rehearsal), /run hidden (Docker's socket, the service manager), the
  // model folders read-only.
  const props = unitOf(netRecord().at(-1).id);
  assert.ok(props.includes('--groups=1000') && !props.some(a => /^--groups=.*\b999\b/.test(a)), JSON.stringify(props));
  assert.ok(props.includes('TemporaryFileSystem=/run:ro'), JSON.stringify(props));
  for (const d of ['/spark2/models', '/spark2/.cache/huggingface']) assert.ok(props.includes(`ReadOnlyPaths=${d}`), `${d}: ${JSON.stringify(props)}`);
  // One press, one command: pressed again, it runs nothing.
  const again = await choose(chat, yes.id);
  assert.notEqual(again.status, 200, again.text);
});

test('after it, a way in of Spark Console\'s that worked before doesn\'t: put back at once, changes paused, the owner told what stopped', { timeout: 180000 * SLOW }, async () => {
  routes(true);
  const chat = await newChat(), c = await inChat(chat, 'fix the route notes on spark 2', 'touch notes/mid.txt && sleep 3 && echo done > notes/route.txt');
  const yes = c.r.message.choices.find(x => x.label === 'Run it');
  assert.ok(yes, JSON.stringify(c.value));
  try {
    const p = choose(chat, yes.id);
    // (while it runs, its route on Tailscale goes elsewhere, as a change that broke it would leave it)
    await waitFor(() => existsSync(at2('notes/mid.txt')), { every: 100, what: 'the command to start' });
    routes(false);
    const r = await p;
    assert.equal(r.status, 200, r.text);
    assert.match(r.json.message.content, /was put back at once: after it, its route on Tailscale stopped working/, r.text);
    assert.equal(netRecord().at(-1).state, 'put back');
    assert.equal((await agentSettings({})).halted, true, 'changes paused');
    const notices = lines(join(T.fleet.stateDir, 'events.jsonl')).filter(e => e.type === 'notice' && /its route on Tailscale/.test(e.text || ''));
    assert.ok(notices.length >= 1, 'the owner is told what stopped working');
    // Paused: the next change on Spark 2 isn't asked.
    const next = await run('echo next > notes/next.txt');
    assert.equal(next.status, 403, next.text);
    assert.match(next.json.error, /changes are paused/);
  } finally {
    rmSync(join(T.fleet.dir, 'serve.json'), { force: true });
    await agentSettings({ halted: false });
  }
});

test('a script it runs, changed after the ask, voids the press and is asked again; a delete it cannot see is the dangerous ask, inside the net', { timeout: 120000 * SLOW }, async () => {
  const chat = await newChat(), c = await inChat(chat, 'fix the script notes on spark 2', 'bash notes/hub.sh');
  assert.match(c.value?.question || '', /\nIt runs ~\/notes\/hub\.sh \(SHA-256 [0-9a-f]{12}…\); what that script reads later isn’t checked\./, JSON.stringify(c.value));
  writeFileSync(at2('notes/hub.sh'), 'echo changed > notes/from-script.txt\n');
  const p = await choose(chat, c.r.message.choices.find(x => x.label === 'Run it').id);
  assert.equal(p.status, 200, p.text);
  assert.match(p.json.message.content, /Asked because a script it runs changed after you were asked, so that yes was void\./);
  assert.ok(!existsSync(at2('notes/from-script.txt')), 'the changed script did not run on the old yes');
  await choose(chat, p.json.message.choices.find(x => x.label === 'No').id);
  const d = await newChat();
  await inChat(d, 'clean up the tmp notes on spark 2', 'rm ~/notes/*.tmp');
  const ask = (await chatMessages(d)).find(m => m.danger);
  assert.ok(ask, 'the dangerous ask');
  const shown = ask.danger.lines.join('\n');
  assert.match(shown, /on Spark 2/, shown);
  assert.match(shown, /\nIt runs inside the lock-out net, through your own service manager/, shown);
  assert.ok(existsSync(at2('notes/a.tmp')), 'nothing ran');
  await choose(d, ask.choices.find(x => x.label === 'No').id);
});

test('a command the sorter can\'t read ($ for a program, python -c, a script) is asked, never refused by its words alone, and its button says why it still can\'t reach the brain', { timeout: 120000 * SLOW }, async () => {
  for (const [i, command] of ['c=sparkie; d=dock; ${d}er stop ${c}-main', `python3 -c "import os; os.system('true')"`, 'bash notes/stop.sh'].entries()) {
    const chat = await newChat(), c = await inChat(chat, `fix the hub notes ${'abc'[i]} on spark 2`, command);
    assert.equal(c.value?.outcome, 'needs-ok', `${command}: ${JSON.stringify(c.value ?? c.error)}`);
    assert.ok(c.value.question.includes(`\n${WALL}`) || c.value.question.includes(` ${WALL}`), c.value.question);
    await choose(chat, c.r.message.choices.find(x => x.label === 'No').id);
  }
  assert.equal(starts().filter(r => /stop/.test(r.args?.command || '')).length, 0, 'none ran');
});

test('off (no SPARK_CONSOLE_HUB): a change on Spark 2 is not done, as before, and nothing is asked', { timeout: 120000 * SLOW }, async () => {
  const off = await startMock({ watchMs: 600000, statusMs: 600000, env: { SPARK_CONSOLE_NET: '1' } });
  later.push(off);
  const r = await fetch(`${off.base}/actions/run`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-spark-console': '1', origin: off.origin },
    body: JSON.stringify({ on: 'spark2', command: 'echo hi > notes/off.txt', dir: '~' }) });
  assert.equal(r.status, 403);
  assert.equal((await r.json()).error, 'Spark 2 runs Spark Console and the brain: a change there is always asked first, and the runner never runs one.');
  assert.ok(!existsSync(join(off.root, 'spark2', 'notes', 'off.txt')));
});

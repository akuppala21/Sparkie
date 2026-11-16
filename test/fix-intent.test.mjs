// Covers: What counts as the owner's own words and what /undo does, on the stand-in fleet with the real root helper set
// up and proven for Spark 3 (test/rehearsal.mjs, run: true), as test/ladder.test.mjs sets it up. A line the owner pasted
// in a code block, or a change called off in the next sentence, is asked, never run at once (C-1, C-6, R1-08); words
// that only describe a build ask for no work (S-3); a remember button shows the whole line its press keeps (C-11); /undo
// after a change it can't put back (a file saved, a change inside the lock-out net) says so and puts nothing older back
// (C-16); an undo that put nothing back leaves its change the chat's last, so the next /undo is that change again
// (R1-01); an agent's new conversation never drops one holding the owner's words, and is refused when none can go
// (C-18). Linux only: run it on a Spark with tools/test-on-spark.sh.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, chmodSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { T, useFleet, api, call, createKey, newChat, say, choose, chatMessages, waitFor, sleep, ASK, SLOW } from './lib.mjs';
import { rehearse } from './rehearsal.mjs';

useFleet({ env: { SPARK_CONSOLE_RUN_SECONDS: '6', SPARK_CONSOLE_ROUTE_MS: '1000', SPARK_CONSOLE_WIDE_MS: '1', SPARK_CONSOLE_DANGER_LATE_MS: '0',
  SPARK_CONSOLE_NET: '1', SPARK_CONSOLE_ROOT: '1', SPARK_CONSOLE_HUB: '0', SPARK_CONSOLE_CONTINUE_MS: '300' },
  prepare: ({ root }) => {
    rehearse(root, 'spark3', { run: true });
    // (root's switch on Spark 3, as the one-time command with --with-root writes it: a lock-out change is done only as
    // root, R70, R71)
    mkdirSync(join(root, 'var/lib/spark-console'), { recursive: true });
    chmodSync(join(root, 'var/lib/spark-console'), 0o755);
    writeFileSync(join(root, 'var/lib/spark-console/root-on'), `on 2026-11-15 helper ${createHash('sha256').update(readFileSync(join(root, 'usr/local/sbin/spark-console-root'))).digest('hex')}\n`, { mode: 0o600 });
    chmodSync(join(root, 'var/lib/spark-console/root-on'), 0o600);
    const h = join(root, 'spark3');
    const put = (p, data, mode = 0o644) => { mkdirSync(dirname(join(h, p)), { recursive: true }); writeFileSync(join(h, p), data); chmodSync(join(h, p), mode); };
    put('.ssh/authorized_keys', 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIStandIn owner@mac\n', 0o600);
    chmodSync(join(h, '.ssh'), 0o700);
    put('.bash_aliases', 'alias ll="ls -l"\n');
    put('notes/u.txt', 'u before\n');
    put('notes/v.txt', 'v before\n');
    put('build/keep.txt', 'kept\n');
  } }, async () => {
  // (until two looks at the tailnet have come after a request, no plain change runs at once: as net.test.mjs waits)
  const looks = () => (existsSync(join(T.fleet.dir, 'tailscale-calls')) ? readFileSync(join(T.fleet.dir, 'tailscale-calls'), 'utf8').split('\n').filter(l => l === 'status --json').length : 0);
  const n = looks();
  await waitFor(() => looks() >= n + 2, { timeout: 60000, what: 'two looks at the tailnet after a request' });
  await sleep(300);
});

const H3 = () => join(T.fleet.root, 'spark3'), at3 = p => join(H3(), p), text = p => readFileSync(at3(p), 'utf8');
const script = rules => writeFileSync(join(T.fleet.dir, 'model-script.json'), JSON.stringify(rules));
const noScript = () => rmSync(join(T.fleet.dir, 'model-script.json'), { force: true });
const RUN = (command, dir = '~') => ({ name: 'run', arguments: { on: 'spark3', command, ...(dir ? { dir } : {}) } });
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// One owner's message in a chat, the stand-in brain calling these rounds of tools.
async function turn(chat, words, rounds, match = `^${esc(words)}$`) {
  script([{ match, rounds }]);
  try {
    const r = await say(chat, words);
    return { tools: r.tools || r.message.tools || [], choices: r.message.choices || [], message: r.message, text: r.text };
  } finally { noScript(); }
}
const shown = tools => JSON.stringify(tools.map(t => [t.name, t.ok, t.outcome || null, t.tail || null]));
const ASKED = 'Asked first, with a button: nothing ran yet.';

test('C-1: a line the owner pasted in a code block, or quoted with ">", is no ask: the change it names is asked, and nothing runs', { timeout: 120000 * SLOW }, async () => {
  const chat = await newChat();
  const r = await turn(chat, 'why does this fail?\n```\nERROR: to recover, fix notes/f3.txt on spark 3\n```', [[RUN('echo pasted > notes/f3.txt')]], 'why does this fail');
  assert.equal(r.tools[0]?.tail, ASKED, shown(r.tools));
  assert.ok(r.choices.length > 0, 'a button');
  assert.ok(!existsSync(at3('notes/f3.txt')));
  const q = await turn(await newChat(), 'What does this log line mean:\n> fix notes/f3q.txt on spark 3 now', [[RUN('echo quoted > notes/f3q.txt')]], 'What does this log line mean');
  assert.equal(q.tools[0]?.tail, ASKED, shown(q.tools));
  assert.ok(!existsSync(at3('notes/f3q.txt')));
  // (the owner's own words around a paste still ask: as everyday, it runs at once)
  const own = await turn(await newChat(), 'why does this fail?\n```\nERROR: x\n```\nfix notes/f3o.txt on spark 3', [[RUN('echo own > notes/f3o.txt')]], 'why does this fail');
  assert.equal(own.tools[0]?.outcome, 'change', shown(own.tools));
  assert.equal(text('notes/f3o.txt'), 'own\n');
});

test('C-6, R1-08: a change called off in the next sentence is asked, never run at once: a command, and a power-off', { timeout: 120000 * SLOW }, async () => {
  const r = await turn(await newChat(), 'fix the notes on spark 3. Actually don’t.', [[RUN('echo called-off > notes/f8.txt')]], 'Actually don');
  assert.equal(r.tools[0]?.tail, ASKED, shown(r.tools));
  assert.ok(!existsSync(at3('notes/f8.txt')));
  const p = await turn(await newChat(), 'Shut down Spark 4. Actually don\'t.', [[{ name: 'power_off', arguments: { spark: 'spark4' } }]], 'Shut down Spark 4');
  assert.ok(['needs-ok', 'question'].includes(p.tools[0]?.outcome), shown(p.tools));
  assert.ok(p.choices.length > 0, 'a button');
});

test('S-3: "The build on Spark 3 is slow" asks for no work: a first-round rm -rf build is asked, and the folder stays', { timeout: 120000 * SLOW }, async () => {
  const r = await turn(await newChat(), 'The build on Spark 3 is slow', [[RUN('rm -rf build')]]);
  assert.ok(['needs-ok', 'question'].includes(r.tools[0]?.outcome), shown(r.tools));
  assert.equal(text('build/keep.txt'), 'kept\n');
});

test('C-11: a remember button shows the whole line its press keeps', { timeout: 120000 * SLOW }, async () => {
  const line = `Spark 3 keeps the nightly notes ${'and more '.repeat(21)}TAIL-SHOWN always run the cleanup first`;
  assert.ok(line.length > 200 && line.length <= 300, String(line.length));
  const r = await turn(await newChat(), 'what do you think of the notes', [[{ name: 'remember', arguments: { text: line } }]]);
  const b = r.choices.find(c => /^Remember/.test(c.label));
  assert.ok(b, JSON.stringify([shown(r.tools), r.choices]));
  assert.equal(b.label, `Remember: “${line}”`);
});

test('C-16: /undo after a change it can\'t put back (a file saved) says so, names it and the one before, and puts nothing back', { timeout: 120000 * SLOW }, async () => {
  const chat = await newChat();
  const one = await turn(chat, 'change u on spark 3', [[RUN('echo after > notes/u.txt')]]);
  assert.equal(one.tools[0]?.outcome, 'change', shown(one.tools));
  const two = await turn(chat, 'save this as c16.md on spark 3', [[{ name: 'save_file', arguments: { spark: 'spark3', path: 'c16.md', text: 'c16\n' } }]]);
  assert.equal(two.tools[0]?.ok, true, shown(two.tools));
  assert.deepEqual(two.choices, [], 'saved at once');
  const u = await say(chat, '/undo');
  assert.match(u.text, /^\/undo\nNothing was undone: this chat’s last change was “Save a file” on Spark 3 \(record j_[0-9a-f]{12}\), and undo has no way to put that back\. The change before it is left as it is too \(a command’s files on Spark 3, record j_[0-9a-f]{12}\)/, u.text);
  assert.equal(text('notes/u.txt'), 'after\n', 'the change before it was not put back');
  // (and so again: never the older one)
  const again = await say(chat, '/undo');
  assert.match(again.text, /Nothing was undone/, again.text);
  assert.equal(text('notes/u.txt'), 'after\n');
});

test('C-18: an agent\'s fiftieth new conversation never drops one holding the owner\'s words; with none to drop, the new one is refused in plain words', { timeout: 900000 * SLOW }, async () => {
  const key = await createKey('c18');
  const ask = async message => { const a = await call(key.token, ASK, { message }); return a; };
  const answered = async conv => waitFor(async () => (await call(key.token, ASK, { conversation: conv })).value?.status !== 'thinking', { timeout: 90000, what: 'Sparkie’s answer to the agent' });
  const first = await ask('hello from c18, 0');
  assert.equal(first.isError, false, first.text);
  const c0 = first.value.conversation;
  await answered(c0);
  await say(c0, 'the owner was here');
  const convs = [c0];
  for (let i = 1; i < 50; i++) { const a = await ask(`hello from c18, ${i}`); assert.equal(a.isError, false, a.text); convs.push(a.value.conversation); await answered(a.value.conversation); }
  const next = await ask('hello from c18, 50');
  assert.equal(next.isError, false, next.text);
  await answered(next.value.conversation);
  assert.equal((await api(`/chats/${c0}`)).status, 200, 'the conversation the owner spoke in stays, though the oldest');
  assert.equal((await api(`/chats/${convs[1]}`)).status, 404, 'the oldest with none of the owner’s words went');
  const left = [...convs.slice(2), next.value.conversation];
  for (const c of left) await say(c, 'the owner was here too');
  const refused = await ask('hello from c18, 51');
  assert.equal(refused.isError, true, refused.text);
  assert.match(refused.text, /This agent already has 50 conversations with Sparkie, and none of the older ones can be cleared to make room: each holds a question waiting for the owner, a task, or the owner’s own words\./);
  for (const c of [c0, ...left]) assert.equal((await api(`/chats/${c}`)).status, 200, c);
});

test('R1-01: an undo that put nothing back leaves its change this chat\'s last: the next /undo is that change again, never the one before it', { timeout: 120000 * SLOW }, async () => {
  const chat = await newChat(), file = join(T.fleet.stateDir, 'desired.json');
  // (the list's first look writes desired.json, a minute after the console starts)
  await waitFor(() => existsSync(file), { timeout: 120000, every: 1000, what: 'desired.json written by its first look' });
  const d = JSON.parse(readFileSync(file, 'utf8'));
  const at = new Date(Date.now() - 60000).toISOString(), later = new Date(Date.now() - 30000).toISOString();
  d.revisions.push({ revision: d.revision + 1, at, operation: null, chat, by: 'owner', added: ['spark4/sc-r101-older'], removed: [], before: [] });
  d.revisions.push({ revision: d.revision + 2, at: later, operation: null, chat, by: 'owner', added: [], removed: ['spark3/sc-r101-gone'],
    before: [{ spark: 'spark3', container: 'sc-r101-gone', model: 'r101-gone', since: at, by: 'owner' }] });
  d.revision += 2;
  writeFileSync(file, JSON.stringify(d), { mode: 0o600 });
  const undoJobs = async () => (await api('/jobs')).json.jobs.filter(j => j.type === 'undo' && j.conv === chat);
  for (const n of [1, 2]) {
    const u = await say(chat, '/undo');
    assert.match(u.text, /Putting back this chat’s last change \(it stopped sc-r101-gone on Spark 3\)/, u.text);
    const j = await waitFor(async () => (await undoJobs()).find((x, i, all) => all.length >= n && x.status !== 'running' && x === all[0]), { timeout: 60000, what: `undo ${n} to end` });
    assert.equal(j.status, 'failed', JSON.stringify(j));
    assert.equal(j.revision, d.revision, 'the newest change, again');
    assert.match(j.error, /^Nothing was put back: starting sc-r101-gone again: .*That change is still this chat’s last one, so “undo” tries it again\./s, j.error);
    const now = JSON.parse(readFileSync(file, 'utf8')).revisions;
    assert.equal(now.find(r => r.revision === d.revision)?.undone, undefined, 'not marked undone');
    assert.equal(now.find(r => r.revision === d.revision - 1)?.undone, undefined, 'the one before it untouched');
  }
});

// (last: a change inside the lock-out net)
test('C-16: /undo after a change inside the lock-out net says so and points to /putback; the change before it is not put back instead', { timeout: 300000 * SLOW }, async () => {
  const chat = await newChat();
  const one = await turn(chat, 'change v on spark 3', [[RUN('echo after > notes/v.txt')]]);
  assert.equal(one.tools[0]?.outcome, 'change', shown(one.tools));
  // (as root: as the owner a lock-out change is answered "set root" and runs nothing, R71)
  await turn(chat, 'remove my old shell aliases on spark 3', [[{ name: 'run', arguments: { on: 'spark3', command: 'rm -f .bash_aliases', dir: '~', root: true } }]]);
  const m = (await chatMessages(chat)).filter(x => x.danger).at(-1);
  assert.ok(m, 'the lock-out ask');
  const yes = m.choices.find(c => c.pair);
  const p = await api(`/chats/${chat}/choose`, { method: 'POST', body: { choice: yes.id, pair: m.pair } });
  assert.equal(p.status, 200, p.text);
  assert.ok(!existsSync(at3('.bash_aliases')), 'the lock-out change ran');
  const u = await say(chat, '/undo');
  assert.match(u.text, /^\/undo\nNothing was undone: this chat’s last change was a command on Spark 3 that ran inside the lock-out net \(record j_[0-9a-f]{12}\), and undo has no way to put that back\. While its guard is still open, \/putback puts back what it changed\./, u.text);
  assert.equal(text('notes/v.txt'), 'after\n', 'the change before it was not put back');
});

// Covers: The owner's words (R34): with the stand-in brain stuck, `/status` is answered by code (no model call) and
// saved as one notice; `/restart sparkie` restarts the stuck brain in place with healing's restart (audit line, event);
// it changes nothing while the brain may still be loading (Docker says it started 2 minutes ago); a stopped brain, or
// one gone from Docker, starts again from its saved setup in a fresh container with nothing else on Spark 2 stopped, or
// is refused plainly when that setup can't start; `/pause` pauses without the passkey and says both ways to resume, and
// no word resumes; near misses (`/pause now`, a two-line message), ask_sparkie and the owner's word in an
// agent's conversation all go to the model; `/help` prints the by-hand restart line, the same one healing runs. Also: a
// slow restart holds Spark 2 (a second `/restart sparkie` says it's already restarting, a brain stop is refused, one
// restart line), a restart is refused while the brain is being stopped, `/pause` over an automatic pause makes it the
// owner's, and with the brain down a near miss (`/restart`) gets `/help` with no model call. `/undo update` on the
// tailnet goes back a build by code (no model call, the audit's rollback line) and says so when there is no earlier
// build; `/help` lists it and the by-hand go-back line; the page's word list has it. `/stop` ends a reply under way at
// once (no further model call, the chat free, the next message answered; a second `/stop` has nothing to stop); the
// page's word list is the service's.
//
// The owner's words (service/src/20-words.mjs; round two, item 1; contract 8.13): /status, /pause, /restart sparkie, /stop
// and /help typed as the whole message in the owner's own page chat are answered by code, with no model call, so they
// work with Sparkie's model stuck or stopped. Anything else (a near miss, an agent's conversation, ask_sparkie)
// goes to the model as before. The stand-in brain is sparkie-main on spark2: ~/.mock/brain-hung makes it stop
// answering (the stand-in `docker restart` clears it, and starts a stopped one), ~/.mock/started-sparkie-main sets when
// Docker says it started.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync, existsSync, mkdirSync, mkdtempSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { T, useFleet, api, call, createKey, MEMBER, agentSettings, auditLines, newChat, say, sseEvents, chatMessages, waitFor, sleep, SLOW, REPO, SERVICE_FILE } from './lib.mjs';

const keys = {};
// The install snapshots /undo update looks at: a temporary folder, never this machine's own (under ALL_LOCAL,
// undoUpdate never calls systemd-run).
const RELEASES = mkdtempSync(join(tmpdir(), 'sct-words-releases-'));
process.on('exit', () => rmSync(RELEASES, { recursive: true, force: true }));
useFleet({ watchMs: 60000, env: { SPARK_CONSOLE_RELEASES: RELEASES } }, async () => { keys.look = await createKey('words-look'); });

const mock = file => join(T.fleet.root, 'spark2', '.mock', file);
const requests = () => (existsSync(join(T.fleet.dir, 'model-requests.jsonl')) ? readFileSync(join(T.fleet.dir, 'model-requests.jsonl'), 'utf8').trim().split('\n').filter(Boolean) : []);
const restarts = () => auditLines().filter(l => l.action === 'restart_sparkie' && l.actor === 'owner');
const brainState = () => readFileSync(mock('containers'), 'utf8').split('\n').find(l => l.startsWith('sparkie-main|'))?.split('|')[1];
const setBrain = state => writeFileSync(mock('containers'), readFileSync(mock('containers'), 'utf8').replace(/^sparkie-main\|[^|]*\|/m, `sparkie-main|${state}|`));
const answering = () => waitFor(async () => (await api('/main')).json.healthy === true, { timeout: 60000 * SLOW, what: 'Sparkie answering' });

describe('the owner\'s words', { concurrency: 1 }, () => {
  test('/status with Sparkie\'s model stuck: code answers, no model call, saved as one notice', { timeout: 90000 * SLOW }, async t => {
    await answering();
    writeFileSync(mock('brain-hung'), '');
    t.after(() => rmSync(mock('brain-hung'), { force: true }));
    await waitFor(async () => (await api('/main')).json.healthy === false, { timeout: 30000 * SLOW, what: 'the stand-in brain not answering' });
    await sleep(5500); // past the 5-second cache of the brain's state
    // (/status waits at most 8 s for its own look at the brain; on a loaded machine the stand-in's look can take longer,
    // so one is taken first and kept for 5 s, and /status reads it)
    await api('/actions/sparkie_setup', { method: 'POST', body: {} });
    const chat = await newChat(), from = requests().length;
    const r = await say(chat, '  /STATUS ');
    assert.match(r.text, /^\/status\nSparkie: running, but its server doesn’t respond\.\n/);
    assert.match(r.text, /\nSparks online: .*\nOperations running: \d+\.\nSpark Console build [0-9a-f]{12}\.\nAgents’ changes: on\.\nOpen to the internet: (yes|no|not known)\./);
    assert.equal(requests().length, from, 'no model call');
    const saved = await chatMessages(chat);
    assert.equal(saved.length, 1, 'only the notice is saved, not the word as a turn');
    assert.equal(saved[0].notice, true);
  });

  test('/restart sparkie restarts the stuck model in place; healing\'s restart, with an audit line and an event', { timeout: 120000 * SLOW }, async t => {
    writeFileSync(mock('brain-hung'), '');
    t.after(() => rmSync(mock('brain-hung'), { force: true }));
    const chat = await newChat(), before = restarts().length, from = requests().length;
    const r = await say(chat, '/restart_sparkie');
    assert.match(r.text, /^\/restart sparkie\nRestarting Sparkie’s model\./);
    await waitFor(() => restarts().length > before, { timeout: 60000 * SLOW, what: 'the restart\'s audit line' });
    const line = restarts().at(-1);
    assert.equal(line.ok, true);
    assert.deepEqual(line.args, { spark: 'spark2', container: 'sparkie-main', word: '/restart sparkie' });
    assert.ok(!existsSync(mock('brain-hung')), 'docker restart ran (the stand-in clears brain-hung)');
    assert.equal(brainState(), 'running');
    await answering();
    const ev = (await call(keys.look.token, 'fleet_events', { limit: 50 })).value.events;
    assert.ok(ev.some(e => e.operation === 'Sparkie’s model restarted' && e.status === 'completed' && e.by === 'owner'));
    assert.equal(requests().length, from, 'no model call');
  });

  // (F3, 2026-11-12: the owner chose that the word also starts a stopped brain; the next two tests)
  test('/restart sparkie changes nothing while the model may still be loading; with the model down a near miss gets /help', { timeout: 90000 * SLOW }, async t => {
    const chat = await newChat(), before = restarts().length;
    writeFileSync(mock('started-sparkie-main'), new Date(Date.now() - 2 * 60000).toISOString());
    t.after(() => rmSync(mock('started-sparkie-main'), { force: true }));
    const loading = await say(chat, '/restart sparkie');
    assert.match(loading.text, /started 2 minutes ago and may still be loading.*Nothing was changed\./s);
    assert.equal(restarts().length, before);
    rmSync(mock('started-sparkie-main'), { force: true });
    setBrain('exited');
    t.after(() => setBrain('running'));
    // A near miss with the model down gets /help, not a failed turn, and no model call.
    await sleep(5500); // past the 5-second cache of the brain's state
    const from = requests().length;
    const miss = await say(chat, '/restart');
    assert.match(miss.text, /^\/restart\nThat isn’t one of the words, and Sparkie’s model isn’t answering\.\nThese work even when Sparkie can’t answer\./);
    assert.equal(requests().length, from, 'no model call');
    // (a near miss stops waiting for its look at the brain after 6 s; that look ends, and is kept 5 s, before the
    // brain comes back)
    await api('/actions/sparkie_setup', { method: 'POST', body: {} });
    setBrain('running');
    await sleep(5500); // past the 5-second cache of the brain's state
    // (a look taken first, for /status to read: see the first test)
    await api('/actions/sparkie_setup', { method: 'POST', body: {} });
    // With Sparkie's model back, /status says so.
    const st = await say(chat, '/status');
    assert.match(st.text, /^\/status\nSparkie: running/, 'running again');
  });

  test('/restart sparkie starts a stopped model again from its saved setup (a fresh container, never the stopped one\'s /tmp)', { timeout: 240000 * SLOW }, async t => {
    await answering();
    setBrain('exited');
    t.after(() => setBrain('running'));
    const chat = await newChat(), starts = () => auditLines().filter(l => l.action === 'start_sparkie'), before = starts().length, from = requests().length;
    const r = await say(chat, '/restart sparkie');
    assert.match(r.text, /^\/restart sparkie\nSparkie’s model wasn’t running, so it’s starting again from its saved setup \(.+\)\. Nothing else on Spark 2 is stopped for it\./);
    assert.equal(requests().length, from, 'no model call');
    assert.equal(starts().length, before + 1);
    const line = starts().at(-1);
    const job = await waitFor(async () => { const j = (await api(`/jobs/${line.operation}`)).json; return j.status !== 'running' && j; }, { timeout: 180000 * SLOW, what: 'the start to end' });
    assert.deepEqual([job.type, job.status], ['main-start', 'completed'], JSON.stringify(job.log));
    assert.equal(brainState(), 'running');
    await answering();
    assert.ok((await say(chat, '/help')).text.includes('or start it again when it’s stopped'));
    // (the chat's own line for a model that isn't running names the word too; the stand-in model always listens)
    assert.ok(!readFileSync(SERVICE_FILE, 'utf8').includes('isn’t running. Start it from Models.'));
  });

  test('/restart sparkie with the model gone from Docker starts the saved setup again and stops nothing else on Spark 2; a setup that can\'t start is said plainly', { timeout: 240000 * SLOW }, async t => {
    await answering();
    const lines = readFileSync(mock('containers'), 'utf8');
    // (something else on Spark 2's GPU: a plain brain start would stop it)
    writeFileSync(mock('gpu'), '4242, 9000, python, sc-gpt-oss-20b\n');
    t.after(() => rmSync(mock('gpu'), { force: true }));
    writeFileSync(mock('containers'), lines.replace(/^sparkie-main\|.*\n/m, ''));
    const hub = join(T.fleet.root, 'spark2', '.cache', 'huggingface', 'hub'), draft = join(hub, 'models--z-lab--Qwen3.8-27B-DFlash2');
    renameSync(draft, `${draft}.aside`);
    t.after(() => { if (existsSync(`${draft}.aside`)) renameSync(`${draft}.aside`, draft); });
    // (counted from here: the stopped-model case before this one starts the saved setup too)
    const chat = await newChat(), earlier = auditLines().filter(l => l.action === 'start_sparkie').length, starts = () => auditLines().filter(l => l.action === 'start_sparkie').slice(earlier);
    const no = await say(chat, '/restart sparkie');
    assert.match(no.text, /is gone from Docker, and it can’t be started right now: .*Hugging Face cache\. Nothing was changed\./);
    assert.equal(starts().length, 0);
    assert.equal(brainState(), undefined, 'still gone');
    renameSync(`${draft}.aside`, draft);
    const r = await say(chat, '/restart sparkie');
    assert.match(r.text, /^\/restart sparkie\nSparkie’s model was gone from Docker, so it’s starting again from its saved setup \(.+\)\. Nothing else on Spark 2 is stopped for it\./);
    assert.equal(starts().length, 1);
    const line = starts()[0];
    assert.deepEqual(line.args, { spark: 'spark2', container: 'sparkie-main', word: '/restart sparkie' });
    assert.match(line.operation || '', /^[0-9a-f]{12}$/);
    const job = await waitFor(async () => { const j = (await api(`/jobs/${line.operation}`)).json; return j.status !== 'running' && j; }, { timeout: 180000 * SLOW, what: 'the start to end' });
    assert.deepEqual([job.type, job.status], ['main-start', 'completed'], JSON.stringify(job.log));
    assert.ok(job.log.some(l => /Keeping sc-gpt-oss-20b running, as asked/.test(l)), JSON.stringify(job.log));
    assert.match(readFileSync(mock('containers'), 'utf8'), /^sc-gpt-oss-20b\|running\|/m);
    assert.equal(brainState(), 'running');
    await answering();
  });

  test('/pause pauses agents\' changes without the passkey and says both ways to resume; resuming is never a word', { timeout: 60000 * SLOW }, async () => {
    const chat = await newChat();
    try {
      const r = await say(chat, '/pause');
      assert.match(r.text, /^\/pause\nPaused\. Operations started by Sparkie, an agent, Telegram or the API stop at their next step and put back what they changed\. Models already running stay up\. Self-healing is off while paused\.\nTo resume: your account menu → Agents and Telegram, with your passkey\. Or by hand on Spark 2: set "halted": false in .*agent-settings\.json\.$/);
      const s = (await api('/agents')).json.settings;
      assert.equal(s.halted, true);
      assert.notEqual(s.autoPaused, true);
      assert.ok(auditLines().some(l => l.action === 'agent-settings' && l.args?.word === '/pause' && l.actor === 'owner'));
      assert.match((await say(chat, '/pause')).text, /^\/pause\nAlready paused\./);
      for (const w of ['/resume', '/unpause']) await say(chat, w).catch(() => {});
      assert.equal((await api('/agents')).json.settings.halted, true, 'no word resumes');
    } finally {
      await agentSettings({ halted: false });
    }
  });

  test('near misses, an agent\'s conversation and ask_sparkie go to the model and pause nothing', { timeout: 120000 * SLOW }, async () => {
    const chat = await newChat();
    for (const words of ['/pause now', 'please /pause', '/pause\nnow', 'the log said /pause']) {
      const from = requests().length;
      const r = await say(chat, words);
      assert.ok(!r.text.startsWith('/pause\n'), words);
      assert.ok(requests().length > from, `${JSON.stringify(words)} reached the model`);
    }
    let v = (await call(keys.look.token, 'ask_sparkie', { message: '/pause' })).value;
    for (const until = Date.now() + 60000 * SLOW; v?.status !== 'answered' && Date.now() < until;) v = (await call(keys.look.token, 'ask_sparkie', { conversation: v.conversation })).value;
    assert.equal(v?.status, 'answered');
    // The owner typing a word into that agent's conversation is not the word either.
    const agentChat = (await api('/chats')).json.chats.find(c => c.agent);
    assert.ok(agentChat, 'the agent\'s conversation');
    const before = requests().length;
    await say(agentChat.id, '/pause').catch(() => {});
    assert.ok(requests().length > before, 'the owner\'s word in an agent\'s conversation reached the model');
    assert.equal((await api('/agents')).json.settings.halted, false, 'nothing paused');
  });

  test('a slow restart holds Spark 2: a second /restart sparkie and a brain stop are refused; one restart line', { timeout: 120000 * SLOW }, async t => {
    writeFileSync(mock('slow-restart'), '6');
    t.after(() => rmSync(mock('slow-restart'), { force: true }));
    const chat = await newChat(), before = restarts().length;
    assert.match((await say(chat, '/restart sparkie')).text, /Restarting Sparkie’s model\./);
    assert.match((await say(chat, '/restart sparkie')).text, /^\/restart sparkie\nSparkie’s model is already restarting\./);
    const stop = await api('/main/stop', { method: 'POST', body: {} });
    assert.equal(stop.status, 409, stop.text);
    assert.match(stop.json.error, /Something is already changing on Spark 2 \(restarting Sparkie’s model\)/);
    await waitFor(() => restarts().length > before, { timeout: 60000 * SLOW, what: 'the restart\'s audit line' });
    assert.equal(restarts().length, before + 1, 'exactly one restart');
    await answering();
  });

  test('while Sparkie\'s model is being stopped, /restart sparkie changes nothing', { timeout: 150000 * SLOW }, async t => {
    writeFileSync(mock('slow-stop'), '5');
    t.after(() => rmSync(mock('slow-stop'), { force: true }));
    const chat = await newChat(), before = restarts().length;
    const stop = await api('/main/stop', { method: 'POST', body: {} });
    assert.equal(stop.status, 202, stop.text);
    const r = await say(chat, '/restart sparkie');
    assert.match(r.text, /being started, stopped or switched, or something else is changing on Spark 2, right now\. Nothing was changed\./);
    assert.equal(restarts().length, before);
    rmSync(mock('slow-stop'), { force: true });
    await waitFor(() => brainState() === 'exited', { timeout: 60000 * SLOW, what: 'the brain stopped' });
    // (the stand-in brain put back as running, loaded a minute ago)
    setBrain('running');
    writeFileSync(mock('up-sparkie-main'), String(Math.floor(Date.now() / 1000) - 60));
    await answering();
  });

  test('/pause over an automatic pause makes it the owner\'s own (self-healing stops too)', { timeout: 60000 * SLOW }, async () => {
    writeFileSync(join(T.fleet.stateDir, 'agent-settings.json'), JSON.stringify({ halted: true, autoPaused: true, selfHeal: true }));
    try {
      const r = await say(await newChat(), '/pause');
      assert.match(r.text, /^\/pause\nPaused\./);
      const s = (await api('/agents')).json.settings;
      assert.equal(s.halted, true);
      assert.equal(s.autoPaused, false);
    } finally { await agentSettings({ halted: false }); }
  });

  test('with the brain frozen (it answers nothing for 10 s), a near miss still gets /help', { timeout: 90000 * SLOW }, async t => {
    writeFileSync(mock('brain-frozen'), '');
    t.after(() => rmSync(mock('brain-frozen'), { force: true }));
    await sleep(5500); // past the 5-second cache of the brain's state
    const from = requests().length;
    const r = await say(await newChat(), '/restat');
    assert.match(r.text, /^\/restat\nThat isn’t one of the words, and Sparkie’s model isn’t answering\./);
    assert.equal(requests().length, from, 'no model call');
    rmSync(mock('brain-frozen'), { force: true });
    await answering();
    await sleep(5500);
  });

  test('/undo update on the owner\'s tailnet goes back a build by code: no model call, one notice, the rollback on the audit', { timeout: 60000 * SLOW }, async t => {
    const rollbacks = () => auditLines().filter(l => l.action === 'rollback');
    const chat = await newChat();
    const none = await say(chat, '/undo update');
    assert.equal(none.text, '/undo update\nThere’s no earlier build to go back to on this Spark.');
    assert.equal(rollbacks().length, 0);
    const stamp = '20261110T120000Z';
    mkdirSync(join(RELEASES, stamp), { recursive: true });
    writeFileSync(join(RELEASES, stamp, 'restore.sh'), '#!/bin/sh\nexit 0\n', { mode: 0o700 });
    t.after(() => rmSync(join(RELEASES, stamp), { recursive: true, force: true }));
    await waitFor(async () => (await api('/health')).json.jobsRunning === 0, { timeout: 60000 * SLOW, what: 'no operations running' });
    const from = requests().length;
    const r = await say(chat, ' /Undo_Update ');
    assert.equal(r.text, `/undo update\nGoing back to the build from before the update on ${stamp}; Spark Console restarts in a moment.`);
    assert.equal(r.message.choices, undefined);
    const rb = rollbacks().at(-1);
    assert.deepEqual([rb?.via, rb?.actor, rb?.args?.to, rb?.ok], ['page', 'owner', stamp, true]);
    assert.ok(auditLines().some(l => l.action === 'undo_update' && l.via === 'page' && l.request === '/undo update' && l.outcome === 'started'),
      JSON.stringify(auditLines().filter(l => l.action === 'undo_update')));
    assert.equal(requests().length, from, 'no model call');
    const msgs = await chatMessages(chat);
    assert.equal(msgs.length, 2);
    assert.ok(msgs.every(m => m.notice === true && m.word === true), JSON.stringify(msgs));
  });

  test('/stop ends Sparkie\'s reply in that chat at once; the chat is free; a second /stop has nothing to stop', { timeout: 90000 * SLOW }, async () => {
    await answering();
    const chat = await newChat(), words = 'take 20 seconds to answer this';
    const slow = say(chat, words).then(() => null, e => e);
    await waitFor(() => requests().some(l => JSON.parse(l).words === words), { what: 'the slow turn reaching the model' });
    const from = requests().length, t0 = Date.now();
    const r = await say(chat, ' /STOP ');
    assert.match(r.text, /^\/stop\nStopped\. /);
    assert.ok(r.text.includes('No model was stopped'), r.text);
    await waitFor(async () => (await api(`/chats/${chat}`)).json.replying === false, { timeout: 5000 * SLOW, every: 100, what: 'the chat free' });
    assert.ok(Date.now() - t0 < 15000, 'well before the stand-in would have answered');
    assert.match(String((await slow)?.message), /Stopped at your word\./);
    assert.equal(requests().length, from, 'the model isn\'t asked again');
    const stopped = (await chatMessages(chat)).filter(m => m.role === 'assistant' && !m.notice);
    assert.deepEqual(stopped.map(m => m.error), ['Stopped at your word.']);
    assert.ok((await say(chat, 'hello again')).text, 'the chat answers again');
    assert.match((await say(chat, '/stop')).text, /^\/stop\nSparkie isn’t answering in this chat/);
  });

  // A-4 (review with Astra, 2026-11-14): an error answer from Sparkie's model cut off part-way (test/mock/model.mjs,
  // model-fail). Before, the chat stayed "still answering" for good, and /stop said "Stopped." but freed nothing.
  const failNext = mode => writeFileSync(join(T.fleet.dir, 'model-fail'), mode);
  const sendNoWait = (chat, text) => api(`/chats/${chat}/messages`, { method: 'POST', body: { text } }).catch(e => ({ text: String(e) }));
  test('/stop after a model error cut off part-way: there is nothing to stop, and the chat answers again', { timeout: 120000 * SLOW }, async t => {
    await answering();
    t.after(() => rmSync(join(T.fleet.dir, 'model-fail'), { force: true }));
    failNext('cut-off');
    const chat = await newChat(), words = 'this answer is cut off part-way';
    const sent = sendNoWait(chat, words);
    await waitFor(() => requests().some(l => JSON.parse(l).words === words), { what: 'the turn reaching the model' });
    await sleep(1000);
    assert.match((await say(chat, '/stop')).text, /^\/stop\nSparkie isn’t answering in this chat/);
    assert.equal((await api(`/chats/${chat}`)).json.replying, false);
    assert.equal((await api('/health')).json.replying, 0);
    const first = await sent;
    assert.equal(sseEvents(first.text).filter(e => e.type === 'error').length, 1, first.text);
    assert.ok((await say(chat, 'hello again')).text, 'the chat answers again');
  });

  test('/stop while a model error is held open part-way: the chat is free at once', { timeout: 120000 * SLOW }, async t => {
    await answering();
    t.after(() => rmSync(join(T.fleet.dir, 'model-fail'), { force: true }));
    failNext('held-open');
    const chat = await newChat(), words = 'this answer is held open part-way';
    const sent = sendNoWait(chat, words);
    await waitFor(() => requests().some(l => JSON.parse(l).words === words), { what: 'the turn reaching the model' });
    await sleep(1000);
    assert.match((await say(chat, '/stop')).text, /^\/stop\nStopped\. /);
    await waitFor(async () => (await api(`/chats/${chat}`)).json.replying === false, { timeout: 5000 * SLOW, every: 100, what: 'the chat free' });
    const errors = sseEvents((await sent).text).filter(e => e.type === 'error');
    assert.deepEqual(errors.map(e => e.error), ['Stopped at your word.']);
    assert.ok((await say(chat, 'hello again')).text, 'the chat answers again');
  });

  test('the page knows the same words as the service', () => {
    const list = text => /const OWNER_WORDS = (\[[^\]]*\]);/.exec(text)?.[1];
    const page = list(readFileSync(join(REPO, 'public', 'app.js'), 'utf8')), service = list(readFileSync(join(REPO, 'service', 'src', '20-words.mjs'), 'utf8'));
    assert.ok(page && service);
    assert.equal(page, service);
    assert.ok(page.includes(`'/stop'`));
  });

  test('/help lists the words and the by-hand lines, built from the same restart', { timeout: 30000 * SLOW }, async () => {
    const r = await say(await newChat(), '/help');
    assert.match(r.text, /^\/help\nThese work even when Sparkie can’t answer\./);
    for (const w of ['/status:', '/pause:', '/restart sparkie:', '/stop:', '/help:']) assert.ok(r.text.includes(w), w);
    assert.match(r.text, /\nBy hand, in a terminal:\n  restart Sparkie’s model \(on Spark 2\): docker exec 'sparkie-main' rm -f '\/tmp\/sglang-rdv' >\/dev\/null 2>&1; docker restart --time 30 'sparkie-main'\n/);
    assert.match(r.text, /\n  resume agents’ changes \(on Spark 2\): set "halted": false in .*agent-settings\.json$/);
    assert.ok(r.text.includes('/undo update:'));
    assert.match(r.text, /\n  go back a build \(on Spark 2\): bash .*\/\.local\/share\/spark-console\/go-back\.sh \(other by-hand steps: .*\/\.local\/share\/spark-console\/RECOVERY\.txt\)\n/);
    // (the page sends the word even while another answer is coming)
    assert.match(readFileSync(join(REPO, 'public', 'app.js'), 'utf8'), /const OWNER_WORDS = \[[^\]]*'\/undo update'[^\]]*\];/);
  });

  test('/help names the rebuild steps: deploy/REBUILD.txt on GitHub, and the copy every install puts beside RECOVERY.txt', { timeout: 30000 * SLOW }, async () => {
    const r = await say(await newChat(), '/help');
    assert.match(r.text, /\n  bring Spark 2 back after its disk is lost: deploy\/REBUILD\.txt on GitHub \(a copy: .*\/\.local\/share\/spark-console\/REBUILD\.txt\)\n/);
  });
});

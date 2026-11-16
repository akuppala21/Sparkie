// Covers: The failure count that pauses agents (R9) on a fleet paired with the stand-in Telegram: three operations the
// owner started by pressing Sparkie's button in the paired Telegram chat that fail in a row don't pause agents (the
// owner's own failed work never counts); three failed operations of an agent's key in a row still do.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { T, useFleet, api, call, createActKey, agentSettings, waitFor, sleep, SLOW } from './lib.mjs';

const TG_TOKEN = '123456789:AAEtestTokenForSparkConsoleXYZ_abcdefghij', OWNER_TG = 5550001;
const paired = ({ dir }) => {
  mkdirSync(join(dir, 'secrets'), { recursive: true, mode: 0o700 });
  writeFileSync(join(dir, 'secrets', 'secrets.json'), JSON.stringify({ telegram: { token: TG_TOKEN, bot: 'spark_test_bot', chatId: OWNER_TG, userId: OWNER_TG, name: 'Owner', pairedAt: new Date().toISOString() } }), { mode: 0o600 });
};
useFleet({ telegram: true, watchMs: 60000, env: { SPARK_CONSOLE_TELEGRAM_LIMITS: '1000,1000,1000' }, prepare: paired },
  () => waitFor(async () => (await api('/telegram')).json.state === 'ok', { what: 'Telegram polling' }));

const mock = (spark, file) => join(T.fleet.root, spark, '.mock', file);
const addContainer = (spark, line) => writeFileSync(mock(spark, 'containers'), readFileSync(mock(spark, 'containers'), 'utf8') + `${line}\n`);
const script = rules => writeFileSync(join(T.fleet.dir, 'model-script.json'), JSON.stringify(rules));
const noScript = () => rmSync(join(T.fleet.dir, 'model-script.json'), { force: true });
const tgPost = async (p, body) => (await fetch(`http://127.0.0.1:${T.fleet.telegramPort}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
const tgCalls = () => { const f = join(T.fleet.dir, 'telegram-calls.jsonl'); return existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : []; };
let msgId = 900;
const tgSay = text => tgPost('/__push', { message: { message_id: msgId++, date: Math.floor(Date.now() / 1000), chat: { id: OWNER_TG, type: 'private' },
  from: { id: OWNER_TG, is_bot: false, first_name: 'Owner' }, text } });
const tgPress = data => tgPost('/__push', { callback_query: { id: String(msgId++), from: { id: OWNER_TG, is_bot: false, first_name: 'Owner' }, data,
  message: { message_id: msgId++, chat: { id: OWNER_TG, type: 'private' }, date: Math.floor(Date.now() / 1000) } } });
const settings = async () => (await api('/agents')).json.settings;
const jobOf = async container => (await api('/jobs')).json.jobs.find(j => j.type === 'restart' && j.container === container);
const ended = container => waitFor(async () => { const j = await jobOf(container); return j && j.status !== 'running' && j; }, { timeout: 120000, every: 500, what: `the restart of ${container} to end` });

test('three failed operations the owner pressed for in the paired Telegram chat don\'t pause agents; an agent\'s three still do', { timeout: 600000 * SLOW }, async () => {
  try {
    assert.equal((await settings()).halted, false);
    // (stopped models of Spark Console's that can't start again while the model on Spark 4 holds its serve port)
    for (let i = 1; i <= 3; i++) addContainer('spark4', `sc-tgfail-${i}|exited|Exited (0) just now|1|Qwen--Qwen3-32B||||`);
    for (let i = 1; i <= 3; i++) {
      const name = `sc-tgfail-${i}`, words = `hello from telegram ${i}`;
      script([{ match: `^${words}$`, calls: [{ name: 'restart_model', arguments: { spark: 'spark4', container: name } }] }]);
      const from = tgCalls().length;
      await tgSay(words);
      const asked = await waitFor(() => tgCalls().slice(from).find(c => c.method === 'sendMessage' && c.body?.reply_markup?.inline_keyboard), { timeout: 60000, every: 200, what: 'Sparkie’s button in the paired chat' });
      noScript();
      const yes = asked.body.reply_markup.inline_keyboard.flat().find(b => !/^No\b/.test(b.text));
      assert.ok(yes, JSON.stringify(asked.body.reply_markup));
      await tgPress(yes.callback_data);
      const j = await ended(name);
      assert.deepEqual([j.status, j.via], ['failed', 'telegram'], JSON.stringify(j));
      assert.match(j.error, /port is already allocated/);
    }
    await sleep(300);
    assert.equal((await settings()).halted, false, 'the owner’s own presses on Telegram don’t count');
    // An agent's three failed operations in a row still pause agents.
    const key = await createActKey('pause-tg-agent');
    for (let i = 1; i <= 3; i++) addContainer('spark4', `sc-agfail-${i}|exited|Exited (0) just now|1|Qwen--Qwen3-32B||||`);
    for (let i = 1; i <= 3; i++) {
      const r = await call(key.token, 'restart_model', { spark: 'spark4', container: `sc-agfail-${i}` });
      assert.equal(r.isError, false, r.text);
      const j = await ended(`sc-agfail-${i}`);
      assert.equal(j.status, 'failed', JSON.stringify(j));
    }
    await waitFor(async () => (await settings()).halted, { timeout: 10000, every: 200, what: 'agents paused after the agent’s third failure' });
    assert.equal((await settings()).autoPaused, true);
  } finally { noScript(); await agentSettings({ halted: false }); }
});

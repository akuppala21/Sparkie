// Covers: through real paired Telegram ingress, restored-access hold allows exact confirmed webpage denial,
// while admission and public sign-in remain blocked; denying a request grants no browser session.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { T, useFleet, api, waitFor, auditLines, SLOW } from './lib.mjs';
const OWNER = 5559201;
useFleet({ telegram: true, watchMs: 60000, env: { SPARK_CONSOLE_TELEGRAM_LIMITS: '1000,1000,1000', SPARK_CONSOLE_DANGER_LATE_MS: '1' }, prepare: ({ dir }) => {
  mkdirSync(join(dir, 'secrets'), { recursive: true, mode: 0o700 });
  writeFileSync(join(dir, 'secrets', 'secrets.json'), JSON.stringify({ telegram: { token: '123456789:AAEtestTokenForSparkConsoleXYZ_abcdefghij', bot: 'spark_test_bot', chatId: OWNER, userId: OWNER, name: 'Owner', pairedAt: '2026-11-17T12:00:00.000Z', approve: true } }));
} });
let message = 1;
const calls = () => { const p = join(T.fleet.dir, 'telegram-calls.jsonl'); return existsSync(p) ? readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : []; };
const push = update => fetch(`http://127.0.0.1:${T.fleet.telegramPort}/__push`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(update) });
const chat = { id: OWNER, type: 'private' }, from = { id: OWNER, is_bot: false, first_name: 'Owner' };
const say = text => push({ message: { message_id: message++, date: Math.floor(Date.now() / 1000), chat, from, text } });
const press = id => push({ callback_query: { id: String(message++), from, data: id, message: { message_id: message++, chat, date: Math.floor(Date.now() / 1000) } } });
async function approveWord(word) {
  const since = calls().length; await say(word);
  const sent = await waitFor(() => calls().slice(since).find(x => x.method === 'sendMessage' && x.body.reply_markup?.inline_keyboard && /then type \d{2}\./.test(x.body.text)), { timeout: 90000, what: 'the complete held denial confirmation' });
  const id = sent.body.reply_markup.inline_keyboard.flat().find(b => b.text !== 'No').callback_data, digits = /then type (\d{2})\./.exec(sent.body.text)[1];
  const after = calls().length; await press(id);
  await waitFor(() => calls().slice(after).some(x => x.method === 'sendMessage' && /Type the two digits/.test(x.body.text)), { timeout: 30000, what: 'the held denial digit prompt' });
  await say(digits);
}
const net = (path, body) => api(path, { method: 'POST', body, headers: { 'tailscale-funnel-request': '?1' } });
async function browser(name) {
  const r = await net('/auth/device/start', { kind: 'browser', name }); assert.equal(r.status, 200, r.text); return r.json;
}
test('a held paired owner confirms denial, while admission and the public sign-in door remain held', { timeout: 180000 * SLOW }, async () => {
  const denied = await browser('Held denied webpage'), waiting = await browser('Held waiting webpage');
  const file = join(T.fleet.dir, 'secrets/secrets.json'), before = readFileSync(file, 'utf8'), secrets = JSON.parse(before);
  try {
    secrets.auth = { ...(secrets.auth || {}), hold: { since: new Date().toISOString() } }; writeFileSync(file, JSON.stringify(secrets));
    await waitFor(async () => (await api('/whoami', { headers: { 'tailscale-funnel-request': '?1' } })).json.deviceSignin === false,
      { timeout: 5000 * SLOW, what: 'the restored-access hold reaching the cached public capability' });
    await approveWord(`/device ${denied.code} deny`);
    await waitFor(() => auditLines().some(a => a.action === 'device-turned-away' && a.args?.device === 'Held denied webpage' && a.via === 'telegram'), { timeout: 30000, what: 'the exact held browser denial' });
    const since = calls().length; await say(`/device ${waiting.code} allow`);
    await waitFor(() => calls().slice(since).some(x => x.method === 'sendMessage' && /Review restored access first/.test(x.body.text)), { timeout: 30000, what: 'held browser admission refused' });
    assert.ok(!calls().slice(since).some(x => x.body?.reply_markup), 'no admission confirmation while held');
    assert.ok(!auditLines().some(a => a.action === 'device-let-in' && ['Held denied webpage', 'Held waiting webpage'].includes(a.args?.device)));
    assert.equal((await net('/auth/device/poll', { deviceCode: denied.deviceCode })).status, 403, 'the public sign-in door remains held');
    assert.ok(!(await api('/auth/sessions')).json.sessions.some(s => /^Held /.test(s.name)));
  } finally { writeFileSync(file, before); }
  await waitFor(async () => (await api('/whoami', { headers: { 'tailscale-funnel-request': '?1' } })).json.deviceSignin === true,
    { timeout: 5000 * SLOW, what: 'the restored-access hold lifting from the cached public capability' });
  assert.equal((await net('/auth/device/poll', { deviceCode: denied.deviceCode })).status, 410, 'the confirmed denial survives lifting the hold');
  assert.equal((await net('/auth/device/poll', { deviceCode: waiting.deviceCode })).status, 202, 'admission was never granted');
});

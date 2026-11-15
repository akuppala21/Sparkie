// Covers: Keys given once (A14a, R50; design A step 14, E 2.4, C 2.3). A key the owner gives in their own chat, on the
// page or in the paired Telegram chat (`/key NAME value`, the value also on the next line, or a heartbeat address
// pasted as it is) is taken out before anything reads the words: answered by code (the brain is not asked), kept by
// name in the secrets file, and the chat keeps only that a key named NAME was given. Every value made up here is
// searched for exactly in the whole stand-in fleet's folder (chats, journal, audit, events, the service log, what the
// stand-in brain was sent, Telegram's calls): only the secrets file holds it. A later turn and the owner's own later
// message carry it hidden; a tool that prints it, as is or in base64, comes back hidden. GITHUB is kept only when the
// stand-in GitHub takes it (`pull.sh setup`'s own fetch; a stand-in git refuses any other token); a heartbeat address
// starts the beat at once. A member's, an agent's, a bad name's or a key-shaped name's `/key` keeps nothing; so does a
// key typed where the name goes, with words after it, and a key with words or quotes round it. On
// Telegram the message is deleted, and a delete that fails tells the owner to delete it. An error that quotes a kept key
// hides it; after a restart the state copy holds none, and a tool result still comes back hidden.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, mkdtempSync, copyFileSync, chmodSync, rmSync, readdirSync, lstatSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { T, REPO, MEMBER, useFleet, api, call, createKey, newChat, say, chatMessages, waitFor, auditLines, SLOW } from './lib.mjs';
import { startMock, MOCK } from './start-mock.mjs';

// Made-up keys, new each run, of no shape the mask knows: only their kept value can hide them.
const made = (p = 'kv') => `${p}${randomBytes(16).toString('hex')}`;
const V = { page: made(), plain: made(), member: made(), agent: made(), bad: made(), tg: made(), tgKept: made(), err: made() };
const GOOD = made('gt_'), BAD = made('gt_'), OLD = made('gt_');
// Keys typed where the name goes (as typed, and in capitals), and one given with words round it.
const K = { low: made(), up: made().toUpperCase(), tg: made() }, W = made();
const BEAT_ID = randomUUID(), BEAT = `https://hc-ping.com/${BEAT_ID}`;
const TG_TOKEN = '123456789:AAEtestTokenForSparkConsoleXYZ_abcdefghij', OWNER_TG = 5550001, REPO_NAME = 'someone/spark-console';
const temps = [];
const temp = p => { const d = mkdtempSync(join(tmpdir(), p)); temps.push(d); return d; };
after(() => { for (const d of temps) rmSync(d, { recursive: true, force: true }); });

// GitHub's stand-in: a bare repository with main, and a git first on the service's PATH that refuses a fetch carrying
// any token but GOOD (as GitHub refuses a bad token). Both live outside the fleet's folder.
const REAL_GIT = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
const GH = temp('sct-keys-gh-'), BIN = temp('sct-keys-bin-');
if (REAL_GIT) {
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@test',
    GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@test', GIT_INDEX_FILE: join(BIN, 'index') };
  const g = (args, input) => spawnSync(REAL_GIT, ['-C', GH, ...args], { encoding: 'utf8', env, input }).stdout.trim();
  spawnSync(REAL_GIT, ['init', '-q', '--bare', GH], { env });
  g(['update-index', '--add', '--cacheinfo', `100644,${g(['hash-object', '-w', '--stdin'], 'stand-in\n')},README`]);
  g(['update-ref', 'refs/heads/main', g(['commit-tree', g(['write-tree']), '-m', 'stand-in'])]);
  const auth = `Authorization: basic ${Buffer.from(`x-access-token:${GOOD}`).toString('base64')}`;
  writeFileSync(join(BIN, 'git'), `#!/bin/sh\ncase " $* " in *" fetch "*) [ "$GIT_CONFIG_VALUE_0" = "${auth}" ] || { echo "remote: Invalid username or token." >&2; exit 128; } ;; esac\nexec '${REAL_GIT}' "$@"\n`, { mode: 0o755 });
}
// hc-ping.com's stand-in: it keeps each request's path.
const beats = [];
const HC = await new Promise(resolve => {
  const s = http.createServer((req, res) => { beats.push(req.url); res.end('OK'); }).listen(0, '127.0.0.1', () => resolve(s));
});
after(() => { HC.closeAllConnections?.(); HC.close(); });

// The secrets file sits where pull.sh keeps it, under a home of the fleet's own: Telegram paired, the pull install set
// up with an old token, and pull.sh where every install leaves it.
const SECRETS_TAIL = join('home', '.config', 'spark-console', 'secrets.json');
function homeFor(env, old = null) {
  return ({ dir }) => {
    env.SPARK_CONSOLE_SECRETS_FILE = join(dir, SECRETS_TAIL);
    mkdirSync(join(dir, 'home', '.config', 'spark-console'), { recursive: true, mode: 0o700 });
    writeFileSync(env.SPARK_CONSOLE_SECRETS_FILE, old ? readFileSync(old) : JSON.stringify({ telegram: { token: TG_TOKEN, bot: 'spark_test_bot', chatId: OWNER_TG, userId: OWNER_TG, name: 'Owner', pairedAt: new Date().toISOString() },
      github: { repo: REPO_NAME, token: OLD } }), { mode: 0o600 });
    const share = join(dir, 'home', '.local', 'share', 'spark-console');
    mkdirSync(share, { recursive: true, mode: 0o700 });
    copyFileSync(join(REPO, 'deploy', 'pull.sh'), join(share, 'pull.sh'));
    chmodSync(join(share, 'pull.sh'), 0o700);
  };
}
const ENV = { SPARK_CONSOLE_BEAT_API: `http://127.0.0.1:${HC.address().port}`, SPARK_CONSOLE_BEAT_FIRST_MS: '600000', SPARK_CONSOLE_REPO_URL: GH,
  SPARK_CONSOLE_TELEGRAM_LIMITS: '1000,1000,1000', PATH: `${BIN}:${join(MOCK, 'bin')}:${process.env.PATH}` };
useFleet({ telegram: true, watchMs: 60000, env: ENV, prepare: homeFor(ENV) });

const secretsOf = (fleet = T.fleet) => JSON.parse(readFileSync(join(fleet.dir, SECRETS_TAIL), 'utf8'));
const requests = () => { const f = join(T.fleet.dir, 'model-requests.jsonl'); return existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : []; };
// Every file under the fleet's folder that holds the text exactly (links and sockets aside), but the ones allowed.
function holders(text, fleet = T.fleet, allowed = [join(fleet.dir, SECRETS_TAIL)]) {
  const out = [];
  const walk = d => {
    for (const n of readdirSync(d)) {
      const p = join(d, n), st = lstatSync(p);
      if (st.isDirectory()) walk(p);
      else if (st.isFile() && !allowed.includes(p) && readFileSync(p).includes(text)) out.push(p.slice(fleet.dir.length + 1));
    }
  };
  walk(fleet.dir);
  return out;
}
const nowhere = (text, opts = {}) => assert.deepEqual(holders(text, opts.fleet, opts.allowed), [], `${text.slice(0, 6)}… is in these files`);
const nowhereAtAll = (text, fleet = T.fleet) => nowhere(text, { fleet, allowed: [] });
const script = rules => writeFileSync(join(T.fleet.dir, 'model-script.json'), JSON.stringify(rules));
// A file in Spark 3's shared folder, which the `files` tool reads.
function plant(fleet, text) {
  const dir = join(fleet.root, 'spark3', '.local', 'share', 'spark-portal', 'workspaces', 'shared');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(join(dir, 'key-note.txt'), text);
  return join(dir, 'key-note.txt');
}
// The stand-in Bot API.
const tgPost = async (p, body) => (await fetch(`http://127.0.0.1:${T.fleet.telegramPort}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
const tgCalls = () => { const f = join(T.fleet.dir, 'telegram-calls.jsonl'); return existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : []; };
let msgId = 900;
const tgSay = text => { const id = msgId++; return tgPost('/__push', { message: { message_id: id, date: Math.floor(Date.now() / 1000), chat: { id: OWNER_TG, type: 'private' }, from: { id: OWNER_TG, is_bot: false, first_name: 'Owner' }, text } }).then(() => id); };
const sentAfter = from => waitFor(() => tgCalls().slice(from).find(c => c.method === 'sendMessage'), { timeout: 30000, every: 200, what: 'a Telegram message' });
let pageChat = null;

describe('keys given once', { concurrency: 1 }, () => {
  // T132 (part): the key kept by name; its value in no chat, journal, error or tool result.
  test('the page: /key NAME value is kept by name and answered by code, the brain is not asked, and only the secrets file holds the value', async () => {
    pageChat = await newChat();
    const asked = requests().length;
    const r = await say(pageChat, `/key HF_TOKEN ${V.page}`);
    assert.match(r.text, /^Kept your key HF_TOKEN\. It stays in the secrets file on Spark 2 and is never shown/);
    assert.equal(secretsOf().keys.HF_TOKEN.value, V.page);
    assert.equal(secretsOf().github.token, OLD, 'the others are kept as they were');
    assert.deepEqual((await chatMessages(pageChat)).map(m => [m.role, m.content.split('\n')[0]]), [['user', '/key HF_TOKEN [kept]'], ['assistant', r.text.split('\n')[0]]]);
    assert.equal(requests().length, asked, 'the brain was not asked');
    assert.ok(auditLines().some(l => l.action === 'key-given' && l.args.name === 'HF_TOKEN' && l.args.kept === true));
    nowhere(V.page);
  });

  test('a later turn: the brain gets the chat with the key replaced, and the owner\'s own later message with the value hidden', async () => {
    const r = await say(pageChat, `what did I just give you? it was ${V.page}`);
    const last = requests().at(-1);
    assert.match(last.lastUser, /it was \[hidden\]$/);
    assert.match(r.text, /I saw 2 earlier messages/);
    assert.equal((await chatMessages(pageChat)).at(-2).content, 'what did I just give you? it was [hidden]');
    nowhere(V.page);
  });

  test('a kept key a tool prints, as is or in base64, comes back hidden: to the brain, to an agent, in the journal and the chat', async () => {
    const note = plant(T.fleet, `starting\nHF_TOKEN in use: ${V.page}\nas base64: ${Buffer.from(V.page).toString('base64')}\nready\n`);
    try {
      script([{ match: '^show me the key note on spark 3$', calls: [{ name: 'files', arguments: { spark: 'spark3', file: 'key-note.txt' } }] }]);
      const r = await say(pageChat, 'show me the key note on spark 3');
      const back = requests().at(-1);
      assert.equal(back.lastRole, 'tool');
      assert.match(back.results[0].content, /HF_TOKEN in use: \[hidden\]/);
      assert.match(back.results[0].content, /as base64: \[hidden\]/);
      assert.match(r.text, /files said/);
      const look = await createKey('keys-look');
      const got = await call(look.token, 'files', { spark: 'spark3', file: 'key-note.txt' });
      assert.equal(got.isError, false, got.text);
      assert.match(got.text, /in use: \[hidden\]/);
      assert.ok(!got.raw.includes(V.page) && !got.raw.includes(Buffer.from(V.page).toString('base64')));
    } finally { rmSync(note, { force: true }); rmSync(join(T.fleet.dir, 'model-script.json'), { force: true }); }
    nowhere(V.page);
    nowhere(Buffer.from(V.page).toString('base64').slice(0, 24));
  });

  // T133 (part): the heartbeat's address given in chat; one request with nothing in it, none before.
  test('a heartbeat address pasted in the owner\'s chat starts the beat at once and is in no chat file', async () => {
    assert.deepEqual(beats, [], 'no beat before an address was given');
    const chat = await newChat();
    const r = await say(chat, `here is my check: ${BEAT.toUpperCase().replace('HTTPS://HC-PING.COM', 'https://hc-ping.com')} thanks`);
    assert.match(r.text, /^Kept the heartbeat’s address\. Spark Console now sends hc-ping\.com an empty request every 5 minutes/);
    assert.equal(secretsOf().heartbeat.url, BEAT);
    await waitFor(() => beats.includes(`/${BEAT_ID}`), { timeout: 15000, what: 'the first beat' });
    assert.equal((await chatMessages(chat))[0].content, 'here is my check: [key HEARTBEAT kept] thanks');
    assert.equal((await api('/heartbeat')).json.saved, true);
    nowhere(BEAT_ID);
    nowhereAtAll(BEAT_ID.toUpperCase());
  });

  test('GITHUB: a token the stand-in GitHub refuses is not kept and the old one stays; one it takes (on the next line) is kept for the repository set up', { skip: REAL_GIT ? false : 'no git here', timeout: 120000 * SLOW }, async () => {
    const chat = await newChat();
    const no = await say(chat, `/key GITHUB ${BAD}`);
    assert.match(no.text, /^The GitHub token wasn’t kept: GitHub didn’t take it for someone\/spark-console, or couldn’t be reached, and the one before stays\./);
    assert.deepEqual(secretsOf().github, { repo: REPO_NAME, token: OLD });
    nowhereAtAll(BAD);
    const yes = await say(chat, `/key GITHUB\n${GOOD}`);
    assert.match(yes.text, /^Kept the GitHub token\. GitHub took it for someone\/spark-console/);
    assert.deepEqual(secretsOf().github, { repo: REPO_NAME, token: GOOD });
    assert.deepEqual((await chatMessages(chat)).filter(m => m.role === 'user').map(m => m.content), ['/key GITHUB [not kept]', '/key GITHUB [kept]']);
    nowhere(GOOD);
  });

  test('a bad name, a key in the name\'s place and a key with no name keep nothing, and say nothing of it back', async () => {
    const chat = await newChat(), was = JSON.stringify(secretsOf().keys);
    for (const words of [`/key 9LIVES ${V.bad}`, `/key ${V.bad}`, `/key hf_${'Ab3'.repeat(8)} ${V.bad}`]) {
      const r = await say(chat, words);
      assert.match(r.text, /^Nothing was kept/, words);
    }
    assert.equal(JSON.stringify(secretsOf().keys), was);
    assert.deepEqual((await chatMessages(chat)).filter(m => m.role === 'user').map(m => m.content), ['/key [not kept]', '/key [not kept]', '/key [not kept]']);
    for (const t of [V.bad, V.bad.toUpperCase(), 'Ab3Ab3Ab3Ab3', 'AB3AB3AB3AB3']) nowhereAtAll(t);
  });

  test('a member\'s /key and an agent\'s keep nothing, and the value reaches neither the chat file nor the brain', async () => {
    const asMember = { 'tailscale-user-login': MEMBER };
    const chat = await newChat(asMember);
    await say(chat, `/key MEMBER_KEY ${V.member}`, asMember);
    assert.equal(requests().at(-1).lastUser.endsWith('/key [hidden]'), true, requests().at(-1).lastUser);
    const agent = await createKey('keys-agent');
    const a = await call(agent.token, 'ask_sparkie', { message: `/key AGENT_KEY ${V.agent}` });
    assert.equal(a.isError, false, a.text);
    assert.match(requests().at(-1).lastUser, /\/key \[hidden\]$/);
    assert.deepEqual(Object.keys(secretsOf().keys).sort(), ['HF_TOKEN']);
    nowhereAtAll(V.member);
    nowhereAtAll(V.agent);
  });

  // T132 (part): from Telegram, the message is deleted and the key kept by name.
  test('Telegram: the message that held the key is deleted and the key kept; a delete that fails tells the owner to delete it', async () => {
    await waitFor(async () => (await api('/telegram')).json.state === 'ok', { what: 'Telegram polling' });
    let from = tgCalls().length;
    const id = await tgSay(`/key TG_KEY ${V.tg}`);
    const sent = await sentAfter(from);
    assert.match(sent.body.text, /^Kept your key TG_KEY\./);
    assert.match(sent.body.text, /Your message that held it was deleted from this chat\.$/);
    assert.deepEqual(tgCalls().slice(from).filter(c => c.method === 'deleteMessage').map(c => c.body), [{ chat_id: OWNER_TG, message_id: id }]);
    assert.equal(secretsOf().keys.TG_KEY.value, V.tg);
    const tgChat = (await api('/chats')).json.chats.find(c => c.channel === 'telegram');
    assert.deepEqual((await chatMessages(tgChat.id)).filter(m => m.role === 'user').map(m => m.content), ['/key TG_KEY [kept]']);
    await tgPost('/__mode', { noDelete: true });
    try {
      from = tgCalls().length;
      await tgSay(`/key TG_KEPT\n${V.tgKept}`);
      const told = await sentAfter(from);
      assert.match(told.body.text, /^Kept your key TG_KEPT\./);
      assert.match(told.body.text, /couldn’t be deleted from Telegram: delete it yourself\.$/);
      assert.equal(secretsOf().keys.TG_KEPT.value, V.tgKept);
    } finally { await tgPost('/__mode', {}); }
    nowhere(V.tg);
    nowhere(V.tgKept);
  });

  test('a key typed where the name goes, with words after it, keeps nothing and is said back nowhere, on the page and on Telegram', async () => {
    const chat = await newChat(), was = JSON.stringify(secretsOf().keys);
    for (const words of [`/key ${K.low} WANDB_API_KEY`, `/key ${K.low} hf`, `/key ${K.low}\nWANDB`, `/key ${K.up} WANDB_API_KEY`]) {
      const r = await say(chat, words);
      assert.match(r.text, /^Nothing was kept/, words);
    }
    assert.deepEqual((await chatMessages(chat)).filter(m => m.role === 'user').map(m => m.content), Array(4).fill('/key [not kept]'));
    const from = tgCalls().length;
    await tgSay(`/key ${K.tg} WANDB_API_KEY`);
    assert.match((await sentAfter(from)).body.text, /^Nothing was kept/);
    assert.equal(JSON.stringify(secretsOf().keys), was);
    for (const k of [K.low, K.up, K.tg]) { nowhereAtAll(k); nowhereAtAll(k.toUpperCase()); }
  });

  test('words or quotes round a key keep nothing, and the answer says so', async () => {
    const chat = await newChat();
    for (const words of [`/key WANDB ${W} thanks, use it`, `/key WANDB\n${W}\nthanks!`, `/key WANDB "${W}"`]) {
      const r = await say(chat, words);
      assert.match(r.text, /^WANDB wasn’t kept: write the key alone after its name, with no other words and no quotes\./, words);
    }
    assert.equal(secretsOf().keys.WANDB, undefined);
    nowhereAtAll(W);
  });

  test('an error that quotes a kept key hides it: a tool\'s refusal, the audit and the journal', async () => {
    const chat = await newChat();
    await say(chat, `/key ERR_KEY ${V.err}`);
    const look = await createKey('keys-err');
    const r = await call(look.token, 'where_it_fits', { model: `no-such-model-${V.err}` });
    assert.equal(r.isError, true, r.text);
    assert.ok(!r.raw.includes(V.err), r.text);
    nowhere(V.err);
  });

  test('after a restart: the daily copy holds no key, and a kept key a tool prints still comes back hidden', { timeout: 180000 * SLOW }, async () => {
    const first = T.fleet;
    process.kill(first.servicePid(), 'SIGTERM');
    await waitFor(() => first.serviceExit(), { what: 'the console to end' });
    const env = { SPARK_CONSOLE_BACKUP_MS: '600000', SPARK_CONSOLE_BACKUP_FIRST_MS: '2000', PATH: ENV.PATH };
    const B = await startMock({ watchMs: 60000, env, prepare: ({ dir, stateDir }) => {
      homeFor(env, join(first.dir, SECRETS_TAIL))({ dir });
      // (the state as it was, but the files the stand-in fleet writes for each start: its brain's port, its links)
      cpSync(first.stateDir, stateDir, { recursive: true, filter: p => !lstatSync(p).isSocket() && !/\/(main|links|access)\.json$/.test(p) });
      cpSync(first.journalDir, join(dir, 'journal'), { recursive: true });
    } });
    try {
      const h = await waitFor(async () => { const x = await (await fetch(`${B.base}/health`)).json(); return x.lastBackup && x; }, { timeout: 30000, what: 'the copy' });
      assert.equal(h.lastBackup.ok, true, JSON.stringify(h.lastBackup));
      const copy = join(B.root, h.lastBackup.to, '.local', 'share', 'spark-console', 'backups', h.lastBackup.file);
      const inside = spawnSync('tar', ['-xzOf', copy], { maxBuffer: 1 << 28 }).stdout;
      assert.ok(inside.length > 1000 && inside.includes('/key HF_TOKEN [kept]'), 'the copy holds the chats');
      for (const v of [V.page, V.tg, V.tgKept, V.err, GOOD, BEAT_ID]) assert.ok(!inside.includes(v), `${v.slice(0, 6)}… in the copy`);
      const note = plant(B, `HF_TOKEN in use: ${V.page}\n`);
      const look = await (await fetch(`${B.base}/agents`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-spark-console': '1', origin: B.origin }, body: JSON.stringify({ name: 'keys-after' }) })).json();
      const got = await call(look.token, 'files', { spark: 'spark3', file: 'key-note.txt' }, { url: B.mcp });
      assert.match(got.text, /in use: \[hidden\]/);
      rmSync(note, { force: true });
      for (const v of [V.page, V.tg, V.tgKept, V.err, GOOD, BEAT_ID]) nowhere(v, { fleet: B, allowed: [join(B.dir, SECRETS_TAIL)] });
    } finally { await B.stop(); }
  });
});

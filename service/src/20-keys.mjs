/* ───────── keys given once: taken out of the owner's words at the door, kept by name ───────── */
// Area: safety        Rules: R50, R7, R32        Tests: app-keys.test.mjs
// Owns: none
// Timers: none        Wakes: none
// A key, token or address the owner gives in their own chat (the page, or the paired Telegram chat) is taken out of the
// message here, before anything else reads it: the chat file, the journal, the audit, a title, the gate, the brain.
// Two forms: "/key NAME value" (the value alone, after the name or on the next line), and the heartbeat's address, known by
// its shape anywhere in the words. It is kept by name in the secrets file (03-secrets.mjs, through secretsWrite), never
// shown back, and its exact value is hidden wherever text is written or sent (keptHidden, which hideKeys runs first).
// Two names have a home of their own, each saved through its own check: GITHUB, the pull install's token (tried with the
// fetch `pull.sh setup` makes, and kept by it only if GitHub takes it), and HEARTBEAT, the heartbeat's address (saved
// as PUT /heartbeat saves it, and the beat starts). Any other NAME goes in the secrets file's `keys`, 30 at most. Such a
// message is answered by code, never by the brain: the chat keeps the words with the value replaced by what became of
// it, then the answer as a notice. On Telegram the message that held it is deleted, and if that fails the owner is told
// to delete it. Nobody else gives a key: a member's, an agent's or a carry-on turn's words go to sparkieTurn, whose first
// line (keysHidden) hides a /key form, a heartbeat's address and every kept value, and keeps nothing. (docs/rules/R50.md)
const KEY_NAME_RE = /^[A-Z][A-Z0-9_]{1,40}$/, KEYS_MAX = 30, KEY_BYTES = 4096, KEY_MIN = 8;
// "/key" at the start of the words (Telegram may add the bot's name: /key@bot).
const KEY_FORM = /^\s*\/key(?:@\w+)?(?=\s|$)/i;
// The heartbeat's address, with or without its scheme: the shape maskSecrets hides (20-mcp.mjs).
const BEAT_SHAPE = /\b(?:https?:\/\/)?hc-ping\.com\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/gi;
// What `pull.sh setup` takes as a token, and where it is, beside the secrets file it writes.
const GITHUB_TOKEN_RE = /^[A-Za-z0-9_]{20,255}$/, SECRETS_TAIL = '/.config/spark-console/secrets.json';
const PULL_SETUP = 'bash ~/.local/share/spark-console/pull.sh setup <owner>/<repository>';

// A name as typed, in capitals, that doesn't look like a key itself: no known key shape, and no piece between its
// underscores of 8 or more characters that mixes letters and digits (a key typed where the name goes, review of A14a).
const keyNameOk = typed => KEY_NAME_RE.test(typed) && hideKeys(typed) === typed && !typed.split('_').some(p => p.length >= 8 && /[A-Z]/.test(p) && /\d/.test(p));
// What the words give: null when they hold no key; else the key ({ name, value }; name null when it isn't one a key may
// have, or looks like a key itself), whether it came as /key, and the words. Reads only; keeps nothing.
function keysGiven(text) {
  const t = String(text), form = KEY_FORM.exec(t);
  if (form) {
    const rest = t.slice(form[0].length), n = /^[ \t]*(\S*)/.exec(rest), typed = n[1];
    return { form: true, name: keyNameOk(typed) ? typed : null, value: rest.slice(n[0].length).trim(), text: t };
  }
  const found = t.match(BEAT_SHAPE);
  return found ? { form: false, name: 'HEARTBEAT', value: found[0], text: t } : null;
}
// The first thing a turn does with its words (sparkieTurn): a /key form, a heartbeat's address and every kept key's
// value are hidden, so nothing after it (the chat file, the journal, the gate, the brain) reads them. Keeps nothing.
const keysHidden = text => keptHidden(KEY_FORM.test(String(text)) ? '/key [hidden]' : String(text).replace(BEAT_SHAPE, '[hidden]'));

// Keeps one key and says what became of it ({ kept, line }). Never throws, and the line never holds the value.
async function keepKey({ name, value }, via) {
  if (!name) return { kept: false, line: 'Nothing was kept. Write /key, then the key’s name (capital letters, digits and _, like HF_TOKEN), then the key.' };
  // (the name isn't said back: with nothing after it, it may be the key itself)
  if (!value) return { kept: false, line: 'Nothing was kept: write /key, then the key’s name, then the key.' };
  // (one run with no spaces and no quotes at its ends: kept with words or quotes round it, the mask could never find the
  // key itself, review of A14a)
  if (!/^\S+$/.test(value) || /^["'`]|["'`]$/.test(value)) return { kept: false, line: `${name} wasn’t kept: write the key alone after its name, with no other words and no quotes.` };
  if (value.length < KEY_MIN) return { kept: false, line: `${name} wasn’t kept: a key needs at least ${KEY_MIN} characters, so it can be hidden everywhere.` };
  if (Buffer.byteLength(value) > KEY_BYTES) return { kept: false, line: `${name} wasn’t kept: a key holds 4 KB at most.` };
  try {
    if (name === 'GITHUB') return await keepGithub(value);
    if (name === 'HEARTBEAT') return await keepBeat(value, via);
    return keepNamed(name, value);
  } catch (e) {
    return { kept: false, line: `${name} wasn’t kept: ${e instanceof HttpError ? e.message : 'the secrets file couldn’t be written.'}` };
  }
}
function keepNamed(name, value) {
  let had = false;
  secretsWrite(s => {
    const keys = s.keys && typeof s.keys === 'object' && !Array.isArray(s.keys) ? { ...s.keys } : {};
    had = Object.hasOwn(keys, name);
    if (!had && Object.keys(keys).length >= KEYS_MAX) throw new HttpError(409, `${KEYS_MAX} keys are kept already, the most there can be. Give one of them a new value instead.`);
    keys[name] = { value, at: new Date().toISOString() };
    return { ...s, keys };
  });
  return { kept: true, line: `Kept your key ${name}${had ? ', in place of the one you gave before' : ''}. It stays in the secrets file on Spark 2 and is never shown, not even to Sparkie.` };
}
// GITHUB: `pull.sh setup` tries it with one fetch and keeps it only if GitHub takes it; the repository stays the one set
// up. Kept means the secrets file holds it afterwards.
async function keepGithub(value) {
  const repo = secretsRead()?.github?.repo, home = SECRETS_FILE?.endsWith(SECRETS_TAIL) ? SECRETS_FILE.slice(0, -SECRETS_TAIL.length) : null;
  const script = home && `${home}/.local/share/spark-console/pull.sh`;
  if (!script || !existsSync(script) || typeof repo !== 'string' || !/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(repo)) {
    return { kept: false, line: `The GitHub token wasn’t kept: the install from GitHub isn’t set up on Spark 2 yet. Set it up there once, in a terminal: ${PULL_SETUP}` };
  }
  if (!GITHUB_TOKEN_RE.test(value)) return { kept: false, line: 'The GitHub token wasn’t kept: that isn’t one (letters, digits and _ only).' };
  // (the token goes in on its input, as `setup` reads it with no terminal; a test's own GitHub only under ALL_LOCAL)
  const env = { HOME: home, PATH: process.env.PATH || '/usr/bin:/bin', LANG: 'C.UTF-8', ...(ALL_LOCAL ? { SPARK_CONSOLE_ALL_LOCAL: '1', SPARK_CONSOLE_REPO_URL: process.env.SPARK_CONSOLE_REPO_URL || '' } : {}) };
  const ran = await new Promise(resolve => {
    let p;
    try { p = spawn('bash', [script, 'setup', repo], { env, stdio: ['pipe', 'ignore', 'ignore'] }); } catch { resolve(false); return; }
    const t = setTimeout(() => p.kill('SIGKILL'), 120000);
    p.on('error', () => { clearTimeout(t); resolve(false); });
    p.on('close', () => { clearTimeout(t); resolve(true); });
    p.stdin.on('error', () => {});
    p.stdin.end(`${value}\n`);
  });
  // (pull.sh wrote the file: what maskSecrets hides is read again)
  Object.assign(keptSeen, { at: 0, mtime: null });
  if (secretsRead()?.github?.token === value) return { kept: true, line: `Kept the GitHub token. GitHub took it for ${repo}, and the install from GitHub uses it from now on. It is never shown, not even to Sparkie.` };
  return { kept: false, line: `The GitHub token wasn’t kept: ${ran ? `GitHub didn’t take it for ${repo}, or couldn’t be reached` : 'pull.sh couldn’t be run'}, and the one before stays. Make a new one (this repository only, Contents: read) and give it again: /key GITHUB, then the token.` };
}
// HEARTBEAT: the check the route makes, then the same save, and the beat starts (20-beat.mjs).
async function keepBeat(value, via) {
  const url = `https://${value.replace(/^https?:\/\//i, '').toLowerCase()}`;
  if (!BEAT_URL_RE.test(url)) return { kept: false, line: 'The heartbeat’s address wasn’t kept: it is https://hc-ping.com/ and the check’s id, from Healthchecks.io, with nothing after it.' };
  await beatSave(url, via);
  return { kept: true, line: 'Kept the heartbeat’s address. Spark Console now sends hc-ping.com an empty request every 5 minutes, so Healthchecks.io tells you when Spark 2 goes quiet.' };
}

// The owner's message that gave a key, in their chat `conv`: kept, then the chat keeps the words with the value replaced
// by what became of it and the answer as a notice, the journal the words as kept, the audit the name. `after` is a line
// to add (Telegram's delete). Gives the notice.
async function giveKey(conv, given, via, channel = null, after = '') {
  const r = await keepKey(given, via), mark = r.kept ? 'kept' : 'not kept';
  // (a name is said back only when a key came after it: in "/key <the key>" with nothing after, the name is the key)
  const name = given.name && given.value ? given.name : null;
  const words = given.form ? `/key ${name ? `${name} ` : ''}[${mark}]` : given.text.replace(BEAT_SHAPE, `[key HEARTBEAT ${mark}]`);
  const at = new Date().toISOString();
  const message = { role: 'assistant', content: maskSecrets(`${r.line}${after ? `\n${after}` : ''}`), createdAt: at, notice: true, word: true };
  // (a full chat still gets the answer; it just isn't saved there, as with the owner's words)
  if (conv.messages.length < LIMITS.messages - 1) {
    conv.messages.push({ role: 'user', content: maskSecrets(words), context: null, createdAt: at, key: true }, message);
    conv.updatedAt = at;
    saveChats();
  }
  journalSaid(conv, words, null, channel, null);
  audit({ via, actor: channel === 'telegram' ? 'owner on Telegram' : 'owner', action: 'key-given', args: { name, kept: r.kept }, ok: r.kept });
  return message;
}
// The page (24-handler.mjs, the owner's own chat, before the owner's words): answered in the stream the page reads.
async function answerKeys(res, conv, text, viewer) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', 'x-accel-buffering': 'no' });
  res.write(`data: ${JSON.stringify({ type: 'started' })}\n\n`);
  try {
    const message = await giveKey(conv, keysGiven(text), viewer.session ? 'internet' : 'page');
    res.end(`data: ${JSON.stringify({ type: 'done', message })}\n\n`);
  } catch (e) {
    console.error(`Keeping a key: ${maskSecrets(e.message)}`);
    res.end(`data: ${JSON.stringify({ type: 'error', error: 'Something went wrong with that key. Give it again.' })}\n\n`);
  }
}
// The paired Telegram chat (tgUpdate, before anything else reads the words): the message is deleted first, the key
// kept, then one fixed line. True when the message held a key. Someone else's words (forwarded) are left to tgUpdate.
async function tgKeys(m) {
  if (m.forward_origin || m.forward_from || m.forward_from_chat || m.forward_date || m.via_bot || typeof m.text !== 'string') return false;
  const given = keysGiven(m.text), b = tgPaired();
  if (!given || !b) return false;
  const gone = Number.isSafeInteger(m.message_id) && await tgCall(b.token, 'deleteMessage', { chat_id: b.chatId, message_id: m.message_id }, { timeoutMs: 10000 }).then(() => true, () => false);
  const after = gone ? 'Your message that held it was deleted from this chat.' : 'Your message that held it couldn’t be deleted from Telegram: delete it yourself.';
  const message = await giveKey(tgConv(), given, 'telegram', 'telegram', after);
  await tell('system', message.content);
  return true;
}

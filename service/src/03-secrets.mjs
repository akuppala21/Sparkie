/* ───────── secrets: one owner-only file outside the state folder ───────── */
// Area: ground        Rules: R20, R32, R50        Tests: telegram.test.mjs, needs.test.mjs, app-keys.test.mjs
// Owns: secrets.json (writers: secretsWrite; outside the state folder)
// Timers: none        Wakes: none
// What Spark Console keeps for the owner that must never travel (Telegram's bot token and the chat it's paired with) is
// in ~/.config/spark-console/secrets.json: folder 0700, file 0600, outside the state folder, so the daily copy and the
// install snapshots never carry it and no restore brings an old pairing back (docs/architecture.md R32). Telegram's
// token is typed only on the passkey page; a key the owner gives in their own chat is kept here by name (20-keys.mjs,
// R50). A file that exists but can't be read is never written over. Under ALL_LOCAL the store is off
// unless a test names its own file, so tests never read the developer's home.
const SECRETS_FILE = ALL_LOCAL ? (/^\/[^\0]+$/.test(process.env.SPARK_CONSOLE_SECRETS_FILE || '') ? process.env.SPARK_CONSOLE_SECRETS_FILE : null)
  : `${homedir()}/.config/spark-console/secrets.json`;
// null: missing or fine; otherwise why it couldn't be read.
let secretsProblem = null;
function secretsRead() {
  if (!SECRETS_FILE) return {};
  let text;
  try { text = readFileSync(SECRETS_FILE, 'utf8'); } catch (e) {
    if (e.code === 'ENOENT') { secretsProblem = null; return {}; }
    secretsProblem = e.code || 'unreadable';
    return null;
  }
  try {
    const v = JSON.parse(text);
    if (v && typeof v === 'object' && !Array.isArray(v)) { secretsProblem = null; return v; }
  } catch {}
  secretsProblem = 'unreadable';
  return null;
}
// change(current) returns the whole new content. Written as a temporary file, then renamed.
function secretsWrite(change) {
  if (!SECRETS_FILE) throw new HttpError(409, 'This copy of Spark Console keeps no secrets.');
  const now = secretsRead();
  if (now === null) throw new HttpError(500, `${SECRETS_FILE} can’t be read. Fix it or remove it, then try again.`);
  const next = change({ ...now });
  const dir = SECRETS_FILE.slice(0, SECRETS_FILE.lastIndexOf('/'));
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { chmodSync(dir, 0o700); } catch {}
  const tmp = `${SECRETS_FILE}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
  renameSync(tmp, SECRETS_FILE);
  // (what maskSecrets hides is read again at its next use)
  Object.assign(keptSeen, { at: 0, mtime: null });
  return next;
}
// Every value kept here (named keys, the GitHub token, the heartbeat's address, Telegram's token: R50), with the forms
// it may be printed in (its %-form in an address; base64 at each of the three alignments, its ends cut where they hang
// on the bytes beside it). hideKeys (20-mcp.mjs) hides each by its exact text wherever text is written or sent. The
// file is looked at again at most once a second, and read again only when it changed (pull.sh writes it too); no timer.
// Only values of 8 characters or more, so a plain word is never hidden. A file that can't be read keeps the last forms.
const keptSeen = { at: 0, mtime: null, forms: [] };
function keptForms() {
  if (!SECRETS_FILE || Date.now() - keptSeen.at < 1000) return keptSeen.forms;
  keptSeen.at = Date.now();
  let mtime = null;
  try { mtime = statSync(SECRETS_FILE).mtimeMs; } catch {}
  if (mtime === keptSeen.mtime) return keptSeen.forms;
  const s = secretsRead();
  if (s === null) return keptSeen.forms;
  keptSeen.mtime = mtime;
  const named = s.keys && typeof s.keys === 'object' ? Object.values(s.keys).map(k => k?.value) : [];
  const forms = new Set();
  for (const v of [...named, s.github?.token, s.heartbeat?.url, s.telegram?.token]) {
    if (typeof v !== 'string' || v.length < 8) continue;
    forms.add(v);
    try { forms.add(encodeURIComponent(v)); } catch {}
    const bytes = Buffer.from(v);
    for (let k = 0; k < 3; k++) {
      const b = Buffer.concat([Buffer.alloc(k), bytes]).toString('base64');
      const inner = b.slice(k ? 4 : 0, (k + bytes.length) % 3 ? b.length - 4 : b.length);
      if (inner.length >= 8) forms.add(inner);
    }
  }
  // (the longest first, so a value that holds another is hidden whole)
  keptSeen.forms = [...forms].sort((a, b) => b.length - a.length);
  return keptSeen.forms;
}
function keptHidden(text) {
  let t = String(text);
  if (t.length < 8) return t;
  for (const f of keptForms()) if (t.includes(f)) t = t.split(f).join('[hidden]');
  return t;
}

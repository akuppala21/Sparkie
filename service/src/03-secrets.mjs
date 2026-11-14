/* ───────── secrets: one owner-only file outside the state folder ───────── */
// What Spark Console keeps for the owner that must never travel (Telegram's bot token and the chat it's paired with) is
// in ~/.config/spark-console/secrets.json: folder 0700, file 0600, outside the state folder, so the daily copy and the
// install snapshots never carry it and no restore brings an old pairing back (docs/architecture.md R32). It is typed
// only on the passkey page. A file that exists but can't be read is never written over. Under ALL_LOCAL the store is off
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
  return next;
}

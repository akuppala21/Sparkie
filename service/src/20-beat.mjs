/* ───────── the outside heartbeat: an outside service notices when the hub stops ───────── */
// Area: safety        Rules: R32, R51        Tests: beat.test.mjs, app-keys.test.mjs
// Owns: none
// Timers: beatStart (once, a minute after the listen callback: the first beat), beatOnce (every 5 minutes after that,
//   and from a beat at once when an address is saved)
// Wakes: none
// Once the owner has saved a check's ping address (Healthchecks.io: https://hc-ping.com/<uuid>), pasted in their own chat
// (20-keys.mjs) or with the passkey (PUT /heartbeat),
// Spark Console sends it one GET every 5 minutes, so that service raises the alarm (by email, or its own Telegram bot)
// when the hub or the console goes quiet. Silence is the signal, so this is the one timer that ticks when nothing
// changed. The request carries nothing: no body, no query, no cookie, one fixed User-Agent. The host is fixed; what the
// owner saves only names the check, and a redirect is never followed. The address is a secret (whoever holds it can beat
// in the hub's place): it is kept only in the secrets file (03-secrets.mjs), given only by the owner, and is in no
// answer, log, event or audit line. No address saved: nothing is ever sent. The tick starts in the local port's listen
// callback (25-backup-and-start.mjs), like Telegram's loop, so a second copy never beats, and its first beat waits a
// minute: a console that dies a few seconds after each start (systemd starts it again 3 s later) never keeps the check
// green. A beat failing for an hour is one needs-you line (20-needs.mjs). Nothing comes in. (docs/rules/R32.md)
const BEAT_HOST = 'https://hc-ping.com';
const BEAT_URL_RE = /^https:\/\/hc-ping\.com\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// Tests point it at a stand-in on this machine, and shorten the times; under ALL_LOCAL without one, nothing is sent.
const BEAT_API = ALL_LOCAL ? (/^http:\/\/127\.0\.0\.1:\d+$/.test(process.env.SPARK_CONSOLE_BEAT_API || '') ? process.env.SPARK_CONSOLE_BEAT_API : null) : BEAT_HOST;
const beatEnv = (name, ms) => (ALL_LOCAL && Number(process.env[name]) > 0 ? Number(process.env[name]) : ms);
const BEAT_MS = beatEnv('SPARK_CONSOLE_BEAT_MS', 300000), BEAT_LATE_MS = beatEnv('SPARK_CONSOLE_BEAT_LATE_MS', 3600000);
const BEAT_FIRST_MS = beatEnv('SPARK_CONSOLE_BEAT_FIRST_MS', 60000);
const BEAT_WAIT_MS = 10000;
// Kept in memory only (a restart starts it again): when a beat last worked, since when they fail, and the last miss as a
// fixed phrase (never an error's own text).
const beat = { okAt: null, failingSince: null, miss: null, sending: null, timer: null, first: null, started: false };
const beatAddress = () => { const u = secretsRead()?.heartbeat?.url; return typeof u === 'string' && BEAT_URL_RE.test(u) ? u : null; };
// One GET to the check's address. Resolves when it has ended (10 s at most); never throws.
function beatOnce() {
  const url = beatAddress();
  if (!url) beat.failingSince = beat.miss = null;
  if (!url || !BEAT_API) return Promise.resolve();
  return (beat.sending ||= new Promise(resolve => {
    let done = false;
    const end = miss => {
      if (done) return;
      done = true;
      if (miss) { beat.failingSince ??= Date.now(); beat.miss = miss; } else Object.assign(beat, { okAt: Date.now(), failingSince: null, miss: null });
      beat.sending = null;
      resolve();
    };
    const to = new URL(BEAT_API + new URL(url).pathname);
    const req = (to.protocol === 'https:' ? https : http).request(to, { method: 'GET', agent: false, headers: { 'User-Agent': 'spark-console' } }, res => {
      res.on('error', () => {});
      res.resume();
      end(res.statusCode >= 200 && res.statusCode < 300 ? null : `answered ${res.statusCode}`);
    });
    req.on('error', () => end('couldn’t connect'));
    setTimeout(() => { req.destroy(); end('no answer in 10 seconds'); }, BEAT_WAIT_MS).unref?.();
    req.end();
  }));
}
// Started in the local port's listen callback with a wait (the first beat goes from one timeout after it), and again,
// with none, when an address is saved: a beat now, then one each interval.
function beatStart(wait = 0) {
  beat.started = true;
  clearTimeout(beat.first);
  clearInterval(beat.timer);
  if (wait > 0) { beat.first = setTimeout(() => beatStart(), wait); beat.first.unref?.(); return Promise.resolve(); }
  beat.timer = setInterval(beatOnce, BEAT_MS);
  beat.timer.unref?.();
  return beatOnce();
}
// Beats have failed for an hour: one line on the needs-you list (20-needs.mjs).
const beatLate = () => beat.failingSince !== null && Date.now() - beat.failingSince >= BEAT_LATE_MS;
const BEAT_WORDS = {
  off: 'No check is saved, so nothing is sent. Make a check at Healthchecks.io (period 5 minutes, grace 10 minutes) and save its ping address here with your passkey.',
  unreadable: `The secrets file can’t be read, so no beat is sent. Fix or remove ~/.config/spark-console/secrets.json on ${hubName()}.`,
  waiting: 'Saved. The first beat goes out shortly.',
  ok: 'Working: hc-ping.com hears from Spark Console every 5 minutes.',
  failing: `hc-ping.com isn’t taking the beats. Check that ${hubName()} reaches the internet and that the check still exists at Healthchecks.io.`,
};
// What GET /heartbeat shows: never the address.
function beatView() {
  const saved = Boolean(beatAddress()), at = t => (t ? new Date(t).toISOString() : null);
  const state = secretsRead() === null ? 'unreadable' : !saved ? 'off' : beat.failingSince !== null ? 'failing' : beat.okAt ? 'ok' : 'waiting';
  return { saved, state, whatToDo: BEAT_WORDS[state], everySeconds: BEAT_MS / 1000, lastOkAt: at(beat.okAt), failingSince: at(beat.failingSince), miss: beat.miss };
}
// GET: the view. PUT {url}: save the check's address (the passkey, at the gate in 24-handler.mjs). DELETE: remove it,
// never with the passkey, so the owner can always stop it.
async function heartbeatRoute(req, res, viewer) {
  const via = viewer.session ? 'internet' : 'page';
  if (req.method === 'GET') return send(res, 200, beatView());
  if (req.method === 'DELETE') {
    const now = secretsRead(), had = Boolean(now?.heartbeat);
    // (a file that can't be read is never written over: secretsWrite answers 500 and says so)
    if (now === null || had) secretsWrite(s => { const { heartbeat, ...rest } = s; return rest; });
    Object.assign(beat, { okAt: null, failingSince: null, miss: null });
    audit({ via, actor: 'owner', action: 'heartbeat-removed', args: { fileChanged: had }, ok: true });
    return send(res, 200, beatView());
  }
  if (req.method !== 'PUT') throw new HttpError(405, 'Use GET, PUT or DELETE.');
  if (!passkeys().length) throw new HttpError(409, 'Set up your passkey first: saving the check’s address needs it.');
  if (!SECRETS_FILE) throw new HttpError(409, 'This copy of Spark Console keeps no secrets, so it sends no heartbeat.');
  const given = (await readBody(req, 2000))?.url, url = typeof given === 'string' ? given.trim() : '';
  if (!BEAT_URL_RE.test(url)) throw new HttpError(400, 'That isn’t a check’s ping address. Copy it from Healthchecks.io: https://hc-ping.com/ and the check’s id, with nothing after it.');
  await beatSave(url, via);
  return send(res, 200, beatView());
}
// Saving a check's address, from this route or pasted in the owner's own chat (20-keys.mjs, R51): the same save, and the
// beat starts the same way.
async function beatSave(url, via) {
  secretsWrite(s => ({ ...s, heartbeat: { url, savedAt: new Date().toISOString() } }));
  Object.assign(beat, { okAt: null, failingSince: null, miss: null });
  audit({ via, actor: 'owner', action: 'heartbeat-saved', args: {}, ok: true });
  // (only a copy whose tick was started, the one that holds the port, beats)
  if (beat.started) await beatStart();
}

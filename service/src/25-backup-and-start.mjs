/* ───────── a copy of the console's state on another Spark ───────── */
// Area: start        Rules: R10, R20, R22, R31, R40        Tests: state.test.mjs, copy.test.mjs, fleet.test.mjs,
//   install.test.mjs
// Owns: backup.json (writers: backupState, copyLate)
// Timers: backupIfDue (10 minutes after start, then hourly; it sends only while a Spark is on and the state changed),
//   needsMeTick (every 60 s), tick (every 0.5 s while a stop waits for running operations, 60 s at most)
// Wakes: none
// People, passkeys, agent keys, chats, recipes that worked and the fleet's record are copied to another Spark while one
// is awake anyway (Spark 3 unless config.json names one, then the next other Spark that takes it; never the brain's Spark
// or this one), one file a day, keeping the last 14, so losing Spark 2's disk loses little (F17). Each copy arrives as
// <name>.part and is read back whole (gzip -t) there; only once tar here has ended well too does a second command move
// it into place and remove the oldest beyond 14, and otherwise that command removes the .part. So a copy cut short, or
// one tar couldn't finish (a file it couldn't read: a whole archive without it), never replaces a good one or prunes
// one. backup.json keeps the last try and the last good copy, so a restart forgets neither. When a copy goes, and to
// which awake Spark, is 20-state-copy.mjs's: only when the state changed, and never by waking a Spark.
// To restore: stop the service, then untar one into ~/.local/state/spark-console (docs/sharing.md).
const BACKUP_FILE = `${STATE_DIR}/backup.json`;
const BACKUP_ON = !ALL_LOCAL || Boolean(process.env.SPARK_CONSOLE_BACKUP_MS);
let lastBackup = null, backingUp = false;
try { const kept = readKept(BACKUP_FILE); if (kept && typeof kept === 'object' && !Array.isArray(kept)) lastBackup = kept; } catch {}
const dayOf = t => new Date(t).toISOString().slice(0, 10);
// Awake Sparks only (copyAwake, 20-state-copy.mjs). first: one that just came online or is about to be powered off, tried
// first.
function backupTargets(first = null) {
  const pick = first || CONFIG.backupTo || 'spark3', brain = brainSparks();
  return NODES.filter(n => n.host !== 'local' && !brain.includes(n.id) && !knownOffline(n) && (n.id === first || copyAwake(n.id))).sort((a, b) => (b.id === pick) - (a.id === pick));
}
// One tar stream from this Spark to a file on another, in two steps: the stream is kept there as <name>.part and read
// back; then, once both ends are known, it is moved into place or removed. True only when tar, the far side, the
// read-back and the move all worked.
function sendCopy(target, name) {
  const dir = '"$HOME/.local/share/spark-console/backups"', part = `${dir}/${name}.part`;
  return new Promise(resolve => {
    // (no sessions.json in any copy: state put back from one signs no device in, contract 6.25; no saved-runs.json: a
    // start from it would stop by name what a saved workflow ran back then, R57)
    const src = spawn('tar', ['-C', STATE_DIR, '--exclude=*.sock', '--exclude=./cloud.json', '--exclude=./sessions.json', '--exclude=./saved-runs.json', '-czf', '-', '.'], { stdio: ['ignore', 'pipe', 'ignore'] });
    // gzip reads the .part from stdin (GNU gzip refuses a file name ending .part) and answers 2 for a warning only (macOS
    // tar pads its output with zeros); a copy cut short answers 1. Either way the .part stays for the second step: how
    // tar ended isn't known there. (A .part an earlier try left, its second step never run, goes first. This command is
    // the ssh command itself, so the far user's login shell reads it: find takes the pattern quoted, since under zsh a
    // pattern that matches nothing is an error and no copy would land.)
    // (not use of that Spark: the idle power-off doesn't count a copy, and a power-off waits for one under way,
    // copyBeforeOff in 20-state-copy.mjs)
    const dst = spawnOn(target, { command: `umask 077 && mkdir -p ${dir} && find ${dir} -maxdepth 1 -name 'state-*.tgz.part' -delete && cat > ${part} && { gzip -t < ${part}; g=$?; [ $g = 0 ] || [ $g = 2 ]; }` });
    let tarCode = null, farCode = null, done = false;
    const timer = setTimeout(() => { src.kill('SIGKILL'); dst.kill('SIGKILL'); }, 180000);
    const finish = () => {
      if (done || tarCode === null || farCode === null) return;
      done = true;
      clearTimeout(timer);
      // GNU tar answers 1 when a file changed while it read it (a chat being saved): the copy is still good. 2 (a file
      // it couldn't read, or it was stopped) leaves this copy out, so the one there and the older ones stay as they are.
      const good = farCode === 0 && tarCode <= 1;
      run(target, good ? `mv ${part} ${dir}/${name}; s=$?; [ $s = 0 ] && ls -1t ${dir}/state-*.tgz | tail -n +15 | xargs -r rm -f; exit $s` : `rm -f ${part}`, { timeout: 60000 })
        .then(r => resolve(good && r.code === 0), () => resolve(false));
    };
    src.on('close', c => { tarCode ??= c ?? 2; finish(); });
    src.on('error', () => { tarCode ??= 2; finish(); });
    // (the far side ending first leaves tar nobody to write to: it is stopped, and the copy doesn't count)
    dst.on('close', c => { farCode ??= c ?? 1; src.kill('SIGKILL'); finish(); });
    dst.on('error', () => { farCode ??= 1; src.kill('SIGKILL'); finish(); });
    src.stdout.pipe(dst.stdin);
    dst.stdin.on('error', () => {});
  });
}
async function backupState(first = null) {
  if (!BACKUP_ON || backingUp) return;
  backingUp = true;
  try {
    const day = dayOf(Date.now()), file = `state-${day}.tgz`, targets = backupTargets(first), before = lastBackup, mark = stateMark();
    let to = null;
    for (const t of targets) if (await sendCopy(t, file)) { to = t; break; }
    const at = new Date().toISOString();
    lastBackup = to ? { at, ok: true, to: to.id, file, good: { at, to: to.id, file }, noticedOn: before?.noticedOn || null }
      : { at, ok: false, error: targets.length ? `${targets.map(n => sparkName(n)).join(', ').replace(/, ([^,]*)$/, ' and $1')} didn’t take it` : 'no other Spark was reachable', good: before?.good || null, noticedOn: before?.noticedOn || null };
    keepMarks(lastBackup, before, mark);
    // None newer than 7 days, with changes since: one notice (20-state-copy.mjs).
    copyLate();
    try { writePrivate(BACKUP_FILE, lastBackup); } catch (e) { console.error(`Couldn’t save the daily copy’s record: ${e.message}`); }
  } finally { backingUp = false; }
}
// The hourly look, ten minutes after a start, then every hour (SPARK_CONSOLE_BACKUP_MS): a copy only when the state
// changed and a Spark is awake. With none awake nothing is sent and none is woken (only the very first try is recorded,
// once the status check has looked, so the 7 days have a start). A Spark coming online, and one about to be powered
// off, are 20-state-copy.mjs's.
function backupIfDue() {
  if (!copyDue()) return;
  if (!backupTargets().length && (lastBackup || !statusCache)) return copyLate();
  backupState().catch(e => console.error(`The daily copy: ${e.message}`));
}
if (BACKUP_ON) setTimeout(() => { backupIfDue(); setInterval(backupIfDue, Number(process.env.SPARK_CONSOLE_BACKUP_MS || 3600000)); }, Number(process.env.SPARK_CONSOLE_BACKUP_FIRST_MS || 600000));

const server = http.createServer(handler), local = http.createServer(handler);
// No route on the API takes a WebSocket (the editor proxy went, E10c): every upgrade is refused as an unknown path was.
server.on('upgrade', (req, socket) => refuseUpgrade(socket, '404 Not Found'));
// The app door (21-door.mjs, R40): its own private socket, for the owner's kept apps only. No time limit on a request
// (an upload to an app can take minutes), and room for an app's cookies in the headers.
const door = http.createServer({ maxHeaderSize: 65536, requestTimeout: 0 }, doorHandler);
door.on('upgrade', doorUpgrade);
// (each refused upgrade gets an error listener first: a reset socket with none would end the process)
const refuseUpgrade = (socket, status) => { socket.on('error', () => socket.destroy()); socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`); };
local.on('upgrade', (req, socket) => refuseUpgrade(socket, tcpApiOff ? '403 Forbidden' : '404 Not Found'));
mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
// Another copy already running (say, one started by hand) keeps its sockets: this one stops before touching them.
local.on('error', e => {
  console.error(e.code === 'EADDRINUSE' ? `Port ${CONFIG.port} is in use: Spark Console is already running. Not starting a second copy.` : `Couldn’t open port ${CONFIG.port}: ${e.message}`);
  process.exit(1);
});
local.listen(CONFIG.port, '127.0.0.1', () => {
  console.log(`… and on 127.0.0.1:${CONFIG.port} (health only once Tailscale uses the socket) (models on ${CONFIG.modelsHost}:~/${CONFIG.modelsDir})`);
  putBackAtStart();   // (state put back from a copy: the hold, before the sockets open; 22-putback.mjs)
  openSockets();
  // The update record (18-workflows): only here, so a second copy (which stops at EADDRINUSE above) never writes it.
  try { noteUpdate(); } catch (e) { console.error(`The update record: ${e.message}`); }
  // Telegram's loop starts only here, so a second copy (which stops at EADDRINUSE above) never polls (R32).
  try { tgAfterRestart(); } catch (e) { console.error(`Telegram after the restart: ${e.message}`); }
  // Changes a restart cut off before their end was written (20-journal.mjs): only here, so a second copy never marks them.
  journalAfterRestart();
  // An install asked from chat: its result, told once in the chat that asked (21-updates.mjs); only here, likewise.
  updAfterRestart();
  tgLoop().catch(e => console.error(`Telegram: ${e.message}`));
  // The needs-me line's tick (20-tell.mjs): started here, like the loop, so a second copy never sends.
  setInterval(needsMeTick, NEEDS_MS).unref?.();
  // The outside heartbeat (20-beat.mjs): started here too, so a second copy never beats; its first beat waits a minute.
  beatStart(BEAT_FIRST_MS);
});
function openSockets() {
try { unlinkSync(API_SOCKET); } catch {}
// If the socket can't be opened, say so and keep the local port serving the API (Tailscale isn't pointed at the socket then).
server.on('error', e => console.error(`Couldn’t open ${API_SOCKET}: ${e.message}. Serving the API on the local port only.`));
server.listen(API_SOCKET, () => {
  try { chmodSync(API_SOCKET, 0o600); } catch {}
  console.log(`Spark Console API ${VERSION}, build ${BUILD}, on ${API_SOCKET}`);
});
try { unlinkSync(DOOR_SOCKET); } catch {}
door.on('error', e => console.error(`Couldn’t open the app door’s ${DOOR_SOCKET}: ${e.message}. Apps open on the tailnet only.`));
door.listen(DOOR_SOCKET, () => { try { chmodSync(DOOR_SOCKET, 0o600); } catch {} });
}
// Stopping (an install, a restart): no new operations; running ones get a minute to finish. One still running after
// that is on the record as started and not finished, and is reported when the service is back.
process.on('SIGTERM', () => {
  if (draining) return;
  draining = true;
  stopSamplers();
  tgStop();
  const t0 = Date.now();
  const tick = () => ([...jobs.values()].some(j => j.status === 'running') && Date.now() - t0 < 60000 ? setTimeout(tick, 500) : process.exit(0));
  tick();
});
// A mistake in one request never takes the whole console down (it is printed and counted, 23-http.mjs).
process.on('unhandledRejection', e => recordFault('background work', e));
// A network error nobody listened for (a visitor hanging up mid-request) is logged, not fatal; anything else is written
// to last-crash.json (shown by sparkie_setup after the restart), then still ends the process, and systemd starts it again.
process.on('uncaughtException', e => {
  console.error('Uncaught:', e);
  if (['ECONNRESET', 'EPIPE', 'ECONNABORTED', 'ERR_STREAM_DESTROYED', 'ERR_STREAM_WRITE_AFTER_END'].includes(e?.code)) return;
  recordCrash(e);
  process.exit(1);
});

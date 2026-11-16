/* ───────── running commands on Sparks ───────── */
// Area: ground        Rules: R10        Tests: fleet.test.mjs, dark.test.mjs, box.test.mjs
// Owns: none
// Timers: none        Wakes: none
// Scripts go over stdin to `bash -s`; plain commands (used when stdin carries data) go as the ssh command.
// `limit` (seconds) ends a script on the Spark itself too, so a stuck docker or du on a sick Spark doesn't pile up there
// after this side gave up. `fresh`: a new connection, never one shared with another ssh (the lock-out net's check that a
// new SSH connection still works, 21-net.mjs netProbe: a shared one would ride an old connection a firewall lets through).
function spawnOn(node, { script, command, limit, fresh = false }) {
  if (ALL_LOCAL && offlineNow(node.id)) {
    return spawn('bash', ['-c', `sleep 1; echo "ssh: connect to host ${node.host} port 22: Operation timed out" >&2; exit 255`]);
  }
  const local = ALL_LOCAL || node.host === 'local';
  const env = ALL_LOCAL ? { ...process.env, HOME: `${process.env.MOCK_ROOT}/${node.id}`, SPARK_SYSFS: `${process.env.MOCK_ROOT}/${node.id}/sys`,
    SPARK_MEMINFO: `${process.env.MOCK_ROOT}/${node.id}/.mock/meminfo` } : process.env;
  const guard = script != null && limit && !ALL_LOCAL ? ['timeout', '-k', '5', String(Math.ceil(limit))] : [];
  const child = local
    ? spawn(guard[0] || 'bash', [...guard.slice(1), ...(guard.length ? ['bash'] : []), ...(script != null ? ['-s'] : ['-c', PATH_FIRST + command])], { env })
    : spawn('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=6', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=2',
      ...(fresh ? ['-o', 'ControlMaster=no', '-o', 'ControlPath=none'] : []),
      `${node.user || CONFIG.user}@${node.host}`, PATH_FIRST + (script != null ? `${guard.join(' ')}${guard.length ? ' ' : ''}bash -s` : command)]);
  // (a program that isn't there fails this command, never the service: its callers see the close, R53)
  child.on('error', () => {});
  if (script != null) child.stdin.end(PREAMBLE + script);
  return child;
}

// A Spark that just failed to answer over SSH counts as offline for a minute, so one dark Spark doesn't make
// every request wait out the connection timeout. Any successful command or live sample clears it.
const unreachableUntil = new Map();
const knownOffline = node => (unreachableUntil.get(node.id) || 0) > Date.now();
// Two failed connections (or timed-out commands: a frozen Spark accepts SSH but never answers) in a row, so a dropped
// handshake (a burst of SSH, a Tailscale blip) doesn't count. A failure of a command begun before the Spark last
// answered says nothing new (it was begun while the Spark was away, and ended late), so it marks nothing: else a Spark
// back on would read offline again for a minute (startedAt: when its command began; left out, it counts).
const reachMisses = new Map(), reachOkAt = new Map();
function noteReach(node, code, startedAt = Date.now()) {
  if (code === 255) {
    if (startedAt < (reachOkAt.get(node.id) || 0)) return;
    const misses = (reachMisses.get(node.id) || 0) + 1;
    reachMisses.set(node.id, misses);
    if (misses >= 2) unreachableUntil.set(node.id, Date.now() + OFFLINE_TTL);
  } else if (code === 0) { reachOkAt.set(node.id, Date.now()); reachMisses.delete(node.id); unreachableUntil.delete(node.id); }
}

function run(node, script, { timeout = 60000, onLine, signal, fresh = false } = {}) {
  if (knownOffline(node)) return Promise.resolve({ code: 255, out: '', err: `${node.id} isn’t reachable (checked in the last minute).` });
  return new Promise(resolve => {
    // The Spark's own copy of the script ends a few seconds after this side gives up.
    const began = Date.now(), child = spawnOn(node, { script, limit: timeout / 1000 + 5, fresh });
    let out = '', err = '', partial = '', timedOut = false;
    child.stdout.on('data', chunk => {
      out += chunk;
      if (out.length > 8e6) child.kill('SIGKILL');
      if (onLine) {
        partial += chunk;
        const lines = partial.split(/[\r\n]+/);
        partial = lines.pop();
        lines.filter(Boolean).forEach(onLine);
      }
    });
    child.stderr.on('data', chunk => { err = (err + chunk).slice(-200000); });
    const timer = setTimeout(() => { timedOut = true; err += '\n(timed out)'; child.kill('SIGKILL'); }, timeout);
    child.on('error', e => { err += e.message; });
    // A cancelled operation ends its long commands (downloads, pulls) at once.
    const abort = () => { err += '\n(cancelled)'; child.kill('SIGKILL'); };
    if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
    child.on('close', code => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      noteReach(node, timedOut ? 255 : code, began);
      resolve({ code: code ?? -1, out, err: err.trim() });
    });
  });
}

const fields = (out, tag) => out.split('\n').filter(l => l.startsWith(tag + '\t')).map(l => l.split('\t').slice(1));
const b64json = s => { try { return s ? JSON.parse(Buffer.from(s, 'base64').toString('utf8')) : null; } catch { return null; } };

let authProblem = null;


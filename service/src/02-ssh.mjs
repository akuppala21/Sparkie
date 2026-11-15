/* ───────── running commands on Sparks ───────── */
// Area: ground        Rules: R10        Tests: fleet.test.mjs, dark.test.mjs
// Owns: none
// Timers: none        Wakes: none
// Scripts go over stdin to `bash -s`; plain commands (used when stdin carries data) go as the ssh command.
// `limit` (seconds) ends a script on the Spark itself too, so a stuck docker or du on a sick Spark doesn't pile up there
// after this side gave up.
function spawnOn(node, { script, command, limit }) {
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
      `${node.user || CONFIG.user}@${node.host}`, PATH_FIRST + (script != null ? `${guard.join(' ')}${guard.length ? ' ' : ''}bash -s` : command)]);
  if (script != null) child.stdin.end(PREAMBLE + script);
  return child;
}

// A Spark that just failed to answer over SSH counts as offline for a minute, so one dark Spark doesn't make
// every request wait out the connection timeout. Any successful command or live sample clears it.
const unreachableUntil = new Map();
const knownOffline = node => (unreachableUntil.get(node.id) || 0) > Date.now();
// Two failed connections (or timed-out commands: a frozen Spark accepts SSH but never answers) in a row, so a dropped
// handshake (a burst of SSH, a Tailscale blip) doesn't count.
const reachMisses = new Map();
function noteReach(node, code) {
  if (code === 255) {
    const misses = (reachMisses.get(node.id) || 0) + 1;
    reachMisses.set(node.id, misses);
    if (misses >= 2) unreachableUntil.set(node.id, Date.now() + OFFLINE_TTL);
  } else if (code === 0) { reachMisses.delete(node.id); unreachableUntil.delete(node.id); }
}

function run(node, script, { timeout = 60000, onLine, signal } = {}) {
  if (knownOffline(node)) return Promise.resolve({ code: 255, out: '', err: `${node.id} isn’t reachable (checked in the last minute).` });
  return new Promise(resolve => {
    // The Spark's own copy of the script ends a few seconds after this side gives up.
    const child = spawnOn(node, { script, limit: timeout / 1000 + 5 });
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
      noteReach(node, timedOut ? 255 : code);
      resolve({ code: code ?? -1, out, err: err.trim() });
    });
  });
}

const fields = (out, tag) => out.split('\n').filter(l => l.startsWith(tag + '\t')).map(l => l.split('\t').slice(1));
const b64json = s => { try { return s ? JSON.parse(Buffer.from(s, 'base64').toString('utf8')) : null; } catch { return null; } };

let authProblem = null;


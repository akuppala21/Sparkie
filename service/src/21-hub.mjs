/* ───────── a change on Spark 2, the hub: always asked, inside the net, its own ways in checked after (A11) ───────── */
// Area: features        Rules: R1, R60, R71, R61        Tests: hub-change.test.mjs
// Owns: none
// Timers: none        Wakes: none
// Spark 2 runs Spark Console and the brain and nothing else (R1; design A 2.7, step 11). With HUB_ON, run's ladder
// (workChange, 21-ladder.mjs) hands every change there to hubChange; off, it is not done, as before (runnerNever's
// words). First, refused by code before anything is asked, whatever the words, a go-ahead or an agent say: what the
// sorter calls not done; root (21-root.mjs: never on Spark 2) and the root helper's own line; a pause; the lock-out class (it is kept only
// by a fresh visit, A13c); and the owner's standing rules for the hub (hubRefuses): nothing that stops, restarts,
// removes or changes the brain's container or its model files; nothing that starts a model, a job or any other workload
// there; nothing that touches Spark Console's own unit, state, secrets or repository copy (only its installer changes
// those); nothing about Spark 2's power or its plug. Then it is always asked: one button, one
// command a press, built here (a delete it cannot see is the dangerous ask, 20-danger.mjs), never at once. The press
// sorts it again and runs it through the lock-out net's seam (netGuarded, 21-net.mjs): the call reaches the root helper
// through the owner's service manager, so the command runs outside the console's own unit (helperScript's and
// guardScript's local case), in the run wall with 2 GB, the net armed first. Before and after it, beside the net's own
// ways in, Spark Console's (the installer's check_ways: the owner signs in, the agent door answers, the model address
// lists; its route on Tailscale; the brain answering): one that worked before and doesn't after puts it back at once,
// pauses Sparkie's and agents' changes and tells the owner what stopped working (a put-back puts files back: it starts
// no container, so a stopped brain is the owner's /restart sparkie). Why a command the sorter can't read ($ for a
// program, a script, python -c, a link) still can't reach the brain: in the run wall /run (Docker's socket, the
// service manager) and /var/lib/docker are hidden, Docker's group is left out, the model folders are given read-only
// (--protect) and the console's own are read-only; its button says so. A console restart leaves its unit to the net: at
// start netRecover finds the guard by its id and puts it back, which stops the unit first, or the Spark's own timer
// does; it never runs again. (minutes, A6's long command, is not on Spark 2 yet: 21-work.mjs refuses it.)

// The switch: on. The stand-in fleet may turn it off for a test of the off side (SPARK_CONSOLE_HUB=0); nothing else can.
const HUB_ON = !(ALL_LOCAL && process.env.SPARK_CONSOLE_HUB === '0');
// The run wall's cap there (design A 2.7: 2 GB).
const HUB_MEMORY = 2;
const HUB_NOT = 'Spark 2 runs only Spark Console and the brain; nothing was asked or run.';
// Spark Console's own folders, as the sorter places a path (~/…): its state, its share (releases, the way back), its
// settings and secrets, its caches, its code and source.
const HUB_OWN_PLACES = /^~\/(?:\.local\/state\/spark-console|\.local\/share\/spark-console|\.config\/spark-console|\.cache\/spark-console|spark-console(?:-src|-service)?)(?:\/|$)/;
// What its wall holds, said on its button: why a command the sorter can't read still can't reach the brain (R63; the
// helper hides /run, Docker's socket among it, and /var/lib/docker, and leaves Docker's group out; --protect).
const HUB_WALL = 'In its wall it can’t reach Docker (so not the brain’s container), your service manager or Spark Console’s own processes, and the brain’s model files and Spark Console’s own folders are read-only.';
// Programs that set the next one going (their options skipped): what that one is counts.
const HUB_WRAPPERS = new Set(['busybox', 'env', 'nice', 'ionice', 'nohup', 'time', 'command', 'exec', 'stdbuf', 'timeout', 'setsid', 'sudo', 'doas', 'xargs', 'chrt', 'taskset', 'unbuffer', 'watch', 'flock']);
const HUB_CONTAINERS = new Set(['docker', 'podman', 'nerdctl', 'ctr', 'crictl', 'docker-compose', 'kubectl', 'k3s', 'microk8s', 'containerd', 'dockerd']);
const HUB_STARTS = new Set(['run', 'create', 'start', 'up', 'service', 'stack', 'swarm', 'build', 'buildx', 'pull', 'load', 'import']);
// A container program's sub-command (past its options; compose, container and image name one more): whether it starts one.
function hubStarts(args) {
  const words = args.filter(a => !a.startsWith('-')), [a, b] = words;
  return HUB_STARTS.has(a) || (['compose', 'container', 'image'].includes(a) && HUB_STARTS.has(b));
}
const HUB_SERVERS = new Set(['vllm', 'sglang', 'llama-server', 'llama-cli', 'ollama', 'trtllm-serve', 'trtllm-build', 'text-generation-launcher', 'tritonserver',
  'torchrun', 'deepspeed', 'accelerate', 'jupyter', 'jupyter-lab', 'jupyter-notebook', 'uvicorn', 'gunicorn', 'huggingface-cli']);
const HUB_LASTING = new Set(['nohup', 'setsid', 'disown', 'screen', 'tmux', 'at', 'batch', 'crontab', 'systemd-run', 'daemonize', 'start-stop-daemon']);
const HUB_POWER = new Set(['reboot', 'shutdown', 'poweroff', 'halt', 'telinit', 'init']);
const HUB_KILL = new Set(['kill', 'pkill', 'killall', 'fuser']);
// systemctl's and service's verbs that change something (status, show, cat, list-… only read).
const HUB_UNIT_VERBS = /^(?:start|stop|restart|reload|try-restart|reload-or-restart|try-reload-or-restart|enable|disable|reenable|mask|unmask|kill|edit|set-property|daemon-reload|daemon-reexec|link|revert|preset|preset-all|isolate|set-environment|unset-environment|import-environment|reset-failed|freeze|thaw|clean|reboot|poweroff|halt|suspend|hibernate|hybrid-sleep|kexec|default|rescue|emergency|exit|switch-root|add-wants|add-requires)$/;

// Each program a command runs, roughly as a shell splits it (shellWords, 21-work.mjs), through the wrappers above and
// into a word that holds a whole command (sh -c '…', and the word after -c even with no space in it: bash -c reboot),
// twice deep: [{prog, args}].
function hubPrograms(command, depth = 0) {
  const progs = [];
  let seg = [];
  const flush = () => {
    for (let k = 0; k < seg.length;) {
      if (/^[A-Za-z_]\w*=/.test(seg[k])) { k++; continue; }
      const prog = seg[k].split('/').pop();
      progs.push({ prog, args: seg.slice(k + 1) });
      if (!HUB_WRAPPERS.has(prog)) break;
      k++;
      while (k < seg.length && /^(?:-|\d)/.test(seg[k])) k++;
    }
    if (depth < 2) for (const [i, w] of seg.entries()) if (/\s/.test(w) || (i > 0 && /^-\w*c$/.test(seg[i - 1]))) progs.push(...hubPrograms(w, depth + 1));
    seg = [];
  };
  for (const t of shellWords(String(command))) {
    if (t.op) { if (!['<', '>'].includes(t.op)) flush(); continue; }
    seg.push(t.w);
  }
  flush();
  return progs;
}
const hubEsc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// The brain's names: its container, the name it serves, its model (as the store keeps it), and the protected containers.
function hubBrainNames() {
  const names = [MAIN?.container, MAIN?.served, MAIN?.model, MAIN?.model && repoOf(MAIN.model), MAIN?.model && `models--${String(MAIN.model).replace('/', '--')}`]
    .filter(x => typeof x === 'string' && x.length >= 3).map(hubEsc);
  const globs = (Array.isArray(CONFIG.protect) ? CONFIG.protect : []).filter(x => typeof x === 'string' && x).map(g => hubEsc(g.replace(/\*+$/, '')));
  return [...names, ...globs];
}

// The owner's standing rules for Spark 2 (each said in its own words): why it is never done there, or null.
function hubRefuses(command, sorted, ctx = {}, dir = RUNNER_DIR, widen = {}) {
  const text = String(command), progs = hubPrograms(text), has = set => progs.find(p => set.has(p.prog));
  const unit = progs.find(p => ['systemctl', 'service'].includes(p.prog) && p.args.some(a => HUB_UNIT_VERBS.test(a)));
  // Its plug, and its power (its words anywhere, as the plug's: awk 'BEGIN{system("reboot")}', x=reboot; $x)
  if (/5580|spark-console-plugs|plugs\.sh|spark-console\/matter|matter-server|chip-tool|\btapo\b|\bkasa\b|\b(?:reboot|poweroff|shutdown|halt|kexec)\b/i.test(text) || has(HUB_POWER)
    || (unit && unit.args.some(a => /^(?:reboot|poweroff|halt|suspend|hibernate|hybrid-sleep|kexec)$/.test(a)))) return 'it touches Spark 2’s power or its plug, which are never changed from here';
  // Spark Console's own unit, state, secrets and repository copy (the installer's, and only through its own actions)
  const own = [STATE_DIR, SECRETS_FILE, `${homedir()}/spark-console-src`].filter(Boolean).map(hubEsc).join('|');
  const places = [...(sorted?.placed || []), ...(sorted?.wide || [])].filter(x => typeof x === 'string');
  if (/spark-console|api\.sock|door\.sock/i.test(text) || (own && new RegExp(own).test(text)) || has(HUB_KILL)
    || places.some(x => HUB_OWN_PLACES.test(x) || (own && new RegExp(`^(?:${own})(?:/|$)`).test(x)))) return 'it touches Spark Console’s own unit, state, secrets or repository copy, which only its installer changes';
  // The brain's container and its model files (a container program other than a start, a name of the brain's, the folders models are kept in)
  const brain = hubBrainNames(), box = progs.find(p => HUB_CONTAINERS.has(p.prog));
  if ((sorted?.kinds || []).includes('brain') || (brain.length && new RegExp(brain.join('|'), 'i').test(text)) || runnerProtected(sorted, dir).length
    || (box && !hubStarts(box.args)) || (unit && unit.args.some(a => /^(?:docker|containerd)(?:\.service|\.socket)?$/.test(a)))) return 'it would stop, restart, remove or change the brain’s container or its model files';
  // A model, a job or any other workload (a container started, a model server, something left running, a service, the GPU)
  if (box || has(HUB_SERVERS) || has(HUB_LASTING) || /(?:^|\s)-m\s+(?:vllm|sglang|http\.server|uvicorn|jupyter|torch\.distributed)\b/.test(text)
    || /\bloginctl\s+enable-linger\b/.test(text) || widen.gpu === true || sorted?.gpu === true) return 'it would start a model, a job or another workload there';
  if (unit) return 'it would start, stop or change a service there';
  return null;
}

// A change on Spark 2 (workChange, with HUB_ON): refused, asked, or, from the ask's own press, run inside the net.
async function hubChange(node, command, sorted, viewer, ctx, dir = RUNNER_DIR, widen = {}) {
  whoMayLook(viewer, ctx);
  // (as on every Spark, whatever the caller says: not done, root, the root helper's line, a pause)
  if (sorted.class === 'notdone') throw new HttpError(403, `Not done: ${sorted.why}`);
  if (ctx.root || sorted?.kinds?.includes('root') || sorted?.answer === 'set root') throw new HttpError(403, 'Nothing ran: Spark 2 runs Spark Console and the brain, so nothing runs there as root.');
  if (sorted?.answer) throw new HttpError(403, 'It calls the root helper or its sudo line, which only the owner’s one-time command sets up, so nothing ran.');
  if (agentSettings().halted) throw new HttpError(403, 'Sparkie’s and agents’ changes are paused (your account menu → Agents and Telegram), so nothing ran.');
  const why = hubRefuses(command, sorted, ctx, dir, widen);
  if (why) throw new HttpError(403, `Not done on Spark 2: ${why}. ${HUB_NOT}`);
  if (sorted.class === 'lockout') throw new HttpError(403, `Not done on Spark 2 yet: a change that can lock you out of Spark 2 is kept only by a fresh visit to Spark Console, which comes with a later build. ${sorted.why} Nothing was asked or run.`);
  if (widen.fleet === true || (Array.isArray(sorted?.reach) && sorted.reach.includes('fleet'))) throw new HttpError(403, `Not done on Spark 2: a change there reaches no other Spark. ${HUB_NOT}`);
  const dangerous = (sorted.kinds || []).filter(k => k === 'delete');
  // The owner's yes, pressed (the dangerous ask's press carries its pair): sorted again, its scripts read again.
  if (ctx.button && ctx.ownerConfirmed && (!dangerous.length || ctx.danger)) {
    // (what the button that was pressed asked, by its own id, as the ladder keeps it: workRecord, 21-ladder.mjs)
    const was = workAsks.get(String(ctx.pressed || ''));
    workAsks.delete(String(ctx.pressed || ''));
    const again = why => hubAsk(node, command, sorted, viewer, { ...ctx, button: false, ownerConfirmed: false, danger: false }, dir, `${why}, so that yes was void`);
    if (!was || was.spark !== node.id || was.command !== command || was.dir !== dir) return again('the ask that button answered isn’t known here any more');
    if (!was.unread && Object.keys(was.sums).length) {
      const now = await workScripts(node, sorted.scripts, dir, command);
      if (now.unread) throw new HttpError(503, `The scripts it runs couldn’t be read again on Spark 2 (${now.unread}), so nothing ran.`);
      if ([...new Set([...Object.keys(was.sums), ...Object.keys(now.sums)])].some(p => was.sums[p] !== now.sums[p])) return again('a script it runs changed after you were asked');
    }
    return netGuarded(node, command, { ctx, dir, seconds: RUNNER_SECONDS, cls: sorted.class, gate: 'asked', memory: HUB_MEMORY, ways: HUB_WAYS, pause: true, protect: RUNNER_PROTECT });
  }
  // (no root helper on Spark 2, one this build doesn't know, or walls not proven: the owner's one command with --hub, and
  // nothing is asked)
  const first = await netHelperFirst(node);
  if (first.needs) return first.needs;
  // The owner's own call with no chat to show a button in (the API): nothing is asked there.
  if (!ctx.conv && !ctx.onQuestion && !ctx.agent && !ctx.agentId && !viewer?.agentKey) throw new HttpError(409, 'Not run: every change on Spark 2 is asked with a button, one command a press. Ask for it in your chat with Sparkie. Nothing ran.');
  return hubAsk(node, command, sorted, viewer, ctx, dir);
}

// The ask, built by code: the exact command, why it is asked, how it runs and what is checked after, what put-back
// covers, what Sparkie read before proposing it, each script's hash. A delete it cannot see is the dangerous ask.
// The command on Spark 2's button, framed so none of its own lines can read as the button's (S-4): one line as
// "$ command"; with a line break, how many lines it has, and each after │, so "Asked because …" in a command stays
// the command's. (The ladder's builder frames its own button; one shared function can take this one's place.)
function hubCommandLines(command) {
  const parts = String(command).split(/\r\n|[\r\n\u2028\u2029]/);
  if (parts.length === 1) return ['Run this on Spark 2?', `$ ${command}`];
  return [`Run this on Spark 2? Its command has ${parts.length} lines, each shown after │:`, ...parts.map(l => `│ ${l}`)];
}
async function hubAsk(node, command, sorted, viewer, ctx, dir = RUNNER_DIR, why = 'every change on Spark 2 is asked, one command a press: it runs Spark Console and the brain') {
  if (maskSecrets(command) !== command) throw new HttpError(400, 'It holds something shaped like a key or password, so it can’t be shown whole on a button: give the key by its name. Nothing was asked or run.');
  const scripts = await workScripts(node, sorted.scripts, dir, command);
  const call = { action: 'run', args: { on: node.id, command, ...(dir !== RUNNER_DIR ? { dir } : {}) } };
  // (where the press runs it, built by code: the brain chooses dir, and on Spark 2 nothing is copied first)
  const starts = `It starts in ${dir}.`;
  const net = `It runs inside the lock-out net, through your own service manager (outside Spark Console’s own unit), with at most ${HUB_MEMORY} GB and ${RUNNER_SECONDS} seconds. If any of ${Object.values(HUB_WAYS.words).join(', ')} stops answering after it, it is put back at once, Sparkie’s and agents’ changes pause, and you are told. ${HUB_WALL}`;
  const reads = (ctx.reads || []).slice(-4).map(r => r.label);
  const out = (sorted.kinds || []).includes('delete')
    ? dangerAsk(viewer, ctx, { kinds: ['delete'], where: node.id, shown: { command }, call,
      facts: { gone: { what: String(sorted.why || '').replace(/\s*That cannot be put back\.?$/, '') }, hub: [starts, net], lines: workScriptLines(scripts) } })
    : question(viewer, ctx, [...hubCommandLines(command), `Asked because ${why}.`, starts, net,
      'The net copies the ways in first, so it can put them back; anything else it writes isn’t copied, and undo can’t put that back.',
      ...(reads.length ? [`Sparkie read this before proposing it: ${reads.join('; ')}.`] : []), ...workScriptLines(scripts)].join('\n'),
    [{ label: 'Run it', call }, { label: 'No', call: null }], 'proposal', { ownerOnly: true });
  // (kept under the yes button's own id, as the ladder keeps its asks: the press reads it back, workRecord)
  workRecord(call.args, { spark: node.id, command, dir, wall: 'hub', sums: scripts.sums, unread: scripts.unread || null, at: Date.now() });
  return out;
}

// Spark Console's own ways in, as the installer's check_ways tries them (deploy/host-on-portal.sh), from its own socket
// as the owner; its route on Tailscale (port 8443's, by the main address); the brain answering. true, false, or null
// (can't be told: not counted before, and a miss after).
function hubSelf(path, body = null) {
  return new Promise(resolve => {
    const req = http.request({ socketPath: API_SOCKET, path, method: body ? 'POST' : 'GET', timeout: 15000,
      headers: { 'tailscale-user-login': String(accessList().owner || ''), ...(body ? { 'content-type': 'application/json' } : {}) } }, res => {
      let out = '';
      res.on('data', d => { if (out.length < 1e6) out += d; });
      res.on('end', () => resolve({ status: res.statusCode, out }));
      res.on('error', () => resolve({ status: 0, out: '' }));
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve({ status: 0, out: '' }));
    req.end(body ? JSON.stringify(body) : undefined);
  });
}
function hubRoute() {
  return new Promise(resolve => {
    let out = '';
    const child = spawn('tailscale', ['serve', 'status', '--json'], { stdio: ['ignore', 'pipe', 'ignore'] });
    const t = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 10000);
    child.stdout.on('data', d => { if (out.length < 4e6) out += d; });
    child.on('error', () => {});
    child.on('close', code => {
      clearTimeout(t);
      try { const cfg = JSON.parse(out || '{}'), host = new URL(consoleOrigin()).host; resolve(code !== 0 || !cfg?.Web ? null : Boolean(cfg.Web[host])); } catch { resolve(null); }
    });
  });
}
const hubJson = s => { try { return JSON.parse(s); } catch { return null; } };
const HUB_WAYS = {
  // (a put-back puts files back; it doesn't start a container: the brain is started again by the owner's word)
  after: lost => (lost.includes('brain') ? 'The put-back puts back files only; it doesn’t start the brain again: /restart sparkie does.' : ''),
  words: { signin: 'your sign-in to Spark Console', door: 'its agent door', models: 'its model address', route: 'its route on Tailscale', brain: 'the brain' },
  probe: async () => {
    const [who, door, models, route, brain] = await Promise.all([hubSelf('/whoami'), hubSelf('/mcp', { jsonrpc: '2.0', id: 1, method: 'initialize' }), hubSelf('/v1/models'),
      hubRoute(), mainStatus().catch(() => null)]);
    return { signin: hubJson(who.out)?.access === 'owner', door: door.status >= 200 && door.status < 500, models: hubJson(models.out)?.object === 'list',
      route, brain: brain && brain.configured ? brain.healthy === true : null };
  },
};

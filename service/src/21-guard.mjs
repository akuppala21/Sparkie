/* ───────── the lock-out net: its calls to the root helper (the console's half is 21-net.mjs) ───────── */
// Area: features        Rules: R60, R71, R42, R70        Tests: root-helper.test.mjs, root.test.mjs
// Owns: none
// Timers: none        Wakes: none
// The lock-out net (R60; design A 2.8, steps A13a and A13b). The root helper's `run --net` copies the ways in, writes
// restore.sh beside them and arms a timer in the Spark's own systemd before the change runs; it disarms only on the
// console's word (`keep`, after the check from outside), and otherwise what differs goes back when the timer fires, or
// at once with `putback`. Only the console's half calls these (21-net.mjs, A13b): guardScript
// builds the one script a call runs on a Spark, as helperScript does for a look (the helper must be the one this build
// ships), and guardAnswer reads what came back. The guard's id is the call's own, and keep and putback name it again.
function guardScript(node, verb, { id, command = '', seconds = 60, dir = '~', memory = null, protect = [], lockout = false }) {
  // (the id goes into a shell line: only the shape every helper call has)
  if (!/^[a-z0-9]{8,40}$/.test(String(id))) throw new Error('A guard id is 8 to 40 of a-z and 0-9.');
  // (where the change starts: ~ or a folder under it, as run's dir takes it, A13b; never quietly ~)
  if (!/^~(?:\/(?!\.\.?(?:\/|$))[\w.@+-]+)*$/.test(String(dir))) throw new Error('A guard’s folder is ~ or a folder under it.');
  const sudo = node.host === 'local' ? 'systemd-run --user --quiet --wait --pipe --collect --expand-environment=no sudo -n' : 'sudo -n';
  // (a folder given read-only, as helperScript gives a change's: each only when it is a real folder there now, A11)
  const under = d => `"$HOME"${q(d.slice(1))}`, pr = verb === 'run' ? (protect || []).filter(d => /^~\/[\w.@+-]+(?:\/[\w.@+-]+)*$/.test(d) && !/\/\.\.?(?:\/|$)/.test(d)) : [];
  const call = verb === 'run'
    ? `run --net --id "$id" --sha256 ${createHash('sha256').update(command).digest('hex')} --seconds ${Math.trunc(Number(seconds))} --dir ${dir === '~' ? '"$HOME"' : `"$HOME"${q(dir.slice(1))}`}${pr.length ? ' "${p[@]}"' : ''}${Number.isInteger(memory) && memory >= 1 && memory <= 8 ? ` --memory ${memory}G` : ''} -- ${q(command)}`
    // (root, R70: as root, only inside the net armed in the same call; --lockout holds a lock-out change to 10 minutes)
    : verb === 'root' ? `root --id "$id" --sha256 ${createHash('sha256').update(command).digest('hex')} --seconds ${Math.trunc(Number(seconds))} --dir ${dir === '~' ? '"$HOME"' : `"$HOME"${q(dir.slice(1))}`} --net${lockout === true ? ' --lockout' : ''} -- ${q(command)}`
    : verb === 'putback' ? 'putback --id "$id"' : 'keep --id "$id"';
  return [
    `id=${id}; h=${HELPER_AT}`,
    "said() { printf '%s console %s\\n' \"$id\" \"$1\"; exit 0; }",
    '[ -f "$h" ] || said none',
    's=$(sha256sum -- "$h" 2>/dev/null) || said none; s=${s%% *}',
    `[ "$s" = ${HELPER_SHA256} ] || said "unknown $s"`,
    ...(pr.length ? [`p=(); ${pr.map(d => `[ -d ${under(d)} ] && [ "$(realpath -e -- ${under(d)} 2>/dev/null)" = ${under(d)} ] && p+=(--protect ${q(d)})`).join('; ')}`] : []),
    `exec ${sudo} "$h" ${call} </dev/null 2>&1`,
  ].join('\n');
}
// The helper's sentences the net reads (what follows "<id> " on its line), kept here so this part stands alone (the
// tests load it by itself); own-programs.test checks each against deploy/spark-console-root, as it does the look's.
const GUARD_SAYS = {
  end: /^end (\d{1,3}|time)$/,
  netArmed: /^net armed: the ways in go back at (\S+) /,
  netOpen: /^net open: (.*)$/,
  kept: /^kept: |^kept already: /,
  putBack: /^(?:net |already )?put back at (.*)$/,
  // (the put-back the helper tried at once, sshd -t refusing the change or its timer gone, failed: never kept)
  failed: /^net: the put-back failed: ?(.*)$/,
};
// What the helper said of the net, read as helperAnswer reads a look: a run's last line is "<id> end <code>", the net's
// own line is the one just before it, and the net's "armed" line is the first (it comes before the command starts),
// so a line the command printed is never read as the helper's. keep and putback print the helper's lines alone.
function guardAnswer(id, out) {
  const lines = String(out).split('\n');
  if (lines.at(-1) === '') lines.pop();
  const own = l => (String(l).startsWith(`${id} `) ? String(l).slice(id.length + 1) : null);
  const last = own(lines.at(-1)) ?? '', first = own(lines[0]) ?? '';
  const end = GUARD_SAYS.end.exec(last);
  const net = end ? own(lines.at(-2)) ?? '' : last;
  const after = re => re.exec(net)?.[1] ?? null;
  return {
    ...(!end && first.startsWith('console ') ? { said: first.slice('console '.length) } : {}),
    ...(!end && last.startsWith('refused: ') ? { refused: last.slice('refused: '.length) } : {}),
    goesBackAt: GUARD_SAYS.netArmed.exec(first)?.[1] || null,
    open: after(GUARD_SAYS.netOpen),
    kept: !end && GUARD_SAYS.kept.test(last),
    putBackAt: after(GUARD_SAYS.putBack),
    failed: after(GUARD_SAYS.failed),
    ...(end ? { exit: end[1] === 'time' ? null : Number(end[1]) } : {}),
  };
}
// One call of the net on a Spark (never rejects): { id, code, out, cut }. run: the command in the run wall, the net armed
// first, starting in dir (~ or a folder under it); root: the same as root (R70, 21-root.mjs); keep: id is the guard's
// own. What it printed is kept as its first part and its last GUARD_TAIL bytes, never only the first part: the helper's
// own lines come last, after anything the command printed, so a command that prints past the cap can't choose them
// (guardAnswer reads them from the true end). cut: something in the middle was left out, and a line in its place says so.
const GUARD_TAIL = 65536;
function guardCall(node, verb, { id = randomBytes(12).toString('hex'), command = '', seconds = 60, dir = '~', memory = null, protect = [], lockout = false } = {}) {
  return new Promise(resolve => {
    const child = spawnOn(node, { script: guardScript(node, verb, { id, command, seconds, dir, memory, protect, lockout }), limit: Number(seconds) + 180 });
    const head = [], headMost = Math.max(GUARD_TAIL, J_MAX - GUARD_TAIL);
    let headBytes = 0, tail = Buffer.alloc(0), past = 0;
    child.stdout.on('data', c => {
      if (headBytes < headMost) { const take = c.subarray(0, headMost - headBytes); head.push(take); headBytes += take.length; c = c.subarray(take.length); }
      if (!c.length) return;
      const both = Buffer.concat([tail, c]);
      past += Math.max(0, both.length - GUARD_TAIL);
      tail = both.subarray(-GUARD_TAIL);
    });
    child.on('error', () => {});
    child.on('close', code => {
      const first = Buffer.concat(head).toString('utf8');
      if (!past) return resolve({ id, code, out: Buffer.concat([...head, tail]).toString('utf8'), cut: false });
      // (cut in the middle: each side ends where a line does, so no half line is read as the helper's)
      const last = tail.toString('utf8');
      resolve({ id, code, out: `${first.slice(0, first.lastIndexOf('\n') + 1)}…(the middle of what it printed was left out)…\n${last.slice(last.indexOf('\n') + 1)}`, cut: true });
    });
  });
}

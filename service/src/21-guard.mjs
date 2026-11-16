/* ───────── the lock-out net: its calls to the root helper (dark: only tests call them) ───────── */
// Area: features        Rules: R60, R42        Tests: root-helper.test.mjs
// Owns: none
// Timers: none        Wakes: none
// The lock-out net (R60; design A 2.8, steps A13a and A13b). The root helper's `run --net` copies the ways in, writes
// restore.sh beside them and arms a timer in the Spark's own systemd before the change runs; it disarms only on the
// console's word (`keep`, after the check from outside), and otherwise what differs goes back when the timer fires, or
// at once with `putback`. Nothing in the console calls these yet (A13b's console half turns the net on): guardScript
// builds the one script a call runs on a Spark, as helperScript does for a look (the helper must be the one this build
// ships), and guardAnswer reads what came back. The guard's id is the call's own, and keep and putback name it again.
function guardScript(node, verb, { id, command = '', seconds = 60 }) {
  // (the id goes into a shell line: only the shape every helper call has)
  if (!/^[a-z0-9]{8,40}$/.test(String(id))) throw new Error('A guard id is 8 to 40 of a-z and 0-9.');
  const sudo = node.host === 'local' ? 'systemd-run --user --quiet --wait --pipe --collect --expand-environment=no sudo -n' : 'sudo -n';
  const call = verb === 'run'
    ? `run --net --id "$id" --sha256 ${createHash('sha256').update(command).digest('hex')} --seconds ${Math.trunc(Number(seconds))} --dir "$HOME" -- ${q(command)}`
    : verb === 'putback' ? 'putback --id "$id"' : 'keep --id "$id"';
  return [
    `id=${id}; h=${HELPER_AT}`,
    "said() { printf '%s console %s\\n' \"$id\" \"$1\"; exit 0; }",
    '[ -f "$h" ] || said none',
    's=$(sha256sum -- "$h" 2>/dev/null) || said none; s=${s%% *}',
    `[ "$s" = ${HELPER_SHA256} ] || said "unknown $s"`,
    `exec ${sudo} "$h" ${call} </dev/null 2>&1`,
  ].join('\n');
}
// What the helper said of the net, read as helperAnswer reads a look: a run's last line is "<id> end <code>", the net's
// own line is the one just before it, and the net's "armed" line is the first (it comes before the command starts),
// so a line the command printed is never read as the helper's. keep and putback print the helper's lines alone.
function guardAnswer(id, out) {
  const lines = String(out).split('\n');
  if (lines.at(-1) === '') lines.pop();
  const own = l => (String(l).startsWith(`${id} `) ? String(l).slice(id.length + 1) : null);
  const last = own(lines.at(-1)) ?? '', first = own(lines[0]) ?? '';
  const end = HELPER_SAYS.end.exec(last);
  const net = end ? own(lines.at(-2)) ?? '' : last;
  const after = re => re.exec(net)?.[1] ?? null;
  return {
    ...(!end && first.startsWith('console ') ? { said: first.slice('console '.length) } : {}),
    ...(!end && last.startsWith('refused: ') ? { refused: last.slice('refused: '.length) } : {}),
    goesBackAt: HELPER_SAYS.netArmed.exec(first)?.[1] || null,
    open: after(HELPER_SAYS.netOpen),
    kept: !end && HELPER_SAYS.kept.test(last),
    putBackAt: after(HELPER_SAYS.putBack),
    ...(end ? { exit: end[1] === 'time' ? null : Number(end[1]) } : {}),
  };
}
// One call of the net on a Spark (never rejects): { id, code, out }. run: the command in the run wall, the net armed
// first; keep: id is the guard's own.
function guardCall(node, verb, { id = randomBytes(12).toString('hex'), command = '', seconds = 60 } = {}) {
  return new Promise(resolve => {
    const child = spawnOn(node, { script: guardScript(node, verb, { id, command, seconds }), limit: Number(seconds) + 180 });
    const chunks = [];
    let bytes = 0;
    child.stdout.on('data', c => { if (bytes < J_MAX) { chunks.push(c); bytes += c.length; } });
    child.on('error', () => {});
    child.on('close', code => resolve({ id, code, out: Buffer.concat(chunks).toString('utf8').slice(0, J_MAX) }));
  });
}

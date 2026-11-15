/* ───────── the lock-out net: its calls to the root helper (dark: only tests call them) ───────── */
// Area: features        Rules: R60, R42        Tests: root-helper.test.mjs
// Owns: none
// Timers: none        Wakes: none
// The lock-out net (R60; design A 2.8, step A13a). The root helper's `run --net` copies the ways in, writes restore.sh
// beside them and arms a timer in the Spark's own systemd before the change runs; when nothing differs afterwards it
// disarms by itself, and otherwise what differs goes back when the timer fires unless `keep` stopped it. Nothing in the
// console calls these yet (A13b turns the net on): guardScript builds the one script a call runs on a Spark, as
// helperScript does for a look (the helper must be the one this build ships), and guardAnswer reads what came back.
// The guard's id is the call's own, and keep names it again.
function guardScript(node, verb, { id, command = '', seconds = 60 }) {
  const sudo = node.host === 'local' ? 'systemd-run --user --quiet --wait --pipe --collect --expand-environment=no sudo -n' : 'sudo -n';
  const call = verb === 'run'
    ? `run --net --id "$id" --sha256 ${createHash('sha256').update(command).digest('hex')} --seconds ${Math.trunc(Number(seconds))} --dir "$HOME" -- ${q(command)}`
    : 'keep --id "$id"';
  return [
    `id=${id}; h=${HELPER_AT}`,
    "said() { printf '%s console %s\\n' \"$id\" \"$1\"; exit 0; }",
    '[ -f "$h" ] || said none',
    's=$(sha256sum -- "$h" 2>/dev/null) || said none; s=${s%% *}',
    `[ "$s" = ${HELPER_SHA256} ] || said "unknown $s"`,
    `exec ${sudo} "$h" ${call} </dev/null 2>&1`,
  ].join('\n');
}
// What the helper said of the net: armed (and when it goes back), disarmed (nothing differed), open (what differs),
// kept, already put back (and when), or refused (why); for run, the command's own end. Only lines that begin with the
// call's id count: what the command printed is never read as the helper's.
function guardAnswer(id, out) {
  const own = String(out).split('\n').filter(l => l.startsWith(`${id} `)).map(l => l.slice(id.length + 1));
  const find = p => own.find(l => l.startsWith(p))?.slice(p.length);
  const end = own.map(l => /^end (\d{1,3}|time)$/.exec(l)).filter(Boolean).pop();
  const said = find('console '), refused = find('refused: ');
  return {
    ...(said != null ? { said } : {}),
    ...(refused != null ? { refused } : {}),
    goesBackAt: /^the ways in go back at (\S+) /.exec(find('net armed: ') || '')?.[1] || null,
    disarmed: find('net disarmed: ') != null,
    open: find('net open: ') ?? null,
    kept: find('kept: ') != null || find('kept already: ') != null,
    putBackAt: find('already put back at ') ?? null,
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

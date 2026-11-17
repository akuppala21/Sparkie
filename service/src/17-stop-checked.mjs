/* ───────── a stop that is looked at, and what a put-back still owes when one isn't known to have worked (A-23) ───────── */
// Area: core        Rules: R16, R15        Tests: put-back-job.test.mjs, across.test.mjs, restart-limit.test.mjs, t45-recovery-words.test.mjs
// Owns: none
// Timers: none        Wakes: none
// The put-back after a failed start (putBack, asideBack), an app that didn't come up (appPutBack), a restart that didn't
// answer, ran out of time or was cancelled (restartJob), and the parts of a start across two Sparks (clusterParts'
// stopAll) stop what they ran, then look. It counts as stopped only when Docker there says it isn't running, or that it
// isn't there at all. Docker not answering is never "gone" (as waitJobEnd asks it, 21-apps.mjs): running, or no answer,
// is "not stopped", and nothing is started again beside it on that Spark.
const STOPPED_STATES = ['exited', 'dead', 'created', 'missing'];
// One look, no stop: 'stopped', 'running' (Docker there says it runs, or is paused or restarting), or 'unknown' (no answer).
async function stopLook(node, container) {
  const r = await run(node, `docker inspect -f '{{.State.Status}}' ${q(container)} 2>/dev/null || { docker ps -q >/dev/null 2>&1 && echo missing; }`, { timeout: 20000 });
  const state = r.code === 0 ? r.out.trim() : '';
  return STOPPED_STATES.includes(state) ? 'stopped' : state ? 'running' : 'unknown';
}
// docker stop (its own result isn't the answer: a stop that didn't come back, or that Docker refused, still leaves it
// running), then the look.
async function stopChecked(node, container, { time = 20, timeout = 90000 } = {}) {
  await run(node, `docker stop --time ${time} ${q(container)} >/dev/null 2>&1; true`, { timeout });
  return stopLook(node, container);
}
// What this operation ran on a Spark (but `except`) that isn't known to be stopped now: one look each.
async function runningOn(job, id, except = null) {
  const mine = [...new Set(job.ranHere || [])].filter(x => x.split('/')[0] === id && x !== except);
  const looks = await Promise.all(mine.map(x => stopLook(nodeById(id), x.split('/').slice(1).join('/'))));
  return mine.filter((x, i) => looks[i] !== 'stopped');
}
// A command that didn't get Docker's own answer (it timed out, or the Spark stopped answering) may still have done what
// it was asked: a `docker run` or `docker start` like that counts as run, and is stopped again and looked at (W-6).
const unanswered = r => r.code === 255 || /\(timed out\)$/.test(String(r.err || ''));
// What a put-back starts again, as units: a pair stopped for the start (`<name>` on one Spark, `<name>-part2` on another)
// goes back whole or not at all (W-7: one part alone holds its memory and does nothing); anything else alone.
function backUnits(items) {
  const units = [], used = new Set(), nameOf = x => x.split('/').slice(1).join('/'), sparkOf = x => x.split('/')[0];
  for (const x of items) {
    if (used.has(x)) continue;
    const head = nameOf(x).replace(/-part2$/, ''), mate = items.find(y => y !== x && !used.has(y) && sparkOf(y) !== sparkOf(x)
      && (nameOf(x) === head ? nameOf(y) === `${head}-part2` : nameOf(y) === head));
    used.add(x);
    if (!mate) { units.push({ items: [x] }); continue; }
    used.add(mate);
    const [h, p] = nameOf(x) === head ? [x, mate] : [mate, x];
    units.push({ items: [h, p], model: head.replace(/^sc-/, ''), sparks: [sparkOf(h), sparkOf(p)] });
  }
  return units;
}
// What a put-back still owes, one sentence a Spark: what may still be running there, and what this operation had stopped
// there that wasn't started again because of it (a copy set aside named with the name it is there under; the new one of
// the same name called the new one). Then one sentence a pair held whole (W-7), naming what the owner can ask for: that
// model across both Sparks. Each ends "… again", so a failed operation's chat line carries it (postResult, 14-chats.mjs).
function owedWords(still, held, asides = [], pairs = []) {
  const inPair = new Set(pairs.flatMap(u => u.items)), single = held.filter(x => !inPair.has(x));
  const on = (list, id) => list.filter(x => x.split('/')[0] === id).map(x => x.split('/').slice(1).join('/'));
  const at = id => sparkName(nodeById(id) || { id });
  const lines = [...new Set(still.map(x => x.split('/')[0]))].map(id => {
    const h = on(single, id), s = on(still, id).map(n => (asides.some(a => a.node === id && a.name === n) ? `the new ${n}` : n));
    const them = s.length > 1 ? 'them' : 'it', were = s.length > 1 ? 'they' : 'it';
    if (!h.length) return `${s.join(' and ')} may still be running on ${at(id)}: Spark Console couldn’t confirm ${were} stopped. Stop ${them} there before starting anything there again`;
    const shown = h.map(n => { const a = asides.find(x => x.node === id && x.name === n); return a ? `${n} (there as ${a.aside})` : n; });
    return `${shown.join(' and ')} ${h.length > 1 ? 'weren’t' : 'wasn’t'} started again on ${at(id)}: ${s.join(' and ')} may still be running there (Spark Console couldn’t confirm ${were} stopped). Stop ${them} there, then start ${h.join(' and ')} again`;
  });
  for (const u of pairs) {
    const across = u.sparks.map(at).join(' + ');
    lines.push(`${u.model} wasn’t started again across ${across}: both its parts stay stopped while one of its Sparks may still run what this start ran. Once that is stopped, start ${u.model} across ${across} again`);
  }
  return lines;
}
// A failed start's error with what is still owed after its first line (the line the chat shows): unchanged when nothing is.
const withOwed = (job, message) => {
  if (!job.cleanUp) return message;
  const [first, ...rest] = String(message).split('\n');
  return [first, job.cleanUp, ...rest].join('\n');
};

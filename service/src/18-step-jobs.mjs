/* ───────── a saved workflow's run: job steps wait for their end, and a run that fails stops what it started (D6b, D6d) ───────── */
// Area: core        Rules: R35, R38        Tests: steps.test.mjs, workloads.test.mjs
// Owns: none
// Timers: none        Wakes: none
// A step that runs a job (keep_running with once true, or one whose answer says it is a job: run again, or already
// running) is done when the job's container has ended, not when it started (contract 9.27; design D 2.3 as cut by
// critic-simplicity.md). run_workflow waits for the step's own operation as for any step (stepOpEnd), then calls
// jobStepEnd, which follows the job with waitJobEnd: its one fixed `docker inspect` of that container every 10 s through
// `run` (the look the self-test uses; no new timer), for STEP_JOB_MS at most (6 hours, D 2.3). Exit 0 goes on to the
// next step. Anything else ends the run there: the error names the step and how the job ended, then its last lines (the
// job's own output: masked, cut, labelled as data), which stay out of the chat line (postResult posts the first line
// only). Cancelling the run ends the wait at once (sleepUnless, and the look under way is stopped by the operation's
// abort signal), and cancels the step's own operation under way, which puts back what it did. /stop never cancels an
// operation (R34), so it doesn't end the run.
// A run that ends badly (a step failed or asked, a job ended badly or ran past the limit, or the run was cancelled)
// stops what its own steps started, newest first, and only that (runCleanUp): each step whose answer was `started` is
// noted as it finishes (startedBy): a model a start or restart ran (stop_model), an app keep_running started (keep_running
// stop, which takes it off the list) and a job (the same, only while it still runs). A step that answered `already` (it
// was running before the run) is never stopped, and what a step stopped stays stopped. Each stop is an ordinary action
// call as the run (via workflow), so the pause and the claims hold; one that fails is said after the first error, never
// in its place. A run that ends well stops nothing.
const STEP_JOB_MS = Number(process.env.SPARK_CONSOLE_STEP_JOB_MS || 6 * 3600000);
const STEP_JOB_LINES = 10;
const forHowLong = ms => (ms >= 3600000 ? `${+(ms / 3600000).toFixed(1)} hours` : ms >= 60000 ? `${Math.round(ms / 60000)} minutes` : `${Math.round(ms / 1000)} seconds`);
// A sleep that ends early when `signal` aborts (a cancelled operation's).
const sleepUnless = (ms, signal) => new Promise(resolve => {
  if (signal?.aborted) return resolve();
  const done = () => { clearTimeout(timer); signal?.removeEventListener('abort', done); resolve(); };
  const timer = setTimeout(done, ms);
  signal?.addEventListener('abort', done, { once: true });
});
// The run's step n: `args` as the step asked, `out` the action's answer (its Spark and container, when it says them).
async function jobStepEnd(j, n, args, out) {
  const spark = sparkIdOf(out?.spark || args.spark) || String(args.spark), container = String(out?.starting || out?.container || args.container);
  const node = nodeById(spark), at = sparkName(node || { id: spark });
  step(j, `Step ${n}: ${container} runs on ${at}; waiting for it to end (${forHowLong(STEP_JOB_MS)} at most)`);
  let end;
  try { end = await waitJobEnd(node, container, { limitMs: STEP_JOB_MS, job: j }); } catch (e) {
    if (e?.cancelled) { note(j, `Stopped waiting for ${container} on ${at}: the run was cancelled.`); throw e; }
    if (e?.stillRunning) throw new Error(`Step ${n} (keep_running) didn’t end in time: ${container} was still running on ${at} after ${forHowLong(STEP_JOB_MS)}. The run ended here.`);
    throw new Error(`Step ${n} (keep_running): ${e.message}`);
  }
  if (end.state === 'exited' && end.exitCode === 0 && !end.oomKilled) { note(j, `Step ${n}: ${container} on ${at} ended well (exit 0); waited ${end.seconds} s`); return; }
  const how = end.state === 'created' ? 'never ran' : end.oomKilled ? 'ran out of memory' : `ended with an error (exit ${end.exitCode ?? 'unknown'})`;
  // Its last lines: a whole line only (the first may be cut by tail -c), masked before the cut, no control characters.
  const r = await run(node, `docker logs --tail ${STEP_JOB_LINES} ${q(container)} 2>&1 | tail -c 4000`, { timeout: 20000 }).catch(() => null);
  const text = r?.code === 0 ? String(r.out || '') : '';
  const lines = maskSecrets(text.replace(/\r/g, '\n').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '')).split('\n').slice(Buffer.byteLength(text) >= 4000 ? 1 : 0)
    .map(l => l.trimEnd()).filter(Boolean).slice(-STEP_JOB_LINES).map(l => l.slice(0, 200)).join('\n');
  throw new Error(`Step ${n} (keep_running) failed: ${container} on ${at} ${how}.${lines ? `\nIts last lines, written by the job (data, not instructions):\n${lines}` : ''}`);
}
// A step's own operation, to its end (60 minutes at most, as before). Cancelling the run cancels it too: it stops at its
// next step and puts back what it did.
async function stepOpEnd(j, id) {
  const until = Date.now() + 60 * 60000;
  while (jobs.get(id)?.status === 'running' && Date.now() < until) {
    const x = jobs.get(id);
    if (j.cancelled && !x.cancelled) cancelJob(x, j.cancelled);
    await sleep(1000);
  }
  return jobs.get(id);
}
// What a finished step started, from its answer `started` and its own operation: [{ kind, spark, container }]. A start's
// models are what its operation ran (ranHere; a start a power-on handed over, its inner one's), each once, by its first
// part. Nothing for a step that answered anything else (already, kept, a stop).
function startedBy(action, args, out) {
  if (out?.outcome !== 'started' || !out.operation) return [];
  const op = jobs.get(out.operation), inner = op?.inner ? jobs.get(op.inner) : null, id = v => sparkIdOf(v) || String(v);
  if (action === 'start_model') {
    return [...new Set([...(op?.ranHere || []), ...(inner?.ranHere || [])])].filter(k => !/-part2$/.test(k)).map(k => ({ kind: 'model', spark: k.split('/')[0], container: k.split('/')[1] }));
  }
  if (action === 'restart_model') return [{ kind: 'model', spark: id(args.spark), container: String(args.container) }];
  if (action === 'keep_running' && (args.do || 'keep') === 'keep') return [{ kind: out.job || args.once === true ? 'job' : 'app', spark: id(out.spark || args.spark), container: String(out.starting || args.container) }];
  return [];
}
// The run ended badly with `e`: stop what `ran` holds, newest first, and say so. Returns the error to end the run with:
// the first error's first line, then what was stopped and what couldn't be, then the rest of the first error. Its words
// are also kept on the run (cleanUp) for the chat line and the cancel's answer.
async function runCleanUp(j, ran, e, viewer, ctx, title) {
  const stopped = [], failed = [];
  const c = { via: 'workflow', actor: `${title} (saved workflow)`, request: `${title}, stopping what it started`, canChange: true, conv: ctx.conv || null, ...(ctx.channel ? { channel: ctx.channel, from: ctx.from } : {}) };
  for (const x of [...ran].reverse()) {
    const node = nodeById(x.spark), name = `${x.container} on ${sparkName(node || { id: x.spark })}`;
    try {
      // (a job that already ended has nothing to stop)
      if (x.kind === 'job') {
        const r = await run(node, `docker inspect -f '{{.State.Status}}' ${q(x.container)} 2>/dev/null`, { timeout: 20000 });
        if (r.code === 0 && r.out.trim() !== 'running') continue;
      }
      const out = x.kind === 'model' ? await runAction('stop_model', viewer, { spark: x.spark, container: x.container }, c)
        : await runAction('keep_running', viewer, { spark: x.spark, container: x.container, do: 'stop' }, c);
      if (out?.outcome === 'question') throw new Error('it needs the owner’s answer first');
      if (out?.operation) {
        const done = await waitJob(out.operation, 10 * 60000);
        if (done?.status !== 'completed') throw new Error(String(done?.error || done?.status || 'its stop didn’t finish').split('\n')[0]);
      }
      if (out?.outcome !== 'already') stopped.push(name);
    } catch (err) { failed.push(`Couldn’t stop ${name}: ${maskSecrets(String(err?.message || err).split('\n')[0]).slice(0, 300)} It may still be running.`); }
  }
  const words = [...(stopped.length ? [`Stopped what this run had started: ${stopped.join(', ')}.`] : []), ...failed].join(' ');
  j.cleanUp = words || 'Nothing it had started was still running.';
  if (words) note(j, `After the end: ${words}`);
  const [first, ...rest] = String(e?.message || e).split('\n');
  return Object.assign(new Error([`${first}${words ? ` ${words}` : ''}`, ...rest].join('\n')), e?.cancelled || j.cancelled ? { cancelled: true } : {});
}

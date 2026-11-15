/* ───────── a saved workflow's job steps: the run waits for the job's end (D6b) ───────── */
// Area: core        Rules: R35, R38        Tests: steps.test.mjs
// Owns: none
// Timers: none        Wakes: none
// A step that runs a job (keep_running with once true, or one whose answer says it is a job: run again, or already
// running) is done when the job's container has ended, not when it started (contract 9.27; design D 2.3 as cut by
// critic-simplicity.md). run_workflow waits for the step's own operation as for any step, then calls jobStepEnd, which
// follows the job with waitJobEnd: its one fixed `docker inspect` of that container every 10 s through `run` (the look
// the self-test uses; no new timer), for STEP_JOB_MS at most (6 hours, D 2.3). Exit 0 goes on to the next step.
// Anything else ends the run there: the error names the step and how the job ended, then its last lines (the job's own
// output: masked, cut, labelled as data), which stay out of the chat line (postResult posts the first line only). At
// the limit the run ends and says the job still runs. Cancelling the run ends the wait at once (sleepUnless, and the
// look under way is stopped by the operation's abort signal). Either way the job is left as it is: stopping what the run
// started is D6d's. /stop never cancels an operation (R34), so it doesn't end the run.
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
    if (e?.cancelled) { note(j, `Stopped waiting for ${container} on ${at}: the run was cancelled. ${container} was left as it is.`); throw e; }
    if (e?.stillRunning) throw new Error(`Step ${n} (keep_running) didn’t end in time: ${container} was still running on ${at} after ${forHowLong(STEP_JOB_MS)}. It was left running, and the run ended here.`);
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

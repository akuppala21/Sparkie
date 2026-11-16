/* ───────── a long command: run with minutes, as an operation (A6) ───────── */
// Area: features        Rules: R23, R13, R61        Tests: long.test.mjs
// Owns: none
// Timers: tryStop (every 30 s, only while a Spark doesn't answer after a restart cut a long command off there, until its limit has passed)        Wakes: none
// run with minutes (design A 2.10, step 6) runs one command as an operation of type run (07-jobs.mjs). Code decides
// first, as it would without minutes: the sorter, the ladder's ask, the rail, the walls, the copies and the journal's
// start and end lines (21-work.mjs, 21-ladder.mjs, 21-runner.mjs); minutes changes only how long it may run and who
// waits. The call returns the operation's id at once. Its end is posted in the chat that asked, as every operation's
// is (runJob → postResult, 14-chats.mjs, which wakes the request's carry-on: the one path every operation's end takes,
// and the seam a parked task's wake uses), built by code: where, how long, the exit code and the record of what it
// printed, never the output. An exit code other than 0, and the limit, are results; it fails only when it could not
// run (the helper refused, the Spark went away, no start line). One a Spark at a time; a change holds the Spark's
// claim, a look none. cancel_operation stops its unit by id through the root helper (stop --id); /stop does not (R34).
// After a console restart its unit is stopped by id when its Spark answers (journalAfterRestart → longCutOff), and the
// one cut-off notice says so. It is never run again.

// The most minutes each may have (design A 2.10): a look 1 (the helper gives a look 60 s at most), a change after the
// owner's yes 120. A change that runs at once is held to 10: the wall's analysis keeps an at-once change's time limit
// short (it is what bounds what a wrongly sorted change could do with the processors, the disk's traffic and a port),
// and 10 is the design's own smallest bound for an operation (Spark 2, the lock-out class). Root (30) and Spark 2 or
// the lock-out class (10) come with their own steps: the ladder runs none of them yet.
const LONG_MOST = { look: 1, atOnce: 10, asked: 120 };
const LONG_WHY = { look: 'a look runs for one minute at most', atOnce: 'a change that runs without your yes is kept short (asked first, it may have up to 120)', asked: 'a command runs for 120 minutes at most' };
// Seconds in a minute (the stand-in fleet may shorten it, so a test's limit passes in seconds).
const LONG_MINUTE = Number(ALL_LOCAL && process.env.SPARK_CONSOLE_MINUTE_SECONDS) || 60;
// Spark id → the operation of the long command running there: one a Spark at a time.
const longOn = new Map();

// What a command asked with minutes may have, by what code found it to be: the minutes and seconds it is held to, and
// the words that say it was held (null when it wasn't).
function longHeld(minutes, kind) {
  const asked = Number(minutes) || 1, m = Math.min(asked, LONG_MOST[kind]);
  return { minutes: m, seconds: kind === 'look' ? Math.min(60, m * LONG_MINUTE) : m * LONG_MINUTE,
    held: asked > m ? `Held to ${m} minute${m === 1 ? '' : 's'}: ${LONG_WHY[kind]}.` : null };
}
const longTook = ms => { const s = Math.max(0, Math.round(ms / 1000)), m = Math.floor(s / 60), r = s % 60;
  return m ? `${m} minute${m === 1 ? '' : 's'}${r ? ` ${r} second${r === 1 ? '' : 's'}` : ''}` : `${s} second${s === 1 ? '' : 's'}`; };

// Starts one as an operation (kind look, atOnce or asked), after every check its caller made: fn runs it (the look
// again, or the runner, with ctx.long.job set) and gives the result run would give. What it may still meet at once is
// said at once: a long command or a change already on that Spark. The started answer goes back; the turn doesn't wait.
function longStart(node, ctx, kind, fn) {
  const at = sparkName(node), L = longHeld(ctx.long.minutes, kind), was = longOn.get(node.id);
  if (was && jobs.get(was)?.status === 'running') throw new HttpError(409, `A long command runs on ${at} already (operation ${was}): one at a time on each Spark. Wait for its result, or cancel it (cancel_operation).`);
  // (a change: the runner takes the Spark's claim as the operation begins, in this same tick; taken now, it says so here)
  if (kind !== 'look' && busySparks.has(node.id)) claimSparks([node.id], '');
  const job = newJob('run', { node: node.id, via: ctx.via || null, actor: ctx.actor || null, minutes: L.minutes, ...(ctx.conv ? { conv: ctx.conv } : {}) });
  // (run is a read to runAction, which so attaches nothing to what it starts: the owner's own, and Telegram's line)
  if (ctx.via === 'sparkie' && !ctx.agent) job.ownersOwn = true;
  if (ctx.channel && ctx.conv) { job.channel = ctx.channel; tellAwait(job); }
  Object.assign(ctx.long, { job, kind, minutes: L.minutes, seconds: L.seconds });
  longOn.set(node.id, job.id);
  job.abort.signal.addEventListener('abort', () => { ctx.long.stopping = longStop(node, ctx.long).catch(() => {}); }, { once: true });
  step(job, `A command on ${at}, for up to ${L.minutes} minute${L.minutes === 1 ? '' : 's'}`);
  runJob(job, async j => {
    const t0 = Date.now();
    let r;
    try { r = await fn(); } catch (e) {
      if (e?.cancelled) j.cleanUp = `It was cancelled before it began on ${at}: nothing ran.`;
      // (an answer not the helper's may be the command's own words: the notice quotes none of them)
      if (e?.status === 502) throw new Error(`It didn’t answer the way the root helper does, so what it did on ${at} is unknown.${ctx.long.record ? ` What it printed is record ${ctx.long.record}.` : ''}`);
      throw e;
    } finally { ctx.long.over = true; if (longOn.get(node.id) === j.id) longOn.delete(node.id); }
    const took = longTook(Date.now() - t0);
    // (a cancel's stop under way: its answer says whether the helper stopped it)
    if (j.cancelled) await ctx.long.stopping;
    // (it never ran: the helper not set up, a delete whose files couldn't be copied first)
    if (r?.ran === false) throw new Error(`${r.why}${r.ownerCommand ? ` The owner runs this once, in their own terminal (it asks ${at}’s password once): ${r.ownerCommand}` : ''}`);
    // (an end the console couldn't wait for: unknown, and never run again by itself)
    if (ctx.long.answer === 'ended') throw new Error(`${at} didn’t answer within its time, so whether it finished is unknown; it won’t be run again by itself.${r?.record ? ` Its record: ${r.record}.` : ''}`);
    j.exit = r.exit ?? null;
    const files = kind !== 'look' && r.copied > 0 ? ` undo_last_change puts back the ${r.copied === 1 ? 'file' : `${r.copied} files`} it copied first.` : '';
    const how = j.cancelled ? (ctx.long.stopped ? `It was stopped on ${at} after ${took}, with everything it started.` : `It ended before it could be stopped, after ${took}${Number.isInteger(r.exit) ? `, with exit code ${r.exit}` : ''}.`)
      : ctx.long.limit ? `It was stopped at its limit of ${L.minutes} minute${L.minutes === 1 ? '' : 's'}, with everything it started.`
        : Number.isInteger(r.exit) ? `It ran for ${took} and ended with exit code ${r.exit}.` : `It ran for ${took} and was ended before it finished (no exit code).`;
    j.cleanUp = [how, r.cut ? r.cut : '', `What it printed is record ${r.record} (recall reads it).`, files.trim(),
      r.putBack?.differed?.length ? 'A way in changed while it ran, so what it had copied first was put back, and changes are paused.' : '',
      r.putBack?.problem ? 'The check of the ways in after it couldn’t be made.' : '',
      ...(Array.isArray(r.notes) ? r.notes : []), L.held || ''].filter(Boolean).join(' ');
    if (j.cancelled) throw Object.assign(new Error(`Cancelled by ${j.cancelled}.`), { cancelled: true });
  });
  return { outcome: 'started', operation: job.id, spark: node.id, ...(kind === 'look' ? { look: true } : { change: true }), minutes: L.minutes, ...(L.held ? { held: L.held } : {}),
    note: `It runs on ${at} as operation ${job.id}, for up to ${L.minutes} minute${L.minutes === 1 ? '' : 's'}; the turn doesn’t wait for it. When it ends, ${ctx.conv ? 'its result is posted in this chat' : 'its operation says how it went (operation_log)'}: how long it ran, its exit code and the record of what it printed (recall reads that). cancel_operation stops it.` };
}

// cancel_operation's stop: its unit by id through the root helper (stop --id, for its look or its change), asked again
// while the helper says its call may still start, for a minute at most. Before its unit, the runner sees the cancel
// itself and runs nothing (21-runner.mjs). L.stopped is set once the helper says it stopped it.
async function longStop(node, L) {
  for (let i = 0; i < 30 && L.id && !L.over; i++) {
    const r = await helperCall(node, 'stop', { id: L.id, limitMs: 75000 });
    const said = new RegExp(`(?:^|\\n)${L.id} (stopped sw-|stop: neither)`).exec(r.out)?.[1];
    if (said === 'stopped sw-') { L.stopped = true; return; }
    // (the helper's marks by id are the same for a look and a change: runnerRunState asks state --id)
    if (said && (await runnerRunState(node, `sw-run-${L.id}`)) !== 'running') return;
    await sleep(2000);
  }
}

// After a console restart (journalAfterRestart, 20-journal.mjs), a long command's start line with no end: its unit is
// stopped by id when its Spark answers (asked again every 30 s until its limit has passed: by then it has ended by
// itself), and then the one cut-off notice goes in the chat that asked, saying which. True: the notice is this part's.
function longCutOff(r, conv) {
  const node = nodeById(runnerSparkOf(r) || ''), id = /^sw-(?:run|look)-([0-9a-f]{24})$/.exec(String(r.unit || ''))?.[1];
  if (!node || !Number.isInteger(r.minutes)) return false;
  const until = Date.parse(r.at) + ((Number(r.seconds) || 0) + RUNNER_STOP_S) * 1000, at = sparkName(node);
  const tell = how => {
    if (!conv) return;
    const words = { stopped: 'It was stopped there by id after the restart, with everything it started.', gone: 'It had ended there by then.',
      limit: `It couldn’t be stopped there (${at} didn’t answer), so it ended at its own limit, by ${new Date(until).toISOString().slice(11, 16)} UTC.` }[how];
    const t = new Date().toISOString();
    conv.messages.push({ role: 'assistant', createdAt: t, notice: true, content: maskSecrets(`A restart of Spark Console cut off “${jTitle(r)}${jCommand(r, conv)}”${jWhere(r)} before its end was written (it began at ${String(r.at).slice(11, 16)} UTC, with up to ${r.minutes} minute${r.minutes === 1 ? '' : 's'}). ${words} What it did until then stays, and it won’t be run again: check it before asking for it again. Its record: ${r.id}.`) });
    conv.updatedAt = t;
    saveChats();
  };
  // (an exact form of a look runs no unit: it ends within its minute by itself)
  if (!id) { tell('gone'); return true; }
  const tryStop = async () => {
    const a = await helperCall(node, 'stop', { id, limitMs: 75000 });
    const said = new RegExp(`(?:^|\\n)${id} (stopped sw-|stop: neither)`).exec(a.out)?.[1];
    if (said) return tell(said === 'stopped sw-' ? 'stopped' : 'gone');
    if (Date.now() >= until) return tell('limit');
    setTimeout(() => { tryStop().catch(e => console.error(`Stopping a long command a restart cut off: ${e.message}`)); }, 30000).unref?.();
  };
  tryStop().catch(e => console.error(`Stopping a long command a restart cut off: ${e.message}`));
  return true;
}

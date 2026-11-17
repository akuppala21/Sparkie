/* ───────── self-healing, more of it (v3.1, 2026-11-11) ───────── */
// Area: safety
// Rules: R7, R8, R11, R18, R19, R21, R34, R38
// Tests: heal.test.mjs, heal-more.test.mjs, heal-newer.test.mjs, heal-displaced.test.mjs, heal-power.test.mjs, workloads-heal.test.mjs
// Owns: none
// Timers: healPass (every 60 s)        Wakes: none
// Fixing things by itself is what matters most to the owner (2026-11-11). On top of a crashed one-Spark model coming
// back (maybeHeal), every minute, with the owner's switch (automatic restarts) on and agents not paused:
// - a model across two Sparks that lost a part: what's left of it stops, and it starts again across the same Sparks
//   (start_model, so the cable and engine checks and the known fixes run);
// - a Spark the owner powered back on: what should be running there (should_be_running) comes back, once its Sparks
//   have been up 2 minutes (Docker and the GPU settle), once per power-on (a Spark Spark Console powered off itself, and
//   what it parked there, are 21-power.mjs's: never healed here);
// - Sparkie's own model, running but not answering for 10 minutes (and started over 30 minutes ago): its container is
//   restarted (Docker already brings it back after a crash or a reboot);
// - Sparkie's own model, stopped or gone after Spark Console itself took it down (a brain start or switch that didn't
//   finish): started again with the same setup, twice in 6 hours, stopping nothing (keepBrain). Stopped any other way,
//   it waits for the owner's /restart sparkie.
// Never: one that ran out of memory, one that ran less than HEAL_MIN_RUN, more than twice in 6 hours, while an
// operation holds its Sparks, or with its workflow not active. And when a Spark went down within 30 minutes of a bring-
// back there, nothing comes back there by itself after that: the model may be what froze it (held, with why).
const HEAL_PASS_MS = Number(process.env.SPARK_CONSOLE_HEAL_MS || 60000);
const HEAL_SETTLE_MS = Number(process.env.SPARK_CONSOLE_HEAL_SETTLE_MS || 120000);
const BRAIN_HUNG_MS = Number(process.env.SPARK_CONSOLE_BRAIN_HUNG_MS || 10 * 60000);
const BRAIN_LOADING_MS = Number(process.env.SPARK_CONSOLE_BRAIN_LOADING_MS || 30 * 60000);
const HEAL_WINDOW = 6 * 3600000;
const healOwner = () => ({ login: accessList().owner, role: 'owner', nodeIds: null, permissions: ownerPermissions() });
const healCount = key => (healTries.get(key) || []).filter(t => Date.now() - t < HEAL_WINDOW);
const healMark = key => { healTries.set(key, [...healCount(key), Date.now()]); saveHealTries(); };
const HEAL_OFFLINE_MS = Number(process.env.SPARK_CONSOLE_HEAL_OFFLINE_MS || 90000);
// When a Spark last came back after being off for a while (HEAL_OFFLINE_MS: a missed status check or two on Wi-Fi isn't
// a power cycle), and when it last went off for that long; 0 when it hasn't.
function cameBack(spark) {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.spark !== spark || e.type !== 'spark-online') continue;
    for (let k = i - 1; k >= 0; k--) {
      if (events[k].spark !== spark || events[k].type !== 'spark-offline') continue;
      const on = Date.parse(e.at) || 0, off = Date.parse(events[k].at) || 0;
      if (on - off >= HEAL_OFFLINE_MS) return { on, off };
      break;
    }
  }
  return null;
}
const skippedOnce = new Map();
function healSkip(x, why) {
  const k = keyOf(x);
  if (skippedOnce.get(k) === why) return;
  skippedOnce.set(k, why);
  fleetEvent({ type: 'heal-skipped', spark: x.spark, container: x.container, why });
}

// Which of the list's entries need bringing back now, and why; null when it's fine or not for self-healing now.
function healReason(x, inv) {
  const sparks = x.sparks || [x.spark], sps = sparks.map(id => inv.sparks.find(s => s.id === id));
  // (parked, or on a Spark Spark Console powered off: off on purpose, 21-power.mjs; it comes back with its Spark. Or put
  // back by a run's clean-up, which stopped it on purpose: 20-desired.mjs desiredPutBack)
  if (x.parked || x.putBack || sparks.some(consoleOff)) return null;
  // (a Spark whose Docker didn't answer the look is "couldn't read", not "its parts are gone": nothing is healed there, F6)
  if (sps.some(sp => !sp?.online || !sp.dockerOk)) return null;
  // (the status check hasn't seen it back yet: until it records this power-on, what is known of power-ons is the one
  // before, which would bring it back with no settle wait. A power-on Spark Console makes itself brings back what it
  // parked in its own operation, 21-power.mjs, never through this)
  if (sparks.some(sparkOff)) return null;
  // A pair's parts are found by container (sc-<model> and sc-<model>-part2), not by the model's text: a start that
  // downloaded first lists the model under its repo name, and healing never saw its parts (audit, 2026-11-11).
  const parts = sps.flatMap(sp => sp.deployments.filter(d => (x.sparks
    ? d.cluster === x.sparks.join('+') && (d.container === x.container || d.container === `${x.container}-part2`) : d.container === x.container))
    .map(d => ({ ...d, spark: sp.id })));
  const down = parts.length < sparks.length || parts.some(d => d.state !== 'running');
  if (!down) { skippedOnce.delete(keyOf(x)); return null; }
  // What the watcher last saw of the parts that aren't running.
  const gone = parts.filter(d => d.state !== 'running').map(d => knowledge.workloads[`${d.spark}/${d.container}`]).filter(Boolean);
  // Stopped on purpose a moment ago, or out of memory: never brought back by itself, whatever else happened since.
  if (gone.some(w => consoleStopped.has(`${w.spark}/${w.name}`) && Date.now() - consoleStopped.get(`${w.spark}/${w.name}`) < 15 * 60000)) return null;
  if (gone.some(w => w.oomKilled)) return { skip: 'a part ran out of memory, so starting it again would only fail again' };
  const backs = sparks.map(cameBack).filter(Boolean), back = Math.max(0, ...backs.map(b => b.on));
  const last = Math.max(0, ...healCount(`back:${keyOf(x)}`)), lastPower = Math.max(0, ...healCount(`power:${keyOf(x)}`));
  // How each part that isn't running ended: what its Spark shows now ("Exited (255) 2 minutes ago"), else the watcher's
  // last look. Right after a power-on the watcher may not have looked there yet, and its last look, from before the
  // power went, still says running: deciding from that started the model at once as "a part stopped", before the Sparks
  // had settled and without the "it may be what froze it" guard (gate, 2026-11-13).
  const stoppedParts = parts.filter(d => d.state !== 'running');
  const exitOf = d => { const m = /^Exited \((\d+)\)/.exec(d.status || ''); return m ? Number(m[1]) : Number(knowledge.workloads[`${d.spark}/${d.container}`]?.exitCode); };
  // Powered back on: only when it went down WITH a power-off (its parts exited 255, which is what Docker shows after a
  // power loss or reboot), the power-on is within the last 6 hours and hasn't been acted on. An old power-on, or a short
  // network drop, never restarts a model that stopped for another reason (audit, 2026-11-11: once the 6-hour marks
  // expired, any stopped model on the list came back as "its Spark came back on"). (Only a bring-back after a power-on
  // counts for "it may be what froze it": the owner often power-cycles right after a crash was fixed.)
  const powerDown = stoppedParts.length > 0 && stoppedParts.every(d => exitOf(d) === 255);
  if (back > last && Date.now() - back < HEAL_WINDOW && powerDown) {
    if (Date.now() - back < HEAL_SETTLE_MS) return null;
    if (lastPower && backs.some(b => b.off > lastPower && b.off - lastPower < 30 * 60000)) {
      return { skip: `its Spark went down within 30 minutes of the last time it was brought back, so it may be what froze it; bring it back by hand` };
    }
    return { why: `${sparks.map(id => sparkName(nodeById(id) || { id })).join(' and ')} came back on`, parts, power: true };
  }
  // A part of a two-Spark model that stopped while its Sparks stayed on (one-Spark crashes are maybeHeal's).
  if (!x.sparks) return null;
  if (stoppedParts.some(d => exitOf(d) === 255)) return null;   // a Spark lost power: the power-on above brings it back
  const ranFor = Math.min(...gone.map(w => (Date.parse(w.finishedAt) || Date.now()) - (Date.parse(w.startedAt) || 0)));
  if (gone.length && ranFor < HEAL_MIN_RUN) return { skip: `a part stopped within ${Math.round(HEAL_MIN_RUN / 60000)} minutes of starting, so starting again would likely fail again` };
  return { why: `a part stopped (${parts.filter(d => d.state !== 'running').map(d => `${d.container} on ${d.spark}: ${d.status}`).join('; ') || 'its part is gone'})`, parts };
}

async function bringBack(x, why, parts, power = false) {
  const key = keyOf(x);
  // Bringing back what the owner had running is the owner's own request: a workflow not yet validated on these Sparks
  // (after an install, while the Sparks it would be tested on are busy) runs as its validation run.
  const id = x.sparks ? 'start_model_across' : 'restart_model', st = workflowStatus(id);
  if (st.state === 'untested') return healSkip(x, 'the workflow that brings it back hasn’t passed Spark Console’s tests');
  const validating = st.state === 'needs-validation' ? { __validate: id } : {};
  if (healCount(`back:${key}`).length >= 2) return healSkip(x, 'it was brought back twice in the last 6 hours already');
  healMark(`back:${key}`);
  if (power) healMark(`power:${key}`);
  skippedOnce.delete(key);
  fleetEvent({ type: 'healing', spark: x.spark, container: x.container, why });
  // Bringing something back never stops anything else: what the owner started there since stays, and the entry is held
  // with the reason (audit, 2026-11-11: a bring-back of GLM could stop the model the owner had just started).
  const ctx = { actor: 'Self-healing', via: 'watcher', request: `bring back ${x.container}: ${why}`, canChange: true, trusted: true, noStops: true };
  const stopped = [];
  // (a saved workflow's run that started it keeps it as its own once it is back, in its new containers too: A-22)
  const held = await receiptsHeld([key, ...parts.map(d => `${d.spark}/${d.container}`)]).catch(() => []);
  try {
    // A two-Spark model starts as a pair: what's left of it (stuck waiting for the part that's gone) stops first, and
    // starts again as it was if the start is refused.
    for (const d of parts.filter(p => p.state === 'running')) {
      consoleStopped.set(`${d.spark}/${d.container}`, Date.now());
      await run(nodeById(d.spark), `docker stop --time 30 ${q(d.container)} >/dev/null 2>&1; true`, { timeout: 120000 });
      stopped.push(d);
    }
    const out = x.sparks ? await runAction('start_model', healOwner(), { model: x.model, sparks: x.sparks, ...validating }, ctx)
      : await runAction('restart_model', healOwner(), { spark: x.spark, container: x.container, ...validating }, ctx);
    if (!out?.operation) throw new Error(out?.note || out?.question || out?.outcome || 'it didn’t start');
    if (held.length) waitJob(out.operation, 45 * 60000).then(done => (done?.status === 'completed' ? receiptsBroughtBack(held, done) : null)).catch(() => {});
    audit({ via: 'watcher', actor: 'Self-healing', action: x.sparks ? 'start_model' : 'restart_model', args: x.sparks ? { model: x.model, sparks: x.sparks } : { spark: x.spark, container: x.container }, ok: true, outcome: 'started', operation: out.operation, request: ctx.request });
  } catch (e) {
    for (const d of stopped) {
      consoleStopped.delete(`${d.spark}/${d.container}`);
      await run(nodeById(d.spark), `docker start ${q(d.container)} >/dev/null 2>&1; true`, { timeout: 90000 }).catch(() => {});
    }
    skippedOnce.set(key, 'failed');
    fleetEvent({ type: 'heal-skipped', spark: x.spark, container: x.container, why: `bringing it back failed: ${maskSecrets(String(e.message).split('\n')[0].slice(0, 500)).slice(0, 300)}` });
    audit({ via: 'watcher', actor: 'Self-healing', action: x.sparks ? 'start_model' : 'restart_model', args: { spark: x.spark, container: x.container }, ok: false, error: maskSecrets(String(e.message).slice(0, 500)).slice(0, 300) });
  }
}

// Restarting Sparkie's model in place, its container as it is: self-healing's restart and the owner's own
// "/restart sparkie" (20-words.mjs) are this one function, one at a time (brainRestarting). It never runs docker run or
// docker rm, and docker restart also starts a stopped container: healing never calls it for one (watchBrain acts only on
// a running brain); the owner's word does, on purpose.
let brainRestarting = false;
// A rendezvous file the engine keeps in the container (SGLANG_DISTRIBUTED_INIT_METHOD_OVERRIDE=file://…) would be
// found again after a restart and can hang the start: it goes first.
function brainRestartCommand() {
  const rdv = /^file:\/\/(\/[\w./-]+)$/.exec(String(MAIN.env?.SGLANG_DISTRIBUTED_INIT_METHOD_OVERRIDE || ''))?.[1];
  return `${rdv ? `docker exec ${q(MAIN.container)} rm -f ${q(rdv)} >/dev/null 2>&1; ` : ''}docker restart --time 30 ${q(MAIN.container)}`;
}
// null when a restart is already going or something else is changing on the brain's Spark. It holds that Spark's claim
// while it runs, so a brain stop, start or switch, or a deploy there, can't race it.
async function restartBrain() {
  if (brainRestarting || busySparks.has(MAIN.node)) return null;
  brainRestarting = true;
  const release = claimSparks([MAIN.node], 'restarting Sparkie’s model');
  try { return await run(nodeById(MAIN.node), brainRestartCommand(), { timeout: 180000 }); } finally { release(); brainRestarting = false; }
}

// The brain keeper (not the contract's Keeper, 8.13). Sparkie's model is stopped or gone (Docker has said so for
// HEAL_SETTLE_MS) and nothing is changing on its Spark. With the left-down mark (13-main-model.mjs), the same setup
// (MAIN, never another) starts again through the brain-start job, at most twice in 6 hours; then the mark goes and one
// notice says so. Without it (stopped or removed by hand, or the owner's Stop) nothing starts.
const BRAIN_DOWN = ['exited', 'created', 'dead', 'missing'];
let brainSilentSince = 0, brainDownSince = 0;
function keepBrain(status) {
  if (!brainLeftDown()) return;
  const x = { spark: MAIN.node, container: MAIN.container }, key = `keep:${keyOf(x)}`;
  if (!status?.ready?.image) return healSkip(x, 'Sparkie’s pinned image is not available on this Spark. Use Start to download it; no recovery attempt was used.');
  if (healCount(key).length >= 2) {
    markBrainLeftDown(false);
    fleetEvent({ type: 'notice', text: `Spark Console tried twice in the last 6 hours to start Sparkie’s model again on ${sparkName(mainNode() || { id: MAIN.node })}, and it still isn’t running. It won’t try again by itself. To try again, type /restart sparkie in your chat.` });
    return;
  }
  let job;
  // (Spark Console is stopping, or the Spark was claimed this instant: the next pass looks again, and no try is used)
  try { job = claimed([MAIN.node], 'starting Sparkie’s model', () => newJob('main-start', { node: MAIN.node, model: MAIN.title || MAIN.served, actor: 'Self-healing', via: 'watcher', noStops: true })); } catch { return; }
  healMark(key);
  fleetEvent({ type: 'healing', spark: x.spark, container: x.container, why: 'Spark Console left Sparkie’s model down (a start or switch that didn’t finish), so it is starting the same setup again' });
  audit({ via: 'watcher', actor: 'Self-healing', action: 'start_sparkie', args: x, ok: true, outcome: 'started', operation: job.id });
  runJob(job, j => startMain(j, []));
}
async function watchBrain() {
  if (!MAIN || brainRestarting || busySparks.has(MAIN.node)) return;
  const m = await mainStatus().catch(() => null);
  // Stopped or gone: the keeper's (above), once Docker has said so for a while and nothing is changing there.
  const idle = Boolean(m?.online) && !m.busy && !brainRestarting && !busySparks.has(MAIN.node);
  if (idle && BRAIN_DOWN.includes(m.state)) {
    brainSilentSince = 0;
    brainDownSince ||= Date.now();
    if (Date.now() - brainDownSince >= HEAL_SETTLE_MS) { brainDownSince = 0; keepBrain(m); }
    return;
  }
  brainDownSince = 0;
  // (answering again, however it came back: the mark goes, so a later stop by hand is never undone)
  if (idle && m.state === 'running' && m.healthy && brainLeftDown()) markBrainLeftDown(false);
  // (Not chat timeouts: a reply waiting in the engine's queue sends nothing for minutes, so they'd restart a busy brain.)
  if (brainRestarting || busySparks.has(MAIN.node) || !m?.configured || m.busy || m.state !== 'running' || m.healthy || Date.now() - (Date.parse(m.startedAt) || Date.now()) < BRAIN_LOADING_MS) { brainSilentSince = 0; return; }
  brainSilentSince ||= Date.now();
  if (Date.now() - brainSilentSince < BRAIN_HUNG_MS) return;
  const x = { spark: MAIN.node, container: MAIN.container }, key = `brain:${keyOf(x)}`;
  if (healCount(key).length >= 2) return healSkip(x, 'Sparkie’s model was restarted twice in the last 6 hours and still isn’t answering; look at its log');
  healMark(key);
  brainSilentSince = 0;
  fleetEvent({ type: 'healing', spark: x.spark, container: x.container, why: `Sparkie’s model was running but hadn’t answered for ${BRAIN_HUNG_MS >= 60000 ? `${Math.round(BRAIN_HUNG_MS / 60000)} minutes` : `${Math.round(BRAIN_HUNG_MS / 1000)} seconds`}` });
  const r = await restartBrain();
  if (!r) return;
  audit({ via: 'watcher', actor: 'Self-healing', action: 'restart_sparkie', args: x, ok: r.code === 0, ...(r.code ? { error: (r.err || r.out).slice(0, 300) } : {}) });
}

// The newer model on the list that shares a Spark with this entry, and that Spark; null when there is none.
function displacedBy(x, list) {
  const mine = x.sparks || [x.spark], since = Date.parse(x.since) || 0;
  for (const y of list) {
    if (y === x || y.app || !((Date.parse(y.since) || 0) > since)) continue;
    const spark = (y.sparks || [y.spark]).find(id => mine.includes(id));
    if (spark) return { y, spark };
  }
  return null;
}

let healPassing = false;
async function healPass() {
  if (healPassing) return;
  healPassing = true;
  try {
    // (the owner's pause stops it; the automatic one, for an agent that looped, doesn't)
    const s = agentSettings();
    if (!s.selfHeal || (s.halted && !s.autoPaused)) return;
    await watchBrain().catch(e => console.error(`Watching Sparkie’s model: ${e.message}`));
    const list = desired().running;
    if (!list.length) return;
    const inv = await recentInventory().catch(() => null);
    if (!inv) return;
    const busy = new Set([...jobs.values()].filter(j => j.status === 'running').flatMap(j => j.nodes || [j.node]).filter(Boolean));
    for (const x of list) {
      if ((x.sparks || [x.spark]).some(id => busy.has(id) || busySparks.has(id))) continue;
      // Parked by the power rules, or on a Spark Spark Console powered off (21-power.mjs): nothing heals against an
      // intentional power-off; it comes back when its Spark is turned on, or on its next call.
      if (x.parked || x.putBack || (x.sparks || [x.spark]).some(consoleOff)) continue;
      // An app kept running (21-apps.mjs) has its own rules.
      if (x.app) { await healApp(x, inv).catch(e => console.error(`Self-healing ${x.container}: ${e.message}`)); continue; }
      const r = healReason(x, inv);
      if (!r) continue;
      if (r.skip) { healSkip(x, r.skip); continue; }
      // One model per Spark: an entry with a newer model on the list for one of its Sparks was displaced by what the
      // owner started there since. It stays down while that newer one is on the list, running or not: when the newer
      // one crashes, it is the one restarted (maybeHeal), never the older one in its place (gate, 2026-11-13: the two
      // raced for the Spark, and when the older pair won, the owner's newer model stayed down). Once the newer one is
      // off the list (stopped or forgotten), the older one is brought back as before.
      const newer = displacedBy(x, list);
      if (newer) { healSkip(x, `${newer.y.model || newer.y.container} was started on ${sparkName(nodeById(newer.spark) || { id: newer.spark })} after it, so it stays down while that one is wanted there: self-healing never stops anything else to bring something back`); continue; }
      await bringBack(x, r.why, r.parts, r.power);
    }
  } catch (e) { console.error(`Self-healing: ${e.message}`); } finally { healPassing = false; }
}
setInterval(healPass, HEAL_PASS_MS).unref?.();

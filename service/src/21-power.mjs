/* ───────── power-aware Sparks (contract 9.22, R41) ───────── */
// Area: features        Rules: R19, R22, R23, R32, R41        Tests: power.test.mjs, heal-status.test.mjs
// Owns: power.json (writers: savePower)
// Timers: powerTick (every 60 s, first 5 minutes after start)
// Wakes: a compute Spark it powered off, or one shut down with a switchable plug, never the hub: power_on, a start or
//   call that needs it (powerThen), power.wake
// The owner, 2026-11-13: "shut down sparks when not in use (not spark 2), when idle, or when I tell chat, an agent or
// the API"; idle models are parked. A Spark with a plug Spark Console may switch (switchablePlug, 12-plugs.mjs) is
// powered off cleanly and on again:
// - power_off: refused for the hub (brainSparks) always, for a Spark without a switchable plug, and while anything runs
//   there that Spark Console didn't start or keeps protected (hand-started benchmarks, spark.protect=true, a job that
//   hasn't ended): those are never stopped by this. Spark Console's own models and kept apps there are stopped first and
//   parked (they stay on the list of what should be running, marked parked, so healing leaves them alone and nothing calls
//   them missing); a model across two Sparks stops on both. Then a clean shutdown over SSH (sudo -n, the two commands
//   deploy/power-setup.sh allows), then a wait until the Spark stops answering AND its plug reads under 15 W; only then
//   is the plug switched off. If the watts never drop, the power is never cut (the plug may not be on that Spark).
// - power_on: plug off and on again for a Spark that is shut down with its plug on, plug on for one whose plug is off;
//   never anything for one that draws power but doesn't answer. Then what was parked there comes back (restart_model,
//   start_model across two, keep_running), as self-healing brings things back.
// - the idle loop: every minute, a Spark idle for the owner's time (power_settings, 30 minutes by default) is powered off
//   through power_off; both Sparks of a model across two together.
// - a start that needs a Spark Spark Console powered off turns it on first, inside its operation (powerThenStart).
// power.json (state folder, no secret) keeps the setting and which Sparks Spark Console powered off, when, why and what
// it parked. Spark Console only reads every other plug, and never switches the hub's (R41).
const POWER_FILE = `${STATE_DIR}/power.json`;
const IDLE_DEFAULT_MINUTES = 30;
const POWER_TICK_MS = Number(process.env.SPARK_CONSOLE_POWER_MS || 60000);
const POWER_FIRST_MS = Number(process.env.SPARK_CONSOLE_POWER_FIRST_MS || 300000);
// The length of one of the owner's idle minutes (tests make it shorter).
const IDLE_MINUTE_MS = Number(process.env.SPARK_CONSOLE_IDLE_MINUTE_MS || 60000);
const POWER_POLL_MS = Number(process.env.SPARK_CONSOLE_POWER_POLL_MS || 5000);
const POWER_OFF_WAIT_MS = Number(process.env.SPARK_CONSOLE_POWER_OFF_WAIT_MS || 240000);
const POWER_ON_WAIT_MS = Number(process.env.SPARK_CONSOLE_POWER_ON_WAIT_MS || 300000);
const POWER_CYCLE_MS = Number(process.env.SPARK_CONSOLE_POWER_CYCLE_MS || 10000);
// The hold before a plug is switched off under a Spark that doesn't answer and was never read at 15 W or more in the same
// operation (power_on's off-and-on, power_off of a Spark that doesn't answer): silent, its plug answering and under
// 15 W at every poll for this long (holdLow).
const POWER_HOLD_MS = Number(process.env.SPARK_CONSOLE_POWER_HOLD_MS || 60000);
// A shut-down Spark with its plug on draws a few watts; an idle one 55–65 W.
const SHUT_DOWN_WATTS = 15;
const IDLE_GPU_PERCENT = 5, IDLE_LOAD = 2;
const POWER_WHY = { idle: 'idle', asked: 'asked', start: 'a start needed it', outside: 'turned on outside Spark Console' };

// power.json: { idleMinutes, changedAt, changedBy, off: { spark4: { at, why: 'idle'|'asked', by, parked: ['spark4/sc-…'],
// plugCut, problem, models, memTotal, diskFree } } } (the last three from its look just before it went off, D5). A lookup takes a file that can't be read as the defaults; whatever saves reads it strictly
// (R20), so a read error writes nothing.
function powerState(strict = false) {
  let v = null;
  try { v = readKept(POWER_FILE); } catch (e) { if (strict) throw e; }
  // (a record that isn't one, as in a power.json edited by hand, is passed over by every reader, and left out at the next
  // save: R56)
  const off = v && typeof v.off === 'object' && v.off && !Array.isArray(v.off) ? Object.fromEntries(Object.entries(v.off).filter(([, r]) => r && typeof r === 'object' && !Array.isArray(r))) : {};
  return { ...(v && typeof v === 'object' && !Array.isArray(v) ? v : {}), idleMinutes: Number.isInteger(v?.idleMinutes) ? v.idleMinutes : IDLE_DEFAULT_MINUTES, off };
}
function savePower(change) {
  const s = powerState(true);
  change(s);
  writePrivate(POWER_FILE, s);
  return s;
}
const offRecord = (id, rec) => savePower(s => { if (rec) s.off[id] = { ...(s.off[id] || {}), ...rec }; else delete s.off[id]; });
// A Spark Spark Console powered off (or is powering off): off on purpose.
const consoleOff = id => Boolean(powerState().off[id]);
const poweredOffNow = x => (x.sparks || [x.spark]).some(consoleOff);
const sparkWord = id => sparkName(nodeById(id) || { id });
const sparksWords = ids => ids.map(sparkWord).join(' and ');
const minutesWords = ms => (ms >= 60000 ? `${Math.round(ms / 60000)} minute${Math.round(ms / 60000) === 1 ? '' : 's'}` : `${Math.round(ms / 1000)} seconds`);
const atWords = iso => `${String(iso || '').slice(0, 16).replace('T', ' ')} UTC`;
// Why an entry is parked, in words.
function parkedWhy(x) {
  const off = (x.sparks || [x.spark]).filter(consoleOff);
  return off.length ? `${sparksWords(off)} ${off.length > 1 ? 'were' : 'was'} powered off by Spark Console; it comes back when ${off.length > 1 ? 'they are' : 'it is'} turned on, or when it is called`
    : 'Spark Console stopped it to power its Spark off; it comes back when it is called or started, or when its Spark is turned on again';
}
// A parked model by the name a start or a call uses (its library name, repo, container or recipe id).
// (the whole name, its organisation too: unsloth/X is never RadixArk/X)
function parkedFor(name) {
  const want = String(name || '').toLowerCase(), sq = squash(want);
  const recipe = recipeCatalog().models.find(r => r.id === name);
  const names = x => [x.model, String(x.container).replace(/^sc-/, '')].filter(Boolean).map(String);
  return desired().running.find(x => x.parked && !x.app && (names(x).some(n => n.toLowerCase() === want || squash(n) === sq)
    || Boolean(recipe?.variants.some(v => names(x).some(n => sameRepo(v.repo, n) || squash(n) === squash(String(v.repo).replace('/', '--')))))));
}
// Whether a Spark Spark Console powered off holds a model on its disk, by its record: the model names on its disk when it
// went down (models; an older record has none, so it may hold anything). `names`: the names a start uses for the model
// (its own, its repo, a recipe's versions).
function offHolds(rec, names) {
  if (!Array.isArray(rec?.models)) return null;
  return names.some(n => rec.models.some(d => onDiskAs({ name: d, repo: d.includes('--') ? d.replace('--', '/') : null }, n)));
}
// The Sparks it powered off that would be turned on to look for this model: those whose record lists it; when none does,
// those with no list (unknown), and, unless only listed ones count (a call never downloads), the rest too.
// The names a start or a call looks for on a sleeping Spark's disk: what was asked, and the recipe's other versions only
// when the name picks none (a call for unsloth/X never wakes the Spark that holds RadixArk/X).
const wakeNames = (name, found) => [String(name), found?.repo, ...(String(name).includes('/') ? [] : (found?.recipe?.variants || []).map(v => v.repo))].filter(Boolean);
function offFor(off, names, listedOnly) {
  const st = powerState(), listed = off.filter(id => offHolds(st.off[id], names) === true);
  if (listed.length) return listed;
  return listedOnly ? off.filter(id => offHolds(st.off[id], names) === null) : off;
}
// Which one of the Sparks it powered off a start that names none wakes (D5, design D 2.6), chosen from their records
// alone; once it is on, the start is placed again from the live look. In list order: one whose record lists the model
// (with its linked partner when its memory alone can't hold it and that one is off too). Without room, or for a call (a
// call never copies or downloads): else one with no list, which may hold anything. With room (a start that fits on no
// Spark that is on): else the first whose record's free disk holds the model with the usual floor (its size and a
// tenth, and 20 GB) and whose memory less 8 GB holds what it needs; else, for a model that may run across two
// (`pairs`, or a recipe's version for two), the first that holds half of it, with its partner (R56); a record with no
// numbers (an older build) last. A Spark that is off with no record is never woken here. [] when none fits; then why
// goes into `why`, for the answer.
function wakeOne(off, names, { room = false, call = false, sizeBytes = null, needBytes = null, versions = null, pairs = false, why = null } = {}) {
  const st = powerState(), order = NODES.map(n => n.id);
  const recs = off.filter(id => st.off[id]).sort((a, b) => order.indexOf(a) - order.indexOf(b)), rec = id => st.off[id];
  // (its partner too when that one is asleep, on a cable between two compute Sparks: wakePartner, R56)
  const withPartner = id => (recs.includes(wakePartner(id)) ? [id, wakePartner(id)] : [id]);
  const listed = recs.filter(id => offHolds(rec(id), names) === true);
  if (listed.length) {
    const id = listed[0], need = needBytes ?? sizeBytes, mem = rec(id).memTotal;
    return pairs && Number.isFinite(need) && Number.isFinite(mem) && mem - HEADROOM < need ? withPartner(id) : [id];
  }
  const unknown = recs.filter(id => offHolds(rec(id), names) === null);
  if ((!room || call) && unknown.length) return [unknown[0]];
  const numbers = recs.filter(id => Number.isFinite(rec(id).diskFree) && Number.isFinite(rec(id).memTotal));
  // (parts 2: half of a model across two Sparks, all its files there: a recipe's version for two, or a model on disk
  // that may pair, by its own need)
  const holdsIt = (r, parts = 1) => (versions?.length ? versions.filter(v => (v.sparks ?? 1) === parts && v.sizeGB != null && v.needGB != null)
    .some(v => r.diskFree >= v.sizeGB * 1.1e9 + 20e9 && r.memTotal - HEADROOM >= v.needGB * 1e9 / parts)
    : parts === 1 ? !Number.isFinite(sizeBytes) || (r.diskFree >= sizeBytes * 1.1 + 20e9 && r.memTotal - HEADROOM >= (needBytes ?? sizeBytes))
      : pairs && Number.isFinite(sizeBytes) && r.diskFree >= sizeBytes * 1.1 + 20e9 && r.memTotal - HEADROOM >= (needBytes ?? sizeBytes) / 2);
  if (room && !call) {
    const fits = numbers.find(id => holdsIt(rec(id)));
    if (fits) return [fits];
    // (none holds it alone: the first that holds half, with its partner when that one is asleep too)
    const half = numbers.find(id => wakePartner(id) && holdsIt(rec(id), 2));
    if (half) return withPartner(half);
    const older = recs.filter(id => !numbers.includes(id));
    if (older.length) return [older[0]];
  }
  if (why && recs.length) {
    const said = recs.map(id => (call || !room || !numbers.includes(id) ? `${sparkWord(id)}’s record doesn’t list it`
      : `${sparkWord(id)} had ${gbOf(rec(id).diskFree)} GB of disk free and ${gbOf(rec(id).memTotal)} GB of memory when it went off (${atWords(rec(id).at)})`));
    why.push(`${sparksWords(recs)} ${recs.length > 1 ? 'were' : 'was'} powered off by Spark Console and ${recs.length > 1 ? 'weren’t' : 'wasn’t'} turned on for it: ${said.join('; ')}.`);
  }
  return [];
}
// What a read says of the Sparks Spark Console powered off (D5: a read never wakes one), from their records: since when,
// and what was on each one's disk then. With names, only those whose record lists the model, or has no list.
function asleepView(names = null) {
  return Object.entries(powerState().off).filter(([id, r]) => nodeById(id) && (!names || offHolds(r, names) !== false)).map(([id, r]) => ({
    spark: id, since: r.at || null, ...(Array.isArray(r.models) ? { modelsThen: r.models } : {}), diskFreeGBThen: gbOf(r.diskFree), memoryTotalGBThen: gbOf(r.memTotal),
    words: `${sparkWord(id)} is asleep since ${atWords(r.at)}${Array.isArray(r.models) ? `; ${r.models.length} model${r.models.length === 1 ? '' : 's'} on its disk then` : ''}. A look doesn’t wake it.` }));
}

// What a Spark Spark Console powered off shows: when, why, what it parked, and how to turn it on. Built by code from its
// own record (names only, nameShown), so fleet_status stays an inside read (R26).
// Who powered it off (F2, C5): a saved workflow's step runs as "<its title> (saved workflow)", and a title is free text an
// agent may write, so it is said by kind only; recent_operations has the run with its title. Anyone else as recorded:
// the owner, Spark Console's idle power-off, Sparkie, or an agent by the name the owner gave its key.
const offBy = by => (typeof by !== 'string' || !by ? null : / \(saved workflow\)$/.test(by) ? 'a saved workflow' : by);
function powerMark(id) {
  const r = powerState().off[id];
  if (!r) return null;
  const parked = (r.parked || []).map(k => String(k).split('/').pop());
  const name = sparkWord(id), why = POWER_WHY[r.why] || r.why || 'asked', named = parked.map(p => nameShown(p, 'fleet_events') || 'a name not shown here');
  const words = r.problem ? `Shut down by Spark Console (${why}) at ${atWords(r.at)}. ${r.problem}`
    : `Powered off by Spark Console (${why}) at ${atWords(r.at)}.${parked.length ? ` Parked: ${named.join(', ')}.` : ''} Say “turn on ${name}” to turn it on${parked.length ? '; a call to a parked model turns it on too' : ''}.`;
  // (asleep: on purpose and not a fault, in the words a look gives, D4; fleet_status and /status carry it)
  return { at: r.at || null, why, by: offBy(r.by), parkedModels: parked, plugCut: r.plugCut === true, ...(r.problem ? { problem: r.problem } : {}),
    // (not asleep when its record carries a problem, a wake that failed: the problem is said instead, in words)
    howToTurnOn: `power_on {"spark":"${id}"}`, words, asleep: r.problem ? null : asleepView().find(a => a.spark === id)?.words || null };
}

// The setting and what may be switched, for fleet_status (code-built words).
// The workflows a parked model comes back through: the idle power-off waits until all of them are active (powerTick).
const WAKE_WORKFLOWS = ['start_model', 'start_model_across', 'restart_model'];
const wakeWaiting = () => WAKE_WORKFLOWS.filter(id => workflowStatus(id).state !== 'active');
function powerView() {
  const st = powerState(), can = NODES.map(n => n.id).filter(id => switchablePlug(id) && !brainSparks().includes(id)), waiting = st.idleMinutes ? wakeWaiting() : [];
  return { idleMinutes: st.idleMinutes, switchable: can, offOnPurpose: Object.keys(st.off).filter(id => nodeById(id)), ...(waiting.length ? { waitingFor: waiting } : {}),
    // (each Spark: on, off, waking or unknown (no plug), and, for one that may be switched and is on, what keeps it on)
    bySpark: Object.fromEntries(NODES.map(n => [n.id, { state: power.state(n.id),
      ...(can.includes(n.id) && power.state(n.id) === 'on' ? { neededFor: sparkNeeded(n.id) } : {}) }])),
    words: !can.length ? 'No Spark has a smart plug Spark Console may switch yet, so none is powered off from here.'
      : st.idleMinutes && waiting.length ? `The idle power-off is waiting: ${waiting.join(' and ')} need${waiting.length > 1 ? '' : 's'} a test run on your Sparks first (a parked model comes back through ${waiting.length > 1 ? 'them' : 'it'}), so no Spark is powered off for being idle until then. Asked, ${sparksWords(can)} can still be powered off.`
      : st.idleMinutes ? `${sparksWords(can)} ${can.length > 1 ? 'are' : 'is'} powered off after ${st.idleMinutes} idle minute${st.idleMinutes === 1 ? '' : 's'}, and turned on again when asked or needed. ${hubName()} never.`
        : `Spark Console doesn’t power off idle Sparks by itself now; ${sparksWords(can)} can still be powered off when asked.` };
}

// Whether a Spark answers over SSH right now: one short command through spawnOn, never the minute-long "unreachable"
// memory, so a Spark that is still up is never taken for one that's off.
function answersNow(node, timeout = 15000) {
  return new Promise(resolve => {
    let out = '', done = false;
    const child = spawnOn(node, { command: 'echo up' });
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, timeout);
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', () => {});
    child.on('error', () => {});
    child.on('close', code => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      const ok = code === 0 && /\bup\b/.test(out);
      noteReach(node, ok ? 0 : 255);
      resolve(ok);
    });
  });
}
// One look at what runs on a Spark now (read only): what would stop Spark Console from powering it off. Never stopped
// by this: anything not started by Spark Console, anything protected, a job (keep_running once) that hasn't ended, an app
// that isn't kept. Spark Console's own models and kept apps are what gets parked.
const POWER_LOOK = `docker ps --format 'power\\t{{.Names}}\\t{{.Label "spark.protect"}}\\t{{.Label "spark.console"}}\\t{{.Label "spark.app"}}\\t{{.Label "spark.job"}}\\t{{.Label "spark.role"}}' 2>/dev/null && printf 'docker\\tok\\n'
${POWER_BOX_LOOK}`;
async function powerLook(node) {
  let r = await run(node, POWER_LOOK, { timeout: 30000 });
  // (a Spark remembered as unreachable a moment ago is asked once more, so one that just came back counts as on)
  if (r.code === 255 && await answersNow(node)) r = await run(node, POWER_LOOK, { timeout: 30000 });
  if (r.code === 255) return { answers: false, inUse: [], apps: [], boxes: [] };
  if (!fields(r.out, 'docker').length) throw new HttpError(409, `Docker on ${sparkName(node)} didn’t answer just now, so nothing was changed. Try again in a minute.`);
  const kept = new Set(desired().running.filter(x => x.app).map(keyOf)), inUse = [], apps = [], boxed = powerBoxesIn(node, r.out), found = [];
  for (const [name, protect, ours, app, job, role] of fields(r.out, 'power')) {
    if (!name) continue;
    if (role === 'main' || isProtected(name, protect)) inUse.push(`${nameShown(name, 'workloads') || 'a container'} (protected)`);
    else if (ours === '1') continue;
    // (Spark Console's own box: said and ended by an asked power-off, 21-power-box.mjs; one it doesn't have open is said)
    else if (boxed.known.has(name)) found.push(boxed.known.get(name));
    else if (boxed.opening.has(name) || boxed.other.has(name)) inUse.push(`${nameShown(name, 'workloads') || 'a container'} (${boxed.opening.has(name) ? POWER_BOX_OPENING : POWER_BOX_OTHER})`);
    else if (app === '1' && job === '1') inUse.push(`${nameShown(name, 'workloads') || 'a container'} (a job that hasn’t ended)`);
    else if (app === '1' && kept.has(`${node.id}/${name}`)) apps.push(name);
    else inUse.push(`${nameShown(name, 'workloads') || 'a container'} (started outside Spark Console)`);
  }
  await powerBoxFiles(node, found);
  return { answers: true, inUse, apps, boxes: found };
}
// (each container by its name as shown, nameShown: a long one is said, and workloads has it)
const inUseWords = (node, list) => `${sparkName(node)} is in use: ${list.join(', ')} ${list.length > 1 ? 'run' : 'runs'} there. Spark Console never stops those, so nothing was changed. Stop ${list.length > 1 ? 'them' : 'it'} first, or turn ${sparkName(node)} off by hand.`;
// The shutdown needs exactly the two commands deploy/power-setup.sh lets the owner's account run without a password.
const SUDO_CHECK = `sudo -n -l /usr/bin/systemctl poweroff >/dev/null 2>&1 && sudo -n -l /usr/bin/systemctl stop nvidia-persistenced >/dev/null 2>&1 && printf 'sudo\\tok\\n'`;
const setupWords = node => `Spark Console can’t shut ${sparkName(node)} down: sudo asks for a password there. Run deploy/power-setup.sh once for this Spark (bash spark-console/deploy/power-setup.sh ${node.host}). Nothing was changed.`;
async function sudoReady(node) {
  const r = await run(node, SUDO_CHECK, { timeout: 30000 });
  if (r.code === 255) throw new HttpError(409, `${sparkName(node)} stopped answering, so nothing was changed. Try again.`);
  return fields(r.out, 'sudo').length > 0;
}
// NVIDIA's workaround first (a headless shutdown can hang in nvidia-persistenced), then the shutdown itself. The
// connection may drop as it goes down: that counts as accepted.
const SHUTDOWN = `sudo -n /usr/bin/systemctl stop nvidia-persistenced >/dev/null 2>&1
sudo -n /usr/bin/systemctl poweroff 2>&1; printf 'poweroff\\t%s\\n' "$?"`;
// The one place the shutdown is sent (R41). Its first line refuses the hub, whatever called it: the brain's Spark and
// Spark Console's own ('local': spawnOn runs that Spark's script on the hub itself) are never shut down from here.
function shutDownSpark(node) {
  if (!node || brainSparks().includes(node.id) || node.host === 'local') throw new Error(`${sparkName(node || { id: 'that Spark' })} runs Spark Console and Sparkie, so it is never shut down from here.`);
  return run(node, SHUTDOWN, { timeout: 60000 });
}
// The hold (R41): the controller answers with the values it has cached from the plug's reports, and nothing says how old
// they are. Before a plug is switched off under a Spark that doesn't answer, with no reading of 15 W or more from it in
// the same operation, the Spark stays silent and its plug answering and under 15 W at every poll for POWER_HOLD_MS.
// null: held. 'answers': the Spark answered. 'off': its plug reads off. Otherwise, in words, what broke the hold.
async function holdLow(j, id) {
  const node = nodeById(id), name = sparkName(node);
  step(j, `${name} isn’t answering and its plug reads under ${SHUT_DOWN_WATTS} W: watching it for ${minutesWords(POWER_HOLD_MS)} before its plug is switched`);
  for (const until = Date.now() + POWER_HOLD_MS; ;) {
    if (await answersNow(node)) return 'answers';
    const w = await freshWall(id).catch(e => ({ answering: false, problem: e.message }));
    if (!w.answering) return `${name}’s plug stopped answering the plug controller (${w.problem || 'no reading'})`;
    if (w.on === false) return 'off';
    if (w.on !== true || !(typeof w.watts === 'number' && w.watts < SHUT_DOWN_WATTS)) return `${name}’s plug now shows ${w.watts ?? '?'} W`;
    if (Date.now() >= until) return null;
    cancelCheck(j);
    await sleep(POWER_POLL_MS);
  }
}

// Before a Spark that answers is shut down, its plug must be proven: answering the controller, on, and drawing what a
// running Spark draws (15 W or more). Otherwise it could be shut down with no way to turn it on again from here (the
// controller down, the plug off the network, or plugs.json naming another plug). Words for why not; null when it's fine.
async function plugUnproven(id) {
  const name = sparkWord(id), w = await freshWall(id).catch(() => null);
  if (!w?.answering) return `${name}’s plug isn’t answering the plug controller, so ${name} wasn’t shut down: Spark Console couldn’t turn it on again. Nothing was changed.`;
  if (w.on !== true) return `${name}’s plug reads as off while ${name} answers, so that plug may not be ${name}’s. Nothing was changed. Check which plug is which with deploy/plugs.sh status.`;
  if (!(typeof w.watts === 'number' && w.watts >= SHUT_DOWN_WATTS)) return `${name}’s plug shows ${w.watts ?? 'no'} W while ${name} answers, so that plug may not be ${name}’s. Nothing was changed. Check which plug is which with deploy/plugs.sh status.`;
  return null;
}
// For the idle power-off only: someone signed in over SSH from another machine (Spark Console's own commands come from
// the hub and never hold a terminal), or a connection open on the model port, means the Spark is in use, though nothing
// Spark Console sees says so.
const IDLE_LOOK = `me=\${SSH_CLIENT%% *}
printf 'who\\t%s\\n' "$(who 2>/dev/null | awk '$2 ~ /^pts\\// && $NF ~ /^\\(/ && $NF !~ /^\\(:/' | wc -l | tr -d ' ')"
printf 'ssh\\t%s\\n' "$(ss -Htn state established '( sport = :22 )' 2>/dev/null | awk -v me="$me" '{ p = $NF; sub(/:[0-9]+$/, "", p); gsub(/[][]/, "", p); sub(/^::ffff:/, "", p); if (p != me) n++ } END { print n + 0 }')"
printf 'serve\\t%s\\n' "$(ss -Htn state established '( sport = :${CONFIG.servePort} )' 2>/dev/null | wc -l | tr -d ' ')"`;
async function idleInUse(node) {
  const r = await run(node, IDLE_LOOK, { timeout: 30000 });
  if (r.code !== 0) return `${sparkName(node)} didn’t answer the look at who uses it`;
  const n = tag => Number((fields(r.out, tag)[0] || [])[0]) || 0;
  return n('who') + n('ssh') > 0 ? `someone is signed in to ${sparkName(node)} over SSH`
    : n('serve') > 0 ? `${sparkName(node)}’s model port has a connection open` : null;
}

// The Sparks an input names: spark, or sparks (a pair, or more).
function powerTargets(input, viewer) {
  if (input.spark && input.sparks) throw new HttpError(400, 'Give spark or sparks, not both.');
  const ids = input.spark ? [input.spark] : input.sparks || [];
  if (!ids.length) throw new HttpError(400, 'Missing argument: spark (or sparks).');
  for (const id of ids) sparkOf(viewer, id);
  mustUse(viewer);
  for (const id of ids) {
    if (brainSparks().includes(id)) throw new HttpError(403, `${sparkWord(id)} runs Spark Console and Sparkie, so it is never powered off or on from here. Only you can, with its own plug in the Tapo app or its power button.`);
    if (!switchablePlug(id)) {
      const n = String(id).replace(/^spark/, '');
      throw new HttpError(409, `${sparkWord(id)} has no smart plug Spark Console can switch, so nothing was changed. Pair its plug from your Mac: bash spark-console/deploy/plugs.sh pair ${n}`);
    }
  }
  return ids;
}
// What runs across the Sparks being powered off: Spark Console's models there (one per model, a model across two Sparks
// once, with all its Sparks) and the Sparks beyond these that a model's other part runs on.
function powerPlan(ids, inv) {
  const models = new Map();
  for (const id of ids) {
    for (const d of inv.sparks.find(s => s.id === id)?.deployments || []) {
      if (d.state !== 'running' || d.role === 'main') continue;
      const head = d.container.replace(/-part2$/, ''), sparks = d.cluster ? d.cluster.split('+') : [id];
      const key = d.cluster ? `${d.cluster}|${d.model}` : `${id}/${d.container}`;
      if (!models.has(key)) models.set(key, { spark: d.cluster ? sparks[0] : id, at: id, container: d.container, head, sparks, model: d.model });
    }
  }
  const list = [...models.values()];
  return { models: list, partners: [...new Set(list.flatMap(m => m.sparks))].filter(id => !ids.includes(id)) };
}
const pairWords = (plan, ids) => plan.models.filter(m => m.sparks.some(id => !ids.includes(id)))
  .map(m => `${m.head} runs across ${sparksWords(m.sparks)}, so it stops on both; ${sparksWords(m.sparks.filter(id => !ids.includes(id)))} stays on.`).join(' ');

action({
  name: 'power_off', title: 'Power off a Spark', kind: 'change', scope: 'fleet:act', who: 'owner', destructive: true, group: 'power',
  description: `Use when the owner asks to shut down, power off or turn off a Spark (“shut down Spark 4”, “turn off Sparks 3 and 4”), not a model. Spark Console stops its own models and kept apps there first and parks them (they come back when the Spark is turned on, or when a parked model is called), shuts the Spark down cleanly, waits until it stops answering and its plug draws under 15 W, then switches its smart plug off. A model across two Sparks stops on both; the other Spark stays on. Refused for ${hubName()} (it runs Spark Console and Sparkie), for a Spark without a switchable plug, and while anything runs there that Spark Console didn’t start or that is protected (it names them). Pass the Sparks the owner named. It may ask first; answer with {"choice": id}. From an agent it always waits for the owner’s yes in Spark Console: tell the owner, and don’t answer it yourself. Returns an operation id at once; follow it with wait_operation (about 2 minutes).`,
  input: { type: 'object', properties: {
    spark: { ...sparkArg, description: 'The Spark to power off, as the owner named it.' },
    sparks: { ...sparksArg, maxItems: 3, description: 'Two or more Sparks to power off together, like ["spark3","spark4"].' },
    choice: choiceArg,
  }, additionalProperties: false },
  run: async (input, viewer, ctx) => {
    if (input.choice && Object.keys(input).length > 1) throw new HttpError(400, 'Send the choice alone: {"choice": id}.');
    const args = input.choice ? redeemChoice(viewer, ctx, 'power_off', input.choice) : input;
    const asked = powerTargets(args, viewer), st = powerState();
    const ids = asked.filter(id => !st.off[id]);
    if (!ids.length) return { outcome: 'already', sparks: asked, note: `${sparksWords(asked)} ${asked.length > 1 ? 'are' : 'is'} already powered off by Spark Console.` };
    const going = [...jobs.values()].find(j => j.status === 'running' && j.type === 'power-off' && (j.nodes || [j.node]).some(id => ids.includes(id)));
    if (going) return { outcome: 'already-starting', operation: going.id, sparks: going.nodes || [going.node], step: going.step, note: 'It’s already being powered off; nothing new was done.', next: `wait_operation {"id":"${going.id}"} to follow it.` };
    for (const id of ids) {
      const kept = [...(keepAwakes.get(id)?.keys() || [])];
      if (kept.length) throw new HttpError(409, `${sparkWord(id)} is kept awake (${kept.join('; ')}), so nothing was changed.`);
    }
    // A look at each Spark now (read only): anything that isn't Spark Console's to stop refuses it, by name.
    const looks = await Promise.all(ids.map(async id => ({ id, ...(await powerLook(nodeById(id))) })));
    for (const l of looks) if (l.inUse.length) throw new HttpError(409, inUseWords(nodeById(l.id), l.inUse));
    for (const l of looks.filter(x => x.answers)) if (!(await sudoReady(nodeById(l.id)))) throw new HttpError(409, setupWords(nodeById(l.id)));
    for (const l of looks.filter(x => x.answers)) { const why = await plugUnproven(l.id); if (why) throw new HttpError(409, why); }
    if (ctx.powerWhy === 'idle') for (const l of looks.filter(x => x.answers)) { const busy = l.boxes.length ? `a box is open on ${sparkWord(l.id)}` : await idleInUse(nodeById(l.id)); if (busy) throw new HttpError(409, `Not idle: ${busy}. Nothing was changed.`); }
    // One that doesn't answer now: cut only when its plug shows it shut down (under 15 W); one that draws power is on,
    // or stuck, and its power is never cut from here.
    for (const l of looks.filter(x => !x.answers)) {
      const w = await freshWall(l.id).catch(e => ({ answering: false, problem: e.message }));
      // (the plug controller's own words are outside text, and a change's answer is no outside read, R26: why is in
      // fleet_status's wall for that Spark)
      if (!w.answering) throw new HttpError(409, `${sparkWord(l.id)} isn’t answering, and its plug can’t be read (fleet_status’s wall for it says why), so nothing was changed.`);
      if (w.on === false) { l.plugOff = true; continue; }
      if (!(typeof w.watts === 'number' && w.watts < SHUT_DOWN_WATTS)) throw new HttpError(409, `${sparkWord(l.id)} isn’t answering, but its plug shows ${w.watts ?? '?'} W: it is powered on but not answering, so its power is not cut from here. Look at it there.`);
    }
    if (looks.every(l => l.plugOff)) return { outcome: 'already', sparks: ids, note: `${sparksWords(ids)} ${ids.length > 1 ? 'have their' : 'has its'} plug off already.` };
    const inv = await inventory(null), plan = powerPlan(looks.filter(l => l.answers).map(l => l.id), inv);
    const stops = [...plan.models.map(m => `${m.spark}/${m.head}`), ...looks.flatMap(l => l.apps.map(a => `${l.id}/${a}`))];
    const base = args.spark ? { spark: args.spark } : { sparks: args.sparks };
    // (Spark Console's own boxes there: said, and ended inside the operation; one of a task under way is asked about first)
    const boxesThere = looks.flatMap(l => (l.boxes || []).map(b => ({ ...b, spark: l.id }))), boxYes = boxesThere.length ? { confirmBoxes: true } : {};
    // A model that answers Sparkie's chats or apps stops only after the owner's yes, as stop_model asks.
    if (!args.confirmRouted && plan.models.some(m => m.sparks.some(id => routedSparks().has(id)))) {
      const names = plan.models.filter(m => m.sparks.some(id => routedSparks().has(id))).map(m => m.head).join(', ');
      return question(viewer, ctx, `${names} answers Sparkie’s chats or apps. Stop it and power off ${sparksWords(ids)} anyway?`, [
        { label: `Yes, stop ${names} and power off ${sparksWords(ids)}`, call: { action: 'power_off', args: { ...base, confirmRouted: true, ...(args.confirmStops ? { confirmStops: true } : {}) } } },
        { label: 'No, leave it on', call: null }], 'question', { ownerOnly: true });
    }
    // The owner's own request is the yes for what stops (as "stop X" is). An agent's power-off always waits for the owner
    // (power is asked first, design-2026-11-13): the owner's button in Spark Console, which the agent can't press itself.
    const agent = ctx.via === 'agent' || Boolean(ctx.agent) || Boolean(viewer.agentKey);
    if (agent) {
      const names = stops.map(x => x.split('/').pop()).join(', ');
      return question(viewer, ctx, `Power off ${sparksWords(ids)}?${stops.length ? ` It stops ${names} first (parked: ${stops.length > 1 ? 'they come' : 'it comes'} back when the Spark is turned on). ${pairWords(plan, ids)}` : ''}${boxesThere.length ? ` ${powerBoxSay(boxesThere)}` : ''}`.replace(/\s+/g, ' ').trim(), [
        { label: `Yes, ${stops.length ? `stop ${names} and ` : ''}${boxesThere.length ? 'end the box and ' : ''}power off ${sparksWords(ids)}`, call: { action: 'power_off', args: { ...base, ...(args.confirmRouted ? { confirmRouted: true } : {}), ...boxYes } } },
        { label: 'No, leave it on', call: null }], 'question', { ownerOnly: true });
    }
    if (boxesThere.some(b => b.live) && !args.confirmBoxes) {
      return question(viewer, ctx, `${powerBoxSay(boxesThere).replace(/ (?:It ends|They end) first, with (?:its folder|their folders)\.$/, '')} Power off ${sparksWords(ids)} anyway? The box ends first, and what its folder holds goes with it.`, [
        { label: `Yes, end the box and power off ${sparksWords(ids)}`, call: { action: 'power_off', args: { ...base, ...(args.confirmRouted ? { confirmRouted: true } : {}), ...boxYes } } },
        { label: 'No, leave it on', call: null }], 'question', { ownerOnly: true });
    }
    const why = ctx.powerWhy === 'idle' ? 'idle' : 'asked';
    const job = claimed([...ids, ...plan.partners], `powering off ${sparksWords(ids)}`, () => newJob('power-off', { node: ids[0], ...(ids.length > 1 ? { nodes: ids } : {}),
      by: viewer.login, actor: ctx.actor || null, via: ctx.via || null, request: ctx.request ? String(ctx.request).slice(0, 300) : null, why, stops }));
    runJob(job, j => powerOffJob(j, ids, ctx, why, args.confirmBoxes === true));
    return { outcome: 'started', operation: job.id, sparks: ids, stops, ...(boxesThere.length ? { boxes: boxesThere.map(b => b.name) } : {}),
      note: `${boxesThere.length ? `${powerBoxSay(boxesThere)} ` : ''}${stops.length ? `It stops and parks ${stops.map(x => x.split('/').pop()).join(', ')} first. ${pairWords(plan, ids)} ` : ''}Then ${sparksWords(ids)} ${ids.length > 1 ? 'shut' : 'shuts'} down cleanly, and ${ids.length > 1 ? 'their plugs are' : 'its plug is'} switched off once ${ids.length > 1 ? 'they stop' : 'it stops'} answering and ${ids.length > 1 ? 'draw' : 'draws'} under 15 W (about 2 minutes).`.replace(/\s+/g, ' ').trim(),
      next: `wait_operation {"id":"${job.id}"} to follow it.` };
  },
});

// Puts back what a power-off parked when it stopped before the Spark went down, and takes it off the parked list. A
// one-Spark model or an app is started again as it was (putBack's way). A model across two Sparks isn't started by a bare
// docker start (its parts must meet again): it is only unparked, and self-healing starts it again as a pair, through
// start_model ("a part stopped").
async function unpark(job, stopped, pairHeads = new Set()) {
  for (const x of stopped) {
    const [id, container] = x.split('/');
    consoleStopped.delete(x);
    if (pairHeads.has(container.replace(/-part2$/, ''))) continue;
    const r = await run(nodeById(id), `docker start ${q(container)} >/dev/null 2>&1`, { timeout: 90000 });
    note(job, r.code ? `Couldn’t start ${container} on ${sparkWord(id)} again; start it from Spark Console.` : `Started ${container} on ${sparkWord(id)} again`);
  }
  if (stopped.some(x => pairHeads.has(x.split('/')[1].replace(/-part2$/, '')))) note(job, 'A model across two Sparks wasn’t started again here: self-healing starts it again across both.');
  try { parkDesired(stopped, false); } catch (e) { note(job, `The list of what should be running couldn’t be updated: ${e.message}`); }
}
async function powerOffJob(j, ids, ctx, why, boxYes = false) {
  pausedCheck(ctx);
  // Looked at again inside the operation (R14): nothing that isn't Spark Console's came since, and sudo is still set up.
  step(j, `Checking ${sparksWords(ids)}`);
  const looks = await Promise.all(ids.map(async id => ({ id, ...(await powerLook(nodeById(id))) })));
  for (const l of looks) if (l.inUse.length) throw new Error(inUseWords(nodeById(l.id), l.inUse));
  const up = looks.filter(l => l.answers).map(l => l.id);
  for (const id of up) if (!(await sudoReady(nodeById(id)))) throw new Error(setupWords(nodeById(id)));
  for (const id of up) { const unproven = await plugUnproven(id); if (unproven) throw new Error(unproven); }
  if (why === 'idle') for (const id of up) { const busy = await idleInUse(nodeById(id)); if (busy) throw new Error(`Not idle: ${busy}. Nothing was changed.`); }
  if (why === 'idle') for (const l of looks) if (l.boxes?.length) throw new Error(`Not idle: a box is open on ${sparkWord(l.id)}. Nothing was changed.`);
  // (Spark Console's own box there ends first, before anything is parked: 21-power-box.mjs)
  await powerBoxesEnd(j, looks, ctx, boxYes);
  await copyBeforeOff(j, up);   // (the state's copy first, if it changed: 20-state-copy.mjs)
  // Parking: Spark Console's models and kept apps there stop (both parts of a model across two Sparks), and stay on the
  // list of what should be running, marked parked.
  const inv = await inventory(null), plan = powerPlan(up, inv), pairHeads = new Set(plan.models.filter(m => m.sparks.length > 1).map(m => m.head));
  cancelCheck(j);
  try {
    for (const m of plan.models) {
      await stopContainer(j, m.at, m.container, null);
      await stoppedForSure(j, m.at, m.container);
    }
    for (const l of looks) for (const a of l.apps) { await stopContainer(j, l.id, a, null); await stoppedForSure(j, l.id, a); }
  } catch (e) {
    const stopped = [...new Set(j.stoppedHere || [])];
    j.stoppedHere = [];
    await unpark(j, stopped, pairHeads);
    throw e;
  }
  const stopped = [...new Set(j.stoppedHere || [])];
  // (kept on the list: desiredAfter takes a stop off it, a park doesn't)
  j.stoppedHere = [];
  j.parkedHere = stopped;
  let parked = [];
  try { parked = parkDesired(stopped, true); } catch (e) { note(j, `The list of what should be running couldn’t be marked: ${e.message}`); }
  const pairs = pairWords(plan, ids);
  if (pairs) note(j, pairs);
  if (j.cancelled) { await unpark(j, stopped, pairHeads); cancelCheck(j); }
  // One more look, now that what was parked has stopped: anything that came since and isn't Spark Console's to stop
  // (started by hand while the models stopped) puts everything back, and the Spark stays on.
  let again;
  try { again = await Promise.all(up.map(async id => ({ id, ...(await powerLook(nodeById(id))) }))); } catch {
    // (the models had stopped by then, so "nothing was changed" isn't true: they are put back, and that is what's said)
    await unpark(j, stopped, pairHeads);
    throw new Error(`Its models were stopped, but the last look before the shutdown didn’t work (Docker there didn’t answer), so nothing was shut down and what was parked was put back.`);
  }
  const came = again.filter(l => l.inUse.length || l.apps.length || l.boxes?.length);
  if (came.length) {
    await unpark(j, stopped, pairHeads);
    throw new Error(`Something started on ${sparksWords(came.map(l => l.id))} while its models stopped (${came.flatMap(l => [...l.inUse, ...l.apps, ...(l.boxes || []).map(b => `${b.name} (a box)`)]).join(', ')}), so it wasn’t shut down; what was parked was put back.`);
  }
  // The shutdown. From here it is off on purpose: healing and the needs-me line leave it alone.
  const at = new Date().toISOString(), by = ctx.actor || 'the owner', entries = desired().running.filter(x => parked.includes(keyOf(x)));
  // (the model names on its disk go on the record, so a call for one of them knows which Spark to turn on)
  // (a record that can't be written: nothing is shut down, what was parked is put back, and the records written go)
  try {
    for (const id of up) offRecord(id, { at, why, by, parked: entries.filter(x => (x.sparks || [x.spark]).includes(id)).map(keyOf), plugCut: false, problem: null,
      ...(inv.sparks.find(x => x.id === id)?.online ? { models: (inv.sparks.find(x => x.id === id).models || []).slice(0, 300) } : {}),
      ...(inv.sparks.find(x => x.id === id)?.online ? { memTotal: inv.sparks.find(x => x.id === id).memTotal, diskFree: inv.sparks.find(x => x.id === id).diskFree } : {}) });
  } catch (e) {
    for (const id of up) try { offRecord(id, null); } catch {}
    await unpark(j, stopped, pairHeads);
    throw new Error(`Its models were stopped, but the record of what was powered off couldn’t be saved (${e.message}), so nothing was shut down and what was parked was put back.`);
  }
  for (const id of up) wokeFor.delete(id);
  const refused = [];
  await Promise.all(up.map(async id => {
    const node = nodeById(id);
    step(j, `Shutting down ${sparkName(node)} cleanly`);
    let r;
    try { r = await shutDownSpark(node); } catch (e) { refused.push({ id, words: e.message }); return; }
    const [code] = fields(r.out, 'poweroff')[0] || [];
    if (code === '0' || (r.code === 255 && !code) || /timed out/.test(r.err)) return;
    refused.push({ id, words: /password is required|not allowed|sudoers|a terminal is required/i.test(r.out + r.err) ? setupWords(node) : `${sparkName(node)} didn’t shut down: ${maskSecrets(String(r.out || r.err).trim().split('\n')[0]).slice(0, 200)}` });
  }));
  if (refused.length) {
    // Nothing went down there: its record goes and what was parked starts again.
    for (const x of refused) offRecord(x.id, null);
    await unpark(j, stopped.filter(k => refused.some(x => k.startsWith(`${x.id}/`) || plan.models.some(m => m.sparks.includes(x.id) && [`${m.spark}/${m.head}`, `${m.at}/${m.container}`].includes(k)))), pairHeads);
    if (refused.length === up.length && up.length === ids.length) throw new Error(refused.map(x => x.words).join(' '));
  }
  const failed = refused.map(x => x.words);
  step(j, `Waiting for ${sparksWords(ids)} to shut down (up to ${minutesWords(POWER_OFF_WAIT_MS)})…`);
  await Promise.all(ids.filter(id => !refused.some(x => x.id === id)).map(async id => {
    try { await waitAndCut(j, id, up.includes(id), { at, why, by }); } catch (e) { failed.push(e.message); }
  }));
  if (failed.length) throw new Error(failed.join(' '));
}
// The cut (R41): only once the Spark doesn't answer AND a fresh reading of its plug is under 15 W (or the plug is off
// already), checked again right before the switch. A Spark that still answers is never cut; watts that never drop mean
// the plug may not be on that Spark, and the power stays on.
async function waitAndCut(j, id, wentDown, rec) {
  const node = nodeById(id), name = sparkName(node);
  let gone = false, w = null;
  for (const until = Date.now() + POWER_OFF_WAIT_MS; ;) {
    gone = !(await answersNow(node));
    // (one that didn't answer when this began and answers now is on: nothing to wait for, and never cut)
    if (!gone && !wentDown) throw new Error(`${name} answers again, so its power was not cut.`);
    w = gone ? await freshWall(id).catch(e => ({ answering: false, problem: e.message })) : null;
    if (gone && w.answering && (w.on === false || (typeof w.watts === 'number' && w.watts < SHUT_DOWN_WATTS))) break;
    if (Date.now() > until) break;
    await sleep(POWER_POLL_MS);
  }
  const low = gone && w?.answering && (w.on === false || (typeof w.watts === 'number' && w.watts < SHUT_DOWN_WATTS));
  if (!low) {
    const why = !gone ? `${name} still answers ${minutesWords(POWER_OFF_WAIT_MS)} after it was told to shut down, so its plug was left on.`
      : !w?.answering ? `${name} stopped answering, but its plug couldn’t be read, so its power was not cut.`
        : `${name} stopped answering, but its plug still shows ${w.watts ?? '?'} W, so the plug may not be on ${name}. Its power was not cut.`;
    if (wentDown) offRecord(id, { problem: gone ? `${why} Turn it on with its power button.` : why });
    throw new Error(why);
  }
  // (a Spark that didn't answer when this began was never read at 15 W or more here, so one low reading proves nothing: the
  // hold first)
  const held = !wentDown && w.on !== false ? await holdLow(j, id) : null;
  if (held && held !== 'off') {
    throw new Error(held === 'answers' ? `${name} answered while its plug was being watched, so its power was not cut.` : `${held}, so its power was not cut.`);
  }
  if (w.on === false || held === 'off') note(j, `${name}’s plug is off already`);
  else {
    // (one more look right before the switch: a Spark that answers is never cut)
    if (await answersNow(node)) {
      if (wentDown) offRecord(id, { problem: `${name} answered again just before its plug was to be switched off, so its power was not cut.` });
      throw new Error(`${name} answered again just before its plug was to be switched off, so its power was not cut.`);
    }
    step(j, `${name} is shut down (${w.watts} W at the wall): switching its plug off`);
    await switchPlug(id, false);
  }
  const r = offRecord(id, { ...(wentDown ? {} : { ...rec, parked: [] }), plugCut: true, problem: null }).off[id];
  fleetEvent({ type: 'spark-powered-off', spark: id, why: r.why, by: r.by || null, parked: (r.parked || []).map(k => String(k).split('/').pop()) });
  note(j, `${name} is off`);
}

// Turning Sparks on (a job's part): each answers again, then Docker there, then the record goes. Plug off and on again for
// a Spark shut down with its plug on; plug on for one whose plug is off; nothing for one that draws power but doesn't
// answer (it's on, or starting: cycling it could cut a Spark that is busy).
async function powerOnOne(j, id, noSwitch = false) {
  const node = nodeById(id), name = sparkName(node);
  if (await answersNow(node)) { note(j, `${name} is on and answering`); return; }
  // (a Spark seen on again by itself is only taken back: nothing is switched for it)
  if (noSwitch) throw new Error(`${name} isn’t answering now, so nothing was switched.`);
  const w = await freshWall(id);
  if (!w.answering) throw new Error(`${name}’s plug isn’t answering the plug controller, so it can’t be turned on from here.`);
  if (w.on === true && !(typeof w.watts === 'number' && w.watts < SHUT_DOWN_WATTS)) {
    throw new Error(`${name}’s plug shows ${w.watts ?? '?'} W, so it is powered on but not answering. Nothing was switched: it may still be starting; if it stays like this, look at it there.`);
  }
  if (w.on !== true && w.on !== false) throw new Error(`${name}’s plug doesn’t say whether it is on, so nothing was switched.`);
  cancelCheck(j);
  if (w.on === true) {
    // (the hold, as before any cut of a Spark that doesn't answer: a Spark booting from its own button, behind a reading
    // the controller hasn't caught up with, is never cut)
    const held = await holdLow(j, id);
    if (held === 'answers') { note(j, `${name} is on and answering`); return; }
    if (held && held !== 'off') throw new Error(`${held}, so it may be starting by itself. Nothing was switched; ask again in a few minutes if it doesn’t answer.`);
    if (held !== 'off') {
      step(j, `${name} is shut down with its plug on: switching its plug off, then on again`);
      await switchPlug(id, false);
      await sleep(POWER_CYCLE_MS);
    }
  }
  await switchPlug(id, true);
  step(j, `Turning on ${name} (about 2 minutes)…`);
  for (const until = Date.now() + POWER_ON_WAIT_MS; ;) {
    if (await answersNow(node)) break;
    if (Date.now() > until) throw new Error(`${name}’s plug is on, but ${name} didn’t answer within ${minutesWords(POWER_ON_WAIT_MS)}. It may need its power button, or its firmware’s Auto Boot (after power loss) turned on.`);
    await sleep(POWER_POLL_MS);
  }
  note(j, `${name} answers again`);
}
async function powerOnSparks(j, ids, why, noSwitch = false) {
  const tried = await Promise.allSettled(ids.map(id => powerOnOne(j, id, noSwitch)));
  const bad = tried.map((r, i) => [ids[i], r]).filter(([, r]) => r.status === 'rejected');
  if (bad.length) {
    // (a Spark Spark Console powered off that didn't come back goes on the needs-you list, whoever asked: a call that
    // started it tells nobody, and it needs its button or a look, R41)
    if (!noSwitch) for (const [id, r] of bad) if (powerState().off[id]) try { offRecord(id, { problem: `Turning it on didn’t work: ${maskSecrets(String(r.reason?.message || r.reason).split('\n')[0]).slice(0, 300)}` }); } catch {}
    throw bad[0][1].reason;
  }
  // Docker there settles before anything starts (healing waits for the same).
  step(j, `Waiting for Docker on ${sparksWords(ids)}`);
  for (const until = Date.now() + 120000; ;) {
    const inv = await inventory(null);
    if (ids.every(id => inv.sparks.find(s => s.id === id)?.dockerOk)) break;
    if (Date.now() > until) { note(j, `Docker on ${sparksWords(ids)} didn’t answer within 2 minutes`); break; }
    await sleep(POWER_POLL_MS);
  }
  for (const id of ids) {
    if (!powerState().off[id]) continue;
    offRecord(id, null);
    fleetEvent({ type: 'spark-powered-on', spark: id, why: POWER_WHY[why] || why });
  }
}
// What was parked on these Sparks comes back now that they're on (all of a model's Sparks on): as self-healing brings
// things back, through the same actions, never stopping anything else. One that doesn't come back is held, with why.
// skip: entries only unparked, not started (the one a start just tried: it failed, so it shows as held, with why).
async function bringBackParked(j, ids, skip = null) {
  const list = desired().running.filter(x => x.parked && (x.sparks || [x.spark]).some(id => ids.includes(id)) && !(x.sparks || [x.spark]).some(consoleOff));
  const skipped = skip ? list.filter(skip) : [];
  if (skipped.length) try { parkDesired(skipped.map(keyOf), false); } catch {}
  const results = [];
  for (const x of list.filter(y => !skipped.includes(y))) {
    const where = sparksWords(x.sparks || [x.spark]);
    step(j, `Bringing back ${x.container} on ${where}`);
    try { parkDesired([keyOf(x)], false); } catch {}
    const wf = x.app ? null : x.sparks ? 'start_model_across' : 'restart_model', st = wf ? workflowStatus(wf) : null;
    const ctx = { actor: 'Spark Console', via: 'watcher', request: `bring back ${x.container}: ${where} is on again`, canChange: true, trusted: true, noStops: true };
    const extra = st?.state === 'needs-validation' ? { __validate: wf } : {};
    // (a saved workflow's run that started it keeps it as its own once it is back: A-22)
    const held = await receiptsHeld([keyOf(x)]).catch(() => []);
    try {
      if (st?.state === 'untested') throw new Error('the workflow that brings it back hasn’t passed Spark Console’s tests');
      const out = x.app ? await runAction('keep_running', healOwner(), { spark: x.spark, container: x.container }, ctx)
        : x.sparks ? await runAction('start_model', healOwner(), { model: x.model, sparks: x.sparks, ...extra }, ctx)
          : await runAction('restart_model', healOwner(), { spark: x.spark, container: x.container, ...extra }, ctx);
      if (out?.operation) {
        const done = await waitJob(out.operation, 45 * 60000);
        if (done?.status !== 'completed') throw new Error(String(done?.error || done?.status || 'it didn’t start').split('\n')[0]);
      } else if (!['already', 'kept'].includes(out?.outcome)) throw new Error(out?.note || out?.question || out?.outcome || 'it didn’t start');
      if (held.length) await receiptsBroughtBack(held, out?.operation ? jobs.get(out.operation) : null).catch(() => {});
      note(j, `${x.container} is back on ${where}`);
      results.push(x.container);
    } catch (e) {
      // (masked, then cut, as every healing reason: R7)
      const why = maskSecrets(String(e.message).split('\n')[0]).slice(0, 300);
      note(j, `${x.container} didn’t come back: ${why}`);
      fleetEvent({ type: 'heal-skipped', spark: x.spark, container: x.container, why: `bringing it back after its Spark was turned on failed: ${why}` });
    }
  }
  return results;
}

action({
  name: 'power_on', title: 'Turn on a Spark', kind: 'change', scope: 'fleet:act', who: 'owner', group: 'power',
  description: `Use when the owner asks to turn on, power on or boot a Spark (“turn on Spark 3”). Switches its smart plug on (off and on again if it is shut down with its plug on), waits until it answers (about 2 minutes), then brings back what Spark Console parked there when it powered it off. Does nothing to a Spark that already answers, except bring back what is parked there; never switches anything for one that draws power but doesn’t answer (it says so). ${hubName()} is never switched. Starting a model on a Spark Spark Console powered off turns it on by itself, so this is only for turning one on as such. Returns an operation id at once; follow it with wait_operation.`,
  input: { type: 'object', properties: {
    spark: { ...sparkArg, description: 'The Spark to turn on, as the owner named it.' },
    sparks: { ...sparksArg, maxItems: 3, description: 'Two or more Sparks to turn on together, like ["spark3","spark4"].' },
  }, additionalProperties: false },
  run: async (input, viewer, ctx) => {
    const ids = powerTargets(input, viewer), st = powerState();
    const going = [...jobs.values()].find(j => j.status === 'running' && j.type === 'power-on' && (j.nodes || [j.node]).some(id => ids.includes(id)));
    if (going) return { outcome: 'already-starting', operation: going.id, sparks: going.nodes || [going.node], step: going.step, note: 'It’s already being turned on; nothing new was done.', next: `wait_operation {"id":"${going.id}"} to follow it.` };
    const parked = desired().running.filter(x => x.parked && (x.sparks || [x.spark]).some(id => ids.includes(id)));
    const answering = await Promise.all(ids.map(id => answersNow(nodeById(id))));
    if (answering.every(Boolean) && !ids.some(id => st.off[id]) && !parked.length) return { outcome: 'already', sparks: ids, note: `${sparksWords(ids)} ${ids.length > 1 ? 'are' : 'is'} on and answering.` };
    // One that draws power but doesn't answer is on (or starting): said now, and nothing is switched.
    for (const [i, id] of ids.entries()) {
      if (answering[i]) continue;
      const w = await freshWall(id).catch(() => { throw new HttpError(409, `${sparkWord(id)}’s plug can’t be read (fleet_status’s wall for it says why), so nothing was switched.`); });
      if (!w.answering) throw new HttpError(409, `${sparkWord(id)}’s plug isn’t answering the plug controller, so it can’t be turned on from here.`);
      if (w.on === true && !(typeof w.watts === 'number' && w.watts < SHUT_DOWN_WATTS)) {
        throw new HttpError(409, `${sparkWord(id)}’s plug shows ${w.watts ?? '?'} W, so it is powered on but not answering. Nothing was switched: it may still be starting; if it stays like this, look at it there.`);
      }
    }
    const why = ctx.powerWhy || 'asked';
    const job = claimed(ids, `turning on ${sparksWords(ids)}`, () => newJob('power-on', { node: ids[0], ...(ids.length > 1 ? { nodes: ids } : {}),
      by: viewer.login, actor: ctx.actor || null, via: ctx.via || null, request: ctx.request ? String(ctx.request).slice(0, 300) : null, why }));
    runJob(job, async j => {
      pausedCheck(ctx);
      await powerOnSparks(j, ids, why, why === 'outside');
      // (what comes back starts through its own operations, which claim these Sparks themselves)
      j.release?.();
      const back = await bringBackParked(j, ids);
      if (back.length) note(j, `Back: ${back.join(', ')}`);
    });
    const names = parked.map(x => x.container);
    return { outcome: 'started', operation: job.id, sparks: ids, ...(names.length ? { bringsBack: names } : {}),
      note: `Turning on ${sparksWords(ids)} (about 2 minutes)${names.length ? `, then bringing back ${names.join(', ')}` : ''}.`, next: `wait_operation {"id":"${job.id}"} to follow it.` };
  },
});

// A start that needs a Spark Spark Console powered off (start_model naming it, or a parked model's own Spark, or nothing
// fits on the Sparks that are on): the Spark is turned on first, inside one operation, and the start follows. What else
// was parked there stays parked (it comes back on its next call), so it can't crowd out what was asked for. null when
// no Spark needs turning on.
// mode: 'named' turns on only the Sparks the start names; 'all' one whose files hold the model (`names`, by the
// records: wakeOne), named or not; 'any', when the start names none, one with room for it (`size`: sizeBytes,
// needBytes or versions, and `why`, which says why none was when none was). A call (which never downloads) turns on only
// a Spark whose record lists the model, or has no list.
function powerFirst(args, viewer, ctx, mode = 'named', names = null, size = null) {
  const off = Object.keys(powerState().off).filter(id => nodeById(id) && switchablePlug(id) && !brainSparks().includes(id));
  if (!off.length) return null;
  const named = [args.spark, ...(args.sparks || [])].filter(Boolean), call = ctx.via === 'gateway';
  const need = mode === 'all' ? wakeOne(off, names || [String(args.model)], { call }) : named.length ? named.filter(id => off.includes(id))
    : mode === 'any' ? wakeOne(off, names || [String(args.model)], { room: true, call, ...(size || {}) }) : [];
  return need.length ? powerThenStart(viewer, ctx, need, args) : null;
}
// (the workflow the start runs, so this operation is recorded under it: across two Sparks when it will be, F11)
function powerThenStart(viewer, ctx, need, args) {
  const across = acrossGate(Boolean(args.sparks), args, ctx, String(args.model)), m = String(args.model);
  const asked = x => !x.app && [x.model, String(x.container).replace(/^sc-/, '')].includes(m);
  return { ...powerThen(viewer, ctx, need, m, c => startModel(args, viewer, c), asked), ...(across || {}) };
}
// The same for an app kept running on a Spark Spark Console powered off (keep_running naming it).
function powerThenKeep(viewer, ctx, input) {
  const off = consoleOff(input.spark) && switchablePlug(input.spark) && !brainSparks().includes(input.spark);
  return off ? powerThen(viewer, ctx, [input.spark], input.container, c => ACTIONS.get('keep_running').run(input, viewer, c), x => x.app && x.container === input.container) : null;
}
// Turns the Sparks on, then hands over to the start (its own operation, followed here, so this one ends when it does
// and says how it went). A question the start would ask can't be shown from inside an operation: it is said instead.
function powerThen(viewer, ctx, need, what, go, asked = null) {
  const names = sparksWords(need);
  const job = claimed(need, `turning on ${names}`, () => newJob('power-on', { model: what, node: need[0], ...(need.length > 1 ? { nodes: need } : {}), by: viewer.login,
    actor: ctx.actor || null, via: ctx.via || null, request: ctx.request ? String(ctx.request).slice(0, 300) : null, why: 'start' }));
  runJob(job, async j => {
    pausedCheck(ctx);
    await powerOnSparks(j, need, 'start');
    j.release?.();
    // (from here the start is its own operation's: this one no longer counts as the start under way)
    j.handedOver = true;
    let started = false;
    try {
      step(j, `Starting ${what}`);
      // (no conversation: this operation posts the one result; poweredOn counts the wakes this start has had, R56)
      const out = await go({ ...ctx, poweredOn: (ctx.poweredOn || 0) + 1, conv: null, onQuestion: null });
      if (['already', 'kept'].includes(out?.outcome)) { note(j, `${what} is running`); started = true; return; }
      if (!['started', 'already-starting'].includes(out?.outcome) || !out.operation) {
        throw new Error(`${names} ${need.length > 1 ? 'are' : 'is'} on now, but starting ${what} needs a choice first: ${String(out?.question || out?.note || out?.outcome || 'ask again').slice(0, 300)} Ask again to choose.`);
      }
      // (its failure is this operation's: counted once, here, R9)
      const inner = jobs.get(out.operation);
      if (inner) inner.partOf = j.id;
      // (and its own version, as runAction gives the operation it returns: its lesson has its start code, B2, R56)
      if (inner && !inner.workflowVersion && (out.workflowVersion || ctx.workflowVersion)) inner.workflowVersion = out.workflowVersion || ctx.workflowVersion;
      j.inner = out.operation;
      for (;;) {
        const x = jobs.get(out.operation);
        if (!x || x.status !== 'running') break;
        if (j.cancelled && !x.cancelled) cancelJob(x, j.cancelled);
        j.step = `Starting ${what}: ${x.step}`;
        j.detail = x.detail;
        await sleep(1000);
      }
      const done = jobs.get(out.operation);
      // (the workflow the start ran when Spark Console placed it across two: this operation, which the asker was given, is
      // recorded under it, as runAction records such a start with no wake; a power-on inside this one hands it up, R56)
      const ranAs = out.workflow ? { workflow: out.workflow, workflowVersion: out.workflowVersion } : done?.ranAs || null;
      if (ranAs) { j.ranAs = ranAs; if (j.workflow) Object.assign(j, ranAs); }
      if (done?.status !== 'completed') throw new Error(`${names} ${need.length > 1 ? 'are' : 'is'} on, but ${what} didn’t start:${String(done?.error || done?.status || 'it ended').split('\n')[0].slice(0, 400)}`);
      if (done.endpoint) j.endpoint = done.endpoint;
      note(j, `${what} started`);
      started = true;
    } finally {
      // What else was parked there comes back now, after what was asked for, whether that started or not (never
      // stopping anything: one that doesn't fit is held, with why). What was asked for, if it didn't start, is only
      // unparked: held, with why, never parked for good on a Spark that is on.
      const back = await bringBackParked(j, need, started ? null : asked).catch(e => { note(j, `Bringing back what was parked there: ${maskSecrets(String(e.message))}`); return []; });
      if (back.length) note(j, `Back: ${back.join(', ')}`);
    }
  });
  return { outcome: 'started', operation: job.id, model: what, sparks: need, poweringOn: need,
    note: `${names} ${need.length > 1 ? 'were' : 'was'} powered off by Spark Console, so ${need.length > 1 ? 'they are' : 'it is'} turned on first (about 2 minutes); then ${what} starts.`,
    next: `wait_operation {"id":"${job.id}"} to follow it; turning on and loading can take several minutes.` };
}

// The owner's words for the idle time (power_settings from Sparkie's chat, R25): "an hour", "45 minutes", "2 hours",
// "half an hour"; null when they give none.
const NUMBER_WORDS = { one: 1, a: 1, an: 1, two: 2, three: 3, four: 4, five: 5, six: 6, ten: 10, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, 'forty-five': 45, fifty: 50, sixty: 60, ninety: 90 };
function minutesSaid(text) {
  const out = [], t = normQuotes(text).toLowerCase().replace(/\bhalf\s+an?\s+hour\b/g, () => { out.push(30); return ' '; });
  for (const m of t.matchAll(/\b(\d+(?:\.\d+)?|one|an?|two|three|four|five|six|ten|twelve|fifteen|twenty|thirty|forty|forty-five|fifty|sixty|ninety)\s*(minutes?|mins?|m|hours?|hrs?|h)\b/g)) {
    const n = /^\d/.test(m[1]) ? Number(m[1]) : NUMBER_WORDS[m[1]];
    if (Number.isFinite(n)) out.push(Math.round(/^h/.test(m[2]) ? n * 60 : n));
  }
  return out;
}
// Sparkie runs power_settings at once only when the words are about the idle (or automatic) power-off and give its time,
// or say to turn it off, for 0 ("turn off gemma" is never about it).
function powerSettingsClear(input, saidText) {
  const t = normQuotes(saidText).toLowerCase();
  if (!/\b(idle|auto\w*)\b/.test(t)) return false;
  if (input.idleMinutes === 0) return /\b(stop|off|disable|never|no\s+more|don't|do\s+not|cancel|turn\s+off)\b/.test(t);
  return minutesSaid(t).includes(input.idleMinutes);
}

action({
  name: 'power_settings', title: 'Idle power-off setting', kind: 'change', scope: 'fleet:act', who: 'owner', group: 'power',
  description: `Use when the owner sets how long a Spark must be idle before Spark Console powers it off by itself (“power off idle Sparks after an hour”: 60), or turns that off (“stop auto shutdown”: 0). Idle means: no operation on it, nothing running there that Spark Console didn’t start, GPU under 5%, low load, and no call to its models at the model address, for that many minutes. Then its models are parked and it is powered off (both Sparks of a model across two together); ${hubName()} never. The default is 30 minutes. From an agent it waits for the owner’s yes in Spark Console. fleet_status shows the setting (power).`,
  input: { type: 'object', properties: {
    idleMinutes: { type: 'integer', minimum: 0, maximum: 1440, description: 'Minutes a Spark must be idle before it is powered off; 0 turns the idle power-off off.' },
  }, required: ['idleMinutes'], additionalProperties: false },
  run: async ({ idleMinutes }, viewer, ctx) => {
    // (an agent's setting waits for the owner's button in Spark Console, as its power-off does)
    if (ctx.via === 'agent' || Boolean(ctx.agent) || Boolean(viewer.agentKey)) {
      const label = idleMinutes ? `Yes, power off idle Sparks after ${idleMinutes} minute${idleMinutes === 1 ? '' : 's'}` : 'Yes, stop powering off idle Sparks';
      return question(viewer, ctx, `${idleMinutes ? `Power off idle Sparks after ${idleMinutes} minute${idleMinutes === 1 ? '' : 's'}` : 'Stop powering off idle Sparks'}? (Now: ${powerState().idleMinutes ? `after ${powerState().idleMinutes} minutes` : 'off'}.)`,
        [{ label, call: { action: 'power_settings', args: { idleMinutes } } }, { label: 'No, leave it', call: null }], 'question', { ownerOnly: true });
    }
    const before = powerState().idleMinutes;
    savePower(s => Object.assign(s, { idleMinutes, changedAt: new Date().toISOString(), changedBy: ctx.actor || viewer.login || null }));
    idleSince.clear();
    return { outcome: before === idleMinutes ? 'already' : 'saved', idleMinutes,
      note: idleMinutes ? `A Spark with a switchable plug (never ${hubName()}) that is idle for ${idleMinutes} minute${idleMinutes === 1 ? '' : 's'} is now powered off by itself; its models are parked and come back when it is turned on or called.`
        : 'Spark Console no longer powers off idle Sparks by itself. power_off still works when asked.' };
  },
});

/* ── the idle loop ── */
// Every minute (one round at a time; never while agents' changes are paused, an operation runs on that Spark, or a
// validation run goes): a Spark (never the hub) with a switchable plug is idle when nothing changes there, nothing runs
// there but Spark Console's own models and kept apps, its GPU is under 5% and its load low, nothing answers Sparkie's
// chats or apps there, no call reached its models and no app door request reached it. Idle for
// the owner's minutes without a break (counted from this process's start: a restart or an install starts the count
// again), it is powered off through power_off (why: idle), with both Sparks of a model across two together. A Spark it
// powered off that answers again (turned on another way) has its record cleared and what was parked brought back.
const idleSince = new Map();
let powerTicking = false;
const lastJobOn = id => Math.max(0, ...[...jobs.values()].filter(j => (j.nodes || [j.node]).includes(id)).map(j => Date.parse(j.finishedAt || j.createdAt) || 0));
const lastUseOn = id => Math.max(sparkCalls.get(id) || 0, lastJobOn(id),
  ...[...doorTickets.values()].filter(t => t.spark === id).map(t => t.lastAt || 0),
  ...[...inUse].filter(([k]) => k.startsWith(`${id}/`)).map(([, u]) => u.at || 0));
// May this Spark be shut down? Every reason it may not, in words; [] means it may sleep (d-fleet-workloads 2.6). The idle
// power-off asks without recent use (it counts the idle minutes itself, from lastUseOn); anyone else gets recent use
// too (within the idle minutes, or 30 when the idle power-off is off). A model on the should-run list is not a reason:
// the power part parks idle ones (the owner's choice, 2026-11-13). An asked power_off refuses on a keep-awake.
function sparkNeeded(id, { recentUse = true, unseen = true } = {}) {
  const node = nodeById(id);
  if (!node) return ['there is no such Spark'];
  const why = [];
  if (brainSparks().includes(id) || node.host === 'local') why.push('it is Spark Console’s own Spark, always on');
  for (const w of keepAwakes.get(id)?.keys() || []) why.push(`kept awake: ${w}`);
  const n = statusCache?.value.nodes.find(x => x.id === id);
  const fresh = Boolean(n && n.state === 'online' && Date.now() - statusCache.at <= Math.max(3 * STATUS_EVERY, 90000));
  if (!fresh) why.push('no fresh status');
  if (busySparks.has(id) || [...jobs.values()].some(j => j.status === 'running' && (j.nodes || [j.node]).includes(id))) why.push('an operation');
  if (routedSparks().has(id)) why.push('it answers Sparkie’s chats or apps');
  if ([...doorTickets.values()].some(t => t.spark === id && t.sockets?.size)) why.push('an app is open through the app door');
  const s = knowledge.sparks[id];
  if (!s?.watchedAt || Date.now() - Date.parse(s.watchedAt) > Math.max(3 * WATCH_EVERY, 180000)) why.push('not watched lately');
  // (only Spark Console's models are parked for idleness: an app kept running there may be in use in ways the console
  // can't see, so a Spark running one isn't idle; power_off when asked still parks apps)
  const other = Object.values(knowledge.workloads).find(w => w.spark === id && w.running && (w.protected || w.labels?.['spark.role'] === 'main' || w.labels?.['spark.console'] !== '1'));
  // (named as fleet_status, an inside read, may show a name, R26: one word of 64 signs at most, nameShown)
  if (other) why.push(`${nameShown(other.name, 'running_models') || 'a container whose name isn’t shown here'} runs there`);
  // (from the idle loop's last rounds: the model there gives no /metrics counter, so its use can't be seen)
  if (unseen && servesHere(id) && Date.now() - (serveUnseen.get(id) || 0) <= 3 * POWER_TICK_MS) why.push('its model’s use can’t be measured (its server gives no /metrics counter)');
  if (fresh) {
    if (typeof n.gpuUtilization !== 'number' || n.gpuUtilization >= IDLE_GPU_PERCENT) why.push('its GPU is busy');
    const load = n.load1Minute ?? n.load;
    if (typeof load !== 'number' || load >= IDLE_LOAD) why.push('it is busy');
  }
  if (recentUse) {
    const last = lastUseOn(id), within = (powerState().idleMinutes || 30) * IDLE_MINUTE_MS;
    if (last && Date.now() - last < within) why.push(`used ${minutesWords(Date.now() - last)} ago`);
  }
  return why;
}
const busyReason = id => sparkNeeded(id, { recentUse: false, unseen: false })[0] || null;
// Direct use of a model, which the console doesn't see (an app on its published port, a script on the hub): the model
// server's own counters at /metrics (vLLM always; SGLang with --enable-metrics and llama.cpp with --metrics, which
// Spark Console adds to what it starts: metricsFlags). A count that went up since the last round, or a request running, is
// use. A Spark where one of Spark Console's models answers (on its own, or the first part of one across two) and its
// /metrics gives no counter is never idle: its use can't be seen (TensorRT-LLM, a model started before the flags, an
// engine's /metrics that doesn't answer).
const serveCount = new Map();   // spark → the last count read
const serveUnseen = new Map();  // spark → when a round last found its model's use couldn't be measured
const SERVE_LOOK = `ip=$(tailscale ip -4 2>/dev/null | head -1); m=
for h in 127.0.0.1 $ip; do m=$(curl -s -m 3 "http://$h:${CONFIG.servePort}/metrics" 2>/dev/null) && [ -n "$m" ] && break; done
printf '%s\\n' "$m" | awk '/^#/ { next } { n = $1; sub(/[{].*/, "", n); v = $NF + 0 }
  n ~ /^(vllm:request_success_total|sglang:num_requests_total|llamacpp:tokens_predicted_total|llamacpp:prompt_tokens_total)$/ { c += v; f = 1 }
  n ~ /^(vllm:num_requests_running|sglang:num_running_reqs|llamacpp:requests_processing)$/ { r += v; f = 1 }
  END { if (f) printf "serve\\t%d\\t%d\\n", c, r }'`;
// { used, measured }: measured is false when /metrics gave no counter.
async function serveUsed(id) {
  const r = await run(nodeById(id), SERVE_LOOK, { timeout: 20000 });
  const [row] = fields(r.out, 'serve');
  if (r.code !== 0 || !row) { serveCount.delete(id); return { used: false, measured: false }; }
  const count = Number(row[0]) || 0, running = Number(row[1]) || 0, before = serveCount.get(id);
  serveCount.set(id, count);
  return { used: running > 0 || (before !== undefined && count > before), measured: true };
}
// Whether one of Spark Console's models answers on this Spark (on its own, or the first part of one across two), by what
// the watcher saw: the Sparks whose /metrics must give a counter before they can count as idle.
const servesHere = id => Object.values(knowledge.workloads).some(w => w.spark === id && w.running && w.labels?.['spark.console'] === '1'
  && !w.labels?.['spark.app'] && w.labels?.['spark.role'] !== 'main' && String(w.labels?.['spark.rank'] ?? '0') === '0');
// An entry still marked parked whose Sparks are all on and answering, none of them powered off on purpose and no power
// operation running on them, is unparked: it then shows as held, with its notice, and self-healing and Bring back apply
// as for anything else. (A restart while a woken Spark's model loaded, or between two bring-backs, left one parked for
// good on a Spark that was on, with nobody told.)
// The first time the idle power-off can act on a fleet (the setting on, a Spark it may switch, what wakes a parked model
// active), the owner is told once, in their newest chat in Spark Console (a new one if they have none) and on Telegram
// when it is paired: the minutes and the words that change it (the owner's choice, 2026-11-13; said, 2026-11-14).
// power.json keeps when (activeSaidAt), written first, so it is never said twice.
function sayIdleActive(st, can) {
  const n = st.idleMinutes, text = `The idle power-off is on now: ${sparksWords(can)} ${can.length > 1 ? 'are' : 'is'} powered off after ${n} idle minute${n === 1 ? '' : 's'}, with ${can.length > 1 ? 'their' : 'its'} models parked; a call or a start turns ${can.length > 1 ? 'them' : 'it'} on again. ${hubName()} never. To change the time, say “power off idle Sparks after an hour”; to turn it off, say “stop auto shutdown”.`;
  try { savePower(x => { x.activeSaidAt = new Date().toISOString(); }); } catch (e) { console.error(`The idle power-off note: ${e.message}`); return; }
  fleetEvent({ type: 'notice', text });
  try {
    const owner = accessList().owner, at = new Date().toISOString();
    let conv = chatData().conversations.filter(c => c.login === owner && !c.agent && c.channel !== 'telegram' && c.messages.length < LIMITS.messages)
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0];
    if (!conv && owner) {
      conv = { id: `sc_${randomBytes(8).toString('hex')}`, login: owner, title: 'Spark Console', spark: null, createdAt: at, updatedAt: at, messages: [] };
      chatData().conversations.push(conv);
    }
    if (conv) { conv.messages.push({ role: 'assistant', content: text, createdAt: at, notice: true }); conv.updatedAt = at; saveChats(); }
  } catch (e) { console.error(`The idle power-off note in the owner’s chat: ${e.message}`); }
  tell('system', text).catch(() => {});
}
const powerOpOn = ids =>[...jobs.values()].some(j => j.status === 'running' && ['power-off', 'power-on'].includes(j.type) && (j.nodes || [j.node]).some(id => ids.includes(id)));
async function unparkStranded() {
  for (const x of desired().running.filter(y => y.parked)) {
    const ids = x.sparks || [x.spark];
    if (!ids.every(id => nodeById(id)) || ids.some(consoleOff) || powerOpOn(ids)) continue;
    if (!ids.every(id => statusCache?.value.nodes.find(n => n.id === id)?.state === 'online')) continue;
    if (!(await Promise.all(ids.map(id => answersNow(nodeById(id))))).every(Boolean)) continue;
    // (looked at again after the looks: a power operation or record that began meanwhile keeps it parked)
    if (ids.some(consoleOff) || powerOpOn(ids)) continue;
    let done = [];
    try { done = parkDesired([keyOf(x)], false); } catch (e) { console.error(`Unparking ${x.container}: ${e.message}`); continue; }
    if (!done.length) continue;
    fleetEvent({ type: 'notice', spark: x.spark, container: x.container,
      text: `${x.container} was still marked parked, though ${sparksWords(ids)} ${ids.length > 1 ? 'are' : 'is'} on, so the mark was taken off: it is held now, and self-healing or Bring back starts it again.` });
  }
}
async function powerTick() {
  if (powerTicking) return;
  powerTicking = true;
  try {
    let st;
    try { st = powerState(true); } catch { return; }
    const s = agentSettings();
    // (a Spark it powered off that answers again, with nothing changing there: its record goes; what was parked comes
    // back unless agents' changes are paused, as self-healing would)
    for (const [id, rec] of Object.entries(st.off)) {
      // (seen on by a status look after it was told to go down, and answering now: a status look from before the
      // shutdown, or a Spark on its way down, is never taken for one that came back)
      if (!nodeById(id) || statusCache?.value.nodes.find(x => x.id === id)?.state !== 'online' || !(statusCache.at > (Date.parse(rec.at) || 0) + 5000)) continue;
      if (busySparks.has(id) || [...jobs.values()].some(j => j.status === 'running' && (j.nodes || [j.node]).includes(id))) continue;
      if (!(await answersNow(nodeById(id)))) continue;
      if (s.halted || !s.selfHeal || brainSparks().includes(id) || !switchablePlug(id)) {
        // (nothing is started now: what was parked there is unparked, so it shows as held, with Bring back, never parked
        // for good on a Spark that is on)
        idleSince.delete(id);
        // (read fresh: another Spark taken back earlier in this round is no longer off)
        const keys = desired().running.filter(x => x.parked && (x.sparks || [x.spark]).includes(id) && !(x.sparks || [x.spark]).some(y => y !== id && consoleOff(y))).map(keyOf);
        try { parkDesired(keys, false); } catch (e) { console.error(`Unparking what was on ${id}: ${e.message}`); continue; }
        offRecord(id, null);
        fleetEvent({ type: 'spark-powered-on', spark: id, why: POWER_WHY.outside });
        continue;
      }
      await runAction('power_on', healOwner(), { spark: id }, { actor: 'Spark Console', via: 'watcher', canChange: true, trusted: true, powerWhy: 'outside', request: `${sparkWord(id)} is on again` })
        .catch(e => console.error(`Bringing back what was parked on ${id}: ${e.message}`));
    }
    await unparkStranded().catch(e => console.error(`Unparking what was left parked: ${e.message}`));
    const validating =[...jobs.values()].some(j => j.status === 'running' && (j.type === 'validate-workflows' || j.validating));
    // Nothing is parked unless what wakes it can run: a call or a start goes through these workflows, and one that isn't
    // validated yet (after an install, say) would leave a parked model unable to come back on its call.
    const wakeable = !wakeWaiting().length;
    if (!st.idleMinutes || s.halted || validating || !wakeable) { idleSince.clear(); return; }
    const now = Date.now(), idleMs = st.idleMinutes * IDLE_MINUTE_MS;
    const can = NODES.map(x => x.id).filter(id => !brainSparks().includes(id) && switchablePlug(id));
    if (!st.activeSaidAt && can.length) sayIdleActive(st, can);
    const candidates = can.filter(id => !st.off[id]);
    for (const id of candidates) {
      if (busyReason(id)) { idleSince.delete(id); serveCount.delete(id); continue; }
      const seen = await serveUsed(id).catch(() => ({ used: false, measured: false }));
      // (its model server counted requests since the last round: use, as a call through Spark Console is)
      if (seen.used) sparkCalls.set(id, Date.now());
      // (a model of Spark Console's answers there and its use can't be measured: never idle)
      if (!seen.measured && servesHere(id)) { serveUnseen.set(id, Date.now()); idleSince.delete(id); continue; }
      serveUnseen.delete(id);
      if (!idleSince.has(id)) idleSince.set(id, now);
    }
    // Sparks that go together: those a model across two runs on (from what the watcher saw).
    const groups = [];
    for (const id of candidates.filter(x => idleSince.has(x))) {
      if (groups.some(g => g.includes(id))) continue;
      const g = new Set([id]);
      for (let grew = true; grew;) {
        grew = false;
        for (const w of Object.values(knowledge.workloads)) {
          const c = w.running && w.labels?.['spark.cluster'] ? String(w.labels['spark.cluster']).split('+') : null;
          if (c && c.some(x => g.has(x)) && c.some(x => !g.has(x))) { c.forEach(x => g.add(x)); grew = true; }
        }
      }
      groups.push([...g]);
    }
    for (const g of groups) {
      if (!g.every(id => idleSince.has(id))) continue;
      const since = Math.max(...g.map(id => Math.max(idleSince.get(id), lastUseOn(id))));
      if (now - since < idleMs) continue;
      for (const id of g) idleSince.delete(id);
      const out = await runAction('power_off', healOwner(), g.length > 1 ? { sparks: g } : { spark: g[0] },
        { actor: 'Idle power-off', via: 'watcher', canChange: true, trusted: true, powerWhy: 'idle', request: `${sparksWords(g)} ${g.length > 1 ? 'were' : 'was'} idle for ${st.idleMinutes} minute${st.idleMinutes === 1 ? '' : 's'}` })
        .catch(e => { console.error(`Idle power-off of ${g.join('+')}: ${e.message}`); return null; });
      if (out && !out.operation) console.error(`Idle power-off of ${g.join('+')}: ${out.note || out.question || out.outcome}`);
    }
  } catch (e) { console.error(`The idle power-off: ${e.message}`); } finally { powerTicking = false; }
}
setTimeout(() => { powerTick(); setInterval(powerTick, POWER_TICK_MS).unref?.(); }, POWER_FIRST_MS).unref?.();

/* ───────── the power calls the next phase builds on (design-2026-11-13, d-fleet-workloads 2.6) ───────── */
// power.state, power.wake, power.wallW, power.wallWh; sparkNeeded (above) with keepAwake and doneWith. Nothing here runs
// by itself, and no timer calls wake: it is for code acting on someone's request, with a why from WAKE_WHY.

// Kept awake by code that needs a Spark for a while (a pipeline, a compare, the self-test): in memory only, so a restart
// drops them, as it drops the runs that asked. sparkNeeded counts them, so neither the idle power-off nor an asked
// power_off turns that Spark off.
const keepAwakes = new Map();   // spark → Map(why → since)
function keepAwake(id, why) {
  if (!nodeById(id)) throw new HttpError(404, `There is no Spark called ${id}.`);
  const w = String(why || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  if (!w) throw new HttpError(400, 'keepAwake needs a reason.');
  if (!keepAwakes.has(id)) keepAwakes.set(id, new Map());
  keepAwakes.get(id).set(w, Date.now());
}
// Drops the keep-awake given with why (every one on that Spark without a why). Says what it was woken for, when wake
// woke it, and what still keeps it on: an empty stillNeededFor means it may sleep (the idle power-off decides when).
const wokeFor = new Map();      // spark → the WAKE_WHY key wake woke it for
function doneWith(id, why = null) {
  const k = keepAwakes.get(id);
  if (k) { if (why === null) k.clear(); else k.delete(String(why).replace(/\s+/g, ' ').trim().slice(0, 120)); if (!k.size) keepAwakes.delete(id); }
  const woken = wokeFor.get(id);
  if (!keepAwakes.has(id)) wokeFor.delete(id);
  return { wokenFor: woken ? WAKE_WHY[woken] : null, stillNeededFor: sparkNeeded(id) };
}

// on, off (Spark Console powered it off, or its plug shows it shut down), waking (a power-on runs), or unknown: no plug
// is paired, so it behaves as before plugs (on when it answers).
function sparkPowerState(id) {
  if (!nodeById(id)) return 'unknown';
  if ([...jobs.values()].some(j => j.status === 'running' && j.type === 'power-on' && (j.nodes || [j.node]).includes(id))) return 'waking';
  if (consoleOff(id)) return 'off';
  const w = wallFor(id);
  if (!w) return 'unknown';
  if (statusCache?.value.nodes.find(x => x.id === id)?.state === 'online') return 'on';
  if (w.answering && (w.on === false || (typeof w.watts === 'number' && w.watts < SHUT_DOWN_WATTS))) return 'off';
  return 'unknown';
}

// Why a Spark may be woken: one closed list. Anything else is refused.
const WAKE_WHY = { owner: 'the owner asked', task: 'a task needs it', workflow: 'a workflow run needs it', call: 'a call to its model address', selftest: 'the self-test' };
// Turns a Spark on through power_on (its job, claim and audit; what was parked there comes back too) and returns once it
// answers over SSH, Docker there answers, and the settle time (HEAL_SETTLE_MS, as healing waits) has passed since it
// came back. Never the hub. One with no plug that answers is simply on; one with no plug that doesn't is refused.
async function wakeSpark(id, why, viewer = healOwner()) {
  if (!Object.hasOwn(WAKE_WHY, why)) throw new HttpError(400, `power.wake: why must be one of ${Object.keys(WAKE_WHY).join(', ')}.`);
  const node = nodeById(id);
  if (!node) throw new HttpError(404, `There is no Spark called ${id}.`);
  if (brainSparks().includes(id) || node.host === 'local') throw new HttpError(403, `${sparkWord(id)} runs Spark Console and Sparkie: it is always on and never switched.`);
  let woke = false;
  if (!switchablePlug(id)) {
    if (!(await answersNow(node))) throw new HttpError(409, `${sparkWord(id)} isn’t answering and has no smart plug Spark Console may switch, so it can’t be woken from here.`);
  } else {
    const out = await runAction('power_on', viewer, { spark: id }, { actor: 'Spark Console', via: 'wake', canChange: true, trusted: true, powerWhy: WAKE_WHY[why], request: `${sparkWord(id)}: ${WAKE_WHY[why]}` });
    if (out.operation) {
      woke = out.outcome === 'started';
      const j = await waitJob(out.operation, POWER_ON_WAIT_MS + 30 * 60000);
      if (j?.status !== 'completed') throw new HttpError(409, `${sparkWord(id)} wasn’t woken: ${j?.error || 'its power-on didn’t finish'}.`);
    }
  }
  const since = Math.max(0, cameBack(id)?.on || 0, ...events.filter(e => e.spark === id && e.type === 'spark-powered-on').map(e => Date.parse(e.at) || 0));
  if (since && Date.now() - since < HEAL_SETTLE_MS) await sleep(since + HEAL_SETTLE_MS - Date.now());
  if (!(await answersNow(node))) throw new HttpError(409, `${sparkWord(id)} stopped answering after it was woken.`);
  const inv = await inventory(null);
  if (!inv.sparks.find(x => x.id === id)?.dockerOk) throw new HttpError(409, `${sparkWord(id)} answers, but its Docker doesn’t yet.`);
  if (woke) wokeFor.set(id, why);
  return { state: 'on', woke };
}

// What the whole Spark draws at the wall now, in watts; null without a plug or a current reading.
const wallWattsNow = id => { const w = wallFor(id); return w?.answering && typeof w.watts === 'number' ? w.watts : null; };
// Energy at the wall since the plug was first read, in watt-hours; only rises. null without a plug.
function wallWhNow(id) {
  // ── The plug's own energy counter goes HERE once someone has read the live controller and seen that the P110M gives
  // Matter's Electrical Energy Measurement (cluster 145, CumulativeEnergyImported): return { wh, source: 'plug' } from
  // it. Not guessed until then. ──
  const e = (energy || readJson(ENERGY_FILE))?.nodes?.[id];
  if (!e?.wallSince) return null;
  return { wh: Math.round((e.wallKWh || 0) * 10000) / 10, source: 'estimate', since: e.wallSince };
}
const power = Object.freeze({ state: sparkPowerState, wake: wakeSpark, wallW: wallWattsNow, wallWh: wallWhNow });

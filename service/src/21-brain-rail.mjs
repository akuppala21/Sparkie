/* ───────── the rail: a change runs at once only while Sparkie's brain is checked (the one page, milestone 5; P-4) ───────── */
// Area: features        Rules: R51, R47        Tests: brain-rail.test.mjs
// Owns: eval-seal.json (writers: evalSealKey; beside secrets.json, outside the state folder)
// Timers: none        Wakes: none
// One brain check with two outcomes (design E 2.3, cut by the one page). Checked: the chat goes to Sparkie's own model,
// the brain check on record for this exact brain passed, and the eval on record for it, for what this build's brain
// reads and on this build's case set, is a full run that met the bar. Then a change the owner's words clearly ask for
// runs at once, as before. Otherwise every change Sparkie asks for is one button, the same as an unclear one: the check
// is in runAction (16-actions.mjs), under every way in (the page, Telegram, the agent door), and a lookup never meets it.
// Unknown is "ask": no lock for this build, a lock that names no case set, a profile that can't be read, a brain
// changing, what it runs not seen. Nothing here undoes a switch or changes a brain.
// What the brain is, for its key (brainKey, 21-brain-check.mjs): beside the setup's model, engine, image, flags and how
// it is asked, the console's own limits for it (tool rounds, changes a message, the tool cap) and its name, and what
// runs now: the image the container runs (docker's own id) and the weights' snapshots, looked at on its Spark
// (brainRanLook) before a check, a store, sparkie_setup and the rail. A record of another key is another brain's.
// A record counts only as the rail recounts it from the record itself, every time: well-shaped, sealed by this console
// (an HMAC over the record and its profile's key, with a key kept beside the secrets file, never in the state folder
// or a copy of it), the main case set (test/eval/cases.json) with every memory addition on, the same case ids and expects
// as the lock's, no cap, the brain's own key. The newest full one decides; a partial run neither gives nor takes.
const EVAL_MAIN_SET = 'test/eval/cases.json';
const EVAL_SEAL_FILE = ALL_LOCAL ? (SECRETS_FILE ? `${SECRETS_FILE.slice(0, SECRETS_FILE.lastIndexOf('/'))}/eval-seal.json` : null) : `${homedir()}/.config/spark-console/eval-seal.json`;

// What Sparkie's model runs now: the image id of its container and the snapshot of its weights (and its draft's). The
// last look is kept (brainRanOf reads it for the key); every caller that decides something looks again first.
let brainRan = null;
async function brainRanLook() {
  const m = MAIN, node = m ? mainNode(m) : null;
  if (!m) return null;
  let seen = { id: m.id, image: null, model: null, draft: null };
  if (node) {
    try {
      const r = await run(node, `${mainSnapshots(m)}\nprintf 'ran\\t%s\\t%s\\t%s\\n' "$(docker inspect -f '{{.Image}}' ${q(m.container)} 2>/dev/null | head -1)" "$model" "$draft"`, { timeout: 20000 });
      const [image, model, draft] = fields(r.out, 'ran')[0] || [];
      seen = { ...seen, image: /^sha256:[0-9a-f]{1,64}$/.test(image || '') ? image : null, model: model || null, draft: draft || null };
    } catch {}
  }
  if (MAIN === m) brainRan = seen;
  return seen;
}
const brainRanOf = m => (brainRan && brainRan.id === m?.id && brainRan.image && brainRan.model ? { image: brainRan.image, model: brainRan.model, draft: brainRan.draft } : null);
// The console's own limits for this brain: what turnBudgets and toolCap give its chats.
const brainLimits = m => { const b = turnBudgets({ tuned: m }); return { toolRounds: b.ROUNDS, maxChanges: b.CHANGES, toolCap: String(toolCap(m)) }; };
// The setup's key without what runs now: the eval's runner compares it with its own stand-in console's (test/eval.mjs).
const brainSetupKey = m => { const { ran, ...declared } = brainSetupOf(m); return createHash('sha256').update(JSON.stringify(declared)).digest('hex').slice(0, 16); };

// The case set this build was tested with: the lock's evalSet (test/lock.mjs), when the lock is this build's. null when
// that isn't known.
function evalSetLocked() {
  const s = WORKFLOW_LOCK?.build === BUILD ? WORKFLOW_LOCK.evalSet : null;
  if (!s || !/^[0-9a-f]{64}$/.test(String(s.version)) || !Array.isArray(s.cases) || !s.cases.length || s.cases.length > 500) return null;
  if (!s.cases.every(c => Array.isArray(c) && /^[a-z0-9][a-z0-9-]{0,79}$/.test(String(c[0])) && EVAL_EXPECT.includes(c[1]))) return null;
  return { version: s.version, cases: s.cases.map(([id, expect]) => [id, expect]) };
}
// Today's case set as sparkie_setup and the store name it: the lock's, else the file beside this build (evalSetNow).
const evalSetToday = () => { const l = evalSetLocked(); return l ? { version: l.version, cases: l.cases.length } : evalSetNow(); };

// The seal's key: made once, beside secrets.json (0600, its folder 0700); a file there that holds no key is never
// written over (nothing is sealed then, so nothing counts). null without a secrets folder (a test that names none).
let evalSealKeyKept = null;
function evalSealKey(make = false) {
  if (evalSealKeyKept || !EVAL_SEAL_FILE) return evalSealKeyKept;
  try {
    const k = JSON.parse(readFileSync(EVAL_SEAL_FILE, 'utf8'))?.key;
    return /^[0-9a-f]{64}$/.test(String(k)) ? (evalSealKeyKept = k) : null;
  } catch (e) { if (e.code !== 'ENOENT' || !make) return null; }
  try {
    mkdirSync(EVAL_SEAL_FILE.slice(0, EVAL_SEAL_FILE.lastIndexOf('/')), { recursive: true, mode: 0o700 });
    const k = randomBytes(32).toString('hex');
    writeFileSync(EVAL_SEAL_FILE, `${JSON.stringify({ key: k })}\n`, { mode: 0o600, flag: 'wx' });
    return (evalSealKeyKept = k);
  } catch { return evalSealKey(false); }
}
const evalSealOf = (key, profileKey, rec) => createHmac('sha256', key).update(JSON.stringify([profileKey, rec])).digest('hex');
function evalSealed(profileKey, x) {
  const key = evalSealKey(), { seal, ...rec } = x || {};
  if (!key || !/^[0-9a-f]{64}$/.test(String(seal))) return false;
  return timingSafeEqual(Buffer.from(seal, 'hex'), Buffer.from(evalSealOf(key, profileKey, rec), 'hex'));
}

// A record of the main case set with every memory addition on: the only kind that can count (and the only kind kept in
// a slot's five that count).
const evalMainSet = x => x?.setFile === EVAL_MAIN_SET && Array.isArray(x?.memorySwitches?.off) && !x.memorySwitches.off.length;
// What could let Sparkie change things without asking once stored: a full run of the main set, with no cap, that met
// the bar (counted here from the runs). Storing one needs the owner's passkey (needsPasskey, 22-passkey.mjs).
const evalCouldUnlock = r => !evalRecordProblem(r) && r.cap === null && evalMainSet(r) && evalScore(r).met === true;
// Whether a stored record counts for the brain with this profile key, this build's mark and case set.
function evalCounts(x, key, reads, set) {
  if (!x || typeof x !== 'object' || evalRecordProblem(x) || x.cap !== null || !evalMainSet(x)) return false;
  if (x.brain.standIn !== ALL_LOCAL || x.brain.key !== key || x.reads !== reads || x.set !== set.version || x.setCases !== set.cases.length) return false;
  const want = new Map(set.cases);
  return x.cases.every(c => want.get(c.id) === c.expect) && evalSealed(key, x);
}

// The rail. { checked, why }: why it runs at once, or why it asks. Never throws.
async function brainRail() {
  const no = why => ({ checked: false, why });
  try {
    if (!MAIN) return no('Sparkie has no model set up');
    // (what it runs is looked at first, every time: sparkie_setup's brainCheck reads the same look)
    const ran = await brainRanLook();
    if (chatTarget()?.kind !== 'main') return no('Sparkie’s chat is routed to another model, which no eval has checked');
    if (mainBusy()) return no('Sparkie’s model is starting, stopping or changing');
    const reads = brainReadsNow(), set = evalSetLocked();
    if (!reads) return no('there is no lock for this build, so what its brain reads isn’t known');
    if (!set) return no('this build’s lock doesn’t name the eval’s case set');
    if (!ran?.image || !ran.model) return no('what Sparkie’s model runs (its image and weights) couldn’t be seen');
    if (chatTarget()?.kind !== 'main' || mainBusy() || MAIN.id !== ran.id) return no('Sparkie’s model changed while it was looked at');
    const p = brainProfileOf(MAIN);
    if (!p) return no('no brain check is on record for this exact setup (model, engine, image, flags, limits, what it runs)');
    if (p.outcome !== 'checked') return no('the brain check on record says not checked');
    const slot = p.evals?.[`${reads}:${set.version}`], kept = Array.isArray(slot) ? slot : [];
    const counted = kept.filter(x => evalCounts(x, p.key, reads, set)).sort((a, b) => String(b.at).localeCompare(String(a.at)));
    const full = counted.find(x => evalScore(x).full), day = full ? String(full.at).slice(0, 10) : '';
    if (!full) return no(!kept.length ? 'the eval has not been run for this build' : counted.length ? 'only a partial run of the eval is on record for this build' : 'no eval result on record counts for this brain and build');
    if (!evalScore(full).met) return no(`the newest full run of the eval on record for this build (${day}) didn’t meet the bar`);
    return { checked: true, why: `the brain check passed, and the eval on record for this build (${day}) ran in full and met the bar` };
  } catch (e) { return no(`its record couldn’t be read (${String(e?.message || e).slice(0, 160)})`); }
}
// sparkie_setup's one line about changes.
async function railWords() {
  const r = await brainRail();
  return r.checked ? `Sparkie makes a change your words clearly ask for at once: ${r.why}.` : `Sparkie asks before every change, one button each: ${r.why}.`;
}

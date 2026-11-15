/* ───────── lessons: what failed, written by code when an operation ends (B2, R48) ───────── */
// Area: record        Rules: R7, R20, R22, R48        Tests: lessons.test.mjs
// Owns: lessons.json (writers: recordLesson)
// Timers: none        Wakes: none
// A lesson is Spark Console's own short record of a failure (contract 5.10; design B 2.2 as cut): what was tried, on
// what, and the known way it failed. Code writes it when an operation ends (learnFrom, at runJob's end), from the
// console's own typed facts on the job, never from a log's, the brain's or the owner's words: every value is one of the
// console's names that its pattern allows and no mask would change, a hash, an id from a fixed list, a number or a time,
// else null. A start: the model, its engine and how many Sparks; the setup it tried (setupTried, which the start puts on
// the job before its first attempt); the START_FAILURES id its error matched, or unknown. An app (keep_running starting a
// container): its container and image, the Spark, and one of three ways its start gives up (APP_FAILURES); any other
// failure of an app leaves none. The same failure of the same setup again adds to its count: two or more of the same
// known failure with no success between make it proven, while an unknown one stays seen. A later success of the same
// setup takes its lessons out (the journal keeps what happened). No fix: a start that worked after a fix is replayed by
// its proven run (verified.json). Nothing reads lessons to change what a start does yet: passing over a setup that
// failed twice is B3, cards for the brain B4.
const LESSONS_FILE = `${STATE_DIR}/lessons.json`;
// (a cap, never reached in use: the newest are kept)
const LESSONS_MAX = 500;
// How an app's start gave up, from the opening words 21-apps.mjs itself writes where it gives up: a name, then fixed
// words. What follows them (Docker's words, the app's own log) is never read.
const APP_FAILURES = [
  ['image', /^Image download failed: /],
  ['docker', /^Docker couldn’t (?:start|restart) it: /],
  ['stopped-at-once', /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127} stopped right after starting\.(?:\n|$)/],
];
// The names a lesson may hold: a model as the library names it (or org/repo), a container, an image (keep_running's own
// pattern), how a setup was chosen, a 12-hex fingerprint or version, a journal id.
const L_MODEL = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}(?:\/[A-Za-z0-9][A-Za-z0-9._-]{0,119})?$/;
const L_CONTAINER = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const L_IMAGE = /^[a-z0-9][a-z0-9._/-]{0,200}(?::[A-Za-z0-9_][A-Za-z0-9._-]{0,127})?(?:@sha256:[a-f0-9]{64})?$/;
const L_HOW = /^(?:setup:[a-z0-9]{4,32}|proven|own)$/;
const L_HEX12 = /^[0-9a-f]{12}$/;
const L_JOURNAL = /^j_[0-9a-f]{12}$/;
// One of the console's own values, or null: a string its pattern allows that no mask changes (a key-shaped name is no
// name). Anything else (words with spaces, a crafted name, a key) is stored as null.
const lValue = (v, re) => (typeof v === 'string' && re.test(v) && maskSecrets(v) === v ? v : null);
// The Sparks, in order, joined by "+": each one on the list, else null.
const lSparks = ids => {
  const list = String(ids || '').split('+');
  return list.every(id => /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/.test(id) && nodeById(id)) ? list.join('+') : null;
};

// The setup a start tries, as its lesson keeps it (B 2.2's subject and tried): the model's name in the library, its
// engine; how the setup was chosen (setup:<id>, a recipe setup, or a run that worked here kept with its setup's id;
// proven, another run that worked here; own, the model's own spark.json or the engine's defaults); a fingerprint of its
// flags and the names of its environment values (never their values); its image as named; the Sparks it starts on, in
// order. startWithFixes puts it on the job before the first attempt, and B3 works it out the same way for the next
// start. It is checked again when a lesson is written (lessonOf). Never throws.
function setupTried(m, how, placed) {
  try {
    const known = Boolean(m) && 'manifest' in m, model = how ? withHow(known ? m : { name: m?.name }, how) : known ? m : null;
    const man = model?.manifest || {}, env = how ? how.env || {} : { ...(man.env || {}), ...(man.cluster?.env || {}) };
    const flags = model ? createHash('sha256').update(JSON.stringify([(Array.isArray(man.args) ? man.args : []).map(String), Object.keys(env).sort()])).digest('hex').slice(0, 12) : null;
    return { model: m?.name ?? null, engine: model ? engineOf(model) : null, how: how ? (how.setupId ? `setup:${how.setupId}` : 'proven') : 'own',
      flags, image: model ? imageOf(model) : null, on: (placed?.nodes || []).join('+') || null };
  } catch { return null; }
}

// What an operation's end gives a lesson, from typed facts on the job only, or null when it gives none: { kind, subject,
// tried, failure } (failure null when it ended well).
function lessonOf(job) {
  const failed = job.status === 'failed';
  if (job.app) {
    if (!['deploy', 'restart'].includes(job.type)) return null;
    const failure = failed ? APP_FAILURES.find(([, re]) => re.test(String(job.error || '')))?.[0] || null : null;
    if (failed && !failure) return null;
    const image = lValue(job.image, L_IMAGE);
    return { kind: 'app', subject: { container: lValue(job.container, L_CONTAINER), image }, tried: { how: null, flags: null, image, on: lSparks(job.node), code: null }, failure };
  }
  const t = job.setupTried;
  if (!START_JOBS.has(job.type) || !t) return null;
  const on = lSparks(t.on);
  return { kind: 'start', subject: { model: lValue(t.model, L_MODEL), engine: Object.hasOwn(ENGINES, String(t.engine)) ? t.engine : null, sparks: on ? on.split('+').length : null },
    tried: { how: lValue(t.how, L_HOW), flags: lValue(t.flags, L_HEX12), image: lValue(t.image, L_IMAGE), on, code: lValue(job.workflowVersion, L_HEX12) },
    failure: failed ? knownStartFailure(job.error)?.id || 'unknown' : null };
}

// Every lesson, read strictly: a file that can't be read just now throws (readKept), so no save goes over it (R20).
const lessonsKept = () => { const f = readKept(LESSONS_FILE); return Array.isArray(f?.lessons) ? f.lessons.filter(x => x && typeof x === 'object') : []; };
// The one writer of lessons.json (R22), read and written with nothing between (R20). A failure adds a lesson, or counts
// again on the one for the same setup and failure: while what the setup was true of (its image, its Sparks, its start
// code) is unchanged, else it is written anew with failed: 1. A success takes out the lessons of the same setup: for a
// start, the same model, engine and number of Sparks with the same flags, image and Sparks; for an app, its container on
// that Spark. evidence: the journal's record of this operation.
function recordLesson(l, ok, evidence) {
  const all = lessonsKept(), same = x => x.kind === l.kind && JSON.stringify(x.subject) === JSON.stringify(l.subject);
  if (ok) {
    const worked = l.kind === 'app' ? x => x.kind === 'app' && x.subject?.container === l.subject.container && x.tried?.on === l.tried.on
      : x => same(x) && ['flags', 'image', 'on'].every(k => x.tried?.[k] === l.tried[k]);
    const left = all.filter(x => !worked(x));
    if (left.length < all.length) writePrivate(LESSONS_FILE, { lessons: left });
    return;
  }
  const now = new Date().toISOString(), ev = lValue(evidence, L_JOURNAL);
  const i = all.findIndex(x => same(x) && x.tried?.how === l.tried.how && x.tried?.flags === l.tried.flags && x.failure === l.failure), old = all[i];
  const again = Boolean(old) && ['image', 'on', 'code'].every(k => old.tried?.[k] === l.tried[k]), failed = again ? (Number(old.failed) || 0) + 1 : 1;
  const lesson = { id: /^l_[0-9a-f]{8}$/.test(old?.id) ? old.id : `l_${randomBytes(4).toString('hex')}`, kind: l.kind, subject: l.subject, tried: l.tried,
    failure: l.failure, state: failed >= 2 && l.failure !== 'unknown' ? 'proven' : 'seen', failed,
    evidence: [...(again && Array.isArray(old.evidence) ? old.evidence : []), ...(ev ? [ev] : [])].slice(-3), firstAt: again ? old.firstAt : now, lastAt: now };
  const next = i >= 0 ? all.map((x, n) => (n === i ? lesson : x)) : [...all, lesson];
  writePrivate(LESSONS_FILE, { lessons: next.sort((a, b) => String(b.lastAt).localeCompare(String(a.lastAt))).slice(0, LESSONS_MAX) });
}
// At an operation's end (runJob, after the journal's record of it, whose id is the evidence): the lesson its failure
// gives, or the lessons its success takes out. A cancelled one gives and takes nothing. Never throws.
function learnFrom(job, evidence) {
  try {
    if (job.status !== 'failed' && job.status !== 'completed') return;
    const l = lessonOf(job);
    if (l) recordLesson(l, job.status === 'completed', evidence);
  } catch (e) { console.error(`Couldn’t keep the lesson of operation ${job?.id}: ${e.message}`); }
}

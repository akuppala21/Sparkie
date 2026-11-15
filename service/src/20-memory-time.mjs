/* ───────── memory's lines in time: an end date, a fact said again, the other lines about the same thing ───────── */
// Area: record        Rules: R45        Tests: memory-time.test.mjs
// Owns: none        Timers: none        Wakes: none
// Design G's third addition (A3, step 4). The brain eval switches it off with `time` in SPARK_CONSOLE_MEMORY_OFF
// (test/eval.mjs): then memory is as the build before this one kept it, and an `until` given to remember is not kept.
// - `until`: the last day a line is true (YYYY-MM-DD, Spark 2's own day). After it the line is in no prompt and no
//   pick; `memory {past: true}` shows it as past (why "expired"), and the next save of memory moves it to
//   memory-past.json. It is never deleted. A day already gone when the line is saved is refused. Sparkie keeps a line
//   with an end at once only when the owner's words hold a time word ("until Friday"); else it is a button.
// - A fact said again: a new line about the same names as a live line, with that line's numbers and at least 0.8 of its
//   own words (common words left out), takes that line's place, and the result says which ("instead of"). An agent's
//   line never takes an owner's line's place: it joins it, and nothing new is kept.
// - The other live lines about the same names come back on the result (two at most, newest first), so the brain and
//   the owner see at once a line the new one may make untrue ("I also have: … Still true?").
const NEAR_SHARE = 0.8, ALSO_MAX = 2;
// Whether one of the additions of design G 3 is switched off for this run (the brain eval's switches, test/eval.mjs).
const memoryOffFor = name => String(process.env.SPARK_CONSOLE_MEMORY_OFF || '').split(',').map(s => s.trim()).includes(name);
// Spark 2's own day, YYYY-MM-DD.
const memoryDay = (t = new Date()) => new Date(t.getTime() - t.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
// Whether a line is past its last day; a line that is not, is live. (One argument only: it is passed to filter.)
const memoryEnded = e => typeof e?.until === 'string' && e.until < memoryDay() && !memoryOffFor('time');
const memoryLive = e => !memoryEnded(e);
// A line past its day, as memory's history keeps it: gone at the start of the next day, by Spark Console.
function memoryExpired(e) {
  const at = new Date(`${e.until}T00:00:00`);
  at.setDate(at.getDate() + 1);
  return { ...e, gone: { at: Number.isNaN(at.getTime()) ? new Date().toISOString() : at.toISOString(), why: 'expired', who: 'Spark Console' } };
}
// At a save: the lines past their day leave the live list for the past file (saveMemory).
const memoryExpire = (entries, gone) => (entries.some(memoryEnded) ? [entries.filter(memoryLive), [...gone, ...entries.filter(memoryEnded).map(memoryExpired)]] : [entries, gone]);
// `until` as remember takes it: a real day, from today on. null when none was given, or with `time` off.
function memoryUntil(until) {
  if (until === undefined || until === null || memoryOffFor('time')) return null;
  const d = new Date(`${until}T00:00:00Z`), today = memoryDay();
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== until) throw new HttpError(400, `until isn’t a real day: ${until}. Give the last day it is true, as YYYY-MM-DD.`);
  if (until < today) throw new HttpError(400, `That end (${until}) has already passed: today is ${today}. Nothing was kept. Say it again with no end, or with a day from today on.`);
  return until;
}
// The owner's words name a time, so a line with an end may be kept from them without a button (memoryClear).
const TIME_WORDS = /\b(?:until|till|til|through|thru|today|tonight|tomorrow|weekend|(?:this|next|coming)\s+(?:week|month|year)|end\s+of|(?:mon|tues|wednes|thurs|fri|satur|sun)days?|january|february|march|april|june|july|august|september|october|november|december|(?:jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\.?|for\s+(?:the\s+)?(?:next\s+)?(?:a|an|one|two|three|four|five|six|seven|\d+)\s+(?:days?|weeks?|months?)|\d{4}-\d\d-\d\d|\d{1,2}\/\d{1,2})\b/i;

// Words that say nothing about what a line is about: left out when two lines are compared. So are memoryClear's.
const COMMON_WORDS = new Set(('a an the is are was were be been being am on in at of to for from with by about into onto over under up down out off ' +
  'and or but nor so if then than as it its this that these those there here i me my mine we us our you your yours he him his she her ' +
  'they them their do does did done doing has have had having not no never don doesn didn isn aren wasn won cannot will would should could ' +
  'can may might must shall now just only also still too very really all any some each every more most what which who whom whose when ' +
  'where why how one ones thing things').split(' '));
// A line's own words, to compare: lower case, a Spark said by number one word, no web address, no common word. Numbers stay.
const lineWords = text => new Set(nameWords(text).filter(w => !COMMON_WORDS.has(w) && !MEMORY_FILLER.has(w) && (w.length > 1 || /\d/.test(w))));
const sameNames = (a, b) => [...new Set(a || [])].sort().join(' ') === [...new Set(b || [])].sort().join(' ');
// The live line a new one says again, if any: about the same names, holding that line's numbers, and at least 0.8 of
// its own words. The closest, the newest of equals. None with `time` off.
function memorySaidAgain(text, about, lines) {
  if (memoryOffFor('time')) return null;
  const mine = lineWords(text);
  let best = null, share = 0;
  for (const e of memoryNamed(lines.filter(memoryLive))) {
    const theirs = [...lineWords(e.text)];
    if (!theirs.length || !sameNames(e.about, about) || theirs.some(w => /\d/.test(w) && !mine.has(w))) continue;
    const s = theirs.filter(w => mine.has(w)).length / theirs.length;
    if (s >= NEAR_SHARE && s >= share) { best = e; share = s; }
  }
  return best;
}
// The other live lines about the names of a line just kept, from the names index: two at most, newest first.
function memoryAlso(entry) {
  if (memoryOffFor('time') || !entry.about?.length) return [];
  try {
    const seen = new Set([entry.id]), out = [];
    for (const n of entry.about) for (const e of memoryLinesAbout(n)) if (!seen.has(e.id) && memoryLive(e)) { seen.add(e.id); out.push(e); }
    return out.sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, ALSO_MAX).map(e => ({ id: e.id, text: e.text, at: e.at, by: e.by }));
  } catch (e) {
    console.error(`The other lines about what a memory line names weren’t read (${e.message}).`);
    return [];
  }
}
// How a kept line is said back: "I’ll remember: …", what it took the place of, its end, and the other lines to check.
function memorySaid(line, { until = null, gone = null, also = [] } = {}) {
  const others = also.map(a => `“${a.text}” (${String(a.at).slice(0, 10)})`).join(' and ');
  return `I’ll remember: ${line}${until ? ` (until ${until})` : ''}${gone ? ` (instead of: ${gone.text})` : ''}${others ? `${/[.!?]$/.test(line) ? '' : '.'} I also have: ${others}. Still true?` : ''}`;
}

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
//   the owner see at once a line the new one may make untrue ("I also have: … Still true?"). Only lines whose words may
//   steer the caller (the owner's, and the caller's own): an agent's line is counted and pointed at (recall gives it,
//   an outside read), never quoted, as remember is a change and its result no read from outside (R26, F2 C1).
const NEAR_SHARE = 0.8, ALSO_MAX = 2;
// Whether one of the additions of design G 3 is switched off for this run: the brain eval's switches (test/eval.mjs),
// on the stand-in fleet only, as the picker's (memoryPicking). Whether a line is past its day is memoryEnded's
// (20-memory-names.mjs: the index holds only the live lines).
const memoryOffFor = name => ALL_LOCAL && String(process.env.SPARK_CONSOLE_MEMORY_OFF || '').split(',').map(s => s.trim()).includes(name);
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
const SAID_AGAIN_SKIP = new Set(('a an the is are was were be been being am on in at of to for from with by about into onto over under up down out off ' +
  'and or but nor so if then than as it its this that these those there here i me my mine we us our you your yours he him his she her ' +
  'they them their do does did done doing has have had having not no never don doesn didn isn aren wasn won cannot will would should could ' +
  'can may might must shall now just only also still too very really all any some each every more most what which who whom whose when ' +
  'where why how one ones thing things').split(' '));
// A line's numbers as written ("0.11.0", "10.0.0.5", "11/12"), a Spark said by number aside: two versions, two addresses
// or two dates are two numbers, never runs of digits that happen to match (review of the memory steps, 2026-11-15).
const LINE_NUMBER = /\d+(?:[.:/-]\d+)*/g;
const lineNumbers = text => String(text).replace(/\bsparks?[\s_-]*\d+(?:\s*(?:,|and|&|\+|or)\s*\d+)*/gi, ' ').match(LINE_NUMBER) || [];
// A line's own words, to compare: lower case, a Spark said by number one word, no web address, no common word; its
// numbers as written.
const lineWords = text => new Set([...nameWords(text).filter(w => !/^\d+$/.test(w) && !SAID_AGAIN_SKIP.has(w) && !MEMORY_FILLER.has(w) && w.length > 1), ...lineNumbers(text)]);
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
// Whether a line's words may go back to whoever wrote `by` (a new line's writer, lineBy): the owner's lines, and the
// writer's own. Anyone else's (an agent's, to the owner's turn) is said by who noted it and its id, never quoted.
const memoryQuoted = (e, by) => e?.by === 'owner' || e?.by === by;
const memoryNoted = e => `the line ${e.by || 'an agent'} noted (${e.id})`;
// The other live lines about the names of a line just kept, from the names index: two at most, newest first, of those
// memoryQuoted lets back; `noted`, the ids of the others (an agent's lines, on the owner's turn), newest first.
function memoryAlso(entry) {
  if (memoryOffFor('time') || !entry.about?.length) return { also: [], noted: [] };
  try {
    const seen = new Set([entry.id]), out = [];
    for (const n of entry.about) for (const e of memoryLinesAbout(n)) if (!seen.has(e.id) && memoryLive(e)) { seen.add(e.id); out.push(e); }
    const newest = out.sort((a, b) => String(b.at).localeCompare(String(a.at)));
    return { also: newest.filter(e => memoryQuoted(e, entry.by)).slice(0, ALSO_MAX).map(e => ({ id: e.id, text: e.text, at: e.at, by: e.by })),
      noted: newest.filter(e => !memoryQuoted(e, entry.by)).map(e => e.id) };
  } catch (e) {
    console.error(`The other lines about what a memory line names weren’t read (${e.message}).`);
    return { also: [], noted: [] };
  }
}
// The count of an agent's lines about it, and where they are (code's words; recall is an outside read): R26, F2 C1.
const memoryNotedWords = ids => (ids.length === 1 ? `1 line an agent noted is about it too, not quoted here (not the owner’s words): recall {"id": "${ids[0]}"} gives it, as text from outside.`
  : ids.length ? `${ids.length} lines an agent noted are about it too, not quoted here (not the owner’s words): recall gives each by its id (${ids.slice(0, 4).join(', ')}${ids.length > 4 ? ', …' : ''}), as text from outside.` : null);
// How a kept line is said back: "I’ll remember: …", what it took the place of, its end, and the other lines to check.
// (`by`: the new line's writer; a line it replaced is quoted only when memoryQuoted lets it back)
function memorySaid(line, { until = null, gone = null, also = [], noted = [], by = 'owner' } = {}) {
  const others = also.map(a => `“${a.text}” (${String(a.at).slice(0, 10)})`).join(' and '), dot = /[.!?]$/.test(line) ? '' : '.';
  const instead = gone ? (memoryQuoted(gone, by) ? ` (instead of: ${gone.text})` : ` (instead of ${memoryNoted(gone)})`) : '';
  return `I’ll remember: ${line}${until ? ` (until ${memoryDayWords(until)})` : ''}${instead}${others ? `${dot} I also have: ${others}. Still true?` : ''}${noted.length ? `${others ? '' : dot} ${memoryNotedWords(noted)}` : ''}`;
}
// A day as the owner reads it at a glance: "Friday 20 November", with the year when it isn't this one.
function memoryDayWords(day) {
  const t = new Date(`${day}T12:00:00`);
  if (Number.isNaN(t.getTime())) return day;
  return t.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', ...(day.slice(0, 4) === memoryDay().slice(0, 4) ? {} : { year: 'numeric' }) }).replace(',', '');
}
// The day as the brain is told it, one line of the turn's record (brainContext), where it decides a line's `until`:
// Spark 2's weekday and date. Never in the system prompt or a tool's text, so what the brain reads is the same from one
// day to the next. None with `time` off. (SPARK_CONSOLE_TODAY: a fixed day, on the stand-in fleet only.)
function memoryTodayLine() {
  if (memoryOffFor('time')) return null;
  const fixed = ALL_LOCAL && /^\d{4}-\d\d-\d\d$/.test(process.env.SPARK_CONSOLE_TODAY || '') ? process.env.SPARK_CONSOLE_TODAY : null;
  const day = fixed || memoryDay(), t = new Date(`${day}T12:00:00`);
  return `Today on Spark 2: ${t.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).replace(',', '')} (${day}).`;
}

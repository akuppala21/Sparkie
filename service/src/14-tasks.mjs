/* ───────── long tasks: the carry-on made to last (E6) ───────── */
// Area: brain        Rules: R50        Tests: tasks.test.mjs, tasks-telegram.test.mjs, carry-keeps.test.mjs
// Owns: none        Timers: none        Wakes: none
// A task is the owner's request that Sparkie carries on with in fresh turns (`conv.task`, kept in chats.json with the
// chat: design E 2.1 as cut, step 6). Its limits are picked by code from the owner's own instruction when it is made,
// and kept on it: an ordinary request with a next step has 2 hours and 8 carry-on turns; one the owner sends off to work
// on its own ("sort it out on your own", "work through it overnight", "while I'm away") has 4 hours and 60 turns; hours
// the owner asks it to work for ("work on this for 6 hours") give those hours, 1 to 72, and 15 turns an hour. Only an
// instruction counts: a clause that opens with a verb of working on it or carrying on, with nothing ruling it out before
// those words; never words about something else ("it crashed overnight"), a question, or text in quotes, backticks or
// after a line ending in ":" (a pasted log). Every task also stops at 120 work steps in all (design A 2.10: the `run`
// calls of all its turns). At any limit no new turn starts. A task keeps the guards of the turns that made it
// (`noStops`, `readOutside`) and where it came from (its channel and which Telegram pairing, the device's session), all
// on disk. A carry-on turn that ends owing nothing (keepTask, 14-chats.mjs) takes its task off the record. After a
// restart each task that was on disk at the start and is owed something carries on as it was: one whose way in is gone
// by then (another Telegram pairing or none, the device's sign-in over) ends instead, a record from before these limits
// is taken off quietly, and one that was waiting on an operation gets one line saying the restart may have cut it off,
// which wakes it as a result would.
const TASK_PLAIN = { hours: CONTINUE_HOURS, turns: CONTINUE_MAX }, TASK_AWAY = { hours: 4, turns: 60 }, TASK_TURNS_AN_HOUR = 15, TASK_HOURS_MAX = 72, TASK_STEPS = 120;
const TASK_WORDS = /\b(?:on\s+your\s+own|by\s+yourself|unattended|overnight|while\s+i(?:'m|\s+am)\s+away|as\s+a\s+task)\b/i;
const TASK_HOURS = /\b(?:for|up\s+to|over\s+the\s+next)\s+(\d{1,4})\s*(?:hours?|hrs?)\b/i;
// An instruction's opening ("please", "could you", "I want you to", …), then a verb of working on it or carrying on.
const TASK_OPENER = /^(?:(?:ok(?:ay)?|so|now|just|also|and|then|please|kindly)[\s,]+)*(?:(?:can|could|would|will)\s+you\s+(?:please\s+)?|i\s+(?:want|need|would\s+like)\s+you\s+to\s+|i'd\s+like\s+you\s+to\s+|go\s+ahead\s+and\s+)?(?:please\s+)?/i;
const TASK_VERB = /^(?:work|keep\s+(?:at|on|going|working|trying|digging|looking)|carry\s+on|continue|go\s+on|do|handle|sort|fix|try|dig|look|investigate|figure|find|research|explore|debug|troubleshoot|deal|take\s+care|finish|tune|test|benchmark|compare|clean|tidy|organi[sz]e|set\s+up|build|train|fine-?tune|check|go\s+through|monitor|watch|measure|analy[sz]e|read|review|study|search|prepare|plan)\b/i;
const TASK_NOT = /\b(?:don'?t|do\s+not|didn'?t|did\s+not|doesn'?t|never|no\s+need\s+to|without|not|avoid|stop\s+yourself\s+from)\b/i;
// The limits the owner's words give a new task, clause by clause (sentences, and the parts "then" and "; " join): only
// a clause that is an instruction counts, and only words in it after its verb with no "not" before them. Text in quotes
// or backticks, a quoted line ("> …") and the sentence after one ending in ":" are no instruction. An agent's request
// gets the ordinary limits.
function taskBudget(text, agent = null) {
  if (agent) return { ...TASK_PLAIN };
  const own = normQuotes(String(text || '').replace(/```[\s\S]*?(?:```|$)/g, '\n').replace(/`[^`\n]*`/g, ' ').replace(/^\s*>.*$/gm, ' ')).replace(/"[^"\n]*"|“[^”\n]*”/g, ' ');
  let away = false, hours = null, before = '';
  for (const raw of own.split(/(?<=[?!\n;:])|\.(?=\s|$)|,?\s+(?:and\s+)?then\s+/i)) {
    const reported = /:\s*$/.test(before);
    before = raw.trim() ? raw : before;
    const clause = raw.trim().replace(TASK_OPENER, '');
    if (reported || !TASK_VERB.test(clause)) continue;
    const ok = m => m && !TASK_NOT.test(clause.slice(0, m.index));
    if (ok(TASK_WORDS.exec(clause))) away = true;
    const h = TASK_HOURS.exec(clause);
    if (ok(h)) hours = Math.min(TASK_HOURS_MAX, Math.max(1, Number(h[1])));
  }
  if (hours) return { hours, turns: hours * TASK_TURNS_AN_HOUR };
  return { ...(away ? TASK_AWAY : TASK_PLAIN) };
}
// A task's limits as kept, bounded again (chats.json can be edited by hand); a task from before them has the ordinary.
const taskLimits = t => ({
  hours: Number.isInteger(t?.hours) ? Math.min(TASK_HOURS_MAX, Math.max(1, t.hours)) : TASK_PLAIN.hours,
  turns: Number.isInteger(t?.turns) ? Math.min(TASK_HOURS_MAX * TASK_TURNS_AN_HOUR, Math.max(1, t.turns)) : TASK_PLAIN.turns,
});
// Which limit a task has reached, or null: its carry-on turns, its hours from the request, its work steps in all.
function taskOver(t, now = Date.now()) {
  const { hours, turns } = taskLimits(t);
  if ((Number(t?.continuations) || 0) >= turns) return 'turns';
  if (!(now - Date.parse(t?.at) <= hours * 3600000)) return 'hours';
  if ((Number(t?.steps) || 0) >= TASK_STEPS) return 'steps';
  return null;
}
// Which Telegram pairing a task came from, kept on it without the chat's ids (they stay in the secrets file): a new
// pairing, or a new bot token, is another way in.
const tgPairingMark = (b = tgPaired()) => (b ? createHash('sha256').update(`${b.chatId}:${b.userId}:${b.pairedAt || ''}`).digest('hex').slice(0, 16) : null);
// The way in a task came by is gone: its Telegram pairing is no longer the paired chat, or its device's sign-in is over.
const taskGone = t => (t.channel === 'telegram' && (!t.tg || t.tg !== tgPairingMark())) || Boolean(t.session && !sessionList().some(s => s.id === t.session && !sessionOver(s)));
// The tasks on disk when this console started: the look below takes only these (one made since is no survivor).
const TASKS_AT_START = (() => { try { return new Set(chatData().conversations.map(c => c.task).filter(Boolean)); } catch { return new Set(); } })();
// After a restart, once the chats and the start-up notices are in: each task that was on disk carries on where it was.
function tasksAfterRestart() {
  try {
    let changed = false;
    for (const conv of chatData().conversations) {
      const t = conv.task;
      if (!t || !TASKS_AT_START.has(t)) continue;
      // (a record from before these limits: a request that may long be done, taken off with no word)
      if (!Number.isInteger(t.hours)) { conv.task = null; changed = true; continue; }
      if (taskGone(t)) { endTask(conv, false); changed = true; continue; }
      if (!t.carry && !resultSince(conv)) {
        conv.messages.push({ role: 'assistant', content: 'Spark Console restarted while this request was being carried on. What it had started may have been cut off by the restart: look again before going on.',
          createdAt: new Date().toISOString(), notice: true, operation: 'restart' });
        changed = true;
      }
      wakeWork(conv.id);
    }
    TASKS_AT_START.clear();
    if (changed) saveChats();
  } catch (e) { console.error(`Carrying tasks on after the restart: ${e.message}`); }
}
// (a few seconds after start: the journal's and the watcher's start-up notices go first)
setTimeout(tasksAfterRestart, Number(process.env.SPARK_CONSOLE_TASKS_AFTER_MS || 5000)).unref?.();

/* ───────── long tasks: the carry-on made to last (E6) ───────── */
// Area: brain        Rules: R66        Tests: tasks.test.mjs, tasks-telegram.test.mjs, tasks-more.test.mjs, tasks-wake.test.mjs, carry-keeps.test.mjs
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
// (a task's 120 commands, TASK_STEPS, are E5b's: 14-rounds.mjs)
const TASK_PLAIN = { hours: CONTINUE_HOURS, turns: CONTINUE_MAX }, TASK_AWAY = { hours: 4, turns: 60 }, TASK_TURNS_AN_HOUR = 15, TASK_HOURS_MAX = 72;
const TASK_WORDS = /\b(?:on\s+your\s+own|by\s+yourself|unattended|overnight|while\s+i(?:'m|\s+am)\s+away|as\s+a\s+task)\b/gi;
const TASK_HOURS = /\b(?:for(?:\s+the\s+next)?|up\s+to|over\s+the\s+next)\s+(\d{1,4})\s*(?:hours?|hrs?)\b/gi;
// An instruction's opening ("please", "could you", "I want you to", …), then a verb of working on it or carrying on.
const TASK_OPENER = /^(?:(?:ok(?:ay)?|so|now|just|also|and|then|please|kindly)[\s,]+)*(?:(?:can|could|would|will)\s+you\s+(?:please\s+)?|i\s+(?:want|need|would\s+like)\s+you\s+to\s+|i'd\s+like\s+you\s+to\s+|go\s+ahead\s+and\s+)?(?:please\s+)?/i;
const TASK_VERB = /^(?:work|keep\s+(?:at|on|going|working|trying|digging|looking)|carry\s+on|continue|go\s+on|do|handle|sort|fix|try|dig|look|investigate|figure|find|research|explore|debug|troubleshoot|deal|take\s+care|finish|tune|test|benchmark|compare|clean|tidy|organi[sz]e|set\s+up|build|train|fine-?tune|check|go\s+through|monitor|watch|measure|analy[sz]e|read|review|study|search|prepare|plan)\b/i;
const TASK_NOT = /\b(?:don'?t|do\s+not|didn'?t|did\s+not|doesn'?t|never|no\s+need\s+to|without|not|avoid|stop\s+yourself\s+from)\b/i;
// (words that make what follows the subject of the work, not how long or how it is done: "what happened overnight",
// "the logs from overnight", "why it ran for 70 hours")
const TASK_ABOUT = /\b(?:what|why|whether|that|which|who|how|when|where|if|from|of|about|since)\b/i;
// The limits the owner's words give a new task, clause by clause (sentences, and the parts "then" and "; " join): only
// a clause that is an instruction counts (it opens with a verb of working, and is no question), and only words of time
// that end it, as part of that instruction ("work on it overnight", "for the next 3 hours"): none with a "not" before
// them, or a word between the verb and them that makes them its subject ("look at what happened overnight"), or a word
// after them ("the overnight logs"). Text in quotes or backticks, a quoted line ("> …") and the lines after one ending
// in ":" up to the next blank line (a pasted log) are no instruction. An agent's request gets the ordinary limits.
function taskBudget(text, agent = null) {
  if (agent) return { ...TASK_PLAIN };
  const quoted = normQuotes(String(text || '').replace(/```[\s\S]*?(?:```|$)/g, '\n').replace(/`[^`\n]*`/g, ' ').replace(/^\s*>.*$/gm, ' ')).replace(/"[^"\n]*"|“[^”\n]*”/g, ' ');
  let pasted = false;
  const own = quoted.split('\n').filter(line => {
    if (pasted) { if (!line.trim()) pasted = false; return false; }
    if (/:\s*$/.test(line)) pasted = true;
    return true;
  }).join('\n');
  let away = false, hours = null;
  for (const raw of own.split(/(?<=[?!\n;:])|\.(?=\s|$)|,?\s+(?:and\s+)?then\s+/i)) {
    if (/[?:]\s*$/.test(raw)) continue;
    const clause = raw.trim().replace(TASK_OPENER, ''), verb = TASK_VERB.exec(clause);
    if (!verb) continue;
    const ok = m => !TASK_NOT.test(clause.slice(0, m.index)) && !TASK_ABOUT.test(clause.slice(verb[0].length, m.index))
      && !clause.slice(m.index + m[0].length).replace(/^[\s,]*(?:please|thanks|thank\s+you)?[\s,.!]*$/i, '');
    if ([...clause.matchAll(TASK_WORDS)].some(ok)) away = true;
    const h = [...clause.matchAll(TASK_HOURS)].find(ok);
    if (h) hours = Math.min(TASK_HOURS_MAX, Math.max(1, Number(h[1])));
  }
  if (hours) return { hours, turns: hours * TASK_TURNS_AN_HOUR };
  return { ...(away ? TASK_AWAY : TASK_PLAIN) };
}
// A task's limits as kept, bounded again (chats.json can be edited by hand); a task from before them has the ordinary.
const taskLimits = t => ({
  hours: Number.isInteger(t?.hours) ? Math.min(TASK_HOURS_MAX, Math.max(1, t.hours)) : TASK_PLAIN.hours,
  turns: Number.isInteger(t?.turns) ? Math.min(TASK_HOURS_MAX * TASK_TURNS_AN_HOUR, Math.max(1, t.turns)) : TASK_PLAIN.turns,
});
// Which limit a task has reached, or null: its carry-on turns, its hours from the request, its work steps in all (one
// count, E5b's: what taskStepsKept keeps on the task after each turn, read through taskStepsLeft, 14-rounds.mjs).
function taskOver(t, now = Date.now()) {
  const { hours, turns } = taskLimits(t);
  if ((Number(t?.continuations) || 0) >= turns) return 'turns';
  if (!((t?.parked ? Math.min(now, Date.parse(t.parked)) : now) - Date.parse(t?.at) <= hours * 3600000)) return 'hours';
  if (!taskStepsLeft(t)) return 'steps';
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
      // (one waiting at a button keeps waiting: the restart changes nothing there)
      if (t.parked) continue;
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

/* E6b: at a limit, a job's end, a turn that can't start, and "carry on" */
// The limit a task reached (and on Telegram when the request began there, R32): which one, that what is running
// finishes, and how to go on. A reply that reached it carries the mark (it already ends "Say “go on”"); when none did
// (a wake found it over), one line in its chat says it. A chat that is full stops it too: no turn can come there, so the
// line says to ask again in a new chat. The task stays, stopped, with one needs-you line (tasksNeeds), until the owner
// writes in that chat: "carry on" (or "go on", as the reply says) gives it a fresh budget of its own size (taskAgain),
// anything else is a new request.
function taskStopped(conv, t, which, reply = null) {
  if (!t || t.stopped) return;
  t.stopped = which;
  const { hours, turns } = taskLimits(t);
  const line = which === 'full' ? 'Stopped carrying on with your request: this chat is full, so no turn can come here. What is already running finishes. Start a new chat and ask again there.'
    : `Stopped carrying on with your request: it reached ${which === 'turns' ? `its ${turns} carry-on turns` : which === 'hours' ? `its ${hours} hours` : `its ${TASK_STEPS} commands`}. What is already running finishes, and its result comes here. Say “carry on” for another ${hours} hour${hours === 1 ? '' : 's'} and ${turns} turns.`;
  if (reply) reply.stopped = which;
  else conv.messages.push({ role: 'assistant', content: line, createdAt: new Date().toISOString(), notice: true, stopped: which });
  conv.updatedAt = new Date().toISOString();
  saveChats();
  if (t.channel === 'telegram') tell('carry', line, { last: true }).catch(() => {});
}
// "carry on", "go on", "continue", "keep going" (the whole message): a task stopped at a limit starts again with a fresh
// budget of the same size, and the turn that said it is its carry-on. null for anything else.
const CARRY_ON = /^\s*(?:ok(?:ay)?[\s,]+)?(?:please\s+)?(?:carry\s+on|go\s+on|continue|keep\s+going)(?:\s+please)?\s*[.!]*\s*$/i;
function taskAgain(conv, text) {
  const t = conv?.task;
  if (!(t?.stopped || t?.parked) || t.stopped === 'full' || !CARRY_ON.test(normQuotes(text))) return null;
  // (parked at a button: this turn carries it on, so Sparkie asks again; its budget stays)
  if (!t.stopped) { taskUnpark(t); return t; }
  // (its count of commands starts again too, as at the owner's next message: taskStepsLeft reads 0 as all 120 left)
  Object.assign(t, { at: new Date().toISOString(), continuations: 0, steps: 0, stopped: null });
  delete t.carry;
  delete t.parked;
  return t;
}
// The needs-you lines (openProblems): one for each task stopped at a limit or parked at a button, until the owner writes in
// its chat or answers. No words
// of the request: agents read this list too (fleet_status).
function tasksNeeds(add) {
  for (const c of chatData().conversations) {
    if (c.task?.parked && !c.task.stopped) add(`task:${c.id}`, 'Sparkie is waiting for your answer to a question in one of your chats before it carries on with your request. Press a button there, say “carry on” to be asked again, or anything else to leave it.');
    if (c.task?.stopped === 'full') add(`task:${c.id}`, 'Sparkie stopped carrying on with one of your requests: its chat is full. Start a new chat and ask again there.');
    else if (c.task?.stopped) add(`task:${c.id}`, `Sparkie stopped carrying on with one of your requests at its limit (${c.task.stopped === 'steps' ? `${TASK_STEPS} commands` : c.task.stopped}). Say “carry on” in that chat to go on, or anything else to leave it.`);
  }
}
// The jobs a task started whose end is still to come (jobEnded takes each off when it is told; one the watcher saw end,
// after the task noted it, also counts as ended: its end may have come while Spark Console was down).
const taskJobsOwed = t => (t?.jobs || []).some(j => {
  const w = knowledge.workloads?.[`${j.spark}/${j.container}`];
  return !(w && ['exited', 'dead'].includes(w.state) && w.endTold && String(w.lastSeenAt) > String(j.at));
});
// A carry-on turn that couldn't start (four answers already coming, the chat answering, no brain set up) or that the
// brain never answered (it isn't up: loading after a start, refused, cut off before a word): the turn isn't counted, the
// failed try's two lines give way to the next one's, and it is tried again in a minute, then every five, while its
// hours last (continueTask asks them each time).
const TASK_RETRY_MS = Number(process.env.SPARK_CONSOLE_TASK_RETRY_MS || 60000);
function taskRetry(conv, t, { carried, answered }) {
  if (carried) t.carry = true;
  if (answered) t.answered = true;
  t.retries = (Number(t.retries) || 0) + 1;
  saveChats();
  setTimeout(() => wakeWork(conv.id), t.retries === 1 ? TASK_RETRY_MS : 5 * TASK_RETRY_MS).unref?.();
}
// (the last try's own two lines, Spark Console's carry-on line and the error that answered it, when nothing came after)
function taskRetryLines(conv) {
  const m = conv.messages, last = m.at(-1), line = m.at(-2);
  if (last?.role === 'assistant' && last.error && !String(last.content || '').trim() && !last.tools?.length && line?.role === 'user' && line.auto) m.splice(-2, 2);
}

/* E6c: a task waits at a button */
// A reply that offered a button the owner answers (a change asked about, an owner-only question) parks its task
// (contract 4.8), and a request with a next step whose first change came back as a button is made a task parked there
// (keepTask): it does not carry on by itself, its hours stop, and one needs-you line stands (tasksNeeds). Its
// owner-only questions went to the paired Telegram chat as asks when approvals from there are on (tgAsk); the needs
// line goes there by itself when the needs-me line is on (needsMeTick). A press that runs its own button (the question
// it waits at, kept on it as `asks`; never an agent's press) wakes it with the hours it waited given back
// (taskAnswered); "No" ends it (endTask); "carry on" makes Sparkie ask again (taskAgain).
const taskAsked = asked => (asked || []).some(q => (q.choices || []).some(c => c.choice && pendingChoices.get(c.choice)?.action));
function taskPark(t, asked) {
  if (!t || t.parked) return;
  t.parked = new Date().toISOString();
  t.asks = [...new Set((asked || []).filter(q => (q.choices || []).some(c => c.choice && pendingChoices.get(c.choice)?.action)).map(q => q.group))];
  delete t.carry;
}
// (the hours a parked task waited are given back: its hours run from a later start)
function taskUnpark(t) {
  if (!t?.parked) return;
  delete t.asks;
  const waited = Math.max(0, Date.now() - Date.parse(t.parked));
  if (Number.isFinite(waited) && Number.isFinite(Date.parse(t.at))) t.at = new Date(Date.parse(t.at) + waited).toISOString();
  delete t.parked;
}
// A button pressed in a parked task's chat that runs something: the task carries on after it.
function taskAnswered(conv, group) {
  const t = conv?.task;
  if (!t?.parked || !(t.asks || []).includes(group)) return;
  taskUnpark(t);
  t.answered = true;
  saveChats();
  wakeWork(conv.id);
}

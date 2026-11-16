/* ───────── long tasks: the carry-on made to last (E6) ───────── */
// Area: brain        Rules: R66        Tests: tasks.test.mjs, tasks-telegram.test.mjs, tasks-more.test.mjs, carry-keeps.test.mjs, task-report.test.mjs
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
  if (!((t?.parked ? Math.min(now, Date.parse(t.parked)) : now) - Date.parse(t?.at) <= hours * 3600000)) return 'hours';
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
      if (taskGone(t)) { endTask(conv, false, 'gone'); changed = true; continue; }
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
  // (its report, E7: a stop at a limit is an end until "carry on")
  taskEnded(conv, t, which);
}
// "carry on", "go on", "continue", "keep going" (the whole message): a task stopped at a limit starts again with a fresh
// budget of the same size, and the turn that said it is its carry-on. null for anything else.
const CARRY_ON = /^\s*(?:ok(?:ay)?[\s,]+)?(?:please\s+)?(?:carry\s+on|go\s+on|continue|keep\s+going)(?:\s+please)?\s*[.!]*\s*$/i;
function taskAgain(conv, text) {
  const t = conv?.task;
  if (!(t?.stopped || t?.parked) || t.stopped === 'full' || !CARRY_ON.test(normQuotes(text))) return null;
  // (parked at a button: this turn carries it on, so Sparkie asks again; its budget stays)
  if (!t.stopped) { taskUnpark(t); return t; }
  Object.assign(t, { at: new Date().toISOString(), continuations: 0, steps: 0, stopped: null });
  // (its next end is reported again: E7)
  delete t.reported;
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
// line goes there by itself when the needs-me line is on (needsMeTick). A press that runs the button wakes it with the
// hours it waited given back (taskAnswered); "No" ends it (endTask); "carry on" makes Sparkie ask again (taskAgain).
const taskAsked = asked => (asked || []).some(q => (q.choices || []).some(c => c.choice && pendingChoices.get(c.choice)?.action));
function taskPark(t) {
  if (!t || t.parked) return;
  t.parked = new Date().toISOString();
  delete t.carry;
}
// (the hours a parked task waited are given back: its hours run from a later start)
function taskUnpark(t) {
  if (!t?.parked) return;
  const waited = Math.max(0, Date.now() - Date.parse(t.parked));
  if (Number.isFinite(waited) && Number.isFinite(Date.parse(t.at))) t.at = new Date(Date.parse(t.at) + waited).toISOString();
  delete t.parked;
}
// A button pressed in a parked task's chat that runs something: the task carries on after it.
function taskAnswered(conv) {
  const t = conv?.task;
  if (!t?.parked) return;
  taskUnpark(t);
  t.answered = true;
  saveChats();
  wakeWork(conv.id);
}

/* E7: the report when a task ends */
// When a task ends (its last turn owed nothing, a limit, the owner's /stop or a new request in its chat, a No at its
// question, its way in gone, a state put back from a copy), code writes one short report: no model call, no log text.
// Its counts come from the task's own lines in the journal (each line of its request carries the task's id: its turns,
// their tool calls, the changes made for it and its operations' end lines), read from this month's file and the last:
// operations (finished, failed, cancelled), the changes made at once and after the owner's yes, the questions it asked,
// what was undone (an undo, or an operation cancelled, which puts back what it did), how long and how many turns, and
// the watt-hours its operations' end lines give (D9), summed, with those that have no number counted as not measured,
// never as 0; and what is still open (an operation of it still running, a job of it still to end, a button waiting in
// its chat). Text others can write (a model or container name, a failure line, the request's words) is masked and
// bounded before it is in it. It is kept as owed in chats.json first (conv.reports), then written in the task's chat once
// (posted, in the same save), and sent to Telegram once (told, saved before the send) when the task began there, asked
// there at a button, or ran over an hour; at start-up anything still owed is finished, so a restart neither loses it
// nor tells it twice. A task stopped at a limit is reported then, and not again when it is then left.
const TASK_REPORT_MS = Number(process.env.SPARK_CONSOLE_TASK_REPORT_MS || 2000);
const TASK_REPORT_TG_MS = 3600000;
const taskText = (s, n) => maskSecrets(String(s ?? '').replace(/[\x00-\x1f\x7f-\x9f\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]+/g, ' ').trim()).slice(0, n);
const TASK_ENDS = {
  done: 'done', stopped: 'stopped by you', replaced: 'ended: you asked something new in this chat', no: 'ended: you said no to its question',
  gone: 'ended: the way it was asked from is gone (Telegram unpaired or paired again, or the device signed out)', 'put-back': 'ended: Spark Console’s state was put back from a copy',
  full: 'stopped: this chat is full',
};
// A task's lines in the journal, added up.
function taskCounts(id) {
  const c = { ops: 0, finished: 0, failed: [], cancelled: 0, undone: 0, atOnce: 0, afterYes: 0, asked: 0, turns: 0, wh: 0, measured: 0, unmeasured: 0 };
  if (!id) return c;
  const tag = `"task":${JSON.stringify(id)}`, allowed = new Map();
  for (const f of journalFiles().slice(0, 2).reverse()) for (const line of jLinesOf(f)) {
    if (!line.includes(tag)) continue;
    const r = jParse(line);
    if (r?.task !== id) continue;
    if (r.k === 'turn') c.turns++;
    else if (r.k === 'tool' && ['needs-ok', 'question'].includes(r.outcome)) c.asked++;
    else if (r.k === 'call') {
      if (r.start) { allowed.set(r.id, r.allowed); continue; }
      if (ACTIONS.get(r.act)?.kind !== 'change' || !r.ok || ['question', 'needs-ok', 'already', 'already-starting', 'declined', 'refused'].includes(r.outcome)) continue;
      ((r.end ? allowed.get(r.id) : r.allowed) === 'button' ? c.afterYes++ : c.atOnce++);
      if (r.act === 'undo_last_change' || r.act === 'cancel_operation') c.undone++;
    } else if (r.k === 'op') {
      c.ops++;
      if (r.outcome === 'completed') c.finished++;
      else if (r.outcome === 'cancelled') { c.cancelled++; c.undone++; }
      else c.failed.push(r);
      if (typeof r.wh === 'number' && Number.isFinite(r.wh)) { c.wh += r.wh; c.measured++; } else c.unmeasured++;
    }
  }
  return c;
}
const taskTook = ms => { const m = Math.round(ms / 60000); return m < 1 ? `${Math.max(0, Math.round(ms / 1000))} s` : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`; };
const taskPlural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
// What of a task is still open: its operations still running, its jobs still to end, a button waiting in its chat.
function taskOpen(conv, r) {
  const open = [...jobs.values()].filter(j => j.task === r.task && j.status === 'running').slice(0, 3)
    .map(j => `${OP_WORDS[j.type] || j.type} ${taskText(j.model || j.container || '', 80)}`.trim());
  const owed = (r.jobs || []).filter(j => taskJobsOwed({ jobs: [j] })).slice(0, 3).map(j => `the job ${taskText(j.container, 64)} on ${sparkName(nodeById(j.spark) || { id: j.spark })}`);
  const button = conv.messages.some(m => (m.choices || []).some(c => c.state === 'open' && pendingChoices.has(c.id)));
  return [...open.map(x => `${x} is still running`), ...owed.map(x => `${x} hasn’t ended yet`), ...(button ? ['a button waits for you in this chat'] : [])];
}
// The report's lines, from the journal and what is open now.
function taskReportText(conv, r) {
  const c = taskCounts(r.task), took = Math.max(0, Date.parse(r.end) - Date.parse(r.since));
  const how = TASK_ENDS[r.how] || (r.how === 'turns' ? `stopped at its ${r.turns} carry-on turns` : r.how === 'hours' ? `stopped at its ${r.hours} hours` : r.how === 'steps' ? `stopped at its ${TASK_STEPS} commands` : r.how);
  const failed = c.failed.slice(0, 3).map(x => `${OP_WORDS[x.act] || taskText(x.act, 40)}${x.model ? ` ${taskText(x.model, 80)}` : ''}: ${taskText(String(x.err || x.outcome || 'it failed').split('\n')[0], 160)}`);
  const ops = c.ops ? `Operations: ${c.ops} (${[c.finished && `${c.finished} finished`, c.failed.length && `${c.failed.length} failed`, c.cancelled && `${c.cancelled} cancelled`].filter(Boolean).join(', ')}).` : 'Operations: none.';
  const energy = !c.ops ? null : c.measured ? `Energy at the wall: ${Math.round(c.wh * 10) / 10} Wh for ${taskPlural(c.measured, 'operation')}${c.unmeasured ? `; ${c.unmeasured} not measured` : ''}.` : 'Energy at the wall: not measured.';
  const open = taskOpen(conv, r);
  return [`Report on your request “${taskText(r.request, 120)}”: ${how}.`,
    `${ops}${failed.length ? ` Failed: ${failed.join('; ')}.` : ''}`,
    `Changes: ${c.atOnce} made at once, ${c.afterYes} after your yes; ${taskPlural(c.asked, 'question')} asked of you. Undone: ${c.undone}.`,
    `Time: ${taskTook(took)}, ${taskPlural(Math.max(1, c.turns), 'turn')}.`,
    energy, open.length ? `Still open: ${open.join('; ')}.` : 'Still open: nothing.'].filter(Boolean).join('\n');
}
// A task ends: its report is owed (kept on the chat first), then written and told a moment later, once the turn that
// ended it has written its last journal line.
function taskEnded(conv, t, how) {
  try {
    if (!conv || !t?.id || t.reported === how) return;
    // (one stopped at a limit was reported then: leaving it, or a new request, adds no second report)
    if (t.stopped && how !== t.stopped && ['replaced', 'stopped', 'no', 'gone', 'put-back'].includes(how)) return;
    t.reported = how;
    const end = new Date().toISOString(), since = t.since || t.at, { hours, turns } = taskLimits(t);
    const tg = t.channel === 'telegram' || Boolean(t.tgAsked) || Date.parse(end) - Date.parse(since) > TASK_REPORT_TG_MS;
    conv.reports = [...(conv.reports || []).slice(-4), { task: t.id, how, request: taskText(t.request, 200), since, end, hours, turns, tg, jobs: (t.jobs || []).slice(-20) }];
    saveChats();
    setTimeout(() => taskReportsDue(conv.id), TASK_REPORT_MS).unref?.();
  } catch (e) { console.error(`A task’s report: ${e.message}`); }
}
// The reports owed in a chat: written in it once, told on Telegram once, then taken off.
async function taskReportsDue(id) {
  const conv = chatData().conversations.find(c => c.id === id);
  if (!conv?.reports?.length) return;
  for (const r of conv.reports) {
    if (!r.text) {
      r.text = taskReportText(conv, r);
      conv.messages.push({ role: 'assistant', content: r.text, createdAt: new Date().toISOString(), notice: true, report: r.task });
      conv.updatedAt = new Date().toISOString();
      saveChats();
    }
    if (r.tg && !r.told) {
      r.told = true;
      saveChats();
      await tell('result', r.text, { last: true }).catch(() => false);
    }
  }
  conv.reports = conv.reports.filter(r => !r.text || (r.tg && !r.told));
  if (!conv.reports.length) delete conv.reports;
  saveChats();
}
// (at start-up, after the chats are in: what a restart left owed)
setTimeout(() => {
  try { for (const c of chatData().conversations) if (c.reports?.length) taskReportsDue(c.id).catch(e => console.error(`A task’s report: ${e.message}`)); } catch {}
}, Number(process.env.SPARK_CONSOLE_TASKS_AFTER_MS || 5000) + 1000).unref?.();
// The tasks under way now, with their counts so far (/status, 20-words.mjs; the page's status, 12-status.mjs).
function tasksNow() {
  const out = [];
  for (const c of chatData().conversations) {
    const t = c.task;
    if (!t || t.ended) continue;
    const k = taskCounts(t.id), since = t.since || t.at;
    out.push({ chat: c.id, state: t.stopped ? 'stopped' : t.parked ? 'waiting for you' : 'carrying on', request: taskText(t.request, 80),
      operations: k.ops + [...jobs.values()].filter(j => j.task === t.id && j.status === 'running').length, running: [...jobs.values()].filter(j => j.task === t.id && j.status === 'running').length,
      changes: k.atOnce + k.afterYes, asked: k.asked, minutes: Math.max(0, Math.round((Date.now() - Date.parse(since)) / 60000)), turns: k.turns,
      ...(k.measured ? { wh: Math.round(k.wh * 10) / 10 } : {}), unmeasured: k.unmeasured });
  }
  return out;
}
const tasksNowLines = () => tasksNow().map(x => `“${x.request}” (${x.state}): ${taskPlural(x.operations, 'operation')}${x.running ? ` (${x.running} running)` : ''}, ${taskPlural(x.changes, 'change')}, ${taskPlural(x.turns, 'turn')}, ${taskTook(x.minutes * 60000)} so far${x.wh !== undefined ? `, ${x.wh} Wh at the wall${x.unmeasured ? ` (${x.unmeasured} not measured)` : ''}` : x.operations ? ', energy not measured' : ''}.`);

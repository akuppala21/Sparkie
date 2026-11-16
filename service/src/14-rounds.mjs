/* ───────── Sparkie’s rounds ───────── */
// Area: brain        Rules: R7, R26, R34, R36, R43, R46, R50        Tests: sparkie.test.mjs, sparkie-more.test.mjs, tools.test.mjs, words.test.mjs, brain.test.mjs, turn-budgets.test.mjs, rounds.test.mjs
// Owns: none
// Timers: none        Wakes: none
// The rounds of one reply, cut from sparkieTurn (14-chats.mjs), which calls them in order: how the brain is asked and
// how much it may do, the tools each round offers, one streamed model call, the loop of rounds, one round’s tool
// calls, and one tool call. They share the turn’s state in one object, `turn`.

// The brain's setup decides how it's asked (contract 3.8): a setup with its own sampling (the agent setup: thinking on,
// the model card's sampling) keeps it with tools too; older setups answer tool rounds at temperature 0.3.
function howAsked({ target, tuned, tools }) {
  const base = { model: target.model, stream: true, max_tokens: tuned.maxTokens || 4096, ...(tuned.sampling || { temperature: 0.7, top_p: 0.8 }),
    ...(tools.length && !tuned.sampling ? { temperature: 0.3 } : {}),
    chat_template_kwargs: { enable_thinking: Boolean(tuned.thinking), ...(tuned.templateKwargs || {}) },
    // (the brain's own count of tokens, when its setup has a token budget: 13-ask.mjs)
    ...usageAsked(tuned) };
  return { base };
}
// Tool rounds per message, and changes among them: the setup's, else 6 and 4, held to 40 and 12 (design E 2.3). And the
// loop's budgets (design A 2.10, R50), each counted by code on this turn, so per message and per chat, and each set
// beside a setup's ask block, never in it (askBlock leaves them out): work steps, the run calls one message may make
// (the setup's workSteps, else twice its rounds, at most 30), and one task may make over all its turns (120); the tool
// output it may read (40% of its context, budgetContext, at 3 characters a token); and three refused calls in a row.
// Reaching one makes the next round the last, as overBudget does. Which of them a turn gets is the brain's profile's
// (turnLimits, 21-brain-rail.mjs: a brain not checked gets the careful ones).
const ROUNDS_MOST = 40, CHANGES_MOST = 12;   // limits: tool rounds and changes in one message, whatever a setup says
const WORK_STEPS_MOST = 30;        // limit: run calls in one message, whatever a setup says
const TASK_STEPS = 120;            // limit: run calls in one task, over all its turns (design A 2.10)
const CONTEXT_TOKENS = 32768;      // limit: the context of a setup that says none
const REFUSED_IN_A_ROW = 3;        // limit: refused calls in a row before the tools are put away for the message
// (the two a setup states, for the tested mark: brainCatalog, 21-guide.mjs; none today, so the mark is unchanged)
const budgetsSet = s => Object.fromEntries(['workSteps', 'contextTokens'].filter(k => s?.[k] != null).map(k => [k, s[k]]));
// A setup's own limits, each held to the most any setup may have.
function setupLimits(tuned) {
  const rounds = Math.min(ROUNDS_MOST, Math.max(1, Math.floor(Number(tuned.toolRounds)) || 6)), changes = Math.min(CHANGES_MOST, Math.max(1, Math.floor(Number(tuned.maxChanges)) || 4));
  const steps = Number(tuned.workSteps);
  return { rounds, changes, steps: Math.min(WORK_STEPS_MOST, Number.isInteger(steps) && steps > 0 ? steps : 2 * rounds), output: Math.floor(budgetContext(tuned) * 12 / 10) };
}
// What one task has left of its 120 run calls (task.steps: those its turns made, taskStepsKept); 120 with no task. The one
// place that says whether a task may run more (a task's carrying on asks it too).
const taskStepsDone = task => (Number.isInteger(task?.steps) && task.steps > 0 ? task.steps : 0);
const taskStepsLeft = task => Math.max(0, TASK_STEPS - taskStepsDone(task));
// The turn's budgets: its limits (the setup's own unless given), and the run calls its task has left. A task with none
// left ends this turn's tools at once ('task').
function turnBudgets({ tuned, limits = setupLimits(tuned), task = null }) {
  const done = taskStepsDone(task), left = taskStepsLeft(task);
  const WORK_STEPS = Math.min(limits.steps, left);
  return { ROUNDS: limits.rounds, CHANGES: limits.changes, WORK_STEPS, TOOL_OUTPUT: limits.output, TASK_DONE: done, taskBound: left <= limits.steps,
    works: 0, ran: 0, waitsYes: 0, notRun: 0, outChars: 0, unread: [], refusedRow: [], refused: [], spent: left ? null : 'task',
    // (the operations its calls started, and a call that may change something still going past its 50 seconds: roundCalls)
    ops: [], going: null,
    // (the calls the brain made after its tools were put away, and past the 4 a round runs, none of them run)
    dropped: [], pastFour: [] };
}
// After the turn (sparkieTurn, once its task is kept): the run calls of its task so far, on the task, so its next turn
// has only what is left of the 120. A new request starts a new task, and with it a new count.
function taskStepsKept({ conv, task, agent, works = 0 }) {
  if (!agent && conv.task && (conv.task === task || !task)) conv.task.steps = taskStepsDone(task) + works;
}
// A setup's context in tokens: its contextTokens, else the number after its serving flag (contextFlag, 20-memory-names.mjs:
// the last of --context-length for SGLang, --max-model-len for vLLM, --ctx-size for llama.cpp; the flag is the setup
// saying it); one from 1,000 to 1,048,576, or else 32,768.
function budgetContext(setup) {
  const fits = n => Number.isInteger(n) && n >= 1000 && n <= 1048576;
  if (fits(Number(setup?.contextTokens))) return Number(setup.contextTokens);
  const n = contextFlag(setup);
  return fits(n) ? n : CONTEXT_TOKENS;
}
// Whether a turn the steps, the output, the rounds or the tokens ended carries on by itself, in a fresh turn under the
// carry-on's own limits (continueTask: the task's own hours, turns and steps, taskOver, 14-tasks.mjs; not while agents
// are paused): only the owner's request that is a task (a carry-on turn's, or one with a next step, multiStep). Never
// after three refusals: the brain was spinning.
function budgetCarries({ spent, agent, task, text, now, conv }) {
  // (never past a dangerous ask it is parked at: 20-danger.mjs)
  if (!['steps', 'output', 'rounds', 'tokens'].includes(spent) || agent || !(task || multiStep(text)) || dangerParked(conv)) return false;
  const t = task || { continuations: 0, at: now };
  // (its commands: a turn the steps or the output ended has some of the task's 120 left, or it would have ended at 'task')
  return !taskOver(t) && !(agentSettings().halted && !agentSettings().autoPaused);
}
// What the turn's journal line keeps of its budgets (journalTurn): each one, and the one that ended it.
const budgetsOf = turn => (turn.WORK_STEPS ? { steps: turn.WORK_STEPS, output: turn.TOOL_OUTPUT, ...(turn.spent ? { spent: turn.spent, carried: Boolean(turn.carry) } : {}) } : null);
// One run call is one work step (runOne, before it is handed over): past the message's steps (or what its task has
// left) it is not run, and the step that reaches them makes the next round the last.
// The tools that run on a Spark, each a work step (A7d: write_file counts as run does).
const WORK_TOOLS = new Set(['run', 'write_file']);
function workStep(turn) {
  if (turn.works >= turn.WORK_STEPS) {
    turn.notRun++;
    throw new HttpError(429, turn.taskBound ? `Not run: one task may run ${TASK_STEPS} commands, and this one has. Answer now with what you found and what is left.`
      : `Not run: one message may run ${turn.WORK_STEPS} commands, and this one has. Answer now with what you found and what is left.`);
  }
  if (++turn.works >= turn.WORK_STEPS) turn.spent ||= turn.taskBound ? 'task' : 'steps';
}
// After one call's result comes back (runOne): a refused call (an error, or a run that ran nothing) adds to the
// refusals in a row and a call that worked ends them; the third makes the next round the last. A command counts as run
// only when it ran there (or started, with minutes), and one asked first as waiting for the owner's yes (final read
// S-15: an asked one was counted as run). Then what the brain is sent of the result (budgetCut).
function budgetsAfter(turn, { name, ok, nothing, jid, waited = false, ran = false, asked = false }, out) {
  const why = ok ? nothing : out.replace(/^\[error\] /, '');
  if (why == null) turn.refusedRow.length = 0;
  // (three refusals end the carrying on even in the round whose command reached the steps: the brain was spinning; calls
  // the steps left unrun are no refusals of their own, nor is a call that met this turn's own change still going, C-4)
  else if (!waited && turn.refusedRow.push({ name, why: String(why).replace(/\s+/g, ' ').slice(0, 300) }) >= REFUSED_IN_A_ROW
    && (!turn.spent || (turn.spent === 'steps' && !turn.refusedRow.some(x => /^Not run: one message may run /.test(x.why))))) {
    turn.spent = 'refused';
    turn.refused.push(...turn.refusedRow);
  }
  if (WORK_TOOLS.has(name) && ok && ran) turn.ran++;
  else if (WORK_TOOLS.has(name) && ok && asked) turn.waitsYes++;
  return budgetCut(turn, out, jid);
}
// The tool output one message may read: a result that would pass it, and every result after it, is not shown but named
// by its record (journalTool keeps it whole; on Telegram and in an agent's chat it says, as digestOut does, that only
// the owner reads it back), and the next round is the last. (Kept apart: how a long result is cut may change, design G
// step 5.)
function budgetCut(turn, out, jid) {
  if (!turn.unread.length && turn.outChars + out.length <= turn.TOOL_OUTPUT) { turn.outChars += out.length; return out; }
  turn.unread.push(jid);
  turn.spent ||= 'output';
  return `[Spark Console] Not shown: this result (${out.length.toLocaleString('en-US')} characters) would pass the ${turn.TOOL_OUTPUT.toLocaleString('en-US')} characters of tool results one message may read. ${!jid ? 'It wasn’t kept: the record couldn’t be written.' : jOwnCall(turn.viewer, turn.ctx) ? `It is kept whole in record ${jid}: recall {"id":"${jid}"} reads it, in a later message.` : `It is kept whole in record ${jid}, which only the owner reads back.`} Answer now with what you have.`;
}
// A turn a budget ended says so after the brain's last words, in words built by code: how many commands ran, which
// results weren't read and where they are kept, or which calls were refused and why, or that the rounds were all taken;
// the calls made past the 4 a round runs or after the tools were put away, none run; then, when a budget ended it,
// that the task carries on in a fresh turn (budgetCarries; keepTask keeps it), or that the owner can say "go on".
function budgetReport(turn) {
  if (!turn.spent && !turn.dropped.length && !turn.pastFour.length) return;
  turn.carry = budgetCarries(turn);
  const n = x => x.toLocaleString('en-US'), kept = turn.unread.filter(Boolean), lines = [];
  const more = turn.notRun ? `; ${turn.notRun} more ${turn.notRun === 1 ? 'was' : 'were'} asked for and not run` : '';
  // (those asked first, each with its button or as its own message: they ran nothing yet)
  const waits = turn.waitsYes ? `; ${turn.waitsYes} ${turn.waitsYes === 1 ? 'waits' : 'wait'} for your yes` : '';
  if (turn.spent === 'steps') lines.push(`Stopped here: one message may run ${n(turn.WORK_STEPS)} commands, and ${turn.ran === turn.works ? `${turn.works} ran` : `${turn.works} were tried and ${turn.ran || 'none'} ran`}${waits}${more}.`);
  // (a task's last: no carrying on, and the owner's next message is a new request with its own 120)
  if (turn.spent === 'task') lines.push(`Stopped here: one task may run ${n(TASK_STEPS)} commands, and this one has (${n(turn.works)} in this message)${waits}${more}.`);
  if (turn.unread.length) lines.push(`${turn.spent === 'output' ? 'Stopped here: o' : 'O'}ne message may read ${n(turn.TOOL_OUTPUT)} characters of tool results, so ${turn.unread.length === 1 ? '1 result wasn’t' : `${turn.unread.length} results weren’t`} read${kept.length ? ` (kept whole in Spark Console’s record: ${kept.join(', ')})` : ''}.`);
  if (turn.spent === 'refused') lines.push(`Stopped asking: ${REFUSED_IN_A_ROW} calls in a row were refused, so the tools were put away for this message.`, ...turn.refused.map(r => `- ${r.name}: ${r.why}`));
  if (turn.spent === 'rounds') lines.push(`Stopped here: one message may take ${n(turn.ROUNDS)} rounds of tools, and this one has.`);
  if (turn.spent === 'tokens') lines.push(`Stopped here: one message may use ${n(Number(askOf(turn.tuned).tokenBudget))} of the brain’s tokens (what it reads and writes), and this one has.`);
  const past = turn.pastFour.length, late = turn.dropped.length;
  if (past) lines.push(`${past === 1 ? '1 more call was' : `${past} more calls were`} asked for past the ${ROUND_CALLS} calls one round runs, and not run (${[...new Set(turn.pastFour)].join(', ')}).`);
  if (late) lines.push(`${late === 1 ? '1 more call was' : `${late} more calls were`} asked for after the tools were put away, and not run (${[...new Set(turn.dropped)].join(', ')}).`);
  if (turn.spent) lines.push(turn.spent === 'refused' ? 'Say what to change, or “go on” to try again.' : turn.carry ? 'Carrying on with your request in a fresh turn.' : 'Say “go on” to carry on.');
  const a = turn.answer, text = `${!a.trim() || a.endsWith('\n\n') ? '' : a.endsWith('\n') ? '\n' : '\n\n'}${lines.join('\n')}`;
  turn.answer += text;
  turn.emit({ type: 'delta', text });
}
// The tools of each round (R46): the core and this request's groups, opened by its words (a carry-on turn starts
// from the groups its request kept), by state, by a call to a tool that wasn't offered, and by guide.
function turnGroups({ text, task, tuned, ctx }) {
  const groups = requestGroups(toolCap(tuned), task?.groups);
  if (!task?.groups) for (const g of wordGroups(task ? task.request : text)) openGroup(groups, g, 'words');
  ctx.openGroup = g => openGroup(groups, g, 'guide');
  let offered = null;
  return { groups, offered };
}
// This round’s tools: the groups that state opens now, then the core and the open groups; the system prompt gets the
// lines for exactly what is offered.
function roundTools(turn) {
  const { conv, context, agent, channel, tools, messages, groups } = turn;
  for (const g of stateGroups(conv)) openGroup(groups, g, 'state');
  const names = new Set(offeredNames(groups)), sent = tools.filter(t => names.has(t.function.name));
  turn.offered = new Set(sent.map(t => t.function.name));
  messages[0].content = systemPrompt(context, true, agent, channel, turn.offered);
  return sent;
}
// One call to the model, streamed: text goes out as it comes; tool calls are collected.
function modelStep(turn, sent) {
  const { emit, link, target, messages, base, tuned } = turn;
  return new Promise((resolve, reject) => {
    // (read as its brain setup says, 13-ask.mjs: thinking, in whichever field or tags it comes, never reaches the answer)
    const read = answerReader(tuned);
    let content = '';
    const say = pieces => { for (const t of pieces) { content += t; turn.answer += t; emit({ type: 'delta', text: t }); } };
    modelInUse++;
    // Every way the call ends settles it once and gives the model back: the answer's end, an error on the request or
    // the answer, an answer that closes before it ends, the timeout, and the owner's /stop (link.cancel, whatever state
    // the connection is in). (A-4, 2026-11-14: an error answer cut off part-way never ended, so the chat stayed "still
    // answering" for good and /stop freed nothing.)
    let settled = false;
    const settle = (fn, value) => { if (!settled) { settled = true; modelInUse--; fn(value); } };
    link.cancel = () => settle(reject, new Error(TURN_STOPPED));
    const up = http.request({ hostname: target.host, port: target.port, path: '/v1/chat/completions', method: 'POST', headers: { 'content-type': 'application/json' }, timeout: 300000 }, r => {
      // (after a whole answer its end comes first, and close changes nothing)
      r.on('error', e => settle(reject, e));
      r.on('close', () => settle(reject, new Error('The model’s answer was cut off.')));
      if (r.statusCode !== 200) {
        let err = '';
        r.on('data', d => { err += d; });
        r.on('end', () => settle(reject, new Error(`The model answered ${r.statusCode}: ${err.slice(0, 300)}`)));
        return;
      }
      let buf = '';
      r.on('data', chunk => {
        buf += chunk;
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (data === '[DONE]') continue;
          let ev;
          try { ev = JSON.parse(data); } catch { continue; }
          const got = read.take(ev);
          if (got.thinking && !turn.thinking) { turn.thinking = true; emit({ type: 'thinking' }); }
          say(got.text);
        }
      });
      // (text held back at its start that was no thinking goes out first, unless the call has already ended)
      r.on('end', () => { if (!settled) say(read.end()); settle(resolve, { content, ...read.result() }); });
    });
    link.upstream = up;
    up.on('timeout', () => up.destroy(new Error('The model stopped responding.')));
    up.on('error', e => settle(reject, e.code === 'ECONNREFUSED' ? new Error('Sparkie’s model isn’t running. The owner starts it by typing /restart sparkie in Spark Console’s chat.') : e));
    up.end(JSON.stringify({ ...base, messages, ...(sent?.length ? { tools: sent, tool_choice: 'auto' } : {}) }));
  });
}
// What the brain is told in the last round, once its tools are put away (by the rounds a message may take, its token
// budget or one of the loop's budgets): a call now is not run, so it answers with what the tools said. (Final read
// C-5: past the rounds it was told nothing, and its system prompt still said it had tools.)
const toolsAway = turn => `[Spark Console] Your tools are put away for this message${turn.spent === 'rounds' ? ` (one message may take ${turn.ROUNDS} rounds of tools)`
  : turn.spent === 'tokens' ? ` (one message may use ${Number(askOf(turn.tuned).tokenBudget).toLocaleString('en-US')} of your tokens)` : ''}. A tool you call now is not run: answer with what the tools said, and say what is left to do.`;
// Up to ROUNDS rounds of looking things up (and at most CHANGES changes), then it has to answer.
async function turnRounds(turn) {
  const { emit, link, tools, ROUNDS, messages } = turn;
  for (let round = 0; ; round++) {
    if (link.gone) throw new Error(TURN_STOPPED);
    // (the last round offers no tools: past the rounds a message may take, or past its brain's token budget, 13-ask.mjs,
    // each a budget of its own, or at one of the loop's budgets, turnBudgets; and the brain is told so)
    if (round >= ROUNDS) turn.spent ||= 'rounds';
    else if (overBudget(turn)) turn.spent ||= 'tokens';
    const last = Boolean(turn.spent);
    if (last && tools.length) messages[0].content = `${messages[0].content}\n\n${toolsAway(turn)}`;
    const r = await modelStep(turn, tools.length && !last ? roundTools(turn) : null);
    turn.finishReason = r.finish;
    turn.usage = r.usage || turn.usage;
    if (link.gone) throw new Error(TURN_STOPPED);
    if (!r.calls.length) break;
    // (calls made all the same are not run, and each says so: never dropped unseen, C-5)
    if (last) { await roundDropped(turn, round, r); break; }
    await roundCalls(turn, round, r);
    // What was written before the lookups stays; a clear break before the rest of the answer.
    if (turn.answer && !turn.answer.endsWith('\n')) { turn.answer += '\n\n'; emit({ type: 'delta', text: '\n\n' }); }
  }
  budgetReport(turn);
}
// Which calls of a round run together: the lookups (a read that changes nothing, or a call to no tool). Every other one
// runs after them, one after another in the order asked, each once the one before it has ended: the changes, and run
// and write_file, the reads that change (`changes: true`, 21-work.mjs, 21-write.mjs). (2026-11-11: "stop A, stop B"
// in one round met "already changing" on that Spark; final read C-4, 2026-11-15: so did two commands for one Spark,
// one refused and in no fixed order, and four in a round put the tools away.)
const roundTogether = a => !a || (a.kind === 'read' && !a.changes);
const ROUND_CALLS = 4;              // limit: calls run in one round (each past them is answered "not run")
const ROUND_WAIT_MS = 120000;      // limit: how long a call waits past its own 50 seconds for the one before it
// Whether a call read text from outside that the brain's later calls may follow (R26): a lookup its action doesn't mark
// inside (readInside: outside is the default, A-17) once handed over, its error too (it can quote what it
// read); run and write_file only once something ran there: a command that ran (one that failed too, its error output
// is in its result), one started with minutes, write_file's ask (it shows the file's old lines), or a failure on the
// far side (a 5xx can quote the command's own first line). Never a call refused, asked or answered "nothing ran"
// before anything ran (final read of the net, 5: "Leave out sudo and set root" was followed by "this came from text
// Sparkie read first", though nothing had run or been read).
// An inside read (R26, A-17): only an action that says so itself, `inside: true` or, for some of its arguments, a function
// of them (sparkie_setup with about "abilities"), where every field it returns is the console's own words or a bare name
// (bareName, 05-library.mjs). Every other lookup, a new one too, is outside text.
function readInside(a, args) {
  if (a?.inside === true) return true;
  if (typeof a?.inside !== 'function') return false;
  let x = {};
  try { x = JSON.parse(args || '{}'); } catch { return false; }
  try { return a.inside(x && typeof x === 'object' ? x : {}) === true; } catch { return false; }
}
function readOutsideBy(c, a, { handed, ok, value, status }) {
  if (!handed || a?.kind !== 'read' || readInside(a, c.args)) return false;
  if (!WORK_TOOLS.has(c.name)) return true;
  if (!ok) return !(status >= 400 && status < 500);
  return c.name === 'write_file' ? value?.ran !== false : value?.ran === true || value?.outcome === 'started';
}
// One round’s tool calls: on the record first; lookups together, then the rest one by one; then whether the
// turn has read outside text, the steps for the reply, and the groups that calls to tools not offered open.
async function roundCalls(turn, round, r) {
  const { ctx, messages, used, groups, link } = turn;
  // (every call is on the record, each with its result; at most 4 a round are run, and each past them says so, as a
  // call made after the tools were put away does: never dropped unseen, final read C-5's follow-up)
  const calls = r.calls;
  messages.push({ role: 'assistant', content: r.content || '', tool_calls: calls.map((c, i) => ({ id: c.id || `call_${round}_${i}`, type: 'function', function: { name: c.name, arguments: c.args || '{}' } })) });
  const steps = [], outside = [], at = { round, calls, steps, outside };
  const results = [];
  await Promise.all(calls.map((c, i) => (i < ROUND_CALLS && roundTogether(ACTIONS.get(c.name)) ? runOne(turn, at, c, i).then(x => { results[i] = x; }) : null)));
  // From here on this turn has read text from outside (a log, an operation, a recipe, a web result, a command's
  // output: readOutsideBy): what Sparkie may keep in memory without a button gets stricter (20-memory.mjs
  // memoryClear), and a change is asked (21-ladder.mjs).
  if (outside.some(Boolean)) ctx.readOutside = true;
  for (const [i, c] of calls.entries()) {
    if (results[i]) continue;
    if (i >= ROUND_CALLS) { results[i] = await runOne(turn, { ...at, past: true }, c, i); continue; }
    // (one before it that is still going past its 50 seconds is waited for, a while, so two never run side by side)
    for (const until = Date.now() + ROUND_WAIT_MS; turn.going && !link.gone && Date.now() < until;) await Promise.race([turn.going, sleep(1000)]);
    results[i] = await runOne(turn, at, c, i);
  }
  turn.pastFour.push(...calls.slice(ROUND_CALLS).map(roundCallName));
  // (what a command printed counts from the next round: the brain asked for this round’s calls before any came back)
  if (outside.some(Boolean)) ctx.readOutside = true;
  used.push(...steps.filter(Boolean));
  // Hidden is not forbidden: a call to a tool this round didn't offer ran as any call does, and opens its group;
  // a web search opens reading.
  for (const c of calls) {
    if (ACTIONS.has(c.name) && !turn.offered?.has(c.name)) openGroup(groups, ACTIONS.get(c.name).group, 'call');
    if (c.name === 'search_web') openGroup(groups, 'reading', 'state');
  }
  messages.push(...results);
}
// The calls of a last round, made after the tools were put away (each of them): none is run; each is on the
// page and in the journal as not run, and the reply's last lines name them (budgetReport).
// (a call's name as the reply's last lines say it: a tool's name, or "a tool")
const roundCallName = c => (/^[a-z][a-z_]{0,39}$/.test(String(c.name)) ? c.name : 'a tool');
async function roundDropped(turn, round, r) {
  const calls = r.calls, steps = [];
  for (const [i, c] of calls.entries()) await runOne(turn, { round, calls, steps, away: true }, c, i);
  turn.used.push(...steps.filter(Boolean));
  turn.dropped.push(...calls.map(roundCallName));
}
// One tool call: the checks of this turn (a stop, the agent’s web searches, the changes a message may make), then
// runAction with 50 seconds, the paste card set aside, the result masked, journalled (tool), cut and told.
async function runOne(turn, { round, calls, steps, outside = [], away = false, past = false }, c, i) {
  const { viewer, conv, emit, agent, link, turnId, target, ctx, CHANGES, pastes } = turn;
  const a = ACTIONS.get(c.name) || null, started = Date.now();
  let out, ok = true, outcome = null, plan = null, value = null, handed = false, status = null;
  let nothing = null;   // (why a call that answered ran nothing: a run where the helper can't run it; budgetsAfter)
  let waited = false;   // (it met this turn's own change still going: no refusal of its own, budgetsAfter)
  try {
    // (the owner's /stop came while another call of this round ran: nothing more is handed to runAction)
    if (link.gone) throw new HttpError(409, TURN_STOPPED);
    // (a call made after the tools were put away, roundDropped: never handed over, and no refusal of its own)
    if (away) throw Object.assign(new HttpError(409, 'Not run: it was asked for after the tools were put away for this message.'), { waited: true });
    // (one past the 4 a round runs, roundCalls: never handed over, and no refusal of its own)
    if (past) throw Object.assign(new HttpError(429, `Not run: one round runs at most ${ROUND_CALLS} calls. Ask for it again in the next one.`), { waited: true });
    if (!a) throw new HttpError(404, `No tool called ${String(c.name).slice(0, 60)}.`);
    // (the one before it is still going after the wait, roundCalls: one at a time, so this one isn't started)
    if (turn.going && !roundTogether(a)) throw Object.assign(new HttpError(409, `Not run: the call before it in this message is still going, and calls that may change something run one at a time, in the order asked. Ask for it again once that one has ended (check recent_operations or fleet_events).`), { waited: true });
    if (agent && a.openWorld && overLimit(agentWorld, agent.id, 60000, 6)) throw new HttpError(429, 'At most 6 web searches a minute for this agent. Use find_recipes, or answer with what you have.');
    if (a.kind !== 'read' && ++turn.changes > CHANGES) throw new HttpError(429, `At most ${CHANGES} changes per message. Say what’s done and what’s left.`);
    if (WORK_TOOLS.has(c.name)) workStep(turn);
    const args = c.args ? JSON.parse(c.args) : {};
    handed = true;
    const going = runAction(c.name, viewer, args, ctx);
    value = await Promise.race([going, sleep(50000).then(() => { throw Object.assign(new HttpError(504, `${c.name} took over 50 seconds and may still be going. Don’t ask for it again: check recent_operations or fleet_events.`), { going }); })]);
    // (an operation it started, whose Spark a later call of this turn may meet still changing)
    if (typeof value?.operation === 'string') turn.ops.push(value.operation);
    // A paste card goes under the answer exactly as built; the model only hears that it's there.
    if (value?.paste?.block) {
      pastes.push(value.paste.block);
      // (first, so a long result can't cut off the note that it's shown)
      const { paste, ...rest } = value;
      value = { paste: { shown: 'Spark Console shows this card’s block under your answer, exactly as built. Don’t repeat or change it.', app: paste.app, fits: true, notes: paste.notes }, ...rest };
    }
    out = JSON.stringify(maskDeep(value));
    outcome = typeof value?.outcome === 'string' ? value.outcome : null;
    if (value?.plan) plan = value.plan;
    if (value?.ran === false) nothing = maskSecrets(String(value.why || 'Nothing ran.'));
  } catch (e) {
    ok = false;
    status = e.status ?? null;
    out = `[error] ${maskSecrets(e.message || String(e))}`;
    // (one that may change something, still going past its 50 seconds: the round's next calls wait for it)
    if (e.going && !roundTogether(a)) { const g = turn.going = e.going.then(() => {}, () => {}).then(() => { if (turn.going === g) turn.going = null; }); }
    // (refused because a Spark is still changing with an operation this turn started: met, not refused)
    waited = Boolean(e.waited) || (e.status === 409 && /^(?:Something is already changing on|A long command runs on) /.test(e.message || '') && turn.ops.some(id => jobs.get(id)?.status === 'running'));
  }
  const jid = journalTool({ turn: turnId, chat: conv.id, brain: target.model, call: c, ok, outcome, ms: Date.now() - started, task: ctx?.task || null }, out);
  // What this request read from outside, by its record (A7c; the dangerous ask's "came from", 20-danger.mjs): a label
  // built by code, the tool and its Spark, never its source's words.
  outside[i] = readOutsideBy(c, a, { handed, ok, value, status });
  if (ok && jid && outside[i]) workRead(ctx, jid, a.title, c.args);
  const shown = commandShown(c, ok, out);
  // (a long result: its digest, its lines that matter numbered, 20-digest.mjs; the 12,000 cut with the switch digest off)
  if (out.length > DIGEST_AT) out = memoryOffFor('digest') ? `${out.slice(0, 12000)} …(cut)` : digestOut(out, jid, jOwnCall(viewer, ctx));
  out = budgetsAfter(turn, { name: c.name, ok, nothing, jid, waited, ran: value?.ran === true || outcome === 'started', asked: outcome === 'needs-ok' || outcome === 'question' }, out);
  // (run with minutes started an operation, as a change does: its result wakes the request's carry-on, 21-long.mjs)
  const step = { name: c.name, title: a?.title || c.name, ok, ms: Date.now() - started, change: Boolean(a && a.kind !== 'read') || (c.name === 'run' && outcome === 'started'), ...(outcome ? { outcome } : {}), ...(plan ? { plan } : {}) };
  Object.assign(step, shown);
  steps[i] = step;
  emit({ type: 'tool', ...step });
  return { role: 'tool', tool_call_id: calls[i].id || `call_${round}_${i}`, content: out };
}

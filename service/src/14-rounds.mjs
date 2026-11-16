/* ───────── Sparkie’s rounds ───────── */
// Area: brain        Rules: R7, R26, R34, R36, R43, R46, R50        Tests: sparkie.test.mjs, sparkie-more.test.mjs, tools.test.mjs, words.test.mjs, brain.test.mjs, turn-budgets.test.mjs
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
// Tool rounds per message, and changes among them: the setup's, else 6 and 4. And the loop's budgets (design A 2.10,
// R50), each counted by code on this turn, so per message and per chat, and each set beside a setup's ask block, never
// in it (askBlock leaves them out): work steps, the run calls one message may make (the setup's workSteps, else twice
// its rounds, at most 30); the tool output it may read (40% of its context, budgetContext, at 3 characters a token);
// and three refused calls in a row. Reaching one makes the next round the last, as overBudget does.
const WORK_STEPS_MOST = 30;        // limit: run calls in one message, whatever a setup says
const CONTEXT_TOKENS = 32768;      // limit: the context of a setup that says none
const REFUSED_IN_A_ROW = 3;        // limit: refused calls in a row before the tools are put away for the message
// (the two a setup states, for the tested mark: brainCatalog, 21-guide.mjs; none today, so the mark is unchanged)
const budgetsSet = s => Object.fromEntries(['workSteps', 'contextTokens'].filter(k => s?.[k] != null).map(k => [k, s[k]]));
function turnBudgets({ tuned }) {
  const ROUNDS = Math.max(1, Number(tuned.toolRounds) || 6), CHANGES = Math.max(1, Number(tuned.maxChanges) || 4);
  const steps = Number(tuned.workSteps);
  const WORK_STEPS = Math.min(WORK_STEPS_MOST, Number.isInteger(steps) && steps > 0 ? steps : 2 * ROUNDS);
  const TOOL_OUTPUT = Math.floor(budgetContext(tuned) * 12 / 10);
  return { ROUNDS, CHANGES, WORK_STEPS, TOOL_OUTPUT, works: 0, ran: 0, notRun: 0, outChars: 0, unread: [], refusedRow: [], refused: [], spent: null };
}
// A setup's context in tokens: its contextTokens, else the number after its serving flag (--context-length for SGLang,
// --max-model-len for vLLM, --ctx-size for llama.cpp; the flag is the setup saying it); one from 1,000 to 1,048,576, or
// else 32,768.
const BUDGET_CONTEXT_FLAG = /^(?:--context-length|--max-model-len|--ctx-size)(?:=(.*))?$/;
function budgetContext(setup) {
  const fits = n => Number.isInteger(n) && n >= 1000 && n <= 1048576, args = Array.isArray(setup?.args) ? setup.args.map(String) : [];
  if (fits(Number(setup?.contextTokens))) return Number(setup.contextTokens);
  const at = args.findIndex(a => BUDGET_CONTEXT_FLAG.test(a)), n = at < 0 ? NaN : Number(BUDGET_CONTEXT_FLAG.exec(args[at])[1] ?? args[at + 1]);
  return fits(n) ? n : CONTEXT_TOKENS;
}
// Whether a turn the steps or the output ended carries on by itself, in a fresh turn under the carry-on's own limits
// (continueTask: CONTINUE_MAX turns in CONTINUE_HOURS, not while agents are paused): only the owner's request that is a
// task (a carry-on turn's, or one with a next step, multiStep). Never after three refusals: the brain was spinning.
function budgetCarries({ spent, agent, task, text, now, conv }) {
  // (never past a dangerous ask it is parked at: 20-danger.mjs)
  if (!['steps', 'output'].includes(spent) || agent || !(task || multiStep(text)) || dangerParked(conv)) return false;
  const t = task || { continuations: 0, at: now };
  return t.continuations < CONTINUE_MAX && Date.now() - Date.parse(t.at) <= CONTINUE_HOURS * 3600000 && !(agentSettings().halted && !agentSettings().autoPaused);
}
// What the turn's journal line keeps of its budgets (journalTurn): each one, and the one that ended it.
const budgetsOf = turn => (turn.WORK_STEPS ? { steps: turn.WORK_STEPS, output: turn.TOOL_OUTPUT, ...(turn.spent ? { spent: turn.spent, carried: Boolean(turn.carry) } : {}) } : null);
// One run call is one work step (runOne, before it is handed over): past the message's steps it is not run, and the
// step that reaches them makes the next round the last.
function workStep(turn) {
  if (turn.works >= turn.WORK_STEPS) {
    turn.notRun++;
    throw new HttpError(429, `Not run: one message may run ${turn.WORK_STEPS} commands, and this one has. Answer now with what you found and what is left.`);
  }
  if (++turn.works >= turn.WORK_STEPS) turn.spent ||= 'steps';
}
// After one call's result comes back (runOne): a refused call (an error, or a run that ran nothing) adds to the
// refusals in a row and a call that worked ends them; the third makes the next round the last. Then what the brain is
// sent of the result (budgetCut).
function budgetsAfter(turn, { name, ok, nothing, jid }, out) {
  const why = ok ? nothing : out.replace(/^\[error\] /, '');
  if (why == null) turn.refusedRow.length = 0;
  else if (turn.refusedRow.push({ name, why: String(why).replace(/\s+/g, ' ').slice(0, 300) }) >= REFUSED_IN_A_ROW && !turn.spent) {
    turn.spent = 'refused';
    turn.refused.push(...turn.refusedRow);
  }
  if (name === 'run' && ok && nothing == null) turn.ran++;
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
// results weren't read and where they are kept, or which calls were refused and why; then that the task carries on in
// a fresh turn (budgetCarries; keepTask keeps it), or that the owner can say "go on".
function budgetReport(turn) {
  if (!turn.spent) return;
  turn.carry = budgetCarries(turn);
  const n = x => x.toLocaleString('en-US'), kept = turn.unread.filter(Boolean), lines = [];
  if (turn.spent === 'steps') lines.push(`Stopped here: one message may run ${n(turn.WORK_STEPS)} commands, and ${turn.ran === turn.works ? `${turn.works} ran` : `${turn.works} were tried and ${turn.ran} ran`}${turn.notRun ? `; ${turn.notRun} more ${turn.notRun === 1 ? 'was' : 'were'} asked for and not run` : ''}.`);
  if (turn.unread.length) lines.push(`${turn.spent === 'output' ? 'Stopped here: o' : 'O'}ne message may read ${n(turn.TOOL_OUTPUT)} characters of tool results, so ${turn.unread.length === 1 ? '1 result wasn’t' : `${turn.unread.length} results weren’t`} read${kept.length ? ` (kept whole in Spark Console’s record: ${kept.join(', ')})` : ''}.`);
  if (turn.spent === 'refused') lines.push(`Stopped asking: ${REFUSED_IN_A_ROW} calls in a row were refused, so the tools were put away for this message.`, ...turn.refused.map(r => `- ${r.name}: ${r.why}`));
  lines.push(turn.spent === 'refused' ? 'Say what to change, or “go on” to try again.' : turn.carry ? 'Carrying on with your request in a fresh turn.' : 'Say “go on” to carry on.');
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
// Up to ROUNDS rounds of looking things up (and at most CHANGES changes), then it has to answer.
async function turnRounds(turn) {
  const { emit, link, tools, ROUNDS } = turn;
  for (let round = 0; ; round++) {
    if (link.gone) throw new Error(TURN_STOPPED);
    // (the last round offers no tools: past the rounds a message may take, or past its brain's token budget, 13-ask.mjs,
    // or at one of the loop's budgets, turnBudgets)
    const last = round >= ROUNDS || overBudget(turn) || Boolean(turn.spent);
    const r = await modelStep(turn, tools.length && !last ? roundTools(turn) : null);
    turn.finishReason = r.finish;
    turn.usage = r.usage || turn.usage;
    if (link.gone) throw new Error(TURN_STOPPED);
    if (!r.calls.length || last) break;
    await roundCalls(turn, round, r);
    // What was written before the lookups stays; a clear break before the rest of the answer.
    if (turn.answer && !turn.answer.endsWith('\n')) { turn.answer += '\n\n'; emit({ type: 'delta', text: '\n\n' }); }
  }
  budgetReport(turn);
}
// One round’s tool calls (at most 4): on the record first; lookups together, then changes one by one; then whether the
// turn has read outside text, the steps for the reply, and the groups that calls to tools not offered open.
async function roundCalls(turn, round, r) {
  const { ctx, messages, used, groups } = turn;
  // (at most 4 calls a round, and only those are on the record, each with its result)
  const calls = r.calls.slice(0, 4);
  messages.push({ role: 'assistant', content: r.content || '', tool_calls: calls.map((c, i) => ({ id: c.id || `call_${round}_${i}`, type: 'function', function: { name: c.name, arguments: c.args || '{}' } })) });
  const steps = [];
  // Lookups run together; changes run one after another, in the order asked (2026-11-11: "stop A, stop B" in one
  // round met "already changing" on that Spark).
  const results = [];
  await Promise.all(calls.map((c, i) => (!ACTIONS.get(c.name) || ACTIONS.get(c.name).kind === 'read' ? runOne(turn, { round, calls, steps }, c, i).then(x => { results[i] = x; }) : null)));
  // From here on this turn has read text from outside (a log, an operation, a recipe, a web result): what Sparkie
  // may keep in memory without a button gets stricter (20-memory.mjs memoryClear).
  // (running_models {detail} carries a container's own command: text from outside, like workloads)
  if (calls.some(c => ACTIONS.get(c.name)?.kind === 'read' && (!INSIDE_READS.has(c.name) || (c.name === 'running_models' && /"detail"/.test(c.args || ''))))) ctx.readOutside = true;
  for (const [i, c] of calls.entries()) if (!results[i]) results[i] = await runOne(turn, { round, calls, steps }, c, i);
  used.push(...steps.filter(Boolean));
  // Hidden is not forbidden: a call to a tool this round didn't offer ran as any call does, and opens its group;
  // a web search opens reading.
  for (const c of calls) {
    if (ACTIONS.has(c.name) && !turn.offered?.has(c.name)) openGroup(groups, ACTIONS.get(c.name).group, 'call');
    if (c.name === 'search_web') openGroup(groups, 'reading', 'state');
  }
  messages.push(...results);
}
// One tool call: the checks of this turn (a stop, the agent’s web searches, the changes a message may make), then
// runAction with 50 seconds, the paste card set aside, the result masked, journalled (tool), cut and told.
async function runOne(turn, { round, calls, steps }, c, i) {
  const { viewer, conv, emit, agent, link, turnId, target, ctx, CHANGES, pastes } = turn;
  const a = ACTIONS.get(c.name) || null, started = Date.now();
  let out, ok = true, outcome = null, plan = null;
  let nothing = null;   // (why a call that answered ran nothing: a run where the helper can't run it; budgetsAfter)
  try {
    // (the owner's /stop came while another call of this round ran: nothing more is handed to runAction)
    if (link.gone) throw new HttpError(409, TURN_STOPPED);
    if (!a) throw new HttpError(404, `No tool called ${String(c.name).slice(0, 60)}.`);
    if (agent && a.openWorld && overLimit(agentWorld, agent.id, 60000, 6)) throw new HttpError(429, 'At most 6 web searches a minute for this agent. Use find_recipes, or answer with what you have.');
    if (a.kind !== 'read' && ++turn.changes > CHANGES) throw new HttpError(429, `At most ${CHANGES} changes per message. Say what’s done and what’s left.`);
    if (c.name === 'run') workStep(turn);
    const args = c.args ? JSON.parse(c.args) : {};
    let value = await Promise.race([runAction(c.name, viewer, args, ctx), sleep(50000).then(() => { throw new HttpError(504, `${c.name} took over 50 seconds and may still be going. Don’t ask for it again: check recent_operations or fleet_events.`); })]);
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
    out = `[error] ${maskSecrets(e.message || String(e))}`;
  }
  const jid = journalTool({ turn: turnId, chat: conv.id, brain: target.model, call: c, ok, outcome, ms: Date.now() - started }, out);
  // What this request read from outside, by its record (A7c; the dangerous ask's "came from", 20-danger.mjs): a label
  // built by code, the tool and its Spark, never its source's words.
  if (ok && jid && a?.kind === 'read' && (!INSIDE_READS.has(c.name) || (c.name === 'running_models' && /"detail"/.test(c.args || '')))) workRead(ctx, jid, a.title, c.args);
  const shown = commandShown(c, ok, out);
  // (a long result: its digest, its lines that matter numbered, 20-digest.mjs; the 12,000 cut with the switch digest off)
  if (out.length > DIGEST_AT) out = memoryOffFor('digest') ? `${out.slice(0, 12000)} …(cut)` : digestOut(out, jid, jOwnCall(viewer, ctx));
  out = budgetsAfter(turn, { name: c.name, ok, nothing, jid }, out);
  // (run with minutes started an operation, as a change does: its result wakes the request's carry-on, 21-long.mjs)
  const step = { name: c.name, title: a?.title || c.name, ok, ms: Date.now() - started, change: Boolean(a && a.kind !== 'read') || (c.name === 'run' && outcome === 'started'), ...(outcome ? { outcome } : {}), ...(plan ? { plan } : {}) };
  Object.assign(step, shown);
  steps[i] = step;
  emit({ type: 'tool', ...step });
  return { role: 'tool', tool_call_id: calls[i].id || `call_${round}_${i}`, content: out };
}

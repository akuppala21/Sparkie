/* ───────── Sparkie’s rounds ───────── */
// Area: brain        Rules: R7, R26, R34, R36, R43, R46        Tests: sparkie.test.mjs, sparkie-more.test.mjs, tools.test.mjs, words.test.mjs
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
    chat_template_kwargs: { enable_thinking: Boolean(tuned.thinking), ...(tuned.templateKwargs || {}) } };
  return { base };
}
// Tool rounds per message, and changes among them: the setup's, else 6 and 4.
function turnBudgets({ tuned }) {
  const ROUNDS = Math.max(1, Number(tuned.toolRounds) || 6), CHANGES = Math.max(1, Number(tuned.maxChanges) || 4);
  return { ROUNDS, CHANGES };
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
  const { emit, link, target, messages, base } = turn;
  return new Promise((resolve, reject) => {
    const calls = [];
    let content = '', stepFinish = null;
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
          const choice = ev.choices?.[0];
          if (choice?.delta?.reasoning_content && !turn.thinking) { turn.thinking = true; emit({ type: 'thinking' }); }
          if (choice?.delta?.content) { content += choice.delta.content; turn.answer += choice.delta.content; emit({ type: 'delta', text: choice.delta.content }); }
          for (const tc of choice?.delta?.tool_calls || []) {
            const c = (calls[tc.index ?? 0] ||= { id: '', name: '', args: '' });
            if (tc.id) c.id = tc.id;
            if (tc.function?.name) c.name += tc.function.name;
            if (tc.function?.arguments) c.args += tc.function.arguments;
          }
          if (choice?.finish_reason) stepFinish = choice.finish_reason;
        }
      });
      r.on('end', () => settle(resolve, { content, calls: calls.filter(c => c && c.name), finish: stepFinish }));
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
    const r = await modelStep(turn, tools.length && round < ROUNDS ? roundTools(turn) : null);
    turn.finishReason = r.finish;
    if (link.gone) throw new Error(TURN_STOPPED);
    if (!r.calls.length || round >= ROUNDS) break;
    await roundCalls(turn, round, r);
    // What was written before the lookups stays; a clear break before the rest of the answer.
    if (turn.answer && !turn.answer.endsWith('\n')) { turn.answer += '\n\n'; emit({ type: 'delta', text: '\n\n' }); }
  }
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
  try {
    // (the owner's /stop came while another call of this round ran: nothing more is handed to runAction)
    if (link.gone) throw new HttpError(409, TURN_STOPPED);
    if (!a) throw new HttpError(404, `No tool called ${String(c.name).slice(0, 60)}.`);
    if (agent && a.openWorld && overLimit(agentWorld, agent.id, 60000, 6)) throw new HttpError(429, 'At most 6 web searches a minute for this agent. Use find_recipes, or answer with what you have.');
    if (a.kind !== 'read' && ++turn.changes > CHANGES) throw new HttpError(429, `At most ${CHANGES} changes per message. Say what’s done and what’s left.`);
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
  } catch (e) {
    ok = false;
    out = `[error] ${maskSecrets(e.message || String(e))}`;
  }
  journalTool({ turn: turnId, chat: conv.id, brain: target.model, call: c, ok, outcome, ms: Date.now() - started }, out);
  if (out.length > 12000) out = `${out.slice(0, 12000)} …(cut)`;
  const step = { name: c.name, title: a?.title || c.name, ok, ms: Date.now() - started, change: Boolean(a && a.kind !== 'read'), ...(outcome ? { outcome } : {}), ...(plan ? { plan } : {}) };
  steps[i] = step;
  emit({ type: 'tool', ...step });
  return { role: 'tool', tool_call_id: calls[i].id || `call_${round}_${i}`, content: out };
}

/* ───────── "save that as …": a saved workflow from the changes a request made (D6e) ───────── */
// Area: core        Rules: R35, R43        Tests: workloads-save.test.mjs
// Owns: none
// Timers: none        Wakes: none
// save_workflow {title, from: "this request"} saves the chain of changes the journal recorded for the request just
// before this one, in this chat (contract 9.7's "save this as …"; the critic's cut of B7 and D's pipelines). Only in the
// owner's own chat with Sparkie, on the page or Telegram, or a press of its button there: never an agent (its key,
// ask_sparkie or a chat an agent started) and never POST /actions, which has no chat; R43's own-call test. The records
// are this chat's alone (`chat`): its two newest `said` lines bound the request (the owner's words that asked, then the
// words asking to save it), and the request is every change call between them, Sparkie's and the owner's button
// presses, its carry-on turns included. A step is a change that worked and isn't a question, kept with the arguments it
// was called with (as the journal masked them; answers to a question are left out), once. Not a step: a lookup, anything in
// NOT_A_STEP, and cancel, undo, test runs (savedFromSkip). A call whose arguments the journal cut, or that carried a hidden
// key or a pressed choice's id, is left out and said. Nothing that can be saved: refused, saying so. The steps then go
// through save_workflow's own checks as if they were typed.
const savedFromSkip = new Set(['cancel_operation', 'test_changes', 'undo_last_change', 'undo_update']);
// The input with its steps: those given, or those of the request before this one when `from` is (with what was left
// out of them, leftOut, for the answer).
function fromRequest(input, viewer, ctx) {
  if (input.from !== undefined && input.steps !== undefined) throw new HttpError(400, 'Give steps or from, not both.');
  if (input.from === undefined) { if (input.steps === undefined) throw new HttpError(400, 'Missing argument: steps.'); return input; }
  const { from, ...rest } = input, { steps, left } = requestSteps(viewer, ctx);
  return { ...rest, steps, ...(left.length ? { leftOut: left } : {}) };
}
function requestSteps(viewer, ctx) {
  const conv = ctx?.conv ? chatData().conversations.find(c => c.id === ctx.conv) : null;
  if (viewer?.agentKey || ctx?.agent || ctx?.agentId || !conv || conv.agent || !['sparkie', 'page', 'telegram'].includes(ctx.via)) {
    throw new HttpError(403, 'from “this request” works only in your own chat with Sparkie: it saves what the request just before it changed there.');
  }
  // This chat's records, oldest first, from this month's journal and the last one's (a line names its chat).
  const recs = [], tag = `"chat":${JSON.stringify(conv.id)}`;
  for (const f of journalFiles().slice(0, 2).reverse()) for (const line of jLinesOf(f)) { if (line.includes(tag)) { const r = jParse(line); if (r?.chat === conv.id) recs.push(r); } }
  const said = recs.map((r, i) => (r.k === 'said' ? i : -1)).filter(i => i >= 0);
  if (said.length < 2) throw new HttpError(409, 'There’s no request before this one in this chat, so nothing was saved.');
  const calls = new Map();
  for (const r of recs.slice(said.at(-2) + 1, said.at(-1))) if (r.k === 'call') calls.set(r.id, calls.has(r.id) ? jMerge(calls.get(r.id), r) : r);
  const steps = [], left = [];
  for (const r of calls.values()) {
    const a = ACTIONS.get(r.act);
    if (!a || a.kind === 'read' || NOT_A_STEP.has(r.act) || savedFromSkip.has(r.act)) continue;
    if (!r.ok || ['question', 'needs-ok', 'cancelled', 'refused'].includes(r.outcome)) continue;
    const args = r.args && typeof r.args === 'object' && !Array.isArray(r.args) ? r.args : null;
    const why = !args ? 'its arguments were too long to keep' : 'choice' in args ? 'it answered a question, so its arguments aren’t kept'
      : JSON.stringify(args).includes('[hidden]') ? 'part of it was hidden as a key' : null;
    if (why) { left.push(`${a.title} (${why})`); continue; }
    const st = { action: r.act, args: Object.fromEntries(Object.entries(args).filter(([k]) => !APPROVAL_ARGS.includes(k))) };
    // (the same call again, as a carry-on turn may make it, is one step)
    if (!steps.some(x => JSON.stringify(x) === JSON.stringify(st))) steps.push(st);
  }
  if (!steps.length) throw new HttpError(409, `The request before this one in this chat changed nothing that can be saved${left.length ? ` (left out: ${left.join('; ')})` : ''}, so nothing was saved.`);
  if (steps.length > 12) throw new HttpError(409, `The request before this one made ${steps.length} changes; a saved workflow holds 12 at most, so nothing was saved.`);
  return { steps, left };
}

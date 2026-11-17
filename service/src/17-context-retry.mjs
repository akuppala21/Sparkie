/* ───────── a shorter context waits for the owner's own decision (T42) ───────── */
// Area: core        Rules: R1, R7, R9, R16, R18, R25        Tests: context-start.test.mjs, context-page.test.mjs, context-lifecycle.test.mjs, context-boundaries.test.mjs, telegram-owner-adapters.test.mjs
// Owns: none
// Timers: none        Wakes: none
// Private start plans and one-use owner decisions. No setup, environment or retry token is a job property.
const contextStarts = new WeakMap(), contextRetries = new Map();
function contextFingerprint(m, how) {
  return createHash('sha256').update(JSON.stringify({ name: m.name, repo: m.repo, format: m.format, manifest: m.manifest || null, how, image: imageOf(withHow(m, how)), engine: engineOf(withHow(m, how)) })).digest('hex');
}
function contextPrune() {
  for (const [token, p] of contextRetries) if (Date.now() >= p.budget.deadline) contextRetries.delete(token);
  while (contextRetries.size > 100) contextRetries.delete(contextRetries.keys().next().value);
}
function contextCarry(args, ctx) {
  const fields = { ...(args.contextTokens !== undefined ? { contextTokens: args.contextTokens } : {}), ...(args.setup ? { setup: args.setup } : {}) };
  if (ctx.contextRetry) {
    const token = randomBytes(16).toString('hex');
    contextRetries.set(token, contextFreeze({ ...ctx.contextRetry, approved: true }));
    fields.__contextRetryToken = token;
  }
  return fields;
}
function contextConsume(args, viewer, ctx) {
  contextPrune();
  const token = args.__contextRetryToken, p = contextRetries.get(token);
  if (!(p && ctx.trusted && ctx.button && (isOwnerPress(ctx) || (p.approved && isOwnerCall(ctx))) && viewer.role === 'owner' && !viewer.agentKey && !ctx.agent && !ctx.agentId)) throw new HttpError(409, 'That context choice has expired or needs the owner’s own button. Nothing was started.');
  contextRetries.delete(token);
  contextAttempt(p.budget, Date.now(), Math.min(FIX_WINDOW_MS, 1800000)); // Check now, and again immediately before every actual launch.
  if (args.model !== p.args.model || args.spark !== p.args.spark || JSON.stringify(args.sparks) !== JSON.stringify(p.args.sparks) || args.contextTokens !== p.proposed || args.setup !== p.args.setup) throw new HttpError(409, 'That context choice no longer matches the start it offered.');
  const decisions = { ...(args.allowStop ? { allowStop: [...args.allowStop] } : {}), ...(args.allowBusy ? { allowBusy: [...args.allowBusy] } : {}), ...(args.tryPassedOver === true ? { tryPassedOver: true } : {}) };
  return { args: { ...p.args, ...decisions, contextTokens: p.proposed }, ctx: { ...ctx, noStops: p.noStops, contextRetry: p } };
}
function contextAlready(job, args) {
  const wanted = args.contextTokens, saved = contextStarts.get(job);
  if ((wanted !== undefined && saved?.policy?.tokens !== wanted) || (args.setup && job.setup !== args.setup)) throw new HttpError(409, 'That model is already starting with settings that do not confirm this context. Wait for it to finish, then ask again.');
}
function contextReplayHow(m, inv, p, viewer, ctx) {
  if (p.page) return resolveHow(p.page.body, viewer, m.name, p.nodes.length, inv.library);
  if (p.args.setup) return resolveHow({ setup: p.args.setup }, viewer, m.name, p.nodes.length, inv.library);
  return bestHowNow(m, { nodes: p.nodes, two: p.nodes.length === 2 }, viewer, inv, ctx.workflowVersion, p.args.tryPassedOver === true).how;
}
function contextPageStart(m, inv, args, viewer, ctx) {
  const page = ctx.contextRetry.page, nodes = ctx.contextRetry.nodes;
  if (!(ctx.button && ctx.trusted && viewer.role === 'owner' && !viewer.agentKey && (isOwnerPress(ctx) || (ctx.contextRetry.approved && isOwnerCall(ctx))))) throw new HttpError(403, 'This setup needs the owner’s approved button.');
  const how = resolveHow(page.body, viewer, m.name, nodes.length, inv.library);
  const placed = { nodes, two: nodes.length === 2, stop: page.approved, keep: page.keep };
  const prepared = contextPrepare(m, how, args, placed, ctx, page);
  const job = launch(viewer, ctx, m, placed, prepared.how, prepared);
  return { outcome: 'started', operation: job.id, model: m.repo || m.name, sparks: nodes };
}
function contextPrepare(m, how, args, placed, ctx, page = null) {
  let policy;
  try { policy = contextPolicy({ args: withHow(m, how)?.manifest?.args || [], requested: args.contextTokens, selected: Boolean(args.setup || page?.body.verified), own: !how && Boolean(m.manifest) }); }
  catch (e) { throw new HttpError(400, e.message); }
  const fingerprint = contextFingerprint(m, how), prior = ctx.contextRetry;
  if (prior && (prior.fingerprint !== fingerprint || JSON.stringify(prior.nodes) !== JSON.stringify(placed.nodes))) throw new HttpError(409, 'The model, setup or Sparks changed since that context choice. Ask for a new start.');
  let effectiveHow = how;
  if (policy) {
    const effective = withHow(m, how), flag = ENGINES[engineOf(effective)]?.ctxFlag;
    const normalized = contextOverride(effective.manifest?.args || [], policy.tokens, flag);
    effectiveHow = how ? { ...how, args: normalized } : { contextOnly: true, engine: engineOf(m), image: imageOf(m), args: normalized, env: m.manifest?.env || {} };
  }
  const frozenArgs = { model: m.name, ...(placed.two ? { sparks: [...placed.nodes] } : { spark: placed.nodes[0] }),
    ...(args.setup ? { setup: args.setup } : {}), ...(args.allowStop ? { allowStop: [...args.allowStop] } : {}), ...(args.allowBusy ? { allowBusy: [...args.allowBusy] } : {}), ...(args.tryPassedOver ? { tryPassedOver: true } : {}) };
  return { how: effectiveHow, private: { policy, fingerprint, baseHow: how, args: frozenArgs, nodes: [...placed.nodes], page: page || prior?.page || null,
    budget: prior?.budget || null, noStops: Boolean(ctx.noStops), resultChat: ctx.conv || null, origin: prior?.origin || ctx.contextOrigin || ctx.conv || null, originTask: prior?.originTask || ctx.contextOriginTask || ctx.task || null, retryOf: prior?.operation || null, channel: prior?.channel || ctx.channel || null } };
}
function contextBind(job, prepared) {
  contextStarts.set(job, prepared.private);
  if (prepared.private.retryOf) job.retryOf = prepared.private.retryOf;
  if (prepared.private.resultChat) job.conv ||= prepared.private.resultChat;
}
function contextPark(conv) {
  contextPrune();
  const asked = [...contextRetries.values()].filter(p => p.origin === conv?.id && p.originTask && p.originTask === conv?.task?.id && p.asked && p.asked.choices.some(c => pendingChoices.get(c.choice)?.action)).map(p => p.asked);
  if (asked.length) taskPark(conv.task, asked);
  return asked.length > 0;
}
function contextCheck(job) {
  const state = contextStarts.get(job), budget = state?.policy ? state.budget : null;
  if (budget && Date.now() >= budget.deadline) throw new Error('The 30 minutes for this start have ended. Ask for a new start.');
}
function contextDecisionFor(group) {
  return [...contextRetries.values()].find(p => p.asked?.group === group) || null;
}
function contextApprove(choice, viewer, ctx) {
  const token = choice.args?.__contextRetryToken, p = contextRetries.get(token);
  if (p && choice.ownerOnly && isOwnerPress(ctx) && viewer.role === 'owner' && !viewer.agentKey && !ctx.agentId) {
    contextRetries.set(token, contextFreeze({ ...p, approved: true }));
  }
}
function contextChoiceResult(p, group, asked, out, declined) {
  if (!p) return;
  const origin = chatData().conversations.find(c => c.id === p.origin), task = origin?.task;
  const matching = Boolean(task && p.originTask && task.id === p.originTask && task.parked && task.asks?.includes(group));
  if (asked) {
    for (const c of asked.choices || []) {
      const token = pendingChoices.get(c.choice)?.args?.__contextRetryToken, next = contextRetries.get(token);
      if (next) contextRetries.set(token, contextFreeze({ ...next, asked }));
    }
    if (matching) task.asks = [...new Set(task.asks.map(id => id === group ? asked.group : id))];
    return;
  }
  if (matching && (declined || (origin.id !== p.ownerChat && (out?.operation || ['already', 'kept'].includes(out?.outcome))))) {
    endTask(origin, false, declined ? 'no' : 'owner handoff');
  }
}
function contextPublish(job) {
  const state = contextStarts.get(job);
  if (!state?.proposed || job.status !== 'failed' || job.cancelled) return;
  // No enabled retry alongside unresolved cleanup or a command whose end is uncertain.
  if ((job.ranHere || []).length || (job.stoppedHere || []).length || (job.asideHere || []).length || job.notBack?.length || job.cleanUp || Date.now() >= state.budget.deadline || state.budget.attempts >= 3) return;
  if (job.partOf && jobs.get(job.partOf)?.status === 'running') { contextStarts.set(jobs.get(job.partOf), state); return; }
  const owner = accessList().owner, at = new Date().toISOString();
  const origin = chatData().conversations.find(c => c.id === (state.origin || job.conv));
  const destination = chatData().conversations.find(c => c.id === state.resultChat);
  let conv = destination && destination.login === owner && !destination.agent ? destination : origin && origin.login === owner && !origin.agent ? origin : null;
  if (!conv) { conv = { id: `sc_${randomBytes(8).toString('hex')}`, login: owner, title: 'Choose a model’s context', spark: null, createdAt: at, updatedAt: at, messages: [] }; chatData().conversations.push(conv); }
  const token = randomBytes(16).toString('hex');
  const text = `${job.model} did not fit with ${state.policy.tokens.toLocaleString('en-US')} context tokens on ${sparksWords(state.nodes)}. The failed start was cleaned up. Anything it stopped was started again. Try again with exactly ${state.proposed.toLocaleString('en-US')} tokens, or leave it stopped?`;
  let asked;
  question({ login: owner, role: 'owner' }, { via: 'page', conv: conv.id, chat: conv.id, noTelegramQuestion: state.channel !== 'telegram', onQuestion: q => { asked = q; } }, text,
    [{ label: `Try again with ${state.proposed.toLocaleString('en-US')} tokens`, call: { action: 'start_model', args: { ...state.args, contextTokens: state.proposed, __contextRetryToken: token } } }, { label: 'Leave it stopped', call: null }], 'question', { ownerOnly: true });
  contextRetries.set(token, contextFreeze({ ...state, operation: job.id, asked, origin: state.origin || conv.id, ownerChat: conv.id, approved: false }));
  contextPrune();
  job.contextQuestion = { chat: conv.id, choice: asked.group };
  job.choices = sparkieMessageChoices(asked);
  if (!job.conv) job.conv = conv.id;
  conv.messages.push({ role: 'assistant', content: text, createdAt: at, notice: true, choices: job.choices });
  conv.updatedAt = at;
  contextPark(conv);
  if (origin && origin !== conv) contextPark(origin);
  saveChats();
}


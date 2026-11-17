/* ───────── the owner's account and brain operations, shared by the page and paired chat ───────── */
// Area: features        Rules: R6, R23, R32, R33, R34, R54        Tests: owner-admin.test.mjs, telegram-device.test.mjs, telegram-device-held.test.mjs
// Owns: none
// Timers: none        Wakes: the brain's configured Spark, through startMain or switchMain
// The page verifies its passkey before these helpers. The internal admin action verifies the owner's exact press.
function ownerSettingsChange(body, ctx) {
  const change = {};
  for (const k of ['halted', 'selfHeal']) if (body[k] !== undefined) { if (typeof body[k] !== 'boolean') throw new HttpError(400, `${k} should be true or false.`); change[k] = body[k]; }
  // The owner's own pause or resume replaces an automatic one.
  if (change.halted !== undefined) change.autoPaused = false;
  let next;
  const unnoted = change.halted !== undefined ? putBackRemoval({ kind: change.halted ? 'paused' : 'resumed' }, () => { next = setAgentSettings(change); }) : ((next = setAgentSettings(change)), null);
  audit({ via: ctx.via, actor: 'owner', action: 'agent-settings', args: change, ok: true });
  // Resuming starts the hour's count again, so agents aren't paused again by the changes that paused them.
  if (change.halted === false) { agentChanges.length = 0; agentFailuresInARow = []; }
  if (change.halted !== undefined) fleetEvent({ type: 'operation', operation: change.halted ? 'agents paused' : 'agents resumed', status: 'completed', by: 'owner' });
  return { settings: next, ...(unnoted ? { noted: false, note: unnoted } : {}) };
}

function ownerAgentCreate(input, viewer, ctx) {
  const name = clean(input.name, 60);
  if (!name) throw new HttpError(400, 'Name the agent, like “Claude Code on my MacBook”.');
  const keys = agentKeys();
  if (keys.length >= 20) throw new HttpError(409, 'Remove an agent before adding another (20 at most).');
  if (keys.some(k => k.name.toLowerCase() === name.toLowerCase())) throw new HttpError(409, `There’s already an agent called ${name}.`);
  const token = `sck_${randomBytes(32).toString('base64url')}`;
  const key = { id: randomBytes(6).toString('hex'), name, login: viewer.login, hash: keyHash(token).toString('hex'), scopes: ['fleet:read'], internet: false, createdAt: new Date().toISOString(), lastUsedAt: null, lastAction: null };
  writePrivate(AGENTS_FILE, { keys: [...keys, key] });
  putBackSeed();
  audit({ via: ctx.via, actor: 'owner', action: 'agent-added', args: { agent: name }, ok: true });
  return { ...agentView(key), token, url: mcpUrl() };
}

function ownerAgentRights(agentId, input, ctx) {
  const { act, internet } = input;
  if ((act !== undefined && typeof act !== 'boolean') || (internet !== undefined && typeof internet !== 'boolean') || (act === undefined && internet === undefined)) {
    throw new HttpError(400, 'Say whether it can change things (act: true or false), and/or whether its key works from anywhere (internet: true or false).');
  }
  const keys = agentKeys(), key = keys.find(k => k.id === agentId);
  if (!key) throw new HttpError(404, 'That agent was removed.');
  const could = { act: (key.scopes || []).includes('fleet:act'), internet: key.internet !== false };
  if (act !== undefined) key.scopes = act ? ['fleet:read', 'fleet:act'] : ['fleet:read'];
  if (internet !== undefined) key.internet = internet;
  // A right taken away counts as a removal (R23): a state put back from before takes it away again.
  const took = { ...(could.act && act === false ? { act: false } : {}), ...(could.internet && internet === false ? { internet: false } : {}) };
  const unnoted = Object.keys(took).length ? putBackRemoval({ kind: 'narrowed', id: key.id, name: key.name, extra: took }, () => writePrivate(AGENTS_FILE, { keys }))
    : (writePrivate(AGENTS_FILE, { keys }), null);
  if (act !== undefined) audit({ via: ctx.via, actor: 'owner', action: 'agent-can-change', args: { agent: key.name, act }, ok: true });
  if (internet !== undefined) audit({ via: ctx.via, actor: 'owner', action: 'agent-from-anywhere', args: { agent: key.name, internet }, ok: true });
  return { ...agentView(key), ...(unnoted ? { noted: false, note: unnoted } : {}) };
}

function ownerAgentRemove(agentId, ctx) {
  const keys = agentKeys();
  const gone = keys.find(k => k.id === agentId);
  if (!gone) throw new HttpError(404, 'That agent was already removed.');
  const unnoted = putBackRemoval({ kind: 'agent', id: gone.id, name: gone.name }, () => writePrivate(AGENTS_FILE, { keys: keys.filter(k => k.id !== agentId) }));
  agentUse.delete(agentId);
  audit({ via: ctx.via, actor: 'owner', action: 'agent-removed', args: { agent: gone.name }, ok: true });
  return { ok: true, ...(unnoted ? { noted: false, note: unnoted } : {}) };
}

function ownerPasskeyRemove(id, ctx) {
  const keys = passkeys(), k = keys.find(x => x.id === id);
  if (!k) throw new HttpError(404, 'That passkey was already removed.');
  // (its note outside the state first, then the save: 22-putback.mjs; a note that waits is said)
  const unnoted = putBackRemoval({ kind: 'passkey', id: k.id, name: k.name }, () => savePasskeys(keys.filter(x => x !== k)));
  for (const [cid, c] of challenges) if (c.purpose === 'register') challenges.delete(cid);
  audit({ via: ctx.via, actor: 'owner', action: 'passkey-removed', args: { name: k.name }, ok: true });
  return { ok: true, ...(unnoted ? { noted: false, note: unnoted } : {}) };
}

function ownerRecoveryCodes(viewer, ctx) {
  if (viewer.session && !passkeys().length) throw new HttpError(403, 'Set up a passkey first; then make recovery codes.');
  if (!SECRETS_FILE) throw new HttpError(409, 'This copy of Spark Console keeps no secrets, so it has no recovery codes.');
  const codes = makeRecoveryCodes();
  audit({ via: ctx.via, actor: 'owner', action: 'recovery-codes-made', args: { count: codes.length }, ok: true });
  fleetEvent({ type: 'notice', text: 'You made 10 new recovery codes. The old ones no longer work.' });
  return { ...recoveryView(), codes };
}

async function ownerBrainRoute(input, guard = null) {
  if (mainBusy()) throw new HttpError(409, 'Sparkie’s model is changing. Try again when it’s done.');
  const { role, choice } = input;
  if (!['chat', 'agents'].includes(role) || typeof choice !== 'string' || choice.length > 200) throw new HttpError(400, 'Choose what Sparkie or agents should use.');
  await setRoute(role, choice, guard);
  return { chat: await routeView(ROUTES.chat), agents: ROUTES.agents.kind === 'same' ? { same: true } : await routeView(ROUTES.agents) };
}

async function ownerBrainUse(input, prepared = null, guard = null, approvedStops = null) {
  if (mainBusy()) throw new HttpError(409, 'Sparkie’s model is already changing.');
  const { preset, model, keep = [] } = input;
  if ((model && !NAME_RE.test(String(model))) || !Array.isArray(keep) || !keep.every(k => NAME_RE.test(String(k)))) throw new HttpError(400, 'Choose a model.');
  const target = prepared || (model ? await setupFromLibrary(String(model)) : mainSetup(String(preset || ''), mainPresets()[preset]));
  if (guard) guard();
  if (!target) throw new HttpError(404, 'Unknown setup.');
  if (target.id === MAIN?.id) throw new HttpError(409, `${target.title} is already Sparkie’s model.`);
  const job = claimed([...new Set([target.node, MAIN?.node].filter(Boolean))], `switching Sparkie’s model`, () => newJob('main-switch', { node: target.node, model: target.title, from: MAIN?.title || null }));
  if (approvedStops) job.ownerBrainStops = [...approvedStops];
  return publicJob(runJob(job, j => switchMain(j, target, keep.map(String))));
}

function ownerBrainPower(starting, input, approvedStops = null) {
  if (!MAIN) throw new HttpError(404, 'No main model is configured.');
  if (mainBusy()) throw new HttpError(409, 'Sparkie’s model is already starting or stopping.');
  const { keep = [] } = input;
  if (!Array.isArray(keep) || !keep.every(k => NAME_RE.test(String(k)))) throw new HttpError(400, 'Invalid list of containers to keep.');
  const job = claimed([MAIN.node], `${starting ? 'starting' : 'stopping'} Sparkie’s model`, () => newJob(starting ? 'main-start' : 'main-stop', { node: MAIN.node, model: MAIN.title || MAIN.served }));
  if (approvedStops) job.ownerBrainStops = [...approvedStops];
  // (the owner's Stop: the brain keeper never starts it again by itself, 20-heal.mjs)
  return publicJob(runJob(job, async j => { markBrainDesired(starting); return starting ? startMain(j, keep.map(String)) : stopMain(j); }));
}

function ownerSessionRemove(id, ctx) {
    const list = sessionList(), s = list.find(x => x.id === id);
    if (!s) throw new HttpError(404, 'That device was already signed out.');
    const unnoted = putBackRemoval({ kind: 'session', id: s.id, name: s.name }, () => saveSessions(list.filter(x => x !== s)));
    endSession(s.id);
    audit({ via: ctx.via, actor: 'owner', action: 'signed-out', args: { device: s.name }, ok: true });
    return { ok: true, ...(unnoted ? { noted: false, note: unnoted } : {}) };
}


// Internal command only: it is not a model tool, an agent tool or a saved-workflow step.
const OWNER_ADMIN = '__owner_admin';
function ownerAdminParse(text) {
  const t = String(text).trim(); let m;
  if (/^\/admin(?:\s+(all|agents|sessions|passkeys|brain|access))?$/i.test(t)) return { op: 'overview', section: t.split(/\s+/)[1]?.toLowerCase() || 'all' };
  if (/^\/resume$/i.test(t)) return { op: 'settings', halted: false };
  if ((m = /^\/admin selfheal (on|off)$/i.exec(t))) return { op: 'settings', selfHeal: m[1].toLowerCase() === 'on' };
  if ((m = /^\/admin approvals (on|off)$/i.exec(t))) return { op: 'telegram_approvals', on: m[1].toLowerCase() === 'on' };
  if ((m = /^\/agent create (.{1,60})$/i.exec(t))) return { op: 'agent_create', name: m[1] };
  if ((m = /^\/agent ([a-f0-9]{12}) (read|write|off)$/i.exec(t))) return { op: m[2].toLowerCase() === 'off' ? 'agent_remove' : 'agent_rights', id: m[1].toLowerCase(), ...(m[2].toLowerCase() !== 'off' ? { act: m[2].toLowerCase() === 'write' } : {}) };
  if ((m = /^\/agent ([a-f0-9]{12}) internet (on|off)$/i.exec(t))) return { op: 'agent_rights', id: m[1].toLowerCase(), internet: m[2].toLowerCase() === 'on' };
  if ((m = /^\/session ([a-f0-9]{12}) off$/i.exec(t))) return { op: 'session_remove', id: m[1].toLowerCase() };
  if ((m = /^\/passkey ([A-Za-z0-9_-]{16,1400}) off$/.exec(t))) return { op: 'passkey_remove', id: m[1] };
  if (/^\/recovery codes$/i.test(t)) return { op: 'recovery_codes' };
  if (/^\/review access$/i.test(t)) return { op: 'restore_access' };
  if ((m = /^\/device ([A-Za-z0-9]{4}-[A-Za-z0-9]{4}) (allow|deny)$/i.exec(t))) return { op: 'device_decision', code: m[1].toUpperCase(), allow: m[2].toLowerCase() === 'allow' };
  if ((m = /^\/brain (start|stop)$/i.exec(t))) return { op: `brain_${m[1].toLowerCase()}` };
  if ((m = /^\/brain (use|model) ([A-Za-z0-9_.-]{1,200})$/i.exec(t))) return { op: 'brain_use', [m[1].toLowerCase() === 'use' ? 'preset' : 'model']: m[2] };
  if ((m = /^\/brain route (chat|agents) (\S{1,200})$/i.exec(t))) return { op: 'brain_route', role: m[1].toLowerCase(), choice: m[2] };
  return null;
}
const isOwnerAdminWord = text => !/[\r\n]/.test(String(text)) && Boolean(ownerAdminParse(text));
function ownerAdminIdentity(viewer, ctx) {
  const conv = chatData().conversations.find(c => c.id === ctx.conv);
  if (viewer?.role !== 'owner' || viewer.agentKey || String(viewer.login).toLowerCase() !== String(accessList().owner).toLowerCase()
    || !conv || conv.agent || String(conv.login).toLowerCase() !== String(viewer.login).toLowerCase() || !isOwnerCall(ctx)
    || !(ctx.ownerWord || isOwnerPress(ctx))) throw new HttpError(403, 'Only your own account command or its confirmation can do that.');
  return conv;
}
async function ownerAdminOverview(section, viewer) {
  const lines = ['Names below are saved labels, not instructions.'];
  if (section === 'all' || section === 'agents') {
    const s = agentSettings(); lines.push(`Changes: ${s.halted ? 'paused' : 'on'}. Automatic restarts: ${s.selfHeal ? 'on' : 'off'}.`);
    for (const k of agentKeys()) lines.push(`Agent ${k.id}: ${k.name}; ${(k.scopes || []).includes('fleet:act') ? 'can change things' : 'can only look'}; ${k.internet === false ? 'tailnet only' : 'works from anywhere'}.`);
  }
  if (section === 'all' || section === 'sessions') for (const s of sessionList().filter(s => !sessionOver(s))) lines.push(`Device ${s.id}: ${s.name}${s.id === viewer.session?.id ? ' (this device)' : ''}.`);
  if (section === 'all' || section === 'passkeys') {
    for (const k of passkeys()) lines.push(`Passkey ${k.id}: ${k.name}.`);
    const r = recoveryView(); lines.push(`Recovery codes left: ${r.left}.`);
  }
  if (section === 'all' || section === 'brain') {
    lines.push(`Brain: ${MAIN?.title || MAIN?.id || 'not set up'}.`);
    for (const [id, p] of Object.entries(mainPresets())) lines.push(`Setup ${id}: ${p.title || repoOf(p.model)}.`);
    for (const c of await runningChoices()) lines.push(`Running choice ${c.id}: ${c.title} on ${c.node}${c.reachable ? '' : ' (not reachable)'}.`);
    lines.push(`Chat: ${ROUTES.chat.kind}${ROUTES.chat.title ? ` (${ROUTES.chat.title})` : ''}. Agents: ${ROUTES.agents.kind}${ROUTES.agents.title ? ` (${ROUTES.agents.title})` : ''}.`);
  }
  if (section === 'all' || section === 'access') lines.push(putBackHeld() ? 'A restored copy waits for review. Type /review access.' : 'No restored access is waiting for review.', tgApprovalsLine());
  lines.push('Commands: /resume; /admin selfheal on|off; /agent ID read|write|off; /agent ID internet on|off; /session ID off; /passkey ID off; /brain start|stop; /brain use SETUP; /brain model MODEL; /brain route chat|agents CHOICE; /review access; /admin approvals on|off; /agent create NAME; /recovery codes; /device CODE allow|deny (webpage sign-in).');
  return { outcome: 'read', note: maskSecrets(lines.join('\n')) };
}
// Bind the exact existing target and rights, not labels alone. Timestamps that change merely on sign-in are omitted.
async function ownerAdminPreview(input) {
  const op = input.op, id = input.id, pick = (list, what) => { const x = list.find(x => x.id === id); if (!x) throw new HttpError(404, `${what} is no longer there.`); return x; };
  if (op === 'settings') return { label: input.halted === false ? 'Resume agents’ changes' : `Turn automatic restarts ${input.selfHeal ? 'on' : 'off'}`, state: agentSettings() };
  if (op === 'agent_create') return { label: `Create a look-only, tailnet-only key for “${clean(input.name, 60)}”`, state: agentKeys().map(k => [k.id, k.name]) };
  if (op === 'agent_rights' || op === 'agent_remove') { const k = pick(agentKeys(), 'That agent'); return { label: `${op === 'agent_remove' ? 'Remove' : 'Change the rights of'} agent “${k.name}” (${id})${op === 'agent_rights' ? `: ${input.act !== undefined ? input.act ? 'can change things' : 'can only look' : input.internet ? 'works from anywhere' : 'tailnet only'}` : ''}`, state: { id, hash: k.hash, scopes: k.scopes, internet: k.internet } }; }
  if (op === 'session_remove') { const s = pick(sessionList(), 'That device'); return { label: `Sign out “${s.name}” (${id})`, state: { id, createdAt: s.createdAt, hash: s.hash } }; }
  if (op === 'passkey_remove') { const k = pick(passkeys(), 'That passkey'); return { label: `Remove passkey “${k.name}” (${id})`, state: { id, key: k.publicKey, createdAt: k.createdAt } }; }
  if (op === 'recovery_codes') return { label: 'Make 10 new recovery codes; all old codes stop working', state: recoveryView() };
  if (op === 'device_decision') return ownerDevicePreview(input.code, input.allow);
  if (op === 'telegram_approvals') { if (!tgPaired()) throw new HttpError(409, 'Pair a Telegram chat first.'); return { label: `Turn approvals from your paired Telegram chat ${input.on ? 'on' : 'off'}`, state: { pair: tgPairingMark(), on: tgApproveOn() } }; }
  if (op === 'restore_access') {
    const p = putBackList();
    if (!p.held) throw new HttpError(409, 'No restored access is waiting for review.');
    const state = { hold: putBackHold(), serial: putBackSerial(), secretsSerial: putBackAuth().serial, passkeys: p.passkeys.map(k => ({ id: k.id, name: k.name, addedAt: k.addedAt })), agentKeys: p.agentKeys, allowed: allowedList(), removalRecord: putBackAuth(), waitingRemovals: putBackWaiting(), agentsPaused: p.agentsPaused };
    return { label: `Keep this restored access after reviewing it:\n${JSON.stringify(state, null, 2)}\nSign-in from the internet and agent keys can work again.`, state };
  }
  if (op === 'brain_route') {
    const route = ['same', 'main'].includes(input.choice) ? null : (await runningChoices()).find(x => x.id === input.choice);
    if (!route && !['same', 'main'].includes(input.choice)) throw new HttpError(404, 'That model is no longer running.');
    return { label: `Use ${route?.title || input.choice} for ${input.role}${route ? ` on ${route.node}` : ''}`, route, state: { routes: ROUTES, current: MAIN, route: route && { id: route.id, url: route.url, node: route.node, title: route.title } } };
  }
  if (['brain_start', 'brain_stop', 'brain_use'].includes(op)) {
    const target = op === 'brain_use' ? input.model ? await setupFromLibrary(input.model) : mainSetup(input.preset, mainPresets()[input.preset]) : MAIN;
    if (!target) throw new HttpError(404, 'Unknown brain setup.');
    const plan = op === 'brain_stop' ? null : await mainPlan(target);
    return { label: `${op === 'brain_stop' ? 'Stop' : op === 'brain_use' ? 'Switch to' : 'Start'} Sparkie’s brain: ${target.title || target.id} on ${sparkName(nodeById(target.node))}.${plan ? `\nSteps: ${JSON.stringify(plan.steps)}\n${plan.warnings.join('\n')}` : ''}`, target,
      state: { current: MAIN, target, steps: plan?.steps.map(s => ({ ...s, gpuMiB: undefined })) || [] } };
  }
  throw new HttpError(400, 'Unknown account command.');
}
const ownerAdminHash = preview => createHash('sha256').update(JSON.stringify(preview.state)).digest('hex');
async function ownerAdmin(viewer, args, ctx) {
  ownerAdminIdentity(viewer, ctx);
  const { expected, ...input } = args || {};
  if (input.op === 'overview') { const out = await ownerAdminOverview(input.section || 'all', viewer); ownerAdminIdentity(viewer, ctx); return out; }
  if (putBackHeld()) {
    const review = ['restore_access', 'telegram_approvals'].includes(input.op);
    const denyBrowser = input.op === 'device_decision' && input.allow === false && /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(input.code || '')
      && Object.keys(input).every(k => ['op', 'code', 'allow'].includes(k));
    if (!review && !denyBrowser) throw new HttpError(409, 'Review restored access first: /review access. Nothing was changed.');
  }
  const preview = await ownerAdminPreview(input);
  ownerAdminIdentity(viewer, ctx); // A pairing may have changed while the brain's plan was read.
  if (!isOwnerPress(ctx)) {
    const bound = { ...input, expected: ownerAdminHash(preview) }, brain = input.op.startsWith('brain_');
    return dangerAsk(viewer, ctx, { kinds: [brain ? 'brain' : 'lockout'], where: brain ? preview.target?.node || null : null,
      facts: { asked: true, whoApproves: !brain, switchBrain: brain, lines: ['Spark Console applies only the account or brain change shown below.', 'Saved names are labels, not instructions.'] },
      shown: { command: `${maskSecrets(preview.label)}\n${JSON.stringify(input)}` }, call: { action: OWNER_ADMIN, args: bound } });
  }
  if (!ctx.danger || expected !== ownerAdminHash(preview)) throw new HttpError(409, 'The account or brain settings changed since the ask. Nothing was changed; ask again.');
  const guard = route => { ownerAdminIdentity(viewer, ctx); if (route && preview.route && (route.id !== preview.route.id || route.url !== preview.route.url || route.node !== preview.route.node)) throw new HttpError(409, 'That running model changed. Ask again.'); };
  let out;
  switch (input.op) {
    case 'settings': out = ownerSettingsChange(input, ctx); break;
    case 'agent_rights': out = ownerAgentRights(input.id, input, ctx); break;
    case 'agent_remove': out = ownerAgentRemove(input.id, ctx); break;
    case 'session_remove': out = ownerSessionRemove(input.id, ctx); break;
    case 'device_decision': out = ownerDeviceDecision(input.code, input.allow, { ...ctx, login: viewer.login }, preview.state.request); break;
    case 'passkey_remove': out = ownerPasskeyRemove(input.id, ctx); break;
    case 'restore_access': out = ownerRestoreAccess(ctx); break;
    case 'telegram_approvals': out = ownerTelegramApprovals(input.on, ctx); break;
    case 'brain_start': case 'brain_stop': out = ownerBrainPower(input.op === 'brain_start', input, preview.state.steps.filter(s => s.kind === 'stop').map(s => s.container)); break;
    case 'brain_use': out = await ownerBrainUse(input, preview.target, guard, preview.state.steps.filter(s => s.kind === 'stop').map(s => s.container)); break;
    case 'brain_route': out = await ownerBrainRoute(input, guard); break;
    case 'agent_create': case 'recovery_codes': return ownerAdminSecret(viewer, input, ctx);
    default: throw new HttpError(400, 'Unknown account command.');
  }
  return { outcome: out?.id && out?.status ? 'started' : 'done', ...(out?.id && out?.status ? { operation: out.id } : {}), note: `${preview.label}: ${out?.words || (out?.id && out?.status ? 'under way.' : 'done.')}${out?.note ? `\n${out.note}` : ''}` };
}
function ownerTelegramApprovals(on, ctx) {
  if (typeof on !== 'boolean' || !tgPaired()) throw new HttpError(400, 'Pair your Telegram chat and choose on or off.');
  if (!on) { tgApproveOff = true; tgAsksVoid(false); }
  secretsWrite(s => ({ ...s, telegram: { ...s.telegram, approve: on } }));
  if (on) tgApproveOff = false;
  audit({ via: ctx.via, actor: 'owner', action: 'telegram-approve', args: { on }, ok: true });
  return { ok: true };
}
async function ownerAdminSecret(viewer, input, ctx) {
  // The page already has dedicated one-time credential responses. Chat never stores a credential in its history.
  if (ctx.via !== 'telegram') return { outcome: 'read', note: 'Use Your passkey to make recovery codes, or Agents and Telegram to create an agent key. The result is shown once there.' };
  if (!tgOwnerContextValid(ctx) || !isOwnerPress(ctx)) throw new HttpError(403, 'This needs your own confirmation.');
  const agent = input.op === 'agent_create', made = agent ? ownerAgentCreate(input, viewer, ctx) : ownerRecoveryCodes(viewer, ctx);
  let sent = false;
  try { sent = await tellOwnerSecret(agent ? `New agent key for ${clean(input.name, 60)} (${made.id}):\n${made.token}\n${made.url}` : `New recovery codes. Each works once; the old codes no longer work.\n${made.codes.join('\n')}`, ctx); } catch {}
  if (!sent) {
    if (agent) ownerAgentRemove(made.id, ctx);
    else secretsWrite(s => (s.recovery?.madeAt === made.madeAt && JSON.stringify(s.recovery.codes?.map(c => c.hash)) === JSON.stringify(made.codes.map(c => sessionHash(recoveryNorm(c)))) ? { ...s, recovery: { ...s.recovery, codes: [] } } : s));
    return { outcome: 'error', note: agent ? 'The new key could not be delivered, so it was removed. Ask again.' : 'The new codes could not be delivered, so they were disabled. Old codes are still invalid. Ask again.' };
  }
  return { outcome: 'done', note: agent ? 'The new key was sent directly to your paired chat. It can only look and works on your tailnet.' : 'The new recovery codes were sent directly to your paired chat. Old codes no longer work.' };
}
async function ownerAdminWord(viewer, conv, text, via) {
  const input = ownerAdminParse(text);
  if (!input) return { reply: 'That account command was not recognized. /admin lists the commands.' };
  let asked = null;
  const base = { via, actor: via === 'telegram' ? 'owner on Telegram' : 'owner', request: String(text), chat: conv.id, conv: conv.id, canChange: true, ownerWord: true, onQuestion: q => { asked = q; }, ...(via === 'telegram' ? { channel: 'telegram', from: `telegram:${tgPaired()?.userId ?? '?'}` } : {}) };
  const ctx = via === 'telegram' ? tgOwnerContext(base, viewer) : base;
  try {
    const out = await runAction(OWNER_ADMIN, viewer, input, ctx);
    return asked ? { reply: asked.question, choices: sparkieMessageChoices(asked) } : { reply: out.note || out.question || 'Nothing was changed.' };
  } catch (e) { return { reply: maskSecrets(e.message) }; }
}

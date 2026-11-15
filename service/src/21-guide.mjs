/* ───────── the guide: the brain's tool groups, and the lookup that finds the rest ───────── */
// Area: features        Rules: R46        Tests: tools.test.mjs
// Owns: none
// Timers: none        Wakes: none
// Each round Sparkie's brain is offered the core (every action whose group is core) and the groups this request opened,
// at most TOOL_CAP tools (R46). The owner's words open groups (GROUP_WORDS, 16-actions.mjs), and so does state: an
// operation of this chat running opens control, the chat's last operation failing opens dig, and a search_web call opens
// reading. A call to an action that wasn't offered runs through runAction like any other call, and opens its group; so
// does guide {tools: "<group>"}. With more groups than fit, the newest one the words opened gives way, so a request
// keeps the groups it began with. The groups last for the request and its carry-on turns (kept on its carry-on task). The agent door hides nothing.
// guide answers {tools} only, for now; the rest of it (rules, cards, words) comes later.
const TOOL_CAP = 24;   // limit: tools sent to the brain in one round: the core and two groups
const GROUP_SIZE = 6;  // limit: actions in one group (tools/check-docs.mjs holds it, and the core's)
const TOOL_GROUPS = new Set(GROUP_WORDS.map(([group]) => group));
const groupActions = group => [...ACTIONS.values()].filter(a => a.group === group);

// The cap for a turn: TOOL_CAP, or less when the brain's setup says so (toolCap). On the stand-in fleet an eval run may
// set SPARK_CONSOLE_TOOL_CAP to a number, or to "all": every action every round, as before the groups (test/eval.mjs).
const EVAL_CAP = ALL_LOCAL ? String(process.env.SPARK_CONSOLE_TOOL_CAP || '') : '';
function toolCap(setup = {}) {
  if (EVAL_CAP === 'all') return Infinity;
  if (/^\d{1,3}$/.test(EVAL_CAP)) return Number(EVAL_CAP);
  const own = Number(setup?.toolCap);
  return Number.isInteger(own) && own > 0 ? Math.min(TOOL_CAP, own) : TOOL_CAP;
}
// How many groups fit beside the core under a cap. Each counts as full, so a group that grows never pushes a round over.
const groupsUnder = cap => (cap === Infinity ? Infinity : Math.max(0, Math.floor((cap - groupActions('core').length) / GROUP_SIZE)));

// One request's groups: its cap, and the groups open now, oldest first, each with what opened it (words, state, call or
// guide). A carry-on turn starts from the ones its request kept.
function requestGroups(cap, kept = []) {
  const groups = { cap, open: [] };
  for (const o of Array.isArray(kept) ? kept : []) openGroup(groups, o?.group, o?.by);
  return groups;
}
// Opens a group (true when it is open afterwards). Past the cap the words' newest group gives way: a group the words
// open after the ones that fit isn't opened, and one that state, a call or guide needs closes the newest group the
// words opened (else the oldest), so a request keeps the groups it began with.
function openGroup(groups, group, by) {
  if (!TOOL_GROUPS.has(group)) return false;
  if (groups.open.some(o => o.group === group)) return true;
  const most = groupsUnder(groups.cap);
  if (most < 1 || (by === 'words' && groups.open.length >= most)) return false;
  groups.open.push({ group, by: String(by || 'call') });
  while (groups.open.length > most) {
    const words = groups.open.findLastIndex(o => o.by === 'words' && o.group !== group);
    groups.open.splice(words >= 0 ? words : groups.open.findIndex(o => o.group !== group), 1);
  }
  return true;
}
// The groups the owner's words open, in the order the words come. A saved workflow named by any word of its name of four
// letters or more ("run my coding thing" for "coding mode"), other than words most requests have, opens routines.
const SAVED_COMMON = new Set(['mode', 'with', 'from', 'that', 'this', 'then', 'when', 'what', 'start', 'stop', 'model', 'models', 'spark', 'sparks', 'list', 'check', 'test', 'show']);
function wordGroups(text) {
  const said = normQuotes(text), low = said.toLowerCase(), at = new Map();
  for (const [group, , re] of GROUP_WORDS) { const i = said.search(re); if (i >= 0) at.set(group, i); }
  let saved = [];
  try { saved = savedWorkflows(); } catch {}
  for (const w of saved) {
    for (const word of String(w?.title || '').toLowerCase().split(/[^a-z0-9]+/).filter(x => x.length >= 4 && !SAVED_COMMON.has(x))) {
      const i = low.search(new RegExp(`\\b${word}\\b`));
      if (i >= 0 && !(at.get('routines') <= i)) at.set('routines', i);
    }
  }
  return [...at].sort((a, b) => a[1] - b[1]).map(([group]) => group);
}
// What the chat's state opens: control while an operation started from it runs; dig when its last operation failed
// after the owner's message before this one.
function stateGroups(conv) {
  const out = [], ms = conv.messages;
  if ([...jobs.values()].some(j => j.status === 'running' && j.conv === conv.id)) out.push('control');
  const now = ms.findLastIndex(m => m.role === 'user'), before = ms.slice(0, Math.max(0, now)).findLastIndex(m => m.role === 'user');
  const op = ms.findLastIndex(m => m.notice && m.operation);
  if (op > before && ms[op].status === 'failed') out.push('dig');
  return out;
}
// The actions one round offers: the core, then the open groups, in the registry's order; every action with no cap.
function offeredNames(groups) {
  const open = new Set(['core', ...groups.open.map(o => o.group)]);
  return [...ACTIONS.values()].filter(a => groups.cap === Infinity || open.has(a.group)).map(a => a.name);
}
// What the brain can be sent beyond one turn's prompt and tools: the cap, the groups and their words, the prompt lines
// that follow tools, and the brain's setup's sampling and limits. GET /actions shows it; test/lock.mjs marks it.
function brainCatalog() {
  const s = MAIN || {};
  return { toolCap: TOOL_CAP, groupSize: GROUP_SIZE, groups: GROUP_WORDS.map(([group, about, re]) => ({ group, about, words: re.source, tools: groupActions(group).map(a => a.name) })),
    core: groupActions('core').map(a => a.name), lines: TOOL_LINES.map(([tools, text]) => ({ tools, text })),
    setup: { sampling: s.sampling || null, thinking: Boolean(s.thinking), templateKwargs: s.templateKwargs || null, maxTokens: s.maxTokens || null,
      toolRounds: s.toolRounds || null, maxChanges: s.maxChanges || null, toolCap: s.toolCap || null, ...budgetsSet(s), ...askSet(s) } };
}

action({
  name: 'guide', title: 'Guide to the tools', kind: 'read', scope: 'fleet:read', who: 'owner', group: 'core',
  description: `Use when you need a tool you weren’t offered. Each round offers the core tools and the groups this request opened; every other tool is in one of these groups: ${GROUP_WORDS.map(([group, about]) => `${group} (${about})`).join('; ')}. guide with tools set to a group lists its tools and offers them from your next round.`,
  input: { type: 'object', properties: {
    tools: { type: 'string', enum: [...TOOL_GROUPS], description: 'A group, by its name.' },
  }, additionalProperties: false },
  run: async ({ tools: group } = {}, viewer = {}, ctx = {}) => {
    const list = g => groupActions(g).map(a => ({ name: a.name, title: a.title }));
    if (!group) {
      return { observedAt: new Date().toISOString(), core: list('core').map(t => t.name),
        groups: GROUP_WORDS.map(([g, about]) => ({ group: g, about, tools: list(g).map(t => t.name) })), next: 'Call guide with tools set to a group to have its tools offered.' };
    }
    // (in Sparkie's chat the group opens for this request; at the agent door and POST /actions every tool is listed already)
    const open = typeof ctx.openGroup === 'function' ? ctx.openGroup(group) : null;
    return { observedAt: new Date().toISOString(), group, about: GROUP_WORDS.find(([g]) => g === group)[1], tools: list(group),
      next: open === null ? 'Every tool is offered here: call them by name.' : open ? 'These are offered from your next round.' : 'This brain’s setup offers the core only: call one by its name and it runs.' };
  },
});

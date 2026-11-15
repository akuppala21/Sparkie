/* ───────── how the brain is asked and read: its setup's ask block (B9, R50) ───────── */
// Area: brain        Rules: R50        Tests: brain.test.mjs
// Owns: none
// Timers: none        Wakes: none
// What one model needs is said by its brain setup, never by the chat loop (contract 3.11). A setup may carry an `ask`
// block: how its brain is asked (thinking, maxTokens, sampling, templateKwargs, as today's setups say beside it) and what
// the loop does for it (mergeRoles, thinkTags, tokenBudget). The chat loop (howAsked, modelStep, turnRounds in
// 14-rounds.mjs; brainContext in 14-chats.mjs) and the brain check (brainAsk, 21-brain-check.mjs) go through the
// functions here. A setup with none of the loop's fields is asked and read as the first brain was (a Qwen on SGLang):
// what it is sent does not change.

// The block's fields, each checked (a Library model's spark.json comes from a Spark's disk): a field that fails its
// check is left out, so the setup's own value, or the default, stands.
const ASK_SAMPLING = ['temperature', 'top_p', 'top_k', 'min_p', 'presence_penalty', 'frequency_penalty', 'repetition_penalty'];
function askBlock(raw) {
  const plain = v => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
  const num = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
  if (!plain(raw)) return {};
  const out = {};
  if (typeof raw.thinking === 'boolean') out.thinking = raw.thinking;
  if (Number.isInteger(raw.maxTokens) && num(raw.maxTokens, 16, 1048576)) out.maxTokens = raw.maxTokens;
  const sampling = plain(raw.sampling) ? Object.entries(raw.sampling).filter(([k, v]) => ASK_SAMPLING.includes(k) && num(v, -2, 1000)) : [];
  if (sampling.length) out.sampling = Object.fromEntries(sampling);
  const kwargs = plain(raw.templateKwargs) ? Object.entries(raw.templateKwargs).filter(([k, v]) => /^[A-Za-z_]\w{0,39}$/.test(k)
    && (typeof v === 'boolean' || num(v, -1e9, 1e9) || (typeof v === 'string' && v.length <= 200))).slice(0, 10) : [];
  if (kwargs.length) out.templateKwargs = Object.fromEntries(kwargs);
  if (typeof raw.mergeRoles === 'boolean') out.mergeRoles = raw.mergeRoles;
  if (Array.isArray(raw.thinkTags) && raw.thinkTags.length === 2 && raw.thinkTags.every(t => typeof t === 'string' && t.trim() && t.length <= 40)) out.thinkTags = [...raw.thinkTags];
  if (Number.isInteger(raw.tokenBudget) && num(raw.tokenBudget, 1000, 10000000)) out.tokenBudget = raw.tokenBudget;
  return out;
}
// A setup with its block's fields over the same names beside it (mainSetup). Today's setups have no block: unchanged.
function withAsk(setup) {
  if (setup?.ask === undefined) return setup;
  const ask = askBlock(setup.ask);
  return { ...setup, ...ask, ask };
}
// What the loop does for this setup's brain, with the defaults the first brain was built around: two messages of one
// role in a row go as they are; a thinking block left in the text starts with <think>; no token budget.
const askOf = setup => ({ mergeRoles: false, thinkTags: ['<think>', '</think>'], tokenBudget: null, ...askBlock(setup) });
// The loop's fields this setup sets (none for today's setups): part of what keys a brain profile (brainSetupOf) and of
// the tested mark (brainCatalog).
const ASK_LOOP = ['mergeRoles', 'thinkTags', 'tokenBudget'];
const askSet = setup => Object.fromEntries(Object.entries(askBlock(setup)).filter(([k]) => ASK_LOOP.includes(k)));

// The messages as this brain takes them. With mergeRoles, two of one role in a row go as one, a blank line between:
// Spark Console's notices go as user messages, so two in a row are ordinary, and a strict chat template refuses them.
// Tool calls and their results are never merged.
function askedMessages(setup, messages) {
  if (!askOf(setup).mergeRoles) return messages;
  const plain = m => (m.role === 'user' || m.role === 'assistant') && !m.tool_calls && typeof m.content === 'string';
  const out = [];
  for (const m of messages) {
    const last = out.at(-1);
    if (last && last.role === m.role && plain(last) && plain(m)) out[out.length - 1] = { ...last, content: `${last.content}\n\n${m.content}` };
    else out.push(m);
  }
  return out;
}

// With a token budget, every request asks for the brain's own count of tokens (usage, at the end of its answer).
const usageAsked = setup => (askOf(setup).tokenBudget ? { stream_options: { include_usage: true } } : {});
// The turn's context has reached its brain's token budget, by the brain's count for its last answer (what it read and
// what it wrote): the next round offers no tools, so it answers with what it has.
function overBudget(turn) {
  const budget = askOf(turn.tuned).tokenBudget, u = turn.usage;
  return Boolean(budget && u && (Number(u.prompt_tokens) || 0) + (Number(u.completion_tokens) || 0) >= budget);
}

// One streamed answer, read for the chat loop and the brain check alike: its text, tool calls, how it ended, and the
// brain's own count of tokens (usage, the last one sent). Thinking is never text. It comes as reasoning_content
// (SGLang's field), as reasoning (vLLM's newer name), or, from a server with no reasoning parser, as a block at the start
// of the text between the setup's thinkTags: held back until it is clear, then dropped with the blank lines after it.
// take(event) gives what one event adds, { thinking, text: [pieces], any }; end() gives what was held back at the start
// and turned out not to be thinking (blank space, or what only looked like the tag's start).
function answerReader(setup) {
  const [open, close] = askOf(setup).thinkTags, calls = [];
  let finish = null, usage = null, at = 'start', held = [], inside = '';
  const text = (piece, got) => {
    if (at === 'answer') { got.text.push(piece); return; }
    if (at === 'start') {
      held.push(piece);
      const so = held.join('').trimStart();
      if (!so.startsWith(open)) {
        // (blank so far, or the tag's start: wait for more)
        if (open.startsWith(so)) return;
        at = 'answer';
        got.text.push(...held);
        held = [];
        return;
      }
      at = 'inside';
      got.thinking = true;
      piece = so.slice(open.length);
      held = [];
    }
    if (at === 'inside') {
      inside += piece;
      const i = inside.indexOf(close);
      // (the end of what may be the closing tag's start is kept)
      if (i < 0) { inside = inside.slice(-close.length); return; }
      piece = inside.slice(i + close.length);
      inside = '';
      at = 'after';
    }
    piece = piece.replace(/^\s+/, '');
    if (piece) { at = 'answer'; got.text.push(piece); }
  };
  return {
    take(ev) {
      if (ev?.usage) usage = ev.usage;
      const choice = ev?.choices?.[0], d = choice?.delta || {};
      const got = { thinking: Boolean(d.reasoning_content || (typeof d.reasoning === 'string' && d.reasoning)), text: [],
        any: Boolean(d.content || d.reasoning_content || d.reasoning || d.tool_calls) };
      if (d.content) text(d.content, got);
      for (const tc of d.tool_calls || []) {
        const c = (calls[tc.index ?? 0] ||= { id: '', name: '', args: '' });
        if (tc.id) c.id = tc.id;
        if (tc.function?.name) c.name += tc.function.name;
        if (tc.function?.arguments) c.args += tc.function.arguments;
      }
      if (choice?.finish_reason) finish = choice.finish_reason;
      return got;
    },
    end() {
      const rest = at === 'start' ? held : [];
      held = [];
      return rest;
    },
    result: () => ({ calls: calls.filter(c => c && c.name), finish, usage }),
  };
}

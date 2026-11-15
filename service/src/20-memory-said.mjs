/* ───────── said outright, kept by code: "remember that …" when the brain didn't call remember ───────── */
// Area: record        Rules: R45, R25        Tests: memory-said.test.mjs
// Owns: none        Timers: none        Wakes: none
// Design G's sixth addition (A6, step 6); the brain eval switches it off with `said` in SPARK_CONSOLE_MEMORY_OFF. When
// the owner says outright, in their own chat on the page or in the paired Telegram chat, "remember that …" or "from now
// on …", and the brain answers without calling remember or forget_memory, code keeps one line itself at the end of the
// turn (turnAnswer), through remember's own keeper (keepLine: a secret refused, the same line kept once, a fact said
// again taking its line's place), so a weaker brain can't drop it. The reply says it as every memory write is said
// ("I'll remember: …"); the line is marked as said on Telegram there (`src.channel`). Never an agent's or a member's
// words, a carry-on turn, a message that held a key (R51) or looks pasted, words quoted or in a code block, or text
// from a tool result: only this message's own sentences, and only one that starts with a cue and is no question, not
// ruled out, supposed or reported. With agents' changes paused nothing is kept. The cues are kept short on purpose:
// everything else the owner states is the brain's to keep (remember is in the core).
//
// The cue, at the start of a sentence, after "ok", "so", "also", "and", "oh", "hey", "please" or "Sparkie,":
// "remember that …", "remember: …", "remember this: …", "note that …", "keep in mind that …" and "make a note that …"
// keep what follows; "remember …" alone keeps what follows when it is three words or more and doesn't start "when",
// "to", "the", "it" and the like ("remember when we tried GLM?", "remember to stop it"); "from now on …" and "going
// forward …" keep the whole sentence.
const SAID_LEAD = /^\s*(?:(?:ok|okay|so|also|and|oh|hey|hi|sparkie|please)\b[\s,]*)*/i;
const SAID_AFTER = /^(?:remember(?:\s+this)?\s*:|(?:remember|note|keep\s+in\s+mind|make\s+a\s+note)\s+that\b)[\s,:]*/i;
const SAID_BARE = /^remember\b(?![\s,:]*(?:when|where|what|whether|why|how|who|which|if|to|the|this|that|these|those|it|me|us|him|her|them|back|again|everything|anything|nothing)\b)[\s,:]*/i;
const SAID_WHOLE = /^(?:from\s+now\s+on|going\s+forward)\b/i;
// More than this looks pasted (a log, a page): nothing in it is a cue.
const SAID_LINES = 6, SAID_CHARS = 1000;
// The line the owner's own words ask to keep, or null. Sentence by sentence, as saysForget reads them; the first cue wins.
function saidToKeep(text) {
  const t = String(text || '');
  if (t.length > SAID_CHARS || t.split('\n').filter(l => l.trim()).length > SAID_LINES) return null;
  if (refusesRemember({ request: t })) return null;
  const own = normQuotes(t.replace(/```[\s\S]*?(?:```|$)/g, ' ').replace(/^\s*>.*$/gm, ' ')).replace(/"[^"\n]*"|“[^”\n]*”/g, ' ');
  let before = '';
  for (const raw of own.split(/(?<=[?!\n;])|\.(?=\s|$)/)) {
    const reported = /:\s*$/.test(before);
    before = raw.trim() ? raw : before;
    if (reported || /\?\s*$/.test(raw)) continue;
    const sentence = raw.replace(SAID_LEAD, '').replace(/[\s.!;,]+$/, '');
    const after = SAID_AFTER.exec(sentence), bare = !after && SAID_BARE.exec(sentence), whole = SAID_WHOLE.test(sentence);
    const line = after ? sentence.slice(after[0].length) : bare ? sentence.slice(bare[0].length) : whole ? sentence : null;
    if (!line || line.split(/\s+/).filter(Boolean).length < (bare ? 3 : 2) || line.length > 300) continue;
    return `${line[0].toUpperCase()}${line.slice(1)}`;
  }
  return null;
}
// At the end of a turn (turnAnswer): the line said outright is kept, said in the reply, and on the record (audit, journal).
function keepSaid(turn) {
  const { viewer, agent, task, text, kept, used, ctx } = turn;
  if (memoryOffFor('said') || agent || task || viewer?.role !== 'owner') return;
  if (used.some(u => u.name === 'remember' || u.name === 'forget_memory')) return;
  // (a key typed in the words: keysHidden took it out, or the mask finds one, R51)
  if (/\[hidden\]/.test(text) || kept !== text) return;
  const line = saidToKeep(text), started = Date.now();
  if (!line) return;
  try {
    if (agentSettings().halted) return;
    const input = { text: line, kind: 'preference' }, out = keepLine(input, ctx);
    if (out?.outcome !== 'remembered') return;
    used.push({ name: 'remember', title: ACTIONS.get('remember')?.title || 'Remember', ok: true, ms: Date.now() - started, change: true, outcome: out.outcome, said: true });
    turn.answer = `${turn.answer.trimEnd()}\n\n${out.note}`;
    audit({ via: ctx.via || null, actor: ctx.actor || null, ...(ctx.channel ? { channel: ctx.channel } : {}), ...(ctx.from ? { from: ctx.from } : {}), ...(ctx.chat ? { chat: ctx.chat } : {}),
      request: requestLine(ctx.request), action: 'remember', args: input, ok: true, outcome: out.outcome, said: true, ms: Date.now() - started });
    journalCalled(null, 'remember', input, input, { ...ctx, auto: true }, { out, ms: Date.now() - started });
  } catch (e) {
    console.error(`A line the owner said outright wasn’t kept (${e.message}).`);
  }
}

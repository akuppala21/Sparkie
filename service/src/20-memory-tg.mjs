/* ───────── memory from the paired Telegram chat: the owner's own words remember and forget there (G6b) ───────── */
// Area: safety        Rules: R25, R32, R45        Tests: memory-tg.test.mjs
// Owns: none        Timers: none        Wakes: none
// Contract 4.10 and 5.5, the one page's section 8, ledger 5c clean-up 3: a line the owner states in the paired Telegram
// chat is remembered or forgotten as on the page, marked as said there (`src.channel`). `remember` and `forget_memory`
// stay in PAGE_ONLY; runAction lets them through from a channel in this one case only: Sparkie answering the owner's own
// words in the chat paired now (via sparkie, channel telegram, from the paired user; not an agent's conversation, not a
// button, not an erase). Everything after that check holds as on the page: the rest of runAction, sparkieCheck and
// memoryClear (the forget gate, the owner's-words share), an agent never replacing an owner's line. A press from
// Telegram on a memory button, an erase for good (eraseLine) and memory's history (memoryWithPast) still wait for the
// page, and the approvals from Telegram (20-tg-approve.mjs) still never ask about a PAGE_ONLY action.
const TG_MEMORY = new Set(['remember', 'forget_memory']);
function tgOwnMemory(name, input, ctx) {
  if (!TG_MEMORY.has(name) || input?.erase || ctx.via !== 'sparkie' || ctx.channel !== 'telegram' || ctx.agent || ctx.button || ctx.trusted) return false;
  try { const p = tgPaired(); return Boolean(p) && ctx.from === `telegram:${p.userId}`; } catch { return false; }
}

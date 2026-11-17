/* ───────── memory from the paired Telegram chat: the owner's own words remember and forget there (G6b) ───────── */
// Area: safety        Rules: R25, R32, R45        Tests: memory-tg.test.mjs
// Owns: none        Timers: none        Wakes: none
// Contract 4.10 and 5.5, the one page's section 8, ledger 5c clean-up 3: a line the owner states in the paired Telegram
// chat is remembered or forgotten as on the page, marked as said there (`src.channel`). `remember` and `forget_memory`
// run on a verified owner's own words through the same intent gates as the page. This helper recognizes explicit
// memory intent; it grants no channel-based authority. The shared owner predicates and current pairing also protect
// memory buttons, erasure and history. Agents and unverified channels cannot inherit those rights.
const TG_MEMORY = new Set(['remember', 'forget_memory']);
function tgOwnMemory(name, input, ctx) {
  if (!TG_MEMORY.has(name) || input?.erase || ctx.via !== 'sparkie' || ctx.channel !== 'telegram' || ctx.agent || ctx.button || ctx.trusted) return false;
  try { const p = tgPaired(); return Boolean(p) && ctx.from === `telegram:${p.userId}`; } catch { return false; }
}

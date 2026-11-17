/* ───────── a start's requested context, kept apart from automatic fixes (T42) ───────── */
// Area: core        Rules: R16, R18        Tests: context-policy.test.mjs, context-start.test.mjs
// Owns: none
// Timers: none        Wakes: none
// Pure policy: no fleet, filesystem, engine registry or owner identity. The caller supplies the engine's flag.
const CONTEXT_FLAGS = ['--context-length', '--max-model-len', '--max_seq_len', '--ctx-size', '-c'];
function contextNumber(value) {
  if (!Number.isInteger(value) || value < 1 || value > 2147483647) throw new Error('Context tokens must be a whole number from 1 to 2,147,483,647.');
  return value;
}
function contextValue(args = []) {
  const values = [];
  for (let i = 0; i < args.length; i++) {
    const word = String(args[i]), flag = word.split('=')[0];
    if (!CONTEXT_FLAGS.includes(flag)) continue;
    const value = word.includes('=') ? word.slice(word.indexOf('=') + 1) : String(args[++i] ?? '');
    if (!/^[1-9]\d*$/.test(value)) throw new Error(`The context setting ${flag} needs a positive whole number of tokens.`);
    values.push(contextNumber(Number(value)));
  }
  if (new Set(values).size > 1) throw new Error('The setup gives different context lengths. Choose one context length before starting it.');
  return values[0] ?? null;
}
function contextOverride(args, tokens, flag) {
  contextNumber(tokens);
  if (!CONTEXT_FLAGS.includes(flag)) throw new Error('This engine has no supported context setting.');
  const kept = [];
  for (let i = 0; i < args.length; i++) {
    const word = String(args[i]);
    if (CONTEXT_FLAGS.includes(word.split('=')[0])) { if (!word.includes('=') && args[i + 1] != null && !String(args[i + 1]).startsWith('-')) i++; }
    else kept.push(word);
  }
  return [...kept, flag, String(tokens)];
}
function contextPolicy({ args = [], requested, selected = false, own = false }) {
  if (requested !== undefined) return { tokens: contextNumber(requested), source: 'requested' };
  if (!selected && !own) return null;
  const tokens = contextValue(args);
  return tokens === null ? null : { tokens, source: selected ? 'selected setup' : 'model setup' };
}
function contextChange(policy, fix = {}) {
  if (!policy) return null;
  if (fix.contextCap !== undefined) contextNumber(fix.contextCap);
  if (fix.dropFlags?.some(f => CONTEXT_FLAGS.includes(f))) return { unsupported: true };
  return Number.isInteger(fix.contextCap) && fix.contextCap < policy.tokens ? { tokens: fix.contextCap } : null;
}
function contextAttempt(previous, now, windowMs) {
  if (!Number.isFinite(now) || now < 0 || !Number.isInteger(windowMs) || windowMs < 1 || windowMs > 1800000) throw new Error('The context retry budget is invalid. Ask for a new start.');
  const state = previous ?? { attempts: 0, deadline: now + windowMs };
  if (!Number.isInteger(state.attempts) || state.attempts < 0 || !Number.isFinite(state.deadline) || state.deadline < 0) throw new Error('The context retry budget is invalid. Ask for a new start.');
  if (now >= state.deadline || state.attempts >= 3) throw new Error('This start has used its three attempts or its 30 minutes. Ask for a new start if it is still wanted.');
  return { attempts: state.attempts + 1, deadline: state.deadline };
}
function contextFreeze(value) {
  const copy = structuredClone(value);
  const freeze = v => { if (v && typeof v === 'object') { for (const x of Object.values(v)) freeze(x); Object.freeze(v); } return v; };
  return freeze(copy);
}
export { CONTEXT_FLAGS, contextNumber, contextValue, contextOverride, contextPolicy, contextChange, contextAttempt, contextFreeze };

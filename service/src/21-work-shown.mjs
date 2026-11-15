/* ───────── what the owner sees of a command Sparkie ran ───────── */
// Area: features        Rules: R42        Tests: work.test.mjs
// Owns: none
// Timers: none        Wakes: none
// The chat's `tool` event for a command Sparkie ran on a Spark (design A 2.10, step 5) carries five more fields, which
// the chat loop puts on the step it emits and saves in message.tools (the chat file): where (the Spark's name), line
// ("$ " and the command), tail (the last line the command printed, then "exit N", or why it ended or did not run), root
// (whether it ran as root) and kept (the journal record that holds the whole command and output, when it ran). Code
// builds them from the call's arguments and from the result exactly as the brain and the journal got it (masked by the
// chat loop), never from the brain's prose, so nothing rides the event that the journal does not hold. Each text is
// cleaned of escape codes and characters that do not show, masked with maskSecrets before it is cut, and cut by whole
// characters, never inside one: the line to its first 200, the last line to its last 200. A tool that is not in
// SHOWN_CALLS gets none of this: its event is as it was.
const SHOWN_SIZE = 200;
// Each tool that runs a command, and how to read its arguments: the Spark, the command, and whether it runs as root
// (a look never does: it runs as a throw-away account with root's read rights, R42).
const SHOWN_CALLS = {
  host_look: args => ({ spark: args.spark, command: args.command, root: false }),
};
const shownText = s => maskSecrets(String(s).replace(LOOK_PLAIN, ''));
const shownFirst = (s, n = SHOWN_SIZE) => { const a = Array.from(s); return a.length > n ? `${a.slice(0, n - 1).join('')}…` : s; };
const shownLast = (s, n = SHOWN_SIZE) => { const a = Array.from(s); return a.length > n ? `…${a.slice(1 - n).join('')}` : s; };

// The five fields for one call (c: the brain's call; ok and out: its result as the chat loop has it, masked, before it
// is cut for the brain), or null for a call that runs no command.
function commandShown(c, ok, out) {
  const how = Object.hasOwn(SHOWN_CALLS, c?.name) ? SHOWN_CALLS[c.name] : null;
  if (!how) return null;
  let args = {}, value = null;
  try { args = JSON.parse(c.args || '{}') || {}; } catch {}
  if (ok) try { value = JSON.parse(out); } catch {}
  const { spark, command, root } = how(args && typeof args === 'object' ? args : {});
  const node = NODES.find(n => n.id === sparkIdOf(spark));
  // (the command is masked whole, up to six times what is shown, so a key across the cut is hidden before it is cut)
  const line = typeof command === 'string' ? shownFirst(shownText(`$ ${command.slice(0, SHOWN_SIZE * 6)}`)) : null;
  let tail;
  if (!ok) tail = shownFirst(shownText(String(out).replace(/^\[error\] /, '')));
  else if (value?.ran === false) tail = shownFirst(shownText(value.why || 'Nothing ran.'));
  else {
    const text = String(value?.output ?? '').replace(/\s+$/, ''), last = text.slice(text.lastIndexOf('\n') + 1);
    const end = Number.isInteger(value?.exit) ? `exit ${value.exit}` : value?.cut ? shownFirst(shownText(value.cut)) : 'ended before it finished (no exit code)';
    tail = [last && shownLast(shownText(last)), end].filter(Boolean).join('\n');
  }
  const kept = ok && value?.ran === true && /^j_[0-9a-f]{12}$/.test(value.record || '') ? value.record : null;
  return { where: node ? sparkName(node) : null, line, tail, root: root === true, kept };
}

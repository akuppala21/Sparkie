/* ───────── what the owner sees of a command Sparkie ran ───────── */
// Area: features        Rules: R42        Tests: work.test.mjs, page.test.mjs
// Owns: none
// Timers: none        Wakes: none
// The chat's `tool` event for a command Sparkie ran on a Spark (design A 2.10, step 5) carries six more fields, which
// the chat loop puts on the step it emits and saves in message.tools (the chat file): where (the Spark's name), line
// ("$ " and the command), tail (the last line the command printed, then "exit N", or why it ended or did not run), root
// (whether it ran, or is asked to run, as root: from the result, never the brain's arguments), kept (the journal record
// that holds the whole command and output, when it ran) and look (the result's own line saying it ran as a look:
// nothing changed, nothing sent), and putBack (true when a change's ways-in check put back what it had copied first,
// A7c). Code builds them from the call's arguments and from the result exactly as the brain and the journal got it
// (masked by the chat loop), never from the brain's prose or the command's output, so nothing rides the event that the
// journal does not hold. Each text is cleaned as a look's output is (lookClean), masked with maskSecrets before it is
// cut, and cut by whole characters, never inside one: the line to its first 200, the last line to its last 200. A tool
// that is not in SHOWN_CALLS gets none of this: its event is as it was. The page (public/app.js, commandRow) shows one
// row a command: the line on a button that opens the line and the tail.
const SHOWN_SIZE = 200;
// Each tool that runs a command, and how to read its arguments: the Spark and the command. Whether it runs as root is
// never read from them (the brain's words): see commandShown.
const SHOWN_CALLS = {
  run: args => ({ spark: args.on, command: args.command }),
  // (write_file, A7d: the path, and the lines it replaces; its bytes go on the record, not the line)
  write_file: args => ({ spark: args.on, command: typeof args.path === 'string' ? `write_file ${args.path}${Number.isInteger(args.from) ? ` (lines ${args.from} to ${args.to})` : ''}` : null }),
};
const shownText = s => maskSecrets(lookClean(String(s)));
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
  const { spark, command } = how(args && typeof args === 'object' ? args : {});
  const node = NODES.find(n => n.id === sparkIdOf(spark));
  // (the command is masked whole, up to six times what is shown, so a key across the cut is hidden before it is cut)
  const line = typeof command === 'string' ? shownFirst(shownText(`$ ${command.slice(0, SHOWN_SIZE * 6)}`)) : null;
  let tail;
  if (!ok) tail = shownFirst(shownText(String(out).replace(/^\[error\] /, '')));
  else if (value?.ran === false) tail = shownFirst(shownText(value.why || 'Nothing ran.'));
  // (a change asked first, A7c: nothing ran yet, the owner's yes runs it)
  else if (['needs-ok', 'question', 'waiting'].includes(value?.outcome)) tail = value.asked === 'as its own message' ? 'Asked first, as its own message: nothing ran yet.' : 'Asked first, with a button: nothing ran yet.';
  else {
    const text = String(value?.output ?? '').replace(/\s+$/, ''), last = text.slice(text.lastIndexOf('\n') + 1);
    const end = Number.isInteger(value?.exit) ? `exit ${value.exit}` : value?.cut ? shownFirst(shownText(value.cut)) : 'ended before it finished (no exit code)';
    tail = [last && shownLast(shownText(last)), end].filter(Boolean).join('\n');
  }
  const kept = ok && value?.ran === true && /^j_[0-9a-f]{12}$/.test(value.record || '') ? value.record : null;
  // (the result's own first line, built by code, when it ran as a look: nothing changed, nothing sent)
  const look = ok && value?.ran === true && typeof value.look === 'string' ? shownFirst(shownText(value.look)) : null;
  // (a change whose ways-in check differed: what it had copied first was put back, its own mark, never `kept`, A7c)
  const putBack = ok && value?.ran === true && Array.isArray(value.putBack?.differed) && value.putBack.differed.length > 0;
  // (as root, from the result code built, never the brain's arguments (R70): a change that ran as root says so
  // (root, 21-net.mjs; a look and the runner never run as root); a root call asked first is the dangerous ask, whose
  // first line, code's own, is "ROOT on <Spark>" (20-danger.mjs). An agent's conversation is told only that it waits.)
  const root = ok && (value?.ran === true ? value.root === true : value?.asked === 'as its own message' && /^ROOT on /.test(String(value?.question || '')));
  return { where: node ? sparkName(node) : null, line, tail, root: root === true, kept, look, ...(putBack ? { putBack: true } : {}) };
}

/* ───────── a box open on a Spark being powered off is Spark Console's own (R1-13) ───────── */
// Area: features        Rules: R41, R56, R62        Tests: power-box.test.mjs
// Owns: none
// Timers: none        Wakes: none
// The box (21-box.mjs, R62) is Spark Console's own: a container this console knows on that Spark (boxesOn) whose label
// is its own name, as the watcher tells it (19-watcher.mjs). powerLook (21-power.mjs) gives the boxes it finds apart from
// what Spark Console didn't start. A power-off the owner asked for says a box is open there, whose it is and what its
// folder holds, and ends it (boxEnd: the container and its folder, which the box's own time would end anyway) inside the
// power-off's operation, before anything is parked. A box of a chat whose task is still under way is asked about first:
// the owner's yes (the button keeps confirmBoxes) ends it. An agent's power-off is the owner's question anyway, and its
// yes covers the box it names. The idle power-off counts a box as use and leaves the Spark on. A container named and
// labelled like a box that this console doesn't have open (one left from before a restart, which ends at its own time;
// one opening now) is said as what it is, and refuses the power-off as anything else Spark Console can't stop does.
// Spark 2 never holds a box (boxBarred) and its plug is never switched (R41): nothing here touches either.
const POWER_BOX_LOOK = `docker ps --no-trunc --format '{{.ID}}|{{.Names}}|{{.State}}|{{.Label "spark-console.box"}}' 2>/dev/null`;
const POWER_BOX_RE = /^[0-9a-f]{12,64}\|(spark-console-box-[0-9a-f]{12})\|running\|(spark-console-box-[0-9a-f]{12})$/;
const POWER_BOX_OTHER = 'labelled as a box, but not one Spark Console has open now: one left from before a restart ends by itself within 2 hours of opening';
const POWER_BOX_OPENING = 'a box opening right now: ask again in a minute';

// What powerLook's output says of boxes on this Spark: known (name → its record: key, whose, chat, live), opening, other.
function powerBoxesIn(node, out) {
  const known = new Map(), opening = new Set(), other = new Set(), open = boxesOn(node.id);
  for (const line of String(out || '').split('\n')) {
    const m = POWER_BOX_RE.exec(line.trim());
    if (!m || m[1] !== m[2]) continue;
    const name = m[1], rec = [...boxes.entries()].find(([, b]) => b.name === name && b.spark === node.id);
    if (rec) known.set(name, powerBoxWhose(name, rec[0], rec[1]));
    else if (open.includes(name)) opening.add(name);
    else other.add(name);
  }
  return { known, opening, other };
}
// Whose a box is, from its key (boxKey, 21-box.mjs), and whether it belongs to a chat whose task is still under way.
function powerBoxWhose(name, key, b) {
  const chatId = /^chat (sc_[0-9a-f]{16})$/.exec(key)?.[1] || null;
  let conv = null;
  try { conv = chatId ? chatData().conversations.find(c => c.id === chatId) || null : null; } catch {}
  const whose = chatId ? `Sparkie’s box in your chat “${maskSecrets(clean(conv?.title || 'a chat', 60))}”`
    : /^agent /.test(key) ? 'an agent’s box' : 'a box opened by your own call';
  return { name, key, whose, chat: chatId, live: Boolean(conv?.task && !conv.task.ended), until: new Date(b.until).toISOString(), files: null };
}
// What each known box's folder holds (its own folder only, never a link): how many entries, and up to five plain names.
async function powerBoxFiles(node, list) {
  if (!list.length) return;
  const r = await run(node, `for n in ${list.map(b => q(b.name)).join(' ')}; do d="$HOME/${BOX_DIR}/$n"; { [ -d "$d" ] && [ ! -L "$d" ]; } || continue
printf 'boxn\\t%s\\t%s\\n' "$n" "$(ls -A "$d" 2>/dev/null | wc -l | tr -d ' ')"; ls -A "$d" 2>/dev/null | head -n 5 | while IFS= read -r f; do printf 'boxf\\t%s\\t%s\\n' "$n" "$f"; done; done`, { timeout: 20000 }).catch(() => null);
  for (const b of list) {
    const n = Number((fields(r?.out || '', 'boxn').find(([x]) => x === b.name) || [])[1]);
    if (!Number.isFinite(n)) continue;
    const shown = fields(r.out, 'boxf').filter(([x, f]) => x === b.name && /^[A-Za-z0-9._ -]{1,60}$/.test(f || '') && maskSecrets(f) === f).map(([, f]) => f);
    b.files = { count: n, shown };
  }
}
// One box in words: its name, whose, what it holds.
function powerBoxWords(b) {
  const f = b.files, more = f && f.count > f.shown.length ? `${f.shown.length ? ', and ' : ''}${f.count - f.shown.length} more` : '';
  const holds = !f ? 'what its folder holds couldn’t be read' : !f.count ? 'its folder is empty'
    : `holding ${f.count} file${f.count === 1 ? '' : 's'} (${f.shown.join(', ')}${more})`;
  return `${b.name}, ${b.whose}${b.live ? ', for a task still under way there' : ''}, ${holds}`;
}
// The answer's words for the boxes a power-off ends: [{ spark, ...box }].
const powerBoxSay = list => (list.length ? `${list.length === 1 ? 'A box is' : `${list.length} boxes are`} open: ${list.map(b => `on ${sparkWord(b.spark)}, ${powerBoxWords(b)}`).join('; ')}. ${list.length === 1 ? 'It ends' : 'They end'} first, with ${list.length === 1 ? 'its folder' : 'their folders'}.` : '');
// Inside the power-off's operation, before anything is parked: each box this look found is ended (boxEnd), one of a task
// under way only with the owner's yes. One that can't be ended stops the power-off: nothing else was changed yet.
async function powerBoxesEnd(j, looks, ctx, yes) {
  for (const l of looks) {
    for (const b of l.boxes || []) {
      const at = sparkWord(l.id);
      if (b.live && !yes) throw new Error(`A box for a task still under way is open on ${at} (${powerBoxWords(b)}), so nothing was changed. Ask again to be asked about it.`);
      step(j, `Ending the box ${b.name} on ${at}`);
      const e = await boxEnd(b.key, { via: ctx.via || null, actor: ctx.actor || 'Spark Console', chat: null });
      if (e && !e.removed) throw new Error(`The box ${b.name} on ${at} couldn’t be ended (${e.why}), so nothing was changed.`);
      note(j, e ? `Ended the box ${b.name} on ${at}, with its folder` : `The box ${b.name} on ${at} had ended already`);
    }
  }
}

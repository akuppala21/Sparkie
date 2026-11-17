/* ───────── root: a command as root, always the dangerous ask, always inside the lock-out net (A12) ───────── */
// Area: features        Rules: R70, R60, R71, R54        Tests: root.test.mjs
// Owns: none
// Timers: none        Wakes: none
// run with root: true (21-work.mjs; design A 2.13, step 12; R70). On a compute Spark only, never on Spark 2 or a Spark
// holding the brain, never with a key, minutes, fleet or gpu, never while changes are paused. It is never run at once,
// whatever the owner's words, and never covered by a go-ahead or the standing list: it is always the dangerous ask
// (20-danger.mjs, R54), "ROOT on Spark 3" (and "CAN LOCK YOU OUT" for the lock-out class), and only that ask's press runs
// it, through the net's seam (netGuarded, 21-net.mjs) and the root helper's `root --net` (--lockout for the lock-out
// class), armed in the same call. What the sorter calls not done, or the net can't put back, is not done as root
// either. Where root's switch is off on that Spark (the helper's check says so), the answer is the owner's one command
// with --with-root, and nothing is asked. sudo in a plain command is answered "set root" (runnerNever, 21-runner.mjs).
// Off (ROOT_ON), run has no root in its schema, so what the brain reads is as before.

// The switch is ROOT_ON, one line in 21-work.mjs beside run's schema (which those tests load on its own).
// What sudo in a plain command is answered while root is on (runnerNever).
const ROOT_SET = 'Nothing ran: a command becomes root only by setting root (run with root: true), which is always asked as root and runs inside the lock-out net. Leave out sudo and set root.';
// The line the ask adds (line 5): what the net puts back for a root command, and what it never does.
const rootLine = at => `It runs as root on ${at}, with no wall around it: the net puts back the ways in (SSH, Tailscale, the firewall, the sign-in files), never anything else it changes.`;
// A root command's time limit: the helper's own (R70: 30 minutes, 10 in the lock-out class), so apt and dpkg finish; the
// stand-in fleet may shorten it (SPARK_CONSOLE_ROOT_SECONDS).
const ROOT_SECONDS = Number(ALL_LOCAL && process.env.SPARK_CONSOLE_ROOT_SECONDS) || 1800;
const rootSeconds = lockout => Math.min(ROOT_SECONDS, lockout ? 600 : 1800);

// What root never runs, read from the sorter's own fields alone (root keeps no list of spellings of its own): a file the
// command runs as code (scripts), code it runs that the button doesn't show (unshown, what the sorter marks so, in its
// words), and work it starts later, off the button and outside the net (later: systemd-run, at, crontab, a schedule,
// unit or drop-in written). The refusal says the plain truth: root never runs code the button doesn't show, and Spark
// Console offers no way to run it (a file run by name is a script); the steps go on the button as plain commands, and a
// timer, schedule, unit or drop-in meant to stay is made by hand on the Spark, over SSH. A part the sorter couldn't
// read at all is rootUnread's; a command the shell reader can't read, rootUnreadable's. The refusal's words, or null.
function rootUnseen(sorted) {
  if (sorted?.scripts?.length) return `Nothing was asked or run: as root, give the command itself, not a script (${String(sorted.scripts[0]).slice(0, 80)}): a script’s text isn’t on the button and can change before your press.`;
  if (sorted?.unshown) return `Nothing was asked or run: as root, Spark Console never runs code the button doesn’t show, and this runs code that isn’t on it (${String(sorted.unshown).replace(/\.$/, '').slice(0, 160)}). Give its steps as plain commands instead, each one on the button.`;
  if (sorted?.later) return `Nothing was asked or run: as root, Spark Console never starts work that runs later, off the button and outside the net, and this does (${String(sorted.later).replace(/\.$/, '').slice(0, 160)}). Run the work itself now, as its own command; a timer, schedule, unit or drop-in meant to stay is made by hand on the Spark, over SSH.`;
  return null;
}
// A program that mounts or swaps, by the sorter's own reading of the command (shellLex and shellParse, 20-shell.mjs: each
// command's first word past wrappers, into $( … ) and sh -c '…'): root's unit has its own mount table, so what it mounts,
// unmounts or swaps never reaches the Spark (systemd.exec). Its name, or null; a command the reader can't read is left to
// the sorter, which asks it.
const ROOT_MOUNTS = new Set(['mount', 'umount', 'swapon', 'swapoff', 'zpool']);
const ROOT_WRAPS = new Set(['env', 'nice', 'ionice', 'nohup', 'timeout', 'stdbuf', 'setsid', 'command', 'exec', 'chrt', 'taskset', 'flock', 'xargs', 'busybox']);
function rootMounts(command, depth = 0) {
  let items;
  try { items = shellParse(shellLex(String(command)).toks); } catch { return null; }
  const walk = list => {
    for (const pipe of list) for (const cmd of pipe) {
      if (cmd.group) { const g = walk(cmd.group); if (g) return g; continue; }
      const words = cmd.words.map(w => w.text);
      for (const w of cmd.words) for (const sub of w.subs || []) { const g = walk(sub); if (g) return g; }
      let k = 0;
      while (k < words.length && ROOT_WRAPS.has(words[k].split('/').pop())) { k++; while (k < words.length && /^-|^\d|^[A-Za-z_]\w*=/.test(words[k])) k++; }
      const prog = (words[k] || '').split('/').pop(), rest = words.slice(k + 1);
      if (ROOT_MOUNTS.has(prog) || (prog === 'zfs' && /^(?:mount|unmount|umount)$/.test(rest[0] || ''))) return prog === 'zfs' ? `zfs ${rest[0]}` : prog;
      // (a shell given its command as a word: read that word too, twice deep)
      if (depth < 2 && /^(?:ba|da|z|k|a)?sh$/.test(prog)) { const c = rest.findIndex(x => /^-\w*c$/.test(x)); if (c >= 0 && rest[c + 1] != null) { const g = rootMounts(rest[c + 1], depth + 1); if (g) return g; } }
    }
    return null;
  };
  return walk(items);
}
// A command the sorter's own reader can't read whole (shellLex and shellParse, 20-shell.mjs: a here-document that runs
// commands, a loop, arithmetic, a ${ … } form): its doubt, or null. As root such a command isn't run.
function rootUnreadable(command) {
  try { shellParse(shellLex(String(command)).toks); return null; } catch (e) { return String(e?.message || 'it can’t be read whole').replace(/\.$/, '').slice(0, 200); }
}
// One program with its words and nothing more (one command, no chain or pipe, no group, no redirection, nothing set
// before it, no $( ) or <( ) in a word): what root still asks when part of a command could not be read, as an unknown
// program's own words. Read by the sorter's own reader; a command it can't read is not that.
function rootOnePlain(command) {
  let items;
  try { items = shellParse(shellLex(String(command)).toks); } catch { return false; }
  const c = items.length === 1 && items[0].length === 1 ? items[0][0] : null;
  return Boolean(c && !c.group && !c.assigns.length && !c.redirs.length && c.words.length && c.words.every(w => !(w.subs || []).length));
}
// Part of a command the sorter couldn't read at all (its unreadable: an unclosed quote, a form the shell reader doesn't
// know, a part past its bounds): what that part does is on no field, so as root it isn't run, unless the whole command is
// one plain program (asked, with its unknown-program line). The refusal's words, or null. F1.
function rootUnread(sorted, command) {
  if (!sorted?.unreadable || rootOnePlain(command)) return null;
  return `Nothing was asked or run: as root, a command is run only when Spark Console can read all of it, and part of this one it can’t (${String(sorted.unreadable).replace(/\.$/, '').slice(0, 200)}). Give each step as its own command.`;
}
async function rootChange(input, viewer, ctx = {}) {
  if (!ROOT_ON) throw new HttpError(400, 'root isn’t on in this build: a command runs as the owner. Nothing ran.');
  if (input.on === 'box') throw new HttpError(400, 'root is for a compute Spark, not the box. Nothing ran.');
  const node = sparkOf(viewer, input.on), at = sparkName(node), command = String(input.command), dir = input.dir || RUNNER_DIR;
  whoMayLook(viewer, ctx);
  if (Array.isArray(input.keys) && input.keys.length) throw new HttpError(403, 'Nothing ran: a command as root is never given a key.');
  if (input.minutes !== undefined || input.fleet === true || input.gpu === true) throw new HttpError(400, 'Nothing ran: a command as root has no wall and isn’t an operation, so it takes no minutes, fleet or gpu.');
  if (!command.trim()) throw new HttpError(400, 'The command is empty. Nothing ran.');
  if (lookWords(command).sudo) throw new HttpError(400, 'Leave out sudo: with root set, the whole command runs as root. Nothing was asked or run.');
  if (node.host === 'local') throw new HttpError(403, `${at} runs Spark Console and the brain, so nothing runs there as root.`);
  if (brainSparks().includes(node.id)) throw new HttpError(403, `${at} holds the brain, so nothing runs there as root.`);
  if (agentSettings().halted) throw new HttpError(403, 'Sparkie’s and agents’ changes are paused (your account menu → Agents and Telegram), so nothing ran.');
  // (shown whole on the button: nothing a mask would hide)
  if (maskSecrets(command) !== command) throw new HttpError(400, 'It holds something shaped like a key or password, so it can’t be shown whole on a button. Nothing was asked or run.');
  // (sorted as root: the sorter's root-only rules apply, kill 1 is the lock-out class; dir and home as run takes them)
  const sorted = sortCommand(command, { ...runnerSortOpts(node, ctx, dir), root: true }), lockout = sorted.class === 'lockout';
  if (sorted.class === 'notdone') throw new HttpError(403, `Not done: ${sorted.why}`);
  if (sorted.lasting) throw new HttpError(403, `Not done: ${String(sorted.lasting).replace(/\.$/, '')}. Nothing was asked or run.`);
  // (code it runs that isn't on the button: never as root)
  const unseen = rootUnseen(sorted);
  if (unseen) throw new HttpError(403, unseen);
  // (part of it the sorter couldn't read at all, its unreadable: what that part does is on no field, so as root it isn't
  // run, unless the whole command is one plain program, asked with its unknown-program line. F1)
  const unread = rootUnread(sorted, command);
  if (unread) throw new HttpError(403, unread);
  // (a command the reader can't read whole: as root it isn't run)
  const doubt = rootUnreadable(command);
  if (doubt) throw new HttpError(403, `Nothing was asked or run: as root, a command is run only when Spark Console can read it whole, and this one it can’t (${doubt}). Give it in plainer words: one command after another, with no here-document, loop or arithmetic.`);
  // (a mount or swap made inside root's own unit never reaches the Spark: said, and what works instead: by hand, as a
  // unit or drop-in is, since writing one as root is refused too, rootUnseen's later)
  const mounts = rootMounts(command);
  if (mounts) throw new HttpError(403, `Nothing was asked or run: a root command runs with its own view of the disks, so a ${mounts} in it never reaches ${at} (it would end with the command, and be told as done). Make it by hand on ${at}, over SSH, in your own terminal.`);
  const seconds = rootSeconds(lockout);
  // The dangerous ask's press, and only that: inside the net, as root, with the helper's own time limit.
  if (ctx.button && ctx.ownerConfirmed && ctx.danger) return netGuarded(node, command, { ctx, dir, seconds, cls: sorted.class, gate: 'asked', root: true });
  const open = netOpenOn(node.id);
  if (open) throw new HttpError(409, `${netOpenWords(open, at)} Nothing was asked or run.`);
  // (a root command in the lock-out class: only the owner's own words ask for one, contract 8.3, 21-net.mjs)
  if (lockout) { const from = netWhose(node, viewer, ctx); if (from) throw netNotYours(from, node); }
  // (no helper there, one this build doesn't know, walls not proven, or root's switch off there: the owner's one command,
  // and nothing is asked)
  const first = await netHelperFirst(node);
  if (first.needs) return first.needs;
  if (first.rootOff) return needsOwner(node, 'root off', `Root is off on ${at}: ${first.rootOff}`);
  // (as the ladder's and Spark 2's asks: the sorter's delete and brain kinds, "DELETES FOR GOOD" with what goes; and the
  // folder it starts in, workStartsIn. rootLine already says the net puts back nothing but the ways in)
  const also = (sorted.kinds || []).filter(k => ['delete', 'brain'].includes(k));
  const gone = also.includes('delete') ? String(sorted.why || '').replace(/\s*That cannot be put back\.?$/, '').replace(/\.$/, '') : null;
  return dangerAsk(viewer, ctx, { kinds: ['root', ...(lockout ? ['lockout'] : []), ...also], where: node.id, shown: { command },
    call: { action: 'run', args: { on: node.id, command, root: true, ...(dir !== RUNNER_DIR ? { dir } : {}) } },
    // (line 2 of a lock-out ask follows the decision that let it through, netWhose: the owner's words asked for it)
    facts: { net: netFact(at, seconds), ...(lockout ? { lockWhy: sorted.why, asked: true } : {}),
      ...(gone ? { gone: { what: gone } } : {}),
      lines: rootLines(at, seconds, command, dir, sorted) } });
}
// The root ask's own lines (line 5 on): what the net puts back for a root command, its time limit, ~ as root, the folder
// it starts in, and a program the sorter doesn't know, named in one line (sorted.unknownProgram).
function rootLines(at, seconds, command, dir, sorted) {
  return [rootLine(at), `It may run ${netTimeWords(seconds)}; at that limit it is ended, and the result says so.`,
    ...(/~|\$HOME|\$\{HOME\}/.test(command) ? ['As root, ~ is /root, not your own home.'] : []), workStartsIn(dir),
    ...(sorted?.unknownProgram ? [`Sparkie doesn’t know the program ${String(sorted.unknownProgram).slice(0, 60)}, so it can’t tell you what it does as root: read the command before you answer.`] : [])];
}

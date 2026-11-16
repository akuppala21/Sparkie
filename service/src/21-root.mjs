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

// Code a root command runs that isn't in its own words (the button shows only those, and the code can change before the
// press): a file run as code (the sorter's scripts), or what the sorter says runs unseen (its unshown: input from < or a
// pipe into a shell, a build, -m, a project's scripts, BASH_ENV). The refusal's words, or null. (unshown is the sorter's
// field from its next step; while it is absent, scripts alone decide.)
function rootUnseen(sorted) {
  if (sorted?.scripts?.length) return `Nothing was asked or run: as root, give the command itself, not a script (${String(sorted.scripts[0]).slice(0, 80)}): a script’s text isn’t on the button and can change before your press.`;
  if (sorted?.unshown) return `Nothing was asked or run: as root, give the command itself. It runs code that isn’t in its own words (${String(sorted.unshown).replace(/\.$/, '').slice(0, 160)}), so that code isn’t on the button and can change before your press.`;
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
// An interpreter given a program inline or on its input, by the sorter's own reading of the command (shellLex and
// shellParse, 20-shell.mjs; past wrappers, into $( … ) and sh -c '…'): { prog, how }, or null. As root it is refused
// unless every word of its program is on ROOT_INLINE_OK, which holds none today: the program's own words can load a
// file (exec(open(…).read()), runpy.run_path, require, do, load) whose text the button never shows (A-16). awk is one
// too (system, getline). A program file named as a word is the sorter's scripts (rootUnseen).
const ROOT_INTERPRETERS = /^(?:python[\d.]*|pypy[\d.]*|perl[\d.]*|ruby[\d.]*|node(?:js)?|deno|bun|php[\d.]*|lua(?:jit)?[\d.]*|Rscript|julia|tclsh[\d.]*|g?awk|mawk|nawk)$/;
const ROOT_INLINE_FLAGS = /^(?:-m|--eval|--print|--require|--import|--module|--command)(?:=|$)|^-[A-Za-z]*[ceEmpr][A-Za-z]*$|^-[ceEr]\S/;
const ROOT_INLINE_OK = new Set();
function rootInline(command, depth = 0) {
  let items;
  // (a command the reader can't read whole, a here-document into a program among them: as root it isn't run)
  try { items = shellParse(shellLex(String(command)).toks); } catch (e) { return { doubt: String(e?.message || 'it can’t be read whole').replace(/\.$/, '').slice(0, 200) }; }
  const walk = list => {
    for (const pipe of list) for (const [n, cmd] of pipe.entries()) {
      if (cmd.group) { const g = walk(cmd.group); if (g) return g; continue; }
      for (const w of [...cmd.words, ...cmd.redirs.map(r => r.w)]) for (const sub of w?.subs || []) { const g = walk(sub); if (g) return g; }
      const words = cmd.words.map(w => w.text);
      let k = 0;
      while (k < words.length && ROOT_WRAPS.has(words[k].split('/').pop())) { k++; while (k < words.length && /^-|^\d|^[A-Za-z_]\w*=/.test(words[k])) k++; }
      const prog = (words[k] || '').split('/').pop(), rest = words.slice(k + 1);
      if (ROOT_INTERPRETERS.test(prog)) {
        const flag = rest.findIndex(x => ROOT_INLINE_FLAGS.test(x));
        const fed = n > 0 || cmd.redirs.some(r => /^<(?:<-?|<<)?$/.test(r.op) && (r.fd == null || String(r.fd) === '0'));
        const named = rest.some(x => !x.startsWith('-')), awk = /awk$/.test(prog);
        const program = flag >= 0 ? (rest[flag].includes('=') ? rest[flag].slice(rest[flag].indexOf('=') + 1) : /^-[ceEr]\S/.test(rest[flag]) && !/^-[A-Za-z]+$/.test(rest[flag]) ? rest[flag].slice(2) : rest[flag + 1] ?? '') : awk && !rest.includes('-f') ? rest.find(x => !x.startsWith('-')) ?? '' : null;
        if (program != null && !String(program).split(/\s+/).filter(Boolean).every(x => ROOT_INLINE_OK.has(x))) return { prog, how: flag >= 0 ? `it is given its program inline, with ${rest[flag].startsWith('--') ? rest[flag].split('=')[0].slice(0, 20) : /^-[ceEr]\S/.test(rest[flag]) && !/^-[A-Za-z]+$/.test(rest[flag]) ? rest[flag].slice(0, 2) : rest[flag].slice(0, 12)}` : 'its program is written in the command' };
        if (fed && (!named || rest.includes('-'))) return { prog, how: n > 0 ? 'its program comes in through a pipe' : 'its program comes in on its input' };
      }
      // (a shell given its command as a word: read that word too, twice deep)
      if (depth < 2 && /^(?:ba|da|z|k|a)?sh$/.test(prog)) { const c = rest.findIndex(x => /^-\w*c$/.test(x)); if (c >= 0 && rest[c + 1] != null) { const g = rootInline(rest[c + 1], depth + 1); if (g) return g; } }
    }
    return null;
  };
  return walk(items);
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
  const sorted = sortCommand(command, runnerSortOpts(node, ctx, dir)), lockout = sorted.class === 'lockout';
  if (sorted.class === 'notdone') throw new HttpError(403, `Not done: ${sorted.why}`);
  if (sorted.lasting) throw new HttpError(403, `Not done: ${String(sorted.lasting).replace(/\.$/, '')}. Nothing was asked or run.`);
  // (code it runs that isn't on the button: never as root)
  const unseen = rootUnseen(sorted);
  if (unseen) throw new HttpError(403, unseen);
  // (an interpreter given its program inline, or on its input: the program can load code from a file that isn't on the
  // button, so as root it isn't run, A-16)
  const inline = rootInline(command);
  if (inline?.doubt) throw new HttpError(403, `Nothing was asked or run: as root, a command is run only when Spark Console can read it whole, and this one it can’t (${inline.doubt}). Give it in plainer words: one command after another, with no here-document, loop or arithmetic.`);
  if (inline) throw new HttpError(403, `Nothing was asked or run: as root, give the commands themselves, not a program for ${inline.prog} to run (${inline.how}). Such a program can load code from a file that isn’t on the button. Run its steps as plain commands instead.`);
  // (a mount or swap made inside root's own unit never reaches the Spark: said, and how to do it instead)
  const mounts = rootMounts(command);
  if (mounts) throw new HttpError(403, `Nothing was asked or run: a root command runs with its own view of the disks, so a ${mounts} in it never reaches ${at} (it would end with the command, and be told as done). Do it through systemd instead: a line in /etc/fstab (or a .mount or .swap unit), then systemctl daemon-reload and systemctl start <its name>.mount (or .swap), as root.`);
  const seconds = rootSeconds(lockout);
  // The dangerous ask's press, and only that: inside the net, as root, with the helper's own time limit.
  if (ctx.button && ctx.ownerConfirmed && ctx.danger) return netGuarded(node, command, { ctx, dir, seconds, cls: sorted.class, gate: 'asked', root: true });
  const open = netOpenOn(node.id);
  if (open) throw new HttpError(409, `A change that can lock you out of ${at} is still open there (record ${open.record || open.id}): it is kept or goes back first, at ${netHhmm(open.goesBackAt)} at the latest. Nothing was asked or run.`);
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
      lines: [rootLine(at), `It may run ${netTimeWords(seconds)}; at that limit it is ended, and the result says so.`,
        ...(/~|\$HOME|\$\{HOME\}/.test(command) ? ['As root, ~ is /root, not your own home.'] : []), workStartsIn(dir)] } });
}

/* ───────── root: a command as root, always the dangerous ask, always inside the lock-out net (A12, dark) ───────── */
// Area: features        Rules: R70, R60, R54        Tests: root.test.mjs
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

// Root's switch on the Spark, as the helper's check says it: why it is off, or null (on, or not said: the press finds out).
async function rootOff(node) {
  const c = await helperCall(node, 'check', { limitMs: 30000 }).catch(() => null);
  return c ? new RegExp(`(?:^|\\n)${c.id} root off: ([^\\n]*)`).exec(c.out)?.[1] || null : null;
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
  // The dangerous ask's press, and only that: inside the net, as root.
  if (ctx.button && ctx.ownerConfirmed && ctx.danger) return netGuarded(node, command, { ctx, dir, seconds: RUNNER_SECONDS, cls: sorted.class, gate: 'asked', root: true });
  const open = netOpenOn(node.id);
  if (open) throw new HttpError(409, `A change that can lock you out of ${at} is still open there (record ${open.record || open.id}): it is kept or goes back first, at ${netHhmm(open.goesBackAt)} at the latest. Nothing was asked or run.`);
  // (root's switch off there: the owner's one command, and nothing is asked)
  const off = await rootOff(node);
  if (off) return needsOwner(node, 'root off', `Root is off on ${at}: ${off}`);
  return dangerAsk(viewer, ctx, { kinds: ['root', ...(lockout ? ['lockout'] : [])], where: node.id, shown: { command },
    call: { action: 'run', args: { on: node.id, command, root: true, ...(dir !== RUNNER_DIR ? { dir } : {}) } },
    facts: { net: netFact(at), ...(lockout ? { lockWhy: sorted.why } : {}), lines: [rootLine(at)] } });
}

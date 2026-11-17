/* ───────── a kept key, by its name, in one change's environment (A14b) ───────── */
// Area: features        Rules: R51, R61, R42        Tests: run-keys.test.mjs
// Owns: none (a key's places go in the secrets file, outside the state folder, through secretsWrite)
// Timers: none        Wakes: none
// run takes keys: the names of keys the owner gave once (/key NAME value, 20-keys.mjs, R51). Code puts each value into
// the command's environment by that name, for that one run and nothing else. The values go to the root helper on its
// input (--stdin, after the call's own script on the same connection): the helper holds them in a file of its own, in
// /run/spark-console/<id>/, root's and on the memory disk, for the unit's life and removes it with the unit. The
// unit's first line is code's own (RUNKEY_PREFIX): it reads them from there into the environment and then takes its
// input from nowhere. So no value is ever on a command line (ps), in the unit's name or settings (systemctl show), in
// the command's text or its SHA-256, in the journal's start or end line, in a button, a script's hash or the copies;
// what the command prints is masked by each kept value exactly (keptHidden, R51: as is, %-encoded and in base64, also
// across two pieces of the journal). Never given: to a look's wall (only a change's takes input), to a command the
// sorter calls open (outside the wall every key and token in the home is open to it), to root, to a command whose own
// text prints the environment (env, printenv, set, export -p, declare -p, a shell's -x, /proc/…/environ, ps e), to a
// run outside the plain wall after a yes (run --open: the home's keys are open there), to a delete that cannot be put back or a command naming the brain (the dangerous ask), to a script that changed after its
// ask, or under a name that decides what programs run or load. A key's places, kept with it by code: the Sparks it has
// run on, the hosts its commands named (read as the sorter reads an address, usesHost, and a bare name), and, for a
// command that names none, where the sorter says it reaches by itself (its reach: the internet, the home network,
// another Spark). A new value starts with none. A command given a key is never plain at
// once by that fact alone (a walled plain change may read the project's files and send them out, the wall's analyst
// found, and the text check and the mask can't hold back every form of a key a command may print or send): it is
// always asked, on a button that names each key and each place it hasn't gone to before, and it runs only on the
// owner's press of that button (never at once, never on a go-ahead); after the run, those places are kept with it.
const RUNKEY_MAX = 8, RUNKEY_PLACES = 50, RUNKEY_HOSTS = 16;
// Names a key is never handed under: what decides what programs run, load or fetch (the sorter's own list), or what
// bash itself sets or reads.
const RUNKEY_BASH = /^(?:BASH\w*|UID|EUID|PPID|PWD|OLDPWD|SHELL|SHLVL|USER|LOGNAME|MAIL\w*|HIST\w*|RANDOM|SRANDOM|SECONDS|LINENO|OPTARG|OPTIND|OPTERR|REPLY|COMP\w*|FUNCNAME|GROUPS|HOSTNAME|HOSTTYPE|MACHTYPE|OSTYPE|PIPESTATUS|PS[0-4]|EPOCH\w*|TERM|SUDO\w*)$/;
// The unit's own first line when it is given keys: each NAME=value line of its input into the environment, until an
// empty line; then its input is nothing, as without keys. (sck_k: lower case, so no key's name can be it.)
const RUNKEY_PREFIX = 'while IFS= read -r sck_k && [ -n "$sck_k" ]; do export -- "$sck_k"; done; unset sck_k; exec </dev/null\n';
const RUNKEY_SCRIPT_CHANGED = 'Not run: a script it runs changed after you were asked, and a key is never given to a script you weren’t shown. Nothing ran: ask for it again to see the script as it is now.';
const RUNKEY_SCRIPT_UNPINNED = 'Not run: it runs a script whose text isn’t pinned by a hash here, and a key is never given to a script you weren’t shown as it is. Name the script plainly, from where the change starts or after one first cd <folder> &&. Nothing was asked or run.';
// The hosts a command's text names: each word as the sorter reads an address (usesHost: a scheme's host, host:path,
// user@ and a port taken off; an option's value after = too), user@host, and a bare name with a common top-level part
// (example.com, api.x.io/v1) or an IPv4 address. Read from the text alone: where a program sends a key by itself (its
// own settings) isn't seen; that is said on the button.
const RUNKEY_TLD = 'com|org|net|io|co|ai|dev|app|cloud|edu|gov|info|biz|tv|xyz|us|uk|de|fr|jp|cn|ca|au|eu|ch|nl|se|no|fi|be|it|es|kr|tw|sg|hk|nz';
function runKeysHosts(command) {
  const t = String(command), out = new Set();
  const add = h => { const x = String(h || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, ''); if (x && !/[^\w.:%-]/.test(x) && out.size < RUNKEY_HOSTS) out.add(x); };
  for (const { w } of shellWords(t)) if (typeof w === 'string') for (const s of [w, w.replace(/^-[^=]*=/, '')]) add(usesHost(s));
  for (const m of t.matchAll(/(?:^|[\s'"=])[a-z0-9._-]+@([a-z0-9-]+(?:\.[a-z0-9-]+)+)(?=[:\s'"]|$)/gi)) add(m[1]);
  const bare = new RegExp(`(?:^|[\\s'"=@])((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+(?:${RUNKEY_TLD})|\\d{1,3}(?:\\.\\d{1,3}){3})(?=[:/\\s'"]|$)`, 'gi');
  for (const m of t.matchAll(bare)) add(m[1]);
  return [...out];
}
// Where a key goes with this command: its Spark, then each host it names, or, naming none, where the sorter says it
// reaches by itself (reach:internet, reach:home, reach:fleet).
function runKeysPlaces(node, command, sorted) {
  const hosts = runKeysHosts(command).filter(h => h !== node.id), reach = Array.isArray(sorted?.reach) ? sorted.reach : [];
  return [node.id, ...hosts, ...(hosts.length ? [] : reach.filter(r => ['internet', 'home', 'fleet'].includes(r)).map(r => `reach:${r}`))];
}
const RUNKEY_REACH = { 'reach:internet': 'the internet (where the program goes by itself)', 'reach:home': 'your home network (where the program goes by itself)', 'reach:fleet': 'another Spark (where the program goes by itself)' };
const runKeysPlaceWords = (node, p) => (p === node.id ? sparkName(node) : RUNKEY_REACH[p] || p);

// Whether the command's own text prints the environment (where the key would be): a reason, or null. Its words are
// read with quotes taken off, so a script a shell is handed (bash -c '…') counts too; a program counts where a command
// starts (first in its part, past names set before it, or after a word that runs what follows); refused, never shown.
const RUNKEY_SHELLS = new Set(['bash', 'sh', 'dash', 'zsh', 'ksh', 'ash', 'mksh', 'busybox']);
const RUNKEY_RUNS = new Set(['nice', 'nohup', 'time', 'timeout', 'exec', 'command', 'builtin', 'eval', 'xargs', 'sudo', 'doas', 'stdbuf', 'ionice', 'chroot', 'watch',
  'then', 'do', 'else', '!', '-c', 'env']);
function runKeysPrints(command) {
  const t = String(command);
  if (/\/proc\/[^\s;&|]*environ/.test(t)) return 'reads a process’s environment (/proc/…/environ)';
  for (const part of t.replace(/['"`\\]/g, ' ').split(/\|\||&&|[;&|()\n{}<>]/)) {
    const w = part.split(/\s+/).filter(Boolean);
    let start = 0;
    while (start < w.length && /^[A-Za-z_]\w*=/.test(w[start])) start++;
    for (let i = start; i < w.length; i++) {
      const x = w[i].split('/').pop(), before = i > start ? w[i - 1].split('/').pop() : null;
      if (i > start && !RUNKEY_RUNS.has(before) && !/^\d+(?:\.\d+)?[smhd]?$/.test(before)) continue;
      const rest = w.slice(i + 1), opts = [];
      for (const a of rest) { if (!a.startsWith('-') && opts.at(-1) !== '-o') break; opts.push(a); }
      const xtrace = opts.some((a, j) => /^-[a-zA-Z]*x/.test(a) || a === '--xtrace' || (a === '-o' && opts[j + 1] === 'xtrace'));
      if (x === 'env' || x === 'printenv') return `runs ${x}, which prints the environment`;
      if (x === 'set' && (!rest.length || xtrace)) return rest.length ? 'turns on the shell’s trace (set -x), which prints each command with its values' : 'runs set alone, which prints every variable';
      if (['export', 'declare', 'typeset'].includes(x) && rest.every(a => a.startsWith('-'))) return `runs ${x}${rest.length ? ` ${rest.join(' ')}` : ''}, which prints the environment`;
      if (x === 'shopt' && rest.includes('xtrace')) return 'turns on the shell’s trace (xtrace), which prints each command with its values';
      if (RUNKEY_SHELLS.has(x) && xtrace) return `runs ${x} with its trace (-x), which prints each command with its values`;
      if (x === 'ps' && rest.some(a => /^[a-zA-Z]+$/.test(a) && a.includes('e'))) return 'runs ps with e, which prints each process’s environment';
    }
  }
  return null;
}

// The keys kept by name (the secrets file's keys), read now; a file that can't be read gives nothing to anyone.
function runKeysKept() {
  const s = secretsRead();
  if (s === null) throw new HttpError(500, `The secrets file on ${hubName()} can’t be read, so no key was given and nothing ran.`);
  return s.keys && typeof s.keys === 'object' && !Array.isArray(s.keys) ? s.keys : {};
}
// What is never given a key, whatever is said (the ladder's first check for a command given one, and the runner's again
// at the run): the names first, then the command. Throws a refusal in plain words; nothing has run.
function runKeysNever(node, command, sorted, ctx, keys) {
  if (!Array.isArray(keys) || !keys.length || keys.length > RUNKEY_MAX || keys.some(k => typeof k !== 'string' || !KEY_NAME_RE.test(k))) {
    throw new HttpError(400, `keys takes the names of up to ${RUNKEY_MAX} kept keys, like ["HF_TOKEN"]: capital letters, digits and _. Nothing ran.`);
  }
  const kept = runKeysKept();
  for (const k of keys) {
    if (k === 'GITHUB' || k === 'HEARTBEAT') throw new HttpError(403, `Not run: ${k} has a home of its own (${k === 'GITHUB' ? 'the install from GitHub' : 'the heartbeat'}) and is used only there. Nothing ran.`);
    if (DANGER_ENV.test(k) || RUNKEY_BASH.test(k)) throw new HttpError(403, `Not run: ${k} is a name the shell or a program reads to decide what runs or loads, so no key is given under it. Keep the key under another name (/key OTHER_NAME …). Nothing ran.`);
    const v = kept[k]?.value;
    if (typeof v !== 'string' || !v) throw new HttpError(404, `Not run: no key is kept as ${k}. The owner gives it once in their own chat: /key ${k} and then the key. Nothing ran.`);
    if (/[\s\x00-\x1f\x7f]/.test(v)) throw new HttpError(409, `Not run: the key kept as ${k} holds a space or a sign that doesn’t show, so it can’t be handed over safely. Give it again with /key ${k}. Nothing ran.`);
  }
  if (ctx.root || sorted?.kinds?.includes('root') || sorted?.answer === 'set root' || lookWords(command).sudo || /(?:^|[\s;&|(])su(?:\s|$)/.test(command)) {
    throw new HttpError(403, 'Not run: a key is never given to a command run as root (sudo or su). Nothing ran.');
  }
  const prints = runKeysPrints(command);
  if (prints) throw new HttpError(403, `Not run: its own text ${prints}, where the key would be, so a key is never given to it. Use the key by its name in the command instead. Nothing ran.`);
  if (sorted?.open) throw new HttpError(403, `Not run: it needs what the plain wall keeps out (${String(sorted.why || '').replace(/\.$/, '').slice(0, 200)}), so it would run outside that wall, where every key and token in your home is open to it; a key is never given to such a command. Nothing ran.`);
  if ((sorted?.kinds || []).some(x => ['delete', 'brain'].includes(x))) {
    throw new HttpError(403, `Not run: it ${sorted.kinds.includes('delete') ? 'removes what can’t be put back' : 'names the brain'}, which is asked the dangerous way, and a key is never given to such a command: run that part on its own first. Nothing ran.`);
  }
}
// Each key's places this command would take it to that it hasn't gone to before: [{key, places}].
function runKeysNew(node, command, keys, sorted) {
  const kept = runKeysKept(), places = runKeysPlaces(node, command, sorted);
  return keys.map(k => ({ key: k, places: places.filter(p => !(Array.isArray(kept[k]?.hosts) && kept[k].hosts.includes(p))) })).filter(x => x.places.length);
}
// Why a command given keys is asked though the ladder cleared it, or null: a place a key hasn't gone to before.
function runKeysWhy(node, command, keys, sorted) {
  const fresh = runKeysNew(node, command, keys, sorted);
  if (!fresh.length) return null;
  return fresh.map(x => `it gives the key ${x.key} to ${x.places.map(p => runKeysPlaceWords(node, p)).join(' and ')}, where it hasn’t gone before`).join('; ');
}
// The button's own lines for a command given keys: which keys, what the mask does and doesn't hold back, their new
// places, what a $NAME on a command line shows.
function runKeysLabel(node, command, keys, sorted) {
  if (!keys?.length) return '';
  const fresh = runKeysNew(node, command, keys, sorted), names = keys.join(', '), one = keys.length === 1;
  const spelled = keys.filter(k => new RegExp(`\\$(?:${k}\\b|\\{${k}\\})`).test(command));
  return ['', `It is given the key${one ? '' : 's'} ${names}, in its environment by name for this run only. ${one ? 'Its value is' : 'Their values are'} hidden where the command prints ${one ? 'it' : 'them'} as ${one ? 'it is' : 'they are'} (or %-encoded, or in base64); a command can still show ${one ? 'it' : 'them'} another way, write ${one ? 'it' : 'them'} to a file, or send ${one ? 'it' : 'them'} to any address on the internet: read the command.`,
    ...fresh.map(x => `${x.key} hasn’t gone to ${x.places.map(p => runKeysPlaceWords(node, p)).join(' or ')} before: after your yes and the run, ${x.places.length === 1 ? 'that place is' : 'those places are'} kept with it.`),
    'Where a program sends a key by its own settings isn’t read here: only the hosts the command names, or, naming none, where it reaches by itself.',
    ...(spelled.length ? [`${spelled.map(k => `$${k}`).join(', ')} on a program’s command line shows in ${sparkName(node)}’s process list while that program runs.`] : [])].join('\n');
}
// A change that would fail inside the plain wall runs, after the yes, outside it (run --open, 21-runner.mjs), where
// every key and token in the home is open to it: never given a key there. (One that runs with the top of the home
// writable, --home, holds the home's keys hidden as the plain wall does: given one by the same rules.)
function runKeysOutside(outside) {
  if (outside?.length) throw new HttpError(403, `Not run: ${String(outside[0]).slice(0, 200)}, so it would run outside the plain wall, where every key and token in your home is open to it; a key is never given to such a command. Nothing ran.`);
}
// At the run (21-runner.mjs): the names and the command checked again, and only on the owner's press of its button
// (ctx.button and ctx.ownerConfirmed: never at once, and no go-ahead or other "asked" counts). The unit's first line
// and its input: NAME=value lines and an empty one. { prefix, payload, places, sums }.
function runKeysGive(node, command, sorted, keys, ctx, asked, outside = []) {
  runKeysNever(node, command, sorted, ctx, keys);
  runKeysOutside(outside);
  if (!(ctx.button && ctx.ownerConfirmed)) throw new HttpError(409, 'Not run: a command given a key runs only after the owner presses its button, which names the key. Nothing ran.');
  const kept = runKeysKept(), sums = {};
  for (const k of keys) sums[k] = createHash('sha256').update(kept[k].value).digest('hex');
  return { prefix: RUNKEY_PREFIX, payload: `${keys.map(k => `${k}=${kept[k].value}\n`).join('')}\n`, places: runKeysPlaces(node, command, sorted), sums };
}
// After a run that started: each key's places kept with it (by code, the same value only: a key given anew since
// starts with none). Never throws.
function runKeysUsed(given, keys) {
  try {
    secretsWrite(s => {
      const all = s.keys && typeof s.keys === 'object' && !Array.isArray(s.keys) ? { ...s.keys } : {};
      for (const k of keys) {
        const e = all[k];
        if (!e || typeof e.value !== 'string' || createHash('sha256').update(e.value).digest('hex') !== given.sums[k]) continue;
        all[k] = { ...e, hosts: [...new Set([...(Array.isArray(e.hosts) ? e.hosts : []), ...given.places])].slice(0, RUNKEY_PLACES) };
      }
      return { ...s, keys: all };
    });
  } catch (e) { console.error(`Where a key went couldn’t be kept with it: ${e.message}`); }
}
// run with keys (21-work.mjs): never a look (only a change's wall takes input), so a command that only reads runs as a
// change given its keys; a key file named in it is refused as a look refuses one.
async function runKeyed(node, command, input, viewer, ctx) {
  whoMayLook(viewer, ctx);
  if (!command.trim()) throw new HttpError(400, 'The command is empty: give one command.');
  const keys = Array.isArray(input.keys) ? [...new Set(input.keys)] : input.keys;
  // (the names, root and a text that prints the environment first, in their own words; the sorter's answer after)
  runKeysNever(node, command, null, ctx, keys);
  const key = lookWords(command).words.find(keyWord);
  if (key) throw new HttpError(403, `Not run: ${key.slice(0, 200)} is a key file or holds keys, and a command given a key never reads one. Nothing ran.`);
  const dir = input.dir || RUNNER_DIR, sorted = sortCommand(command, runnerSortOpts(node, ctx, dir));
  if (sorted.class === 'look') Object.assign(sorted, { class: 'change', why: 'It only reads, and it is given a key, so it runs as a change.' });
  return workChange(node, command, sorted, viewer, ctx, dir, { fleet: input.fleet === true, gpu: input.gpu === true }, null, keys);
}

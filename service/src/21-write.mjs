/* ───────── write_file: one text file on a compute Spark, through run's ladder (A7d) ───────── */
// Area: features        Rules: R68, R61        Tests: write.test.mjs
// Owns: none
// Timers: none        Wakes: none
// write_file {on, path, text, from?, to?}: the whole file, or its lines from to to (as cat -n numbered them; to =
// from - 1 puts the text before line from), on a compute Spark. Code decides as for run (21-ladder.mjs, R61): the
// sorter is handed a plain write of that path from where the change starts (cat > path), never the brain's words, so
// the file is refused, asked or written at once exactly as a run writing it would be; the runner (21-runner.mjs) copies
// it first, keeps the start and end lines, the hold and written, and runs code's own program in the run wall with the
// bytes on the helper's input (--stdin), never on a command line. That program writes beside the file and moves the new
// one into place (one move), with the old file's mode, and only while the file is as it was read here (its SHA-256, or
// not there): one changed in between is left as it is, and said. The button shows the path and the lines that change,
// old and new (design A 2.14, row 7), and a press after the file changed since the ask is void and asked again.
const WRITE_MAX = 128 * 1024, WRITE_READ = 256 * 1024, WRITE_SHOWN = 30, WRITE_LINE = 200;

// Where the change starts and the path from there, always handed on as ./… (a name that starts with a dash is a file,
// never an option): ~/… and a whole path from the home; anything else from ~/work, as run starts there. A path that
// names no file is refused by name.
function writePlace(path) {
  const p = String(path), no = why => new HttpError(400, `${why} Nothing was written.`);
  if (/^(?:~\/?)?(?:\.\/)*$/.test(p)) throw no('Give the file’s name: an empty path, ./, ~ or ~/ names no file.');
  if (p.startsWith('~//')) throw no('~// isn’t a path: give ~/ and the file’s path in the home, or a whole path.');
  if (/\/$|(?:^|\/)\.\.?$/.test(p)) throw no(`${p} names a folder, not a file.`);
  if (p.startsWith('~/')) return { dir: '~', rel: `./${p.slice(2)}`, look: p.slice(2), shown: p };
  if (p.startsWith('/')) return { dir: '~', rel: p, look: p, shown: p };
  const r = p.replace(/^(?:\.\/)+/, '');
  return { dir: RUNNER_DIR, rel: `./${r}`, look: `${RUNNER_DIR.slice(2)}/${r}`, shown: `${RUNNER_DIR}/${r}` };
}

// A key in the text, for sure: the exact value of a key the owner gave Sparkie, a private key block, a token of a kind
// the mask knows by its form. What the mask would hide by its shape alone (a setting named like a key) is written.
function writeKey(text) {
  if (keptHidden(text) !== text) return 'the value of a key you gave Sparkie';
  if (hidePrivateKeys(text) !== text) return 'a private key block';
  for (const re of SECRET_PATTERNS) {
    re.lastIndex = 0;
    const m = re.exec(text);
    re.lastIndex = 0;
    if (m) return `a token of a kind Sparkie knows (it begins ${JSON.stringify(Array.from(m[0]).slice(0, 4).join(''))})`;
  }
  return null;
}

// The file as it is now. What is at the name, by code's own look at the name (no content read): a plain file (and
// whether its owner may write it), a link, something else, nothing. Its text only through the helper's look, the same
// wall run's looks go through, so its one hidden list decides: a key, or a file that wall hides, is "hidden" and its
// text is never read; then the program compares it by what code sees without reading it (sig: its inode, size and
// modification time in epoch seconds and nanoseconds, from the same look at the name: no time zone in it). A helper
// that can't look there: its own answer (helperNeeds).
async function writeOld(node, place) {
  const d = place.dir === '~' ? '"$HOME"' : `"$HOME"${q(place.dir.slice(1))}`;
  const r = await run(node, `cd -- ${d} 2>/dev/null || { echo none; exit 0; }; p=${q(place.rel)}; if [ -L "$p" ]; then echo link; elif [ -f "$p" ]; then if [ -w "$p" ]; then echo "file $(stat -c '%i %s %.9Y' -- "$p")"; else echo readonly; fi; elif [ -e "$p" ]; then echo other; else echo none; fi`, { timeout: 20000 });
  if (r.code !== 0) throw new HttpError(r.code === 255 ? 503 : 502, `${sparkName(node)} couldn’t be asked what is at ${place.shown}, so nothing was asked or written.`);
  const [kind, ...rest] = String(r.out).trim().split('\n')[0].split(' '), sig = rest.join(' ');
  if (kind !== 'file') return { kind: ['link', 'other', 'readonly'].includes(kind) ? kind : 'none' };
  if (keyWord(place.look)) return { kind: 'hidden', sig };
  const command = `p=${q(place.look)}; s=$(sha256sum < "$p" 2>/dev/null | cut -d' ' -f1); if [ -f "$p" ] && [ ! -L "$p" ] && [ -n "$s" ]; then printf 'file %s %s\\n' "$(stat -c %s -- "$p")" "$s"; head -c ${WRITE_READ + 1} -- "$p" | base64 -w0; echo; else echo hidden; fi`;
  const { words, walks } = lookWords(command);
  const a = helperAnswer(await helperCall(node, 'look', { command, seconds: LOOK_SECONDS, words, walks }));
  if (a.kind === 'ran') {
    const [head = '', b64 = ''] = String(a.output).split('\n'), m = /^file (\d+) ([0-9a-f]{64})$/.exec(head.trim());
    return m ? { kind: 'file', size: Number(m[1]), sha: m[2], bytes: Number(m[1]) <= WRITE_READ ? Buffer.from(b64.trim(), 'base64') : null } : { kind: 'hidden', sig };
  }
  if (['key', 'walk', 'refused'].includes(a.kind)) return { kind: 'hidden', sig };
  return { kind: 'helper', answer: a };
}

// Code's own program for the unit: the whole new text comes on its input. It writes only while the file is as it was
// read here (a hidden file, whose text is never read: its inode, size and modification time in epoch seconds and
// nanoseconds, which no time zone changes) and its owner may write it, with the old permission bits only (0644 for a
// new file); its own temporary file never stays behind. It compares at the start, stages the text beside the file,
// then publishes in one step that can't lose another program's edit made in between (A-19): a new file by a link,
// which fails when anything is at the name by then (where the disk has no hard links, a FAT or exFAT one, a create that
// fails the same way, then the text); a replace by exchanging the two names (renameat2 with RENAME_EXCHANGE, through
// python3), then checking what it displaced: not the file as read, it is exchanged back, "changed since it was read".
// From the exchange on, what was displaced is never removed unchecked: ended before the check (its time, a cancel, a
// stop), the program exchanges back, and if that fails says where it is; an exchange back that fails is said the same
// way, exit 5. Where this libc or filesystem has no exchange (or no python3, in a box), it compares once more just
// before one move. old.hold and old.late, folders (tests only, never set by code): the program waits in the first
// after staging, in the second just before the publishing call itself, after its last compare, as a test's second
// writer needs it to.
function writeProgram(rel, old) {
  // (the exchange: 0 done, 4 where this libc or filesystem has none, 1 on any other failure; all inside this function,
  // which tests lift on its own)
  const swap = `xchg() { python3 -I -c 'import ctypes, errno, os, sys
try:
    f = ctypes.CDLL(None, use_errno=True).renameat2
except AttributeError:
    sys.exit(4)
if f(-100, os.fsencode(sys.argv[1]), -100, os.fsencode(sys.argv[2]), 2) == 0:
    sys.exit(0)
sys.exit(4 if ctypes.get_errno() in (errno.EINVAL, errno.ENOSYS, errno.EOPNOTSUPP) else 1)' "$1" "$2"; }`;
  // (a hidden file's signature: inode, size, and its time as epoch seconds with nanoseconds, the same as writeOld's)
  const same = x => (old.kind === 'file' ? `[ -f "${x}" ] && [ ! -L "${x}" ] && [ "$(sha256sum < "${x}" | cut -d' ' -f1)" = ${old.sha} ]`
    : old.kind === 'hidden' ? `[ -f "${x}" ] && [ ! -L "${x}" ] && [ "$(stat -c '%i %s %.9Y' -- "${x}")" = ${q(old.sig ?? '')} ]` : `[ ! -e "${x}" ] && [ ! -L "${x}" ]`);
  const changed = "{ echo 'write_file: the file changed since it was read here, so nothing was written.' >&2; exit 3; }";
  const wait = h => (typeof h === 'string' ? [`: > ${q(`${h}/at`)}; n=0; until [ -e ${q(`${h}/go`)} ] || [ $n -ge 300 ]; do sleep 0.1; n=$((n + 1)); done`] : []);
  // (where a kept file is, as a whole path: the temporary name is beside the file, from where the change starts)
  const at = '$(case $d in /*) echo "$d" ;; *) echo "$PWD/${d#./}" ;; esac)', late = wait(old.late).join('; ') || ':';
  const publish = old.kind === 'none'
    // (a link fails when anything is at the name now: their file stays, ours goes with the temporary name. Where the disk
    // has no hard links: made only if nothing is at the name (set -C, an exclusive create), then filled; the reason said)
    ? [late, `if ! e=$(ln -T -- "$t" "$p" 2>&1); then`,
      `  if [ -e "$p" ] || [ -L "$p" ]; then ${changed}; fi`,
      `  ( set -C; : > "$p" ) 2>/dev/null || { if [ -e "$p" ] || [ -L "$p" ]; then ${changed}; fi; echo "write_file: it couldn’t be made there, so nothing was written: $e" >&2; exit 1; }`,
      '  cat -- "$t" > "$p" && chmod 0644 -- "$p" 2>/dev/null; [ "$(wc -c < "$p")" = "$(wc -c < "$t")" ] || { rm -f -- "$p"; echo "write_file: it couldn’t be written there in full, so nothing was written: $e" >&2; exit 1; }',
      'fi']
    // (from here what was displaced is held as d, never t: the exit trap never removes it. ti, the staged file's inode,
    // says at an end whether the exchange happened)
    : ['ti=$(stat -c %i -- "$t") || exit 1', 'd=$t; t=', late, 'xchg "$d" "$p"; r=$?',
      // (exchanged: d holds what was at the name; the file as read goes, anything else goes back)
      `if [ $r = 0 ]; then if ${same('$d')}; then k=$d; d=; rm -f -- "$k"; else xchg "$d" "$p" || { echo "write_file: the file changed since it was read here and couldn’t be put back: the name holds the new text, and what was there is kept as ${at}." >&2; d=; exit 5; }; k=$d; d=; rm -f -- "$k"; ${changed}; fi`,
      `elif [ $r = 4 ] || [ $r = 127 ]; then t=$d; d=; ${same('$p')} || ${changed}; ${late}; mv -fT -- "$t" "$p" || exit 1; t=`,
      'else t=$d; d=; exit 1; fi'];
  // (ended between the exchange and its check: exchanged back, so what was at the name is there again; if that fails,
  // where it is kept is said. No exchange yet: d is only the staged text)
  const ended = `gone() { [ -n "$d" ] || return 0; if [ "$(stat -c %i -- "$p" 2>/dev/null)" = "$ti" ]; then xchg "$d" "$p" && { rm -f -- "$d"; return 0; }; echo "write_file: ended just after the exchange, which couldn’t be undone: the name holds the new text, and what was there is kept as ${at}." >&2; else rm -f -- "$d"; fi; }`;
  return [`p=${q(rel)}; t=; d=; ti=`, swap, ended, `trap '[ -n "$t" ] && rm -f -- "$t"' EXIT`, "trap 'gone; exit 143' TERM INT HUP",
    `${same('$p')} || ${changed}`,
    `[ ! -e "$p" ] || [ -w "$p" ] || { echo 'write_file: the file is read-only, so nothing was written.' >&2; exit 3; }`,
    't=$(mktemp -p "$(dirname -- "$p")" .write_file.XXXXXX) || exit 1',
    'cat > "$t" || exit 1',
    `if [ -f "$p" ]; then m=$(stat -c %a -- "$p") && chmod "$(printf '%o' $(( 8#$m & 8#777 )))" -- "$t" || exit 1; else chmod 0644 -- "$t" || exit 1; fi`,
    ...wait(old.hold), ...publish].join('\n');
}

// A text's lines, without the empty one after its last line break.
const writeSplit = s => { const l = String(s).split('\n'); if (l.at(-1) === '') l.pop(); return l; };
// Lines from to to of the old text with the new lines in their place, whole: what is shown is what is written (a new
// line after a last line with no break starts a line of its own).
function writeSplice(oldText, text, from, to) {
  const was = writeSplit(oldText), now = writeSplit(text), out = [...was.slice(0, from - 1), ...now, ...was.slice(to)];
  const ends = to < was.length ? oldText.endsWith('\n') : true;
  return out.length ? `${out.join('\n')}${ends ? '\n' : ''}` : '';
}
// One line on the button: masked, cut at 200 signs and said so; a line the mask changed is marked, as it is written as
// given. A hidden part of a new line (+) that holds a sign that runs something ($, a backtick, a bracket, |, ;, &, <, >)
// is shown as written, marked so (a key has none of them, and a kept key's value and the strong shapes were refused before: what is
// hidden that way could be a command). The records (the brain's result, the journal, the chat file) mask the line again,
// with the same mark, which then says the hidden part holds such signs; the button (the page, Telegram) shows it.
// An old line (-) is the file on the Spark, which nothing checked (a password, a kept key): always masked, never shown
// whole, and cleaned of signs that don't show as a look's output is (lookClean; any other such sign a space).
const WRITE_WHOLE = ' (shown whole: what would be hidden here holds signs that run something)', WRITE_RUNS = /[$`()|;&<>]/;
const WRITE_UNSEEN = new RegExp(DANGER_HIDDEN.source, 'gu');
function writeLineShown(sign, line) {
  const l = sign === '+' ? line : lookClean(String(line)).replace(WRITE_UNSEEN, ' ');
  let m = maskSecrets(l), whole = false;
  if (sign === '+' && m !== l && m.includes('[hidden]')) {
    const parts = m.split('[hidden]'), esc = x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const got = new RegExp(`^${parts.map(esc).join('([\\s\\S]*?)')}$`).exec(l);
    if (got && got.slice(1).some(x => WRITE_RUNS.test(x))) {
      m = parts.map((x, i) => (i ? `${WRITE_RUNS.test(got[i]) ? got[i] : '[hidden]'}${x}` : x)).join('');
      whole = true;
    }
  }
  const a = Array.from(m);
  return `${sign} ${a.length > WRITE_LINE ? `${a.slice(0, WRITE_LINE).join('')}… (${a.length - WRITE_LINE} more signs on this line not shown)` : m}${m === l ? '' : sign === '+' ? ' (a value on this line is hidden here; it is written as given)' : ' (a value on this line is hidden here)'}${whole ? WRITE_WHOLE : ''}`;
}
// The button's first lines: what is written where, and the lines that change, old and new (design A 2.14 row 7).
function writeShown(at, place, old, text, from, to) {
  const shown = (sign, list) => [...list.slice(0, WRITE_SHOWN).map(l => writeLineShown(sign, l)), ...(list.length > WRITE_SHOWN ? [`${sign} … and ${list.length - WRITE_SHOWN} more lines`] : [])];
  const head = `Write this file on ${at}?`, now = writeSplit(text);
  if (old.kind === 'hidden') return [head, `${place.shown}: its old text is hidden (a key, or a file a look may not read), so only the new text is shown`, ...shown('+', now)];
  if (old.kind === 'file' && !old.bytes) return [head, `${place.shown} (${sizeWords(old.size)} now: its old text isn’t shown)`, ...shown('+', now)];
  const oldText = old.kind === 'file' ? old.bytes.toString('utf8') : '', was = writeSplit(oldText), n = `${was.length} line${was.length === 1 ? '' : 's'} now`;
  if (Number.isInteger(from)) {
    const gone = was.slice(from - 1, to), add = now;
    return [head, `${place.shown}: ${gone.length ? `lines ${from} to ${to} replaced` : `new lines before line ${from}`} (${n})`, ...shown('-', gone), ...shown('+', add)];
  }
  if (old.kind !== 'file') return [head, `${place.shown}: a new file, ${now.length} line${now.length === 1 ? '' : 's'}`, ...shown('+', now)];
  let a = 0;
  while (a < was.length && a < now.length && was[a] === now[a]) a++;
  let b = 0;
  while (b < was.length - a && b < now.length - a && was[was.length - 1 - b] === now[now.length - 1 - b]) b++;
  const gone = was.slice(a, was.length - b), added = now.slice(a, now.length - b);
  const what = gone.length || added.length ? `from line ${a + 1}, ${gone.length} line${gone.length === 1 ? '' : 's'} out, ${added.length} in`
    : oldText === text ? 'the same text' : 'only the line break at the end changes';
  return [head, `${place.shown}: ${what} (${n})`, ...shown('-', gone), ...shown('+', added)];
}

async function writeFile(input, viewer, ctx = {}) {
  if (input.on === 'box') return boxWrite(input, viewer, ctx);   // (in the box, 21-box.mjs: written from inside it)
  whoMayLook(viewer, ctx);
  const node = sparkOf(viewer, input.on), text = String(input.text), { from, to } = input, no = (code, why) => new HttpError(code, `${why} Nothing was written.`);
  if ((from === undefined) !== (to === undefined)) throw no(400, 'from and to go together: lines from to to are replaced (to = from - 1 puts the text before line from).');
  if (Number.isInteger(from) && to < from - 1) throw no(400, `to (${to}) is before from - 1: there are no lines to replace there.`);
  if (Buffer.byteLength(text) > WRITE_MAX) throw no(400, 'The text is over 128 KB, the most write_file writes.');
  // (what is shown is what is written: a sign that doesn't show, as the dangerous ask refuses it, 20-danger.mjs)
  if (DANGER_HIDDEN.test(text) || DANGER_HIDDEN.test(String(input.path))) throw no(400, 'It holds a sign that doesn’t show (a control sign, a carriage return, a zero-width or direction mark), so what would be shown isn’t what would be written.');
  const key = writeKey(text);
  if (key) throw no(400, `The text holds ${key}, so it isn’t written or shown on a button: give the key by its name.`);
  const place = writePlace(input.path), sortAs = `cat > ${q(place.rel)}`, sorted = sortCommand(sortAs, runnerSortOpts(node, ctx, place.dir));
  // (the hub, a brain Spark, root, a pause, not done, the lock-out class: refused before anything is read, as for run)
  runnerNever(node, sorted, ctx);
  // (the lock-out class is never written, nor handed to the lock-out net, which runs a command bare: its press would run
  // the plain write the sorter was handed, with nothing on its input)
  if (sorted.class === 'lockout') {
    throw new HttpError(403, NET_ON ? `Nothing ran: a change that can lock you out of ${sparkName(node)} runs only as a plain command inside the lock-out net, never as write_file. ${sorted.why}`
      : `Nothing ran: the lock-out net is switched off in this console, and a change that can lock you out of ${sparkName(node)} runs only inside it. ${sorted.why}`);
  }
  if (sorted.class === 'notdone') return workChange(node, sortAs, sorted, viewer, ctx, place.dir);
  const old = await writeOld(node, place);
  if (old.kind === 'helper') {
    const needs = helperNeeds(node, old.answer);
    if (needs) return needs;
    throw no(502, `${sparkName(node)}’s look at ${place.shown} didn’t answer the way the root helper does (${maskSecrets(String(old.answer.detail || old.answer.kind)).slice(0, 200)}).`);
  }
  if (old.kind === 'link') throw no(400, `${place.shown} is a link: write_file never writes through one, nor replaces it.`);
  if (old.kind === 'other') throw no(400, `${place.shown} isn’t a plain file (a folder, a device or a socket).`);
  if (old.kind === 'readonly') throw no(400, `${place.shown} is read-only, so write_file doesn’t replace it (a write to it would fail).`);
  let bytes;
  if (Number.isInteger(from)) {
    if (old.kind !== 'file' || !old.bytes) throw no(400, `Lines ${from} to ${to} need ${place.shown} there as a plain text file of at most 256 KB a look may read, and it isn’t.`);
    // (the lines are put together as text: a file that doesn't come back byte for byte from it would change elsewhere)
    if (!Buffer.from(old.bytes.toString('utf8')).equals(old.bytes)) throw no(400, `${place.shown} isn’t UTF-8 text, so lines ${from} to ${to} can’t be put in it without changing other bytes: write the whole file.`);
    const n = writeSplit(old.bytes.toString('utf8')).length;
    if (to > n) throw no(400, `${place.shown} has ${n} line${n === 1 ? '' : 's'}, so lines ${from} to ${to} aren’t all there.`);
    bytes = Buffer.from(writeSplice(old.bytes.toString('utf8'), text, from, to));
  } else bytes = Buffer.from(text);
  const span = Number.isInteger(from) ? ` (lines ${from} to ${to})` : '';
  const spec = {
    key: `write_file\n${place.shown}\n${from ?? ''}-${to ?? ''}\n${createHash('sha256').update(text).digest('hex')}`,
    args: { on: node.id, path: input.path, text, ...(Number.isInteger(from) ? { from, to } : {}) },
    sums: { [place.shown]: old.kind === 'file' ? old.sha : old.kind === 'hidden' ? `hidden ${old.sig}` : old.kind },
    // (a file whose old text is hidden is asked, never written at once: the owner sees what they can't read here)
    ...(old.kind === 'hidden' ? { ask: 'its old text is hidden from a look, so you see only the new text' } : {}),
    lines: at => writeShown(at, place, old, text, from, to),
    // (the lines the button shows whole, for Telegram's ask and the page's copy: the records keep them masked)
    whole: at => writeShown(at, place, old, text, from, to).filter(l => l.startsWith('+ ') && l.endsWith(WRITE_WHOLE)),
    file: { path: place.shown, before: old.kind === 'file' && old.bytes ? old.bytes.toString('utf8') : '', after: bytes.toString('utf8') },
    run: writeProgram(place.rel, old),
    as: { sortAs, stdin: bytes, path: place.shown, shown: `write_file ${place.shown}${span}: ${bytes.length} bytes`,
      result: { wrote: { path: place.shown, bytes: bytes.length, ...(Number.isInteger(from) ? { lines: [from, to] } : {}) } } },
  };
  return workChange(node, sortAs, sorted, viewer, ctx, place.dir, {}, spec);
}

action({
  name: 'write_file', title: 'Write a file on a Spark', kind: 'read', changes: true, scope: 'fleet:read', who: 'owner', group: 'reading',
  description: `Use to write one text file on a compute Spark: the whole file, or its lines from to to (as cat -n numbered them; to = from - 1 puts the text before line from). The path is ~/… or a whole path, or else from ~/work, where run starts. Code decides as it does for run: at once when the owner’s words asked for that work there and nothing was read since; otherwise the owner gets a button with the lines that change, old and new. Never on ${hubName()}, as root, or into what could lock the owner out. The old file is copied first so undo can put it back, and a file that changed since it was read is left as it is. At most 128 KB; a key is given by its name, never in the text. With on "box", a file in your box under /work, written from inside it.`,
  input: { type: 'object', properties: {
    on: { ...sparkArg, box: true, description: 'Where: a Spark id, like spark3 ("Spark 3" works too), or "box".' },
    path: { type: 'string', maxLength: 1024, pattern: '^[^\\x00-\\x1f]+$', description: 'The file: ~/…, a whole path, or a path from ~/work.' },
    text: { type: 'string', maxLength: WRITE_MAX, pattern: '^[^\\x00]*$', description: 'The whole file, or the lines that go in place of from to to.' },
    from: { type: 'integer', minimum: 1, maximum: 1000000, description: 'The first line replaced; with to.' },
    to: { type: 'integer', minimum: 0, maximum: 1000000, description: 'The last line replaced; from - 1 to put the text before line from.' },
  }, required: ['on', 'path', 'text'], additionalProperties: false },
  run: (input, viewer, ctx) => writeFile(input, viewer, ctx),
});

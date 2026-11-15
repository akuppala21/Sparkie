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

// Where the change starts and the path from there: ~/… and a whole path from the home; anything else from ~/work, as
// run starts there.
function writePlace(path) {
  const p = String(path);
  if (p === '~' || p.startsWith('~/')) return { dir: '~', rel: p.slice(2) || '.', shown: p };
  if (p.startsWith('/')) return { dir: '~', rel: p, shown: p };
  return { dir: RUNNER_DIR, rel: p.replace(/^(?:\.\/)+/, ''), shown: `${RUNNER_DIR}/${p.replace(/^(?:\.\/)+/, '')}` };
}

// The file as it is now, read by code as the owner (never through a link): a plain file's size, SHA-256 and, up to
// 256 KB, its bytes; or a link, something else, or nothing there.
async function writeOld(node, place) {
  const d = place.dir === '~' ? '"$HOME"' : `"$HOME"${q(place.dir.slice(1))}`;
  const r = await run(node, `cd -- ${d} 2>/dev/null || { echo none; exit 0; }; p=${q(place.rel)}; if [ -L "$p" ]; then echo link; elif [ -f "$p" ]; then printf 'file %s %s\\n' "$(stat -c %s -- "$p")" "$(sha256sum < "$p" | cut -d' ' -f1)"; head -c ${WRITE_READ + 1} -- "$p" | base64 -w0; echo; elif [ -e "$p" ]; then echo other; else echo none; fi`, { timeout: 20000 });
  if (r.code !== 0) throw new HttpError(r.code === 255 ? 503 : 502, `The file on ${sparkName(node)} couldn’t be read, so nothing was asked or written.`);
  const [head = '', b64 = ''] = String(r.out).split('\n'), m = /^file (\d+) ([0-9a-f]{64})$/.exec(head.trim());
  if (m) return { kind: 'file', size: Number(m[1]), sha: m[2], bytes: Number(m[1]) <= WRITE_READ ? Buffer.from(b64.trim(), 'base64') : null };
  return { kind: ['link', 'other'].includes(head.trim()) ? head.trim() : 'none' };
}

// Code's own program for the unit: the bytes come on its input. It writes only while the file is as it was read here.
function writeProgram(rel, old, from, to) {
  const same = old.kind === 'file' ? `[ -f "$p" ] && [ ! -L "$p" ] && [ "$(sha256sum < "$p" | cut -d' ' -f1)" = ${old.sha} ]` : '[ ! -e "$p" ] && [ ! -L "$p" ]';
  const body = Number.isInteger(from) ? `{ head -n ${from - 1} -- "$p"; cat; tail -n +${to + 1} -- "$p"; }` : 'cat';
  return [`p=${q(rel)}`,
    `${same} || { echo 'write_file: the file changed since it was read here, so nothing was written.' >&2; exit 3; }`,
    't=$(mktemp -p "$(dirname -- "$p")" .write_file.XXXXXX) || exit 1',
    `${body} > "$t" || { rm -f -- "$t"; exit 1; }`,
    'if [ -f "$p" ]; then chmod --reference="$p" -- "$t" 2>/dev/null; else chmod 0644 -- "$t"; fi',
    'mv -fT -- "$t" "$p" || { rm -f -- "$t"; exit 1; }'].join('\n');
}

// A text's lines, without the empty one after its last line break.
const writeSplit = s => { const l = String(s).split('\n'); if (l.at(-1) === '') l.pop(); return l; };
// The button's first lines: what is written where, and the lines that change, old and new (masked, each cut to 200).
function writeShown(at, place, old, text, from, to, keyFile) {
  const one = (sign, l) => `${sign} ${Array.from(maskSecrets(l)).slice(0, WRITE_LINE).join('')}`;
  const shown = (sign, list) => [...list.slice(0, WRITE_SHOWN).map(l => one(sign, l)), ...(list.length > WRITE_SHOWN ? [`${sign} … and ${list.length - WRITE_SHOWN} more`] : [])];
  const head = `Write this file on ${at}?`;
  if (keyFile) return [head, `${place.shown}: a key file, so its old text isn’t shown`, ...shown('+', writeSplit(text))];
  if (old.kind === 'file' && !old.bytes) return [head, `${place.shown} (${sizeWords(old.size)} now: its old text isn’t shown)`, ...shown('+', writeSplit(text))];
  const was = old.kind === 'file' ? writeSplit(old.bytes.toString('utf8')) : [], now = writeSplit(text);
  if (Number.isInteger(from)) {
    const gone = was.slice(from - 1, to);
    return [head, `${place.shown}: ${gone.length ? `lines ${from} to ${to} replaced` : `new lines before line ${from}`} (${was.length} line${was.length === 1 ? '' : 's'} now)`, ...shown('-', gone), ...shown('+', now)];
  }
  if (old.kind !== 'file') return [head, `${place.shown}: a new file, ${now.length} line${now.length === 1 ? '' : 's'}`, ...shown('+', now)];
  let a = 0;
  while (a < was.length && a < now.length && was[a] === now[a]) a++;
  let b = 0;
  while (b < was.length - a && b < now.length - a && was[was.length - 1 - b] === now[now.length - 1 - b]) b++;
  const gone = was.slice(a, was.length - b), added = now.slice(a, now.length - b);
  return [head, `${place.shown}: ${gone.length || added.length ? `from line ${a + 1}, ${gone.length} line${gone.length === 1 ? '' : 's'} out, ${added.length} in` : 'the same lines'} (${was.length} line${was.length === 1 ? '' : 's'} now)`, ...shown('-', gone), ...shown('+', added)];
}

async function writeFile(input, viewer, ctx = {}) {
  whoMayLook(viewer, ctx);
  const node = sparkOf(viewer, input.on), text = String(input.text), { from, to } = input;
  if ((from === undefined) !== (to === undefined)) throw new HttpError(400, 'from and to go together: lines from to to are replaced (to = from - 1 puts the text before line from). Nothing was written.');
  if (Number.isInteger(from) && to < from - 1) throw new HttpError(400, `to (${to}) is before from - 1: there are no lines to replace there. Nothing was written.`);
  if (Buffer.byteLength(text) > WRITE_MAX) throw new HttpError(400, 'The text is over 128 KB, the most write_file writes. Nothing was written.');
  // (what is written is shown on its button: nothing a mask would hide)
  if (maskSecrets(text) !== text) throw new HttpError(400, 'The text holds something shaped like a key or password, so it isn’t written or shown on a button: give the key by its name. Nothing was written.');
  const place = writePlace(input.path), sortAs = `cat > ${q(place.rel)}`, sorted = sortCommand(sortAs, runnerSortOpts(node, ctx, place.dir));
  // (Spark 2, a brain Spark, root, a pause, not done, the lock-out class: refused before the file is read, as for run)
  runnerNever(node, sorted, ctx);
  if (['notdone', 'lockout'].includes(sorted.class)) return workChange(node, sortAs, sorted, viewer, ctx, place.dir);
  const old = await writeOld(node, place);
  if (Number.isInteger(from)) {
    if (old.kind !== 'file' || !old.bytes) throw new HttpError(400, `Lines ${from} to ${to} need ${place.shown} there as a plain text file of at most 256 KB, and it isn’t. Nothing was written.`);
    const n = writeSplit(old.bytes.toString('utf8')).length;
    if (to > n) throw new HttpError(400, `${place.shown} has ${n} line${n === 1 ? '' : 's'}, so lines ${from} to ${to} aren’t all there. Nothing was written.`);
  }
  const bytes = Buffer.from(Number.isInteger(from) && text && !text.endsWith('\n') ? `${text}\n` : text);
  const keyFile = keyWord(place.rel), lines = at => writeShown(at, place, old, bytes.toString('utf8'), from, to, keyFile);
  const span = Number.isInteger(from) ? ` (lines ${from} to ${to})` : '';
  const spec = {
    key: `write_file\n${place.shown}\n${from ?? ''}-${to ?? ''}\n${createHash('sha256').update(bytes).digest('hex')}`,
    args: { on: node.id, path: input.path, text, ...(Number.isInteger(from) ? { from, to } : {}) },
    sums: { [place.shown]: old.kind === 'file' ? old.sha : old.kind },
    lines, run: writeProgram(place.rel, old, from, to),
    as: { sortAs, stdin: bytes, path: place.shown, shown: `write_file ${place.shown}${span}: ${bytes.length} bytes`,
      result: { wrote: { path: place.shown, bytes: bytes.length, ...(Number.isInteger(from) ? { lines: [from, to] } : {}) } } },
  };
  return workChange(node, sortAs, sorted, viewer, ctx, place.dir, {}, spec);
}

action({
  name: 'write_file', title: 'Write a file on a Spark', kind: 'read', scope: 'fleet:read', who: 'owner', group: 'reading',
  description: 'Use to write one text file on a compute Spark: the whole file, or its lines from to to (as cat -n numbered them; to = from - 1 puts the text before line from). The path is ~/… or a whole path, or else from ~/work, where run starts. Code decides as it does for run: at once when the owner’s words asked for that work there and nothing was read since; otherwise the owner gets a button with the lines that change, old and new. Never on Spark 2, as root, or into what could lock the owner out. The old file is copied first so undo can put it back, and a file that changed since it was read is left as it is. At most 128 KB; no key or password in the text (give a key by its name).',
  input: { type: 'object', properties: {
    on: { ...sparkArg, description: 'Where: a Spark id, like spark3 ("Spark 3" works too).' },
    path: { type: 'string', maxLength: 1024, pattern: '^[^\\x00-\\x1f]+$', description: 'The file: ~/…, a whole path, or a path from ~/work.' },
    text: { type: 'string', maxLength: WRITE_MAX, pattern: '^[^\\x00]*$', description: 'The whole file, or the lines that go in place of from to to.' },
    from: { type: 'integer', minimum: 1, maximum: 1000000, description: 'The first line replaced; with to.' },
    to: { type: 'integer', minimum: 0, maximum: 1000000, description: 'The last line replaced; from - 1 to put the text before line from.' },
  }, required: ['on', 'path', 'text'], additionalProperties: false },
  run: (input, viewer, ctx) => writeFile(input, viewer, ctx),
});

/* ───────── the box filled from an exact tree, and read back as data (C8b; called by nothing yet) ───────── */
// Area: features        Rules: R62, R52, R43, R23, R47        Tests: box-fill.test.mjs, box-more.test.mjs
// Owns: none
// Timers: none        Wakes: none
// Design C 2.5 needs a box that Spark Console's code, never the brain, fills with a tree of its own repository and
// reads back as one. boxFill takes an exact tree id from the console's own bare copy on Spark 2 (the one pull.sh setup
// makes): git's own list of it must hold only plain files and folders with plain names, within the bounds (the stand-in
// fleet's links under test/mock/root/ are left out: FILL_LINKS_LEFT); git archive
// of that tree is then taken entry by entry here (tarRead) and must hold exactly that tree, byte for byte, before any
// of it goes into the chat's box, as files under one folder (FILL_FOLDER); a box that holds other work is left as it
// is. boxReadBack streams that folder out of the box as tar and takes it entry by entry here, as data: anything but a
// plain file or folder with a plain name, or over a bound, refuses the whole read with the entry's name. What it hands
// back is the paths that differ from the tree filled, with their new blob ids; each new blob goes into the bare copy
// by `git hash-object -w --no-filters --stdin` (bytes only, no index, no checkout, nothing run). Both are a change:
// Sparkie's and an agent's call meet the pause, Sparkie's the rail (R52), as opening the box does. The tree each box
// was filled from lives only in memory. Nothing calls them yet but run's test door on the stand-in fleet
// (BOX_FILL_DOOR, 21-work.mjs); design C's propose_update (C8c) is the first caller.
const FILL_FOLDER = 'spark-console';
// The bounds, for a fill and a read back alike: entries (files and folders), one file, all files, one path (bytes).
const FILL_MAX_ENTRIES = 5000, FILL_MAX_FILE = 8 * 2 ** 20, FILL_MAX_BYTES = 64 * 2 ** 20, FILL_MAX_PATH = 255, FILL_MS = 120000;
const FILL_BOUNDS = '5,000 files and folders, 8 MiB a file, 64 MiB in all, 255 bytes a path';
// The links the repository itself keeps for the stand-in fleet (its model cache): left out of a fill, so the box never
// holds them and a read back never says they went. A link anywhere else refuses the fill; a read back takes none.
const FILL_LINKS_LEFT = 'test/mock/root/';
// The brain eval's held-out set (R47): it tests a brain, so the brain never reads it. A fill leaves it out of the box (git's
// list and stream alike), a read back never says it went, and a box that holds a file of its name refuses the read.
const FILL_HELD_OUT = 'test/eval/memory-held-out.json';
// The console's own bare copy of the repository on Spark 2, and git there with nothing from the system's or the
// user's git config (as pull.sh runs it).
const FILL_GIT = 'env GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null GIT_TERMINAL_PROMPT=0 git --git-dir="$HOME/.local/share/spark-console/repo.git" -c core.hooksPath=/dev/null -c core.attributesFile=/dev/null';
const boxFills = new Map();   // the caller (boxKey) → { tree, box, cid, spark, at }
const boxFilling = new Set(); // the callers with a fill or a read back under way

// A name as a refusal may show it: no control character, keys masked, at most 120 characters.
const fillShow = name => maskSecrets(String(name).replace(/[\u0000-\u001f\u007f-\u009f]/g, '?')).slice(0, 120);
const fillRefuse = (why, name) => new HttpError(409, `${why}${name == null ? '' : `: ${fillShow(name)}`}. Nothing was changed.`);
// What is wrong with a path inside the folder, or null: a plain relative path of plain names within the bounds.
function fillPathWrong(rel) {
  if (/[\u0000-\u001f\u007f-\u009f]/.test(rel)) return 'a name holds a control character';
  if (rel.startsWith('/') || rel.split('/').some(p => p === '..')) return 'a path leaves the folder';
  if (rel.split('/').some(p => p === '' || p === '.')) return 'a path has an empty or "." part';
  if (rel.split('/').some(p => p.toLowerCase() === '.git')) return 'a path holds a .git';
  if (Buffer.byteLength(rel) > FILL_MAX_PATH) return `a path is over ${FILL_MAX_PATH} bytes`;
  return null;
}
// git's id of a blob: the bytes are only hashed.
const fillBlobId = data => createHash('sha1').update(`blob ${data.length}\0`).update(data).digest('hex');

// One tar stream, entry by entry, by this code alone (no tar program reads it here). Only what a ustar writer makes of
// plain files and folders under `folder` is taken: a regular file or a folder, its name as ustar (and git's pax path)
// gives it, strict UTF-8; nothing else is ever written anywhere. A link, a hard link, a device, a fifo, a type it
// doesn't know, a pax key it doesn't know, a damaged header, a path that leaves the folder, a name that differs from
// another only by case or Unicode form, or one past a bound refuses the whole stream, with the entry's name. Only a
// link or a file whose path is in `skip` (a fill's FILL_LINKS_LEFT and FILL_HELD_OUT, never a read back's) is passed
// over, and its bytes (with its extended header) are given back in `drop`, for the fill to leave out of the stream.
const TAR_UTF8 = new TextDecoder('utf-8', { fatal: true });
const TAR_TYPES = { 1: 'a hard link', 2: 'a link', 3: 'a device', 4: 'a device', 6: 'a fifo', 7: 'an entry type the reader doesn’t know' };
function tarRead(buf, folder, skip = new Set()) {
  const out = [], seen = new Map(), drop = [], relOf = n => (String(n).startsWith(`${folder}/`) ? String(n).slice(folder.length + 1) : null);
  let off = 0, pax = null, bytes = 0, from = 0;
  const cstr = b => { const i = b.indexOf(0); return i < 0 ? b : b.subarray(0, i); };
  const utf8 = (b, name) => { try { return TAR_UTF8.decode(b); } catch { throw fillRefuse('a name isn’t UTF-8', name ?? b.toString('latin1')); } };
  const octal = (b, name) => { const s = cstr(b).toString('latin1').trim(); if (!/^[0-7]{1,12}$/.test(s)) throw fillRefuse('an entry’s header holds a number the reader doesn’t know', name); return parseInt(s, 8); };
  for (;;) {
    if (off + 512 > buf.length) throw fillRefuse('the stream ends before its end mark', null);
    const h = buf.subarray(off, off + 512);
    if (!pax) from = off;
    if (h.every(x => x === 0)) {
      if (!buf.subarray(off).every(x => x === 0)) throw fillRefuse('there are bytes after the stream’s end', null);
      break;
    }
    const pre = cstr(h.subarray(345, 500)), base = cstr(h.subarray(0, 100));
    const raw = pre.length ? Buffer.concat([pre, Buffer.from('/'), base]) : base, shown = raw.toString('latin1');
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : h[i];
    if (octal(h.subarray(148, 156), shown) !== sum) throw fillRefuse('an entry’s header is damaged (its checksum doesn’t match)', shown);
    if (h.subarray(257, 263).toString('latin1') !== 'ustar\0' || h.subarray(263, 265).toString('latin1') !== '00') throw fillRefuse('an entry isn’t in the one tar form the reader knows (ustar)', shown);
    const type = String.fromCharCode(h[156]), size = octal(h.subarray(124, 136), shown), start = off + 512;
    if (start + size > buf.length) throw fillRefuse('the stream ends inside an entry', shown);
    const data = buf.subarray(start, start + size);
    off = start + Math.ceil(size / 512) * 512;
    // (pax: git writes a path too long for ustar this way, and a global comment for a commit; nothing else is taken)
    if (type === 'x' || type === 'g') {
      if (size > 65536) throw fillRefuse('an extended header is too long', shown);
      const keys = new Map();
      for (let i = 0; i < data.length;) {
        const sp = data.indexOf(0x20, i), len = sp > i ? Number(data.subarray(i, sp).toString('latin1')) : NaN;
        if (!Number.isInteger(len) || len <= sp - i || i + len > data.length || data[i + len - 1] !== 0x0a) throw fillRefuse('an extended header is damaged', shown);
        const rec = utf8(data.subarray(sp + 1, i + len - 1), shown), eq = rec.indexOf('=');
        if (eq < 1) throw fillRefuse('an extended header is damaged', shown);
        keys.set(rec.slice(0, eq), rec.slice(eq + 1));
        i += len;
      }
      for (const k of keys.keys()) {
        if (k === 'linkpath' && !(type === 'x' && skip.has(relOf(keys.get('path'))))) throw fillRefuse('an entry is a link', keys.get('path') ?? shown);
        if (!(type === 'x' ? ['path', 'mtime', 'atime', 'ctime'] : ['comment']).includes(k)) throw fillRefuse(`an extended header holds a key the reader doesn’t know (${fillShow(k).slice(0, 40)})`, shown);
      }
      if (type === 'x') pax = keys;
      continue;
    }
    let name = pax?.has('path') ? pax.get('path') : utf8(raw, shown);
    pax = null;
    if ((type === '2' || type === '0' || type === '\0') && skip.has(relOf(name))) { drop.push([from, off]); continue; }
    if (type !== '0' && type !== '\0' && type !== '5') throw fillRefuse(`an entry is ${TAR_TYPES[type] || 'of a type the reader doesn’t know'}`, name);
    const dir = type === '5';
    if (dir && name.endsWith('/')) name = name.slice(0, -1);
    if (/[\u0000-\u001f\u007f-\u009f]/.test(name)) throw fillRefuse('a name holds a control character', name);
    if (name.startsWith('/') || name.split('/').includes('..')) throw fillRefuse('a path leaves the folder', name);
    if (name !== folder && !name.startsWith(`${folder}/`)) throw fillRefuse(`an entry is outside the folder ${folder}`, name);
    if (name === folder) { if (!dir) throw fillRefuse('the folder is a file', name); continue; }
    const rel = name.slice(folder.length + 1), wrong = fillPathWrong(rel);
    if (wrong) throw fillRefuse(wrong, name);
    if (seen.size >= FILL_MAX_ENTRIES) throw fillRefuse(`there are more than ${FILL_MAX_ENTRIES.toLocaleString('en-US')} files and folders`, null);
    if (!dir && size > FILL_MAX_FILE) throw fillRefuse(`a file is over ${FILL_MAX_FILE / 2 ** 20} MiB`, name);
    if (!dir && (bytes += size) > FILL_MAX_BYTES) throw fillRefuse(`the files are over ${FILL_MAX_BYTES / 2 ** 20} MiB in all`, null);
    // (one name a place: the same path twice, or two that differ only by case or Unicode form, or a file and a folder)
    const key = p => p.normalize('NFC').toLowerCase(), parts = rel.split('/');
    for (let i = 1; i < parts.length; i++) if (seen.get(key(parts.slice(0, i).join('/')))?.dir === false) throw fillRefuse('a file and a folder have one name', name);
    const was = seen.get(key(rel));
    if (was) throw fillRefuse(was.rel === rel ? 'a path is there twice' : `a name differs only by case or Unicode form from ${fillShow(was.rel).slice(0, 60)}`, name);
    seen.set(key(rel), { rel, dir });
    if (!dir) out.push({ path: rel, mode: octal(h.subarray(100, 108), name) & 0o100 ? '100755' : '100644', data });
  }
  return { files: out, bytes, entries: seen.size, drop };
}

// One command on a Spark with bytes in (stdin) and bytes out: at most `max` bytes are kept, and past that it is ended
// (over). Never throws.
function fillStream(node, command, { input = null, max = 4 * 2 ** 20, timeout = FILL_MS } = {}) {
  if (knownOffline(node)) return Promise.resolve({ code: 255, out: Buffer.alloc(0), err: `${node.id} isn’t reachable`, over: false });
  return new Promise(resolve => {
    const child = spawnOn(node, { command }), parts = [];
    let n = 0, err = '', over = false;
    child.stdout.on('data', c => { if (over) return; n += c.length; if (n > max) { over = true; child.kill('SIGKILL'); } else parts.push(c); });
    child.stderr.on('data', c => { err = (err + c).slice(-4000); });
    child.stdin.on('error', () => {});
    if (input) child.stdin.end(input); else child.stdin.end();
    const timer = setTimeout(() => { err += '\n(timed out)'; child.kill('SIGKILL'); }, timeout);
    child.on('close', code => { clearTimeout(timer); resolve({ code: code ?? -1, out: Buffer.concat(parts), err: err.trim(), over }); });
  });
}
const fillHub = () => { const hub = NODES.find(n => n.host === 'local'); if (!hub) throw new HttpError(503, 'Spark Console’s own Spark isn’t on its list, so its copy of the repository can’t be read. Nothing was changed.'); return hub; };
// git's own list of a tree in the bare copy: { blobs: Map path → { mode, oid, size }, trees: Set of paths }, refused
// whole for anything but plain files and folders with plain names within the bounds.
async function fillTreeList(tree) {
  const r = await fillStream(fillHub(), `[ -d "$HOME/.local/share/spark-console/repo.git" ] || exit 4; [ "$(${FILL_GIT} cat-file -t ${tree} 2>/dev/null)" = tree ] || exit 3; exec ${FILL_GIT} ls-tree -r -t -l -z --full-tree ${tree}`,
    { max: FILL_MAX_ENTRIES * 400 });
  if (r.code === 4) throw new HttpError(409, 'Spark Console’s copy of the repository isn’t on Spark 2 yet (pull.sh setup makes it), so the box can’t be filled. Nothing was changed.');
  if (r.code === 3) throw new HttpError(409, `${tree} isn’t a tree in Spark Console’s copy of the repository. Nothing was changed.`);
  if (r.over) throw fillRefuse(`the tree has more than ${FILL_MAX_ENTRIES.toLocaleString('en-US')} files and folders`, null);
  if (r.code !== 0) throw new HttpError(502, `git couldn’t list the tree on Spark 2: ${fillShow(r.err.split('\n')[0] || `exit ${r.code}`)}. Nothing was changed.`);
  const blobs = new Map(), trees = new Set(), links = new Set(), left = new Set(), seen = new Map();
  let bytes = 0;
  for (const rec of r.out.toString('latin1').split('\0').filter(Boolean)) {
    const m = /^(\d{6}) (\w+) ([0-9a-f]{40}) +(-|\d+)\t([\s\S]+)$/.exec(rec);
    if (!m) throw new HttpError(502, 'git’s list of the tree isn’t one the console knows. Nothing was changed.');
    let path;
    try { path = TAR_UTF8.decode(Buffer.from(m[5], 'latin1')); } catch { throw fillRefuse('a name isn’t UTF-8', m[5]); }
    const [, mode, type, oid, size] = m;
    const link = mode === '120000';
    if (link && !path.startsWith(FILL_LINKS_LEFT)) throw fillRefuse('the tree holds a link', path);
    if (mode === '160000') throw fillRefuse('the tree holds a link to another repository (a submodule)', path);
    if (!link && (!['100644', '100755', '040000'].includes(mode) || (type === 'tree') !== (mode === '040000'))) throw fillRefuse('the tree holds an entry type the console doesn’t fill', path);
    const wrong = fillPathWrong(path);
    if (wrong) throw fillRefuse(wrong, path);
    if (blobs.size + trees.size + links.size >= FILL_MAX_ENTRIES) throw fillRefuse(`the tree has more than ${FILL_MAX_ENTRIES.toLocaleString('en-US')} files and folders`, null);
    const key = path.normalize('NFC').toLowerCase(), was = seen.get(key);
    if (was) throw fillRefuse(`a name differs only by case or Unicode form from ${fillShow(was).slice(0, 60)}`, path);
    seen.set(key, path);
    if (link) { links.add(path); continue; }
    if (type === 'tree') { trees.add(path); continue; }
    if (path === FILL_HELD_OUT) { left.add(path); continue; }
    if (Number(size) > FILL_MAX_FILE) throw fillRefuse(`a file is over ${FILL_MAX_FILE / 2 ** 20} MiB`, path);
    if ((bytes += Number(size)) > FILL_MAX_BYTES) throw fillRefuse(`the tree’s files are over ${FILL_MAX_BYTES / 2 ** 20} MiB in all`, null);
    blobs.set(path, { mode, oid, size: Number(size) });
  }
  return { blobs, trees, links, left, bytes };
}
// Opening a box is a change, and so are a fill and a read back: an agent's call meets the put-back hold (R23),
// Sparkie's and an agent's call the pause, Sparkie's the rail (R52), as the box's own open does. A refusal by the rail
// carries rail: true (run's door makes it a button).
async function fillGate(viewer, ctx) {
  whoMayLook(viewer, ctx);
  const by = boxBy(ctx);
  if ((ctx.agentId || by === 'agent') && putBackHeld()) throw new HttpError(403, PUTBACK_AGENTS);
  if (by !== 'owner' && agentSettings().halted) throw new HttpError(403, 'Agents’ changes are paused (your account menu → Agents and Telegram), and filling or reading back a box is a change, so nothing was done.');
  if (by === 'sparkie') {
    const rail = await brainRail();
    if (!rail.checked) throw Object.assign(new HttpError(409, `Sparkie’s brain isn’t checked (${rail.why}), so filling or reading back a box waits for the owner’s yes. Nothing was done.`), { rail: true });
  }
}
// The box a caller holds, on a compute Spark that is still allowed one (never Spark 2 or the brain's: R1).
function fillBoxNode(b) {
  const node = nodeById(b.spark);
  if (boxBarred(node)) throw new HttpError(403, `${sparkName(node || { id: b.spark })} holds the brain or is the hub, so its box isn’t used. Nothing was changed.`);
  return node;
}
function fillRecord(ctx, act, fields, t0) {
  journal('cmd', { id: journalId(), chat: ctx.chat || null, via: ctx.via || null, actor: ctx.actor || null, act: 'run', where: 'box', class: 'change', gate: 'box', exit: null,
    ms: Date.now() - t0, ...fields, args: { ...fields.args, command: act }, err: fields.err ? jErr(fields.err) : null, sub: jSub(fields.args?.spark || null) });
}

// The box's own script for a fill (bash, inside the box, in /work; its arguments: the call's id, the folder): it
// changes nothing when /work holds anything, else unpacks the stream on stdin there, and on a failure removes what it
// unpacked. Its last line is the code's: "<id> fill busy <n>", "<id> fill done <files>" or "<id> fill failed <tar's
// last words>".
const FILL_SCRIPT = String.raw`id=$1; f=$2
n=$(ls -A . 2>/dev/null | wc -l | tr -d ' ')
if [ "$n" != 0 ]; then printf '%s fill busy %s\n' "$id" "$n"; exit 0; fi
if e=$(tar --extract --file=- --no-same-owner --no-same-permissions --keep-old-files 2>&1 >/dev/null); then printf '%s fill done %s\n' "$id" "$(find "$f" -type f | wc -l | tr -d ' ')"
else rm -rf -- "$f"; printf '%s fill failed %s\n' "$id" "$(printf '%s' "$e" | tail -n 1 | head -c 200)"; fi`;

// Fills the caller's box (opened first when it isn't) with an exact tree from the console's bare copy, as files under
// FILL_FOLDER. { filled: true, box, spark, tree, folder, files, bytes, observedAt }, or { filled: false, box: 'not
// yet', spark, why } while the box's image is fetched. Throws HttpError for the pause (403), the rail (409, rail: true),
// a box that holds other work (409), a tree it refuses (409), and a fill Docker or tar didn't finish (502).
async function boxFill(viewer, ctx, tree) {
  const t0 = Date.now(), key = boxKey(ctx), rec = { outcome: 'refused', args: { spark: null, tree: String(tree).slice(0, 64) } };
  if (boxFilling.has(key)) throw new HttpError(409, 'A fill or read back of this box is under way. Nothing more was done.');
  boxFilling.add(key);
  try {
    await fillGate(viewer, ctx);
    if (!/^[0-9a-f]{40}$/.test(String(tree))) throw new HttpError(400, 'A fill takes one tree id (40 hex) from Spark Console’s own copy of the repository. Nothing was changed.');
    // 1. git's list, then git's own archive of it, each taken entry by entry, before the box is touched
    const list = await fillTreeList(tree);
    const a = await fillStream(fillHub(), `${FILL_GIT} archive --format=tar --prefix=${FILL_FOLDER}/ ${tree}`, { max: FILL_MAX_BYTES + FILL_MAX_ENTRIES * 1024 + 65536 });
    if (a.over || a.code !== 0) throw new HttpError(502, `git couldn’t make the tree’s archive on Spark 2${a.over ? ' within the bounds' : `: ${fillShow(a.err.split('\n')[0] || `exit ${a.code}`)}`}. Nothing was changed.`);
    const got = tarRead(a.out, FILL_FOLDER, new Set([...list.links, ...list.left])), dirs = [...new Set(got.files.flatMap(f => f.path.split('/').slice(0, -1).map((_, i, p) => p.slice(0, i + 1).join('/'))))];
    const same = got.files.length === list.blobs.size && got.files.every(f => { const b = list.blobs.get(f.path); return b && b.mode === f.mode && fillBlobId(f.data) === b.oid; })
      && dirs.every(d => list.trees.has(d));
    if (!same) throw new HttpError(409, 'git’s archive of the tree doesn’t hold exactly the tree (an attribute of the repository’s may drop or change a file), so the box wasn’t filled. Nothing was changed.');
    // (git's own bytes, less the links left out: each one's header, extended header and data)
    const stream = got.drop.length ? Buffer.concat([...got.drop.map(([f], i) => a.out.subarray(i ? got.drop[i - 1][1] : 0, f)), a.out.subarray(got.drop.at(-1)[1])]) : a.out;
    // 2. the box, opened as run {on: "box"} opens it
    let p = boxOpening.get(key);
    if (!p) { p = boxOpen(key, ctx, `fill ${tree}`).finally(() => boxOpening.delete(key)); boxOpening.set(key, p); }
    const b = await p;
    rec.args.spark = b.spark;
    if (b.pulling) { rec.outcome = 'not yet'; return { filled: false, box: 'not yet', spark: b.spark, why: `The box’s image is being fetched to ${sparkName(nodeById(b.spark) || { id: b.spark })} (once; a minute or two). Ask again then. Nothing was filled.` }; }
    const node = fillBoxNode(b), at = sparkName(node), id = randomBytes(12).toString('hex');
    // 3. into the box, only if it holds nothing else
    const r = await fillStream(node, `docker exec -i ${q(b.name)} bash -c ${q(FILL_SCRIPT)} fill ${id} ${FILL_FOLDER}`, { input: stream, max: 65536 });
    const last = r.out.toString('utf8').split('\n').filter(l => l.startsWith(`${id} fill `)).pop()?.slice(id.length + 6).split(' ') || [];
    if (last[0] === 'busy') { rec.outcome = 'busy'; throw new HttpError(409, `This chat’s box on ${at} holds other work (${Number(last[1]) || 'some'} thing${Number(last[1]) === 1 ? '' : 's'} in its folder), so nothing was put in it.`); }
    if (last[0] !== 'done' || Number(last[1]) !== got.files.length) {
      rec.outcome = 'failed';
      const said = last[0] === 'failed' ? last.slice(1).join(' ') : last[0] === 'done' ? `${last[1]} files unpacked, not ${got.files.length}` : r.err.split('\n').filter(Boolean).pop() || `exit ${r.code}`;
      // (unpacked, but not the count it should be: the folder goes, as the script takes it out on a failure)
      if (last[0] === 'done') await fillStream(node, `docker exec ${q(b.name)} rm -rf -- ${FILL_FOLDER}`, { max: 4096, timeout: 30000 });
      throw new HttpError(502, `The tree couldn’t be put in the box on ${at}${r.code === 255 ? ` (${at} didn’t answer)` : ''} (${fillShow(said)}); what was unpacked was taken out again. Nothing else was changed.`);
    }
    boxFills.set(key, { tree, box: b.name, cid: b.cid, spark: b.spark, at: new Date().toISOString() });
    rec.outcome = 'filled';
    return { filled: true, box: b.name, spark: b.spark, tree, folder: FILL_FOLDER, files: got.files.length, bytes: got.bytes, observedAt: new Date().toISOString() };
  } catch (e) { rec.err = e; throw e; } finally {
    boxFilling.delete(key);
    fillRecord(ctx, `fill ${rec.args.tree}`, { unit: boxName(key), args: rec.args, ok: !rec.err, outcome: rec.outcome, err: rec.err }, t0);
  }
}
// The tree a caller's box was filled from, while that box is the one open: { tree, box, cid, spark, at }, or null. A
// box opened again in the same chat has the same name and often the same Spark: its container's id tells them apart.
function boxFillOf(ctx) {
  const key = boxKey(ctx), f = boxFills.get(key), b = boxes.get(key);
  return f && b && b.name === f.box && b.cid === f.cid && b.spark === f.spark && b.until > Date.now() ? { ...f } : null;
}
// Reads the caller's filled box back: its folder streamed out as tar (`tar --create --format=ustar` in the box),
// taken entry by entry by tarRead, as data. { box, spark, tree, folder, changes: [{ path, blob, mode }] sorted by path
// (blob and mode null: no longer there), files, bytes, observedAt }. Each new blob is written to the bare copy by
// `git hash-object -w --no-filters --stdin` and its id checked against the console's own. Throws HttpError for the
// pause (403), the rail (409, rail: true), a box not filled or no longer open (409), a refused entry (409, with its
// name), and Docker, tar or git not answering (502).
async function boxReadBack(viewer, ctx) {
  const t0 = Date.now(), key = boxKey(ctx), rec = { outcome: 'refused', args: { spark: null } };
  if (boxFilling.has(key)) throw new HttpError(409, 'A fill or read back of this box is under way. Nothing more was done.');
  boxFilling.add(key);
  try {
    await fillGate(viewer, ctx);
    const fill = boxFillOf(ctx);
    if (!fill) throw new HttpError(409, boxFills.has(key) ? 'The box that was filled has ended (or was opened again since), so there is nothing to read back.' : 'This chat’s box wasn’t filled by Spark Console (or the console restarted since), so there is nothing to read back.');
    rec.args.spark = fill.spark;
    const node = fillBoxNode(fill), at = sparkName(node);
    const r = await fillStream(node, `docker exec ${q(fill.box)} tar --create --file=- --format=ustar --numeric-owner -- ${FILL_FOLDER}`,
      { max: FILL_MAX_BYTES + FILL_MAX_ENTRIES * 1024 + 65536 });
    if (r.over) throw fillRefuse(`the box’s folder is over the bounds (${FILL_BOUNDS})`, null);
    if (r.code !== 0) throw new HttpError(502, `The box’s folder on ${at} couldn’t be read out whole${r.code === 255 ? ` (${at} didn’t answer)` : ''}: ${fillShow(r.err.split('\n').filter(Boolean).pop() || `exit ${r.code}`)}. Nothing was taken.`);
    const got = tarRead(r.out, FILL_FOLDER), list = await fillTreeList(fill.tree), changes = [];
    for (const f of got.files) {
      if (f.path === FILL_HELD_OUT) throw fillRefuse('the eval’s held-out set is never taken from a box', `${FILL_FOLDER}/${f.path}`);
      const blob = fillBlobId(f.data), was = list.blobs.get(f.path);
      if (was && was.oid === blob && was.mode === f.mode) continue;
      // (bytes only: hash-object, no filter, no path given; the id it answers must be the console's own)
      const w = await fillStream(fillHub(), `${FILL_GIT} hash-object -w --no-filters -t blob --stdin`, { input: f.data, max: 4096 });
      if (w.code !== 0 || w.out.toString('latin1').trim() !== blob) throw new HttpError(502, `git couldn’t keep a file read back from the box on Spark 2 (${fillShow(f.path)}). Nothing more was taken.`);
      changes.push({ path: f.path, blob, mode: f.mode });
    }
    const there = new Set(got.files.map(f => f.path));
    for (const path of list.blobs.keys()) if (!there.has(path)) changes.push({ path, blob: null, mode: null });
    changes.sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));
    rec.outcome = 'read';
    return { box: fill.box, spark: fill.spark, tree: fill.tree, folder: FILL_FOLDER, changes, files: got.files.length, bytes: got.bytes, observedAt: new Date().toISOString() };
  } catch (e) { rec.err = e; throw e; } finally {
    boxFilling.delete(key);
    fillRecord(ctx, 'read back', { unit: boxName(key), args: rec.args, ok: !rec.err, outcome: rec.outcome, err: rec.err }, t0);
  }
}
// run's test door (stand-in fleet only, BOX_FILL_DOOR): "/fill <tree>" or "/read-back". The rail's refusal is a button,
// as the box's own open makes it (propose).
async function boxFillDoor(input, viewer, ctx) {
  const c = String(input.command).trim();
  try { return c === '/read-back' ? await boxReadBack(viewer, ctx) : await boxFill(viewer, ctx, c.slice('/fill '.length)); } catch (e) {
    if (e.rail) return propose(viewer, ctx, 'run', input);
    throw e;
  }
}

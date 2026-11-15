/* ───────── the dangerous ask's "came from": what the command names and where it was read (A10b) ───────── */
// Area: safety        Rules: R54        Tests: danger.test.mjs
// Owns: none
// Timers: none        Wakes: none
// Line 4 of a dangerous ask (20-danger.mjs), with no model call: the things its bytes name, and for each one the owner
// did not write, the read or earlier answer that holds it. The reads' text comes back from the journal by id, is only
// searched and never shown.
const DANGER_READS = 40, DANGER_READ_BYTES = 64 * 2 ** 20, DANGER_FROM_LINES = 8, DANGER_ANSWERS = 20;
// The things line 4 looks for, from the bytes of line 7 (and a file's path): every address (with a scheme or without
// one: a host with its path whole, or a host alone), path, IP address, and package or image name after install, add,
// pull or run of the programs that fetch them, or after a runner (npx). Printable ASCII only, no spaces.
const DANGER_HOST = '(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z]{2,24}';
function dangerThings(text) {
  let t = String(text || '');
  const out = new Set(), add = x => { const v = x.replace(/[.,;:)\]'"]+$/, ''); if (v.length >= 3) out.add(v.slice(0, 200)); };
  // (what is taken is blanked where it stands, as long as it was, so nothing after it moves and nothing else is touched)
  const blank = s => ' '.repeat(s.length);
  const take = re => { for (const m of t.matchAll(re)) add(m[1] ?? m[0]); t = t.replace(re, blank); };
  take(/\b(?:https?|ftp):\/\/[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]+/gi);
  // (packages and images before addresses with no scheme: an image's name can look like one; each name is kept with
  // where it stands, [at, name])
  const named = [], ok = w => !w.startsWith('-') && /^[A-Za-z0-9@][A-Za-z0-9._@/:=<>~+-]*$/.test(w);
  const words = m => [...m[1].matchAll(/\S+/g)].map(w => [m.index + m[0].length - m[1].length + w.index, w[0]]);
  for (const m of t.matchAll(/\b(?:pip(?:\d+(?:\.\d+)?)?|pipx|uv|npm|pnpm|yarn|bun|apt|apt-get|dnf|yum|conda|mamba|brew|cargo|go|docker|podman|snap|gem)\s+(?:pip\s+)?(?:install|add|pull|run)\b((?:[ \t]+[^\s;&|<>]+)+)/gi)) {
    for (const w of words(m)) if (ok(w[1])) named.push(w);
  }
  for (const m of t.matchAll(/\b(?:npx|pnpx|bunx|uvx)\b((?:[ \t]+[^\s;&|<>]+)+)/gi)) {
    const w = words(m).find(x => !x[1].startsWith('-'));
    if (w && ok(w[1])) named.push(w);
  }
  for (const [, w] of named) add(w);
  // Each name blanked at its own place only, in one pass: the same letters in an address or path after it stay
  // ("torch" in torch.evil.example/i.sh, "etc" in /etc/sudoers.d).
  let rest = '', end = 0;
  for (const [at, w] of [...named].sort((a, b) => a[0] - b[0])) {
    if (at + w.length <= end) continue;
    const from = Math.max(at, end);
    rest += t.slice(end, from) + ' '.repeat(at + w.length - from);
    end = at + w.length;
  }
  t = rest + t.slice(end);
  // (a host right after "@" counts: root@evil.example, git@github.com:evil/repo.git)
  take(new RegExp(`(?<![\\w/.-])${DANGER_HOST}\\/[A-Za-z0-9._~%/+=-]*`, 'gi'));
  for (const m of t.matchAll(/(?:^|[\s"'`=:(<>|;&])((?:~|\.{1,2})?\/[A-Za-z0-9._@%+~/-]+)/g)) add(m[1]);
  for (const m of t.matchAll(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g)) add(m[0]);
  for (const m of t.matchAll(new RegExp(`(?<![\\w/.-])${DANGER_HOST}(?![\\w/-])`, 'gi'))) add(m[0]);
  return [...out];
}
// A thing the owner wrote stands whole in their words: never a piece of a longer word, address or path ("hub.com" in
// "github.com", "/srv" in "/srv/old", "torch" in "pytorch").
function dangerWhole(text, thing) {
  for (let i = text.indexOf(thing); i >= 0; i = text.indexOf(thing, i + 1)) {
    const before = text[i - 1] || '', after = text[i + thing.length] || '', next = text[i + thing.length + 1] || '';
    if (/[A-Za-z0-9._/-]/.test(before) || /[A-Za-z0-9_-]/.test(after) || (/[./]/.test(after) && /[A-Za-z0-9_-]/.test(next))) continue;
    return true;
  }
  return false;
}
// "Came from" (line 4), with no model call: for each thing, nothing when the owner's own messages of this request hold
// it whole (ignoring case); else the first read that holds it, newest first, then the first of Sparkie's earlier answers. A
// pure function: reads are [{label, at, text}] (the text read back from the journal, only searched, never shown; the
// newest 40 and 64 MB in all), answers [{at, text}] (the newest 20). A label is built by code and never quotes its source.
function cameFrom(things, ownerMessages, reads, answers) {
  const own = (ownerMessages || []).map(m => String(m).toLowerCase()).join('\n');
  const newest = (a, b) => String(b.at || '').localeCompare(String(a.at || ''));
  const rs = [...(reads || [])].sort(newest);
  let cut = rs.length > DANGER_READS || rs.some(r => r.cut), budget = DANGER_READ_BYTES;
  const searched = [];
  for (const r of rs.slice(0, DANGER_READS)) {
    const text = String(r.text ?? '');
    if (text.length > budget) { cut = true; break; }
    budget -= text.length;
    searched.push({ what: dangerPlain(r.label, 120) || 'something read', at: r.at, lower: text.toLowerCase() });
  }
  const said = [...(answers || [])].sort(newest).slice(0, DANGER_ANSWERS).map(a => ({ at: a.at, lower: String(a.text ?? '').toLowerCase() }));
  const lines = [], labels = [];
  for (const thing of things || []) {
    const t = String(thing).toLowerCase();
    if (!t || dangerWhole(own, t)) continue;
    const r = searched.find(x => x.lower.includes(t));
    if (r) { lines.push(`${thing}: ${r.what} (read ${dangerHhmm(r.at)})`); labels.push(r.what); continue; }
    const a = said.find(x => x.lower.includes(t));
    if (a) { lines.push(`${thing}: Sparkie’s earlier answer (${dangerHhmm(a.at)})`); labels.push('Sparkie’s earlier answer'); }
  }
  return { lines: lines.slice(0, DANGER_FROM_LINES), more: Math.max(0, lines.length - DANGER_FROM_LINES), cut, labels: [...new Set(labels)] };
}
// A read's long text, read back from the journal by its id (never shown; only searched by cameFrom).
function dangerJournalText(id, max) {
  if (!/^j_[0-9a-f]{12}$/.test(String(id || ''))) return null;
  for (const f of journalFiles()) for (const line of jLinesOf(f)) {
    if (!line.includes(`"id":"${id}"`)) continue;
    const r = jParse(line);
    if (r?.id !== id || !Array.isArray(r.o)) continue;
    const [offset, length] = r.o, n = Math.max(0, Math.min(length, max));
    let fd;
    try { fd = openSync(jFile(f.slice(8, 15), 'out'), 'r'); } catch { return null; }
    // (and a record the journal itself cut at its size counts as not all searched)
    try { const buf = Buffer.alloc(n); readSync(fd, buf, 0, n, offset); return { text: buf.toString(), cut: length > max || Boolean(r.cut) }; } finally { closeSync(fd); }
  }
  return null;
}
// What this request read ({id, label, at}, newest first; a test may hand in {label, at, text}), with its text.
function dangerReadsLoaded(reads) {
  let left = DANGER_READ_BYTES, cut = false;
  const out = [];
  for (const r of [...(Array.isArray(reads) ? reads : [])].sort((a, b) => String(b.at || '').localeCompare(String(a.at || ''))).slice(0, DANGER_READS)) {
    const got = typeof r.text === 'string' ? { text: r.text.slice(0, left), cut: r.text.length > left } : dangerJournalText(r.id, left);
    // (a read whose text can't be read back was not searched, and the ask says so)
    if (!got) { cut = true; continue; }
    out.push({ label: r.label, at: r.at, text: got.text, cut: got.cut });
    left -= got.text.length;
    if (got.cut || left <= 0) { cut = true; break; }
  }
  if (cut || (Array.isArray(reads) && reads.length > DANGER_READS)) out.push({ label: '', at: '', text: '', cut: true });
  return out;
}

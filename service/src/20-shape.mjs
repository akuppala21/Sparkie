/* ───────── the sorter's plain shape: what a command run at once must look like (R63) ───────── */
// Area: safety        Rules: R63        Tests: sort.test.mjs
// Owns: none
// Timers: none        Wakes: none
// sortShape(items, ctx) reads the tokenizer's words once and says why a command is not of the plain shape, or null.
// The shape: no {…} bash would expand; no $ but $(nproc) and its two kin; a pattern only in a word the sorter places as
// a file; no group, subshell, loop or function; at most one cd, the first word, cd <folder> &&; only plain
// redirections (> >> < &> to a plain path, 2>&1); nothing under /dev or /proc but /dev/null; only the safe names set
// before a command; no here-text; a & only last. Four allowances: a $ in a word of echo; here-text into cat or tee; a
// cd as the last command; the /proc status files. 20-sort.mjs asks a change that is not of the shape (a doubt), and a
// look only for a {…}: the tables' lock-out and risky answers stand. New spellings fall outside the shape and are
// asked, so the tables no longer have to be complete.
const SHAPE_PROC = /^\/proc\/(?:meminfo|cpuinfo|loadavg|uptime|version|stat|vmstat|swaps|mounts|partitions|diskstats|pressure\/(?:cpu|memory|io)|net\/dev|self\/status|driver\/nvidia\/version)$/;
const SHAPE_REDIR = /^(?:>|>>|<|&>|&>>)$/;
// (the names a command may set before it and keep the shape: the safe ones, and a few Hugging Face and logging switches)
const SHAPE_SAFE = /^(?:HF_HUB_ENABLE_HF_TRANSFER|HF_HUB_OFFLINE|HF_HUB_DISABLE_\w+|TOKENIZERS_PARALLELISM|WANDB_MODE)$/;
const sortShapeWord = (w, cmd, ctx) => {
  if (w.brace || sortNested(w.bare ?? '')) return [`${sortQ(w.text)} holds a {…}`, true];
  const echo = cmd.words[0]?.text === 'echo' && cmd.words[0] !== w && cmd.words.includes(w);
  if (w.unknown && !echo && !(!w.vars && w.subs?.length && w.subs.every(sortNproc))) return [`${sortQ(w.text || '$…')} holds a $ or a command`];
  if (w.glob && !ctx.touched.has(w)) return [`${sortQ(w.text)} holds a pattern in a word that is not a file it changes`];
  for (const m of w.text.matchAll(/\/(?:dev|proc)(?:\/[^\s'"=:,;]*)?/g)) if (m[0] !== '/dev/null' && !SHAPE_PROC.test(m[0])) return [`${sortQ(w.text)} names ${sortQ(m[0])}`];
  return null;
};
function sortShape(items, ctx) {
  const cds = [];
  let why = null, brace = false;
  const no = (x, b = false) => { why ??= x; brace ||= b; };
  const walk = (list, top) => list.forEach((pipe, n) => {
    if (pipe.op === '&' && n < list.length - 1) no('it sends a command off with & before the end');
    for (const cmd of pipe) {
      if (cmd.group) { no('it holds a group or a subshell'); walk(cmd.group, false); }
      if (/^(?:cd|pushd|popd)$/.test(cmd.words[0]?.text ?? '')) cds.push({ cmd, pipe, n, top, last: top && n === list.length - 1 });
      const prog = cmd.words[0]?.text ?? '';
      for (const d of cmd.redirs) {
        if (/^<</.test(d.op)) { if (!/^(?:cat|tee)$/.test(prog)) no('it hands a program here-text'); continue; }
        if (/^[<>]&$/.test(d.op) && /^[12]$/.test(d.w.text) && !d.w.unknown) continue;
        if (!SHAPE_REDIR.test(d.op) || (d.fd != null && !/^[012]$/.test(d.fd)) || !d.w.plain || d.w.glob || d.w.brace) no(`it has the redirection ${sortQ(`${d.fd ?? ''}${d.op}${d.w.text}`)}`);
      }
      for (const w of [...cmd.assigns, ...cmd.words, ...cmd.redirs.map(d => d.w)]) {
        const bad = sortShapeWord(w, cmd, ctx);
        if (bad) no(bad[0], bad[1]);
        for (const s of w.subs ?? []) walk(s, false);
      }
    }
  });
  walk(items, true);
  // (every way a name is set goes through sortAssign: before a program, env, export and its kin, read, unset)
  for (const n of ctx.sets ?? []) if (!SAFE_ENV.test(n) && !SHAPE_SAFE.test(n)) { no(`it sets ${sortQ(n)}`); break; }
  // (one cd: the first word, cd <folder> &&; or, allowed, a plain cd as the last command)
  const ok = c => c.top && sortIsCd(c.pipe) && c.cmd.words[0].text === 'cd' && c.cmd.words.length === 2 && c.cmd.words[1].plain && !/^-/.test(c.cmd.words[1].text) && !c.cmd.words[1].glob && !c.cmd.words[1].brace
    && ((c.n === 0 && c.pipe.op === '&&') || c.last);
  if (cds.length > 1 || cds.some(c => !ok(c))) no('it changes folder other than once, first, as cd <folder> &&');
  return why ? { why: `It is not of the plain shape a command run at once has: ${why}.`, brace } : null;
}

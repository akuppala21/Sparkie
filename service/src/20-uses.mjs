/* ───────── what a sorted command uses beside the places it changes: reads, installs, the GPU, the network (R64) ───────── */
// Area: safety        Rules: R64        Tests: sort.test.mjs
// Owns: none
// Timers: none        Wakes: none
// Fields of sortCommand's result for the ladder (A7c), never a class: the class stays the tables' and the shape's.
// reads: places of placed a known program only reads (a copy's source, what tar or zip packs, an archive it unpacks, a
// name hf fetches by), when nothing in the command writes there and no code the sorter doesn't read runs: placed keeps
// them for the copy first. installs: where an install puts programs that the plain wall keeps read-only. gpu: true when
// the command plainly uses the GPU, unset when that can't be told. reach: which of another Spark of this fleet, the home
// network and the internet its words reach.
const USES_INSTALL = ['~/.local', '~/.cargo/bin', '~/bin'];
const USES_GPU_PROGS = /^(?:nvidia-smi|nvidia-debugdump|nvidia-cuda-mps-control|nvtop|nvitop|gpustat|dcgmi|nsys|ncu|trtexec)$/;
// The host of an address or of host:path, user@ and a port taken off; null when there is none.
const usesHost = t => (/^[a-z][\w+.-]*:\/\/(?:[^@/]*@)?(\[[^\]]*\]|[^/:?#]*)/i.exec(t) ?? /^(?:[^@/:]*@)?([^/:@\s]+):(?!\/\/)/.exec(t))?.[1] ?? null;
// Another Spark of the fleet (a name or an address the console knows), the home network (a private, link-local or
// tailnet address, a one-word or local name, this Spark's own ports), or the internet.
function usesReach(h, ctx) {
  const x = String(h ?? '').replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (!x || !ctx.reach || /[^\w.:%-]/.test(x)) return;
  const fleet = !!(sortHost(ctx, x) || sortHost(ctx, x.split('.')[0]));
  const home = x.includes(':') ? /^(?:f[cd]|fe[89ab]|::1?$|::ffff:(?:10|127|192\.168)\.)/.test(x) : /^(?:0\.0\.0\.0|localhost)$/.test(x) || sortNear(x, ctx);
  ctx.reach.add(fleet ? 'fleet' : home ? 'home' : 'internet');
}
// An install that puts programs where the plain wall keeps them read-only (pip outside a Python environment or with
// --user, pipx, uv tool, cargo install, npm -g), from the program and its own words.
function sortInstall(name, args, ctx, via) {
  const t = args.map(w => w.text), plain = t.filter(s => !s.startsWith('-'));
  if (/^pip(?:3(?:\.\d+)?)?$/.test(name) && plain[0] === 'install') {
    const env = ctx.venv || (via && !/^(?:\/usr(?:\/local)?)?\/s?bin\/|^~\/\.local\/bin\//.test(via));
    if (t.includes('--user') || (!env && !t.some(s => /^(?:-t|--target|--prefix|--root)(?:=|$)|^-t./.test(s)))) ctx.installs.add('~/.local');
  }
  if (/^(?:npm|pnpm)$/.test(name) && /^(?:install|i|in|isnt|add|update|up|upgrade|link|ln)$/.test(plain[0] ?? '') && t.some(s => /^(?:-g|--global|--location=global)$/.test(s))) ctx.installs.add('npm -g');
  if (name === 'yarn' && plain[0] === 'global' && /^(?:add|upgrade)$/.test(plain[1] ?? '')) ctx.installs.add('npm -g');
  if (name === 'cargo' && plain[0] === 'install' && !t.some(s => /^--root(?:=|$)/.test(s))) { ctx.installs.add('~/.cargo/bin'); ctx.reach.add('internet'); }
  if ((name === 'pipx' && /^(?:install|inject|upgrade|upgrade-all|reinstall|reinstall-all)$/.test(plain[0] ?? '')) || (name === 'uv' && plain[0] === 'tool' && /^(?:install|upgrade)$/.test(plain[1] ?? ''))) { ctx.installs.add('~/.local'); ctx.reach.add('internet'); }
  if (name === 'go' && /^(?:install|get)$/.test(plain[0] ?? '')) ctx.reach.add('internet');
}
// The fields, from what the parts noted: reads (only when the command is a look or a plain change, runs no code the
// sorter doesn't read, and no place it writes is one of them, above or under one, or matched by a pattern either way).
function sortUses(ctx, r, text, form) {
  const out = {}, g = p => /[*?[]/.test(p), wrote = [...ctx.wrote].filter(p => ctx.changes.has(p));
  const under = (p, q) => p === q || p.startsWith(q === '/' ? '/' : `${q}/`);
  const hits = (pat, p) => [p, ...sortUp(p)].some(a => sortGlob(pat).test(a));
  const clash = (p, q) => under(p, q) || under(q, p) || (g(p) && (g(q) || hits(p, q))) || (g(q) && hits(q, p));
  const cand = [...ctx.readOnly].filter(p => ctx.changes.get(p) === false && !ctx.wrote.has(p));
  out.reads = /^(?:look|change)$/.test(r.class) && !ctx.unread && cand.length <= 64 && wrote.length <= 64 ? cand.filter(p => !wrote.some(q => clash(p, q))) : [];
  for (const p of wrote) for (const d of USES_INSTALL) if (under(p, d)) ctx.installs.add(d);
  out.installs = [...USES_INSTALL, 'npm -g'].filter(d => ctx.installs.has(d));
  // (an NVIDIA tool, a GPU picked by name, a device file, --gpus)
  const progs = [...ctx.programs].map(w => w.text.split('/').pop()), first = form ? text.trim().split(/\s+/)[0] : null;
  const picked = ['CUDA_VISIBLE_DEVICES', 'NVIDIA_VISIBLE_DEVICES'].some(n => ctx.setTo.has(n) && ctx.setTo.get(n) != null && !/^(?:|-1|none|void|nodevfiles)$/i.test(ctx.setTo.get(n).trim()));
  if (USES_GPU_PROGS.test(first ?? '') || progs.some(p => USES_GPU_PROGS.test(p)) || picked || ctx.words.some(w => !w.unknown && /^--gpus(?:=|$)|(?:^|[=:])\/dev\/nvidia/.test(w.text))) out.gpu = true;
  out.reach = ['fleet', 'home', 'internet'].filter(k => ctx.reach.has(k));
  return out;
}

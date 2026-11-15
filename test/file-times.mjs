// A test reporter (test/lock.mjs adds it beside the usual one): after the suite, the seconds each test file took and
// whether it passed, longest first. They say where a full run's time goes, and whether GitHub's run needs splitting.
// A file's time is Node's own figure for the file when Node gives one, else from its first event to its last.
import { relative, resolve } from 'node:path';

export default async function* fileTimes(source) {
  const files = new Map();
  for await (const e of source) {
    const f = e.data?.file && resolve(String(e.data.file));
    if (!f) continue;
    const x = files.get(f) || { first: Date.now(), last: 0, ms: null, ok: true };
    x.last = Date.now();
    if (e.type === 'test:fail' && !e.data.todo) x.ok = false;
    if (e.type === 'test:complete' && e.data.nesting === 0 && resolve(String(e.data.name)) === f) {
      x.ms = e.data.details?.duration_ms ?? null;
      if (e.data.details?.passed === false) x.ok = false;
    }
    files.set(f, x);
  }
  if (!files.size) return;
  const rows = [...files].map(([f, x]) => ({ file: relative(process.cwd(), f), s: (x.ms ?? x.last - x.first) / 1000, ok: x.ok }))
    .sort((a, b) => b.s - a.s);
  yield `\nSeconds per test file, longest first (${rows.length} files):\n${rows.map(r => `${r.s.toFixed(1).padStart(7)}  ${r.ok ? 'pass' : 'FAIL'}  ${r.file}`).join('\n')}\n`;
}

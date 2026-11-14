// Passes when the setup will start as things are and keeps as much as it can:
// - spark.json is still valid, and everything but the context length is as it was (raising the memory share doesn't
//   help: ComfyUI holds 38 GB of the same unified memory, and it isn't the agent's to stop);
// - the context is at most the 47,104 tokens vLLM said fit, and at least 32,768 (so it wasn't cut far more than needed;
//   the contract never goes below 16k without asking);
// - REPORT.md explains it: the KV cache didn't fit at 131,072 tokens, and ComfyUI was using GPU memory.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export default async function grade({ work }) {
  const checks = [];
  const was = JSON.parse(readFileSync(new URL('./incident/spark.json', import.meta.url), 'utf8'));
  let now = null;
  try { now = JSON.parse(readFileSync(join(work, 'incident/spark.json'), 'utf8')); } catch (e) { checks.push({ name: 'spark.json is valid JSON', pass: false, detail: e.message }); return checks; }
  checks.push({ name: 'spark.json is valid JSON', pass: true });
  const arg = (args, name) => { const i = (args || []).indexOf(name); return i >= 0 ? args[i + 1] : (args || []).find(a => a.startsWith(`${name}=`))?.split('=')[1]; };
  const len = Number(arg(now.args, '--max-model-len'));
  checks.push({ name: 'the context fits (≤ 47,104) and keeps as much as it can (≥ 32,768)', pass: len >= 32768 && len <= 47104, detail: `--max-model-len ${arg(now.args, '--max-model-len')}` });
  const strip = o => JSON.stringify({ ...o, args: (o.args || []).filter((a, i, all) => !/^--max-model-len/.test(a) && all[i - 1] !== '--max-model-len') });
  checks.push({ name: 'nothing else in the setup changed', pass: strip(now) === strip(was), detail: strip(now) === strip(was) ? '' : strip(now) });
  const report = existsSync(join(work, 'incident/REPORT.md')) ? readFileSync(join(work, 'incident/REPORT.md'), 'utf8') : '';
  checks.push({ name: 'REPORT.md says the KV cache didn\'t fit', pass: /kv[- ]?cache|context|max[-_ ]model[-_ ]len|memory/i.test(report), detail: report ? '' : 'no REPORT.md' });
  checks.push({ name: 'REPORT.md names ComfyUI using GPU memory', pass: /comfy/i.test(report) });
  return checks;
}

// Lists the brain's setups, or switches Sparkie's model to one and follows the switch until it's done (contract 3.3),
// through Spark Console's API, the same call Models → Sparkie makes. From any machine on the tailnet, as the owner:
//
//   node tools/brain-setup.mjs                  the setups, and which one runs now
//   node tools/brain-setup.mjs aphex-x4         switch to "4 at once", and wait until it answers
//   node tools/brain-setup.mjs aphex-agent      switch to the agent setup
//   node tools/brain-setup.mjs aphex --plan     what the switch would do, without doing it
//
// If the new setup doesn't start, Spark Console puts the previous one back by itself; this says so.
const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt; };
const BASE = arg('url', 'https://akspark2.tailab9aa9.ts.net:8443/console/api').replace(/\/$/, '');
const ORIGIN = new URL(BASE).origin;
const want = process.argv.slice(2).find(a => !a.startsWith('--') && a !== arg('url'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
// Off the tailnet, the terminal's sign-in (node tools/console.mjs sign-in) says who you are.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
// It goes only to the https address it was made for.
const TOKEN = (() => {
  try {
    const t = JSON.parse(readFileSync(process.env.SPARK_CONSOLE_TOKEN_FILE || join(homedir(), '.config', 'spark-console', 'token'), 'utf8'));
    return /^scs_[A-Za-z0-9_-]{43}$/.test(t.token || '') && t.origin === ORIGIN && ORIGIN.startsWith('https://') ? t.token : null;
  } catch { return null; }
})();

async function api(path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method: body ? 'POST' : 'GET', signal: AbortSignal.timeout(30000),
    headers: { ...(body ? { 'content-type': 'application/json', 'x-spark-console': '1', origin: ORIGIN } : {}), ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  }).catch(e => { console.error(`Spark Console doesn't answer at ${BASE} (${e.cause?.code || e.message}). Are you on the tailnet?`); process.exit(1); });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  if (!r.ok) { console.error(`${r.status}: ${json?.error?.message || json?.error || text.slice(0, 300)}`); process.exit(1); }
  return json;
}

const main = await api('/main');
const now = main.presets.find(p => p.current);
if (!want) {
  console.log('Setups (the one running now is marked):');
  for (const p of main.presets) console.log(`  ${p.current ? '→' : ' '} ${p.id.padEnd(16)} ${p.title}`);
  console.log('\nSwitch with: node tools/brain-setup.mjs <setup>');
  process.exit(0);
}
const target = main.presets.find(p => p.id === want);
if (!target) { console.error(`No setup called "${want}". Setups: ${main.presets.map(p => p.id).join(', ')}`); process.exit(1); }
if (target.current) { console.log(`${target.title} is already Sparkie's model.`); process.exit(0); }

if (process.argv.includes('--plan')) {
  const p = await api(`/main/plan?preset=${encodeURIComponent(want)}`);
  console.log(JSON.stringify(p, null, 2));
  process.exit(0);
}

console.log(`Switching Sparkie from ${now?.title || 'nothing'} to ${target.title} …`);
const job = await api('/main/use', { preset: want });
let last = '';
for (;;) {
  await sleep(5000);
  const j = await api(`/jobs/${job.id}`);
  if (j.step !== last) { console.log(`  ${new Date().toLocaleTimeString()}  ${j.step}`); last = j.step; }
  if (j.status !== 'running') {
    const after = (await api('/main')).presets.find(p => p.current);
    if (j.status === 'completed' && after?.id === want) { console.log(`Done: Sparkie runs ${after.title}.`); process.exit(0); }
    console.error(`It didn't switch (${j.status}${j.error ? `: ${String(j.error).split('\n')[0]}` : ''}). Sparkie runs ${after?.title || 'nothing'}.`);
    console.error('Its log:\n' + (j.log || []).slice(-12).map(l => `  ${l}`).join('\n'));
    process.exit(1);
  }
}

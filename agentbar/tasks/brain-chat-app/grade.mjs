// Passes when the app the agent left running answers: its page loads with a place to type, and POST /api/chat comes
// back with the brain's reply. Built with Node.js only (no npm packages).
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function fetchFor(url, options, ms) {
  try { return await fetch(url, { ...options, signal: AbortSignal.timeout(ms) }); } catch (e) { return { ok: false, status: 0, error: e.message, text: async () => '' }; }
}

export default async function grade({ work, env }) {
  const checks = [], base = `http://127.0.0.1:${env.APP_PORT}`;
  checks.push({ name: 'the app is in app/', pass: existsSync(join(work, 'app')) });
  let deps = {};
  try { const p = JSON.parse(readFileSync(join(work, 'app/package.json'), 'utf8')); deps = { ...(p.dependencies || {}), ...(p.devDependencies || {}) }; } catch {}
  checks.push({ name: 'no npm packages', pass: !Object.keys(deps).length && !existsSync(join(work, 'app/node_modules')), detail: Object.keys(deps).join(', ') });
  let page = null;
  for (let i = 0; i < 10 && !page?.ok; i++) { page = await fetchFor(`${base}/`, {}, 5000); if (!page.ok) await sleep(1000); }
  const html = page?.ok ? await page.text() : '';
  checks.push({ name: 'its page loads, with a place to type', pass: Boolean(page?.ok) && /<(textarea|input)\b/i.test(html), detail: page?.ok ? '' : `GET / → ${page?.status || page?.error}` });
  const r = await fetchFor(`${base}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: 'Reply with just the word PONG, in capitals, and nothing else.' }) }, 240000);
  let reply = '';
  try { reply = String((JSON.parse(await r.text())).reply || ''); } catch {}
  checks.push({ name: 'POST /api/chat returns the brain\'s reply', pass: /pong/i.test(reply), detail: reply ? reply.slice(0, 200) : `status ${r.status || r.error}` });
  return checks;
}

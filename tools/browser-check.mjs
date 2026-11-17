// Small browser regression for the shipped page. Uses a local, read-only fixture API; never contacts a Spark.
// Install Playwright outside the repo, then point SPARK_BROWSER_MODULE at its index.mjs (or install it locally).
// SPARK_BROWSER_MODULE=/tmp/spark-browser/node_modules/playwright/index.mjs node tools/browser-check.mjs
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname } from 'node:path';
const { chromium } = await import(process.env.SPARK_BROWSER_MODULE || 'playwright');
const publicDir = resolve(fileURLToPath(new URL('../public/', import.meta.url)));
const server = http.createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  const file = resolve(publicDir, path === '/' ? 'index.html' : `.${path}`);
  if (!file.startsWith(`${publicDir}/`) && file !== resolve(publicDir, 'index.html')) { res.writeHead(404).end(); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' })[extname(file)] || 'application/octet-stream' }).end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true });
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    let posts = 0, reads = 0, choices = 0, jobPolls = 0, opensAt = null;
    const id = 'sc_browser', op = '012345abcdef', now = () => new Date().toISOString();
    const job = () => ({ id: op, type: 'run', node: 'spark3', conv: id, status: jobPolls >= 2 ? 'completed' : 'running', step: 'Checking', createdAt: now(), log: [] });
    const saved = () => {
      const messages = posts ? [{ role: 'user', content: 'Check the fleet', createdAt: now() }] : [];
      const replying = posts > 0 && reads < 2;
      if (posts && !replying) {
        opensAt ||= Date.now() + 1800;
        messages.push({ role: 'assistant', content: 'Saved final answer', createdAt: now() },
          { role: 'assistant', notice: true, content: 'Confirm the check', createdAt: now(), danger: { yes: 'Run the check', lines: ['Run this check on Spark 3?'] },
            ...(Date.now() < opensAt ? { opensAt: new Date(opensAt).toISOString() } : { pair: '42' }),
            choices: [{ id: 'yes', label: 'Run the check', state: choices ? 'picked' : 'open', pair: true }] });
      }
      if (choices && jobPolls >= 2) messages.push({ role: 'assistant', notice: true, content: 'Done: browser check', operation: op, status: 'completed', createdAt: now() });
      return { id, title: 'Browser check', messages, replying };
    };
    const nodes = [1, 2, 3, 4].map(n => ({ id: `spark${n}`, name: `Spark ${n}` }));
    await page.route('**/console/api/**', async route => {
      const path = new URL(route.request().url()).pathname.replace('/console/api/', '');
      const method = route.request().method();
      const send = (value, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
      if (path === 'bootstrap') return send({ viewer: { role: 'owner', login: 'owner@test' }, userName: 'Test Owner', hubId: 'spark1', computeIds: ['spark2', 'spark3', 'spark4'], nodes, passkeys: 1 });
      if (path === 'main') return send({ configured: true, healthy: true, title: 'Test brain', node: 'spark1' });
      if (path.startsWith('status')) return send({ updatedAt: now(), nodes: nodes.map(n => ({ ...n, reachable: true, state: 'online', memoryTotalGiB: 120, memoryFreeGiB: 100, runningContainers: n.id === 'spark1' ? ['sparkie-main', 'plug-controller'] : n.id === 'spark3' ? ['sc-example'] : [] })) });
      if (path === 'connections') return send({ portalUrl: 'https://custom.example/', nodes: [] });
      if (path === 'fabric') return send({ sparks: [], pairs: [] });
      if (path === 'models') return send({ library: [], sparks: [] });
      if (path === 'jobs') return send({ jobs: choices ? [job()] : [], notices: [] });
      if (path === `jobs/${op}`) { jobPolls++; return jobPolls === 1 ? send({ error: 'temporary connection loss' }, 502) : send(job()); }
      if (path === 'chats' && method === 'POST') return send(saved(), 201);
      if (path === 'chats') return send({ chats: posts ? [{ id, title: 'Browser check', messageCount: 2, updatedAt: now() }] : [] });
      if (path === `chats/${id}/messages`) {
        posts++;
        // A valid partial event followed by EOF, with no terminal event.
        return route.fulfill({ contentType: 'text/event-stream', body: 'data: {"type":"delta","text":"Partial answer"}\n\n' });
      }
      if (path === `chats/${id}/choose`) {
        assert.equal(route.request().postDataJSON().pair, '42'); choices++;
        return send({ ...saved(), operation: op });
      }
      if (path === `chats/${id}`) {
        reads++;
        if (reads === 1) return send({ error: 'temporary read failure' }, 502);
        return send(saved());
      }
      if (path.startsWith('live')) return route.fulfill({ contentType: 'text/event-stream', body: '' });
      return send({});
    });
    await page.goto(base);
    await page.getByRole('heading', { name: 'Home', exact: true }).waitFor();
    await page.getByText('Containers running', { exact: true }).waitFor();
    const hostCard = page.locator('.spark-card').filter({ hasText: 'Host' });
    assert.match(await hostCard.innerText(), /Spark 1/);
    await page.getByRole('link', { name: 'Ask Sparkie', exact: true }).click();
    await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Check the fleet');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await page.getByText('connection lost; checking again…', { exact: true }).waitFor();
    await page.getByText('Saved final answer', { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText(/This ask opens at/).waitFor();
    await page.getByText('To run it: type 42, then press Run the check.', { exact: true }).waitFor({ timeout: 10000 });
    await page.getByRole('textbox', { name: 'The two digits from the ask' }).fill('42');
    await page.getByRole('button', { name: 'Run the check', exact: true }).click();
    await page.getByText('Done: browser check', { exact: true }).waitFor({ timeout: 20000 });
    assert.equal(posts, 1, 'GET reconnect never replays the submitted turn');
    assert.equal(choices, 1);
    assert.ok(jobPolls >= 2, 'job polling recovered from the interrupted request');
    assert.equal(await page.getByText(/A command on Spark 3 failed/).count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'no horizontal overflow');
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`Browser smoke passed: ${viewport.width}x${viewport.height}`);
  }
} finally {
  await browser?.close();
  await new Promise(r => server.close(r));
}

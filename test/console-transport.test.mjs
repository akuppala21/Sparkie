// Covers: the owner's CLI retries only its initial safe read after a transport failure.
// Real HTTP/socket failures against localhost; no stand-in fleet, Tailscale or Spark.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const CLI = fileURLToPath(new URL('../tools/console.mjs', import.meta.url));

async function run(command, handler) {
  const home = mkdtempSync(join(tmpdir(), 'console-transport-'));
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let child;
  try {
    const result = await new Promise((resolve, reject) => {
      child = spawn(process.execPath, [CLI, command, '--url', `http://127.0.0.1:${server.address().port}/console/api`], {
        env: { ...process.env, HOME: home, SPARK_CONSOLE_TOKEN_FILE: join(home, 'token') }, stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '', stderr = '';
      const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('CLI exceeded the bounded test deadline')); }, 12000);
      child.stdout.on('data', data => { stdout += data; });
      child.stderr.on('data', data => { stderr += data; });
      child.on('error', error => { clearTimeout(timer); reject(error); });
      child.on('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
    });
    return result;
  } finally {
    if (child?.exitCode === null) child.kill('SIGKILL');
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    rmSync(home, { recursive: true, force: true });
  }
}
const json = (res, value, status = 200) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(value));

test('test-changes survives one first-request connection failure and then reads normally', async () => {
  const seen = [];
  const r = await run('test-changes', (req, res) => {
    seen.push([req.method, req.url]);
    if (seen.length === 1) { req.socket.destroy(); return; }
    json(res, req.url.endsWith('/jobs') ? { jobs: [] } : { workflows: [] });
  });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /Every workflow is ready already/);
  assert.deepEqual(seen, [['GET', '/console/api/jobs'], ['GET', '/console/api/jobs'], ['GET', '/console/api/workflows']]);
  assert.match(r.stderr, /Checking again in a second/);
});

test('a persistent first-connection failure stops after two reads', async () => {
  let requests = 0;
  const r = await run('test-changes', req => { requests++; req.socket.destroy(); });
  assert.equal(r.code, 1);
  assert.equal(requests, 2);
  assert.match(r.stderr, /doesn't answer/);
});

test('HTTP failures and later read failures are not certificate warm-up retries', async () => {
  let requests = 0;
  const rejected = await run('test-changes', (req, res) => { requests++; json(res, { error: 'not ready' }, 503); });
  assert.equal(rejected.code, 1);
  assert.equal(requests, 1);
  assert.doesNotMatch(rejected.stderr, /Checking again/);

  const seen = [];
  const later = await run('test-changes', (req, res) => {
    seen.push(req.url);
    if (req.url.endsWith('/jobs')) json(res, { jobs: [] });
    else req.socket.destroy();
  });
  assert.equal(later.code, 1);
  assert.deepEqual(seen, ['/console/api/jobs', '/console/api/workflows']);
});

test('an uncertain rollback mutation is sent exactly once', async () => {
  const seen = [];
  const r = await run('rollback', (req, res) => {
    seen.push(req.method);
    if (req.method === 'GET') json(res, { available: true, stamp: 'today' });
    else req.socket.destroy();
  });
  assert.equal(r.code, 1);
  assert.deepEqual(seen, ['GET', 'POST']);
  assert.doesNotMatch(r.stderr, /Checking again/);
});


test('an initial device-sign-in POST is not retried after an uncertain transport failure', async () => {
  const seen = [];
  const r = await run('sign-in', req => { seen.push([req.method, req.url]); req.socket.destroy(); });
  assert.equal(r.code, 1);
  assert.deepEqual(seen, [['POST', '/console/api/auth/device/start']]);
  assert.doesNotMatch(r.stderr, /Checking again/);
});

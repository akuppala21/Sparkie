import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createServer} from 'node:http';
import {test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {fetchReport} from './report-client.mjs';

async function reportService(t, firstFailureDelay) {
  let requests = 0;
  const server = createServer(async (_request, response) => {
    requests++;
    if (requests === 1) {
      await delay(firstFailureDelay);
      response.writeHead(503).end();
      return;
    }
    response.writeHead(200, {'content-type': 'application/json'}).end('{"ready":true}');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    t.diagnostic(`HTTP requests received: ${requests}`);
  });
  return {
    url: `http://127.0.0.1:${server.address().port}/report`,
    requests: () => requests,
  };
}

test('an exhausted time budget preserves the service error and stops retries', async t => {
  const service = await reportService(t, 75);
  await assert.rejects(fetchReport(service.url, {retryBudgetMs: 15}), /report service returned 503/);
  assert.equal(service.requests(), 1);
});

test('a transient service failure recovers while time remains', async t => {
  const service = await reportService(t, 0);
  assert.deepEqual(await fetchReport(service.url, {retryBudgetMs: 3000}), {ready: true});
  assert.equal(service.requests(), 2);
});

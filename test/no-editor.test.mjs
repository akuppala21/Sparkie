// Covers: The browser editor is out of Spark Console (E10c; the one page, milestone 4; design E 2.6, the third step of
// its safe order). The service has no editor route: each old path (the editor under /connect/<spark>/, its bare address,
// a folder link, port forwarding under it, a change sent to it, and the editor's restart at /nodes/<spark>/actions)
// answers exactly as an unknown path of the same shape does, for the owner, a member and a visitor from the internet,
// and a WebSocket to it is refused as one to an unknown path is (404). The owner's /bootstrap names no editor. The
// page's files hold no browser editor link or button and no editor restart; what a Spark's page keeps (the owner's own
// VS Code or Cursor over SSH, the SSH command and config) is still there. The editor's part is gone, and the stand-in
// fleet starts no editor.
// The editor's units on the Sparks are not touched here: stopping them is the owner's clearing (deploy/clear-spark2.sh).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import netSocket from 'node:net';
import { T, useFleet, api, MEMBER, REPO } from './lib.mjs';
import { serviceConfig } from './start-mock.mjs';

const ORIGIN = serviceConfig().origin;
const read = f => readFileSync(join(REPO, f), 'utf8');

// Who asks: the owner on the tailnet, a member on the tailnet, and someone on the internet who hasn't signed in.
const FACES = {
  'the owner': {},
  'a member': { 'tailscale-user-login': MEMBER },
  'a visitor from the internet': { 'tailscale-funnel-request': '?1' },
};
// Each old path of the editor, beside an unknown path of the same shape, asked the same way.
const OLD = [
  ['GET', '/connect/spark3/', '/no-such-route/spark3/'],
  ['GET', '/connect/spark3', '/no-such-route/spark3'],
  ['GET', '/connect/spark3/?folder=%2Fhome%2Fowner%2Fproj', '/no-such-route/spark3/?folder=%2Fhome%2Fowner%2Fproj'],
  ['GET', '/connect/spark3/proxy/8080/', '/no-such-route/spark3/proxy/8080/'],
  ['GET', '/connect/nowhere/', '/no-such-route/nowhere/'],
  ['POST', '/connect/spark3/upload', '/no-such-route/spark3/upload', { file: 'x' }],
  ['POST', '/nodes/spark3/actions', '/nodes/spark3/no-such-route', { action: 'editor-restart' }],
  ['GET', '/nodes/spark3/actions', '/nodes/spark3/no-such-route'],
];

// A WebSocket upgrade on the local port, over a connection of its own: the answer's first line (null if none came).
function upgrade(path, headers = {}) {
  return new Promise(resolve => {
    const s = netSocket.connect(T.fleet.port, '127.0.0.1');
    let got = '';
    const timer = setTimeout(() => s.destroy(), 15000);
    s.on('connect', () => {
      const h = { host: new URL(ORIGIN).host, origin: ORIGIN, connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-version': '13',
        'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==', ...headers };
      s.write(`GET /console/api${path} HTTP/1.1\r\n${Object.entries(h).map(([k, v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n`);
    });
    s.on('data', d => { got += d; if (got.includes('\r\n')) s.destroy(); });
    s.on('error', () => {});
    s.on('close', () => { clearTimeout(timer); resolve(got.split('\r\n')[0] || null); });
  });
}

describe('the service has no editor route', () => {
  useFleet();

  test('each old path answers as an unknown path does, for the owner and for everyone else', async () => {
    for (const [who, headers] of Object.entries(FACES)) {
      for (const [method, old, unknown, body] of OLD) {
        const [a, b] = [await api(old, { method, body, headers }), await api(unknown, { method, body, headers })];
        assert.deepEqual([a.status, a.json, a.headers.get('location')], [b.status, b.json, b.headers.get('location')], `${who}: ${method} ${old} → ${a.status} ${a.text}`);
      }
    }
  });

  test('a WebSocket to the editor is refused as one to an unknown path is', async () => {
    for (const [who, headers] of Object.entries(FACES)) {
      for (const old of ['/connect/spark3/', '/connect/spark3/proxy/8080/', '/connect/nowhere/']) {
        const unknown = old.replace('/connect/', '/no-such-route/');
        const [a, b] = [await upgrade(old, headers), await upgrade(unknown, headers)];
        assert.equal(b, 'HTTP/1.1 404 Not Found', `${who}: an unknown path`);
        assert.equal(a, b, `${who}: ${old}`);
      }
    }
    assert.equal((await api('/health')).status, 200, 'still answering');
  });

  test('the owner\'s /bootstrap names no editor for any Spark', async () => {
    const r = await api('/bootstrap');
    assert.equal(r.status, 200, r.text);
    assert.ok(r.json.nodes.length > 0);
    for (const n of r.json.nodes) assert.ok(!('editorPath' in n), JSON.stringify(n));
  });
});

test('the editor\'s part is gone, nothing in the service names its route, and the stand-in fleet starts no editor', () => {
  assert.ok(!existsSync(join(REPO, 'service', 'src', '21-editor.mjs')), 'service/src/21-editor.mjs');
  const server = read('service/server.mjs');
  for (const name of ['/connect/', 'editorUpgrade', 'editorTarget', 'editorHttp', 'EDITOR_PORTS', 'editorPasskeyFresh', 'editorUse', "'editor-restart'", "'spark-action'"]) {
    assert.ok(!server.includes(name), `service/server.mjs names ${name}`);
  }
  assert.ok(!read('test/start-mock.mjs').includes('MOCK_EDITOR_PORT'), 'the stand-in fleet starts no editor');
});

test('the page holds no browser editor link or button and no editor restart; a Spark\'s SSH ways in stay', () => {
  const APP = read('public/app.js');
  for (const [file, text] of [['public/app.js', APP], ['public/index.html', read('public/index.html')], ['public/styles.css', read('public/styles.css')]]) {
    // (ok, not doesNotMatch: a failure names the file, never prints all of it)
    assert.ok(!/(^|[^a-z])connect\//im.test(text), `${file}: a link to the editor's address`);
    for (const words of ['editorPath', 'editorUrl', 'editor-restart', 'editorReady', 'VS Code in browser', 'VS Code + terminal', 'Restart VS Code',
      'Editor and terminal in your browser', 'VS Code not ready']) {
      assert.ok(!text.includes(words), `${file}: ${words}`);
    }
  }
  assert.ok(!/nodes\/\$\{[^}]+\}\/actions/.test(APP), 'no Spark action is sent');
  // What stays on a Spark's page: the owner's own editor over SSH (nothing goes through Spark Console), the SSH command
  // and the SSH config for every Spark.
  assert.match(APP, /\$\{scheme\}:\/\/vscode-remote\/ssh-remote\+/, 'a desktop editor link over SSH');
  assert.match(APP, /launch\('monitor', 'VS Code', 'Remote SSH', desktopUrl\(id, 'vscode'\)\)/, 'VS Code over SSH on the Connect card');
  assert.match(APP, /launch\('monitor', 'Cursor', 'Remote SSH', desktopUrl\(id, 'cursor'\)\)/, 'Cursor over SSH on the Connect card');
  assert.match(APP, /label: 'Copy SSH command'/, 'the SSH command in the Open menu');
  assert.match(APP, /'Get the SSH config'/, 'the SSH config for all Sparks');
  assert.match(APP, /owner\(\) \? connectPanel\(id\) : null/, 'the Connect card is on a Spark\'s page');
});

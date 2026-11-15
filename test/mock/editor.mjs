// Stand-in code-server on 127.0.0.1:$MOCK_EDITOR_PORT: a page with relative links, a redirect to /login, a cookie with
// Path=/, a POST that echoes its body, and a WebSocket that echoes raw bytes back.
// Note: the service takes its editor ports from service/config.json (editorPorts, default spark2 → 8801), so it only
// reaches this stand-in when config.json points there. Started by test/start-mock.mjs ({ editor: true }); without a
// port (e.g. picked up by a bare `node --test`) it does nothing.
import http from 'node:http';
import crypto from 'node:crypto';

const PORT = Number(process.env.MOCK_EDITOR_PORT);
if (!PORT) process.exit(0);
const server = http.createServer((req, res) => {
  if (req.url === '/') { res.writeHead(302, { location: '/login?to=%2F' }); return res.end(); }
  if (req.url.startsWith('/login')) { res.writeHead(200, { 'content-type': 'text/html', 'set-cookie': ['code-server-session=abc123; Path=/; HttpOnly'] }); return res.end('<html><body><a href="./workbench">open</a> stand-in code-server login</body></html>'); }
  if (req.url.startsWith('/?folder=') || req.url.startsWith('/workbench')) { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(`<html>workbench for ${req.url} cookie=${req.headers.cookie || 'none'} host=${req.headers.host}</html>`); }
  // (decoded as one stream: a character whose bytes arrive in two pieces is counted once)
  if (req.method === 'POST') { let b = ''; req.setEncoding('utf8'); req.on('data', d => { b += d; }); req.on('end', () => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end(`got ${b.length} bytes`); }); return; }
  res.writeHead(404); res.end();
});
server.on('upgrade', (req, socket) => {
  const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  socket.on('data', d => socket.write(d));
});
server.listen(PORT, '127.0.0.1', () => console.log(`stand-in code-server on 127.0.0.1:${PORT}`));

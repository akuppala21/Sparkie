/* ───────── live metrics ───────── */
// Area: ground        Rules: R10, R24        Tests: internet.test.mjs
// Owns: none
// Timers: startSampler (again 15 s after a reader ends, while a page is open), metricsStream (a ping every 15 s to
//   each open page)
// Wakes: none
// One long-running reader per Spark, only while someone has the page open; stopped shortly after they leave.
const SAMPLE_SCRIPT = `nvidia-smi --query-gpu=utilization.gpu,power.draw,temperature.gpu --format=csv,noheader,nounits -lms 1000 2>/dev/null | sed -u 's/^/G,/' &
free -b -s 1 | sed -u -n 's/^Mem:/M/p' &
wait`;
const clients = new Set();
const samplers = new Map();
let samplerStop = null;

function startSampler(node) {
  const entry = samplers.get(node.id) || { last: null, mem: null };
  samplers.set(node.id, entry);
  if (entry.child) return;
  clearTimeout(entry.retry);
  const child = spawnOn(node, { script: SAMPLE_SCRIPT });
  entry.child = child;
  let buf = '';
  child.stdout.on('data', chunk => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line.startsWith('M')) {
        const v = line.slice(1).trim().split(/\s+/).map(Number);
        if (v.length >= 6) entry.mem = { total: v[0], available: v[5] };
      } else if (line.startsWith('G,')) {
        unreachableUntil.delete(node.id);
        const [gpu, power, temp] = line.slice(2).split(',').map(s => parseFloat(s));
        const num = x => (Number.isFinite(x) ? x : null);
        entry.last = {
          node: node.id, online: true, t: Date.now(), gpu: num(gpu), power: num(power), temp: num(temp),
          memTotal: entry.mem?.total ?? null, memAvailable: entry.mem?.available ?? null,
        };
        broadcast(entry.last);
      }
    }
  });
  child.stderr.on('data', () => {});
  child.on('close', code => {
    entry.child = null;
    noteReach(node, code);
    entry.last = { node: node.id, online: false, t: Date.now() };
    broadcast(entry.last);
    if (clients.size) entry.retry = setTimeout(() => startSampler(node), 15000);
  });
}

function stopSamplers() {
  for (const entry of samplers.values()) {
    clearTimeout(entry.retry);
    entry.child?.kill('SIGTERM');
    entry.child = null;
  }
}

function broadcast(sample) {
  const data = `data: ${JSON.stringify(sample)}\n\n`;
  for (const client of clients) {
    client.res.write(data);
  }
}

function metricsStream(req, res, viewer) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
  res.write('retry: 3000\n\n');
  const client = { res, viewer };
  clients.add(client);
  holdForSession(viewer, res);
  clearTimeout(samplerStop);
  for (const node of NODES) {
    startSampler(node);
    const last = samplers.get(node.id)?.last;
    if (last) res.write(`data: ${JSON.stringify(last)}\n\n`);
  }
  const ping = setInterval(() => res.write(': ping\n\n'), 15000);
  req.on('close', () => {
    clearInterval(ping);
    clients.delete(client);
    if (!clients.size) samplerStop = setTimeout(stopSamplers, 20000);
  });
}


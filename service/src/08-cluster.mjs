/* ───────── one model across two linked Sparks ───────── */
// Area: ground        Rules: R14, R15, R16, R17        Tests: across.test.mjs
// Owns: none
// Timers: none        Wakes: none
// NVIDIA's two-Spark method (build.nvidia.com/spark/vllm-cluster, advanced): native vLLM multi-node, one tensor-parallel
// rank per Spark, talking over the direct cable. The first Spark is the head and serves the API on its Tailscale address,
// port 8000, like a single-Spark deploy; the second runs headless. This service starts each part over its own SSH.
const CLUSTER_PORT = 29501;
const clusterName = nodes => nodes.join('+');
const workerName = model => `${containerName(model)}-part2`;

// The cable between two Sparks, from the last link scan: the head's address on it, each side's network device on it,
// and each side's RoCE devices on that cable (a cable carries two subnets, one per twin port).
async function clusterNet(headId, workerId) {
  const f = await fabric({ nodeIds: null }, false);
  const pair = (lastCheck?.pairs || []).find(p => [p.a, p.b].sort().join() === [headId, workerId].sort().join());
  if (!pair) throw new HttpError(409, `The cable between ${headId} and ${workerId} hasn’t been tested yet. Test it first with Spark Console’s cable test (GET /fabric?check=1).`);
  if (pair.fastLink !== 'full') throw new HttpError(409, `The cable between ${headId} and ${workerId} isn’t passing full-size packets, so they can’t run a model together.`);
  const head = f.sparks.find(s => s.id === headId), worker = f.sparks.find(s => s.id === workerId);
  const matches = [];
  for (const la of head?.links || []) {
    if (!la.up) continue;
    for (const cidr of la.ipv4) {
      for (const lb of worker?.links || []) {
        const peer = lb.up && lb.ipv4.find(c => sameSubnet(cidr, c.split('/')[0]));
        if (peer) matches.push({ headIf: la.name, headIp: cidr.split('/')[0], headHca: la.hca, workerIf: lb.name, workerIp: peer.split('/')[0], workerHca: lb.hca });
      }
    }
  }
  if (!matches.length) throw new HttpError(409, `${headId} and ${workerId} don’t share a network on their cable.`);
  const hcas = key => [...new Set(matches.map(m => m[key]).filter(Boolean))].join(',');
  return { headIp: matches[0].headIp, headIf: matches[0].headIf, workerIp: matches[0].workerIp, workerIf: matches[0].workerIf, headHca: hcas('headHca'), workerHca: hcas('workerHca') };
}

// One side of the connection check (cableCheck): listens on this Spark's address on the cable and connects to the
// other Spark's, for up to a few seconds, and prints "cable in|out <port> <result>" for each port. Changes nothing.
const CABLE_CHECK_PY = String.raw`
import errno, socket, sys, threading, time
lip, cip, secs = sys.argv[1], sys.argv[3], float(sys.argv[5])
lports, cports = [int(p) for p in sys.argv[2].split(',') if p], [int(p) for p in sys.argv[4].split(',') if p]
end, res, lock, socks = time.monotonic() + secs, {}, threading.Lock(), []
def put(k, v):
    with lock: res[k] = v
for p in lports:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        s.bind((lip, p)); s.listen(8); s.settimeout(0.3); socks.append((p, s)); put('in %d' % p, 'nothing')
    except OSError as e:
        put('in %d' % p, 'busy' if e.errno == errno.EADDRINUSE else 'error'); s.close()
def serve(p, s):
    while time.monotonic() < end:
        try:
            c, _ = s.accept(); c.close(); put('in %d' % p, 'ok'); return
        except socket.timeout: pass
        except OSError: return
def dial(p):
    last = 'timeout'
    while time.monotonic() < end:
        try:
            socket.create_connection((cip, p), timeout=max(0.2, min(3.0, end - time.monotonic()))).close(); put('out %d' % p, 'ok'); return
        except socket.timeout: last = 'timeout'
        except ConnectionRefusedError: last = 'refused'; time.sleep(0.3)
        except OSError as e: last = 'unreachable' if e.errno in (errno.EHOSTUNREACH, errno.ENETUNREACH) else 'error'; time.sleep(0.3)
    put('out %d' % p, last)
ts = [threading.Thread(target=serve, args=x) for x in socks] + [threading.Thread(target=dial, args=(p,)) for p in cports]
for t in ts: t.start()
for t in ts: t.join()
for k, v in sorted(res.items()): print('cable', k, v)
`;

// Ports free on this machine now, all different (each held until all are taken): the stand-in fleet's cable check.
function freeLocalPorts(n) {
  const held = [];
  const one = () => new Promise((resolve, reject) => { const s = createNetServer(); s.on('error', reject); s.listen(0, '127.0.0.1', () => { held.push(s); resolve(s.address().port); }); });
  return (async () => { try { const out = []; for (let i = 0; i < n; i++) out.push(await one()); return out; } finally { await Promise.all(held.map(s => new Promise(r => s.close(() => r())))); } })();
}
// Whether the two Sparks can open connections to each other over their cable, checked before anything stops. The
// cable test only pings, and pings get through a firewall that refuses connections; each part's first step is the
// second Spark connecting to the first on CLUSTER_PORT, then connections both ways on ports the engines pick (2026-11-10:
// both parts sat at that first step for 28 minutes). The first Spark listens on CLUSTER_PORT and a high port, the
// second on a high port, and each connects to the other's. `freesPort`: what holds CLUSTER_PORT there now stops first.
async function cableCheck(job, nodeIds, net, freesPort = false) {
  const [head, worker] = nodeIds.map(id => nodeById(id)), [hn, wn] = [head, worker].map(sparkName);
  const high = () => 40000 + Math.floor(Math.random() * 20000);
  // The stand-in fleet's cables aren't on this machine: its Sparks meet on 127.0.0.1, on ports this machine hands out
  // (never one another test fleet's sockets hold), for the seconds the tests give it (SPARK_CONSOLE_CABLE_SECS, longer
  // on a slow machine), and one with a ~/.mock/firewall listens on nothing, as if it refused every connection.
  const local = ALL_LOCAL ? await freeLocalPorts(3) : null;
  const headHigh = local ? local[1] : high(), workerHigh = local ? local[2] : headHigh === 59999 ? 40000 : headHigh + 1;
  const meet = local ? local[0] : CLUSTER_PORT, secs = ALL_LOCAL ? Number(process.env.SPARK_CONSOLE_CABLE_SECS) || 3 : 15;
  const at = ip => (ALL_LOCAL ? '127.0.0.1' : ip), walled = n => ALL_LOCAL && existsSync(`${process.env.MOCK_ROOT}/${n.id}/.mock/firewall`);
  const side = (node, lip, lports, cip, cports) => run(node, `python3 - ${[at(lip), (walled(node) ? [] : lports).join(','), at(cip), cports.join(','), secs].map(String).map(q).join(' ')} <<'PY'\n${CABLE_CHECK_PY}\nPY`, { timeout: (secs + 25) * 1000 });
  step(job, `Checking that ${hn} and ${wn} can connect to each other over the cable`);
  const [h, w] = await Promise.all([side(head, net.headIp, [meet, headHigh], net.workerIp, [workerHigh]), side(worker, net.workerIp, [workerHigh], net.headIp, [meet, headHigh])]);
  for (const [r, n] of [[h, hn], [w, wn]]) if (r.code) throw new Error(`Couldn’t check the cable from ${n}: ${(r.err || r.out || `exit ${r.code}`).trim().slice(-300)}`);
  const seen = r => Object.fromEntries(r.out.split('\n').map(l => l.trim().split(/\s+/)).filter(x => x[0] === 'cable' && x.length === 4).map(([, dir, port, result]) => [`${dir} ${port}`, result]));
  const H = seen(h), W = seen(w), problems = [];
  const why = { timeout: 'it timed out', refused: 'it was refused', unreachable: 'there was no route', error: 'it failed' };
  // Into one Spark from the other: a port its listener couldn't take says nothing about the cable.
  const into = (them, us, ports, name, ip, iface, from) => {
    if (ports.some(p => them[`in ${p}`] === 'error')) return problems.push(`${name} couldn’t listen on its cable address ${ip}; it may have changed since the last cable test. Test the cable again with Spark Console’s cable test (GET /fabric?check=1).`);
    const bad = ports.find(p => them[`in ${p}`] !== 'busy' && us[`out ${p}`] !== 'ok');
    if (bad != null) problems.push(`${from} can’t open a connection to ${name} over the cable (${why[us[`out ${bad}`]] || 'no answer'}), though pings get through. Most likely a firewall on ${name} refuses connections coming in on the cable. The owner can let them in on ${name}; with ufw: sudo ufw allow in on ${iface}`);
  };
  if (H[`in ${meet}`] === 'busy' && !freesPort) problems.push(`Port ${CLUSTER_PORT} on ${hn}, where the two parts meet, is already in use by another program. Stop it there first.`);
  into(H, W, [meet, headHigh], hn, net.headIp, net.headIf, wn);
  into(W, H, [workerHigh], wn, net.workerIp, net.workerIf, hn);
  if (problems.length) throw new Error(`${hn} and ${wn} can’t run a model together yet, so nothing was stopped.\n${problems.join('\n')}`);
  note(job, `${hn} and ${wn} connect to each other over the cable`);
}

// Each part's first step is connecting to the other; until then neither loads anything. Lines that say they're past it:
// SGLang's "Load weight begin", vLLM's "Starting to load model", or any engine loading its weights.
const LOADING_RE = 'Load weight begin|Starting to load model|Loading weights|Loading safetensors|Init parallel end|Init torch distributed ends';
const CONNECT_MS = Number(process.env.SPARK_CONSOLE_CONNECT_MS || 10 * 60000);
const spanOf = ms => (ms >= 90000 ? `${Math.round(ms / 60000)} minutes` : `${Math.round(ms / 1000)} seconds`);
// The lines of a part's log about connecting (NCCL's steps and warnings, the meeting point's errors), last ones first in line.
function connectLines(log) {
  const hits = [...new Set(String(log || '').split('\n').filter(l => !/^(sock|env) /.test(l)).filter(l => /NCCL WARN|NCCL error|NCCL INFO (?:Bootstrap|NET\/|Using network|ncclCommInitRank|comm 0x|Init (?:START|COMPLETE)|Connected all)|Gloo|TCPStore|DistStore|DistNetworkError|Connection (?:refused|timed out|reset)|No route to host|init_process_group|rendezvous/i.test(l)))];
  return hits.length ? `${hits.slice(-10).map(l => l.slice(0, 400)).join('\n')}\n…\n` : '';
}
// A stuck part, before it's stopped: first its own TCP connections (what its engine listens on and is trying to reach,
// from /proc), then its Python stacks. Each part runs with PYTHONFAULTHANDLER, so SIGABRT makes Python print where every
// thread was waiting; one process at a time, or their dumps interleave (2026-11-10: NCCL said nothing while both parts
// sat at "Init parallel begin."; the stacks showed both in torch's Gloo setup).
const DUMP_PY = String.raw`
import os, signal, socket, time
me = os.getpid()
pids = sorted(int(p) for p in os.listdir('/proc') if p.isdigit() and int(p) != me)
inodes = set()
for p in pids:
    try:
        for fd in os.listdir('/proc/%d/fd' % p):
            try:
                t = os.readlink('/proc/%d/fd/%s' % (p, fd))
                if t.startswith('socket:['): inodes.add(t[8:-1])
            except OSError: pass
    except OSError: pass
STATES = {'01': 'connected', '02': 'trying to connect', '03': 'being connected', '06': 'closing', '08': 'closing', '0A': 'listening'}
def addr(h, v6):
    ip, port = h.split(':'); b = bytes.fromhex(ip)
    a = socket.inet_ntop(socket.AF_INET6, b''.join(b[i:i + 4][::-1] for i in range(0, 16, 4))) if v6 else socket.inet_ntop(socket.AF_INET, b[::-1])
    return '%s:%d' % (a, int(port, 16))
for f, v6 in (('/proc/net/tcp', False), ('/proc/net/tcp6', True)):
    try:
        for line in open(f).read().split('\n')[1:]:
            c = line.split()
            if len(c) > 9 and c[9] in inodes:
                print('sock', addr(c[1], v6), addr(c[2], v6), STATES.get(c[3], c[3]), flush=True)
    except (OSError, ValueError): pass
seen = set()
for p in pids:
    try:
        env = open('/proc/%d/environ' % p, 'rb').read().split(b'\0')
        for kv in env:
            k = kv.split(b'=', 1)[0].decode('utf-8', 'replace')
            if (k.startswith(('MASTER_', 'TORCHELASTIC', 'SGLANG_DISTRIBUTED', 'GLOO_', 'TORCH_DIST')) or k in ('WORLD_SIZE', 'RANK', 'LOCAL_RANK')) and kv not in seen:
                seen.add(kv); print('env', kv.decode('utf-8', 'replace')[:200], flush=True)
    except OSError: pass
for p in pids:
    try: os.kill(p, signal.SIGABRT); time.sleep(0.4)
    except OSError: pass
`;
// A stuck part's connections, from DUMP_PY: the ones that leave its Spark first, then its connections to itself (on
// 2026-11-10 only its Gloo listener left the Spark, so where its rendezvous went was among the others); and the
// rendezvous settings its processes saw.
function sockLines(out) {
  const local = a => /^(127\.|::1:|::ffff:127\.)/.test(a);
  const all = [...new Set(String(out || '').split('\n').filter(l => l.startsWith('sock ')).map(l => l.slice(5).trim()))].map(l => l.split(' '));
  const shown = ([from, to, ...st]) => (st.join(' ') === 'listening' ? `  ${from} listening` : `  ${from} → ${to} ${st.join(' ')}`);
  const away = all.filter(([from, to]) => !(local(from) && local(to))), home = all.filter(([from, to]) => local(from) && local(to));
  const socks = [...away.map(shown), ...home.map(x => `${shown(x)} (on this Spark)`)];
  const env = [...new Set(String(out || '').split('\n').filter(l => l.startsWith('env ')).map(l => `  ${l.slice(4).trim()}`))];
  return (socks.length ? `Its connections:\n${socks.slice(0, 24).join('\n')}\n` : '') + (env.length ? `Its rendezvous settings:\n${env.slice(0, 12).join('\n')}\n` : '');
}
// Where a part was waiting: the engine's connection frames from that stack dump, innermost first.
function stuckAt(log) {
  const frames = [...new Set(String(log || '').split('\n').map(l => l.match(/File "([^"]+)", line (\d+),? in (\S+)/)).filter(Boolean)
    .filter(m => /distributed|parallel_state|pynccl|model_runner|c10d|gloo|nccl/i.test(`${m[1]} ${m[3]}`))
    .map(m => `  ${m[1].replace(/^.*\/((?:sglang|vllm|torch)\/)/, '$1')}:${m[2]} in ${m[3]}`))];
  return frames.length ? `Waiting in:\n${frames.slice(0, 10).join('\n')}\n…\n` : '';
}
// What a stuck part was doing, from its stack: setting up Gloo (torch's CPU group, plain TCP) or NCCL (the GPUs' link).
const stuckIn = log => { const s = stuckAt(log); return /gloo/i.test(s) ? 'Gloo' : /nccl/i.test(s) ? 'NCCL' : null; };

// The engine check before the parts start: in the model's own image, on both Sparks, with each part's environment, a
// short torch.distributed test (Gloo, then NCCL on the GPUs) meeting where the parts will. A start whose engines can't
// connect fails in about a minute with Gloo's or NCCL's own words, not at the 10-minute stall (2026-11-10: both parts
// sat in Gloo's setup for 10 minutes, though plain connections both ways worked). Images without torch skip it.
// Its own result lines are read on their own: NCCL's setup lines (over 100) once pushed them out of the log's tail, and
// a check that had passed (Gloo, then NCCL over RoCE in 1.5 s) read as one that couldn't run.
const ENGINE_CHECK_NAME = 'spark-console-engine-check';
const ENGINE_CHECK_PY = String.raw`
import datetime, sys
ip, port, rank, secs = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), float(sys.argv[4])
# Results go to stderr: NCCL logs to stdout through C's buffer, which can split one of its lines at a buffer boundary
# with a result line in the middle, so a reader looking at the start of each line missed it (2026-11-11).
def say(*a): print('engine', *a, file=sys.stderr, flush=True)
try:
    import torch, torch.distributed as dist
except Exception as e:
    say('none', ' '.join(repr(e).split())[:300]); sys.exit(0)
say('start', torch.__version__)
wait = datetime.timedelta(seconds=secs)
try:
    dist.init_process_group('gloo', init_method='tcp://%s:%d' % (ip, port), rank=rank, world_size=2, timeout=wait)
    x = torch.ones(1); dist.all_reduce(x); say('gloo', 'ok')
except Exception as e:
    say('gloo', 'failed', ' '.join(str(e).split())[:700]); sys.exit(3)
try:
    torch.cuda.set_device(0)
    g = dist.new_group([0, 1], backend='nccl', timeout=wait)
    y = torch.ones(1, device='cuda'); dist.all_reduce(y, group=g); torch.cuda.synchronize(); say('nccl', 'ok')
except Exception as e:
    say('nccl', 'failed', ' '.join(str(e).split())[:700]); sys.exit(4)
`;
async function engineCheck(job, { cp, model, net, nodeIds, fix }) {
  const secs = ALL_LOCAL ? 5 : 45, [hn, wn] = nodeIds.map(id => sparkName(nodeById(id)));
  const roce = Boolean(net.headHca && net.workerHca && !fix.sockets);
  step(job, `Checking that the engines on ${hn} and ${wn} can connect over the cable (a short test in the model’s image)`);
  const results = await Promise.all(cp.members.map((m, rank) => {
    const env = clusterEnv(model, rank, net, fix);
    const runIt = ['docker', 'run', '-d', '--name', ENGINE_CHECK_NAME, '--label', 'spark.check=1', '--privileged', '--gpus', 'all', '--ipc', 'host', '--network', 'host',
      '--ulimit', 'memlock=-1', ...Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`]), '--entrypoint', 'python3', imageOf(model),
      '-c', ENGINE_CHECK_PY, ALL_LOCAL ? '127.0.0.1' : net.headIp, String(CLUSTER_PORT), String(rank), String(secs)].map(q).join(' ');
    const n = q(ENGINE_CHECK_NAME);
    return run(nodeById(m.node), `docker rm -f ${n} >/dev/null 2>&1; ${runIt} >/dev/null || exit 1\ntimeout ${secs + 60} docker wait ${n} >/dev/null 2>&1; docker logs ${n} 2>&1 | grep -oE 'engine (start|none|gloo|nccl) .*'; docker logs ${n} 2>&1 | grep -v '^engine ' | tail -60; echo "engine exit $(docker inspect -f '{{.State.Status}} {{.State.ExitCode}} {{.State.OOMKilled}}' ${n} 2>/dev/null)"; docker rm -f ${n} >/dev/null 2>&1; true`, { timeout: (secs + 120) * 1000 });
  }));
  const said = results.map(r => String(r.out || ''));
  // A result line, wherever it starts on its line (see say() in ENGINE_CHECK_PY).
  const said1 = (i, what) => said[i].split('\n').map(l => l.match(new RegExp(`(engine ${what}\\b.*)$`))?.[1]?.trim()).find(Boolean) || null;
  // No torch in the image, or the check couldn't run there: the start goes on as before, with the stall check behind
  // it, and the log says why (2026-11-10: it ended in seconds on the real Sparks and said nothing).
  const off = cp.members.findIndex((m, i) => results[i].code || said1(i, 'none') || !said1(i, 'start'));
  if (off >= 0) {
    const r = results[off], why = said1(off, 'none')?.replace(/^engine none\s*/, 'no torch in the image: ')
      || `${r.code ? `exit ${r.code}: ` : ''}${[...String(r.err || '').trim().split('\n'), ...said[off].trim().split('\n')].filter(Boolean).slice(-3).join(' | ').slice(0, 500) || 'no output'}`;
    note(job, `The engine check didn’t run on ${[hn, wn][off]} (${why}), so the start goes on without it`);
    return;
  }
  const names = [hn, wn], gloo = said.map((t, i) => said1(i, 'gloo') || 'engine gloo failed it didn’t finish in time'), nccl = said.map((t, i) => said1(i, 'nccl'));
  const lines = cp.members.map((m, i) => `── ${m.node}\n${connectLines(said[i])}${said[i].trim().split('\n').filter(l => !/^engine /.test(l)).slice(-6).join('\n')}`).join('\n');
  if (gloo.some(l => !/ ok$/.test(l))) {
    const i = gloo.findIndex(l => !/ ok$/.test(l));
    throw new Error(`${hn} and ${wn} couldn’t connect their engines over the cable in a short test before the start, so the model wasn’t started (stuck in Gloo, torch’s plain-TCP setup, on ${names[i]}: ${gloo[i].replace(/^engine gloo failed\s*/, '')}).\n${lines}`);
  }
  // How each check ended: "exited 139 false" (its state, exit code, out of memory), or still running at the time limit.
  const ended = i => {
    const [st, code, oom] = (said1(i, 'exit') || '').replace(/^engine exit\s*/, '').split(/\s+/);
    return st === 'exited' ? `it ended without a result (exit ${code}${oom === 'true' ? ', out of memory' : ''})` : 'it didn’t finish in time';
  };
  // NCCL connected (its setup finished on both Sparks) but the test's one-number sum gave no answer: inconclusive, not a
  // failure, so the start goes on and the log says so (2026-11-11: Init COMPLETE in 1.2 s on both, over RoCE and over
  // plain sockets, then the check ended without a word, which blocked a start that the cable could carry).
  const linked = said.every(t => /NCCL INFO .*Init COMPLETE/.test(t));
  const bad = nccl.findIndex((l, i) => (l ? !/ ok$/.test(l) : !linked));
  if (bad >= 0) {
    throw new Error(`${hn} and ${wn} couldn’t connect their engines over the cable in a short test before the start, so the model wasn’t started (stuck in NCCL, with NCCL over ${roce ? 'RoCE' : 'plain sockets'}, on ${names[bad]}: ${nccl[bad] ? nccl[bad].replace(/^engine nccl failed\s*/, '') : ended(bad)}).\n${lines}`);
  }
  const short = nccl.findIndex(l => !l);
  note(job, `The engines on ${hn} and ${wn} connect over the cable (Gloo and NCCL${roce ? ' over RoCE' : ''}${short >= 0 ? `; NCCL’s setup finished on both, but its test sum on ${names[short]} gave no answer: ${ended(short)}` : ''})`);
}

// What it takes on each Spark: its usual single-Spark plan (stops, copy, image), with about half the model's memory.
async function clusterPlan(modelName, nodeIds, viewer, known = null, probes = new Map(), how = null) {
  if (!Array.isArray(nodeIds) || nodeIds.length !== 2 || nodeIds[0] === nodeIds[1]) throw new HttpError(400, 'Pick two Sparks.');
  for (const id of nodeIds) if (!nodeById(id)) throw new HttpError(400, 'Unknown Spark.');
  if (!canUse(viewer)) throw new HttpError(403, 'Only the owner can do that.');
  const inv = known || await inventory(null);
  const runs = withHow(inv.library.find(m => m.name === modelName), how);
  if (runs && !ENGINES[engineOf(runs)].pairs) throw new HttpError(409, `Running across Sparks uses vLLM or SGLang; this setup uses ${ENGINES[engineOf(runs)].title}.`);
  const members = await Promise.all(nodeIds.map(id => plan(modelName, id, viewer, inv, probes, how)));
  const need = members[0].memory.need, each = Math.round(need / 2 + 4 * 2 ** 30);
  const fits = members.map(p => fitOf({ ...p, memory: { ...p.memory, need: each } }));
  return {
    model: members[0].model, nodes: nodeIds, head: nodeIds[0], each, need,
    members: members.map((p, i) => ({ node: p.node, store: p.store, sparkieHere: p.sparkieHere, steps: p.steps, warnings: p.warnings, memory: { ...p.memory, need: each }, fits: fits[i].fits, stop: fits[i].stop, spare: fits[i].spare, copy: fits[i].copy })),
    fits: fits.every(x => x.fits), endpoint: members[0].endpoint, tsip: members[0].tsip,
  };
}

// A setup may tune NCCL, but never point the parts at a different cable or a different meeting point: these are always
// Spark Console's. The interfaces found on these Sparks win (a setup written on someone else's machine names their
// interface names), and the parts always meet at the first Spark's cable address (--dist-init-addr / --master-addr).
// SGLANG_DISTRIBUTED_INIT_METHOD_OVERRIDE is the brain's own: on Spark 2 it keeps SGLang's rendezvous in a file
// (file:///tmp/sglang-rdv). Carried over with the brain's setup to two Sparks, each part met only itself in its own
// container's file, then waited for the other in Gloo's setup forever (2026-11-10, four real starts).
const CLUSTER_PINNED_ENV = new Set(['NCCL_SOCKET_IFNAME', 'GLOO_SOCKET_IFNAME', 'UCX_NET_DEVICES', 'TP_SOCKET_IFNAME', 'NCCL_IB_HCA', 'MN_IF_NAME',
  'OMPI_MCA_btl_tcp_if_include', 'SGLANG_DISTRIBUTED_INIT_METHOD_OVERRIDE', 'VLLM_HOST_IP']);
// Each part's environment: NCCL, Gloo and the rest pinned to this cable (the engine check before the start uses the same).
function clusterEnv(model, rank, net, fix = {}) {
  const iface = rank === 0 ? net.headIf : net.workerIf, hca = rank === 0 ? net.headHca : net.workerHca;
  const sglang = engineOf(model) === 'sglang';
  // SGLang's two-Spark recipes also turn off NCCL's cuMem allocator and NVLS, which GB10 doesn't have.
  // NCCL_DEBUG=INFO for its setup steps only (bootstrap, network): which step two parts reached when they don't connect.
  // At WARN it said nothing while both parts sat at their first step (2026-11-10). PYTHONFAULTHANDLER: see DUMP_PY.
  const env = { ...ENGINE_CACHE_ENV, NCCL_DEBUG: 'INFO', NCCL_DEBUG_SUBSYS: 'INIT,BOOTSTRAP,NET', PYTHONFAULTHANDLER: '1',
    NCCL_SOCKET_IFNAME: iface, GLOO_SOCKET_IFNAME: iface, UCX_NET_DEVICES: iface, TP_SOCKET_IFNAME: iface,
    // No RoCE device found for this cable: NCCL uses plain sockets on it rather than guessing another cable's device.
    ...(hca ? { NCCL_IB_HCA: hca, NCCL_IB_DISABLE: '0' } : { NCCL_IB_DISABLE: '1' }), NCCL_IGNORE_CPU_AFFINITY: '1', ...(sglang ? { NCCL_CUMEM_ENABLE: '0', NCCL_NVLS_ENABLE: '0' } : {}) };
  for (const [k, v] of Object.entries(dig.cleanEnv(model.manifest?.cluster?.env || {}))) if (!CLUSTER_PINNED_ENV.has(k)) env[k] = v;
  // The known fix for parts that never connected over RoCE: NCCL over plain sockets on the same cable, whatever the recipe says.
  if (fix.sockets) { delete env.NCCL_IB_HCA; env.NCCL_IB_DISABLE = '1'; }
  return env;
}

function clusterRunCommand(model, { rank, nodes, net, store, tsip, extra = [], fix = {} }) {
  const name = model.name, args = [...(Array.isArray(model.manifest?.args) ? model.manifest.args.map(String) : []), ...extra];
  const fromCache = store === 'hf', served = fromCache ? model.repo || name : name;
  const sglang = engineOf(model) === 'sglang', env = clusterEnv(model, rank, net, fix);
  const parts = ['docker', 'run', '-d', '--name', rank === 0 ? containerName(name) : workerName(name),
    '--label', 'spark.console=1', '--label', `spark.model=${name}`, '--label', `spark.cluster=${clusterName(nodes)}`, '--label', `spark.rank=${rank}`,
    '--privileged', '--gpus', 'all', '--ipc', 'host', '--network', 'host', '--shm-size', '16g',
    '--ulimit', 'nofile=1048576:1048576', '--ulimit', 'memlock=-1', '--ulimit', 'stack=67108864',
    ...Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`])].map(q);
  const mount = fromCache ? `${HF_HUB}/models--${name}:/hf:ro` : `"$HOME/${CONFIG.modelsDir}/${name}":/model:ro`;
  const cache = engineCache(imageOf(model));
  const prelude = cache.prelude + (fromCache
    ? `dir=${HF_HUB}/models--${name}; ${hfSnap('"$dir"')}; [ -n "$snap" ] || { echo "No snapshot of ${name} in the Hugging Face cache." >&2; exit 1; }\n${hfMounts()}`
    : '');
  const path = fromCache ? '/hf/snapshots/"$snap"' : q('/model');
  const vol = [...(fromCache ? ['"${hfmounts[@]}"'] : ['-v', mount]), ...cache.mount];
  if (sglang) {
    // SGLang: every part runs launch_server with the same model and flags; part 0 answers on its Tailscale address.
    const serve = ['--tp', '2', '--nnodes', '2', '--node-rank', String(rank), '--dist-init-addr', `${net.headIp}:${CLUSTER_PORT}`,
      '--host', rank === 0 ? tsip : '127.0.0.1', '--port', '8000', '--served-model-name', served, ...(rank === 0 ? metricsFlags('sglang', args) : []), ...args];
    return prelude + [...parts, ...vol, ...['--entrypoint', 'python3', imageOf(model), '-m', 'sglang.launch_server', '--model-path'].map(q), path, ...serve.map(q)].join(' ');
  }
  const serve = ['--tensor-parallel-size', '2', '--nnodes', '2', '--node-rank', String(rank), '--master-addr', net.headIp, '--master-port', String(CLUSTER_PORT),
    ...(rank === 0 ? ['--host', tsip, '--port', '8000', '--served-model-name', served] : ['--headless']), ...args];
  return prelude + [...parts, ...vol, ...['--entrypoint', 'vllm', imageOf(model), 'serve'].map(q), path, ...serve.map(q)].join(' ');
}

async function clusterDeploy(job, modelName, nodeIds, viewer, keep = [], how = null, approved = null, fix = {}) {
  const cp = await clusterPlan(modelName, nodeIds, viewer, null, new Map(), how);
  for (const m of cp.members) {
    const extra = unapprovedStops(m.steps, m.node, keep, approved);
    if (extra.length) throw planMoved(extra, m.node);
  }
  job.checkPause?.();
  if (!cp.tsip) throw new Error(`${cp.head} has no Tailscale address to serve on.`);
  const net = await clusterNet(cp.head, nodeIds[1]);
  const inv = await inventory(null);
  const model = withoutRejected(withHow(inv.library.find(m => m.name === modelName), how), fix);
  const names = [containerName(modelName), workerName(modelName)];
  // Before anything stops: can the two Sparks connect over the cable? A model across these two Sparks that this start
  // stops on the first one holds the meeting port until then.
  const headStops = cp.members[0].steps.filter(s => s.kind === 'stop' && !keep.includes(s.container)).map(s => s.container);
  await cableCheck(job, nodeIds, net, Boolean(inv.sparks.find(sp => sp.id === cp.head)?.deployments.some(d => d.cluster && headStops.includes(d.container))));
  job.checkPause?.();
  try {
    // Clear the way on both Sparks: what has to stop (except what you kept), then copies and images.
    for (const m of cp.members) {
      const node = nodeById(m.node);
      for (const s of m.steps.filter(s => s.kind === 'stop')) {
        if (keep.includes(s.container)) { note(job, `Keeping ${s.container} on ${m.node} running, as asked`); continue; }
        await stopContainer(job, m.node, s.container, viewer);
      }
      // A container this start stopped that has a part's name (the same model on one Spark) is set aside under another
      // name, not removed, so it can start again if this doesn't (2026-11-10: removing it left nothing to put back).
      for (const n of names) {
        if (!(job.stoppedHere || []).includes(`${m.node}/${n}`) || (job.asideHere || []).some(a => a.node === m.node && a.name === n)) continue;
        const aside = `${n}-before-${job.id}`;
        const r = await run(node, `docker rename ${q(n)} ${q(aside)}`, { timeout: 30000 });
        if (r.code) throw new Error(`Couldn’t set ${n} on ${m.node} aside to make room for this part: ${(r.err || r.out).trim().slice(-300)}`);
        (job.asideHere ||= []).push({ node: m.node, name: n, aside });
      }
      await run(node, `docker rm -f ${names.map(q).join(' ')} >/dev/null 2>&1; true`);
    }
    await clusterParts(job, { cp, net, model, modelName, names, nodeIds, viewer, keep, how, fix });
  } catch (e) {
    await asideBack(job);
    throw e;
  }
  // It runs: what was set aside for it (the same model on one Spark) goes, as it always did.
  for (const a of job.asideHere || []) {
    const r = await run(nodeById(a.node), `docker rm ${q(a.aside)} >/dev/null 2>&1`, { timeout: 30000 });
    note(job, r.code ? `Couldn’t remove ${a.aside} on ${a.node} (the one-Spark ${a.name} this replaced); remove it there with docker rm ${a.aside}` : `Replaced the one-Spark ${a.name} on ${a.node}`);
  }
  job.asideHere = [];
}

// It didn't start: what was set aside gets its name back and starts again. It's taken off this start's lists, so
// putting the rest back (putBack) doesn't stop it again as one of this start's parts. Before that the new container of
// its own name is stopped and looked at (W-1), and nothing else this start ran there may still run (A-23); otherwise it
// stays set aside, and the new one stays on `ranHere`, so putBack's checked stop and its words cover both. A pair set
// aside goes back whole or not at all (W-7). After putBack's own stops (`afterStops`) it only looks.
// One whose start again failed stays on `stoppedHere` and is said (W-3, job.notBack).
async function asideBack(job, afterStops = false) {
  const ready = new Map();
  for (const a of job.asideHere || []) {
    const x = `${a.node}/${a.name}`;
    ready.set(a, afterStops ? !(await runningOn(job, a.node)).length
      : !(await runningOn(job, a.node, x)).length && (await stopChecked(nodeById(a.node), a.name)) === 'stopped');
  }
  const held = [], all = job.asideHere || [];
  for (const u of backUnits(all.map(a => `${a.node}/${a.name}`))) {
    const parts = u.items.map(x => all.find(a => `${a.node}/${a.name}` === x));
    if (parts.some(a => !ready.get(a))) { held.push(...parts); continue; }
    const back = [];
    for (const a of parts) {
      const x = `${a.node}/${a.name}`;
      const r = await run(nodeById(a.node), `docker rm -f ${q(a.name)} >/dev/null 2>&1; docker rename ${q(a.aside)} ${q(a.name)} || exit 3; docker start ${q(a.name)} >/dev/null || exit 4`, { timeout: 120000 });
      job.ranHere = (job.ranHere || []).filter(y => y !== x);
      consoleStopped.delete(x);
      if (!r.code) {
        job.stoppedHere = (job.stoppedHere || []).filter(y => y !== x);
        note(job, `Started ${a.name} on ${a.node} again`);
        back.push(a);
        continue;
      }
      const at = sparkName(nodeById(a.node) || { id: a.node }), there = r.code === 4 ? '' : r.code === 3 ? ` (it’s there as ${a.aside})` : ` (Docker didn’t answer: it may be there as ${a.aside})`;
      note(job, `Couldn’t start ${a.name} on ${a.node} again${there}; start it from Spark Console.`);
      (job.notBack ||= []).push({ items: u.items, words: u.model ? `${u.model} couldn’t be started again across ${u.sparks.map(i => sparkName(nodeById(i) || { id: i })).join(' + ')}; start ${u.model} across both again`
        : `${a.name} couldn’t be started again on ${at}${there}; start it from Spark Console` });
      break;
    }
    // (a pair whose other part didn't start: the part that did is stopped again, and it is owed as the pair, W-7)
    if (u.model && back.length < parts.length) {
      for (const a of back) {
        consoleStopped.set(`${a.node}/${a.name}`, Date.now());
        (job.stoppedHere ||= []).push(`${a.node}/${a.name}`);
        if ((await stopChecked(nodeById(a.node), a.name)) === 'stopped') note(job, `Stopped ${a.name} on ${a.node} again: its other part didn’t start`);
      }
    }
  }
  job.asideHere = held;
}

// Copies and images, then both parts, then waiting until the first answers (both still running).
async function clusterParts(job, { cp, net, model, modelName, names, nodeIds, viewer, keep, how, fix }) {
  for (const m of cp.members) {
    const node = nodeById(m.node), copy = m.steps.find(s => s.kind === 'copy'), pull = m.steps.find(s => s.kind === 'pull');
    if (copy) {
      step(job, `Copying ${modelName} to ${m.node} from ${copy.from} (first time there)`);
      await copyModel(job, modelName, nodeById(copy.from), node, copy.bytes, copy.store);
      job.progress = null;
    }
    if (pull) {
      step(job, `Downloading the ${ENGINES[engineOf(model)].title} image on ${m.node}`);
      const r = await run(node, `docker pull ${q(pull.image)}`, { timeout: 3600000, signal: job.abort?.signal, onLine: line => { job.detail = line.slice(0, 200); } });
      if (r.code) throw new Error(`Image download on ${m.node} failed: ${r.err || r.out.slice(-500)}`);
    }
  }
  job.checkPause?.();
  await engineCheck(job, { cp, model, net, nodeIds, fix });
  // (each stop looked at, A-23: a Spark that didn't answer, and a stop that didn't take there, are both said)
  const stopAll = async () => {
    const r = await Promise.all(cp.members.map((m, i) => stopChecked(nodeById(m.node), names[i])));
    const missed = cp.members.filter((m, i) => r[i] !== 'stopped');
    for (const m of missed) {
      const i = cp.members.indexOf(m);
      note(job, r[i] === 'unknown' ? `Couldn’t reach ${m.node} to stop its part. Stop it there: docker stop ${names[i]}` : `Its part on ${m.node} didn’t stop: it is still running there. Stop it there: docker stop ${names[i]}`);
    }
    return missed;
  };
  // What the stops said, in an error's words: "both were stopped" only when both checked stops said so; otherwise the
  // part that may still run, and where (A-23: never said before a tool said so).
  const stopsSaid = (missed, both = 'both') => (missed.length ? `; ${missed.map(m => `its part on ${sparkName(nodeById(m.node))} (${names[cp.members.indexOf(m)]})`).join(' and ')} may still be running: Spark Console couldn’t confirm ${missed.length > 1 ? 'they' : 'it'} stopped`
    : `, so ${both} were stopped`);
  let unknownChecks = 0;
  // Both parts get the same memory share: the smaller of what each Spark has free.
  job.checkPause?.();
  const measured = await Promise.all(cp.members.map(m => memNow(nodeById(m.node))));
  const share = [...memoryShare(model, cp.members.map((m, i) => (measured[i] ? { node: m.node, steps: [], memory: { ...m.memory, ...measured[i] } } : { node: m.node, steps: m.steps, memory: { ...m.memory } })), keep), ...fixFlags(model, fix)];
  if (share.length && share[0] === ENGINES[engineOf(model)].memFlag) note(job, `Letting each part use ${Math.round(Number(share[1]) * 100)}% of its Spark’s memory (what’s free on both)`);
  step(job, `Starting ${modelName} across ${nodeIds.join(' and ')}`);
  for (const [rank, m] of cp.members.entries()) {
    const r = await run(nodeById(m.node), clusterRunCommand(model, { rank, nodes: nodeIds, net, store: m.store || 'models', tsip: cp.tsip, extra: share, fix }), { timeout: 120000 });
    // (one that timed out, or whose Spark stopped answering, may still have made it: on the list, so putBack looks at it, W-6)
    if (r.code && unanswered(r)) (job.ranHere ||= []).push(`${m.node}/${names[rank]}`);
    if (r.code) { await stopAll(); throw new Error(`Docker couldn’t start the part on ${m.node}: ${r.err || r.out}`); }
    (job.ranHere ||= []).push(`${m.node}/${names[rank]}`);
    // Started again on purpose (as a one-Spark start does): an earlier stop of this part no longer counts as "stopped
    // on purpose" for self-healing.
    consoleStopped.delete(`${m.node}/${names[rank]}`);
  }
  step(job, 'Loading the model on both Sparks; this can take several minutes');
  const began = Date.now(), deadline = began + 45 * 60 * 1000;
  let connected = false, lastLook = began;
  while (Date.now() < deadline) {
    await sleep(5000);
    if (job.cancelled) { await stopAll(); cancelCheck(job); }
    // Both parts have to still be running before the head's answer counts.
    const states = await Promise.all(cp.members.map((m, i) => run(nodeById(m.node), `docker inspect -f '{{.State.Status}}' ${q(names[i])} 2>/dev/null | head -1`, { timeout: 20000 })));
    // A Spark that didn't answer this check is unknown, not stopped: a few misses in a row (about a minute) count as down.
    if (states.some(st => st.code !== 0)) {
      if (++unknownChecks < 12) { job.detail = 'Waiting for a Spark to answer…'; continue; }
    } else unknownChecks = 0;
    const down = cp.members.findIndex((m, i) => states[i].code !== 0 || ['exited', 'dead', ''].includes(states[i].out.trim()));
    if (down < 0) {
      const head = await run(nodeById(cp.head), `curl -sf -m 4 http://${cp.tsip}:${CONFIG.servePort}/v1/models >/dev/null && echo up; docker logs --tail 1 ${q(names[0])} 2>&1 | tail -1`, { timeout: 20000 });
      const [first, last] = head.out.split('\n');
      if (first === 'up') {
        try { await answers(job, ALL_LOCAL ? '127.0.0.1' : cp.tsip, CONFIG.servePort); } catch (e) { await stopAll(); throw e; }
        job.endpoint = cp.endpoint;
        note(job, `Serving at ${cp.endpoint}`);
        // Started with NCCL over plain sockets: that's kept with the run, so starting it again the same way skips RoCE.
        await recordVerified(job, { model, engine: engineOf(model), image: imageOf(model), args: [...(model.manifest?.args || []).map(String), ...share],
          env: { ...Object.fromEntries(Object.entries(model.manifest?.cluster?.env || {}).filter(([k]) => !CLUSTER_PINNED_ENV.has(k))), ...(fix.sockets ? { NCCL_IB_DISABLE: '1' } : {}) }, nodes: nodeIds, host: ALL_LOCAL ? '127.0.0.1' : cp.tsip, port: CONFIG.servePort, viewer, how });
        return;
      }
      if (first || last) job.detail = (last || first || '').slice(0, 200);
      // Still at the first step after CONNECT_MS: neither part has started loading, so they never connected (2026-11-10:
      // 28 minutes at "Init parallel begin."). Stopped then, rather than at the 45-minute limit.
      if (!connected && Date.now() - lastLook >= Math.min(30000, CONNECT_MS / 4)) {
        lastLook = Date.now();
        const seen = await Promise.all(cp.members.map((m, i) => run(nodeById(m.node), `docker logs ${q(names[i])} 2>&1 | grep -ciE ${q(LOADING_RE)}`, { timeout: 30000 })));
        // grep's own answer only (0: found, 1: none); a Spark that didn't answer says nothing this time.
        if (seen.every(r => r.code === 0 || r.code === 1)) connected = seen.some(r => Number(r.out.trim()) > 0);
        if (!connected && seen.every(r => r.code === 1) && Date.now() - began >= CONNECT_MS) {
          // Each part's stacks first (they're stopped anyway), then its log; the tail shown is what it said before that.
          const logs = await Promise.all(cp.members.map((m, i) => run(nodeById(m.node), `docker exec ${q(names[i])} python3 -c ${q(DUMP_PY)} 2>/dev/null; sleep 3; docker logs --tail 600 ${q(names[i])} 2>&1`, { timeout: 45000 })));
          const missed = await stopAll();
          const [hn, wn] = nodeIds.map(id => sparkName(nodeById(id))), roce = Boolean(net.headHca && net.workerHca && !fix.sockets);
          const where = [...new Set(logs.map(r => stuckIn(r.out)).filter(Boolean))];
          throw new Error(`${hn} and ${wn} didn’t connect to each other over the cable within ${spanOf(CONNECT_MS)} (neither part started loading the model)${stopsSaid(missed)}. ` +
            `They connected in the checks before the start, so it’s the engine’s own connection step that didn’t finish${where.length ? ` (stuck in ${where.join(' and ')})` : ''}, with NCCL over ${roce ? 'RoCE' : 'plain sockets'}. Where each part was waiting, then NCCL’s lines, come first below.\n` +
            cp.members.map((m, i) => `── ${m.node}\n${stuckAt(logs[i].out)}${sockLines(logs[i].out)}${connectLines(logs[i].out)}${logs[i].out.split('\n').filter(l => !/^(sock|env) /.test(l)).join('\n').split(/\nFatal Python error/)[0].trim().slice(-1200)}`).join('\n'));
        }
      }
    } else {
      const logs = await Promise.all(cp.members.map((m, i) => run(nodeById(m.node), `docker logs --tail 400 ${q(names[i])} 2>&1`, { timeout: 20000 })));
      const missed = await stopAll();
      throw new Error(`The part on ${cp.members[down].node} stopped while loading${stopsSaid(missed)}.\n` +
        cp.members.map((m, i) => `── ${m.node}\n${causeLines(logs[i].out)}${logs[i].out.trim().slice(-1200)}`).join('\n'));
    }
  }
  const missed = await stopAll();
  throw new Error(`The model didn’t become ready across both Sparks within 45 minutes${stopsSaid(missed, 'both parts')}.`);
}


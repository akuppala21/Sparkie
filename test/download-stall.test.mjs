// Covers: T46 (part), HF data downloads: ten-minute production stall limits cannot be shortened outside stand-ins;
// saved bytes and Xet chunk writes, not output/lock/log chatter, reset the watch. A local HTTP Range fixture actually
// continues its kept partial file after a checked stop, at most three times. Admission is repeated, cancellation and
// expired leases stop native descendants, and an unconfirmed Docker stop/identity never grants a second attempt.
// Uses the real remote supervisor and Node retry helpers with local transport; no Hugging Face or real Spark is used.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, readdirSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { waitFor, sleep } from './lib.mjs';

const source = readFileSync(fileURLToPath(new URL('../service/src/11-downloads.mjs', import.meta.url)), 'utf8');
const fn = name => { const found = new RegExp(`^(?:async )?function ${name}\\([^]*?^\\}`, 'm').exec(source)?.[0]; assert.ok(found, name); return found; };
const raw = name => { const value = new RegExp(`const ${name} = String.raw\x60([^]*?)\x60;`).exec(source)?.[1]; assert.ok(value, name); return value; };
const quote = text => `'${String(text).replace(/'/g, `'\\''`)}'`;
const LINUX = process.platform === 'linux' ? {} : { skip: 'the target supervisor checks Linux process groups through /proc' };
const TIMING = { stall: .65, poll: .04, lease: 3, beat: 100 };
const PY_TRANSFER = String.raw`
import json, os, subprocess, sys, time, urllib.request
from pathlib import Path
home = Path.home()
cache = Path(os.environ['HF_HUB_CACHE'])/'models--fixture--Resume'/'blobs'
cache.mkdir(parents=True, exist_ok=True)
p = cache/'payload.incomplete'
mode = os.environ.get('TRANSFER_MODE', 'range')
xet = Path(os.environ['HF_XET_CACHE'])/'environment'/'chunk_cache'
xet.mkdir(parents=True, exist_ok=True)
keep = xet/'kept-chunk'
had_chunk = keep.exists()
if not had_chunk: keep.write_bytes(b'kept across resumes')
offset = p.stat().st_size if p.exists() else 0
with (home/'attempts.jsonl').open('a') as log:
    log.write(json.dumps({'offset': offset, 'xet': str(xet), 'hadChunk': had_chunk, 'fast': os.environ.get('HF_XET_HIGH_PERFORMANCE'), 'privateBlobs': os.environ.get('HF_HUB_DISABLE_SHARED_BLOBS')})+'\n')
(home/'transfer-ready').write_text('ready')
if mode == 'chatter':
    helper = subprocess.Popen([sys.executable, '-c', 'import pathlib,time; p=pathlib.Path.home()/"descendant-heartbeat"\nwhile True: p.write_text(str(time.time())); time.sleep(.03)'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    with (home/'descendants').open('a') as log: log.write(str(helper.pid)+'\n')
    locks = cache/'.locks'; locks.mkdir(exist_ok=True)
    while True:
        (locks/'waiting.lock').write_text(str(time.time()))
        (xet/'chatter.log').write_text(str(time.time()))
        print('still waiting', flush=True)
        time.sleep(.04)
if mode in ('xet', 'preallocated'):
    target = xet/'data-chunk' if mode == 'xet' else p
    if mode == 'preallocated':
        with target.open('wb') as out: out.truncate(65536)
    for i in range(8):
        with target.open('ab' if mode == 'xet' else 'r+b') as out:
            if mode == 'preallocated': out.seek(i*1024)
            out.write(b'x'*1024); out.flush(); os.fsync(out.fileno())
        time.sleep(.15)
    sys.exit(0)
if mode == 'quiet':
    p.write_bytes(b'partial')
    while True: time.sleep(.1)
request = urllib.request.Request(os.environ['TRANSFER_URL'], headers={'Range': 'bytes='+str(offset)+'-'} if offset else {})
with urllib.request.urlopen(request, timeout=20) as response, p.open('ab') as out:
    while True:
        chunk = response.read(4096)
        if not chunk: break
        out.write(chunk); out.flush(); os.fsync(out.fileno())
print('downloaded fixture/Resume', flush=True)
`;
const PY_DOCKER = String.raw`
import json, os, signal, subprocess, sys, time
from pathlib import Path
home = Path.home(); state = home/'daemon.json'; command = sys.argv[1]; args = sys.argv[2:]
with (home/'docker-calls').open('a') as log: log.write(command+'\n')
if command == 'images':
    if (home/'marker-persistence-fails').exists(): Path(os.environ['SC_HF_IMAGE_MARK']).mkdir()
    print('lmsysorg/sglang d1'); sys.exit(0)
if command == 'create':
    label = args[args.index('--label')+1].split('=', 1)[1]
    mounts = [args[i+1] for i,a in enumerate(args) if a == '-v']
    hub = next(m[:-8] for m in mounts if m.endswith(':/hf/hub'))
    xet = next(m[:-8] for m in mounts if m.endswith(':/hf/xet'))
    state.write_text(json.dumps({'Id': 'd'*64, 'Config': {'Labels': {'spark.console.download': label}}, 'State': {'Status': 'created'}, 'hub': hub, 'xet': xet}))
    if (home/'cid-persistence-fails').exists(): Path(os.environ['SC_HF_CID_FILE']).mkdir()
    print('d'*64); sys.exit(0)
d = json.loads(state.read_text())
if command == 'start':
    env = dict(os.environ, HF_HUB_CACHE=d['hub'], HF_XET_CACHE=d['xet'], HF_XET_HIGH_PERFORMANCE='1', HF_HUB_DISABLE_SHARED_BLOBS='1')
    with (home/'daemon-output').open('ab') as output:
        child = subprocess.Popen([sys.executable, os.environ['TRANSFER_SCRIPT']], env=env, start_new_session=True, stdout=output, stderr=output)
    d.update(pid=child.pid); d['State']['Status']='running'; state.write_text(json.dumps(d))
    code = child.wait(); d=json.loads(state.read_text()); d['State']['Status']='exited'; state.write_text(json.dumps(d)); sys.exit(code)
if command == 'inspect':
    if (home/'inspect-fails').exists(): sys.exit(1)
    print(json.dumps(d)); sys.exit(0)
if command == 'stop':
    if (home/'stop-fails').exists(): sys.exit(1)
    os.killpg(d['pid'], signal.SIGTERM); d['State']['Status']='exited'; state.write_text(json.dumps(d)); sys.exit(0)
if command == 'rm': state.unlink(); sys.exit(0)
sys.exit(1)
`;

async function fixture(t, { mode = 'range', local = true, stall = TIMING.stall, failLease = false, rejectAfter = Infinity } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'download-stall-')), bin = join(home, 'bin');
  mkdirSync(bin); mkdirSync(join(home, '.cache/huggingface/xet'), { recursive: true });
  writeFileSync(join(home, '.cache/huggingface/xet/preexisting'), 'owner cache remains');
  writeFileSync(join(home, 'transfer.py'), PY_TRANSFER);
  writeFileSync(join(bin, 'hf'), `#!/bin/sh\nexec python3 -I ${quote(join(home, 'transfer.py'))}\n`); chmodSync(join(bin, 'hf'), 0o755);
  writeFileSync(join(bin, 'docker'), `#!/usr/bin/python3\n${PY_DOCKER}`); chmodSync(join(bin, 'docker'), 0o755);
  if (!local) rmSync(join(bin, 'hf'));
  const children = new Set(), commands = [], admissions = [], notes = [];
  const env = { ...process.env, HOME: home, PATH: `${bin}:/usr/bin:/bin`, TRANSFER_MODE: mode, TRANSFER_SCRIPT: join(home, 'transfer.py') };
  const transport = (_host, script, options = {}) => {
    commands.push(script);
    if (failLease && script.includes(' \'beat\' "$hub" ')) return Promise.resolve({ code: 255, out: '', err: 'connection lost' });
    return new Promise(resolve => {
      const child = spawn('bash', ['-c', script], { env, detached: true }); children.add(child);
      let out = '', err = '', part = '';
      child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
      child.stdout.on('data', text => { out += text; part += text; const lines = part.split(/\r?\n/); part = lines.pop(); for (const line of lines) options.onLine?.(line); });
      child.stderr.on('data', text => { err += text; });
      const timer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 20000);
      child.on('error', error => { err += error.message; });
      child.on('close', code => { children.delete(child); clearTimeout(timer); resolve({ code: code ?? -1, out, err }); });
    });
  };
  const deps = {
    ALL_LOCAL: local, process: { env: { MOCK_ROOT: home } }, HF_HUB: '"$HOME/.cache/huggingface/hub"',
    HF_WATCH_PY: raw('HF_WATCH_PY'), HF_PULL_PY: raw('HF_PULL_PY'), HF_IMAGES: 'lmsysorg/sglang',
    run: transport, q: quote, randomBytes, sleep, maskSecrets: String, existsSync,
    downloadTiming: () => ({ ...TIMING, stall }), downloadAdmission: async (host, total) => { admissions.push([host.id, total]); if (admissions.length > rejectAfter) throw new Error('Not enough free disk. Nothing was downloaded.'); },
    cancelCheck: job => { if (job.abort.signal.aborted || job.cancelled) throw Object.assign(new Error('cancelled'), { cancelled: true }); },
    note: (_job, line) => notes.push(line), step() {},
  };
  const code = ['downloadRemote', 'downloadLease', 'downloadResume', 'downloadVersion'].map(fn).join('\n');
  const methods = new Function(...Object.keys(deps), `${code}\nreturn { downloadResume, downloadVersion };`)(...Object.values(deps));
  const controller = new AbortController(), job = { id: '123456abcdef', total: 131072, abort: controller, log: [] }, host = { id: 'spark3' };
  const launches = () => existsSync(join(home, 'attempts.jsonl')) ? readFileSync(join(home, 'attempts.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
  t.after(async () => {
    controller.abort();
    for (const child of children) { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }
    const root = join(home, '.cache/huggingface/hub/.spark-console-downloads');
    if (existsSync(root)) for (const token of readdirSync(root).filter(n => /^[0-9a-f]{32}$/.test(n))) for (const n of readdirSync(join(root, token)).filter(n => /^\d$/.test(n))) {
      try { const s = JSON.parse(readFileSync(join(root, token, n, 'status'), 'utf8')); if (s.pid) process.kill(-s.pid, 'SIGKILL'); } catch {}
    }
    try { const d = JSON.parse(readFileSync(join(home, 'daemon.json'), 'utf8')); if (d.pid) process.kill(-d.pid, 'SIGKILL'); } catch {}
    await sleep(100);
    rmSync(home, { recursive: true, force: true });
  });
  return { home, env, job, host, notes, admissions, commands, launches, controller,
    start: () => methods.downloadResume(job, 'fixture/Resume', host, `hf download fixture/Resume`),
    image: () => methods.downloadVersion(job, 'fixture/Resume', host) };
}

test('the real production ten-minute limit ignores stand-in environment overrides', () => {
  const options = { SPARK_CONSOLE_DOWNLOAD_STALL_MS: '1', SPARK_CONSOLE_DOWNLOAD_POLL_MS: '1', SPARK_CONSOLE_DOWNLOAD_LEASE_MS: '1', SPARK_CONSOLE_DOWNLOAD_BEAT_MS: '1' };
  const timing = new Function('ALL_LOCAL', 'process', `${fn('downloadTiming')}\nreturn downloadTiming;`)(false, { env: options });
  assert.deepEqual(timing(), { stall: 600, poll: 4, lease: 45, beat: 5000 });
});

test('a stalled HTTP transfer continues at its kept Range offset, preserving Xet performance/cache and checking admission again', LINUX, async t => {
  const f = await fixture(t), data = Buffer.alloc(131072, 37), requests = [];
  const server = http.createServer((req, res) => {
    const offset = Number(/^bytes=(\d+)-$/.exec(req.headers.range || '')?.[1] || 0); requests.push(offset);
    res.writeHead(offset ? 206 : 200, { 'content-length': data.length-offset, ...(offset ? { 'content-range': `bytes ${offset}-${data.length-1}/${data.length}` } : {}) });
    if (!offset && requests.length === 1) res.write(data.subarray(0, 65536)); else res.end(data.subarray(offset));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  f.env.TRANSFER_URL = `http://127.0.0.1:${server.address().port}/data`;
  assert.equal((await f.start()).code, 0);
  assert.deepEqual(requests, [0, 65536], 'the second connection uses a real Range request instead of redownloading its prefix');
  assert.deepEqual(readFileSync(join(f.home, '.cache/huggingface/hub/models--fixture--Resume/blobs/payload.incomplete')), data);
  assert.equal(f.admissions.length, 2);
  assert.equal(f.notes.filter(n => /Trying to continue/.test(n)).length, 1);
  assert.deepEqual(f.launches().map(x => x.offset), requests);
  assert.ok(f.launches().every(x => x.fast === '1' && x.privateBlobs === '1'));
  assert.equal(f.launches()[0].xet, f.launches()[1].xet);
  assert.equal(f.launches()[1].hadChunk, true, 'job Xet data survived the resume');
  assert.equal(readFileSync(join(f.home, '.cache/huggingface/xet/preexisting'), 'utf8'), 'owner cache remains');
});

for (const mode of ['xet', 'preallocated']) test(`${mode} payload writes keep a slow transfer alive without a retry`, LINUX, async t => {
  const f = await fixture(t, { mode, stall: .4 });
  assert.equal((await f.start()).code, 0);
  assert.equal(f.launches().length, 1);
  assert.equal(f.admissions.length, 1);
  assert.equal(f.notes.filter(n => /Trying to continue/.test(n)).length, 0);
});

test('stdout, lock and log chatter cannot prevent exhaustion after exactly three resumes, and native descendants stop', LINUX, async t => {
  const f = await fixture(t, { mode: 'chatter', stall: .4 });
  await assert.rejects(f.start(), /after three tries/);
  assert.equal(f.launches().length, 4);
  assert.equal(f.admissions.length, 4);
  assert.equal(f.notes.filter(n => /Trying to continue/.test(n)).length, 3);
  const heartbeat = join(f.home, 'descendant-heartbeat'), before = readFileSync(heartbeat, 'utf8');
  await sleep(200);
  assert.equal(readFileSync(heartbeat, 'utf8'), before, 'the last native descendant was stopped too');
});

test('cancelling an active native transfer stops it without resuming', LINUX, async t => {
  const f = await fixture(t, { mode: 'quiet' }), running = f.start(); running.catch(() => {});
  await waitFor(() => f.launches().length === 1, { timeout: 10000, every: 20, what: 'the native download to start' });
  f.controller.abort();
  await assert.rejects(running, /cancelled/);
  assert.equal(f.launches().length, 1);
  assert.equal(f.admissions.length, 1);
  assert.equal(f.notes.length, 0);
});

test('loss of lease renewals stops even a quiet transfer and never grants a retry', LINUX, async t => {
  const f = await fixture(t, { mode: 'quiet', stall: 10, failLease: true });
  await assert.rejects(f.start(), /connection or time limit/);
  assert.equal(f.launches().length, 1);
  assert.equal(f.notes.length, 0);
});

for (const failure of ['stop', 'inspect']) test(`an image downloader with unconfirmed Docker ${failure} is held without a second attempt`, LINUX, async t => {
  const f = await fixture(t, { mode: 'quiet', local: false, stall: .4 });
  writeFileSync(join(f.home, `${failure}-fails`), '');
  await assert.rejects(f.image(), /could not be confirmed stopped/);
  assert.equal(f.launches().length, 1);
  assert.equal(f.admissions.length, 1);
  assert.equal(f.notes.filter(n => /Trying to continue/.test(n)).length, 0);
  assert.ok(existsSync(join(f.home, 'daemon.json')), 'uncertain daemon state is retained for diagnosis');
});


test('a fresh disk refusal before a resume acknowledges the earlier partial download', LINUX, async t => {
  const f = await fixture(t, { mode: 'chatter', stall: .4, rejectAfter: 1 });
  await assert.rejects(f.start(), error => {
    assert.match(error.message, /not resumed/);
    assert.match(error.message, /partial model files were kept/);
    assert.doesNotMatch(error.message, /Nothing was downloaded/);
    return true;
  });
  assert.equal(f.admissions.length, 2);
  assert.equal(f.launches().length, 1, 'the refused second admission launches no downloader');
});


for (const failure of ['marker', 'cid']) test(`the actual production image command refuses a failed ${failure} record before daemon work starts`, LINUX, async t => {
  const f = await fixture(t, { mode: 'quiet', local: false, stall: .4 });
  writeFileSync(join(f.home, `${failure}-persistence-fails`), '');
  // f.image invokes the real extracted downloadVersion, including its production inImage command builder.
  await assert.rejects(f.image(), /could not be confirmed stopped/);
  const calls = readFileSync(join(f.home, 'docker-calls'), 'utf8').trim().split('\n');
  assert.ok(calls.includes('images'), 'the real image selection branch was reached');
  assert.equal(calls.includes('create'), failure === 'cid', 'a missing attempt mark must prevent create');
  assert.equal(calls.includes('start'), false, 'a missing persisted CID must prevent start');
  assert.equal(f.launches().length, 0, 'no HF daemon process was started');
  assert.equal(f.admissions.length, 1, 'uncertain persistence never grants a second attempt');
});

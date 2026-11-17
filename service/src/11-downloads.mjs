/* ───────── Hugging Face model downloads and bounded stall recovery ───────── */
// Area: knowledge        Rules: R1, R2, R10, R16, R22, R27        Tests: download-admission.test.mjs, download-stall.test.mjs
// Owns: none
// Timers: none        Wakes: none
// The transfer itself renews its lease every 5 seconds; no background interval is registered.
// Engine images that carry the Hugging Face library, and the download run with it (see downloadVersion).
const HF_IMAGES = 'lmsysorg/sglang|vllm/vllm-openai|nvcr\\.io/nvidia/vllm|nvcr\\.io/nvidia/sglang|eugr/spark-vllm[^ ]*';
const HF_PULL_PY = String.raw`
import json, sys
from huggingface_hub import snapshot_download
repo, allow, ignore = sys.argv[1], json.loads(sys.argv[2]), json.loads(sys.argv[3])
snapshot_download(repo, allow_patterns=allow or None, ignore_patterns=ignore or None, max_workers=16)
print('downloaded', repo, flush=True)
`;
// Remote-owned attempt identity and lease: loss of the console stops this attempt before another may start.
// Control and Xet scratch use the admitted Hub filesystem; only this request's resumes reuse that scratch.
const HF_WATCH_PY = String.raw`
import json, os, re, shutil, signal, stat, subprocess, sys, time
from pathlib import Path
verb, hub, raw = sys.argv[1:4]
cfg = json.loads(raw)
token, attempt = cfg['token'], cfg.get('attempt', 0)
if not re.fullmatch('[0-9a-f]{32}', token) or not isinstance(attempt, int) or not 0 <= attempt <= 3:
    sys.exit(2)
root = Path(hub)/'.spark-console-downloads'/token
at = root/str(attempt)
def read_status():
    try: return json.loads((at/'status').read_text())
    except (OSError, ValueError): return {'state': 'unknown', 'safe': False}
if verb != 'run':
    if verb == 'cancel':
        root.parent.mkdir(parents=True, exist_ok=True)
        (root.parent/(token+'.cancel')).touch()
    elif verb == 'beat' and at.is_dir(): (at/'lease').touch()
    if verb == 'clean':
        records = [p for p in root.iterdir() if p.name.isdigit()] if root.is_dir() else []
        if records and all(json.loads((p/'status').read_text()).get('safe') is True for p in records):
            shutil.rmtree(root)
            (root.parent/(token+'.cancel')).unlink(missing_ok=True)
    else: print(json.dumps(read_status()), flush=True)
    sys.exit(0)
if attempt == 0:
    root.parent.mkdir(parents=True, exist_ok=True)
    root.mkdir(mode=0o700)
    (root/'xet').mkdir(mode=0o700)
at.mkdir(mode=0o700)
(at/'lease').touch()
def keep(value):
    tmp = at/'status.tmp'
    tmp.write_text(json.dumps(value))
    tmp.replace(at/'status')
lost = False
interrupted = False
def emit(value):
    global lost
    try: print('SPARK_DOWNLOAD\t'+json.dumps(value), flush=True)
    except (BrokenPipeError, OSError): lost = True
def interrupted_by(*_):
    global interrupted
    interrupted = True
for sig in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP): signal.signal(sig, interrupted_by)
repo = Path(hub)/('models--'+cfg['repo'].replace('/', '--'))
def payload():
    seen, result, size = set(), {}, 0
    for base in (repo/'blobs', repo/'snapshots', root/'xet'):
        if not base.exists(): continue
        for folder, dirs, files in os.walk(base, followlinks=False, onerror=lambda e: (_ for _ in ()).throw(e)):
            dirs[:] = [d for d in dirs if d.lower() not in ('logs', 'log', '.locks', 'locks')]
            for name in files:
                if name.lower().endswith(('.lock', '.log')): continue
                path = Path(folder)/name
                if base == root/'xet' and not any(p in ('chunk_cache', 'chunk-cache', 'shard_cache', 'shard-cache', 'staging') for p in path.parts): continue
                try:
                    real = path.resolve()
                    if not (real.is_relative_to(Path(hub).resolve()) or real.is_relative_to(root/'xet')): continue
                    info = path.stat()
                except FileNotFoundError: continue
                if not stat.S_ISREG(info.st_mode): continue
                key = (info.st_dev, info.st_ino)
                if key in seen: continue
                seen.add(key)
                result[key] = (info.st_size, info.st_mtime_ns)
                if base != root/'xet': size += info.st_size
    return result, size

def proc_stat(pid):
    try:
        words = Path('/proc/'+str(pid)+'/stat').read_text().rsplit(')', 1)[1].split()
        return words[0], int(words[2]), words[19]
    except FileNotFoundError: return None

def group_live():
    # Reap the known leader, and distinguish lingering descendants from an already-dead zombie.
    child.poll()
    try: os.killpg(child.pid, 0)
    except ProcessLookupError: return False
    for p in Path('/proc').iterdir():
        if not p.name.isdigit(): continue
        info = proc_stat(p.name)
        if info and info[1] == child.pid and info[0] != 'Z': return True
    return False

def stop_group():
    try:
        current = proc_stat(child.pid)
        if current and leader and current[2] != leader[2]: return False
        for sig, seconds in ((signal.SIGTERM, 10), (signal.SIGKILL, 5)):
            if not group_live(): return True
            os.killpg(child.pid, sig)
            until = time.monotonic()+seconds
            while time.monotonic() < until:
                if not group_live(): return True
                time.sleep(.1)
        return not group_live()
    except (OSError, ValueError): return False

def docker_info():
    try:
        cid = (at/'cid').read_text().strip()
        if not re.fullmatch('[0-9a-f]{64}', cid): return None
        r = subprocess.run(['docker', 'inspect', '--format', '{{json .}}', cid], capture_output=True, timeout=5)
        if r.returncode: return None
        d = json.loads(r.stdout)
        if d.get('Id') != cid or d.get('Config', {}).get('Labels', {}).get('spark.console.download') != token: return None
        return cid, d.get('State', {}).get('Status')
    except (OSError, ValueError, subprocess.TimeoutExpired): return None

def stop_image():
    if cfg['local'] or not (at/'image').exists(): return True
    info = docker_info()
    if not info: return False
    cid, state = info
    # A pending create/start with no observed running container never grants a second attempt.
    if not image_ran and reason != 'complete': return False
    try:
        if state not in ('exited', 'dead'):
            subprocess.run(['docker', 'stop', '--time', '10', cid], capture_output=True, timeout=15)
        info = docker_info()
        if not info or info[1] not in ('exited', 'dead'): return False
        return subprocess.run(['docker', 'rm', cid], capture_output=True, timeout=5).returncode == 0
    except (OSError, subprocess.TimeoutExpired): return False

child = None
leader = None
image_ran = False
reason, code, safe = 'failed', 1, False
started = last_progress = last_lease = time.monotonic()
lease_stamp = (at/'lease').stat().st_mtime_ns
keep({'state': 'running', 'safe': False})
try:
    previous, size = payload()
    env = dict(os.environ, HF_HUB_CACHE=hub, HF_XET_CACHE=str(root/'xet'), HF_XET_HIGH_PERFORMANCE='1', HF_HUB_DISABLE_SHARED_BLOBS='1',
               SC_HF_TOKEN=token, SC_HF_IMAGE_MARK=str(at/'image'), SC_HF_CID_FILE=str(at/'cid'), SC_HF_CONTAINER='sc-download-'+token+'-'+str(attempt))
    if (root.parent/(token+'.cancel')).exists(): reason, code = 'cancelled', 130
    else:
        child = subprocess.Popen(['bash', '-c', cfg['command']], env=env, start_new_session=True)
        leader = proc_stat(child.pid)
        keep({'state': 'running', 'safe': False, 'pid': child.pid, 'start': leader[2] if leader else None})
        while True:
            now = time.monotonic()
            stamp = (at/'lease').stat().st_mtime_ns
            if stamp != lease_stamp: last_lease, lease_stamp = now, stamp
            if interrupted or lost or (root.parent/(token+'.cancel')).exists(): reason, code = 'cancelled', 130; break
            if now-last_lease >= cfg['lease']: reason, code = 'lease expired', 130; break
            if now-started >= 6*3600-60: reason, code = 'time limit', 124; break
            if child.poll() is not None:
                code = child.returncode
                reason = 'complete' if code == 0 else 'failed'
                break
            current, size = payload()
            if any(value[0] > 0 and (key not in previous or value[0] > previous[key][0] or value[1] > previous[key][1]) for key, value in current.items()): last_progress = now
            previous = current
            emit({'bytes': size})
            if not cfg['local'] and (at/'image').exists():
                info = docker_info()
                image_ran = image_ran or bool(info and info[1] == 'running')
            if now-last_progress >= cfg['stall']: reason, code = 'stalled', 75; break
            time.sleep(cfg['poll'])
except Exception:
    reason, code = 'progress unavailable', 74
finally:
    native_safe = child is None or stop_group()
    image_safe = stop_image()
    safe = native_safe and image_safe
    if not safe: reason, code = 'stop unconfirmed', 74
    value = {'state': reason, 'safe': safe, 'code': code}
    keep(value)
    emit(value)
sys.exit(code if 0 <= code <= 255 else 1)
`;

function downloadTiming() {
  const test = (key, fallback, cap) => ALL_LOCAL && /^[1-9]\d*$/.test(process.env[key] || '') ? Math.min(Number(process.env[key]), cap) : fallback;
  return { stall: test('SPARK_CONSOLE_DOWNLOAD_STALL_MS', 600000, 600000) / 1000,
    poll: test('SPARK_CONSOLE_DOWNLOAD_POLL_MS', 4000, 4000) / 1000,
    lease: test('SPARK_CONSOLE_DOWNLOAD_LEASE_MS', 45000, 45000) / 1000,
    beat: test('SPARK_CONSOLE_DOWNLOAD_BEAT_MS', 5000, 5000) };
}
function downloadRemote(host, verb, cfg, onLine = null) {
  return run(host, `hub=${HF_HUB}; python3 -I -c ${q(HF_WATCH_PY)} ${q(verb)} "$hub" ${q(JSON.stringify(cfg))}`,
    { timeout: verb === 'run' ? 6 * 3600000 : 20000, ...(onLine ? { onLine } : {}) });
}
async function downloadLease(job, host, cfg, ended) {
  while (!ended()) {
    const cancelled = job.abort?.signal.aborted || job.cancelled;
    const r = await downloadRemote(host, cancelled ? 'cancel' : 'beat', { token: cfg.token, attempt: cfg.attempt });
    if (cancelled || r.code) return; // No renewal after a failed connection: the remote lease will stop its own group.
    if (!ended()) await sleep(cfg.beat);
  }
}
async function downloadResume(job, repo, host, command) {
  const token = randomBytes(16).toString('hex'), timing = downloadTiming();
  let safe = false;
  try {
    for (let attempt = 0; attempt <= 3; attempt++) {
      cancelCheck(job);
      try { await downloadAdmission(host, job.total); } // Fresh target/cache-filesystem check on every attempt.
      catch (e) {
        if (attempt) e.message = `${String(e.message || 'The next download attempt was refused.').replace(/\s*Nothing was downloaded\./g, '')} The download was not resumed. Its partial model files were kept.`;
        throw e;
      }
      cancelCheck(job);
      const cfg = { token, attempt, repo, command, local: ALL_LOCAL, ...timing };
      let ended = false, result;
      const running = downloadRemote(host, 'run', cfg, line => {
        if (line.startsWith('SPARK_DOWNLOAD\t')) {
          try { const p = JSON.parse(line.slice(15)); if (Number.isSafeInteger(p.bytes) && p.bytes >= 0) job.progress = { done: p.bytes, total: job.total || null }; } catch {}
        } else job.detail = maskSecrets(line).slice(0, 200);
      });
      safe = false;
      const lease = downloadLease(job, host, cfg, () => ended);
      try { result = await running; } finally { ended = true; await lease; }
      const checked = await downloadRemote(host, 'status', { token, attempt });
      let status;
      try { status = checked.code === 0 ? JSON.parse(checked.out) : null; } catch {}
      safe = status?.safe === true;
      if (!safe) throw new Error(`The download on ${host.id} could not be confirmed stopped. No second copy was started. Its partial files were kept.`);
      cancelCheck(job);
      if (status.state === 'stalled') {
        if (attempt === 3) throw new Error('No saved model data changed for 10 minutes after three tries to continue the download. The partial files were kept; ask again to continue later.');
        note(job, `No saved model data changed for 10 minutes. Trying to continue from its kept files (${attempt + 1} of 3).`);
        continue;
      }
      if (status.state === 'complete' || status.state === 'failed') return { ...result, code: status.code };
      throw new Error(status.state === 'progress unavailable' ? 'The download’s saved data could not be checked, so it was stopped. Its partial files were kept.'
        : 'The download stopped after its connection or time limit ended. Its partial files were kept.');
    }
  } finally {
    if (safe) await downloadRemote(host, 'clean', { token }); // Only job-created scratch; the model cache is never removed.
  }
}

// A version goes into the Spark's Hugging Face cache, where the library and deploys find it. Weights in pickle formats
// and duplicate copies (original/, consolidated) are skipped; safetensors, configs and tokenizers come down. A GGUF
// version downloads only the chosen quantization's files (and its vision projector, if it has one).
async function downloadVersion(job, repo, host, quant = null) {
  let what = `--exclude 'original/*' '*.pth' '*.bin' '*.pt' 'consolidated*'`;
  if (quant) {
    const info = await hfJson(`/api/models/${repo}?blobs=true&expand[]=siblings`, 20000);
    const { quants, mmproj } = dig.ggufFiles(info.siblings);
    const pick = quants.find(x => x.file === quant);
    if (!pick) throw new Error(`${repo} has no ${quant} files any more.`);
    const selected = [...pick.files, ...(mmproj ? [mmproj] : [])];
    const sizes = selected.map(name => { const f = info.siblings.find(f => f.rfilename === name); return f?.size ?? f?.lfs?.size; });
    if (sizes.some(n => !Number.isSafeInteger(n) || n <= 0)) throw new HttpError(409, 'The size of every selected model file must be known before downloading.');
    what = selected.map(q).join(' ');
    job.total = Math.max(Number.isSafeInteger(job.total) && job.total > 0 ? job.total : 0, sizes.reduce((a, b) => a + b, 0));
  }
  step(job, `Downloading ${repo}${quant ? ` (${quant})` : ''} to ${host.id}`);
  // Without the hf command on the Spark, the Hugging Face library inside an engine image already there does it (they
  // all carry it; the models already on Spark 3 and 4 came down that way). It runs as the owner where the cache is
  // theirs, so the files stay theirs (2026-11-11: neither Spark had the command, and GLM-5.3-Flash couldn't download).
  // Model data and the existing sign-in token stay in their cache. Xet gets this download's own mounted scratch,
  // retained across attempts; HOME/logs stay writable in /tmp. No global HF settings or older caches are changed.
  const allow = quant ? what.split(' ').map(x => x.replace(/^'|'$/g, '')) : [], ignore = quant ? [] : ['original/*', '*.pth', '*.bin', '*.pt', 'consolidated*'];
  const hostCli = !(ALL_LOCAL && existsSync(`${process.env.MOCK_ROOT}/${host.id}/.mock/no-hf`));
  const inImage = `img=$(docker images --format '{{.Repository}} {{.ID}}' 2>/dev/null | grep -E ${q(`^(${HF_IMAGES}) `)} | head -1)
if [ -z "$img" ]; then echo "NO_HF_CLI"; exit 3; fi
echo "HF_IN_IMAGE \${img% *}"
hub=${HF_HUB}; tok="\${HF_HOME:-$HOME/.cache/huggingface}/token"; mkdir -p "$hub" 2>/dev/null
set -- -v "$hub":/hf/hub; [ -f "$tok" ] && set -- "$@" -v "$tok":/hf/token:ro -e HF_TOKEN_PATH=/hf/token; [ -w "$hub" ] && { [ ! -e "$hub/.locks" ] || [ -w "$hub/.locks" ]; } && set -- "$@" --user "$(id -u):$(id -g)"
# Each attempt has an exact container identity; the Xet cache survives attempts in this download's own scratch.
: >"$SC_HF_IMAGE_MARK" || exit 3
set -- --network host -e HOME=/tmp -e HF_HOME=/tmp/hf -e HF_HUB_CACHE=/hf/hub -e HF_XET_HIGH_PERFORMANCE=1 -e HF_HUB_DISABLE_SHARED_BLOBS=1 -e HF_XET_CACHE=/hf/xet -v "$HF_XET_CACHE":/hf/xet "$@" --entrypoint python3 "\${img#* }" -c ${q(HF_PULL_PY)} ${q(repo)} ${q(JSON.stringify(allow))} ${q(JSON.stringify(ignore))}
${ALL_LOCAL ? 'docker run --rm "$@"' : `cid=$(docker create --name "$SC_HF_CONTAINER" --label spark.console.download="$SC_HF_TOKEN" "$@") || exit 3
printf '%s' "$cid" >"$SC_HF_CID_FILE" || exit 3
docker start -a "$cid"`}`;
  // Many files at once, and xet's high-performance mode (more connections per file): the defaults fetched GLM-5.3-Flash
  // at about 17 MB/s on a 500 Mbit/s line (2026-11-11).
  const r = await downloadResume(job, repo, host, hostCli ? `export HF_XET_HIGH_PERFORMANCE=1
if command -v hf >/dev/null 2>&1; then hf download ${q(repo)} ${what} --max-workers 16
elif command -v huggingface-cli >/dev/null 2>&1; then huggingface-cli download ${q(repo)} ${what} --max-workers 16
else
${inImage}
fi` : inImage);
  cancelCheck(job);
  if (r.out.includes('NO_HF_CLI')) throw new Error(`${host.id} has nothing to download with: downloads go through the Hugging Face library inside an engine image (SGLang or vLLM), and there is none on ${host.id} yet. Pull one there (the image a recipe for that engine names), then try again.`);
  const used = /HF_IN_IMAGE (\S+)/.exec(r.out)?.[1];
  if (used && !r.code) note(job, `Downloaded with the Hugging Face library inside ${used} (${host.id} has no hf command)`);
  if (r.code) {
    const why = (r.err || r.out).slice(-1500);
    // A refusal is Hugging Face's answer (401/403, gated), not a traceback's line number (", line 401,").
    throw new Error(/\b(?:401|403)\b(?! in )(?:[^\n]{0,40}(?:Client Error|Unauthorized|Forbidden))|gated repo|is gated|Access to model[^\n]{0,120}is restricted|accept the (?:license|conditions)/i.test(why) ? `Hugging Face refused the download. Accept the model’s license on huggingface.co and sign in on ${host.id} with: hf auth login\n${why}` : why);
  }
  job.progress = null;
}



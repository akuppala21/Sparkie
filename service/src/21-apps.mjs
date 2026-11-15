/* ───────── apps kept running (R38) ───────── */
// Area: features        Rules: R1, R2, R7, R23, R38, R40        Tests: apps.test.mjs
// Owns: none
// Timers: none        Wakes: none
// "Keep Open WebUI on Spark 3 running and give me its link" (A12). An app is any container that isn't a model: Open
// WebUI, a database, a dashboard. keep_running puts one that's already on a Spark on the list of what should be running
// (desired.json, an entry with app: true), restarts or stops one kept that way, or starts a new one from an image the
// owner names: no GPU, a memory cap, named volumes only, its port opened on 127.0.0.1 and the Spark's tailnet address
// only, labelled spark.app=1 (never spark.console=1, so no model start ever counts it as one of its own). Self-healing
// brings a kept app back after it crashes, or after its Spark is powered off and on (healApp). Never on Sparkie's Spark,
// never a model (start_model, stop_model and restart_model and their rails are for those), never a protected container.
// It is not a workflow: no lock entry and no validation run.
// Any workload (A13): with gpu it has its Spark's GPU (one GPU thing per Spark: nothing else may use the GPU there, and
// a model start asks before it stops it, 05-library.mjs plan); with command, the words it runs in its image; with once,
// a job: it runs to its end and isn't kept, reads the shared folder at /in and writes into jobs/<name> there at /out, and
// the watcher tells the chat that started it when it ends (jobEnded). A stack is a saved workflow of these steps.
const APP_ANSWER_MS = Number(process.env.SPARK_CONSOLE_APP_ANSWER_MS || 180000);
const APP_MEMORY_GB = 4;
// A setting holds a secret when a whole word of its name says so (HF_TOKEN, WEBUI_SECRET_KEY, DB_PASS, MYSQL_PWD,
// apiKey, PGPASSWORD), not when a longer word holds one (OAUTH, TOKENIZERS, MAX_TOKENS). AUTH alone is an ordinary word
// (WEBUI_AUTH=False, POSTGRES_HOST_AUTH_METHOD=trust); AUTH_TOKEN counts by its TOKEN. (20-mcp.mjs's SECRET_NAME is for
// result fields.)
const APP_SECRET_WORDS = new Set(['KEY', 'KEYS', 'APIKEY', 'TOKEN', 'SECRET', 'SECRETS', 'PASSWORD', 'PASSWD', 'PASS', 'PWD', 'CREDENTIAL', 'CREDENTIALS']);
const appSecretName = n => /PASSW(?:OR)?D/i.test(n) || String(n).replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase().split(/_+/).some(w => APP_SECRET_WORDS.has(w));
// A model engine's image: the engines in service/config.json and the known serving images (the watcher's MODEL_IMAGES).
const imageRepo = s => String(s || '').split('@')[0].replace(/:[^/:]*$/, '').toLowerCase();
const appModelImage = image => MODEL_IMAGES.test(String(image || '')) || Object.values(CONFIG.images || {}).some(i => imageRepo(i) === imageRepo(image));

// Whether something answers HTTP at host:port: any reply counts (a login page, a redirect, an error page). Never
// rejects (a port out of range is "no"), and keeps no body.
function appAnswers(host, port, timeout = 4000) {
  return new Promise(resolve => {
    try {
      const req = http.get({ host, port, path: '/', timeout, agent: false }, res => { res.resume(); resolve(true); });
      req.on('timeout', () => { req.destroy(); resolve(false); });
      req.on('error', e => resolve(String(e.code || '').startsWith('HPE_')));
    } catch { resolve(false); }
  });
}
// Every container's name and state on one Spark, for the apps on the list there (should_be_running, self-healing):
// read only where apps are kept, and shared for 15 s (emptied when an operation ends). null when Docker didn't answer.
// (Not part of inventory: that runs inside every start.)
const appStates = node => recent(`containers:${node.id}`, 15000, async () => {
  const r = await run(node, `docker ps -a --format 'ctr\t{{.Names}}\t{{.State}}' 2>/dev/null && echo listed`, { timeout: 20000 });
  return r.code === 0 && /^listed$/m.test(r.out) ? fields(r.out, 'ctr').map(([name, state]) => ({ name, state })) : null;
});
// One fresh look at a container on its Spark before any change: one `docker inspect` of exactly that name. Docker also
// takes the start of another container's id for a name, so only the one really called this counts; anything else is
// missing. Its state, labels (protect, app, model), image, memory cap, settings, named volumes, and the ports it
// publishes (Docker keeps those for a stopped container; `docker port` answers only while it runs): the first where your
// other devices reach it (0.0.0.0, :: or the Spark's tailnet address), and the first anywhere else. Docker that didn't
// answer is never taken for a container that's gone.
async function appLook(node, container, tsip) {
  const r = await run(node, `printf 'inspect\\t%s\\n' "$(docker inspect ${q(container)} 2>/dev/null | head -c 300000 | base64 | tr -d '\\n')"
docker ps --filter label=spark.gpu=1 --format 'gpuapp\t{{.Names}}' 2>/dev/null
echo looked`, { timeout: 20000 });
  const list = r.code === 0 && /^looked$/m.test(r.out) ? b64json((fields(r.out, 'inspect')[0] || [''])[0]) : null;
  if (!Array.isArray(list)) throw new HttpError(409, `Docker on ${sparkName(node)} didn’t answer just now, so nothing was changed. Try again.`);
  // (the other GPU apps and jobs running there: one GPU thing per Spark, A13)
  const gpuOthers = fields(r.out, 'gpuapp').map(([n]) => n).filter(n => n && n !== container);
  const c = list[0];
  if (!c || c.Name !== `/${container}`) return { state: 'missing', protect: '', ports: [], opens: [], open: null, closed: null, gpu: false, job: false, cmd: [], gpuOthers };
  const cfg = c.Config || {}, host = c.HostConfig || {}, labels = cfg.Labels || {};
  const ports = Object.entries(host.PortBindings || {}).flatMap(([p, binds]) => (binds || []).map(b => ({ inside: parseInt(p, 10), ip: String(b.HostIp || '0.0.0.0').replace(/^\[|\]$/g, ''), port: Number(b.HostPort) })))
    .filter(b => b.port > 0);
  const reach = p => ['0.0.0.0', '::', tsip].includes(p.ip), opens = ports.filter(reach);
  const job = labels['spark.job'] === '1';
  return { state: String(c.State?.Status || 'missing'), protect: String(labels['spark.protect'] || ''), app: labels['spark.app'] === '1', model: labels['spark.console'] != null,
    image: String(cfg.Image || ''), capGB: Math.ceil((Number(host.Memory) || 0) / 2 ** 30), env: (cfg.Env || []).map(String),
    // (a job's two mounts of the shared folder are Spark Console's own, not volumes the owner named)
    volumes: (host.Binds || []).map(String).filter(b => !(job && JOB_MOUNT.test(b))),
    gpu: labels['spark.gpu'] === '1', job, cmd: Array.isArray(cfg.Cmd) ? cfg.Cmd.map(String) : [], gpuOthers,
    ports, opens, open: opens[0] || null, closed: ports.find(p => !reach(p)) || null };
}
// What a container that's there was made with, against what was asked: a container keeps its image, ports, volumes and
// settings, so any that differ are said, never quietly dropped. (Setting values aren't repeated: only their names.)
function appDiffers(look, input) {
  const out = [];
  if (input.image && input.image !== look.image) out.push(`its image is ${look.image || 'unknown'}, not ${input.image}`);
  if (input.port && look.ports.length) {
    const [h, i] = input.port.split(':').map(Number);
    if (!look.ports.some(b => b.port === h && (!input.port.includes(':') || b.inside === i))) out.push(`its port is ${[...new Set(look.ports.map(b => `${b.port}:${b.inside}`))].join(', ')}, not ${input.port}`);
  }
  const vols = input.volumes ?? (input.image ? [] : null);
  if (vols && [...vols].sort().join(',') !== [...look.volumes].sort().join(',')) out.push(`its volumes are ${look.volumes.join(', ') || 'none'}, not ${vols.join(', ') || 'none'}`);
  const env = (input.env || []).filter(e => !look.env.includes(e));
  if (env.length) out.push(`its settings don’t have ${env.map(e => e.split('=')[0]).join(', ')} as asked`);
  // (with an image named, gpu and once not said mean without; a command is compared only when one is said: Docker gives
  // the image's own command for one made without)
  const gpu = input.gpu ?? (input.image ? false : null), once = input.once ?? (input.image ? false : null);
  if (gpu !== null && gpu !== look.gpu) out.push(look.gpu ? 'it uses the GPU' : 'it doesn’t use the GPU');
  if (once !== null && once !== look.job) out.push(look.job ? 'it’s a job that runs once' : 'it isn’t a job that runs once');
  if (input.command && JSON.stringify(input.command) !== JSON.stringify(look.cmd)) out.push(`its command is ${look.cmd.length ? commandWords(look.cmd).join(' ') : 'its image’s own'}, not ${commandWords(input.command).join(' ')}`);
  return out;
}
// A command's words as they may be shown: each masked (a key shape), and the value after a secret-named flag hidden
// unless it says there is none (code-server's --auth none). A command whose words this changes isn't run (R7).
const NO_SECRET = /^(?:none|false|off|no|disabled)$/i;
const commandWords = cmd => (cmd || []).map((w, i) => (i > 0 && SECRET_FLAG.test(cmd[i - 1]) && !NO_SECRET.test(w) ? '[hidden]' : maskSecrets(w)));
// A dev box runs with no password, by the owner's choice (2026-11-12). A known one kept (not a job) with no command gets
// its image's own no-sign-in words (appCommand): a Jupyter Docker Stacks notebook image start-notebook.py with an empty
// token and password, code-server --auth none. Its answer and button say who can use it only when its command carries
// such words (devBox), never from the image name alone: a Jupyter run with a command of its own that keeps its token
// isn't one.
const DEV_BOX_COMMANDS = [[/^(?:docker\.io\/|quay\.io\/)?jupyter\/[a-z0-9._-]+-notebook$/, ['start-notebook.py', '--IdentityProvider.token=', '--ServerApp.password=']],
  [/^(?:docker\.io\/)?codercom\/code-server$/, ['--auth', 'none']]];
const appCommand = a => (a.command?.length || a.once ? a.command || [] : DEV_BOX_COMMANDS.find(([re]) => re.test(imageRepo(a.image)))?.[1] || []);
const JUPYTER_SIGN_IN = /^--(?:ServerApp|NotebookApp|IdentityProvider)\.(token|password)=(.*)$/;
const devBox = a => {
  const cmd = appCommand(a), jupyter = cmd.map(w => JUPYTER_SIGN_IN.exec(w)).filter(Boolean);
  return cmd.some((w, i) => w === '--auth=none' || (w === '--auth' && cmd[i + 1] === 'none'))
    || (jupyter.some(([, k, v]) => k === 'token' && !v) && !jupyter.some(([, , v]) => v));
};
// (no colon after “password”: masking would hide the words after it as if they were one)
const DEV_BOX_WORDS = 'It has no password, so anyone on your tailnet, or you signed in anywhere through the app door, can use it.';
// A job's two mounts of the shared folder (appRunCommand), told apart from the owner's own volumes.
const JOB_MOUNT = /\/\.local\/share\/spark-portal\/workspaces\/shared(?:\/jobs\/[A-Za-z0-9_.-]+)?:\/(?:in:ro|out)$/;
// The 8 GB rule (R2) for an app: its memory figure has to fit in what's free beyond it, and unreadable memory refuses.
async function appRoom(node, gb, container) {
  const m = await memNow(node);
  if (!m) throw new HttpError(409, `Free memory on ${sparkName(node)} can’t be read right now, so nothing was started (it could freeze the Spark).`);
  const room = m.available - KEEP_FREE;
  if (room < gb * 2 ** 30) {
    throw new HttpError(409, `${sparkName(node)} doesn’t have room for ${container} now: it may use up to ${gb} GB, and ${Math.max(0, Math.floor(room / 2 ** 30))} GB is free beyond the 8 GB kept for the system. Nothing was started. Stop a model there, pick another Spark, or say a smaller memory figure.`);
  }
}
// A new app's docker run: every word quoted, nothing from the owner but the name, image, port, named volumes, settings,
// and (A13) the GPU and the words it runs. No host folder or network, not privileged, no entrypoint, no Docker restart
// policy (Spark Console brings it back itself). With gpu: the GPU, labelled spark.gpu=1. A job (once): spark.job=1, the
// chat it was asked in, the shared folder read-only at /in and its own folder there at /out (jobDir: fixed text and the
// checked name, outside the quotes so $HOME is the Spark's), and a port only when one was given.
const jobDir = name => `"$HOME/.local/share/spark-portal/workspaces/shared/jobs/${name}"`;
function appRunCommand(a, tsip, chat = null) {
  const [host, inside = host] = String(a.port || '').split(':');
  const ports = a.port ? [`127.0.0.1:${host}:${inside}`, ...(tsip && tsip !== '127.0.0.1' ? [`${tsip}:${host}:${inside}`] : [])] : [];
  const shared = '"$HOME/.local/share/spark-portal/workspaces/shared"';
  return [
    ...['docker', 'run', '-d', '--name', a.container, '--label', 'spark.app=1'].map(q),
    ...(a.gpu ? ['--label', 'spark.gpu=1', '--gpus', 'all', '--shm-size', '2g'].map(q) : []),
    ...(a.once ? [...['--label', 'spark.job=1', ...(/^sc_[0-9a-f]{16}$/.test(String(chat || '')) ? ['--label', `spark.chat=${chat}`] : [])].map(q),
      '-v', `${shared}:/in:ro`, '-v', `${jobDir(a.container)}:/out`, '-w', '/out'] : []),
    ...['--restart', 'no', '--memory', `${a.memoryGB}g`, '--log-opt', 'max-size=50m', '--log-opt', 'max-file=3', ...ports.flatMap(p => ['-p', p]),
      ...a.volumes.flatMap(v => ['-v', v]), ...a.env.flatMap(e => ['-e', e]), a.image, ...(a.command || [])].map(q),
  ].join(' ');
}
// One GPU thing per Spark (A13, the owner's decision): a GPU app or job starts only where no model, model server or
// other GPU app runs. It never stops anything to make room.
function gpuAlone(sp, look, at) {
  const busy = [...new Set([...sp.deployments.filter(d => d.state === 'running' && d.role !== 'main').map(d => d.container), ...sp.external.map(e => e.container), ...look.gpuOthers])];
  if (busy.length) throw new HttpError(409, `${at} runs ${busy.join(', ')} now. A GPU app or job has a Spark’s GPU to itself. Stop that first, or pick another Spark.`);
}
// A job's own folder in the shared folder (jobs/<name>), made as the owner's user (owner-only, as the worker makes its
// folders), so Docker never makes it as root: one fixed mkdir -p of the path appRunCommand mounts. Never through the
// worker: its 64 MiB and 1,000-entry limit counts the shared folder's every file, jobs' outputs too, and would stop
// every job on that Spark after one sizeable one.
async function jobFolder(node, name) {
  // (checked before it is made too, so nothing is made through a link)
  const r = await run(node, `${jobMountsReal(name)}; umask 077; d=${jobDir(name)}; { [ -e "$d" ] || [ -L "$d" ] || mkdir -p -- "$d"; } || exit 1; ${jobMountsReal(name)}`, { timeout: 20000 });
  if (r.code === JOB_NOT_REAL) throw jobNotReal(node, name, r);
  if (r.code) throw new Error(`The job’s folder jobs/${name} couldn’t be made in the shared folder on ${sparkName(node)}: ${maskSecrets(r.err || r.out).trim().slice(0, 300)}`);
}
// A job's two mounts must be the real folders at their fixed places. The shared folder is one a walled change may write
// in (R42): it could swap jobs/<name> for a link to the home, and Docker follows a link, so the job would get the home
// writable at /out. Shell text, run after the folder is made and again in the same command just before docker run or
// docker start: the shared folder, its jobs folder and jobs/<name>, each when there, must be a folder that is not a link
// and whose real path is the real home's plus its fixed path; else it names which and ends JOB_NOT_REAL, and nothing
// starts. (Left open: a link planted in the moment between this check and Docker's own look at the path.)
const SHARED_AT = '.local/share/spark-portal/workspaces/shared', JOB_NOT_REAL = 97;
const jobMountsReal = name => `h=$(realpath -e -- "$HOME") || exit ${JOB_NOT_REAL}; for p in ${[SHARED_AT, `${SHARED_AT}/jobs`, `${SHARED_AT}/jobs/${name}`].map(q).join(' ')}; do `
  + `d="$HOME/$p"; [ -e "$d" ] || [ -L "$d" ] || continue; { [ -d "$d" ] && [ ! -L "$d" ] && [ "$(realpath -e -- "$d")" = "$h/$p" ]; } `
  + `|| { echo "not real: $p"; exit ${JOB_NOT_REAL}; }; done`;
function jobNotReal(node, name, r) {
  const p = /not real: (\S+)/.exec(r.out || '')?.[1] || '';
  const what = p === SHARED_AT ? 'The shared folder' : p === `${SHARED_AT}/jobs` ? 'The jobs folder in the shared folder' : `The job’s folder jobs/${name} in the shared folder`;
  return new Error(`${what} on ${sparkName(node)} isn’t a real folder: it is a link, or inside one. Docker would follow it, so ${name} wasn’t started. Make it a real folder there, then ask again.`);
}
// A job's end, told once (the watcher, 19-watcher.mjs): one line built from its name, how it ended and when, never its
// log. A notice on the record; in the chat it was asked in, when that is one of the owner's (and on Telegram when that
// chat is Telegram's).
function jobEnded(node, w) {
  const name = String(w.name || '');
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$/.test(name)) return;
  const at = sparkName(node), code = Number.isInteger(w.exitCode) ? w.exitCode : null;
  const how = consoleStopped.has(`${node.id}/${name}`) ? 'was stopped' : w.oomKilled ? 'ran out of memory' : code === 0 ? 'finished'
    : code === 255 ? 'stopped when its Spark lost power' : [137, 143].includes(code) ? 'was stopped' : `ended with an error (exit ${code ?? 'unknown'})`;
  const took = Date.parse(w.finishedAt) - Date.parse(w.startedAt), mins = Math.round(took / 60000);
  const text = `${name} on ${at} ${how}${took > 0 ? ` after ${mins >= 1 ? `${mins} minute${mins === 1 ? '' : 's'}` : 'under a minute'}` : ''}. Its files are in jobs/${name} in the shared folder on ${at}, and its log stays with its container (container_logs). It isn’t started again.`;
  fleetEvent({ type: 'notice', spark: node.id, container: name, text });
  const chat = String(w.labels?.['spark.chat'] || '');
  const conv = /^sc_[0-9a-f]{16}$/.test(chat) ? chatData().conversations.find(c => c.id === chat && c.login === accessList().owner) : null;
  if (!conv) return;
  const now = new Date().toISOString();
  conv.messages.push({ role: 'assistant', content: maskSecrets(text), createdAt: now, notice: true });
  conv.updatedAt = now;
  saveChats();
  if (conv.channel === 'telegram') tell('result', text).catch(() => {});
}
// Waiting for a job's end (keep_running with once, A13; the self-test's job): one fixed `docker inspect` of exactly that
// container through `run` every JOB_WAIT_MS (10 s), first at once, until it isn't running or `limitMs` has passed. It
// returns how it ended: { state, exitCode, oomKilled, seconds } (state "exited" or "dead"; "created" is a container that
// never ran). It changes nothing: a job still running at the limit is an error that says so (stillRunning), and the
// caller decides whether to stop it. Gone from Docker is an error; so is a minute in which Docker there didn't answer.
// With `job`, cancelling that operation ends the wait at once: the look under way and the sleep between looks.
const JOB_WAIT_MS = Number(process.env.SPARK_CONSOLE_JOB_WAIT_MS || 10000);
async function waitJobEnd(node, container, { limitMs = 30 * 60000, job = null } = {}) {
  const began = Date.now(), at = sparkName(node);
  for (let unanswered = 0; ;) {
    if (job) cancelCheck(job);
    const r = await run(node, `docker inspect -f '{{.State.Status}} {{.State.ExitCode}} {{.State.OOMKilled}}' ${q(container)} 2>/dev/null || { docker ps -q >/dev/null 2>&1 && echo missing; }`, { timeout: 20000, signal: job?.abort?.signal });
    const [state, code, oom] = r.code === 0 ? r.out.trim().split(/\s+/) : [];
    if (state === 'missing') throw new Error(`${container} is gone from ${at}, so how it ended isn’t known.`);
    if (['exited', 'dead', 'created'].includes(state)) {
      return { state, exitCode: /^\d{1,3}$/.test(code || '') ? Number(code) : null, oomKilled: oom === 'true', seconds: Math.round((Date.now() - began) / 1000) };
    }
    unanswered = state ? 0 : unanswered + 1;
    if (unanswered * JOB_WAIT_MS >= 60000 && unanswered >= 3) throw new Error(`${at} didn’t answer for a minute while ${container} was being waited on, so how it ended isn’t known.`);
    if (Date.now() - began >= limitMs) {
      throw Object.assign(new Error(`${container} was still running on ${at} after ${Math.round(limitMs / 60000)} minutes.`), { stillRunning: true });
    }
    await sleepUnless(Math.max(0, Math.min(JOB_WAIT_MS, limitMs - (Date.now() - began))), job?.abort?.signal);
  }
}
// Up means its container is running and stays running: five looks in a row, 3 s apart. Its port only decides whether it
// answers there (any HTTP reply), so whether a link is given: it is waited on to answer until APP_ANSWER_MS, and a
// database or another service that isn't a web page is up all the same. Nothing is stopped for not answering. Returns
// whether it answered.
async function appUp(job, node, container, host, port) {
  step(job, port ? `Checking ${container} keeps running, and answers at port ${port}` : `Checking ${container} keeps running`);
  let running = 0, missed = 0, answers = false;
  for (const until = Date.now() + APP_ANSWER_MS; ;) {
    job.checkPause();
    const r = await run(node, `docker inspect -f '{{.State.Status}}' ${q(container)} 2>/dev/null || echo missing`, { timeout: 20000 });
    const state = r.code === 0 ? r.out.trim() : null;
    if (state && state !== 'running') {
      const logs = await run(node, `docker logs --tail 40 ${q(container)} 2>&1`, { timeout: 20000 });
      throw new Error(`${container} stopped right after starting.\n${maskSecrets(logs.out.trim().split('\n').slice(-40).join('\n'))}`);
    }
    if (state) { missed = 0; running += 1; if (port && !answers) answers = await appAnswers(host, port); }
    else if ((running = 0, ++missed) >= 5) throw new Error(`${sparkName(node)} didn’t answer while ${container} was being checked, so it isn’t known whether it runs. should_be_running shows how it is now.`);
    if (running >= 5 && (answers || !port || Date.now() > until)) return answers;
    await sleep(3000);
  }
}
// What a start says when it's up: its link when it answers there (with the app door on, its door link first, R40); else
// that it runs, and why there's no link.
function appDone(j, container, link, answers, port) {
  if (link && answers) {
    const l = appLinks(j.node, container, link);
    Object.assign(j, { endpoint: l.link, ...(l.tailnetLink ? { tailnetLink: l.tailnetLink } : {}) });
    note(j, `It answers at ${linkWords(l)}`);
    return;
  }
  note(j, port ? `${container} is running. It doesn’t answer web requests at port ${port} (yet), so there’s no link to open: a database or another service that isn’t a web page never does.`
    : `${container} is running. No port is known for it, so there’s no link.`);
}
// One that didn't come up is stopped again (and not brought back by itself); its container stays, so its log can be read.
async function appPutBack(job, node, container) {
  consoleStopped.set(`${node.id}/${container}`, Date.now());
  await run(node, `docker stop --time 20 ${q(container)} >/dev/null 2>&1; true`, { timeout: 90000 });
  note(job, 'It didn’t come up, so it was stopped again. Its container is kept, so its log can be read.');
}

// Sparkie's target check for keep_running (R25): the owner's words name the Spark and every word of the container's
// name. For one already on that Spark (with no image), or a restart or stop, that's enough. A new image runs at once
// only when they typed it, the port (when there is one) and each volume, setting and command word, as whole words (never
// pieces of longer ones; the image is checked even when the watcher knows the name); with the GPU, also the word "gpu"
// and its memory figure ("24" or "24gb", A13).
function appNamed(input, saidText) {
  const said = tokensOf(saidText), flat = squash(sparkNames(normQuotes(saidText)));
  const own = [...tokensOf(String(input.container || ''))].filter(t => !/^spark\d+$/.test(t));
  if (!said.has(input.spark) || !own.length || !own.every(t => said.has(t) || flat.includes(t.replace(/\./g, '')))) return false;
  const known = knowledge.workloads[`${input.spark}/${input.container}`];
  if (!input.image) return Boolean((known && known.state !== 'removed') || ['restart', 'stop'].includes(input.do));
  // (words as typed, each also without the quotes, brackets and closing punctuation around it; settings keep their case)
  const typed = new Set(normQuotes(saidText).split(/\s+/).flatMap(w => [w, w.replace(/^["'“”(\[]+|["'“”)\].,;!?]+$/g, '')]));
  const lower = new Set([...typed].map(w => w.toLowerCase()));
  const gpuSaid = !input.gpu || ((lower.has('gpu') || lower.has('gpus')) && input.memoryGB != null && [`${input.memoryGB}`, `${input.memoryGB}gb`].some(v => lower.has(v)));
  return Boolean(input.port || input.once) && gpuSaid && [input.image, ...(input.volumes || [])].every(v => lower.has(String(v).toLowerCase()))
    && [...(input.port ? [input.port] : []), ...(input.env || []), ...(input.command || [])].every(v => typed.has(String(v)));
}

// An app entry on the list, as it is now: running (and, when asked, whether it answers at its link), changing, or held
// and why. `states`: appStates of its Spark (null when Docker there didn't answer).
async function appNow(x, sp, busy, check, states) {
  const c = states?.find(y => y.name === x.container), link = sp?.tsip && x.port ? `http://${sp.tsip}:${x.port}` : null;
  const out = { ...x, kind: 'app', ...appLinks(x.spark, x.container, link) };
  if (sp?.online && c?.state === 'running') return { ...out, state: 'running', ...(check && link ? { answers: await appAnswers(sp.tsip, x.port) } : {}) };
  if (busy.has(x.spark)) return { ...out, state: 'changing' };
  const w = knowledge.workloads?.[keyOf(x)];
  // (a skipped bring-back from before it last ran isn't why it's down now)
  const last = [...events].reverse().find(e => e.spark === x.spark && e.container === x.container && ['heal-skipped', 'started'].includes(e.type));
  const skipped = last?.type === 'heal-skipped' ? last : null;
  const at = sparkName(nodeById(x.spark) || { id: x.spark });
  const why = !sp?.online ? `${at} isn’t reachable`
    : !states ? `Docker on ${at} didn’t answer just now`
      : !c ? 'its container is gone'
      : skipped ? skipped.why
        : Number(w?.exitCode) === 255 ? 'it stopped when the Spark lost power or restarted'
          : 'it isn’t running';
  // (its Spark off, or its Docker not answering: as for a model, whether it runs isn't known and it isn't the owner's to fix)
  return { ...out, state: 'held', why, ...(!sp?.online ? { sparkOff: true } : !states ? { dockerDown: true } : {}) };
}

// Self-healing for a kept app (healPass, every minute): it comes back when it stopped by itself (a crash: an exit code
// other than 0, 137 or 143), or when it stopped within five minutes of its Spark coming back on after being off. A clean
// stop with its Spark on is someone's stop: it stays held, and the owner brings it back or forgets it. At most two
// bring-backs in six hours; never one that ran out of memory or that Spark Console stopped itself.
async function healApp(x, inv) {
  const sp = inv.sparks.find(s => s.id === x.spark), node = nodeById(x.spark), k = keyOf(x);
  if (!sp?.online || !node) return;
  const c = (await appStates(node))?.find(y => y.name === x.container);
  if (!c) return;
  if (c.state === 'running') { skippedOnce.delete(k); return; }
  if (consoleStopped.has(k) && Date.now() - consoleStopped.get(k) < 15 * 60000) return;
  const w = knowledge.workloads[k];
  if (w?.oomKilled) return healSkip(x, 'it ran out of memory, so starting it again would only fail again');
  const back = cameBack(x.spark), last = Math.max(0, ...healCount(`back:${k}`));
  const seen = [...events].reverse().find(e => e.spark === x.spark && e.container === x.container && ['stopped', 'crashed'].includes(e.type));
  const seenAt = Date.parse(seen?.at) || 0;
  const power = Boolean(back && seen) && back.on > last && Date.now() - back.on < HEAL_WINDOW && seenAt >= back.off && seenAt <= back.on + 5 * 60000;
  if (power && Date.now() - back.on < HEAL_SETTLE_MS) return;
  const crashed = Boolean(w) && !w.running && w.exitCode != null && ![0, 137, 143].includes(Number(w.exitCode));
  if (!power && !crashed) return;
  if (healCount(`back:${k}`).length >= 2) return healSkip(x, 'it was brought back twice in the last 6 hours already');
  // (the list read again: the owner may have pressed Forget since this pass began)
  if (!desired().running.some(y => y.app && keyOf(y) === k)) return;
  healMark(`back:${k}`);
  skippedOnce.delete(k);
  const why = power ? `${sparkName(nodeById(x.spark) || { id: x.spark })} came back on` : `it stopped by itself (exit ${w.exitCode})`;
  fleetEvent({ type: 'healing', spark: x.spark, container: x.container, why });
  try {
    const out = await runAction('keep_running', healOwner(), { spark: x.spark, container: x.container },
      { actor: 'Self-healing', via: 'watcher', request: `bring back ${x.container}: ${why}`, canChange: true, trusted: true });
    if (!out?.operation && !['already', 'kept'].includes(out?.outcome)) throw new Error(out?.note || out?.question || out?.outcome || 'it didn’t start');
  } catch (e) {
    skippedOnce.set(k, 'failed');
    fleetEvent({ type: 'heal-skipped', spark: x.spark, container: x.container, why: `bringing it back failed: ${maskSecrets(String(e.message).split('\n')[0].slice(0, 500)).slice(0, 300)}` });
  }
}

action({
  name: 'keep_running', title: 'Keep an app running', kind: 'change', scope: 'fleet:act', who: 'owner', destructive: true, group: 'core',
  description: 'Use when the owner asks to keep an app or service that isn’t a model running (Open WebUI, a database, any container), or to restart or stop one kept that way. A container already on that Spark joins the list of what should be running (should_be_running): Spark Console starts it again if it stops by itself or its Spark is powered off and on. With image and port, for one that isn’t there yet, it starts it first, opened on your tailnet only. With gpu true it has the Spark’s GPU to itself (say memoryGB; nothing else may use the GPU there, so it starts only where no model runs). With command, the words it runs in the image. With once true it’s a job: it runs to its end (a script, a fine-tune; no port needed), isn’t kept running, reads the shared folder at /in, writes its files to jobs/<container> there (at /out), and Spark Console posts in this chat when it ends. A Jupyter (jupyter/…-notebook) or code-server (codercom/code-server) image given no command runs with no password: Spark Console adds the words start-notebook.py --IdentityProvider.token= --ServerApp.password= (Jupyter) or --auth none (code-server), and anyone on the owner’s tailnet, or the owner signed in anywhere through the app door, can use it; with a command of its own it has no password only when that command has those words. do "restart" restarts it; do "stop" stops it and takes it off the list. It gives the link to open it at and whether it answers (with the app door on, the door’s link first, which the owner opens from anywhere signed in, then the tailnet link). Never on Sparkie’s Spark, never a model (start_model, stop_model and restart_model are for those), never a protected container. Starting a new image, or from an agent running a job again, starting a stopped GPU app or changing a container Spark Console didn’t start, may come back as a question for the owner.',
  input: { type: 'object', properties: {
    spark: { ...sparkArg, description: 'The Spark the app is on, or should run on (never Sparkie’s).' },
    container: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$', description: 'The app’s container name, like open-webui.' },
    do: { type: 'string', enum: ['keep', 'restart', 'stop'], description: 'keep (the default) keeps it running, starting it if it’s stopped; restart restarts it; stop stops it and takes it off the list.' },
    image: { type: 'string', maxLength: 300, pattern: '^[a-z0-9][a-z0-9._/-]{0,200}(:[A-Za-z0-9_][A-Za-z0-9._-]{0,127})?(@sha256:[a-f0-9]{64})?$', description: 'Only to start a new app: the image, as the owner named it, like ghcr.io/open-webui/open-webui:main.' },
    port: { type: 'string', pattern: '^[0-9]{2,5}(:[0-9]{2,5})?$', description: 'Where to open it: "3000:8080" (the Spark’s port 3000 to the app’s 8080), or one number for both.' },
    volumes: { type: 'array', maxItems: 4, items: { type: 'string', maxLength: 260, pattern: '^[a-z0-9][a-z0-9_.-]{0,62}:/[A-Za-z0-9_./-]{1,190}$' }, description: 'Only for a new app: named Docker volumes that keep its data, like "open-webui:/app/backend/data".' },
    env: { type: 'array', maxItems: 12, items: { type: 'string', maxLength: 300, pattern: '^[A-Za-z_][A-Za-z0-9_]{0,63}=[^\\n\\r\\x7f-\\x9f\\u00ad\\u061c\\u180e\\u200b-\\u200f\\u2028-\\u202e\\u2060-\\u2069\\ufeff]{0,230}$' }, description: 'Only for a new app: its settings, as NAME=value. Never keys, tokens or passwords.' },
    memoryGB: { type: 'integer', minimum: 1, maximum: 112, description: 'The most memory it may use, in GB: 4 when not said for a new app. One that’s there with no memory limit of its own needs it to be started. A GPU app or job needs it.' },
    gpu: { type: 'boolean', description: 'Only for a new app or job: it uses the Spark’s GPU. Say memoryGB too.' },
    command: { type: 'array', maxItems: 40, items: { type: 'string', maxLength: 300, pattern: '^[^\\n\\r\\x00-\\x1f\\x7f-\\x9f\\u00ad\\u061c\\u180e\\u200b-\\u200f\\u2028-\\u202e\\u2060-\\u2069\\ufeff]{1,300}$' }, description: 'Only for a new app or job: the words to run in the image, one per item, like ["python3", "/in/train.py", "--epochs", "3"]. Never keys, tokens or passwords.' },
    once: { type: 'boolean', description: 'Only for a new job: it runs to its end and isn’t kept running; its files go to jobs/<container> in the shared folder. No port needed.' },
  }, required: ['spark', 'container'], additionalProperties: false },
  run: async (input, viewer, ctx) => {
    const { spark, container } = input, verb = input.do || 'keep', key = `${spark}/${container}`;
    if (verb !== 'keep' && ['image', 'port', 'volumes', 'env', 'memoryGB', 'gpu', 'command', 'once'].some(k => input[k] !== undefined)) throw new HttpError(400, 'With do restart or stop, give only spark and container.');
    notBrainsSpark([spark]);
    if (input.port !== undefined && input.port.split(':').map(Number).some(n => n < 1 || n > 65535)) throw new HttpError(400, 'A port is a number from 1 to 65535, like "3000:8080".');
    const node = sparkOf(viewer, spark), at = sparkName(node);
    mustUse(viewer);
    // A Spark Spark Console powered off (21-power.mjs) is turned on first, in the same operation; a stop of an app there
    // only takes it off the list (below: its Spark is off).
    if (verb !== 'stop' && !ctx.poweredOn) { const first = powerThenKeep(viewer, ctx, input); if (first) return first; }
    const inv = await inventory(null), sp = inv.sparks.find(s => s.id === spark);
    const entry = desired().running.find(x => x.app && keyOf(x) === key), next = id => `wait_operation {"id":"${id}"}`;
    if (!sp?.online) {
      // A stop while its Spark has been off a while takes it off the list (nothing runs there to stop), so it isn't
      // started again when the Spark comes back on. (One missed look keeps the refusal.)
      const s = knowledge.sparks[spark];
      if (verb === 'stop' && entry && s?.online === false && Date.now() - (Date.parse(s.lastSeenAt) || 0) >= HEAL_OFFLINE_MS
        && forgetApp({ spark, container }, ctx.actor || viewer.login, ctx.conv || ctx.chat || null)) {
        return { outcome: 'forgotten', spark, container, note: `${at} isn’t reachable, so nothing was stopped there. ${container} is off the list of what should be running, so it isn’t started again when ${at} comes back on.` };
      }
      throw new HttpError(409, `${at} isn’t reachable right now.`);
    }
    if (sp.deployments.some(d => d.container === container)) {
      throw new HttpError(409, `${container} is one of Spark Console’s models. Models are started, stopped and restarted with start_model, stop_model and restart_model, and are already kept running.`);
    }
    const look = await appLook(node, container, sp.tsip), state = look.state, known = knowledge.workloads[key];
    if (isProtected(container, look.protect)) throw new HttpError(403, `${container} is protected.`);
    // A model server, by what it is, not by whether it answers /v1/models right now: Spark Console's model label, a model
    // engine's image, or the watcher's record of it as one. One Spark Console started as an app (spark.app=1) stays an
    // app, whatever it answers.
    if (verb !== 'stop' && state !== 'missing' && !look.app && (look.model || appModelImage(look.image) || sp.external.some(e => e.container === container)
      || (known?.state !== 'removed' && (known?.kind === 'model' || known?.servedModels?.length)))) {
      throw new HttpError(409, `${container} serves models, so it isn’t kept running as an app: memory for a model is checked by start_model.`);
    }
    // (a job is never on the list: one Spark Console started stops all the same, A13)
    if (verb !== 'keep' && !entry && !(verb === 'stop' && look.app && look.job)) throw new HttpError(409, `${container} on ${at} isn’t an app Spark Console keeps running, so there’s nothing to ${verb} here.`);
    // Self-healing brings back only what's still on the list, read again after the look (the owner may have pressed
    // Forget since its pass began).
    if (ctx.via === 'watcher' && !desired().running.some(x => x.app && keyOf(x) === key)) return { outcome: 'already', spark, container, note: `${container} is no longer on the list of what should be running, so it wasn’t started.` };
    // A container that's there keeps the image, ports, volumes and settings it was made with: asked for with others, it
    // is refused and told what differs, never quietly started as it was.
    const differs = state === 'missing' ? [] : appDiffers(look, input);
    if (differs.length) {
      throw new HttpError(409, `There’s already a container called ${container} on ${at}, and ${differs.join('; ')}. A container keeps what it was made with, so nothing was started or changed. To keep that one as it is, ask without the image, port, volumes or settings; for a new app, pick another name.`);
    }
    // Something Spark Console didn't start (no spark.app=1) is the owner's own: from an agent (directly, through Sparkie,
    // or in a saved step) or from Telegram, keeping, starting, restarting or stopping it is the owner's call (8.4).
    const owners = !viewer.agentKey && (['page', 'api', 'watcher'].includes(ctx.via) || (['sparkie', 'sparkie-undo'].includes(ctx.via) && !ctx.agent && !ctx.channel));
    if (state !== 'missing' && !look.app && !owners && !ctx.ownerConfirmed) {
      const label = changeLabel('keep_running', input);
      return question(viewer, ctx, `${label}? ${container} wasn’t started by Spark Console, so that’s the owner’s call.`,
        [{ label, call: { action: 'keep_running', args: input } }, { label: 'No, leave it', call: null }], 'question', { ownerOnly: true });
    }
    // Where it answers: for one that's there, where Docker publishes it on the tailnet (the port asked, when it's one of
    // those); with no published port at all (host networking), the port asked or kept. For a new one, the port asked.
    const asked = input.port ? Number(input.port.split(':')[0]) : null;
    const hostPort = state === 'missing' ? asked : look.ports.length ? (look.opens.find(b => b.port === asked) || look.open)?.port || null : asked || entry?.port || null;
    // The 8 GB rule's figure: a new app's cap (memoryGB, else 4); one that's there, its own cap, else the owner's figure.
    const gb = state === 'missing' ? input.memoryGB || APP_MEMORY_GB : look.capGB || input.memoryGB || entry?.memoryGB || null;
    const link = sp.tsip && hostPort ? `http://${sp.tsip}:${hostPort}` : null;
    const meta = { node: spark, container, app: true, by: viewer.login, actor: ctx.actor || null, via: ctx.via || null, request: ctx.request ? maskSecrets(String(ctx.request).slice(0, 500)).slice(0, 300) : null };
    // (a recorded port follows what Docker reports)
    const changed = !entry || hostPort !== (entry.port || null) || (input.memoryGB !== undefined && input.memoryGB !== entry.memoryGB);
    const keepIt = () => keepApp({ spark, container, port: hostPort, memoryGB: input.memoryGB || entry?.memoryGB }, ctx.actor || viewer.login, ctx.conv || ctx.chat || null);

    if (verb === 'stop') {
      const job = claimed([spark], `stopping ${container}`, () => newJob('stop', meta));
      runJob(job, async j => {
        pausedCheck(ctx);
        // (one whose container is gone only comes off the list: a name Docker doesn't have is never handed to docker stop)
        if (state !== 'missing') {
          await stopContainer(j, spark, container, viewer);
          await stoppedForSure(j, spark, container);
        }
        if (!j.stoppedHere?.length) j.stoppedHere = [key];
        // (a job that isn't on the list leaves the list as it is)
        if (!entry) j.stoppedHere = [];
      });
      return { outcome: 'started', operation: job.id, stopping: container, spark, note: 'It comes off the list of what should be running, so it stays stopped. Its container and data are kept.', next: next(job.id) };
    }
    if (verb === 'restart' && state === 'missing') throw new HttpError(404, `${container} is on the list, but its container is gone from ${at}. To start it again, say which image to run and the port to open it at.`);
    if (verb === 'restart' && state === 'running') {
      const job = claimed([spark], `restarting ${container}`, () => newJob('restart', { ...meta, port: hostPort }));
      runJob(job, async j => {
        j.checkPause = () => { cancelCheck(j); pausedCheck(ctx); };
        pausedCheck(ctx);
        step(j, `Restarting ${container} on ${at}`);
        const r = await run(node, `docker restart --time 20 ${q(container)}`, { timeout: 90000 });
        if (r.code) throw new Error(`Docker couldn’t restart it: ${maskSecrets(r.err || r.out).slice(0, 400)}`);
        consoleStopped.delete(key);
        appDone(j, container, link, await appUp(j, node, container, sp.tsip, hostPort), hostPort);
      });
      return { outcome: 'started', operation: job.id, restarting: container, spark, ...appLinks(spark, container, link), next: next(job.id) };
    }
    if (state === 'running' && look.job) {
      return { outcome: 'already', spark, container, job: true, note: `${container} on ${at} is running now. It’s a job: it runs to its end and isn’t kept running; Spark Console posts in the chat it was started from when it ends.` };
    }
    if (state === 'running') {
      if (changed) keepIt();
      const answers = link ? await appAnswers(sp.tsip, hostPort) : null;
      const said = !entry ? `${container} on ${at} is now on the list of what should be running: Spark Console starts it again if it stops by itself or ${at} is powered off and on.`
        : changed ? `${container} on ${at} was already kept running; its port and memory figure on the list are updated.`
          : `${container} on ${at} is already kept running; nothing changed.`;
      const links = appLinks(spark, container, link);
      const where = link ? (answers ? ` It answers at ${linkWords(links)}.` : ` Its link is ${linkWords(links)}, but it isn’t answering there right now.`)
        : look.closed ? ` Its port ${look.closed.port} isn’t opened on ${at}’s tailnet address, so it has no link from your other devices.`
          : ' No published port is known for it, so there’s no link: say its port.';
      const room = gb ? '' : ' It has no memory limit of its own, so if it stops, Spark Console can’t check it fits and won’t start it again by itself: keep it again with the most memory it may use (memoryGB) for that.';
      return { outcome: changed ? 'kept' : 'already', spark, container, ...links, answers, note: said + where + room };
    }
    // There but stopped: started again as it is, after the memory check with its own cap (or the owner's figure).
    if (state !== 'missing') {
      // A job run again or a GPU app started again is code that runs on a Spark (its GPU's, for one): from an agent
      // (its own call, its key alone, or through Sparkie), the owner's call, as a new image is.
      if ((look.job || look.gpu) && (ctx.via === 'agent' || viewer.agentKey || ctx.agent) && !ctx.ownerConfirmed) {
        const label = look.job ? `Run ${container} on ${at} again` : changeLabel('keep_running', input);
        return question(viewer, ctx, `${label}? ${look.job ? 'Running a job again' : 'Starting an app that uses the GPU'} is the owner’s call.`,
          [{ label, call: { action: 'keep_running', args: input } }, { label: 'No, leave it', call: null }], 'question', { ownerOnly: true });
      }
      if (!gb) throw new HttpError(409, `${container} has no memory limit of its own, so whether it fits beyond the 8 GB kept for the system can’t be checked. Nothing was started. Say the most memory it may use (memoryGB).`);
      if (look.gpu) gpuAlone(sp, look, at);
      await appRoom(node, gb, container);
      // A job run again ("run sums again"): started as it was, never put on the list, and not watched until it answers.
      if (look.job) {
        const job = claimed([spark], `starting ${container}`, () => newJob('deploy', { ...meta, model: container, memoryGB: gb }));
        runJob(job, async j => {
          pausedCheck(ctx);
          await jobFolder(node, container);
          if (look.gpu) gpuAlone((await inventory(null)).sparks.find(s => s.id === spark) || sp, await appLook(node, container, sp.tsip), at);
          await appRoom(node, gb, container);
          step(j, `Starting ${container} on ${at} again`);
          // (its two mounts checked again in the same command: something may have swapped one since the folder was made)
          const r = await run(node, `${jobMountsReal(container)}; docker start ${q(container)}`, { timeout: 90000 });
          if (r.code === JOB_NOT_REAL) throw jobNotReal(node, container, r);
          if (r.code) throw new Error(`Docker couldn’t start it: ${maskSecrets(r.err || r.out).slice(0, 400)}`);
          consoleStopped.delete(key);
          // (its end is told again, also when it ends before the watcher's next look: its row says running, so the next
          // look reads it afresh, with this run's exit code)
          const w = knowledge.workloads[key];
          if (w) { delete w.endTold; Object.assign(w, { state: 'running', running: true }); }
          note(j, `${container} runs again. Its files go to jobs/${container} in the shared folder on ${at}; Spark Console posts in the chat it was started from when it ends.`);
        });
        return { outcome: 'started', operation: job.id, starting: container, spark, job: true, next: next(job.id) };
      }
      if (entry && changed) keepIt();
      const job = claimed([spark], `starting ${container}`, () => newJob('restart', { ...meta, port: hostPort, memoryGB: gb }));
      runJob(job, async j => {
        j.checkPause = () => { cancelCheck(j); pausedCheck(ctx); };
        let answers;
        // (what runs there now, again, inside the claim: another GPU app, job or model, or less free memory, may have come
        // since the look before it. Before the try: a refusal here started nothing, so there's nothing to put back.)
        if (look.gpu) gpuAlone((await inventory(null)).sparks.find(s => s.id === spark) || sp, await appLook(node, container, sp.tsip), at);
        await appRoom(node, gb, container);
        try {
          pausedCheck(ctx);
          step(j, `Starting ${container} on ${at}`);
          const r = await run(node, `docker start ${q(container)}`, { timeout: 90000 });
          if (r.code) throw new Error(`Docker couldn’t start it: ${maskSecrets(r.err || r.out).slice(0, 400)}`);
          consoleStopped.delete(key);
          answers = await appUp(j, node, container, sp.tsip, hostPort);
        } catch (e) { await appPutBack(j, node, container); throw e; }
        appDone(j, container, link, answers, hostPort);
      });
      return { outcome: 'started', operation: job.id, starting: container, spark, ...appLinks(spark, container, link), next: next(job.id) };
    }
    // Not there: a new app, from the image the owner named.
    if (!input.image) throw new HttpError(404, `There’s no container called ${container} on ${at}. To start a new app there, say which image to run and the port to open it at.`);
    if (!input.port && !input.once) throw new HttpError(400, 'Missing argument: port (where to open it, like "3000:8080"). A job that runs once (once true) needs none.');
    if (input.gpu && !input.memoryGB) throw new HttpError(400, 'A GPU app or job needs its memory figure (memoryGB).');
    if (/^sc-/i.test(container) || inv.library.some(m => m.name === container)) throw new HttpError(400, 'That name is one of Spark Console’s models. Pick another name for the app.');
    if (appModelImage(input.image)) throw new HttpError(400, `${input.image} is a model engine’s image. Models are started with start_model, not kept running as apps.`);
    const [hp, ip = hp] = input.port ? input.port.split(':').map(Number) : [null, null];
    if (input.port && (hp < 1024 || hp > 65535 || hp === CONFIG.servePort || ip < 1 || ip > 65535)) {
      throw new HttpError(400, `The port to open it at has to be between 1024 and 65535, and not ${CONFIG.servePort} (Spark Console’s models answer there).`);
    }
    const secret = (input.env || []).find(e => appSecretName(e.split('=')[0]) || maskSecrets(e) !== e);
    if (secret) throw new HttpError(400, `${secret.split('=')[0]} looks like a key, token or password. Spark Console doesn’t pass secrets to an app: set it on the app’s own page.`);
    // (a command word, or the value after a flag like --api-key, that would be hidden as a secret, A13)
    if (JSON.stringify(commandWords(input.command)) !== JSON.stringify(input.command || [])) {
      throw new HttpError(400, 'Its command looks like it has a key, token or password in it. Spark Console doesn’t pass secrets to an app or job: set it on its own page, or in a file in the shared folder.');
    }
    if (!sp.tsip) throw new HttpError(409, `${at}’s tailnet address isn’t known right now, so the app can’t be opened on your tailnet only. Try again in a minute.`);
    // A new image is code that runs on a Spark: at once only for the owner on their tailnet (as undo_update), else an
    // owner-only button, pressed in Spark Console.
    const ownerHere = ['page', 'api', 'sparkie'].includes(ctx.via) && !viewer.session && !viewer.agentKey && !ctx.agent && !ctx.channel;
    if (!ownerHere && !ctx.ownerConfirmed) {
      const label = changeLabel('keep_running', input);
      return question(viewer, ctx, `${label}? Starting a new image is the owner’s call.`,
        [{ label, call: { action: 'keep_running', args: input } }, { label: 'No, leave it', call: null }], 'question', { ownerOnly: true });
    }
    if (input.gpu) gpuAlone(sp, look, at);
    await appRoom(node, gb, container);
    const a = { container, image: input.image, port: input.port || null, volumes: input.volumes || [], env: input.env || [], memoryGB: gb, gpu: Boolean(input.gpu), once: Boolean(input.once), command: appCommand(input) };
    const url = hp ? `http://${sp.tsip}:${hp}` : null, open = devBox(a) ? ` ${DEV_BOX_WORDS}` : '';
    const job = claimed([spark], `starting ${container}`, () => newJob('deploy', { ...meta, model: container, image: input.image, ...(hp ? { port: hp } : {}), memoryGB: gb }));
    runJob(job, async j => {
      pausedCheck(ctx);
      j.checkPause = () => { cancelCheck(j); pausedCheck(ctx); };
      // A job's own folder is made first, by the owner's user (Docker would make it as root).
      if (a.once) await jobFolder(node, container);
      step(j, `Getting the image ${input.image}`);
      const pull = await run(node, `docker image inspect ${q(input.image)} >/dev/null 2>&1 || docker pull ${q(input.image)}`,
        { timeout: 3600000, signal: j.abort?.signal, onLine: l => { j.detail = maskSecrets(String(l)).slice(0, 200); } });
      if (pull.code) throw new Error(`Image download failed: ${maskSecrets((pull.err || pull.out).trim().split('\n').slice(-3).join(' ')).slice(0, 400)}`);
      j.checkPause();
      // (what runs there now, again: something may have taken the GPU while the image came)
      if (a.gpu) gpuAlone((await inventory(null)).sparks.find(s => s.id === spark) || sp, await appLook(node, container, sp.tsip), at);
      await appRoom(node, gb, container);
      step(j, `Starting ${container} on ${at}`);
      // (a job's two mounts checked again in the same command, as for a run again)
      const r = await run(node, `${a.once ? `${jobMountsReal(container)}; ` : ''}${appRunCommand(a, sp.tsip, ctx.conv || null)}`, { timeout: 120000 });
      if (r.code === JOB_NOT_REAL && a.once) throw jobNotReal(node, container, r);
      if (r.code) {
        // docker run makes the container before it starts it: one that never started (its port was taken) holds no data
        // or log, and left there it would stand in the way of the next try under this name. Only that one goes: still
        // "created", under exactly this name, and not a name Docker said was taken already.
        if (!/is already in use/i.test(r.err || r.out)) {
          await run(node, `[ "$(docker inspect -f '{{.Name}}|{{.State.Status}}' ${q(container)} 2>/dev/null)" = ${q(`/${container}|created`)} ] && docker rm ${q(container)} >/dev/null 2>&1; true`, { timeout: 30000 });
        }
        throw new Error(`Docker couldn’t start it: ${maskSecrets((r.err || r.out).trim()).slice(0, 400)}`);
      }
      // A job runs to its end: it isn't put on the list (no ranHere) and isn't watched until it answers; the watcher
      // tells its end (jobEnded).
      if (a.once) {
        consoleStopped.delete(key);
        note(j, `${container} runs. Its files go to jobs/${container} in the shared folder on ${at}; Spark Console posts in this chat when it ends.${open}`);
        return;
      }
      (j.ranHere ||= []).push(key);
      consoleStopped.delete(key);
      let answers;
      try { answers = await appUp(j, node, container, sp.tsip, hp); } catch (e) { j.ranHere = []; await appPutBack(j, node, container); throw e; }
      // (a name still on the list whose container was gone: its entry takes the new port and memory figure, no new revision)
      if (entry) try { keepApp({ spark, container, port: hp, memoryGB: gb }, ctx.actor || viewer.login, ctx.conv || ctx.chat || null); } catch (e) { note(j, `Its entry on the list couldn’t be updated: ${e.message}`); }
      appDone(j, container, url, answers, hp);
      if (open) note(j, DEV_BOX_WORDS);
    });
    const ready = url ? appLinks(spark, container, url) : {};
    return { outcome: 'started', operation: job.id, starting: container, spark, image: input.image, ...(a.gpu ? { gpu: true } : {}),
      ...(a.once ? { job: true, files: `jobs/${container} in the shared folder on ${at}` } : {}),
      ...(ready.link ? { linkWhenReady: ready.link } : {}), ...(ready.tailnetLink ? { tailnetLinkWhenReady: ready.tailnetLink } : {}),
      ...(open ? { note: DEV_BOX_WORDS } : {}), next: next(job.id) };
  },
});

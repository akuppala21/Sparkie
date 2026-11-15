/* ───────── the box: a throw-away container on a compute Spark (A2; commands in it come with A4) ───────── */
// Area: features        Rules: R62, R1, R43        Tests: box.test.mjs
// Owns: none
// Timers: none        Wakes: none
// run {on: "box"} (21-work.mjs) opens the caller's box on first use: one container per chat (or per caller outside a
// chat), on a compute Spark that is on, never on Spark 2 or a Spark holding the brain (R1). workBoxCommand builds its
// only docker run line, every word of it code's: the image pinned by digest (config.json work.images.python), no
// network, no IPC, no capabilities, no new privileges, a read-only root, the owner's own ids, caps on memory,
// processes, CPU and file size, one mount (its own folder, ~/.local/share/spark-console/work/<name>, at /work), and a
// time limit (its process is sleep <seconds>; --rm removes it when that ends). A fixed check then runs inside it and
// must find every wall (BOX_WALLS); one that got through removes the box, and nothing opens. /stop in the chat removes
// the chat's box (20-words.mjs), and its folder. The watcher and workloads skip it by its label (19-watcher.mjs). Today
// the command is not run: the answer says the box opened and passed its check, and that nothing ran (A4 runs it).
// Which box is where lives only in memory: after a restart a box left open ends at its own time.
const BOX_SECONDS = Number(ALL_LOCAL && process.env.SPARK_CONSOLE_BOX_SECONDS) || 2 * 3600;
const BOX_MEMORY = '4g', BOX_PIDS = 256, BOX_CPUS = 4, BOX_FILE_BYTES = 2 ** 30, BOX_OPEN_MS = 45000;
const BOX_LABEL = 'spark-console.box', BOX_DIR = '.local/share/spark-console/work', BOX_NAME = /^spark-console-box-[0-9a-f]{12}$/;
const BOX_IMAGE = /^[a-z0-9][a-z0-9._/-]{0,199}(?::[A-Za-z0-9._-]{1,128})?@sha256:[0-9a-f]{64}$/;
// What the check inside proves, and how a wall that got through is said.
const BOX_WALLS = {
  root: 'it runs as root', caps: 'it holds capabilities', privileges: 'it may gain privileges', writes: 'it can write outside its folder',
  work: 'its own folder is not writable', mounts: 'more of the Spark is mounted than its folder', home: 'the owner’s home is visible',
  sockets: 'a socket is visible (Docker’s, Tailscale’s or another)', secrets: 'a key was handed in', network: 'it has a network',
};
const BOX_WORDS = 'not root, no capabilities, no new privileges, nothing writable but its own folder, nothing of the Spark mounted but that folder, no socket, no key handed in, no network';
const boxes = new Map();     // the caller (boxKey) → { spark, name, until }
const boxOpening = new Map(); // the caller → the open under way, which a second call waits for

// The one docker run line (R62). "$n" (the box's name), "$w" (its folder) and "$img" are set by boxScript, from code.
function workBoxCommand() {
  return ['docker run --detach --rm --pull never',
    `--name "$n" --label ${BOX_LABEL}="$n"`,
    '--user "$(id -u):$(id -g)"',
    '--network none --ipc none',
    '--cap-drop ALL --security-opt no-new-privileges',
    '--read-only',
    `--memory ${BOX_MEMORY} --memory-swap ${BOX_MEMORY} --pids-limit ${BOX_PIDS} --cpus ${BOX_CPUS} --ulimit fsize=${BOX_FILE_BYTES}:${BOX_FILE_BYTES}`,
    '--mount "type=bind,src=$w,dst=/work" --workdir /work --env HOME=/work --env TMPDIR=/work',
    `--entrypoint sleep "$img" ${BOX_SECONDS}`].join(' ');
}
// The check, run inside the new box with bash (its arguments: the call's id, the owner's home on the Spark, the
// console's host and port). Each line begins with the id: "<id> wall <name> ok", or "open" and what got through; the
// last is "<id> walls end".
const BOX_CHECK = String.raw`id=$1; home=$2; ch=$3; cp=$4
w() { printf '%s wall %s %s\n' "$id" "$1" "$2"; }
if [ "$(id -u)" != 0 ] && [ "$(bash -c 'id -u')" != 0 ]; then w root ok; else w root open; fi
c=$(awk '/^Cap(Inh|Prm|Eff|Bnd|Amb):/ {print $2}' /proc/self/status | sort -u)
if [ "$c" = 0000000000000000 ]; then w caps ok; else w caps open; fi
if grep -qE '^NoNewPrivs:[[:space:]]+1$' /proc/self/status; then w privileges ok; else w privileges open; fi
o=''; for d in / /etc /usr /var /var/tmp /tmp /root /home /run /opt /dev/shm; do [ -d "$d" ] || continue; f="$d/.box-check-$id"; if (: > "$f") 2>/dev/null; then rm -f "$f"; o="$o $d"; fi; done
if [ -z "$o" ]; then w writes ok; else w writes "open$o"; fi
f="/work/.box-check-$id"; if (: > "$f") 2>/dev/null; then rm -f "$f"; w work ok; else w work open; fi
m=$(awk '{print $5}' /proc/self/mountinfo | grep -vxE '/|/work|/etc/(resolv\.conf|hostname|hosts)|/(proc|dev|sys)(/.*)?' | sort -u | tr '\n' ' ')
r=$(awk '$5 == "/work" {print $4}' /proc/self/mountinfo)
case "$r" in */.local/share/spark-console/work/spark-console-box-*) ;; *) m="$m/work=$r" ;; esac
if [ -z "$m" ]; then w mounts ok; else w mounts "open $m"; fi
if [ ! -e "$home" ]; then w home ok; else w home open; fi
s=$(find / -xdev -type s 2>/dev/null | head -n 3 | tr '\n' ' ')
for p in /var/run/docker.sock /run/docker.sock /run/containerd/containerd.sock /var/run/tailscale/tailscaled.sock /run/tailscale/tailscaled.sock; do [ -e "$p" ] && s="$s$p "; done
if [ -z "$s" ]; then w sockets ok; else w sockets "open $s"; fi
e=$(env | cut -d= -f1 | grep -E '^(SPARK_CONSOLE_|HF_|HUGGING_FACE|GITHUB_|GH_|NGC_|TELEGRAM|AWS_|OPENAI|ANTHROPIC)' | tr '\n' ' ')
[ -e /run/secrets ] && e="$e/run/secrets"
if [ -z "$e" ]; then w secrets ok; else w secrets "open $e"; fi
n=$(ls /sys/class/net 2>/dev/null | grep -vx lo | tr '\n' ' ')
for t in "$ch/$cp" 100.100.100.100/53; do timeout 3 bash -c "exec 3<>/dev/tcp/$t" 2>/dev/null && n="$n$t "; done
if [ -z "$n" ]; then w network ok; else w network "open $n"; fi
printf '%s walls end\n' "$id"`;
// The console's own address, which the check must not reach (Tailscale's resolver is tried too).
function boxConsole() {
  try { const u = new URL(consoleOrigin()); if (/^[A-Za-z0-9.-]{1,253}$/.test(u.hostname)) return [u.hostname, u.port || '443']; } catch {}
  return ['127.0.0.1', String(CONFIG.port)];
}
// The script that opens a box (run, as the owner's user). Its own lines are "box <word>": nodocker, nofolder, busy,
// pulling, failed <docker's last line>, removed (a wall got through, or the check didn't finish), open.
function boxScript(name, image, id) {
  const [host, port] = boxConsole(), walls = Object.keys(BOX_WALLS);
  return [
    'set -u',
    `n=${q(name)}; img=${q(image)}; id=${id}; base="$HOME/${BOX_DIR}"; w="$base/$n"`,
    "say() { printf 'box %s\\n' \"$*\"; exit 0; }",
    'command -v docker >/dev/null 2>&1 || say nodocker',
    'mkdir -p -m 700 "$base" 2>/dev/null; { [ -d "$base" ] && [ ! -L "$base" ]; } || say nofolder',
    'case "$w" in *,*|*\\"*) say nofolder ;; esac',
    'exec 9>>"$base/.lock" && flock -w 20 9 || say busy',
    // (the folders of boxes that have ended, at their time or after a console restart, go before one opens)
    'for d in "$base"/spark-console-box-*; do [ -d "$d" ] && [ ! -L "$d" ] || continue; docker inspect --type container "${d##*/}" >/dev/null 2>&1 || rm -rf -- "$d"; done',
    // (the pinned image is fetched once, apart from the call: a box opens with --pull never)
    'docker image inspect "$img" >/dev/null 2>&1 || { (setsid docker pull "$img" </dev/null >/dev/null 2>&1 &); say pulling; }',
    'docker rm -f "$n" >/dev/null 2>&1; rm -rf -- "$w"; mkdir -m 700 "$w" || say nofolder',
    `o=$(${workBoxCommand()} 2>&1) || { docker rm -f "$n" >/dev/null 2>&1; rm -rf -- "$w"; say failed "$(printf '%s' "$o" | tail -n 1 | head -c 300)"; }`,
    `c=$(timeout 40 docker exec "$n" bash -c ${q(BOX_CHECK)} box-check "$id" "$HOME" ${q(host)} ${q(port)} 2>&1 | head -c 20000)`,
    "printf '%s\\n' \"$c\"",
    `k=$(printf '%s\\n' "$c" | grep -xE "$id wall (${walls.join('|')}) ok" | sort -u | wc -l)`,
    `if [ "$k" = ${walls.length} ] && printf '%s\\n' "$c" | grep -qx "$id walls end"; then say open; fi`,
    'docker rm -f "$n" >/dev/null 2>&1; rm -rf -- "$w"; say removed',
  ].join('\n');
}
// Removes a box and its folder on its Spark (by its exact name only).
function boxRemove(node, name) {
  if (!BOX_NAME.test(name)) return Promise.resolve({ code: 1, out: '', err: 'not a box name' });
  return run(node, `docker rm -f ${q(name)} >/dev/null 2>&1; rm -rf -- "$HOME/${BOX_DIR}/"${q(name)}; echo removed`, { timeout: 30000 });
}
// One box per chat; outside a chat, one per caller (the owner's API, each agent key).
const boxKey = ctx => (ctx.chat ? `chat ${ctx.chat}` : `${ctx.via || 'api'} ${ctx.agentId || ctx.actor || 'owner'}`);
const boxName = key => `spark-console-box-${createHash('sha256').update(key).digest('hex').slice(0, 12)}`;
// Never on Spark 2 (the hub) or a Spark holding the brain (R1), checked again just before each open.
function boxRefusesHere(node) {
  if (!node || node.host === 'local' || brainSparks().includes(node.id)) throw new HttpError(403, `${sparkName(node || { id: '?' })} holds the brain or is the hub, so no box opens there.`);
}
// The compute Sparks a box may open on, the caller's last one first; those known to be off are left out.
function boxPlaces(prefer) {
  const brain = brainSparks(), state = id => statusCache?.value.nodes.find(x => x.id === id)?.state;
  const all = computeSparks().map(nodeById).filter(n => n && n.host !== 'local' && !brain.includes(n.id));
  const up = all.filter(n => !knownOffline(n) && (state(n.id) ?? 'online') === 'online');
  return { all, up: [...up.filter(n => n.id === prefer), ...up.filter(n => n.id !== prefer)] };
}

async function boxOpen(key, ctx, command) {
  const t0 = Date.now(), rid = journalId(), rec = { outcome: 'refused', spark: null, name: boxName(key), text: '' };
  try {
    const was = boxes.get(key);
    if (was && was.until > Date.now()) {
      const r = await run(nodeById(was.spark), `docker inspect --type container -f '{{.State.Status}}' ${q(was.name)} 2>/dev/null`, { timeout: 20000 });
      if (r.code === 0 && r.out.trim() === 'running') { Object.assign(rec, { outcome: 'open', spark: was.spark }); return { ...was, opened: false }; }
    }
    boxes.delete(key);
    const image = String(CONFIG.work?.images?.python || '');
    if (!BOX_IMAGE.test(image)) throw new HttpError(409, 'No box image pinned by digest is set in config.json (work.images.python), so no box opened. Nothing ran.');
    const { all, up } = boxPlaces(was?.spark);
    if (!all.length) throw new HttpError(409, 'There is no compute Spark on the list (a box never opens on Spark 2 or on the brain’s Spark), so no box opened. Nothing ran.');
    for (const node of up) {
      boxRefusesHere(node);
      const at = sparkName(node), id = randomBytes(12).toString('hex');
      const r = await run(node, boxScript(rec.name, image, id), { timeout: BOX_OPEN_MS });
      rec.spark = node.id;
      rec.text = r.out;
      if (r.code === 255 && !r.out.includes('box ')) continue;
      const lines = r.out.split('\n'), said = lines.filter(l => l.startsWith('box ')).pop()?.slice(4) || '', word = said.split(' ')[0];
      const walls = new Map(lines.filter(l => l.startsWith(`${id} wall `)).map(l => l.slice(id.length + 6).split(' ')).map(([k, v, ...more]) => [k, v === 'ok' && !more.length]));
      const open = Object.keys(BOX_WALLS).filter(k => walls.get(k) !== true), ended = lines.includes(`${id} walls end`);
      rec.outcome = word || 'broken';
      if (word === 'nodocker') throw new HttpError(503, `Docker isn’t answering on ${at}, so no box opened. Nothing ran.`);
      if (word === 'nofolder') throw new HttpError(409, `The box’s folder on ${at} (~/${BOX_DIR}) couldn’t be made, or is a link, so no box opened. Nothing ran.`);
      if (word === 'busy') throw new HttpError(409, `Another box is opening on ${at} right now. Try again in a moment; nothing ran.`);
      if (word === 'pulling') return { pulling: true, spark: node.id };
      if (word === 'failed') throw new HttpError(502, `Docker didn’t open the box on ${at}: ${maskSecrets(said.slice(7, 307)) || 'no reason given'}. Nothing ran.`);
      if (word === 'open' && !open.length && ended) {
        const box = { spark: node.id, name: rec.name, until: Date.now() + BOX_SECONDS * 1000 };
        boxes.set(key, box);
        rec.outcome = 'opened';
        return { ...box, opened: true };
      }
      // (a wall that got through, a check that didn't finish, or an answer this code doesn't know: the box goes)
      if (word !== 'removed') await boxRemove(node, rec.name);
      rec.outcome = 'walls';
      const why = ended || walls.size ? open.map(k => BOX_WALLS[k]).join('; ') : `its check didn’t finish (${maskSecrets(lines.find(l => l && !l.startsWith('box ')) || 'no answer').slice(0, 200)})`;
      throw new HttpError(409, `The box on ${at} failed its check from inside and was removed: ${why || 'the check’s answer was not its own'}. Nothing ran.`);
    }
    throw new HttpError(503, `No compute Spark is on to hold a box: ${wordList(all.map(sparkName))} ${all.length > 1 ? 'are' : 'is'} off or not answering (a box never opens on Spark 2 or on the brain’s Spark, and it wakes nothing). Nothing ran.`);
  } catch (e) { rec.err = e; throw e; } finally {
    journal('cmd', { id: rid, chat: ctx.chat || null, via: ctx.via || null, actor: ctx.actor || null, act: 'run', where: 'box', class: 'change', gate: 'box',
      unit: rec.name, args: { spark: rec.spark, command: String(command).slice(0, 600) }, ok: !rec.err, outcome: rec.outcome, exit: null,
      err: jErr(rec.err), ms: Date.now() - t0, sub: jSub(rec.spark) }, rec.text ? `$ (the box's open and check)\n${rec.text}` : null);
  }
}

// run {on: "box"} (from runCommand): the caller's box, opened and checked; the command is not run yet (A4).
async function boxRun(input, viewer, ctx = {}) {
  whoMayLook(viewer, ctx);
  const key = boxKey(ctx);
  let p = boxOpening.get(key);
  if (!p) { p = boxOpen(key, ctx, input.command).finally(() => boxOpening.delete(key)); boxOpening.set(key, p); }
  const b = await p, at = sparkName(nodeById(b.spark) || { id: b.spark }), observedAt = new Date().toISOString();
  if (b.pulling) return { box: 'not yet', spark: b.spark, ran: false, observedAt,
    why: `The box’s image is being fetched to ${at} (once; a minute or two). Ask again then. No box opened, and nothing ran.` };
  const until = new Date(b.until).toISOString(), close = ctx.chat ? ', or at /stop in this chat' : '';
  return { box: b.opened ? 'opened' : 'open', spark: b.spark, until, ran: false, observedAt,
    why: `${b.opened ? 'The box opened' : 'The box was already open'} on ${at} and passed its check from inside (${BOX_WORDS}). Nothing was run in it: commands in the box come with a later build. It ends by itself at ${until}${close}.` };
}
// /stop in a chat (20-words.mjs): its box goes, with its folder. The Spark's name when there was one, else null.
function boxStop(conv) {
  const key = `chat ${conv.id}`, b = boxes.get(key);
  if (!b) return null;
  boxes.delete(key);
  const node = nodeById(b.spark);
  boxRemove(node, b.name).then(r => journal('cmd', { id: journalId(), chat: conv.id, act: 'run', where: 'box', class: 'change', gate: 'box', unit: b.name,
    args: { spark: b.spark }, ok: r.code === 0, outcome: 'removed', err: r.code === 0 ? null : jErr(r.err), sub: jSub(b.spark) })).catch(() => {});
  return sparkName(node || { id: b.spark });
}

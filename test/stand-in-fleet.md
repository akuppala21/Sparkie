# How the tests are put together

The harness every test file uses and the stand-in fleet it runs against. How to run the tests, and what each file
covers, is in `test/README.md`.

- `start-mock.mjs` — `startMock()` starts the service on a fresh copy of the stand-in fleet: a temporary folder with a
  copy of `mock/root`, a state folder seeded with `mock/access.json` (owner `owner@test`, member `member@test`, Sparks
  1–4) and `mock/links.json` (the last cable test), its own socket and port, `SPARK_CONSOLE_WATCH_MS=3000`, and
  `SPARK_CONSOLE_SERVE_PORT` (where deploys are checked) on a free port. The state's `main.json` points Sparkie's model
  setup from `service/config.json` at the stand-in model. Everything runs in one process group, stopped (and the
  folder removed) by `stop()` or however the test process ends. Tests change the copied fleet freely; `test/mock` is
  never written. `prepare({ dir, root, stateDir })` runs before the service starts (to seed `events.jsonl`,
  `heal-tries.json`, unreadable files, …); `knowledge: true` seeds the watcher's `knowledge.json` with the stand-in
  containers (Sparkie traces a container named in the owner's words through it; the watcher's first look is 15 s in);
  `env` adds environment variables (`SPARK_CONSOLE_AGENT_CHANGES_PER_HOUR` is 1000 unless a test sets it). The result
  also has `env` (to start a second copy), `servicePid()` (to send it SIGTERM) and `serviceExit()`.
- Each test file starts its own service (`useFleet()` in `lib.mjs`) and makes, then removes, its own agent keys through
  `POST /agents` (with `X-Spark-Console: 1` and the configured Origin, as the page does; `createActKey()` keys may act).
  Each request gets a fresh connection (`request()` in `lib.mjs`): Node 26's fetch can stall a second or two reusing a
  kept-alive connection idle for a second.
- `mock/` — the stand-in fleet:
  - `root/spark1…5/` — each Spark's HOME: `.mock/containers` (`name|state|status|ours|model|protect|role|cluster|rank`),
    `.mock/images`, `.mock/ports`, `.mock/meminfo` (like `/proc/meminfo`: 128 GB, about 22 / 64 / 46 GiB available on
    Sparks 2 / 3 / 4), `.mock/gpu` (`pid, MiB, process[, container]`), `models/`, a Hugging Face cache, and
    `sys/class/net` for the ConnectX links. Spark 1 starts offline (`mock/offline`); Spark 5 isn't in the access list.
    Tests may add, in `.mock/`: `logs-<name>` (what `docker logs` shows), `stop-code-<name>` (the exit code
    `docker stop` leaves), `started-<name>` (when `docker inspect` says it started; else 2026-11-04), a third field in
    a `ports` line (the host address `docker port` shows; else 127.0.0.1), `cmd-<name>` (a JSON list: the command
    `docker inspect` gives; else a fixed one with a FAKE `--api-key`), `stall` (seconds every `docker` command and the
    worker hang, holding no output open, like a frozen Spark; `0` fails every `docker` command at once while the worker
    answers: Docker not answering on a Spark that is on), `stall-worker` (only the worker), `gzip-bad` (the stand-in
    `gzip -t` fails: a daily copy cut short), `serve-down` (no model there answers yet, so a start or restart stays
    "loading"), `slow-<command>` (seconds `docker <command>` takes), `image-<name>` and `memory-<name>` (the image and
    memory limit in bytes that `docker inspect` gives a container the console didn't start, as an app),
    `app-port-taken` (an app's `docker run` fails on its port, leaving the container "created", as Docker does), `tsip`
    (that Spark's tailnet address; else 127.0.0.1), `reject-flag` (a console model started with that flag exits at
    once), `slow-container-logs` (seconds the worker takes to read a container's log), `killed` (what `docker kill`
    was given, one line each), `ids-per-run` (a container made again under a name gets a new id), `stamp-starts`
    (each run or start writes `started-<name>`), `jobs-run` (a job runs its command here, in its `/out` folder, to its
    end: what it prints is its log, its exit code the container's), `gpu-broken` (`nvidia-smi` answers as a driver
    that doesn't, exit 9) and `hf-hold` (`hf download` waits while the file is there).
  - `manifest.json` — what git can't hold: empty folders and the zero-filled weight files' sizes (recreated sparse).
  - `bin/` — stand-ins for `docker`, `nvidia-smi`, `curl`, `df`, `du`, `free`, `gzip` (the real one; `.mock/gzip-bad` above), `hf`, `ip`, `loginctl`, `ping`, `ss`, `tailscale`,
    and `ssh`/`scp` stubs that always fail. `docker` runs, stops, starts, kills (exit 137) and removes containers like the real one: the
    console's model containers share the serve port (a second can't start while one runs: "port is already
    allocated"), `*gemma*` models exit with code 1 as soon as they start, a stop frees the GPU memory `.mock/gpu` lists
    for it, and "OOM" in a status means killed for memory. Like Docker, it takes a container's name or the start of its
    id (hex, one container only); `docker port` answers only while a container runs; `docker inspect` keeps a stopped
    one's published ports; an app's run (`spark.app=1`) is kept in `.mock/run-<name>`, so `docker inspect`
    gives its image, settings, named volumes, ports, memory limit, command (the words after the image), `--gpus` and
    its `spark.gpu`, `spark.job` and `spark.chat` labels; `docker ps --format 'run…'` shows `spark.gpu` as a fourth
    column and `--filter label=spark.gpu=1` keeps only those (A13). `curl` answers on the serve port once a console
    model on that Spark has run 4 seconds. `hf download` fills the Hugging Face cache. `tailscale ip` is 127.0.0.1 (or
    `.mock/tsip`), so model addresses reach the stand-in serve port; `tailscale serve status --json` (the console's route check) answers `$MOCK_DIR/serve.json`, or `{}` (nothing loaded, as right after a boot).
    `tailscale status --json` (the console's look at the tailnet, R49) answers `$MOCK_DIR/status.json`, or Spark 2
    running with a key that never expires; with `$MOCK_DIR/tailscale-hangs` every call hangs. `loginctl show-user`
    (the linger look) answers Spark 2's `.mock/linger` (yes when there is none; `fail` fails). Both keep every call,
    one line each, in `$MOCK_DIR/tailscale-calls` and `$MOCK_DIR/loginctl-calls`.
  - `bin/sudo` — only `sudo -n` with the two commands `deploy/power-setup.sh` allows (and `-l` to ask): `systemctl
    poweroff` makes every running container there exit and puts the Spark in the offline file (the stand-in plug reads
    it); `.mock/no-sudo` makes it ask for a password (refused), `.mock/poweroff-refused` lets `-l` say yes but refuses the
    shutdown itself, `.mock/poweroff-hangs` keeps the Spark answering. `bin/who` gives the sessions in `.mock/who` (none
    otherwise). `bin/docker`'s `.mock/power-looks` (a number) lets that many more power-off looks answer, then fails
    them; `bin/curl` answers the serve port's `/metrics` with `.mock/metrics` when there is one.
  - `plugs.mjs` — the plug controller (matterjs-server's WebSocket): `get_nodes`, and `device_command` on/off (a node
    marked `readOnly` refuses with Matter's status 126). `attach()` ties nodes to Sparks: their watts follow the offline
    file (about 58 W on, 2.5 W shut down, 0 off), off takes the Spark down, on boots it; `setStuck`, `setNoBoot`,
    `setNames('upper')` for the other cases, and `setWatts(node, mW)` for a reading that stays put whatever the Spark
    does (one the controller hasn't caught up with; `null` ends it).
  - `worker.py` — stands in for `service/worker.py` (workspace files go to the real one; status without the removed
    ray/model fields; logs for `editor`, `console` and `sparkie`).
  - `model.mjs` — Sparkie's model (streams like SGLang; offered tools, it calls them from patterns in the owner's words
    (the last user message, fleet record left out): "what's running", "start <model> [on spark N]", "stop/restart
    <container> on spark N", "restart <container> on spark N once you've read its logs" (two rounds: `container_logs`,
    then `restart_model`), "why did it fail"; or from rules a test writes to `$MOCK_DIR/model-script.json`
    (`{match, calls}` or `{match, rounds: [[calls], [calls]]}`); a call is made whether or not Sparkie was offered that
    tool (the console runs any action it is asked for, R46), so a scripted call no longer shows a tool was offered:
    `offered: true` on a call makes it only when it was, and `test/tools.test.mjs` tests what is offered;
    "take N seconds" makes it wait; a rule's `answerWhen` (a file name) holds the answer after its tools' results until
    `$MOCK_DIR/<that file>` is there; `$MOCK_DIR/model-fail` makes one request fail, once, in a way its head lists;
    every request goes to `$MOCK_DIR/model-requests.jsonl` with the system prompt, the whole last user message, the
    round and the tool results), an always-up benchmark server, and the serve-port server deploys are speed-tested on.
  - `clock.mjs` — loaded into the service with `NODE_OPTIONS=--import=…`,
    moves its `Date.now()` ahead by the milliseconds in `$MOCK_DIR/clock-offset`. `fault.mjs` — loaded the same way;
    a request with `x-mock-fault` throws inside its route once, `$MOCK_DIR/fault-reject` rejects a promise nobody
    listens to, `$MOCK_DIR/fault-throw` throws from a timer. `disk-full.mjs` — loaded the same way; while
    `$MOCK_DIR/disk-full` is there, every write to the journal's folder fails as a full disk does (ENOSPC).
  - `standin-console.mjs` — a stand-in Spark Console for `install.test.mjs`: only the routes the installer asks
    (`/health`, `/whoami`, `/mcp`, `/v1/models`, `/main`, `/chats` and a chat turn's stream) on
    `$HOME/.local/state/spark-console/api.sock`; the test puts `const MODE = '…'` in front of it (good, dead, dies,
    not-owner, no-tool, tg-bad) and stages it as `server.mjs`.
  - `telegram.mjs` — Telegram's Bot API, started when a test asks for `telegram: true` (long polling with Telegram's
    offset rules, 409 on a second poller, 4,096-character messages); `/__push` queues updates, `/__mode` makes it
    refuse (401), be in use (409), be down (502) or slow down (429); every call goes to `telegram-calls.jsonl`.
- All tokens in the stand-ins (`hf_secret…`, `sk-abc…`, `nvapi-ABC…` and the like) are fake, to check masking.
- What no test reaches: the real `worker.py` status code, real ssh, the Mac half of the installer, real systemd
  and Tailscale's routes, and the locked TCP mode. `test/install.test.mjs` runs the installer's Spark 2 half,
  `restore.sh` and the watchdog with a stand-in `systemctl` (on macOS under bash 3.2 with `tar` and `find` shims; a
  Linux run is the full proof); `deploy/go-back.sh` itself is run by `go-back.test.mjs`. No test covers R14 or the
  cable rule in R17.

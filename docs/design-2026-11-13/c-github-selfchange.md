# C. GitHub carries the code, the tests and the tested mark. Spark 2 pulls. Sparkie changes itself.

Design only; no code was changed and nothing was run. "Verified" means I read it in the code, or on GitHub's docs through the web tools, today. "Inference" means it could not be run or read from here. Covers gaps 2 and 3 and decisions 5, 6, 7, 15 and 16. Paths are under `spark-console/`.

## 1. What exists today (verified, file:line)

- **No history.** `spark-console/` is not a git repository and has no `.gitignore`. The tree is 10 MB, no file over 2 MB.
- **The gate**, `test/lock.mjs`: build check (:20), a fingerprint of `service/*.{mjs,py,json}` (:14-18), one `node --test` over every file (:25), then it starts the stand-in fleet and writes `{build, testedAt, versions}` (:34-41). The lock in the tree names `aca03d1af018`, not today's code.
- **Time.** Today's gate logs (scratchpad `gate-final*.log`): 72 to 168 minutes, one file at a time, `SPARK_TEST_SLOW=3`. By file in the 150-minute run: apps 33, change 16, across 10, validate 7, workflows 7, install 5; forty files under 5. `test/README.md` says why: the Mac's security software checks every process the stand-in fleet starts.
- **Build id**: sha256 of `server.mjs + dig.mjs + passkey.mjs`, in three places: `service/src/01-setup.mjs:22-27`, `deploy/host-on-portal.sh:57`, `test/fleet.test.mjs:24-27`. The service reads the lock once: `18-workflows.mjs:74-81`.
- **Installer**, `deploy/host-on-portal.sh`: the Mac half stages files (:24-71) and refuses a missing lock (:34) or a lock for another build (:65-66). The Spark 2 half is a here-document (:79-492): snapshot and `restore.sh`, install, 45 s to answer and 40 s as one process (:116), ways in (:146), a chat turn (:163), put-back on any miss (:218), watchdog (:429). A `local` mode already runs every step on Spark 2 with no SSH (:38-41), from `~/spark-console-src` (:416-421). Two things in it must never run unattended: the route step can call `sudo tailscale serve` (:522-529), and the busy question reads the terminal unless `ASSUME_YES=1` (:511).
- **Going back**: `undoUpdate` starts the snapshot's `restore.sh` outside the service with `systemd-run --user` (`18-workflows.mjs:524-541`); by hand, `deploy/go-back.sh`. The update record is `noteUpdate` (:496).
- **Linux**: `test/install.test.mjs:7` says "a Linux run is the full proof". The Spark 2 half has only ever run under macOS bash 3.2 with tar and find shims (:37-38).
- **Secrets**: one file, typed on the passkey page (`03-secrets.mjs`, R32). **Daily lookups** run on Spark 2 today: a 24-hour timer, 20 models a day (`11-setups.mjs:245-258`) against GitHub and Hugging Face (`:58-83`, `10-recipes.mjs:64`).
- **Contract 6.15 and 6.16** describe a Keeper, a repository on Spark 2 and nightly commits of memory. None exists, and decision 6 replaces them: the home is GitHub and memory never goes in the repo.

## 2. The design

### 2.1 What lives where on GitHub

| Ref | Holds | Written by |
|---|---|---|
| `main` | The code. `service/workflows.lock.json` is no longer tracked here | People, and merges the owner said yes to |
| `tested/<tree>` tags | One commit: the tested tree plus two files, the lock and `test/affected-map.json` | Only the `mark` job |
| `news` branch | One file, `news.json` (2.6) | Only the scheduled news job |
| `sparkie/<id>` branches | Sparkie's proposed changes, each a pull request (2.5) | Only Spark Console's `change_propose` |

`<tree>` is the first 12 hex of git's own hash of the whole tree. It covers every file, which closes R29's gap (today a `worker.py`-only edit installs under a stale lock). The lock gains fields and loses none, so the service reads it unchanged: `{build, testedAt, versions, tree, commit, run}`.

**The tested mark is a tag (recommended).** Not a commit to `main`: `main` would move by itself after every run, and two pushes close together could put one tree's lock on another. Not an artifact (the draft): it expires, needs an API token to fetch and does not travel with the code. Not a release: the tag already is the package. Any computer, and Spark 2, gets the exact tested tree with `git fetch` and `git archive tested/<tree>`, lock included, and today's installer accepts it as it is.

**Who may write it:** only the `mark` job, the one job with `contents: write` (a push made with the job's own token starts no new run: verified in the docs). People and Sparkie never. The free plan cannot enforce that (Risks), so Spark 2 checks the content, not the author (2.3).

### 2.2 The full run, in parts (`.github/workflows/full-run.yml`)

On a push to `main`, on a pull request, and by hand. A newer push to the same branch cancels the older run.

1. **`quick`** (about 3 minutes): `node tools/build-server.mjs --check`; stop with success if `tested/<tree>` already exists (a merge that did not change the tree costs one minute), or if only `docs/**` and `*.md` changed since the base (not `docs/code-map.md`, which a test reads); otherwise run the short check (2.4). A failure ends the run: a broken push costs 3 minutes, not 40.
2. **`shard`**, four jobs side by side, each `node test/lock.mjs --shard <name>`. The groups are one table in `lock.mjs`: `apps` (apps); `starts` (change, across, validate, gateway, desired); `flows` (workflows, install, sparkie-more, steps, pause, brain, heal, heal-more, heal-newer, words); `rest` = every other `test/*.test.mjs`, worked out from the folder, so a new file can never be left out. A shard runs its files two at a time, each as its own process, all of them even after a failure, and writes `test-results/shard-<name>.json`: `{tree, node, files: [{file, ok, ms}]}`, uploaded for one day.
3. **`mark`**: downloads the four records and runs `node test/lock.mjs --mark test-results/`. It refuses unless every `test/*.test.mjs` in the checkout has a passing record made on this same tree. Then, as today, it starts the stand-in fleet, reads the build and versions, and writes the lock: one process, one writer (R22 holds). The job commits the two files on top of the tested commit and pushes that commit as `tested/<tree>`.

`node test/lock.mjs` with no option still does everything on one machine: the by-hand path when GitHub is down.

**Will the suite pass on a Linux runner as it is? No.** Verified risks:

| # | Where | What breaks |
|---|---|---|
| 1 | `service/src/05-library.mjs:53`, `:346` | Memory is read from `/proc/meminfo`, the stand-in file only when that is unreadable. Linux always has it, so every start sees the runner's 8 GB and the 8 GB rule refuses. Tests that set memory fail: `change.test.mjs:39-44, 294-313`, `apps.test.mjs:198-204, 354-362, 506-511, 630-634`, `across.test.mjs:239-240`. Fix: `SPARK_MEMINFO`, set like `SPARK_SYSFS` (`02-ssh.mjs:10`) |
| 2 | `13-main-model.mjs:116` | The brain's start reads `/proc/meminfo` with no stand-in: nothing on the Mac, real numbers on Linux |
| 3 | `10-recipes.mjs:64`; `door.test.mjs:253, 491, 679` | `search_huggingface` has no stand-in switch, so tests call Hugging Face from GitHub's addresses (rate limits). Fix: a switch like `DIG_FIXTURE` |
| 4 | `test/install.test.mjs:37-38, 99-109` | First run ever of the installer's Spark 2 half with real GNU tar and find and bash 5 |
| 5 | `test/mock/bin/curl:13, 21`; `start-mock.mjs:192`; `lib.mjs:27` | Whole-second windows and fixed limits, on 2 cores with files side by side. Start with `SPARK_TEST_SLOW=2` |
| 6 | The draft, `full-run.yml:32-33` | `SLOW=3` and one file at a time copy the Mac's handicap: up to 150 billed minutes a run |
| 7 | `03-identity.mjs:247`; `test/mock/bin/curl:3`, `gzip:5`; Node | `hostname -I` answers on Linux; the stand-ins assume `/usr/bin/curl` and `gzip` (inference: on the runner); the Mac tests on Node 26, and the run should use the major Spark 2 runs (not checkable from here) |

What git cannot hold is already handled (`test/mock/manifest.json`, `start-mock.mjs:83-91`). Imports and shipped file names have no upper/lower-case clashes (checked by script). Sort order under the runner's locale is not checked.

**Minutes (inference until step 1 measures).** GitHub's billing page lists the free allowance as $12 of compute a month; at the 2-core Linux rate of $0.006 a minute that is the 2,000 minutes of decision 6. A private repo gets 2 cores and 8 GB, and each job rounds up to a whole minute. The Mac takes about 150 minutes one at a time. Without the scanner and two at a time I expect 30 to 45 billed minutes a full run, so 45 to 65 full runs a month, and 14 to 18 minutes of waiting (the `apps` file is a fifth of the suite; splitting it in two is the next cut). Measure on the first run: each shard prints seconds per file, the run page shows each job's time, the run's Usage link shows billed minutes. Write the numbers into `test/README.md` and rebalance the groups.

### 2.3 Installing without the laptop

**On Spark 2, and nothing else:** `git`; a bare, fetch-only copy of the repo in `~/.local/share/spark-console/repo.git` (about 20 MB); one script, `pull.sh`, copied beside `go-back.sh` by every install; one entry in the secrets file, `github: {repo, token}`. Nothing runs between requests. No timer.

**The key:** a fine-grained GitHub token for this one repository with Contents: read. The owner types it once, on the passkey page (`PUT /github`, like Telegram's token) or in a terminal on Spark 2 (`pull.sh setup`, read without echo). `pull.sh` reads it from the secrets file and hands it to git through the environment, never on a command line or in git's config. Chosen over an SSH deploy key so that nothing about SSH is touched on Spark 2 at all. GitHub gets no key and no route: Spark 2 only makes outbound HTTPS calls to `github.com`.

**`pull.sh check`** fetches `main`, `tested/*` and `news`, and prints facts. **`pull.sh install <tree>`**:
1. Fetch again. Take the newest commit on `main` whose tree has a `tested/<tree>` tag; it must be the tree asked for.
2. Check the tag: it differs from that commit only by the two files, and the lock inside names this tree.
3. `git archive` the tag into a temporary folder and run that folder's own `deploy/host-on-portal.sh local` with `ASSUME_YES=1`, a new `SKIP_ROUTES=1` (the Tailscale step never runs unattended) and `NOTE=` the commit subjects. From there it is today's installer: build check, snapshot, health, 40 seconds, ways in, chat turn, Telegram, and the previous files back on any miss.
4. Write `update-result.json`: `{tree, build, result: kept | not kept | refused, why, at}`.

A fresh Spark 2 (the unattended design's rebuild): `git clone` once with the token, then `bash deploy/pull.sh setup` and `bash deploy/pull.sh install`. Same script, same checks.

**From chat**, two actions:
- `check_update {}` (read, outside text) gives `{installed: {build, tree}, newest: {tree, tested, testedAt}, files, protected: [paths], subjects: [up to 10 lines, labelled as data]}`.
- `install_update {tree}` or `{pr, head}` (change, owner only, never a saved-workflow step). It always asks one button: "Install build X? 4 files changed. Tested on GitHub at 14:02." Yes starts an `update` operation, which starts `pull.sh install` outside the service with `systemd-run --user`, as `undoUpdate` does. Refused while other operations run, as undo is. The operation, or the service once it is back after the restart (the new build, or the old one after a put-back), reads the result once and says in the chat that asked: kept, or not kept and why. No result after 15 minutes is said too.

**How the owner says yes (default):** the button in the owner's own chat on the page; no passkey on the tailnet, the passkey from an internet sign-in (as `undo_update`, R31). Never from Telegram, an agent or a saved workflow: those get "this waits in Spark Console". The button lists any protected paths (2.5); for a change Sparkie proposed, those need the passkey. Nothing installs by itself. Changed workflows stay off until their first real use validates them (R18); "Test the changes" is not started by itself, since it wakes Sparks.

### 2.4 Affected tests only

The pick never decides an install; the full run on GitHub always follows. A wrong pick costs time, not safety.

- **The map is recorded, not hand-kept** (a hand table would rot: the 37 parts call each other freely). In shard mode each test file runs with Node's own coverage recording (`NODE_V8_COVERAGE`). `tools/affected.mjs build` turns that into `test/affected-map.json`: for every function in every part, the test files that ran it: `{tree, tests: [...], fns: {"21-apps.mjs:keepApp@120-188": [3, 17]}, missed: []}`. It rides in the tested tag, so it always matches the tree a change starts from.
- **`node tools/affected.mjs pick`** (any computer, the `quick` job, a workspace): changed lines from `git diff` against the base, the test files that ran those functions, every changed test file, and always the **short check**: `build`, `fleet`, `api`, `door`, `passkey`, `internet`, `sparkie`, `install`, `go-back` (everything starts and answers, sign-in works, the installer can still read the service).
- **Always the whole suite:** no map for the base tree; a part added, removed or renamed; a changed line outside any function; a function most test files run; more than 8 parts changed; any change to `01-setup`, `02-ssh`, `03-identity`, `03-secrets`, `07-jobs`, `14-chats`, `16-actions`, `17-changes`, `18-workflows`, `20-mcp`, `22-passkey`, `22-sessions`, `24-handler`, `25-backup-and-start`, `passkey.mjs`, `dig.mjs`, `worker.py`, `config.json`, `deploy/**`, `test/lib.mjs`, `test/start-mock.mjs`, `test/mock/**`, `test/lock.mjs`, `tools/**`, `.github/**`. These are sign-in, lock-out safety, Sparkie's own rules and the one way to change a Spark.
- **A wrong pick is caught** by the `mark` job: a file that failed in the full run but was not picked is printed as "missed by the pick" and written to `missed`; the next pick adds it for those functions.

### 2.5 Sparkie changing itself

Needed from the workspace design (its 2.9 asks for "a way to put the console's source into a box"): a `node` workspace on a compute Spark that Spark Console's code, never the brain, can fill from a tar stream and read back as one; no secret and no git needed inside it. Default (decision 15): GitHub's `quick` job is the test bench, about 3 minutes a try; the box runs the build and the close tests only when a compute Spark is already on.

1. The owner asks in chat. `change_start {work}` (change): Spark Console copies `main`'s tree from its bare copy into the workspace and notes the commit. Sparkie reads `AGENTS.md` and the map (sections 6 and 7), edits parts with the workspace's own tools and adds a test that fails without the change.
2. `change_propose {work, title, why}` (change; the owner's own chat only). Spark Console, by code: reads the workspace back and builds the diff itself against the noted commit; rebuilds `server.mjs` and the code map itself; refuses any path under `.github/`; lists protected paths and every removed or edited line in an existing test; commits; pushes `sparkie/<id>`; opens the pull request. Limits: 6 pushes a change, 3 changes open, and no more proposals once its own runs have used 1,000 minutes in a month.
3. GitHub runs `quick`, the shards and `mark`. `change_status {pr}` (read, outside text) gives the state, the failed test names and the reviews. Sparkie fixes and proposes again until the run passes.
4. **An independent reviewer**, after the run passes and before the owner is asked. Sparkie asks on the pull request for one of the owner's other agents (not the brain's model; decision 12 names Fable for reviews). A review counts only when GitHub says its author is a reviewer app named in `config.json`, never the account Sparkie's token belongs to. **If nobody answers in 30 minutes** the change waits and Sparkie says so once. An ordinary change can still go in, by a button that says "Install without a review". A protected one cannot.
5. **What the owner is shown**, built by code from git and GitHub, not from Sparkie's words: the title; Sparkie's reason (marked as its words); files with lines added and removed; protected paths; tests added or edited; the run (tests passed, minutes, link); the review (who, verdict, findings) or "nobody else reviewed this"; three buttons: Install it, Show the diff, Drop it.
6. **Yes** runs `install_update {pr, head}`: merge the pull request only if its head is still the one shown, wait for the mark of `main`'s new tree (already there unless `main` moved), then 2.3.
7. **After**: the installer's checks, then Sparkie does the owner's original request the way the owner would and reports. **Rollback**: the installer's own put-back, `/undo update`, or `go-back.sh`. An undone tree is recorded in `updates.json` and not offered again; "revert that" is a new pull request through the same steps.

For this step the token gains Contents: write and Pull requests: write, and never Workflows (that permission exists for fine-grained tokens: verified; that a git push is refused without it is verified for classic tokens and inference here, so step 8 tests it). Code pushes only to `sparkie/*`, never by force.

**What Sparkie may never change on its own word** (it takes the passkey, on the page, with the paths named on the button): every path in the "always the whole suite" list (of `tools/`, only `build-server.mjs` and `affected.mjs`); `AGENTS.md`, `docs/architecture.md` and `docs/contract.md`; any removed or edited line in an existing test. Adding tests is free. `.github/**` is refused outright. SSH, Tailscale, the firewall, users and the access and passkey files are not in the repo and stay out of reach (R3).

### 2.6 What else is free on GitHub (decision 15)

- **A news feed, built there.** "No scheduled jobs" is about electricity on the Sparks; this costs only free minutes. A scheduled job, once a day, `tools/news.mjs`, no key of the owner's. It checks the newest release of each engine against the images pinned in `config.json` (vLLM, SGLang, llama.cpp, TensorRT-LLM); models new or updated since the last feed from the publishers already in the catalog (size, quantization, gated or not); and which files changed in the three recipe sources Spark Console reads (`11-setups.mjs:58-83`). It writes `news.json` to the `news` branch, only when something changed: `{at, engines: [{name, pinned, newest, publishedAt, url}], models: [{repo, updatedAt, sizeGB, quant, gated}], recipes: [{source, head, changed: []}]}`. Facts only: no command, no free text beyond a release name. Spark 2 gets it on its next fetch, when the owner asks (`whats_new {since?, kind?}`, read, outside text), never on a timer, and then looks up setups only for models whose sources changed, so the daily timer on Spark 2 can go (`11-setups.mjs:245-258`). It cannot rebuild `catalog.json`: that is made from research files gathered by hand (`tools/build-catalog.py:5-11`), so a catalog change stays a pull request. Cost: about 1 minute a day, 30 a month. GitHub's docs say scheduled jobs may start late and are switched off after 60 days without activity "in a public repository"; a private one is not mentioned, so Sparkie says so when the feed is over 3 days old.
- **A workbench on any device: Codespaces.** Verified on the docs: 120 core hours and 15 GB a month free for a personal account, about 60 hours on the 2-core machine (the page's multiplier of 2); stored codespaces count against the 15 GB. It is Linux, so the suite runs there once the fixes in 2.2 are in. Use: edit and run the close tests from a tablet or a borrowed computer, or give an agent a place to work. One file, `.devcontainer/devcontainer.json`. It never joins the tailnet and never holds a fleet key. The gate stays on Actions.
- **Releases for the install package: noise.** The tested tag is the package.
- **Issues as the "later" list: noise.** `docs/` is the list; it is pulled with the code and any brain can read it.
- **Issues as Sparkie's "waiting for you" list: no.** It would send fleet state out (the map's section 6 forbids it); `/status` and the needs-me line already do it. Open pull requests are the list of changes waiting for a yes.

### 2.7 Working across computers

A new computer needs git, Node, Python 3 and bash, or a Codespace. Clone, read `AGENTS.md`, edit parts, `node tools/build-server.mjs`, `node tools/affected.mjs pick` and run those files, push a branch, open a pull request, wait about 15 minutes, then say "install the update" in chat. It never needs SSH to a Spark, the lock or any fleet key.

**Only on Spark 2:** the installed build and its snapshots; the state folder (access, passkeys, sessions, chats, memory, journal, lessons, validations, the should-run list, proven runs, the update record); the secrets file with the GitHub token; the bare copy of the repo.

**Before the first push:** the key-shaped strings in the tree are test fakes (first characters checked); 54 files carry the owner's user name, tailnet name or address, which a private repo may hold; `.gitignore` gets `.claude/`, `.DS_Store`, `node_modules/`, `*.zip`, `__pycache__/`, `test-results/`.

## 3. Rules

**Kept:** R3 (HTTPS token, `SKIP_ROUTES`: no SSH or Tailscale change), R10 (git runs through `run` on Spark 2), R11 (new actions through `runAction`; the install is an operation), R20 (new state through `writePrivate` and `readKept`), R22 (the lock's one writer is still `test/lock.mjs`), R25 and R26 (commit subjects, run logs, reviews and news are outside text; intent comes from the owner's words), R28 (`server.mjs` rebuilt by code), R32 (the token lives in the secrets file; Telegram cannot approve an update).

**Must change:**
- **R29**, now "`node test/lock.mjs` passes on the exact tree before installing ... The installer compares only the lock's build id". New: "Every test file passed on the exact git tree before installing: on GitHub in parts (`--shard`, then `--mark`, which checks every file has a passing record for this tree) or on one machine. The lock names the build and the tree. `pull.sh` installs only a commit on `main` whose tree has a `tested/` tag."
- **R22**: the lock's two new modes. **R31**: `install_update` joins `undo_update`. **R30**: `pull.sh` joins `RECOVERY_FILES`; add `update-result.json`, `SKIP_ROUTES` and the test switch `SPARK_CONSOLE_REPO_URL` (only with `SPARK_CONSOLE_ALL_LOCAL=1`).
- **Section 4**: "Which build is tested" also lives in the tag; rows for `news.json`, `changes.json` (open proposals) and the GitHub entry in the secrets file. **Section 6**: a row "a protected path".
- **Contract 6.15 and 6.16**: the repository's home, no nightly commit of memory, the reviewer (2.5, step 4).

## 4. Build steps, in order

| # | Step | Files | Fails without it |
|---|---|---|---|
| 1 | First push and a measuring run. The draft with three changes: four jobs, each runs its share of the files one by one and never stops early; no `SLOW=3`; no artifact as the mark. It prints seconds and pass or fail per file | `.gitignore`, `.github/workflows/full-run.yml`, `AGENTS.md` (2.7) | Nothing in the suite; the proof is the run page listing all 46 files |
| 2 | Pass on Linux: `SPARK_MEMINFO`, the Hugging Face switch, whatever step 1 lists | `02-ssh`, `05-library`, `13-main-model`, `10-recipes`, `start-mock.mjs` | The memory tests in `change`, `apps` and `across` (they fail on Linux today) |
| 3 | Shards and the mark | `test/lock.mjs`, `full-run.yml`, `.gitignore` (the lock), new `test/gate.test.mjs` | `--mark` refuses a file with no record, a failed record, a record from another tree |
| 4 | Pull install, by hand first: `pull.sh setup`, then `pull.sh install`. The build holding this step is the last one installed from the Mac | `deploy/pull.sh`, `host-on-portal.sh` (`SKIP_ROUTES`, `RECOVERY_FILES`), new `test/pull.test.mjs` | Against a local bare repo: installs the tagged tree; refuses an untagged head, a tag that changes other files, a lock for another tree; never calls tailscale, sudo or ssh |
| 5 | From chat: `check_update`, `install_update`, the result told after the restart; `PUT /github` | `18-workflows`, `16-actions`, `24-handler`, `test/lib.mjs`, `updates.test.mjs` | The button is asked; Telegram and agents get "waits in Spark Console"; refused while operations run |
| 6 | Affected tests | `tools/affected.mjs`, `test/lock.mjs`, `full-run.yml`, new `test/affected.test.mjs` | A made-up map and diffs give the right files; each "always" path and a missing map answer "all" |
| 7 | News feed | `tools/news.mjs`, `.github/workflows/news.yml`, `whats_new`, `11-setups` (the timer) | Canned answers give the shape; `whats_new` is labelled outside text |
| 8 | Sparkie's changes (needs the workspace) | a new part for `change_start`, `change_propose` and `change_status`, `test/mock/github.mjs`, new `test/selfchange.test.mjs` | `.github/` refused; an edited test line gives a passkey button naming it; merge only at the shown head; no review says so |
| 9 | Codespace file | `.devcontainer/devcontainer.json` | Nothing; the proof is opening one and running one test file |

Each step ships alone. Steps 1 to 5 end the laptop-only install; 6 and 7 are savings; 8 waits on the workspace. Every new action also goes in `TOOLS` or `CHANGE_TOOLS`, the counts and the door and fuzz tables, and each step updates the map.

## 5. Risks and open questions

- **The free plan cannot protect a private repo.** GitHub's docs: protected branches and rulesets for private repositories need a paid plan. Anyone holding a write key can push to `main` or push a `tested/` tag by hand. So the mark guards against accidents, not against a writer who means harm. What guards against that: only the owner's computers and (from step 8) one narrow token can write; that token cannot touch workflow files; the owner's yes is asked on facts built by code; protected paths need the passkey.
- **A pull request can edit the workflow that marks it.** So `.github/**` is refused for Sparkie and always shown.
- **Minutes.** A loop of pushes could spend the month. Guards: `quick` fails fast, newer pushes cancel older runs, Sparkie's limits. Past the allowance GitHub stops running jobs; the by-hand gate still works.
- **Mac and Linux disagree.** GitHub is the judge. Step 2 may also find real faults in the installer's Spark 2 half.
- **The token expires**: the pull then fails, says so, and goes on the "needs you" list. **Git on Spark 2** is assumed (inference); if it is missing, the owner runs one `apt install git`.
- **Coverage can miss** a service that was killed before it wrote its record. The pick is then too small and the full run still catches it.

**Defaults chosen (decision 16), no answer needed:** the mark is a tag; an HTTPS token, not an SSH key; yes on the page only, never Telegram; nothing installs or merges by itself; GitHub is Sparkie's test bench; the news job runs daily; "Test the changes" is not started by itself; docs-only pushes wait for the next code change.

**One question** (a wrong guess could lose history): before step 8, pay for GitHub Pro (about $4 a month, from memory, not checked today) so `main` and the `tested/` tags can be protected? Without it a confused push from Spark 2 could rewrite `main` on GitHub. Recommended: stay free. Code pushes only to `sparkie/*` and never by force, and Spark 2's copy and every computer hold the full history. Revisit when a second person or agent gets a write key.

## 6. Left out on purpose

- The Keeper (contract 8.13), signing the mark, and asking GitHub's API whether the run really passed: more parts than the owner's yes on code-built facts needs.
- A self-hosted runner, or Tailscale inside a GitHub job or a Codespace: each is a route into the Sparks.
- Installing by itself, merging by itself, and Sparkie approving its own change.
- Committing memory, the journal or any state to the repo, nightly or ever (decision 6).
- Picking single tests instead of whole files; a coverage percentage as a goal; caches (there are no packages).
- macOS runners (ten times the price) and the 1-core runner (a third of the price; worth one measured try later).
- A GitHub App in place of the token (hourly tokens, more code); a copy of the repo for editing on Spark 2.
- Carrying a mark across a docs-only push: it would loosen R29 to save minutes.

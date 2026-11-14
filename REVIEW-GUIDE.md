# Review guide for Astra

This is the whole Spark Console folder as of 2026-11-13, with nothing left out. It is the finished app after the final
build-out. Please review it for bugs, gaps and suggestions. This page says what to read, what changed, what was left
out on purpose, how it was checked, and how it gets installed.

There are two things to review. Sections 1 to 9 cover **the app as built**. Section 10 covers **the plan for the next
phase** (`docs/design-2026-11-13/`), which matters as much: please review it in the same detail.

## 1. What Spark Console is

The owner has several NVIDIA DGX Sparks. Spark Console is one hub for all of them. It runs on Spark 2 and has one
address: `https://akspark2.tailab9aa9.ts.net:8443`. It can be reached on the owner's tailnet, or from the internet
behind a passkey sign-in.

The owner uses it in only two ways: by talking to **Sparkie** and through the **APIs**. Sparkie is the console's chat
brain, a Qwen model on Spark 2, and the owner talks to it on the page or on Telegram. The page is just chat, sign-in and
status.

Sparkie and the APIs run anything the owner asks for on Spark 3, Spark 4, or any Spark added later:

- models, started with their best setup;
- GPU apps such as Open WebUI, Jupyter, code-server and ComfyUI;
- dev boxes;
- one-off jobs;
- small stacks.

Spark 2 runs only the console and the brain. Once signed in, by whatever means, the owner reaches every Spark as one
environment, with no second password. The owner's own agents reach Sparkie through the agent door (MCP), which uses one
key per agent.

## 2. Reading order

1. **`AGENTS.md`.** The layout, how to work, and the rules that are never broken.
2. **`docs/architecture.md`.** How it is built today:
   - the diagram;
   - one sentence followed from chat to a running model;
   - who holds each fact;
   - rules R1–R40;
   - where new things go;
   - the checklist before an install;
   - known traps.
3. **`docs/code-map.md`.** Every part, action, state file, timer and function, generated from the code.
4. **`docs/contract.md`.** What the product must do and why. It is long, so search it rather than reading it all.
5. **`docs/analysis-2026-11-11/`.** The record of the analyses and reviews that drove this build. Start with:
   - `README.md` (the owner's decisions);
   - `14-trimmed-plan.md` (what was chosen to build);
   - `17-build-specs.json` and `19-any-workload-spec.json` (the exact specs).
6. **`docs/reviews-2026-11-11.md`.** The earlier reviews and their "next, in order" list.
7. **`test/README.md`.** What each test file covers, and how the stand-in fleet works.

Other docs:

| File | Covers |
|---|---|
| `docs/sharing.md` | The internet sign-in and members |
| `docs/agent-door.md` | MCP for the owner's agents |
| `docs/recipes.md` | How setups are found for a model |
| `docs/multi-spark.md` | One model across two Sparks |
| `docs/sparkie-actions.md` | What Sparkie may do on its own |

## 3. Where the code is

| Path | What it is |
|---|---|
| `service/src/NN-*.mjs` | The service, in 37 parts. **This is the code to review.** |
| `service/server.mjs` | Generated: the parts joined in order. The installer and tests refuse a copy that doesn't match the parts. |
| `service/dig.mjs`, `service/passkey.mjs`, `service/worker.py` | Reading setups from recipes and model cards; passkeys (WebAuthn); the worker run on each Spark. |
| `service/config.json`, `service/catalog.json` | The Sparks, images and the brain's setups; the Recipes catalog. |
| `service/workflows.lock.json` | Written by the full test gate. It records which workflow versions passed. |
| `public/` | The page: plain JavaScript, no build step. |
| `deploy/` | Install, go-back and recovery scripts, plus the two internet switches. |
| `tools/` | Build tools and the `console.mjs` / `spark.mjs` command-line tools. |
| `test/` | The suite (`*.test.mjs`), the stand-in fleet (`test/mock/`, `test/start-mock.mjs`) and the gate (`test/lock.mjs`). |
| `agentbar/` | A small benchmark that grades coding agents on a Spark. It is not part of the running console. |

## 4. What changed in this build-out (2026-11-12 and 13)

The items came from the trimmed plan (`docs/analysis-2026-11-11/14-trimmed-plan.md`), and the IDs match it. Each group
went through the same steps:

1. Built by Opus 5.5 at extra-high effort, in its own copy of the tree.
2. Reviewed by Fable 5.2 at extra-high effort under a strict bar: fix only what breaks real use, could lock the owner
   out, could lose data or stop a healthy model, could leak a key, or could leave the console dead or stuck.
3. Review findings fixed by Opus 5.5, each with a test that fails without the fix.

### Everyday additions (A7, A8, A12)

- **A7. What a model runs with.** "What is GLM running with?" is answered through `running_models {detail}`.
- **A8. Files on a Spark.** List files, read one, and save one small text file in the workspace folder.
- **A12. Keep an app running.** "Keep Open WebUI on Spark 3 running, give me its link", for any app on Spark 3 or 4.

### Installs (F4, H1, S5)

- **F4. The installer checks the new build.** It checks that the build settles, that the ways in work, and one chat
  turn. On a miss it goes back by itself. `restore.sh` always starts the unit again.
- **H1. By-hand recovery.** `go-back.sh` and `RECOVERY.txt` sit at a fixed path on Spark 2. The signed-in page has an
  `/undo update` word.
- **S5. One update record.** It reads "now build X, was Y", and the last five show in `sparkie_setup`.
- **Review fixes:**
  - "went back" is now told apart from a fresh install;
  - a go-back past a broken build reaches the last good build in one step.

### Web lookup (R39)

- Sparkie can search the web (`search_web`) and read a page (`read_page`), so it can learn about models and tools that
  are newer than it is, with no update needed.
- Search terms go out with keys and the fleet's own names and addresses hidden.
- A page is read only from an address the owner wrote or a search returned. It must be public, and that is checked as
  each hop connects.
- What comes back is outside text, which never counts as the owner's words.
- **Review fixes:** three, each with a test.

### Chat (F2, F3, F7, F8, F13, F25, H2, H3, A1)

- **F2. A chat never stays stuck.** A throw or a full disk no longer leaves it "still answering".
- **F3 and H2. The brain comes back.** `/restart sparkie` also starts a stopped or missing brain from its saved setup.
  A brain the console left down comes back by itself.
- **F8.** "Do X, then Y" no longer stalls.
- **F7.** A carry-on turn from an internet sign-in still asks for the passkey before an undo.
- **F13.** Telegram survives a bad secrets read.
- **F25 and H3.** The owner's own failures no longer pause agents. Errors and crashes leave a record Sparkie can read.
- **A1. Chat commands.** `/pause`, `/restart sparkie` and `/stop` work on Telegram, and `/stop` works on the page.
- **Review fixes:**
  - a stopped brain is started from its setup, not restarted in place;
  - a chat save that fails during a full disk is recorded as a fault.

### App door (R40)

- Port `:10000` on the same name opens the apps the console runs: Open WebUI, Jupyter and the like, on any Spark except
  Spark 2. It is for the owner only, after sign-in. It needs no second password, and the owner doesn't need Tailscale on
  that device.
- The door is a separate origin with its own ticket cookie. It holds one app per browser, with a confirm page when
  switching. It is off until the owner runs `deploy/open-apps-to-internet.sh`.
- **Review fixes:** four. Two smaller points are documented instead: 2(c), and telling tabs apart.

### Fleet (F6, F16, F12, S1, S2, F17, H4, A2, H5)

- **F6.** Docker not answering no longer reads as "every container removed", so it can't stop a healthy part.
- **F16.** A powered-off Spark's containers no longer read as running.
- **F12.** Writers no longer save over `desired.json` or `validations.json` after a failed read.
- **S1 and S2.** State files survive a power cut: they are synced to disk and keep a previous copy. `access.json` keeps
  a last-good copy.
- **F17. The daily backup.** It retries, never fails silently, checks the archive, and records the last good copy.
- **H4, A2 and H5. One "needs you" list.** It holds at most 8 lines and feeds three places:
  - "Anything need me?";
  - `/status`;
  - Sparkie's notes.

  There is also one optional "needs me" Telegram line, at most 3 a day.
- **Review fixes:** four.

### Start (A9, F9, F10, F11, F18, A3, A5, F20) and any workload (A13)

- **A9.** "Start nvidia/<new model> with its best setup" finds setups for a model it hasn't seen before and adds the
  model to Recipes.
- **F9.** A one-Spark start over a running copy no longer removes the working container.
- **F10.** A routine run twice no longer restarts a model that is already running.
- **F11.** A yes for a two-Spark start can't start a one-Spark model.
- **F18.** The recovery-code button shows even with no passkey on file.
- **A3 and A5.** "What can you do?" is answered from the live action list. "Who is signed in, and how many recovery
  codes are left?" has an answer.
- **F20. Saving a routine from chat.** It becomes a button that lists its steps, unless the owner's own words named
  each step. A key typed in chat is hidden.
- **A13. Any workload.** `keep_running` now takes `gpu`, `command` and `once`. That covers:
  - GPU apps;
  - dev boxes with no password (the owner's choice);
  - one-off jobs with an end line in the chat that asked;
  - small stacks.

  It runs on Spark 3, 4 or any Spark added later, never on Spark 2.
- **Review fixes** (six; see section 7):
  1. Job folders kept growing until no new job could start on that Spark.
  2. A re-run could report the previous run's exit code.
  3. A hostile model card could block the process for a long time.
  4. An agent could re-run a job or start a stopped GPU app without the owner's yes.
  5. Dev boxes (Jupyter, code-server) are now really started with no sign-in.
  6. A key in a step's settings is masked on the save button.

### Small fix found in a page check

The home page offered "Start a model across Spark 2 + Spark 3", which could only fail, because nothing starts on
Spark 2. Pairs that include the brain's Spark no longer show a Start button.

### Three bugs found by the last full test runs

On a busy machine, the last full run of the tests failed in three files that had passed twice before. Two real races
were behind it, and each now has a test that fails without its fix.

1. **Bringing a model back after a power-on** (`service/src/20-heal.mjs`, `healReason`). Right after the owner powers
   Sparks back on, the console may not have read their containers again yet. What it last saw, from before the power
   went, still said the model's parts were running. Self-healing then brought the model back at once as "a part
   stopped". It didn't wait the 2 minutes for Docker and the GPU to settle, and it skipped the guard that leaves a model
   alone if its Spark goes down again within 30 minutes. It now reads how each part ended ("Exited (255) …") from what
   the Spark shows now. With smart plugs turning Sparks off and on, this would have come up often. Test:
   `test/heal-power.test.mjs`.
2. **A false "should be running but isn't"** (`service/src/20-desired.mjs`, `desiredNow`). The list of what should be
   running was read while a stop of one of its models was still under way. The look at the Sparks that went with it came
   back after the stop had ended. With no operation running any more, the model showed as held, and the owner got a
   notice that it should be running but wasn't. A Spark where an operation ended after the look began now counts as
   "changing" until a fresh look. Test: `test/desired-look.test.mjs`. It slows the stand-in Docker so the stop ends while
   the look is under way.

A later full run passed 992 of 993 tests and failed one that had passed the run before. A third real race was behind it.

3. **Two healers going for one Spark** (`service/src/20-heal.mjs`, `healPass` and `displacedBy`; `service/src/20-desired.mjs`,
   `desiredAfter`). A two-Spark model was down, and the owner had started a newer model on one of its Sparks. When the
   newer model crashed, the watcher went to restart it while the healing pass went to bring the older pair back. When
   the pass got there first, the pair started in the newer model’s place, the restart was refused ("Something is already
   changing on Spark 3"), and the owner’s newer model stayed down. Self-healing now brings back only the newest model
   wanted on a Spark: an older entry that shares the Spark stays down while the newer one is on the list, whether that one is running or
   down. An entry the owner starts again by hand becomes the newest, so it is healed as before. Test:
   `test/heal-displaced.test.mjs` (its second test fails without the first half of the fix, its third without the second
   half). The test that first showed it, `test/heal-newer.test.mjs`, now says what happened when it misses.

## 5. Owner decisions that shape the code

These are the owner's choices, not oversights. Please question them only if one causes real harm.

- **No lock-outs.** Nothing may lock the owner out. SSH, Tailscale, the firewall and user accounts are changed only by
  the owner, never by the console.
- **One brain.** Sparkie's brain is Qwen on Spark 2. There is no fallback brain, and only the owner swaps in a newer
  model.
- **Spark 2's job.** Spark 2 runs only the console and the brain. Workloads go to Spark 3, 4 or later Sparks, and are
  never hard-coded to Spark ids.
- **One address and sign-in.** The console has one address. It is open to the internet only behind a passkey. The app
  door on `:10000` is the one approved exception, and it is for apps only.
- **No second password.** Once signed in, the owner reaches every Spark as one environment. Dev boxes run with no
  password; they are reachable only on the Spark's own address, the tailnet, and the signed-in app door.
- **Protected containers.** `qwen-recipe-*` containers and anything labelled `spark.protect=true` are never stopped.
- **The owner approves changes.** Console updates and any change Sparkie makes to itself need the owner's yes. Everyday
  requests don't.
- **Secrets.** The owner's password and tokens are never stored. Keys are masked everywhere they could be shown.
- **One GPU workload per Spark** for now. A model and a GPU app don't share a Spark.

## 6. Left for later on purpose

These were found and judged not to break real use under the strict bar. Suggestions on any of them are welcome.

**Chat**
- A carry-on retry every minute, and a notice when it gives up.
- A `/resume` word.
- `/stop` on Telegram right after `/new`.

**Web lookup**
- SearXNG and real DuckDuckGo results were only tested with stand-ins, because the sandbox has no network.
- There is no page cache.
- Brotli decompression keeps running after the size cut.

**App door**
- One app per browser at a time. An old tab's saves go to the newly opened app.
- There is no fresh-passkey rule for the door (the owner's choice).
- The door ticket also reaches the app on `:443`.
- No-cors GETs can reach read routes.
- The editor guard has only a throwaway proof.

**Fleet**
- `running_models` and `container_logs` still read a Spark whose Docker is down as empty.
- No fsync yet for chats, `main.json`, energy and secrets.
- Backups don't include a copy of the source.
- No checks yet for Tailscale key expiry, linger, or Funnel being off.
- The needs-me list isn't in `sparkie_setup`.
- Self-healing's own pass (`healPass` in `20-heal.mjs`) can still use a shared look from just before an operation ended.
  For it to act wrongly, the look must show a two-Spark model's parts down while its start was ending, and a start only
  ends after the model answers. So the window is very narrow. The fix is the same as for `desiredNow`: a Spark where an
  operation ended after the look began waits for the next pass.
- After a power-on, self-healing can still count an older power-on until the status check (every 30 seconds) sees the
  Spark back. If that older power-on is under 6 hours old and wasn't acted on for this model, the model comes back
  without the 2-minute settle wait. Docker must already be answering there, so the start usually works; a failed one
  uses one of the two tries in 6 hours. The older code had the same path once the watcher had looked. The fix is one
  line in `healReason`: wait while the status check still has the Spark as off (`sparkOff`). It goes in with the
  smart-plug work, which turns Sparks off and on often and will have its own full test run.
- Left from the review of the two-healers fix (section 4, item 3):
  - When the newer model leaves the list (stopped, forgotten or undone), the older one may start by itself within one
    healing pass, because it still has its two tries. During an undo it can take the Spark between the undo's stop and
    its restart, and the restart is then refused.
  - A GPU app or job that the owner started on the Spark since is not counted as "newer": list entries don't record
    the GPU. There the old guard still holds (the bring-back is refused because it never stops anything else), but
    the same race is open if that app goes down.
  - That old guard is no longer tested for self-healing on its own: the existing test now passes on the new skip.
  - A two-Spark entry whose model is started again on one Spark keeps both Sparks in its entry and becomes the newest,
    so it can hold back a model on the other Spark.
  - When the newer model is down for good, the older one waits until the owner forgets the newer one or starts the
    older one by hand.

**Start and any workload**
- The A13 spec's "left out" list in `19-any-workload-spec.json`:
  - no `run_job` tool;
  - no "then do Y when the job ends";
  - no model and GPU app on one Spark;
  - no app secrets;
  - no compose or Docker networks.
- `--auth none` is stored masked in saved chats.

**Waiting until proven**
- Sparkie patching its own code waits on a trial of Qwen's coding.
- Node on Spark 2.
- Deleting the old members, editor and setups (D12).

**Skipped in the trimmed plan:** H6–H10, S3, S4, S6–S12, F14, F15, F19, F21, F22, F24, A4, A6, A10, A11, and D9–D11.

## 7. How it was checked

- **Unit and flow tests.** Every change has a test that fails without it. The suite runs against a stand-in fleet: bash
  scripts that act like Docker, `nvidia-smi` and SSH on each Spark. It never touches the real Sparks.
- **The full gate.** `node test/lock.mjs` runs every test file strictly and writes `service/workflows.lock.json` only if
  all of them pass. The installer refuses a lock that doesn't match this exact code.
  - Result for this folder: **GATE_RESULT**.
- **Reviews.** Each group had a Fable 5.2 review at extra-high effort, and every finding was either fixed with a test or
  put on the later list above.
- **Test fixes on the last day.** None loosened a check. (The three code fixes found that day are in section 4.)
  - `test/sparkie-more.test.mjs`: Sparkie kept carrying on in one test's chat after that test had ended, and the
    leftover turn took the next test's one-time model failure. Each carry-on test now waits for its own chat to go
    quiet.
  - `test/dark.test.mjs`: the test waited a fixed 5 seconds for the other Sparks to be looked at again. On a loaded
    machine that look took longer. It now waits for the next look, with a time limit that scales with machine speed.
  - `test/heal-newer.test.mjs`: when self-healing doesn't restart a crashed model in time, the failure now lists what
    happened on that Spark meanwhile, not just "timed out".
- **Page.** The page was checked in a browser against the stand-in fleet: no console errors, the "Needs you" line, the
  Telegram and agent panels, and the pair buttons.
- **Not checked yet: the live run.** Nothing in this build has run on the real Sparks. That happens after the install
  (section 8).
- **Hand checks still open:**
  - the F18 button and the F20 line wrap on a phone;
  - A3 and A5 with the live brain;
  - whether `--memory` bounds GPU memory (compare `docker stats` with `nvidia-smi`);
  - whether a container reaches its Spark's tailnet address (for stacks).

**How to run the tests yourself** (Node 22 or newer, macOS or Linux; tests bind local ports):

```bash
cd spark-console
SPARK_TEST_STRICT=1 SPARK_TEST_SLOW=3 node --test test/apps.test.mjs
SPARK_TEST_SLOW=3 SPARK_TEST_CONCURRENCY=1 node test/lock.mjs
```

On a busy Mac, run the gate one file at a time (`SPARK_TEST_CONCURRENCY=1`). With two files at once, two stand-in fleets
compete for the machine. Two tests that take seconds alone then ran out of time. Both pass alone and one file at a time.

After changing a part, rebuild before testing: `node tools/build-server.mjs && node tools/code-map.mjs`.

## 8. Install and the checks after it

The install runs from the owner's Mac:

```bash
NOTE='Final build-out: installs, chat, web lookup, app door, fleet, start and any workload' bash spark-console/deploy/host-on-portal.sh
```

What the installer does:

1. It saves the current build and its state.
2. It installs the new build.
3. It waits for the new build to stay up for 40 seconds.
4. It checks the ways in, the agent door, the model address and one chat turn with Sparkie.
5. On any miss, it puts the old build back by itself.

If the console ever stops answering, run `bash ~/.local/share/spark-console/go-back.sh` on Spark 2.

To turn on the app door (optional), run this once:

```bash
bash spark-console/deploy/open-apps-to-internet.sh
```

To close the app door again, add `--undo`.

After the install, with Spark 3 or Spark 4 powered on, run these checks through Sparkie's chat:

1. **One live start, check and stop** of a small model on Spark 3 or 4. This proves the new `start_model` and
   `restart_model` versions on real hardware.
2. **One start across Spark 3 and 4.** This proves `start_model_across`.
3. **"Find setups for <a model>".** This proves `find_setups`.
4. **"Give me a Jupyter box on Spark 3"**, then open its link, then "stop it". This checks no password, the link, and
   the stop.
5. **One short job**, for example "run `nvidia-smi` once on Spark 4". The end line should come back in the same chat.
6. **"What should be running?"** Before this build, starting a model again by hand did not make it the newest wish for
   its Spark. If the list shows a model that is running and, on one of its Sparks, another model that is held and was
   started later, say "forget <the held one>". Otherwise self-healing would leave the running one down after its next
   crash or power-on, waiting for the held one.

## 9. What would help most from a review

- Anything that could **lock the owner out**:
  - sign-in;
  - recovery codes;
  - the installer's go-back;
  - the internet switches.
- Anything that could **stop or remove a healthy model**, or a `qwen-recipe-*` container.
- Anything that could **lose data**: chats, `access.json`, backups, the owner's files.
- **Keys or tokens** that could show up in chat, logs, the page, Telegram or saved routines.
- Places where Sparkie could **claim something happened** when no tool said so.
- **Outside text** (web pages, model cards, files) that could make Sparkie act as if the owner had asked.
- Whether the page and Sparkie's words stay **plain and calm** for a non-expert.

## 10. The next phase: please review the plan too, as hard as the code

After this build, the owner wants Sparkie to work the way a coding agent does: command every Spark and itself, learn
from everything it does, run with any brain model, and stay fast and simple. That phase was designed on 2026-11-13. Its
first milestone is being built; nothing of it is in this build unless section 4 names it. A plan is cheaper to fix than
code, so a detailed review here is worth more than anywhere else.

**Where it is:** `docs/design-2026-11-13/`. Read in this order:

1. `README.md`: the whole phase in one page (the goal, the owner's decisions, the shape, how Sparkie's permissions
   work, memory, six milestones, safety changes, defaults taken, risks accepted). Where a design disagrees with this
   page, this page wins.
2. `owner-decisions.md`: the owner's 22 decisions, in their own words.
3. `critic-safety.md` (29 findings) and `critic-simplicity.md` (what was cut, and why).
4. The seven designs: `a-workspace.md` (commands on the Sparks, root, the net, "always allow"), `b-learning.md` (the
   journal and lessons), `c-github-selfchange.md` (tests and the tested mark on GitHub, installs pulled by Spark 2,
   Sparkie changing its own code), `d-fleet-workloads.md` (adding Sparks, the self-test, workflows that place and
   wait, a brain across Sparks), `e-unattended.md` (tasks, any brain, the heartbeat, rebuilding the hub, keys),
   `f-structure.md` (documents, the checker, the tool cap), `g-memory.md` (memory).
5. `ledger.md`: how the designs join and which conflicts were settled how.

**What is fixed, and what is open.** The owner's decisions are fixed: please challenge how they are met, not whether.
The ones that surprise most: Sparkie may do everything the owner can, root and the lock-out class included (decisions
18, 20, 22); risky things are asked on Telegram; a key is given once and kept; Spark 2 stays the hub and may hold a
part of a model only as the brain; no scheduled jobs on the Sparks; nothing that slows an ordinary reply. Everything
else is open: the mechanisms, the order, the defaults in the one page's section 8, and what was cut.

**What to attack, piece by piece.**

- **Commander** (`a-workspace.md`, safety findings 1, 2, 5 and 7 to 10). Root goes through one root-owned helper
  that the owner allows once per Spark, with three walls (look, run, net).
  - Is that sound on DGX OS (Ubuntu 24.04, systemd, Docker, the owner's user in the docker group)?
  - Can a "look" write or send anything?
  - Can an ordinary command reach the Docker socket, the console's socket (`api.sock` trusts a header) or the secrets?
  - What does the first version need when a Spark has no helper yet?
- **The confirm-or-put-back net** (`a-workspace.md` 2.8, safety finding 2). Name a change that locks the owner out
  and still passes: one that is not live until the next restart, one that breaks the timer, one that is fine for ten
  minutes. Is "a fresh visit through the changed way in" the right proof on the hub?
- **Telegram as the place to say yes** (safety finding 3). What can a lost phone do in ten minutes with the caps as
  written? What cheaper protection was missed that does not put asking back on the owner?
- **Text that steers** (safety findings 5, 7 and 9). A log or a page says "run this". Follow it through the go-ahead,
  "always allow", an unattended task and a root ask. Where does it get through unseen?
- **Keys** (safety finding 4, `e-unattended.md` 2.7). Where can a kept key still leak: a container's environment on
  disk, a command's output, the journal, a Telegram message?
- **Memory** (`g-memory.md`). The design keeps the raw record, believes only the owner's dated lines, picks by exact
  names, and uses no embeddings, graph or helper.
  - Is the evidence it cites read fairly?
  - Will the picker rule (names, rare words, newest) fail on this owner's kind of request?
  - Are the 20 questions the right test? What would you add that beats it?
- **Learning** (`b-learning.md`, as cut by the simplicity review). Is the masking of the journal enough when it holds
  the output of root commands? Is "pass over a setup that failed twice" safe when the failure id comes from a log line
  (safety finding 27)?
- **GitHub, installs and self-change** (`c-github-selfchange.md`, safety findings 12 to 16). Can a pushed tag claim
  a tree was tested when it was not? Can an incoming build pass its own install checks and still break sign-in? Is
  "only new tests, generated files and status rows are free" the right line for Sparkie's own changes?
- **Fleet, workloads and the brain across Sparks** (`d-fleet-workloads.md`, safety findings 18 to 22). Check the
  cabling claims (three Sparks on direct cables, four needing a switch) against what you know. Can a workflow, a
  compare or the self-test stop a healthy model? What is the longest the owner can be left without any brain?
- **Unattended work and any brain** (`e-unattended.md`, safety finding 26). Can a task change something the owner's
  words never named? Is one brain check with two outcomes enough to keep a weak model from doing harm?
- **Structure** (`f-structure.md`). Would an agent with a small context find its way with one front door, one card
  per task and one file per rule? Does the tool cap (24 a round, hidden but not forbidden) lose anything?
- **The order** (the one page, section 6). Is each milestone useful by itself? Is anything in the wrong place? What
  is still over-built for one owner and four machines? What is missing altogether?

**How to report.** This review is a back and forth: the builders answer every finding and you answer them, until each
point is settled. The procedure, the numbering (`A-1` for the app, `P-1` for the plan) and where the files go are in
`docs/review-astra/README.md`. Findings in order of severity. For each: the concrete way it goes wrong (who does what, what
happens), where (the design and section, and the code if it depends on the code), and the smallest change that closes
it. Mark each "must change before building", "change when that piece is built" or "accept, and tell the owner". End
with what the plan is missing, and with any decision in the one page's section 8 you would take the other way.

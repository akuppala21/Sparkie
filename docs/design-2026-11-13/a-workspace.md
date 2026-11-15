# A. Sparkie's hands: looks, the box, and commands on the Sparks (design, revised for decisions 18 to 22)

Amended 2026-11-14 after the first outside review (`docs/review-astra/reply-1.md`): P-1, P-2, P-5; items 7, 8, 9 and 14; clean-up 1; trash.
Amended again the same day: the root helper (new 2.13; 2.3, 2.5, 2.7 and 2.8 follow it; step 1 is now 1a and 1b).
Amended a third time the same day, for the build map's unclear items 2 and 3: the dangerous ask (new 2.14; step 10 is now 10a, 10b and 10c) and `minutes` on `run` (2.9, 2.10, step 6). Step 7 keeps what was read as a list (2.12).

Gap 1, revised for decision 22 ("everything means everything … permissions for risky ones to ask me on telegram"). A
design only: no code was changed, nothing was run. "Verified": read in the code today. "Inference": follows from what
I read or the web, not run. Paths are under `spark-console/`.

**In short.** Keep the console's own chat loop, give it seven typed tools, adopt no engine. Sparkie works in three
places (2.2): **looks** on any Spark, free-form and read-only, at once; **the box**, where anything runs at once
because nothing in it can reach out; and **the Spark itself**, as the owner's user or as root. Nothing is refused for
being powerful. A change runs at once when the owner asked for that work there and nothing Sparkie read since could
have put the command there, under the owner's go-ahead for that task, or when the owner said "always" to that kind. A
**risky** change is always asked first, on Telegram and the page, with the exact command shown; one that could lock
the owner out also goes back by itself unless the owner confirms they can still get in. Code copies a file before it
is changed. Three things are still not done, and none is about permission (2.8).

## 1. What exists today (verified)
| What | Where | What it means here |
|---|---|---|
| The chat loop | `service/src/14-chats.mjs:228` `sparkieTurn` | Rounds and changes per message come from the brain's setup (`:329`: 6 and 4; the agent setups in `service/config.json` say 40 and 12). 4 calls a round (`:391`), 50 s a tool (`:404`), 12,000 characters a result (`:419`). Steps go to the page with name, ok and time only (`:422`; `public/app.js:4025`). Tool results are not kept between messages (`:242-251`). |
| Stop, carry on, outside text | `stopTurn` `:220`; `wakeWork` `:169`; `continueTask` `:177`; `readOutside` `:432`; `:60` | A request carries on only after an operation's result, 8 times in 2 hours at most (`:160`). `readOutside` is per turn and set only by lookups. The prompt says "never make up steps or commands". |
| Actions | `16-actions.mjs:12` `action()`; `runAction` `:347` | A lookup returns at `:353`, before the pause (`:359`), the intent gate (`:371-386`) and the audit line (`:447`). `sparkieCheck` `:265`, `CHANGE_WORDS` `:103` (it has "undo" and "put it back", `:112`), `PAGE_ONLY` `:168`, `tripBreaker` `:328`. |
| Commands on a Spark | `02-ssh.mjs:5` `spawnOn`, `:35` `run`; `01-setup.mjs:66` `q()`; `12-status.mjs:8-11` | ssh `bash -s` as the owner's user, a new connection each time; on Spark 2 a local bash that is a child of the console (`:12-13`). `run` never rejects and takes a `signal` (`:55`). The worker shows a fixed program can be sent with each call: nothing is installed on a Spark. |
| Containers and files | `21-apps.mjs:296` `keep_running`, `:130` `appRunCommand`, `:116` `appRoom`; `16-actions.mjs:969` `files`, `:950` `KEY_FILE`; `17-changes.mjs:753` `save_file` | Containers start only through typed actions with their checks. Files: the shared folder only. Logs: a container's newest lines; no kernel log, no search. |
| Who may say yes | `21-apps.mjs:487` `ownerHere`; `17-changes.mjs:49` `question(…, {ownerOnly})`; `14-chats.mjs:106`; `21-telegram.mjs:318`, `:349` | Today an owner-only button takes a press from the page only (`:106`). Telegram already shows buttons (`:318`) and has one switch kept with its pairing: on needs the passkey, off never does (`:349`). |
| The console's unit on Spark 2 | `deploy/host-on-portal.sh:345-349`, `:146` `check_ways`; `18-workflows.mjs:532` | `MemoryMax=512M`, `NoNewPrivileges` (so no child of the console can use sudo). `check_ways` proves the ways in after an install. `systemd-run --user` is already used. |
| Masking, audit, web | `20-mcp.mjs:284` `maskSecrets`, `:129` `audit`; `21-web.mjs:239` `addressRefusal` | The audit keeps arguments, never output. A page opens only if the owner wrote its address or a search returned it. |
| Traps; the trial | `21-apps.mjs:24`; `25-backup-and-start.mjs:22`; architecture section 8; `agentbar/run.mjs:93` | `CONFIG.images` values count as model images. State copies sit in `backups/` on a compute Spark. Anything running as the owner's user on Spark 2 can open `api.sock` and be the owner. The engine trial has never been run. |

## 2. The design
### 2.1 The loop: extend our own, adopt no engine
Add the tools to `sparkieTurn`. With a shell and root on the Sparks, every command must pass `runAction` (the gate,
the mask, the pause, the record), and an engine's own command tool passes none of them. An engine also ships no
sandbox (web, second-hand), and is a second loop with an npm tree and a prompt written for large cloud models
(decisions 1, 8, 14). The official SWE-bench "bash only" track uses about 100 lines and one command tool, so a small
loop is enough (web). The trial in `agentbar/` stays a measurement: add a contestant `sparkie` (a console in stand-in
mode whose box is the run's container). If it meets the bar no engine is ever needed; if only an engine does, it is
used for gap 2 alone, as a job in a box. The trial also gives the numbers behind 2.10.

### 2.2 Three places, one ladder
| Place | Looks (read-only) | Changes |
|---|---|---|
| The box, on a compute Spark | at once | at once: it can reach nothing (2.4) |
| A compute Spark itself | at once, inside the look wall (2.3) | at once when 2.5 holds; else a button showing the exact command |
| Spark 2 itself | at once, inside the look wall | always asked first, on Telegram and the page (2.7) |
| Everywhere | a key is never shown back | a copy first (2.6); risky kinds always asked; lock-out changes confirm or go back (2.8) |

- **Spark 2 stays light.** It runs the loop, three small state files and the record. A look or an approved command
  runs there only while it runs, as a short-lived unit. No box, image, workspace or new service.
- **How a command gets there:** `run(node, script)` (R10): ssh as the owner's user, local bash on Spark 2, as today. No
  daemon, key, port or listener. A look and a change each reach the Spark as a whole, single-quoted (`q()`).
  Nothing wakes a Spark for a look; a box or a host change needs its Spark on, else `needs-spark` (decision 13).

### 2.3 Looks: how code knows a command only reads
`host_look {spark, command, root}` **replaces** the first design's five fixed scripts (they become example lines in its
description). A look runs inside the root helper's *look* wall (the one page, section 4): the whole disk read-only, no
network, keys hidden. So any command may be a look, and code keeps no look grammar and no table of allowed programs and
flags; a look that needs a socket, a device or the network, all of which the wall hides (Docker, Tailscale, systemd,
`nvidia-smi`, `ip`, `ss`), is one of a short table of exact forms (`critic-safety.md`, finding 8), built by code and
run as today's typed look-ups are, outside the helper. Until the owner's one-time command has run on a Spark (2.8),
`run` and `write_file` (the one page's two tools, which stand for this design's seven) do not work there: Sparkie uses
today's typed actions and gives the owner that one command. Every look runs as a throw-away account with root's read
rights and no other power (2.13), so it reads what only root may read (`/var/log`, another user's files, the kernel
log through `journalctl -k`), and `root` adds nothing to a look.

| Beyond the wall | How it is settled |
|---|---|
| A key is never shown back | Two layers. First the wall: the places on 2.13's hidden list are not there for the command, whatever it runs. Second, for key-shaped names that can lie anywhere (`*.pem`, `*.key`, `id_*`, `.env`), a fixed check runs on the Spark, in the same script, before the command. It resolves every path word (links followed) and refuses one that is, or for a program that walks folders contains, key material: private keys (`~/.ssh/id_*` but not `.pub`, `/etc/ssh/*_key`, `~/.gnupg`, `*.pem`, `*.key`), the secrets file (`~/.config/spark-console`) and design E's key store, token and credential files (Hugging Face, `.netrc`, `.git-credentials`, `~/.docker/config.json`, `~/.aws`, `~/.config/gh`, `~/.ngc`), `/var/lib/tailscale`, `/etc/shadow`, `/proc/*/environ`, shell histories. Everything else may be read, `authorized_keys`, `sshd_config` and Spark Console's own state included. `grep -r token ~` is refused and told to name a folder. |
| What falls outside | It is a change (2.5) or box work: whatever writes, sends, or needs a socket outside that short table (`tee`, `cp`, an editor, `docker exec`, `docker run`, `curl` to anywhere else, a script that writes). The refusal says what the wall stopped and the two ways on. |
| Limits | 30 s (60 at most), low priority, no input, output kept whole up to 16 MB (2.11), 6,000 characters to the brain, two at once a Spark. Output is masked and is outside text. An outside agent may look only if its key may also change things. |
| What it cannot promise | That no key lies outside the hidden list (the mask, and a record that never leaves Spark 2, are the backstop). That the wall holds is proven on each Spark before first use and in `self_test` (2.13). |

### 2.4 The box (unchanged)
One function, `workBoxCommand`, builds the only `docker run` line: `--rm --network none --user <owner's ids>
--cap-drop ALL --security-opt no-new-privileges --read-only`, caps on memory, processes, CPU and file size, a `timeout`,
and three mounts: `/work` (its folder `~/.local/share/spark-console/work/<name>`, writable), `/in` (the shared folder)
and `/models`, both read-only and mounted only if they exist. The mount list is a constant; from the request come only
a checked `name`, `dir`, `path` and one quoted `command`. Its file tools run inside it, so a link made in the box
cannot point a write at the host. Before first use on a Spark a fixed self-check in the box must find it is not root,
has no capabilities, cannot write outside `/work`, sees no Docker socket and cannot open a connection. Two stock images
pinned by digest sit under a new `work.images` key, never under `images`. It stays, now that Sparkie has the host,
because it is the one place where trying needs no yes, where a script from a web page can run, and where design C
edits Spark Console's code. GPU work stays a `keep_running` job.

### 2.5 Changes on a compute Spark itself
`work_run`, `work_write` and `work_edit` take `spark` in place of `work`: then they act on the Spark itself, as the
owner's user, or as root with `root: true` (2.8). **They run at once** when all of this holds (`hostClear`, in code):
1. It is the owner: their page chat, the API, Telegram, or a task of theirs. An outside agent's request is a button.
2. The owner's own words in this chat (this message, or the task's request) ask for work (a new kind `work` in
   `CHANGE_WORDS`: fix, install, set up, change, edit, build, clean up, update, try) and name that Spark.
3. **Nothing read since:** from those words on, the turn and its task have read no outside text (no log, file, command
   output or web page; `readOutside`, now kept for the whole task); or a go-ahead holds; or the kind is always allowed.
4. It is not risky (2.8). Every address in it is the fleet's own, a known package source (a short list in code: PyPI,
   GitHub, Hugging Face, the image registries), the owner's, or a search result (R39's test).
5. The Spark's claim is free. A host change takes the claim (R13), so it never runs under a model start.

**Otherwise it is a button**, on the page and in the owner's paired Telegram chat (`tell('ask')`); a press on either
counts, once. Code builds its label: the exact command, whole (invisible characters are refused, so what is shown is
what runs); the Spark; "as root" when it is; whether it can be put back; whether Sparkie read outside text before
proposing it; for an edit the path and lines changed; for a script Sparkie wrote, its text. For every script file the
command runs, Sparkie's or not, code keeps the file's hash with the button. At the press the runner opens the file
once, checks the hash of what it opened and runs that; if it differs the button is void and a new ask shows the new
text. The button says that files the script reads later are not checked. Over 3,500 characters it is asked on the
page only: nobody approves what they cannot read. Answers: "Yes", "Yes, and don't ask again on Spark 3
for this task", "Always allow …" (when the command has a kind), "No". **One switch on the page, "Approve from
Telegram"** (kept with the pairing in the secrets file; on needs the passkey, off never does; on once paired, by
decision 20): when off, an ask still arrives on Telegram as a notice and is answered on the page.

| | The go-ahead (one task) | Always allow (a standing list) |
|---|---|---|
| What it is | "Allow for this session": host changes on the named compute Sparks, in that chat, for that request, also after outside text was read | A **kind**: five checked facts, never free text: the Spark; the program; its sub-command (the first word that is not an option); a folder every path in the command resolves under; root or not. For a typed edit: the Spark, `edit`, the folder, root or not. Only a simple command (one program, read by the tokenizer of 2.8) has a kind |
| Given by | The owner's words in that chat ("do what you need on Spark 3 for this"), or the second answer of a button. Never a notice, a tool result, an agent or memory | Only the owner's own press, on Telegram or the page, of the answer code built: "Always allow `pip install` under `~/venvs/glm` on Spark 3". No action writes the list, so an agent, a typed yes and Sparkie itself cannot |
| Kept | In memory only | `allowed.json` (state folder, `writePrivate` and `readKept`, one writer `saveAllowed`, 50 entries): `{id, spark, program, sub, under, root, kept, addedAt, uses, lastUsedAt}` |
| Effect | Skips rule 3 | Skips rule 3 and the naming of the Spark in rule 2, in the owner's chats and tasks (never for an outside agent). Every other check still runs |
| Ends, or is taken back | With the task (Sparkie's last answer with nothing left to carry on); at the owner's next new request; `/stop`; `/pause`; 2 hours; 120 steps; a console restart; a failed ways-in check. One quiet line shows while it holds | By the owner's words, answered by code on the page and on Telegram (R34's pattern): `/allowed` lists the entries, numbered; `/allowed off 3` removes one, `/allowed off all` every one. `sparkie_setup` shows the list |
| The cost, plainly | Text Sparkie read can shape a command. The risky list, the copy taken first, the ways-in check and the record stand behind it | The same, for longer |
| Never covers | Spark 2; anything risky (2.8); another chat | Spark 2; anything risky (2.8); shells, `xargs` and `docker exec` (they run whatever they are handed); a line with chaining or redirection |

| Part | How |
|---|---|
| How it runs | One script through `run()`: `appRoom` first (R2), the copies (2.6), then the command through the helper's run wall (2.13): a short-lived unit of the Spark's own systemd (`sw-run-<id>`), so it is capped (8 GB, 512 tasks), timed and killable by name, nothing outlives it, and it cannot become root. With `root: true` the helper's `root` verb runs it instead, inside the net (2.8). |
| Keys by name (decision 22) | `keys: ["hf"]` on `work_run`, in a box or on a Spark: code takes each value from design E's store, writes them to an owner-only file on the Spark's memory disk for the life of the command (the unit's `EnvironmentFile`, a box's `--env-file`) and removes it. The command says `$HF_TOKEN`; the value is never in the command text, and code masks that exact value in the output, the record and what the brain sees. A command that uses a key may name only that key's own hosts (E keeps them) or the fleet's; any other address makes it risky. |
| Other askers | An outside agent's host change is always a button for the owner. A brain graded `careful` (design E) gets a button for every host change. An unattended task follows the same ladder from its request's words and, at a button, parks and asks on Telegram. |

### 2.6 Put-back: a copy first, and change sets
| Part | How it works |
|---|---|
| A copy first | Before a file tool or a host command edits, replaces or removes a file, code copies it (as root when the command is root): for a typed tool, that file; for a command, every existing file its words and redirections name, resolved. Copies go to `~/.local/share/spark-console/before/<set>/` on that Spark (owner-only): 16 MB a file and 128 MB a command at most; kept 7 days, the newest 20 sets and 2 GB a Spark; pruned when a new set opens (no timer). A typed remove, if one is ever added, moves the file into the set (a rename on the same disk) instead of copying and deleting, so the kept copy is exactly what was removed. |
| A change set | One per request or task, in `changes.json` on Spark 2 (state folder, one writer, the last 50): files (path, kept or why not, hash before and after, made new), containers started or stopped (operation ids), packages (`pip`, `conda`, `npm`, `apt`: the list before and after), units touched, keys used (names), and `unseen` when a step's effects could not be known. A `find -newer` over a command's folders adds what it made or changed without naming. |
| `put_back {set}` | Restores the kept files of one set (this chat's latest when none is named) and removes files the set made that are unchanged since. It opens its own set, so it can be put back too, and says what it did not restore. Containers go back with `undo_last_change`, which exists. |
| What cannot be put back | A deleted volume or image; a database's contents and anything changed inside a container; a file too big to copy, or changed by a command that did not name it; what another program wrote to a file between the copy and the command; packages (the list from before is given, not replayed); a stopped process; anything sent over the network. |
| How the owner is told before | Code marks each host change `kept` or `not kept`. A deleting command (`rm`, `rmdir`, `shred`, `truncate`, `dd`, `find -delete`, `git clean`, `git reset --hard`, `docker rmi`, `volume rm`, `prune`, `pip uninstall`, a `mv`, `cp` or `>` over a file) that is not fully kept is risky: always a button saying "This cannot be put back" and what would go, asked as a dangerous ask of kind `delete` (2.14). A fully kept delete follows the ladder. Any other step with unseen effects (a script, an install, `docker exec`) says "not covered by put-back" on its step line as it starts, on any button and on an always entry. |

### 2.7 Spark 2 itself
Looks: as anywhere. A change on Spark 2 is risky by decision 20:

| Part | How |
|---|---|
| Who says yes | Always asked first, on Telegram and the page: one command a press, the exact command shown. Never under a go-ahead, the always list or an agent's say-so; an unattended task parks and asks. |
| How it runs | Through the helper, which on Spark 2 is called from the owner's service manager, not as a child of the console (which sits inside its 512 MB and cannot use sudo; 2.13): 2 GB, 10 minutes. A command that would leave something running there, or start a container, says so on the button: the hub runs the console and the brain and nothing else (decisions 2, 19). |
| Before and after | The copy (2.6) and the ways-in check (2.8), plus `check_ways`, the console's files and units, port 8443's three routes and the brain's container answering. On a miss: put back what code can, pause Sparkie's host changes, tell the owner what differs. A lock-out change goes under the net of 2.8. `go-back.sh` stays the by-hand way back. |

### 2.8 At once, asked first, or not done (decision 22)
Code sorts each host command (its words through one tokenizer, a typed path after it is resolved, a script
Sparkie wrote before it runs): **(a)** the ladder of 2.5; **(b) risky:** always a button on Telegram and the page with
the exact command, one press for one command, never under a go-ahead or an always entry; **(c) not done**, and never
for lack of permission. The gate that reads only the owner's words, the record and `/stop` hold for all three. Five
kinds of (b) are asked the harder way of 2.14: root, the lock-out class, a delete that cannot be put back, the brain,
and an install of Spark Console.

| What | Class | Notes |
|---|---|---|
| Becoming root | (a) or (b), by what the command is | Through the typed `root: true` only (below). |
| Keys and sign-ins to services (`docker login`, `gh auth`, a token for a download) | (a) | By a saved key's name, injected by code (2.5). |
| `ssh` and `scp` between the fleet's own Sparks; packages; services and files under `/etc` not named below | (a) | Copy first. |
| Container starts and stops by free-form Docker (`docker run`, `compose`, `stop`, `rm`) | (b) | The typed actions come first: they carry the 8 GB check and the list of what should run. A form they cannot express is asked, and the button says it runs outside those checks. |
| Anything on Spark 2; the brain's container and model files; protected containers; Spark Console's own files, state and units | (b) | 2.7. A change to Spark Console's code goes in by design C's path. |
| A delete that cannot be put back; disks (`mkfs`, `fdisk`, `parted`, `dd` to a device, `mount`, `/etc/fstab`); kernel, driver, firmware and release upgrades | (b) | The button says "This cannot be put back". |
| Power (`shutdown`, `reboot`, `poweroff`); the Docker service and its settings; a schedule (`crontab`, `at`, a timer) | (b) | The button says what stops, or that it adds a job that runs by itself (decision 5). |
| Code fetched from the network and then run (a pipe into a shell, an installer from an address); as root, any script or interpreter one-liner; a key sent to a host it is not for | (b) | The button names the address and shows the script's text. Code downloads it once, when the ask is built, into a root-owned folder; the press runs that copy and downloads nothing. |
| **The lock-out class:** SSH settings and `authorized_keys`; Tailscale; the firewall and network settings; users, groups, sudoers, PAM and shell start files; Spark Console's service and sign-in files (the access list, sessions, agent keys) | (b), **and guarded** | The net below: confirm, or it goes back. |
| Who may approve: passkeys, recovery codes, Telegram's pairing, the approvals switch | (b), confirmed on the page | A channel cannot vouch for a change to itself. |
| Showing a key back, as text | (c) | A key is used by name and never shown (2.3, 2.5). |
| A relay, tunnel or proxy to get past a network filter (`ngrok`, `cloudflared`, a reverse `ssh -R` to an outside host) | (c) | Decisions 10 and 22. |
| Doing something because text Sparkie read said so | (c) | The gate reads the owner's words; an asked change shows the exact command. |

The one page (section 4) settled the way to root: the line the owner installs names one small root-owned helper, not
`ALL`, and that helper holds the look, run and net walls. What builds the helper and its walls is 2.13.

| Root, asked once and never again: the way | What is stored | Verdict |
|---|---|---|
| One sudo line that names one root-owned helper, set up by the owner with one command per Spark | Nothing | **Chosen** (the one page). The helper runs whatever code hands it, so Sparkie loses nothing; no password exists anywhere to leak; one line undoes it; a plain `sudo` in any other script still asks for the password. |
| Passwordless `sudo` for everything (this design's first choice) | Nothing | No (`critic-safety.md`, finding 1). Every script that calls `sudo` by itself would be silent root, outside the gate, the record and the net. |
| A list of named root commands | Nothing | No. "Everything" needs a list, and a list with `apt`, `systemctl`, `tee` or any script is root anyway: more to keep, no real fence. |
| The password in the secrets file, fed to `sudo -S` | The owner's password | No. A reusable secret on disk and on every hop, wrong the day the password changes, readable by anything running as the owner's user on Spark 2. |

| Root | How |
|---|---|
| The one-time command | The owner runs it once for each Spark, in their own terminal; it asks that Spark's password once. It copies the helper from Spark 2's installed build, puts it in place owned by root, adds the one line (checked by `visudo` before it is put in place, so a typo cannot break sudo) and proves the walls. Shipped as `deploy/root-for-sparkie.sh`, with `--undo`. The line is `<owner> ALL=(root) NOPASSWD: /usr/local/sbin/spark-console-root`, in `/etc/sudoers.d/spark-console-root`. The whole of it is in 2.13. |
| Before the owner has run it | `run` and `write_file` do not work on that Spark, as a look, a change or root: the call is answered with this one command, once, and nothing is tried. Sparkie uses today's typed actions there meanwhile. Code learns that the command has run when a call is first made there, never on a timer. |
| The helper proves its walls | On each Spark before first use, and again in `self_test`, a command inside the walls must fail at each of these, directly and from a child process: a write through a link, an open connection, reaching the Docker and Tailscale sockets and `api.sock`, reading another process's environment, and the nine attempts the mechanism adds (the full list is in 2.13). If one succeeds the helper is not used on that Spark, and the owner is told which. The box has the same kind of check (2.4). |
| What `no_new_privs` becomes | The rule for every command that is *not* root. An ordinary command still cannot become root by itself (sudo fails in its whole tree, by the kernel), although the helper's sudo line exists. Root is reached only through the typed `root: true`, which code turns into the helper's `root` verb; a command inside a wall cannot call the helper. So root is always a fact the gate, the button ("as root") and the record can see. The word `sudo` in a command is answered "set root". |
| Root on the ladder | A plain command (one program, read by the tokenizer) in no (b) row: a named package install, a service restart, an edit under `/etc`, fixing who owns a folder; a root look runs at once. A go-ahead covers these; an always entry records root as its fifth fact. |
| Root that is asked | Every (b) row: among them any root script or one-liner, fetched code, anything on Spark 2, and the lock-out class. |

| The lock-out net: confirm, or it goes back (as `netplan try` and a router's "commit confirmed") | What code does |
|---|---|
| It needs | Root set up on that Spark, since the timer must not depend on anyone being logged in. Without it the owner gets the command instead. |
| 1. Ask | Telegram and page: the exact command, and "This can lock you out. It goes back by itself at 14:32 unless you confirm." The time is the command's own time limit plus ten minutes. |
| 2. Copy first | By the helper, as root (the copy list and `restore.sh` are the helper's own text, since its line allows nothing else to be root; 2.13), to `/var/lib/spark-console/guard/<id>/`: `/etc/ssh`, the owner's `authorized_keys` and ssh `config`, `/etc/sudoers*`, `/etc/passwd`, `group`, `shadow`, `gshadow`, `/etc/pam.d`, shell start files, `/etc/netplan`, NetworkManager's connections, `/etc/hosts`, the firewall as saved rules (`iptables-save`, `nft list ruleset`, `/etc/ufw`), Tailscale's settings and serve routes as JSON, and on Spark 2 the console's units and sign-in files. Code writes `restore.sh` beside them: copy back, reload sshd, `netplan apply`, load the rules, re-apply Tailscale's settings and routes, restart the console's unit if its files changed. `restore.sh` begins with `systemctl stop` of the command's unit and waits until it is gone. It copies back only files whose fingerprint differs from the copy and reloads only the services whose files it put back. |
| 3. Arm the timer, before the change and outside the console | The helper, in the same call that then runs the command: `systemd-run --on-active=<the unit's time limit + 600 s> --unit sw-guard-<id> bash /var/lib/spark-console/guard/<id>/restore.sh`, so the timer never fires under a command that is still running. It lives in the Spark's own systemd, so it fires with the console, the network or Tailscale down. A second small unit, enabled for the next start and tied to a `pending` file, runs the same script if the Spark restarts inside the window. If arming fails, nothing is changed. The copy script's first line refuses if another guard's `pending` file is on that Spark; the Spark's claim is held until this guard is kept or put back. (`at` would also do, but is not installed by default; systemd always is.) |
| 4. Apply, then check the ways in | A new ssh connection from the console, the helper still answering (`check`), Tailscale running and the Spark's address answering; on Spark 2 also `check_ways`, port 8443's routes and Telegram's poll. On a miss `restore.sh` runs now if the Spark can be reached; if not, the timer does it. |
| 5. Ask the owner to confirm | "Changed. Check you can still get in (open a new terminal). It goes back at 14:32." Answers: "I can still get in: keep it", "Put it back now". Only the owner's press (Telegram or page) counts; Sparkie cannot answer it, and `/stop` does not stop the timer. Where the one page asks for a fresh visit (the hub, and any sign-in change): for a sign-in change the visit must sign in afresh with a passkey that existed before the change, and a standing session does not count; for a route change it is a new connection through that route. The link carries the guard's id and counts only after the change is live. |
| 6. Kept, or put back | Kept: the helper's `keep` stops `sw-guard-<id>.timer`, the `pending` file removed, the copies kept 7 days. Kept counts only when the timer was still waiting and its stop succeeded. If a result file exists, the answer is "already put back at 14:32". Not confirmed: the timer puts it back and leaves a result file; the owner is told as soon as the console can read it. |
| What cannot be put back this way | A Tailscale logout (it needs a browser sign-in); a deleted user's home; a Spark that will not start; anything changed outside the Spark (the tailnet's own rules, the router). Code knows `tailscale logout` and `userdel -r` and says so on the button. |
| When the console is cut off | A confirm counts only if the console can still reach the Spark to stop the timer. A change that cuts the console off goes back even if the owner can get in another way. |
| When Spark 2 has no internet | Telegram cannot reach the owner: the ask and the confirm are on the page. If the page is cut off too, nobody can confirm, and the change goes back. That is the net doing its job. |
| Every other host change | Keeps the plain ways-in check: fingerprints of the same files before and after; on a difference they are put back from the copies, Sparkie's host changes pause (`tripBreaker`) and the owner is told. |

### 2.9 The seven actions (new part `service/src/21-work.mjs`)
| Action | Kind | Typed inputs | What it does |
|---|---|---|---|
| `host_look` | read, outside text | `spark` (any); `command` (1–2,000); `root`; `seconds` 1–60 | One read-only command on the Spark itself (2.3). |
| `workspace` | change | `name`; `do`: `open`, `list`, `remove`; `spark`; `kind`: `python`, `node`; `memoryGB` 1–16 | Opens or re-attaches a box for this chat (never on Spark 2); `remove` is always a button. |
| `work_run` | change | `work` **or** `spark`; `command` (1–4,000); `dir`; `root`; `keys` (names); `seconds` 1–30; `minutes` 1–120 | Runs a command in the box, or on the Spark itself (2.5, 2.7, 2.8). With `minutes` it is an operation whose result is posted in the chat. A command that only reads runs as a look (2.3). |
| `work_read` | read, outside text | `work` or `spark`; `path`; `root`; `from`; `lines` 1–400 | Numbered lines of one text file. On a Spark it is a look: a key is never shown. |
| `work_write` | change | `work` or `spark`; `path`; `root`; `text` (≤ 128 KB) | Writes the whole file. On a Spark: the path is resolved and sorted (2.8), the old file copied, the write is one move. Refuses key-shaped text. |
| `work_edit` | change | `work` or `spark`; `path`; `root`; `find` (1–8,000); `replace` (0–8,000) | Replaces `find` where it appears exactly once; else says how often it appears and changes nothing. |
| `put_back` | change | `set` (an id from the chat; default this chat's latest) | Restores one change set's files (2.6). Asked for with "undo" or "put it back"; risky where the change was. |

All are `who: 'owner'`; none may be a saved-workflow step. A wrong place is safe: a host command sent to the box fails
harmlessly, and a box command sent to a Spark meets the gate.

**What is built is the one page's two tools**, not these seven: `run {on, command, root?, dir?, minutes?}` and
`write_file {on, path, text, from?, to?, root?}`. The table above stays as the record of what each must do. Neither
tool has a `seconds` input: a command's time is 30 seconds, or what `minutes` says (2.10).

### 2.10 Limits, time, the live view, stopping
| Limit (a brain setup may state `workSteps` and `contextTokens`; else these defaults) | Value | When reached |
|---|---|---|
| Work steps per message | `workSteps`, else 2 × `toolRounds`, at most 30 | The turn answers; the task carries on in a fresh turn. |
| Tool output per message | 40% of `contextTokens` at 3 characters a token (default 32,768) | Same: a small brain never overflows. |
| One result to the brain | 6,000 characters (the first 2,000, the last 3,500) | The whole output goes to the record. |
| One command | 30 s, or what `minutes` says, held to the most its class allows (the table below, step 6). Output is kept whole up to 16 MB (2.11) | The unit's own time limit, then the box removed or the unit killed by name. Past 16 MB of output the command is ended and the record says so. |
| One task | 120 steps, 2 hours, 8 carry-on turns | A plain report; the owner's next message gives a new budget. |
| Refused or malformed calls | 3 in a row | The tools are withdrawn for that message, with the reason. |
| Room | The 8 GB rule before every command; a memory cap (4 GB box, 8 GB host, 2 GB Spark 2); 50 GB free disk | Refused in plain words. |

**`minutes` on `run` (step 6; settled 2026-11-14).** The simplicity review cut long commands; the one page's `run`
keeps `minutes`, and the one page wins. `minutes` is a whole number from 1 to 120, and nothing else sets a command's
time. Code sorts the command first (2.8), so the limit follows the class code found, not what the brain expected.

| The command is | Without `minutes` | With `minutes` | The most it may ask |
|---|---|---|---|
| A look | 30 s, inside the turn | an operation | 1 (the helper gives a look 60 s: 2.13) |
| In the box, or a change on a compute Spark as the owner's user | 30 s, inside the turn | an operation | 120 |
| A root command, which runs inside the net | 30 s | an operation | 30 |
| On Spark 2, or in the lock-out class | 30 s | an operation | 10 |

- **More than the most is held to it**, and the result says so ("held to 10 minutes: this runs on Spark 2"). Nothing is
  refused for asking too long.
- **With `minutes` the command is an operation** (a job of type `run`, `07-jobs.mjs`). The call returns at once with
  the operation's id. A change holds the Spark's claim while it runs, as any host change does; a look and a box
  command hold none. `cancel_operation` ends it by stopping its unit. Its end is posted in the chat, as any
  operation's is, and that wakes today's carry-on. The notice is built by code: where it ran, how long, the exit code
  and the journal id of its output. It quotes none of the output: the next turn reads it with `recall`, which counts
  as outside text like any read.
- **An exit code other than 0 is a result**, not a failed operation: the operation ends completed and says the code.
  It fails only when the command could not be run at all (the helper refused, the Spark went away, the journal's
  start line could not be written).
- **At the limit** the unit's own time limit ends the command and everything it started (`RuntimeMaxSec`, then 5 s:
  2.13). That is a result too: "stopped at its limit of 20 minutes". What it wrote stays, the copies stay,
  `undo_last_change` restores them, and the output up to then is in the journal. Inside the net the guard then does
  what it does after any command (2.8): nothing differs and it is disarmed, or the check, the confirm or the
  put-back. Nothing is run again.
- **After a restart of Spark Console** the operation is gone, because operations live in memory. The journal's start
  line with no end names the unit. Start-up stops that unit by name when its Spark answers (as `/stop` stops a
  command), then writes the one "cut off" notice (B 2.1), which says the command was stopped. If the Spark does not
  answer, the unit ends at its own limit.
- **Step 6 no longer builds** the task card, the `NOTES.md` digest, `conv.task.work`, or a second trigger for the
  carry-on when a budget ends a turn. A turn that ends at a budget (step 3) answers with where it got. Carrying on by
  itself after that is design E's step 6 (E 2.1).

| Topic | How |
|---|---|
| What it costs in time (decision 21; estimates, to be measured: each step's record splits its `ms` into connect, check and command) | **An ordinary reply: nothing.** No model call, no ssh, no search, no timer; the gate's sorting is in-process, under a millisecond. The seven tool texts are kept short (about 800 tokens in all) and sit in the brain's cached prefix after a chat's first turn. A test counts zero `run()` calls for a turn with no work. **A look:** one ssh connection (about half a second to a compute Spark, none on Spark 2) plus the command. **A box command:** about one second more, for the container. **A host change:** the connection, the copies (milliseconds for small files), the unit (about 0.1 s), two fingerprints (about 50 ms); root adds about 20 ms. **A guarded change:** about 2 s for the copy, the timer and the check, then only the owner's confirm. Go-aheads, copies and root's setup are looked at only when used. |
| Carried across messages | Cut (the one page): no task card, no `NOTES.md` digest and no `conv.task.work`. A long command's result is posted like any operation's and wakes today's carry-on (step 6, above). What was read is kept on `conv.task` as a list (2.12); the go-ahead is step 9's. The first design, for the record: each turn starts fresh with a task card, as labelled data beside the fleet notes (`14-chats.mjs:322`): the first 1,500 characters of `NOTES.md` (in the box) and the last 12 steps, one line each, built by code. |
| What the owner sees live | The `tool` event gains `where` (Spark 3, Spark 2, box), `line` (`$ the command`, masked, 200 characters), `tail` (exit code and last line), `root` and `kept`, built by code and saved in `message.tools`: one quiet row a step, folded to "23 steps, 2 failed". A button shows the whole command in fixed-width type, on the page and on Telegram. |
| How `/stop` ends one | `/stop` (page or Telegram) ends the reply, the task and the go-ahead, aborts the command under way (`run`'s `signal`), then removes its box or kills its unit by name and frees the claim. A long command stops with `cancel_operation`. `/pause` stops every change; looks still work. After a console restart a command still ends at its unit's own time limit. A guard timer is never stopped by `/stop`: only a confirm stops it. |

### 2.11 The record a step hands over (the journal is design B's)
Every look, ask and refusal calls B's `journal('cmd', fields, body)` once, when it ends. A change (a command that is not a
look, an edit, a put-back) calls it twice with one id: `phase: start` before the copies and the command, with `chat`,
`via`, `actor`, `where`, `root`, `gate`, `args`, `set`, `guard` and the unit's name; `phase: end` after, with the rest.
If the start line cannot be written, the change does not run and the owner is told why (B 2.1); typed actions, `/stop`,
`/pause`, `/putback` and `/undo update` never wait on it.

| Part | Holds |
|---|---|
| Fields (1,500 bytes at most) | `chat`, `turn`, `op`, `via`, `actor`, `brain`, `act`, `n`, `where` (`box`, `host`), `class` (`look`, `change`), `phase` (`start`, `end`; a change only), `unit`, `root`, `keys` (names only), `gate` (`look`, `box`, `words`, `go-ahead`, `always:<id>`, `asked:telegram`, `asked:page`, `not-done:<rule>`), `args` {`spark`, `work`, `dir` or `path`, `command` (first 600)}, `ok`, `outcome`, `exit`, `err`, `ms` {`connect`, `check`, `command`}, `bytes`, `cut`, `set`, `kept`, `file` {`path`, `sha256`, `before`}, `ways` (`same`, `put-back:<file>`, `differs:<file>`), `guard` (`armed`, `kept`, `put-back`), `sub` [the Spark] |
| Body (kept whole) | The whole command or the edit's `find` and `replace`, then the output. A record's long text is kept whole. It is written to the `.out` file in pieces as it arrives and never held whole in memory. Each piece is masked before it is written, with an overlap so a key that falls across two pieces is still caught. Past 16 MB (a default) reading stops, the command is ended, and the record says so. The digest's size is a separate number. The mask is `maskSecrets` and the exact value of every key the command was given; escape codes and invisible characters are removed; always outside text. |

### 2.12 Outside text, and what this needs from the other designs
| Topic | How |
|---|---|
| Outside text | Output, logs, files and pages are labelled as data and set `readOutside`, which now lasts for the task. Step 7 keeps it on `conv.task` as a list, not a flag: for each outside read, the journal id of its record and a label code built (the newest 40), so that 2.14's ask can say what came from where; any entry counts as "read". From then on a host change is a button unless the owner gave a go-ahead or an always entry: rule 3 of 2.5, in code. Both come only from the owner's words or press (R25), and neither covers anything risky. A button says when Sparkie read outside text before proposing it. An address a command printed cannot be opened by `read_page` (R39) nor used in a host command without a button. Step lines, button labels and always-allow kinds are built by code, never from the brain's prose. |
| Needs from E | The key store: `keyValue(name)` for code only, each key's names and hosts, and a key taken out of a message before anything else sees it. One task is one queue item that parks at a button and asks on Telegram. `workBusy(spark)` before a Spark is powered off. A carry-on turn counts as a message for the brain's sleep. The profile holds `workSteps`, `contextTokens` and the `careful` grade. |
| Needs from B and C | B: `journal('cmd', …)`. C: code, never the brain, fills a box from a tar stream and reads it back. |

### 2.13 The root helper: what builds the walls, and how it reaches a Spark (step 1)
Added 2026-11-14 to close the build map's first "unclear" item. Every setting below was read in its own manual
(systemd, sudo, util-linux, the kernel's manual pages); a number in brackets is the systemd version that manual says
the setting arrived in (no number: older than the manual's notes). Nothing was run and no Spark was looked at.
NVIDIA's pages say DGX OS 7 is Ubuntu 24.04, which ships systemd 255; the helper checks for itself and refuses on
less than it needs.

**In short.** One shell script owned by root, `/usr/local/sbin/spark-console-root`, allowed by one sudo line. It
installs nothing, keeps no password and never stays running. For each command it asks the Spark's own systemd for a
short-lived unit with a fixed list of settings. systemd builds the wall before the command starts, and the kernel
holds it for the command and everything the command starts. The helper runs no wall it has not proven on that Spark.

| Wall, and the helper's verb | Runs as | May read | May write | May reach |
|---|---|---|---|---|
| **Look**: `look` | An account made for that one command and gone after it, with root's read rights and no other power of root | Everything but the hidden list | Nothing that stays. The whole tree is read-only; `/tmp` is its own empty folder, removed at the end | Nothing: no network, no socket, no device. It can list other programs, as `ps` does, but not touch them or read their environment |
| **Run**: `run`, a change as the owner's user | The owner's user, without the group memberships that are root by another name (`docker`, `lxd`, `libvirt`, `disk`, `sudo`) | What the owner can, but the hidden list | What the owner can, but the read-only list | The internet and the other Sparks. No local-only port on its own Spark (its loopback), no socket under `/run`, no program outside itself |
| **Net**: `root`, a root command | root | Everything | Everything but the helper, its sudo line and the net's own copies | Everything. It runs only when the helper armed the put-back timer in the same call (2.8) |

- **How the caller says which wall.** Code, never the brain, builds one line:
  `sudo -n /usr/local/sbin/spark-console-root <verb> --id <id> --sha256 <hash> --seconds <n> --dir <folder> -- '<command>'`.
  The sorter of 2.8 picks the verb; the command is one single-quoted word (`q()`). `run` also takes `--open`,
  `--protect <folder>` (one more read-only folder: a models folder, the shared folder) and `--stdin` (a file's text,
  for `write_file`). `check` says what the Spark has and whether the proof is current; `prove` runs the proof.
  Inside a look `~` is still the owner's home.
- **Outside the run wall, when asked.** A command that names something the run wall hides (Docker, Tailscale, the
  owner's services, a local port, Spark Console's own files, another program of the owner's) is risky and asked
  (2.8). After the yes it runs with `run --open`: the same unit, limits, id and hash, still unable to become root,
  with nothing hidden and no membership left out. The ask and the record say "outside the wall" and why. A look
  never takes `--open`.

| What it gives | The setting | Look | Run |
|---|---|---|---|
| An account that owns nothing. By the kernel's own rules it cannot signal another program, read another program's environment or its `/proc/<pid>/root`, or open a socket that is not open to all | `DynamicUser=yes` (232). It also forces `NoNewPrivileges`, `ProtectSystem=strict` and `ProtectHome=read-only` | yes | |
| Root's read rights and nothing else of root | `AmbientCapabilities=CAP_DAC_READ_SEARCH` (229), and `CapabilityBoundingSet=` the same | yes | |
| The one other thing that right allows, opening a file by its handle and so round the hiding, is closed | `SystemCallFilter=~open_by_handle_at` (187), `SystemCallErrorNumber=EPERM` (209), `SystemCallArchitectures=native` (209) | yes | |
| Nothing written stays | `ProtectSystem=strict` (forced by the account above); `ProtectKernelTunables=yes` and `ProtectControlGroups=yes` (232); `PrivateTmp=yes`; `PrivateIPC=yes` (248); an empty read-only folder over `/dev/shm` | yes | `PrivateTmp=yes` only |
| No network, and no socket that has no file | `PrivateNetwork=yes` | yes | |
| No disk device and no GPU (a read-only tree does not stop a write to a device) | `PrivateDevices=yes` (209) | yes | |
| The hidden list | `TemporaryFileSystem=<folder>:ro` (238): an empty folder over the real one, with the named safe files put back by `BindReadOnlyPaths=` (233); `InaccessiblePaths=` (231) for a single file. `/run`, where a Spark keeps its sockets, is covered whole | yes | yes; name look-up is put back (`/run/systemd/resolve`, and the resolver's own loopback address by `IPAddressAllow=`) |
| The read-only list | `ReadOnlyPaths=` (231) | the whole tree | yes |
| No local-only port on its own Spark: the plug controller, the console's local port, a notebook left open | `IPAddressDeny=localhost` (235) | no network at all | yes |
| It sees, and can signal, only itself and what it starts. Without this the hiding means nothing: `/proc/<pid>/root` of any other program of the owner's shows the Spark unhidden | The unit's command is `unshare --pid --fork --kill-child --mount-proc`, then `setpriv --reuid --regid --groups --inh-caps=-all --bounding-set=-all` down to the owner's user, then the command | not needed: its account owns no program | yes |
| It cannot become root: `sudo`, the helper and set-user-id programs give it nothing | `NoNewPrivileges=yes` (187) | forced | yes |
| It ends on time, with everything it started | `systemd-run --wait --pipe --collect` (232, 235, 236), `RuntimeMaxSec=` (229), `TimeoutStopSec=5`, `MemoryMax=` (231), `TasksMax=` (227) | yes | yes |

- **What a Spark must have, and what happens without it.** systemd 248 or newer, as the Spark's first process;
  control groups in the one-tree form (`cgroup2`); an `unshare` that knows `--kill-child` and `--mount-proc` and a
  `setpriv` that knows `--groups` and `--bounding-set` (the helper reads their own help text). `check` names what is
  missing and every verb refuses: the helper never runs with a wall down. If systemd refuses a setting, no unit
  starts. systemd's manual also says several of these settings are skipped without an error on a kernel that lacks
  what they need, so the helper trusts no setting: it trusts the proof.
- **Not used, on purpose.** `PrivatePIDs=` does the "sees only itself" row in one setting, but arrived in systemd
  257. `RestrictNamespaces=` has no effect on arm64, which the Sparks are (its manual says so). The command's text
  is never put on the unit's command line: systemd expands `${…}` there, and the switch that turns that off
  (`--expand-environment=no`) arrived only in 254.
- **The hidden list** (one list for both walls, in the helper's own text, so only the owner's command can shorten
  it). In every home folder: `.ssh` but for `authorized_keys`, `known_hosts`, `config` and `*.pub` (plain files,
  put back read-only); `.gnupg`; `.docker` whole (a change could steer every `docker` the console runs through its
  `config.json`); `.config/code-server`; the token files of 2.3; shell histories; Spark Console's secrets folder;
  its state folder whole, with every plain file in it put back read-only but the sign-in files and the sockets
  (`api.sock`, the door's), so a name the console later renames into place there is never seen; and
  `~/.local/share/spark-console` (old texts, state copies, snapshots). On the system: `/run`; `/root`;
  `/etc/shadow*` and `/etc/gshadow*`; the host keys in `/etc/ssh`; `/etc/ssl/private`; `/etc/netplan` and
  NetworkManager's connections; `/var/lib/tailscale`; Docker's and containerd's data folders;
  `/var/lib/spark-console`; `/var/backups`; swap files. A path that is not on a Spark is skipped.
- **The read-only list** (run wall). In the owner's home: the shell start files (with `.bash_aliases`), what the
  owner's service manager reads (`.config/systemd`, `.local/share/systemd`, `.config/environment.d`,
  `.config/autostart`, the two `user-tmpfiles.d` folders), `~/.cache/spark-console` (engine caches and the set-up
  scripts staged there), the editor's programs (`.local/opt`, `.local/share/code-server`), and what is left of
  `.ssh`. Spark Console's page, code and source. The helper and its line.
- **What the run wall holds in the owner's home is there, real and pinned** (added 2026-11-14, from the
  wall-escape analysis of that day, rows 1 to 3). A setting sits on its own path only, so three things would
  undo a listed path: renaming a folder above it and making a new one in its place; making it when it is not there
  yet; replacing a link that the setting followed. So: each folder between the home and a held path is bound onto
  itself (`BindPaths`), and a mount point cannot be renamed or replaced, while what is inside stays writable; a set
  of names must be there (the start files, `.ssh`, `.docker`, the service manager's folders,
  `.cache/spark-console`), and the one-time command makes the missing ones, before the password, as the owner (a
  `.bash_profile` it makes is one line that reads what bash read without one); and a held path in the home must be
  the real thing, not a link nor under one. `run` refuses by name when a name is missing or a link; a look, which
  writes nothing, is not refused. `--check` names them, says whether PAM reads `~/.pam_environment`, lists enabled
  units of the owner's whose program is in the home outside the read-only list, and says whether Tailscale SSH is on.
- **What the walls cannot promise.** A key in a file nobody listed (2.3). A file a walled change may write that the
  owner later runs outside the wall (a project script, something on the owner's `PATH`), or that a start file
  itself reads. A socket that has no file can be reached from the run wall; the proof lists any that listen on the
  Spark. A walled change can call another Spark's open ports and the console's own address, as any program on the
  tailnet can: the console answers the Sparks' own addresses on `/v1/` only (R5), so a model call, never a person;
  but if Tailscale SSH is on for a Spark, any program on the tailnet signed in as the owner gets a shell there with
  no key, outside every wall, so `--check` says whether it is on. A disk mounted while a look runs is not read-only
  to it. Inside a look `>/dev/stderr` cannot be reopened (`>&2` works).

**What the helper refuses.** It starts no unit when: the Spark lacks what a wall needs; the proof has not passed for
this helper on this systemd and kernel; its own file, or a folder above it, can be written by anyone but root; it was
not called through `sudo` by an ordinary account; the command's bytes do not have the hash it was given; a look asks
for `--open`, for input or for more than 60 s; a change asks for more than 120 minutes, or a root command for more
than 30; `root` is called and the net cannot be armed (always, until step 13 builds the net). It takes nothing from
the environment (`sudo` clears it). Its own answers are single lines that begin with the call's id, a random word
code chose for that call, so a command's output cannot forge one.

| | How |
|---|---|
| The text that was approved is the text that runs (P-5) | The ask keeps the command's exact bytes and their SHA-256. The press hands the helper those bytes and that hash. The helper writes the bytes to a root-owned file in a memory folder (`/run/spark-console/<id>/command`, shown read-only inside the wall), hashes that file, refuses on a difference, and runs that file with `bash`. The same hash is in the journal's start line and in the unit's description, so the Spark's own log names what ran. A script the command names (`bash fix.sh`) is held the same way (`--held <path> <hash>`, built with step 7): the helper copies it once, checks the copy, and shows that copy in place of the file inside the wall. A file changed after the ask runs nothing; a file changed after the copy changes nothing. |
| Where the journal's start line sits (P-2) | Sort and gate; then the start line, written and synced (the id, the Spark, the wall, the hash, the unit's name, who allowed it); only then the script that calls the helper; then the end line. No start line, no call. The id is in the unit's name (`sw-run-<id>`, `sw-root-<id>`), so after a cut-off the Spark's own log says whether that command started and how it ended. A look (`sw-look-<id>`) writes one line, when it ends. |
| What it adds to a call | No second connection: the script that calls the helper first compares the helper's SHA-256 with the ones this build knows. `sudo` and the unit add about 0.1 to 0.2 s (inference; each step's record measures it). |

**How it reaches a Spark, and becomes root's.**

| Part | How |
|---|---|
| The command, as the owner sees it | `ssh -t <you>@<Spark 2> 'bash ~/spark-console-src/deploy/root-for-sparkie.sh 3'`: one line for each Spark, which Sparkie gives the first time `run` or `write_file` is tried there. `--check 3` changes nothing and says what is there; `--undo 3` removes it. Spark 2 itself is `--hub 2`, and comes last. Run from the Mac's copy of the repository, the script does one thing: it runs Spark 2's own copy of itself over ssh, so what is installed is always the installed build's. |
| What it copies | Two files, always from Spark 2's installed copy and never from the Mac: the helper (`deploy/spark-console-root`) and a short set-up script. They go to `~/.cache/spark-console/` on that Spark; then the set-up script runs there in a terminal, so `sudo` can ask that Spark's password, once. |
| Where it lands, and who owns it | The set-up script checks the copy's SHA-256 against the one Spark 2 sent, then `sudo install -o root -g root -m 0755` to `/usr/local/sbin/spark-console-root`. It refuses if `/usr`, `/usr/local` or `/usr/local/sbin` can be written by anyone but root. |
| The one line | `<owner> ALL=(root) NOPASSWD: /usr/local/sbin/spark-console-root`, written to a temporary file, checked with `visudo -cf`, then installed as `/etc/sudoers.d/spark-console-root` (root, 0440). It names one file and no other command. (sudo's manual: with no arguments listed the user may give any; the helper checks them itself.) Power's line stays its own file. |
| Then | It runs `prove` and prints each wall's result. If the proof fails it removes the line and the helper again and says which attempt got through: nothing half set up is left. |
| A later update | Only this command, run again. A build that ships a changed helper says so in its update note. From then on the console finds that the Spark's copy is not one it knows, and answers with the one command, as before set-up. Sparkie cannot do it by writing a file: the helper and its line are root's, the look and run walls cannot write them, the net wall holds them read-only, and a command that names either is answered with the one command, not run. **Owner's call:** whether Sparkie may ever replace the helper itself, as a dangerous ask that shows the difference. Default: no. |
| `--undo` | Removes the line, then the helper, then the proof's mark; `sudo` asks the password. The copies under `/var/lib/spark-console` stay. A put-back timer already armed still fires. |

**The proof of its walls.** Each attempt is made outside the wall first, as the owner's user, where it must work or
the thing must be absent ("not there"); then inside, directly and from a child process, where it must fail. Attempts
1 to 4 are step 1's own; 5 to 14 are what this mechanism makes necessary.

| # | The attempt | Look | Run | Why it is here |
|---|---|---|---|---|
| 1 | A write through a link: a link in a writable place that points at a read-only or hidden file | yes | yes | step 1 |
| 2 | An open connection: to its own loopback, to this Spark's own Tailscale (`100.100.100.100:53`, standing for the tailnet) and to its own address. No host outside the owner's own is contacted | all three | the loopback | step 1 |
| 3 | The Docker socket, the Tailscale socket, `api.sock` and the door's socket, each by its path and by a second path the proof makes to it | yes | yes | step 1 |
| 4 | Another process's environment (`/proc/<pid>/environ`) | yes | yes | step 1 |
| 5 | A write that stays: one file in every mounted disk, in `/tmp`, `/var/tmp` and `/dev/shm`, looked for from outside afterwards | yes | the read-only list | read-only is set mount by mount |
| 6 | Round the hiding: a hidden file through `/proc/<pid>/root` and `/proc/<pid>/cwd` of a program outside the wall | yes | yes | hiding is by path, and another program's view has other paths |
| 7 | A signal to a program outside the wall (one the proof starts for this, and ends) | yes | yes | a signal is neither a write nor a connection |
| 8 | More rights: `sudo -n true`, the helper itself, any capability beyond the one a look is given | yes | yes | root is only ever the typed kind (2.8) |
| 9 | Starting something outside the wall: the owner's service manager (`systemctl --user`), the system bus, `systemd-run` | yes | yes | systemd's manual: `NoNewPrivileges` does not cover what another service starts on request |
| 10 | A hidden key file: by path, through a link, by `*`, and by its file handle | yes | the first three | the read right allows opening by handle |
| 11 | A disk device and the GPU | yes | | read-only is about files and folders; a device is neither |
| 12 | Something left behind: a child put in the background is gone when the command ends | yes | yes | "nothing outlives it" (2.5) |
| 13 | Root with no net: `root` when no timer can be armed | | | the one page, section 7, item 2 |
| 14 | Moving the folder above a read-only one out of the way, and making a new one in its place (the proof's own folder at the top of the home, its `--protect` folder two levels inside) | | yes | a setting sits on its own path only: the folders above are pinned |

- **When it runs.** At the end of the one-time command. By the console before the helper's first use on a Spark, and
  whenever `check` says the proof is out of date. In `self_test`, on every Spark that is on. A pass writes a
  root-owned mark, `/var/lib/spark-console/proved`: the helper's SHA-256, systemd's version and the kernel's. No
  verb runs without a mark that matches now, so an update of the Spark's software means a new proof before the next
  command, with no timer and no password. One unit a wall carries all its attempts: about a second (inference).
- **When it fails.** No mark is written, so all three walls refuse on that Spark, also the ones that passed. `run`
  and `write_file` there answer "the wall proof failed on Spark 3: <the attempt>", and typed actions still work.
  The owner is told once, on the page and on Telegram; it is a needs-you line; `self_test` fails. It is tried again
  by `self_test` or by the owner's command, never by a timer.

**Spark 2** (so that step 11 has nothing to undo). The file, the lists and the line are the same on every Spark. A
path that is not there is skipped, so the helper never asks whether it is the hub: what only the hub has (`api.sock`,
the door's socket, the sign-in files, the console's local port, the plug controller on 127.0.0.1:5580) is on the
lists everywhere. Three things differ, none in the helper:
1. **How it is called.** The console's own unit forbids new privileges, so `sudo` fails in every child of the
   console. On Spark 2 code starts the call from the owner's service manager: `systemd-run --user --quiet --wait
   --pipe --collect sudo -n /usr/local/sbin/spark-console-root …` (the console starts its roll-back the same way).
   One function, `helperCall(node, …)`, holds the difference.
2. **The proof there also shows** that a plain `sudo -n` from a child of the console fails, and that the call
   through the service manager works (section 7 of the one page, item 1).
3. **The one-time command there** needs `--hub` and is run last, after the net has been tried on a compute Spark.

Step 11 then adds console code only: always asked, 10 minutes, the net armed for every command there (`run --net`,
which step 13 adds to the helper), `check_ways` after.

**The helper will change after step 1a**, and each change means the one command again on a Spark that already has
it: step 7 (`--held`), step 13 (the net: `--net`, `root`, `keep`, `putback`), step 12 (root's copy of named files),
step 14 (keys by name). So the owner is asked for the command when milestone 2 is whole; before that only to try
looks, on one compute Spark.

**Not verified; needs a real Spark, or one real run as root on a throw-away Ubuntu 24.04 arm64 machine before the
owner is asked.** That a unit with these settings starts at all on DGX OS (covering `/run` whole, the folder over
`/dev/shm`, the throw-away account with `--pipe`); that the address filter works there (it needs the kernel's eBPF
for control groups); name look-up inside the run wall; `sudo -n` with no terminal, over ssh and from the service
manager; that no other kernel guard (AppArmor) stops root's `unshare`; where Docker keeps its data; the time a call
adds. The proof is what decides each of these on the Spark itself.

### 2.14 The dangerous ask (step 10b)
Added 2026-11-14 to close the build map's third "unclear" item. The one page (section 4, "Dangerous asks are hard to
tap by reflex"; section 7, item 5) and the contract (8.18) require it before root, a lock-out change, an install, a
final delete and a change of brain. No step built it. Nothing was run.

**In short.** A dangerous ask is a risky ask (2.5, 2.8: the exact command, one press for one command, never a typed
"ok") with three things added by code. It is a message of its own that holds no word of the brain's. It opens with
facts that code built. Its press counts only with the two digits the ask shows. One is open at a time. Ordinary work
gets none of this.

**Which asks are dangerous.** Five kinds, a closed list. The sorter of 2.8 or the action's own code names the kind.
The brain never does, and no input of any tool adds or removes one.

| Kind | What raises it | Its first line | Raised by step |
|---|---|---|---|
| `root` | Any ask for a command or a file write that would run as root. (A plain root command that the ladder runs at once is not asked, so it has no ask at all.) | `ROOT on Spark 3` | 12 |
| `lockout` | A command the sorter puts in the lock-out class | `CAN LOCK YOU OUT of Spark 3` | 13 |
| `delete` | A delete that cannot be put back (2.6), and the disk commands of 2.8 | `DELETES FOR GOOD on Spark 4` | 10b (step 7 made it a plain button) |
| `brain` | A command that names the brain's container, its model files or its setup (2.8); `brain_across` (design D, step 12) | `THE BRAIN on Spark 2` | 10b; D's step 12 |
| `install` | `install_update`, for any build of Spark Console (design C, step 5). Sparkie's own proposal adds its facts (C, step 8) | `INSTALLS SPARK CONSOLE on Spark 2` | C's steps 5 and 8 |

- A command of two kinds is one ask whose first line joins them: `ROOT on Spark 2 · CAN LOCK YOU OUT`.
- "Installing its own code" (the one page) is read as any install of Spark Console, not only a change Sparkie wrote.
  That is the safer reading, and it costs two digits an install.
- A typed action that deletes for good keeps the button it has today (erasing a memory line is on the page only). If
  one is later opened to Telegram, it raises this ask.
- Anything else on Spark 2, power, a schedule and free-form container starts stay plain risky asks: one press.
- The page's own brain switch keeps its passkey, as today. It is not an ask.

**What it shows**, in this order. Every line is built by code from typed facts.

| # | Line | Built from | Built by step |
|---|---|---|---|
| 1 | The kind and the place, in capitals | The sorter's class, `root`, the Spark | the raiser (the table above) |
| 2 | `You asked for this.` or `You did not ask for this.` For an agent's request: `You did not ask for this. <the agent's name> did.` | The gate's own answer to rule 2 of 2.5 for this call (`sparkieCheck`): the owner's own words in this request ask for this kind of work and name this Spark. For `install_update` and `brain_across` it is their own word kind (R25). A question never counts. A go-ahead or an always entry is not "asked" | 10b |
| 3 | `It goes back by itself at 14:32 unless you confirm.` (inside the net), or `Can be put back: 3 files are copied first.`, or `This cannot be put back.` with what would go and its size | The guard's time (2.8); `kept` (2.6) | 13; 7 and 8 |
| 4 | `Came from, not from you:` and one line for each thing, for example `github.com/x/y/install.sh: the page raw.githubusercontent.com/x/y (read 14:02)` | "Came from", below | 10b |
| 5 | For the lock-out class: the ways-in files the command names. For an install: the tree, when it was tested, the files that differ from the build installed now, and the "what the brain reads" line (C 2.3) | The sorter's resolved paths; C's facts | 13; C's step 5 |
| 6 | `Runs outside the wall:` and why, when it runs with `run --open` (2.13) | The sorter | 7 |
| 7 | The exact command, whole, in fixed-width type. For `write_file`: the path and the lines that change, old and new. For a script or a fetched installer: its text and the first 12 characters of its SHA-256 | The bytes the press will run (2.13, P-5) | 7 (scripts); 12 (fetched code) |
| 8 | `To run it: press Run it, then type 47.` | The two digits, below | 10b |

- **An install** has no line 4 and no line 7: what it runs is the tree that line 5 names.
- **Buttons.** Two: the yes, in two or three fixed words (`Run it`, `Install it`, `Switch the brain`), and `No`. "Don't
  ask again for this task" and "Always allow" are never offered here (2.5).
- **Sparkie's reason is not in the ask.** It is Sparkie's ordinary reply, which follows the ask as its own message, as
  after any button today.
- **Long text.** Lines 1 to 6 always come first and are never cut. When the text of line 7 is 300 characters or more,
  one line goes before it, `Long: read all of it before you answer.`, and line 8 and the buttons come after the text,
  so they are reached only past it. Over 3,500 characters the ask is answered on the page only, like any ask (2.5):
  Telegram gets lines 1 to 6 and "This one waits for you in Spark Console." The safety review's other way (the text
  sent to Telegram as a file) is not built: this is the smaller mechanism, and nothing is cut or refused.

**"Came from"** (line 4). One comparison of strings, with no model call, made only when a dangerous ask is built.
- *The things.* From the bytes of line 7 code takes every address (a URL, a host name, an IP address), every path,
  and every package or image name (the words after `install`, `add`, `pull` or `run` of the package and image
  programs the sorter knows).
- *The owner's.* A thing found, ignoring case, in the owner's own messages of this request (the one that began it and
  the owner's later ones in it) gets no line.
- *Read.* Otherwise code looks for the thing in what was read in this request. Step 7 keeps `readOutside` as a list
  (2.12): the journal id of each outside read and a label code built for it ("the page <host and path>", "a web
  search", "the log of sc-glm on Spark 3", "a command's output on Spark 4", "the file <path> on Spark 3", "the
  journal"). The text is read back from the journal, which keeps it whole (B 2.1), the newest read first. The first
  read that holds the thing is where it came from. Sparkie's own earlier answers in this chat (the newest 20) are
  searched the same way, labelled "Sparkie's earlier answer (14:02)": a command quoted from an earlier answer counts
  as read (the one page, section 7, item 7).
- *Neither.* No line: the thing is Sparkie's own.
- *Limits.* The newest 40 reads and 64 MB of text in all. If a limit stops the search, the ask says `Not all of what
  was read was searched.` At most 8 lines are shown, then `and 5 more`. A label never quotes its source.

**The two digits.**

| | |
|---|---|
| What they are | Two digits, 10 to 99, drawn by code (`randomInt`) when the ask is built. A new pair for every ask |
| Where they are | With the pending ask, in memory, and in the ask's own text. Never in a journal line, the audit, a button's label or a tool result |
| What they bind | One ask. The ask holds its kinds, the Spark, the wall or verb, the SHA-256 of the exact bytes with the hash of any script it runs (2.13), and for an install the tree. A pair typed for one ask runs nothing else. An ask whose bytes changed is void, and its pair with it |
| When they count | Only while that ask is open, and only with that ask's own yes button. On the page the press opens a field for them, and one request carries the press and the pair. In the paired Telegram chat the press is answered "Type the two digits from the ask to run it.", and the owner's next message there is compared with the pair. A pair typed in Telegram with no press there is answered "Press the button first." and runs nothing |
| A wrong pair | Runs nothing and says so. The third wrong pair makes the ask void |
| Anything else typed after a press in Telegram | The press is forgotten (press again to answer), the ask stays open, and the message goes to Sparkie as usual |
| What they are not | Proof of who is typing: whoever can read the ask can read them. They make the owner look at the ask. What slows a phone in another hand is step 10a's caps and `/lock`; what stops it is the daily code (step 10c, below) |

**Where it may be answered.**

| Who asked | Where the ask is shown | Where it is answered |
|---|---|---|
| The owner's own chat, on the page or in Telegram, or a task of the owner's | In that chat on the page, and in the paired Telegram chat | On the page. Or in the paired chat, while "Approve from Telegram" is on (2.5), Telegram is not locked (`/lock`), and the caps allow it (3 risky approvals an hour and 10 a day; a dangerous approval counts as one) |
| An agent talking to Sparkie: `ask_sparkie`, or a chat an agent started | In that conversation on the page, and in the paired Telegram chat. Line 2 names the agent | As the row above, by the owner. The agent is told "asked: it waits for the owner" and can answer nothing |
| A call with no conversation: an agent's own tool call, `POST /actions`, a saved workflow's step | Nowhere. The call is answered "the owner asks Sparkie for this in their own chat", as an owner-only question is today (`question`, `17-changes.mjs`). This is the smaller mechanism, chosen: no new place to show an ask | Not answered there |
| Any of them, when the command changes who may approve: passkeys, recovery codes, Telegram's pairing, the approvals switch (2.8) | As above; Telegram gets the facts and no button | On the page only |

On the page the answer needs what an owner-only button needs today: the owner's signed-in page, and the passkey when
the sign-in came over the internet (R6, R31). The keeping of a lock-out change is a different answer with its own
rule (the fresh visit of 2.8, step 13).

**One at a time.** One dangerous ask is open in the whole of Spark Console. While it is open, a call that needs
another is answered "waiting for your answer to the ask already open", with that ask's first line, and nothing is
sent or run. A task parks there, as at any button. A third dangerous ask built inside ten minutes is sent one minute
late, and its fifteen minutes start when it is sent.

**What cancels it.** A void ask runs nothing. Its buttons go grey on the page, and a later press or pair is answered
"That ask is no longer open. Ask again."
1. `No`, on the page or in Telegram.
2. Fifteen minutes after it was sent (every ask's life today: `pendingChoices`). A press does not add time.
3. The third wrong pair.
4. A restart of Spark Console, and a new Telegram pairing (the one page; contract 8.17).
5. `/stop` in the chat that asked, and `/pause`.
6. What it shows is no longer what would run: a script whose bytes changed, `main` moved under an install, a helper
   on that Spark this build does not know, a guard already open on that Spark. A new ask is built from the new facts.
7. `/lock`, or "Approve from Telegram" switched off: void in Telegram only. The page still answers it.

**The record.** The ask, its answer and its end are journal lines like any other (2.11). `gate` says `asked:telegram`
or `asked:page`; `danger` holds the kinds; `asked` is line 2 as true or false; `from` holds line 4's labels. Never the
digits. An approval from Telegram is echoed on the page (step 10a).

**Where the code goes.** A new part, `20-danger.mjs`, so that the full parts do not grow: `dangerAsk(viewer, ctx,
{kinds, where, facts, shown, call})`, which every raiser calls in place of `question`; `cameFrom`; the digits; the
one-at-a-time rule. A pending choice (`question`, `17-changes.mjs`) gains one field, `danger`. `runChoice`
(`14-chats.mjs`) and `tgPress` (`21-telegram.mjs`) check it. `public/app.js` gets the field for the pair. A step that
lands before 10b asks with today's owner-only button on the page; 10b turns every such ask on `main` into this one
(`delete`, `brain`, and `install` if design C's step 5 is in).

**The daily code (step 10c; a switch, off by default).** The one page lists "a four-digit code once a day for the
dangerous presses" as a switch. No other step needs it.
- Set, changed and removed on the page only, with the passkey. Kept with the pairing in the secrets file, as a salted
  hash, and never shown back.
- While it is set: the first dangerous answer from Telegram in any 24 hours is asked for it after its two digits
  ("Send today's code."). The bot deletes the owner's message that holds it, at once. A right code runs that ask, and
  dangerous answers from Telegram then count for 24 hours.
- A third wrong code turns Telegram approvals off, as `/lock` does. Only the page turns them on.
- The page never asks for it.

## 3. Rules kept, and rules that must change
Kept as written: R2 (`appRoom` before every command, a memory cap on each), R10, R12, R20 and R22 (`work.json`,
`allowed.json`, `changes.json`: one writer each), R27, R28. One new rule, **R41 "Sparkie's hands"** (2.2 to 2.10), and:

| Rule | It says | The line to add |
|---|---|---|
| R3 | "No action changes SSH, Tailscale, firewall, users or access" | Replaced (decision 22): Sparkie changes these only when the owner asks, as a risky change: asked on Telegram and the page, copied first, and kept only if the owner confirms inside the window (2.8). `AGENTS.md`'s "Never touch SSH, Tailscale, firewall or user settings" and contract 8.3, 8.7 and 8.11 change with it. |
| R1, R8 | "No new workload starts on the brain's Spark"; protected containers and the brain's are never stopped | Workloads: unchanged. A host command on Spark 2, and anything touching the brain's or a protected container, is risky: always asked first. |
| R6, R32 | An owner-only button needs the passkey and the page; `PAGE_ONLY` never runs from a channel; `tell()` sends only replies, results and fixed lines | A press in the paired Telegram chat answers an owner-only button while "Approve from Telegram" is on. `PAGE_ONLY` shrinks to changes to who may approve. `tell()` gains the ask: the exact command and its buttons. |
| R7 | Masking by key shapes | Also the exact value of every saved key a command was given; a saved key reaches a command only through code. |
| R11 | "anything new that changes a Spark goes through `runAction`, a claim, a job and `run`" | A host change: `runAction`, the claim and `run`; a job only when long. A box step: no claim. A look: a read. |
| R13 | "One change per Spark: claim before the job exists" | Kept for host changes; a box takes none (digging must work while a model downloads). |
| R25 | "A change from Sparkie runs at once only when the asker's own words … ask for that kind of change and name its target" | For a host change also: nothing was read since, or the owner's go-ahead or always entry covers it; anything risky is asked whatever the words. "Intent never comes from notices or tool results" stays. |
| R26 | `readOutside`, set by lookups, for one turn | Set by every outside-text action and the task card, and kept for the task. |
| R37 | "Sparkie and agents reach files only in a Spark's shared folder, only through the worker's `workspace-files`" | Also: a box's folder from inside the box; and a Spark's files by a typed, resolved path, copied first; key material is never read back. |
| R38 | "`keep_running` is the only way a container that is not a model is started, kept, restarted or stopped" | Except a box; and a free-form Docker start or stop the typed actions cannot express, which is risky and asked. |
| R9, R23, R34, R39 | the pause; events; the owner's words; web lookup | A failed ways-in check trips the pause and writes one notice. `/stop` also ends a command and a go-ahead; `/allowed` joins the words, on Telegram too. An address in a host command passes R39's test or is a listed package source. |

## 4. Build steps, in order (each ships alone)
Every step updates `test/lib.mjs` (the counts go from 27 and 42 to 29 and 49), the door and fuzz tables, the map and
the code map. Tests go in a new `test/work.test.mjs`. Steps 7 to 14 need only 1, 3 and 5, so they can come before the box.
Step 1 builds the root helper before the first look: without it `run` and `write_file` do not work on a Spark (2.3).

| # | Step | Files | The test that fails without it |
|---|---|---|---|
| 1a | The root helper, its one-time command and the proof of its walls (2.13). No action: nothing calls it yet | `deploy/spark-console-root` (new: `check`, `prove`, `look`, `run` with `--open`, `--protect` and `--stdin`; `root` always refuses); `deploy/root-for-sparkie.sh` (new, with `--check`, `--undo`, `--hub`); stand-ins `systemd-run`, `systemctl`, `unshare`, `setpriv` and `visudo` in `test/mock/bin` (not `sudo`: the power work owns it); `test/root-helper.test.mjs` (new); `docs/rules/R42.md` (new: the helper's part). Run by anyone but root the helper is a rehearsal: it takes its folders from under one test folder and calls the stand-ins, and refuses without that folder; run as root it has no test switch | The wall proof fails the helper when any attempt of 2.13's list succeeds, directly or from a child process (the four first: a write through a link, an open connection, the Docker or Tailscale socket or `api.sock`, another process's environment): with the stand-in told to let one attempt through, each in turn, `prove` names it, writes no mark, and `look` and `run` then refuse. For hostile commands (quotes, `$`, `%`, new lines, a folder with spaces) the unit asked for carries exactly the fixed settings of its wall and the command's bytes arrive unchanged; one changed byte starts no unit. A Spark with systemd 247, or an `unshare` without `--kill-child`, is refused by name. A mark from another systemd version is out of date. `root` refuses. The helper refuses when another account can write its file. The one-time command puts the line in only after `visudo` passes; a failed proof leaves neither file; a second run changes nothing; `--undo` removes both; Spark 2 is refused without `--hub`. |
| 1b | `run` as a look on any Spark (this design's `host_look`), inside the look wall | `21-work.mjs` (new part: `helperCall`, the look, the "run this one command first" answer, the known-helper check, the key-name check, the short table of exact forms); `21-selftest.mjs` (the proof as a line of `self_test`); `test/mock/bin/sudo` (one more allowed command, once the power work has landed); `deploy/host-on-portal.sh` (ships the two files); the action lists; `test/work.test.mjs` (new); `docs/rules/R42.md` and a card. Needs B1 and F10 first | On a Spark where the one-time command has not run, or whose helper this build does not know, a look and a change each answer with that one command and run nothing, and the typed actions still work there. `self_test` runs the same proof, and a failed proof stops every look there and tells the owner once. A look that tries to write or send changes nothing. A key file is refused directly, through a link, through `*`, and under `grep -r`; `authorized_keys` is readable. Works on Spark 2, where the call goes through the owner's service manager; masked, cut for the brain, recorded whole. A chat turn with no work makes no `run()` call. |
| 2 | The box, its self-check, `workspace` | `21-work.mjs`; `16-actions.mjs`; `17-changes.mjs` (`changeLabel`); `19-watcher.mjs` (skip the label); `config.json` (`work.images`) | The flags are exactly the fixed list for hostile inputs. Spark 2 is refused. A self-check that finds a network refuses the open. |
| 3 | `work_run` in the box, `work_read`, the loop's budgets | `21-work.mjs`; `14-chats.mjs` | Output cannot forge the exit line. A timeout and `/stop` remove the box. The 8 GB rule refuses. The step budget ends the turn with a report. |
| 4 | `work_write`, `work_edit` in the box | `21-work.mjs` | An edit must match once. A link in the box cannot move a write out of it. |
| 5 | Live steps and the command button | `14-chats.mjs`; `public/app.js` | The `tool` event carries `where`, `line`, `tail`, masked; `test/install.test.mjs` still passes (R30). |
| 6 | `minutes` on `run`: a command as an operation (2.10). No task card | `21-work.mjs`; `07-jobs.mjs` (the job type `run`); `14-chats.mjs` (`OP_WORDS`); `20-tell.mjs` (`TELL_OPS`) | `run` with `minutes: 5` returns an operation at once; its end is posted with the exit code and a journal id and none of the output, and one carry-on turn runs. Exit code 3 ends the operation completed, not failed. A look asked with `minutes: 5` is held to 1 and says so; a command on Spark 2 asked with `minutes: 30` is held to 10. A command still running at its limit is stopped with everything it started, and the result says "stopped at its limit". `cancel_operation` stops its unit. A console killed while it runs: after the restart the unit is stopped by name, there is one "cut off" notice, and it is not run again. Without `minutes` a 40-second command is stopped at 30 s. |
| 7 | Host changes on a compute Spark, with the copy first | `21-work.mjs` (`hostClear`, the sorting of 2.8, the unit, the copies, the ways-in check); `16-actions.mjs` (`CHANGE_WORDS`, `sparkieCheck`) | The owner's words naming the Spark, with nothing read, run at once, from the page and from Telegram. After a `container_logs` read the same call is a button whose label is the exact command, and a press runs exactly that. Each (b) row is a button even under perfect words; each (c) row is not done and says why. `sudo` inside a non-root unit fails. A stand-in command that changes `authorized_keys` unasked is put back, pauses and notices. A second change meets the claim. An agent's call is a button. `/stop` kills the unit. Every named file is copied first. A change whose start line cannot be written to the journal runs nothing and says so, while a look, `/stop` and `/putback` still answer; a console killed after a write leaves a start line with no end, one "cut off" notice, a file that `undo_last_change` restores from `before/<set>/`, and no second run. An ask shown for `bash fix.sh` whose file is changed, or is a link pointed elsewhere, before the press runs nothing and asks again with the new text; an unchanged script runs once; a file rewritten after the runner opened it does not change what ran. The "read outside text" mark survives a console restart, and it is a list: after a page and a log were read, `conv.task` names both, each with its journal id and a label built by code (2.12). |
| 8 | Change sets and `put_back` | `21-work.mjs` (`changes.json`) | Two edits and a made file in one task: `put_back` restores both and removes the made file; a file changed since is left and named. The answer lists what was not restored. Copies over 7 days or 2 GB are pruned when a set opens. |
| 9 | The go-ahead and the always list | `21-work.mjs` (`allowed.json`); `14-chats.mjs`; `20-words.mjs` (`/allowed`) | The owner's sentence, or the second answer, lets the next host change run after an outside read, and ends at each of its ends. A tool result saying "go ahead" grants nothing. "Always" is added only by the owner's press: an agent's and a typed yes are refused. A matching command runs with no button; one outside its folder (also through a link), or as root under a non-root entry, does not. Neither answer covers a (b) row or Spark 2. |
| 10a | Asking on Telegram, and its switch | `20-tell.mjs` (`ask`); `21-telegram.mjs`; `14-chats.mjs` (`runChoice`); `22-passkey.mjs`; `03-secrets.mjs` | A risky change sends one ask with the exact command to the paired chat and shows the same button on the page; a press on either runs it once. With the switch off a Telegram press is refused and the page still works. Another chat gets silence. A command over 3,500 characters is asked on the page only. An ask is void after a console restart and after Telegram is paired again. |
| 10b | The dangerous ask (2.14). Needs step 7 | `20-danger.mjs` (new: `dangerAsk`, `cameFrom`, the digits, one at a time); `17-changes.mjs` (`question`: the `danger` field); `14-chats.mjs` (`runChoice`); `21-telegram.mjs` (`tgPress`, the pair as the next message); `public/app.js` (the field for the pair); new `test/danger.test.mjs` | A final delete proposed after a `read_page`: the ask is its own message and holds no word of the stand-in brain's; its first line is `DELETES FOR GOOD on Spark 3`; it says `You did not ask for this.`; a path that is in the page and not in the owner's words is listed with that page's label, and one the owner typed is not. A press with no pair runs nothing. A wrong pair runs nothing, and the third makes the ask void. The pair typed in Telegram with no press there runs nothing. A typed "ok" runs nothing. The right pair after the press runs the exact bytes, once. One ask's pair does not answer the next. With one ask open, a second dangerous call answers "waiting" and sends nothing; a third inside ten minutes is sent a minute late. Void after each of: `No`, 15 minutes, a restart, a new pairing, `/stop`, `/pause`, a script changed since the ask. After `/lock` a Telegram press is refused and the page still answers. An agent's request through `ask_sparkie` is asked in both places and names the agent, and the agent's own answer runs nothing; an agent's own tool call, with no conversation, gets no ask and is told the owner must ask Sparkie. A command that changes Telegram's pairing gets no Telegram button. The delete that step 7 made a plain button is now this ask; a plain command on Spark 2 is still one press. A 400-character command has `Long:` before it and the digits after it. The digits are in no journal line, audit line, label or tool result (searched for exactly). |
| 10c | The daily code, a switch that is off (2.14) | `21-telegram.mjs`; `22-passkey.mjs`; `03-secrets.mjs`; `20-danger.mjs` | With no code set nothing asks for one. With one set: the first dangerous answer from Telegram in 24 hours runs only after the right code, and the message that held it is deleted; the next dangerous answer that day needs none; a third wrong code turns Telegram approvals off, and only the page turns them on; the page never asks for it; it is set and removed only with the passkey. |
| 11 | Host changes on Spark 2 | `21-work.mjs` (console code only: the helper is the same file on every Spark, 2.13) | Perfect words, a go-ahead and an always entry still ask. The call reaches the helper through the owner's service manager, so the command runs outside the console's unit; it runs inside the net and is held to 10 minutes. A failed `check_ways` puts back, pauses and notices. |
| 12 | Root commands | `21-work.mjs`; `deploy/spark-console-root` (the `root` verb's copy of named files; `--undo` was built in step 1a) | On a Spark set up in step 1, `root: true` runs through the helper's `root` verb, with the net armed in the same call, and the button and record say "as root". A command that names the helper or its line is answered with the owner's one command and runs nothing. The word `sudo` in a command is answered "set root". A root script is always asked. A root command inside the net is held to 30 minutes, 10 in the lock-out class. An installer from an address is downloaded once, when the ask is built: a stand-in server that answers differently the second time sees one request, and the press runs the first text. After `--undo`, `root: true` answers with the one command again. |
| 13 | The lock-out net | `21-work.mjs` (`guard`); `deploy/spark-console-root` (the copy list, `restore.sh`, `--net`, `keep`, `putback`: 2.13) | The timer is armed before the change (the mock records the order); if arming fails nothing changes. A failed check restores at once. No confirm: the stand-in timer fires, the files are back, the owner is told. A confirm stops the timer. Sparkie's own call cannot confirm, and `/stop` does not stop the timer. A restart inside the window restores at start. `tailscale logout` says it cannot be put back. The timer recorded is the unit's time limit plus 600 s, for a 30 s command and a 20-minute one; a lock-out command asked with `minutes: 30` is held to 10. A put-back stops the command's unit before the first copy back, and 5 s later the restored bytes are still there, also when the limit and the timer end together and for a child the command left behind. With a guard open, also after a console restart, a second root command on that Spark answers "waiting for your confirm" and runs nothing. "Keep it" after the stand-in timer fired answers "already put back". An expiry where nothing differs reloads nothing. A sign-in change is not kept by a standing session, nor by a link opened before the change was live. |
| 14 | Keys by name. Two keys given at the door have a home of their own in the secrets file and are saved through their own check: `GITHUB`, the pull install's token (design C, 2.3), and the heartbeat's address, known by its shape (design E, 2.4) | `21-work.mjs`; design E's store | The value is in no command text, output, record or tool result (searched for exactly). A heartbeat address pasted in the owner's chat starts the beat and is in no chat file; a `GITHUB` token that the stand-in GitHub refuses is not kept. An address outside the key's hosts makes the command risky. The file on the memory disk is gone after the command. A made-up key is searched for, and not found, in error fields, in the state copy and after a restart. |
| 15 | Eval cases; the trial's contestant; a job may read a box; code fills a box (C) | `test/eval/cases.json`; `agentbar/`; `21-apps.mjs` | `agentbar --dry` still fails every untouched task. A job with `work` has one more mount, read-only. |
| 16 | Internet for a box, through a gate | later | — |

After steps 1, 2, 7, 11, 12 and 13, check each on a real Spark as the owner would: step 1's wall proof once on each
Spark (the one-time command runs it and prints each wall's result); step 13 first on a compute Spark with a harmless change (a comment in `sshd_config`), once confirmed and once
left to go back by itself.

## 5. Risks, and open questions
| Risk | What bounds it |
|---|---|
| **Text Sparkie read steers a root command, and the owner taps yes without reading.** The largest risk left. | Risky kinds are asked every time, one command a press, never under a standing answer. The button is built by code: the exact command, "as root", whether it can be put back, and "Sparkie read outside text before proposing this". Root scripts and fetched code always show their text and address. Files are copied first; lock-out changes go back unless confirmed; everything is recorded. None of this helps if the tap is a reflex: the fewer asks, the more each one is read, which is why the ladder keeps ordinary work off the button. |
| **A lost or borrowed phone.** In the paired Telegram chat it is the owner: it can ask, approve and confirm. | Telegram's own passcode lock; unpairing or the "Approve from Telegram" switch, from the page, with no passkey needed to turn it off; asks expire in 15 minutes; changes to who may approve are confirmed on the page, so a phone cannot pair itself deeper or remove the owner's passkeys; the record shows every press. |
| The helper is a door to root for anything running as the owner's user on that Spark (the one page, section 9, item 4) | Already true through Docker. A plain `sudo` in any other script still asks for the password. Sparkie's own commands run inside a wall that cannot call the helper, so root is only ever the typed, visible kind. |
| The net cannot put back everything | A Tailscale logout, a deleted home, a Spark that will not start, anything outside the Spark. The button says so before; physical access is the last way in. |
| Under a go-ahead or an always entry, outside text can shape an ordinary command | Never a risky one, never on Spark 2; the copy first, the ways-in check, the limits and the record. |
| A saved key leaves the house | A command given a key may name only that key's hosts; its exact value is masked everywhere; a script that hides the address is "unseen" and asked as root, but not as the owner's user: that gap stays. |
| Not verified, needs a real Spark | The helper's wall proof, and that its units start at all on DGX OS (the list at the end of 2.13); the box's self-check; `sudo -n` of the helper over ssh and from the owner's service manager; `restore.sh` for Tailscale's settings and the firewall; whether a memory cap bounds what the GPU takes. |

Defaults chosen without asking (decision 16): no engine; looks replace the fixed scripts; root through one helper (the
one page), never a stored password; a confirm window of the command's time limit plus ten minutes; Telegram approvals on once paired,
with the page switch; a go-ahead lasts one task; always entries are per Spark and per kind; an always-allowed kind
also runs from Telegram and unattended.

Questions (a wrong guess could lock the owner out or delete data):
1. **Root:** will you run the one-time command on each Spark? Until then `run` and `write_file` do not work there
   (no looks, no changes, no root, no net): Sparkie uses today's typed actions and hands you the command.
   Recommended: yes, on the compute Sparks first, Spark 2 after the net has been tried.
2. **Risky approvals on Telegram: a tap, or a tap plus a short code you type?** Recommended: a tap, as you asked. The
   code would be the one thing that stops a phone in someone else's hand.

## 6. Left out on purpose
- **An engine**, a second loop, sub-agents, a compactor, a to-do tool (`NOTES.md` and a fresh turn do that work).
- **A lasting shell.** Each command starts clean, so nothing is left running; what must keep running is `keep_running`.
- **A stored password**, `sudo` for everything, a list of allowed root commands, and root that a command can reach by itself.
- **A fleet-wide or free-text "always"**, a go-ahead from memory, and a standing answer for anything risky.
- **A look grammar and a list of allowed programs**: inside the helper's look wall any command may be a look (2.3).
- **Putting back packages, containers' insides and databases**; a trash beyond the 7-day copies.
- **The GPU, ports, custom images and the internet in the box** (the last is step 16, when the owner says so).

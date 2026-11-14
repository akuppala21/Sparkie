# A. Sparkie's hands: looks, the box, and commands on the Sparks (design, revised for decisions 18 to 22)

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
| A compute Spark itself | at once, inside the grammar (2.3) | at once when 2.5 holds; else a button showing the exact command |
| Spark 2 itself | at once, inside the grammar | always asked first, on Telegram and the page (2.7) |
| Everywhere | a key is never shown back | a copy first (2.6); risky kinds always asked; lock-out changes confirm or go back (2.8) |

- **Spark 2 stays light.** It runs the loop, three small state files and the record. A look or an approved command
  runs there only while it runs, as a short-lived unit. No box, image, workspace or new service.
- **How a command gets there:** `run(node, script)` (R10): ssh as the owner's user, local bash on Spark 2, as today. No
  daemon, key, port or listener. A look's every word, and a change as a whole, reach the Spark single-quoted (`q()`).
  Nothing wakes a Spark for a look; a box or a host change needs its Spark on, else `needs-spark` (decision 13).

### 2.3 Looks: how code knows a command only reads
`host_look {spark, command, root}` **replaces** the first design's five fixed scripts (they become example lines in its
description). A small parser in code (`lookParse`) checks the grammar; it does not guess:
- **Shape:** one program with its words, then at most three pipes, each into a filter. **Refused outside quotes:** `;`
  `&` `&&` `||` `>` `<` `` ` `` `$` `(` `)` `{` `}`, backslash, new line; inside double quotes `$`, `` ` `` and
  backslash too. So no chaining, redirection, substitution, variable, sub-shell or background.
- **Every word reaches the Spark single-quoted**, so the shell expands nothing. Code expands two things itself: a
  leading `~/`, and `*` or `?` in the last part of a path. An option that is the start of a refused one is refused too.
- **The program is on the read list, with only the sub-commands and flags listed.** With `root` (2.8) the same look
  runs as root, for what only root may read (the kernel log, `/var/log`, another user's files):

| Family | Allowed |
|---|---|
| Files, search | `ls` `stat` `file` `du` `df` `tree` `cat` `head` `tail` (not `-f`) `wc` `nl` `diff` `cmp` `sha256sum` `readlink` `realpath` `which` `grep` `rg`; `find` without `-exec` `-execdir` `-ok` `-delete` `-fprint…` `-fls`; `sed -n 'N,Mp'` and nothing else of `sed` |
| System | `uname` `uptime` `date` `id` `whoami` `groups` `hostname` `nproc` `free` `vmstat` `lscpu` `lsblk` `lspci` `lsmod` `findmnt` `ps` `pgrep` `pstree` `top -b -n 1` `lsof` `ss` `printenv` `sensors` `dmesg` `lsb_release`: reading flags only |
| Services, logs | `journalctl` (never `-f`, `--vacuum…`, `--rotate`, `--flush`); `systemctl [--user] status`, `show`, `cat`, `list-units`, `list-unit-files`, `list-timers`, `is-active`, `is-enabled`, `is-failed`; `crontab -l` |
| Docker | `docker ps`, `images`, `inspect`, `logs` (not `-f`), `top`, `port`, `diff`, `history`, `version`, `info`, `stats --no-stream`, `system df`, and `ls` or `inspect` of `network`, `volume`, `image`, `container` |
| GPU, links | `nvidia-smi` (plain, `-q`, `-L`, `--query-…`, `--format`); `ip [-s] addr`, `link`, `route`, `neigh` (show only); `ethtool` (plain, `-i -S -m -k -g -a -c`); `ibstat`, `ibv_devinfo`, `rdma … show`; `ping -c` 1 to 5; `tailscale status`, `ip`, `netcheck`, `version`, `serve status`, `funnel status` |
| Packages | `dpkg -l`, `-s`; `apt list --installed`; `apt-cache policy`; `pip list`, `show`, `freeze`; `conda list`, `env list`, `info`; `python3`, `node`, `pip` `--version` |
| Local answers | `curl` with `-s -S -i -I -f -m N` only, one address on `127.0.0.1` or `localhost`, GET only, never Spark Console's own port |
| Filters, after a pipe | `grep` `head` `tail` `wc` `sort` (no `-o`) `uniq` `cut` `tr` `jq` `column` `nl`, with no file names |

| Beyond the grammar | How it is settled |
|---|---|
| A key is never shown back | A fixed check runs on the Spark, in the same script, before the command. It resolves every path word (links followed) and refuses one that is, or for a program that walks folders contains, key material: private keys (`~/.ssh/id_*` but not `.pub`, `/etc/ssh/*_key`, `~/.gnupg`, `*.pem`, `*.key`), the secrets file (`~/.config/spark-console`) and design E's key store, token and credential files (Hugging Face, `.netrc`, `.git-credentials`, `~/.docker/config.json`, `~/.aws`, `~/.config/gh`, `~/.ngc`), `/var/lib/tailscale`, `/etc/shadow`, `/proc/*/environ`, shell histories. Everything else may be read, `authorized_keys`, `sshd_config` and Spark Console's own state included. `grep -r token ~` is refused and told to name a folder. |
| What falls outside | It is a change (2.5) or box work: any program not listed (`git`, `awk`, `xargs`, `tee`, editors, interpreters, `bash -c`), `docker exec`, `run`, `cp`, `curl` to anywhere else, any script. The refusal names the rule that failed and the two ways on. |
| Limits | 30 s (60 at most), low priority, no input, 1 MB kept, 6,000 characters to the brain, two at once a Spark. Output is masked and is outside text. An outside agent may look only if its key may also change things. |
| What it cannot promise | That a listed reader has no surprising flag (so many-purpose programs are allowed word by word, and a table of must-pass and must-refuse commands is the test), or that no key lies outside the list (the mask, and a record that never leaves Spark 2, are the backstop). |

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
proposing it; for an edit the path and lines changed; for a script Sparkie wrote, its text. Over 3,500 characters it
is asked on the page only: nobody approves what they cannot read. Answers: "Yes", "Yes, and don't ask again on Spark 3
for this task", "Always allow …" (when the command has a kind), "No". **One switch on the page, "Approve from
Telegram"** (kept with the pairing in the secrets file; on needs the passkey, off never does; on once paired, by
decision 20): when off, an ask still arrives on Telegram as a notice and is answered on the page.

| | The go-ahead (one task) | Always allow (a standing list) |
|---|---|---|
| What it is | "Allow for this session": host changes on the named compute Sparks, in that chat, for that request, also after outside text was read | A **kind**: five checked facts, never free text: the Spark; the program; its sub-command (the first word that is not an option); a folder every path in the command resolves under; root or not. For a typed edit: the Spark, `edit`, the folder, root or not. Only a simple command (one program, read by the look tokenizer) has a kind |
| Given by | The owner's words in that chat ("do what you need on Spark 3 for this"), or the second answer of a button. Never a notice, a tool result, an agent or memory | Only the owner's own press, on Telegram or the page, of the answer code built: "Always allow `pip install` under `~/venvs/glm` on Spark 3". No action writes the list, so an agent, a typed yes and Sparkie itself cannot |
| Kept | In memory only | `allowed.json` (state folder, `writePrivate` and `readKept`, one writer `saveAllowed`, 50 entries): `{id, spark, program, sub, under, root, kept, addedAt, uses, lastUsedAt}` |
| Effect | Skips rule 3 | Skips rule 3 and the naming of the Spark in rule 2, in the owner's chats and tasks (never for an outside agent). Every other check still runs |
| Ends, or is taken back | With the task (Sparkie's last answer with nothing left to carry on); at the owner's next new request; `/stop`; `/pause`; 2 hours; 120 steps; a console restart; a failed ways-in check. One quiet line shows while it holds | By the owner's words, answered by code on the page and on Telegram (R34's pattern): `/allowed` lists the entries, numbered; `/allowed off 3` removes one, `/allowed off all` every one. `sparkie_setup` shows the list |
| The cost, plainly | Text Sparkie read can shape a command. The risky list, the copy taken first, the ways-in check and the record stand behind it | The same, for longer |
| Never covers | Spark 2; anything risky (2.8); another chat | Spark 2; anything risky (2.8); shells, `xargs` and `docker exec` (they run whatever they are handed); a line with chaining or redirection |

| Part | How |
|---|---|
| How it runs | One script through `run()`: `appRoom` first (R2), the copies (2.6), then the command as a short-lived systemd unit, so it is capped, timed and killable by name and nothing outlives it: `systemd-run --user --wait --pipe --collect --unit sw-h<n> -p MemoryMax=8G -p TasksMax=512 -p RuntimeMaxSec=<s> -p NoNewPrivileges=yes bash -c <command>`. With `root: true` the same unit is started by `sudo -n systemd-run …` without `NoNewPrivileges` (2.8). |
| Keys by name (decision 22) | `keys: ["hf"]` on `work_run`, in a box or on a Spark: code takes each value from design E's store, writes them to an owner-only file on the Spark's memory disk for the life of the command (the unit's `EnvironmentFile`, a box's `--env-file`) and removes it. The command says `$HF_TOKEN`; the value is never in the command text, and code masks that exact value in the output, the record and what the brain sees. A command that uses a key may name only that key's own hosts (E keeps them) or the fleet's; any other address makes it risky. |
| Other askers | An outside agent's host change is always a button for the owner. A brain graded `careful` (design E) gets a button for every host change. An unattended task follows the same ladder from its request's words and, at a button, parks and asks on Telegram. |

### 2.6 Put-back: a copy first, and change sets
| Part | How it works |
|---|---|
| A copy first | Before a file tool or a host command edits, replaces or removes a file, code copies it (as root when the command is root): for a typed tool, that file; for a command, every existing file its words and redirections name, resolved. Copies go to `~/.local/share/spark-console/before/<set>/` on that Spark (owner-only): 16 MB a file and 128 MB a command at most; kept 7 days, the newest 20 sets and 2 GB a Spark; pruned when a new set opens (no timer). |
| A change set | One per request or task, in `changes.json` on Spark 2 (state folder, one writer, the last 50): files (path, kept or why not, hash before and after, made new), containers started or stopped (operation ids), packages (`pip`, `conda`, `npm`, `apt`: the list before and after), units touched, keys used (names), and `unseen` when a step's effects could not be known. A `find -newer` over a command's folders adds what it made or changed without naming. |
| `put_back {set}` | Restores the kept files of one set (this chat's latest when none is named) and removes files the set made that are unchanged since. It opens its own set, so it can be put back too, and says what it did not restore. Containers go back with `undo_last_change`, which exists. |
| What cannot be put back | A deleted volume or image; a database's contents and anything changed inside a container; a file too big to copy, or changed by a command that did not name it; packages (the list from before is given, not replayed); a stopped process; anything sent over the network. |
| How the owner is told before | Code marks each host change `kept` or `not kept`. A deleting command (`rm`, `rmdir`, `shred`, `truncate`, `dd`, `find -delete`, `git clean`, `git reset --hard`, `docker rmi`, `volume rm`, `prune`, `pip uninstall`, a `mv`, `cp` or `>` over a file) that is not fully kept is risky: always a button saying "This cannot be put back" and what would go. A fully kept delete follows the ladder. Any other step with unseen effects (a script, an install, `docker exec`) says "not covered by put-back" on its step line as it starts, on any button and on an always entry. |

### 2.7 Spark 2 itself
Looks: as anywhere. A change on Spark 2 is risky by decision 20:

| Part | How |
|---|---|
| Who says yes | Always asked first, on Telegram and the page: one command a press, the exact command shown. Never under a go-ahead, the always list or an agent's say-so; an unattended task parks and asks. |
| How it runs | As a short-lived unit started by the owner's systemd, not as a child of the console (which sits inside its 512 MB and cannot use sudo): 2 GB, 10 minutes. A command that would leave something running there, or start a container, says so on the button: the hub runs the console and the brain and nothing else (decisions 2, 19). |
| Before and after | The copy (2.6) and the ways-in check (2.8), plus `check_ways`, the console's files and units, port 8443's three routes and the brain's container answering. On a miss: put back what code can, pause Sparkie's host changes, tell the owner what differs. A lock-out change goes under the net of 2.8. `go-back.sh` stays the by-hand way back. |

### 2.8 At once, asked first, or not done (decision 22)
Code sorts each host command (its words through the same tokenizer, a typed path after it is resolved, a script
Sparkie wrote before it runs): **(a)** the ladder of 2.5; **(b) risky:** always a button on Telegram and the page with
the exact command, one press for one command, never under a go-ahead or an always entry; **(c) not done**, and never
for lack of permission. The gate that reads only the owner's words, the record and `/stop` hold for all three.

| What | Class | Notes |
|---|---|---|
| Becoming root | (a) or (b), by what the command is | Through the typed `root: true` only (below). |
| Keys and sign-ins to services (`docker login`, `gh auth`, a token for a download) | (a) | By a saved key's name, injected by code (2.5). |
| `ssh` and `scp` between the fleet's own Sparks; packages; services and files under `/etc` not named below | (a) | Copy first. |
| Container starts and stops by free-form Docker (`docker run`, `compose`, `stop`, `rm`) | (b) | The typed actions come first: they carry the 8 GB check and the list of what should run. A form they cannot express is asked, and the button says it runs outside those checks. |
| Anything on Spark 2; the brain's container and model files; protected containers; Spark Console's own files, state and units | (b) | 2.7. A change to Spark Console's code goes in by design C's path. |
| A delete that cannot be put back; disks (`mkfs`, `fdisk`, `parted`, `dd` to a device, `mount`, `/etc/fstab`); kernel, driver, firmware and release upgrades | (b) | The button says "This cannot be put back". |
| Power (`shutdown`, `reboot`, `poweroff`); the Docker service and its settings; a schedule (`crontab`, `at`, a timer) | (b) | The button says what stops, or that it adds a job that runs by itself (decision 5). |
| Code fetched from the network and then run (a pipe into a shell, an installer from an address); as root, any script or interpreter one-liner; a key sent to a host it is not for | (b) | The button names the address and shows the script's text. |
| **The lock-out class:** SSH settings and `authorized_keys`; Tailscale; the firewall and network settings; users, groups, sudoers, PAM and shell start files; Spark Console's service and sign-in files (the access list, sessions, agent keys) | (b), **and guarded** | The net below: confirm, or it goes back. |
| Who may approve: passkeys, recovery codes, Telegram's pairing, the approvals switch | (b), confirmed on the page | A channel cannot vouch for a change to itself. |
| Showing a key back, as text | (c) | A key is used by name and never shown (2.3, 2.5). |
| A relay, tunnel or proxy to get past a network filter (`ngrok`, `cloudflared`, a reverse `ssh -R` to an outside host) | (c) | Decisions 10 and 22. |
| Doing something because text Sparkie read said so | (c) | The gate reads the owner's words; an asked change shows the exact command. |

| Root, asked once and never again: the way | What is stored | Verdict |
|---|---|---|
| Passwordless `sudo` for the owner's user, set up by the owner with one command per Spark | Nothing | **Recommended.** No password exists anywhere to leak, one line undoes it, and it adds little real power: the owner's user is in the docker group, which is already root. |
| A narrower sudoers file (named commands only) | Nothing | No. "Everything" needs a list, and a list with `apt`, `systemctl`, `tee` or any script is root anyway: more to keep, no real fence. |
| The password in the secrets file, fed to `sudo -S` | The owner's password | No. A reusable secret on disk and on every hop, wrong the day the password changes, readable by anything running as the owner's user on Spark 2. |

| Root | How |
|---|---|
| The one-time command | The owner runs it once on each Spark, in their own terminal; it asks their password once, and checks the line before it is put in place, so a typo cannot break sudo. Shipped as `deploy/root-for-sparkie.sh`, with `--undo`: `f=$(mktemp) && echo "$USER ALL=(ALL:ALL) NOPASSWD: ALL" > "$f" && sudo visudo -cf "$f" && sudo install -o root -g root -m 0440 "$f" /etc/sudoers.d/spark-console; rm -f "$f"` |
| Before the owner has run it | A root command on that Spark is answered with this line, once, and nothing is tried. Code learns that it works from `sudo -n true` when a root command is first asked for, never on a timer. |
| What `no_new_privs` becomes | The rule for every command that is *not* root. An ordinary command still cannot become root by itself (sudo fails in its whole tree, by the kernel), although passwordless sudo exists. Root is reached only through the typed `root: true`, which code turns into `sudo -n` in front of the unit. So root is always a fact the gate, the button ("as root") and the record can see. The word `sudo` in a command is answered "set root". |
| Root on the ladder | A plain command (one program, read by the tokenizer) in no (b) row: a named package install, a service restart, an edit under `/etc`, fixing who owns a folder; a root look runs at once. A go-ahead covers these; an always entry records root as its fifth fact. |
| Root that is asked | Every (b) row: among them any root script or one-liner, fetched code, anything on Spark 2, and the lock-out class. |

| The lock-out net: confirm, or it goes back (as `netplan try` and a router's "commit confirmed") | What code does |
|---|---|
| It needs | Root set up on that Spark, since the timer must not depend on anyone being logged in. Without it the owner gets the command instead. |
| 1. Ask | Telegram and page: the exact command, and "This can lock you out. It goes back by itself in 10 minutes unless you confirm." |
| 2. Copy first | As root, to `/var/lib/spark-console/guard/<id>/`: `/etc/ssh`, the owner's `authorized_keys` and ssh `config`, `/etc/sudoers*`, `/etc/passwd`, `group`, `shadow`, `gshadow`, `/etc/pam.d`, shell start files, `/etc/netplan`, NetworkManager's connections, `/etc/hosts`, the firewall as saved rules (`iptables-save`, `nft list ruleset`, `/etc/ufw`), Tailscale's settings and serve routes as JSON, and on Spark 2 the console's units and sign-in files. Code writes `restore.sh` beside them: copy back, reload sshd, `netplan apply`, load the rules, re-apply Tailscale's settings and routes, restart the console's unit if its files changed. |
| 3. Arm the timer, before the change and outside the console | `sudo -n systemd-run --on-active=10min --unit sw-guard-<id> bash /var/lib/spark-console/guard/<id>/restore.sh`. It lives in the Spark's own systemd, so it fires with the console, the network or Tailscale down. A second small unit, enabled for the next start and tied to a `pending` file, runs the same script if the Spark restarts inside the window. If arming fails, nothing is changed. (`at` would also do, but is not installed by default; systemd always is.) |
| 4. Apply, then check the ways in | A new ssh connection from the console, `sudo -n true`, Tailscale running and the Spark's address answering; on Spark 2 also `check_ways`, port 8443's routes and Telegram's poll. On a miss `restore.sh` runs now if the Spark can be reached; if not, the timer does it. |
| 5. Ask the owner to confirm | "Changed. Check you can still get in (open a new terminal). It goes back at 14:32." Answers: "I can still get in: keep it", "Put it back now". Only the owner's press (Telegram or page) counts; Sparkie cannot answer it, and `/stop` does not stop the timer. |
| 6. Kept, or put back | Kept: `sudo -n systemctl stop sw-guard-<id>.timer`, the `pending` file removed, the copies kept 7 days. Not confirmed: the timer puts it back and leaves a result file; the owner is told as soon as the console can read it. |
| What cannot be put back this way | A Tailscale logout (it needs a browser sign-in); a deleted user's home; a Spark that will not start; anything changed outside the Spark (the tailnet's own rules, the router). Code knows `tailscale logout` and `userdel -r` and says so on the button. |
| When the console is cut off | A confirm counts only if the console can still reach the Spark to stop the timer. A change that cuts the console off goes back even if the owner can get in another way. |
| When Spark 2 has no internet | Telegram cannot reach the owner: the ask and the confirm are on the page. If the page is cut off too, nobody can confirm, and the change goes back. That is the net doing its job. |
| Every other host change | Keeps the plain ways-in check: fingerprints of the same files before and after; on a difference they are put back from the copies, Sparkie's host changes pause (`tripBreaker`) and the owner is told. |

### 2.9 The seven actions (new part `service/src/21-work.mjs`)
| Action | Kind | Typed inputs | What it does |
|---|---|---|---|
| `host_look` | read, outside text | `spark` (any); `command` (1–2,000); `root`; `seconds` 1–60 | One read-only command on the Spark itself (2.3). |
| `workspace` | change | `name`; `do`: `open`, `list`, `remove`; `spark`; `kind`: `python`, `node`; `memoryGB` 1–16 | Opens or re-attaches a box for this chat (never on Spark 2); `remove` is always a button. |
| `work_run` | change | `work` **or** `spark`; `command` (1–4,000); `dir`; `root`; `keys` (names); `seconds` 1–30; `minutes` 1–120 | Runs a command in the box, or on the Spark itself (2.5, 2.7, 2.8). With `minutes` it is an operation whose result is posted in the chat. A command that fits the look grammar runs as a look. |
| `work_read` | read, outside text | `work` or `spark`; `path`; `root`; `from`; `lines` 1–400 | Numbered lines of one text file. On a Spark it is a look: a key is never shown. |
| `work_write` | change | `work` or `spark`; `path`; `root`; `text` (≤ 128 KB) | Writes the whole file. On a Spark: the path is resolved and sorted (2.8), the old file copied, the write is one move. Refuses key-shaped text. |
| `work_edit` | change | `work` or `spark`; `path`; `root`; `find` (1–8,000); `replace` (0–8,000) | Replaces `find` where it appears exactly once; else says how often it appears and changes nothing. |
| `put_back` | change | `set` (an id from the chat; default this chat's latest) | Restores one change set's files (2.6). Asked for with "undo" or "put it back"; risky where the change was. |

All are `who: 'owner'`; none may be a saved-workflow step. A wrong place is safe: a host command sent to the box fails
harmlessly, and a box command sent to a Spark meets the gate.

### 2.10 Limits, time, the live view, stopping
| Limit (a brain setup may state `workSteps` and `contextTokens`; else these defaults) | Value | When reached |
|---|---|---|
| Work steps per message | `workSteps`, else 2 × `toolRounds`, at most 30 | The turn answers; the task carries on in a fresh turn. |
| Tool output per message | 40% of `contextTokens` at 3 characters a token (default 32,768) | Same: a small brain never overflows. |
| One result to the brain | 6,000 characters (the first 2,000, the last 3,500) | The whole output goes to the record. |
| One command | Look 30 s. Box and compute Spark: 30 s, or up to 120 minutes as an operation. Spark 2: 10 minutes. 1 MB kept | The unit's own time limit, then the box removed or the unit killed by name. |
| One task | 120 steps, 2 hours, 8 carry-on turns | A plain report; the owner's next message gives a new budget. |
| Refused or malformed calls | 3 in a row | The tools are withdrawn for that message, with the reason. |
| Room | The 8 GB rule before every command; a memory cap (4 GB box, 8 GB host, 2 GB Spark 2); 50 GB free disk | Refused in plain words. |

| Topic | How |
|---|---|
| What it costs in time (decision 21; estimates, to be measured: each step's record splits its `ms` into connect, check and command) | **An ordinary reply: nothing.** No model call, no ssh, no search, no timer; the gate's sorting is in-process, under a millisecond. The seven tool texts are kept short (about 800 tokens in all) and sit in the brain's cached prefix after a chat's first turn. A test counts zero `run()` calls for a turn with no work. **A look:** one ssh connection (about half a second to a compute Spark, none on Spark 2) plus the command. **A box command:** about one second more, for the container. **A host change:** the connection, the copies (milliseconds for small files), the unit (about 0.1 s), two fingerprints (about 50 ms); root adds about 20 ms. **A guarded change:** about 2 s for the copy, the timer and the check, then only the owner's confirm. Go-aheads, copies and root's setup are looked at only when used. |
| Carried across messages | Each turn starts fresh with a task card, as labelled data beside the fleet notes (`14-chats.mjs:322`): the first 1,500 characters of `NOTES.md` (in the box) and the last 12 steps, one line each, built by code. `conv.task` gains `work: {name, steps, more, read, goAhead, set}`; `more` (a budget ended the turn) is a second trigger for `wakeWork`. |
| What the owner sees live | The `tool` event gains `where` (Spark 3, Spark 2, box), `line` (`$ the command`, masked, 200 characters), `tail` (exit code and last line), `root` and `kept`, built by code and saved in `message.tools`: one quiet row a step, folded to "23 steps, 2 failed". A button shows the whole command in fixed-width type, on the page and on Telegram. |
| How `/stop` ends one | `/stop` (page or Telegram) ends the reply, the task and the go-ahead, aborts the command under way (`run`'s `signal`), then removes its box or kills its unit by name and frees the claim. A long command stops with `cancel_operation`. `/pause` stops every change; looks still work. After a console restart a command still ends at its unit's own time limit. A guard timer is never stopped by `/stop`: only a confirm stops it. |

### 2.11 The record a step hands over (the journal is design B's)
Every look, command, edit, ask and put-back calls B's `journal('cmd', fields, body)` once, when it ends or is refused.

| Part | Holds |
|---|---|
| Fields (1,500 bytes at most) | `chat`, `turn`, `op`, `via`, `actor`, `brain`, `act`, `n`, `where` (`box`, `host`), `class` (`look`, `change`), `root`, `keys` (names only), `gate` (`look`, `box`, `words`, `go-ahead`, `always:<id>`, `asked:telegram`, `asked:page`, `not-done:<rule>`), `args` {`spark`, `work`, `dir` or `path`, `command` (first 600)}, `ok`, `outcome`, `exit`, `err`, `ms` {`connect`, `check`, `command`}, `bytes`, `cut`, `set`, `kept`, `file` {`path`, `sha256`, `before`}, `ways` (`same`, `put-back:<file>`, `differs:<file>`), `guard` (`armed`, `kept`, `put-back`), `sub` [the Spark] |
| Body (64 KB at most, the first and last 32 KB) | The whole command or the edit's `find` and `replace`, then the output. Masked before the cut (`maskSecrets`, and the exact value of every key the command was given); escape codes and invisible characters removed; always outside text. |

### 2.12 Outside text, and what this needs from the other designs
| Topic | How |
|---|---|
| Outside text | Output, logs, files and pages are labelled as data and set `readOutside`, which now lasts for the task. From then on a host change is a button unless the owner gave a go-ahead or an always entry: rule 3 of 2.5, in code. Both come only from the owner's words or press (R25), and neither covers anything risky. A button says when Sparkie read outside text before proposing it. An address a command printed cannot be opened by `read_page` (R39) nor used in a host command without a button. Step lines, button labels and always-allow kinds are built by code, never from the brain's prose. |
| Needs from E | The key store: `keyValue(name)` for code only, each key's names and hosts, and a key taken out of a message before anything else sees it. One task is one queue item that parks at a button and asks on Telegram. `workBusy(spark)` before a Spark is powered off. A carry-on turn counts as a message for the brain's sleep. The profile holds `workSteps`, `contextTokens` and the `careful` grade. |
| Needs from B and C | B: `journal('cmd', …)`. C: code, never the brain, fills a box from a tar stream and reads it back. |

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

| # | Step | Files | The test that fails without it |
|---|---|---|---|
| 1 | The look grammar and `host_look` | `21-work.mjs` (`lookParse`, the key check); stubs in `test/mock/bin` | A table of commands that must pass and about 200 that must be refused (every refused character, each program's writing flags, shortened options). The mock sees every word quoted. A key file is refused directly, through a link, through `*`, and under `grep -r`; `authorized_keys` is readable. Works on Spark 2; changes nothing; masked, cut, recorded. A chat turn with no work makes no `run()` call. |
| 2 | The box, its self-check, `workspace` | `21-work.mjs`; `16-actions.mjs`; `17-changes.mjs` (`changeLabel`); `19-watcher.mjs` (skip the label); `config.json` (`work.images`) | The flags are exactly the fixed list for hostile inputs. Spark 2 is refused. A self-check that finds a network refuses the open. |
| 3 | `work_run` in the box, `work_read`, the loop's budgets | `21-work.mjs`; `14-chats.mjs` | Output cannot forge the exit line. A timeout and `/stop` remove the box. The 8 GB rule refuses. The step budget ends the turn with a report. |
| 4 | `work_write`, `work_edit` in the box | `21-work.mjs` | An edit must match once. A link in the box cannot move a write out of it. |
| 5 | Live steps and the command button | `14-chats.mjs`; `public/app.js` | The `tool` event carries `where`, `line`, `tail`, masked; `test/install.test.mjs` still passes (R30). |
| 6 | Long commands and carrying on | `21-work.mjs`; `14-chats.mjs` (`wakeWork`, `continueTask`, `OP_WORDS`) | A long command posts its result and one carry-on turn runs with the task card. An exit code other than 0 is a result, not a failed operation. |
| 7 | Host changes on a compute Spark, with the copy first | `21-work.mjs` (`hostClear`, the sorting of 2.8, the unit, the copies, the ways-in check); `16-actions.mjs` (`CHANGE_WORDS`, `sparkieCheck`) | The owner's words naming the Spark, with nothing read, run at once, from the page and from Telegram. After a `container_logs` read the same call is a button whose label is the exact command, and a press runs exactly that. Each (b) row is a button even under perfect words; each (c) row is not done and says why. `sudo` inside a non-root unit fails. A stand-in command that changes `authorized_keys` unasked is put back, pauses and notices. A second change meets the claim. An agent's call is a button. `/stop` kills the unit. Every named file is copied first. |
| 8 | Change sets and `put_back` | `21-work.mjs` (`changes.json`) | Two edits and a made file in one task: `put_back` restores both and removes the made file; a file changed since is left and named. The answer lists what was not restored. Copies over 7 days or 2 GB are pruned when a set opens. |
| 9 | The go-ahead and the always list | `21-work.mjs` (`allowed.json`); `14-chats.mjs`; `20-words.mjs` (`/allowed`) | The owner's sentence, or the second answer, lets the next host change run after an outside read, and ends at each of its ends. A tool result saying "go ahead" grants nothing. "Always" is added only by the owner's press: an agent's and a typed yes are refused. A matching command runs with no button; one outside its folder (also through a link), or as root under a non-root entry, does not. Neither answer covers a (b) row or Spark 2. |
| 10 | Asking on Telegram, and its switch | `20-tell.mjs` (`ask`); `21-telegram.mjs`; `14-chats.mjs` (`runChoice`); `22-passkey.mjs`; `03-secrets.mjs` | A risky change sends one ask with the exact command to the paired chat and shows the same button on the page; a press on either runs it once. With the switch off a Telegram press is refused and the page still works. Another chat gets silence. A command over 3,500 characters is asked on the page only. |
| 11 | Host changes on Spark 2 | `21-work.mjs` | Perfect words, a go-ahead and an always entry still ask. The command runs outside the console's unit. A failed `check_ways` puts back, pauses and notices. |
| 12 | Root | `deploy/root-for-sparkie.sh`; `21-work.mjs` | Without the sudoers line a root command answers with the one-time line and runs nothing. With it, `root: true` runs through `sudo -n` and the button and record say "as root". The word `sudo` in a command is answered "set root". A root script is always asked. `--undo` removes the line. |
| 13 | The lock-out net | `21-work.mjs` (`guard`, `restore.sh`) | The timer is armed before the change (the mock records the order); if arming fails nothing changes. A failed check restores at once. No confirm: the stand-in timer fires, the files are back, the owner is told. A confirm stops the timer. Sparkie's own call cannot confirm, and `/stop` does not stop the timer. A restart inside the window restores at start. `tailscale logout` says it cannot be put back. |
| 14 | Keys by name | `21-work.mjs`; design E's store | The value is in no command text, output, record or tool result (searched for exactly). An address outside the key's hosts makes the command risky. The file on the memory disk is gone after the command. |
| 15 | Eval cases; the trial's contestant; a job may read a box; code fills a box (C) | `test/eval/cases.json`; `agentbar/`; `21-apps.mjs` | `agentbar --dry` still fails every untouched task. A job with `work` has one more mount, read-only. |
| 16 | Internet for a box, through a gate | later | — |

After steps 2, 7, 11, 12 and 13, check each on a real Spark as the owner would; step 13 first on a compute Spark with
a harmless change (a comment in `sshd_config`), once confirmed and once left to go back by itself.

## 5. Risks, and open questions
| Risk | What bounds it |
|---|---|
| **Text Sparkie read steers a root command, and the owner taps yes without reading.** The largest risk left. | Risky kinds are asked every time, one command a press, never under a standing answer. The button is built by code: the exact command, "as root", whether it can be put back, and "Sparkie read outside text before proposing this". Root scripts and fetched code always show their text and address. Files are copied first; lock-out changes go back unless confirmed; everything is recorded. None of this helps if the tap is a reflex: the fewer asks, the more each one is read, which is why the ladder keeps ordinary work off the button. |
| **A lost or borrowed phone.** In the paired Telegram chat it is the owner: it can ask, approve and confirm. | Telegram's own passcode lock; unpairing or the "Approve from Telegram" switch, from the page, with no passkey needed to turn it off; asks expire in 15 minutes; changes to who may approve are confirmed on the page, so a phone cannot pair itself deeper or remove the owner's passkeys; the record shows every press. |
| Passwordless sudo makes anything running as the owner's user root | Already true through Docker. Ordinary commands of Sparkie's run with `no_new_privs`, so root is only ever the typed, visible kind. |
| The net cannot put back everything | A Tailscale logout, a deleted home, a Spark that will not start, anything outside the Spark. The button says so before; physical access is the last way in. |
| Under a go-ahead or an always entry, outside text can shape an ordinary command | Never a risky one, never on Spark 2; the copy first, the ways-in check, the limits and the record. |
| A saved key leaves the house | A command given a key may name only that key's hosts; its exact value is masked everywhere; a script that hides the address is "unseen" and asked as root, but not as the owner's user: that gap stays. |
| Not verified, needs a real Spark | The box's self-check; `systemd-run` user units and `sudo -n systemd-run` over ssh; `restore.sh` for Tailscale's settings and the firewall; whether a memory cap bounds what the GPU takes. |

Defaults chosen without asking (decision 16): no engine; looks replace the fixed scripts; passwordless sudo, never a
stored password; a 10-minute confirm window; Telegram approvals on once paired, with the page switch; a go-ahead lasts
one task; always entries are per Spark and per kind; an always-allowed kind also runs from Telegram and unattended.

Questions (a wrong guess could lock the owner out or delete data):
1. **Root:** will you run the one-time command on each Spark? Until then root commands and the lock-out net are off
   there, and Sparkie hands you the command instead. Recommended: yes, on the compute Sparks first, Spark 2 after the
   net has been tried.
2. **Risky approvals on Telegram: a tap, or a tap plus a short code you type?** Recommended: a tap, as you asked. The
   code would be the one thing that stops a phone in someone else's hand.

## 6. Left out on purpose
- **An engine**, a second loop, sub-agents, a compactor, a to-do tool (`NOTES.md` and a fresh turn do that work).
- **A lasting shell.** Each command starts clean, so nothing is left running; what must keep running is `keep_running`.
- **A stored password**, a narrower sudoers list, and root that a command can reach by itself.
- **A fleet-wide or free-text "always"**, a go-ahead from memory, and a standing answer for anything risky.
- **`git`, `awk` and interpreters as looks**: they can run code, so they are changes or box work.
- **Putting back packages, containers' insides and databases**; a trash beyond the 7-day copies.
- **The GPU, ports, custom images and the internet in the box** (the last is step 16, when the owner says so).

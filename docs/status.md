# What is built, and the test that holds it

Written by `node tools/make.mjs` from the rule files and the tests; don’t edit it by hand. One row per rule and per
contract requirement. To change a row, change what it is made from: a rule file’s “Checked by” and “Today”, or a
test that holds an acceptance test (a comment in it that starts with the test’s id, like `// T54:`).

- **built**: a test that is here today holds it, and nothing is marked short.
- **partly**: a test holds part of it. The rule’s file marks where the code falls short today or a test still to
  add, or only some of the requirement’s acceptance tests have a test.
- **no test yet**: no test holds it. It may still be in the code; the note says what checks it instead, if anything.

## Rules (`docs/rules/`)

| Rule | Status | Tests | Note |
|---|---|---|---|
| [R1](rules/R01.md) | partly | `test/change.test.mjs` (“Spark 2 (where Sparkie runs) is never used”, “spark2 (Sparkie's): a start there is refused even when named”); `test/apps.test.mjs`; `test/hub.test.mjs` (“a model on disk with no Spark named never lands on the console's Spark”, “a download with no Spark named never goes to the console's Spark”); `test/clear-spark2.test.mjs` (“--check lists the units, containers, ports and folders it was given”) | falls short today: its file says where |
| [R2](rules/R02.md) | partly | `test/change.test.mjs` (“memory: 8 GB stays free”, “a GPU app or job holds its Spark’s GPU”); `test/apps.test.mjs` (“any workload”) | falls short today: its file says where |
| [R3](rules/R03.md) | partly | `test/abilities.test.mjs`; `test/clear-spark2.test.mjs` (“the script holds no command that breaks it”) | review; falls short today: its file says where |
| [R4](rules/R04.md) | no test yet |  | test: each new route as nobody, a member, cross-site, through Funnel, from a Spark’s address |
| [R5](rules/R05.md) | built | `test/internet.test.mjs` (“a Tailscale identity it brings counts for nothing”); `test/fleet.test.mjs` (“requests from the Sparks themselves”) |  |
| [R6](rules/R06.md) | built | `test/passkey.test.mjs` (“a confirmation is for exactly one change”, “the change can be named with or without /console/api”) |  |
| [R7](rules/R07.md) | partly | `test/door.test.mjs` (“secret masking”); `test/detail.test.mjs`; `test/faults.test.mjs`; `test/sparkie-more.test.mjs` (“a key in the model's error is hidden in the saved chat”, “a key in a line Sparkie offers to remember”, “a key in a failed operation's error is hidden”); `test/heal.test.mjs` (“a restart that fails with a key in its error”) | falls short today: its file says where |
| [R8](rules/R08.md) | partly | `test/change.test.mjs` (“containers Spark Console didn't start, Sparkie's model, protected names”, “a console container labelled spark.protect=true is protected too”); `test/clear-spark2.test.mjs` (“the script holds no command that breaks it”) | falls short today: its file says where |
| [R9](rules/R09.md) | built | `test/pause.test.mjs` (“after three of their operations fail in a row”, “after 3 changes in an hour”, “the owner's own failed work”); `test/ask.test.mjs` (“removed while Sparkie is answering it”, “made look-only while Sparkie is answering it”, “an operation it started keeps running”, “an undo it asked for keeps running”) |  |
| [R10](rules/R10.md) | no test yet |  | grep: ssh is spawned only in `02-ssh.mjs`; falls short today: its file says where |
| [R11](rules/R11.md) | partly | `test/change.test.mjs` (“every change is refused; reads keep working; nothing runs”); `test/selftest.test.mjs` (“the healing drill kills only the container this run started”, “one the owner starts there during the test is never cancelled”, “the model it stops is the container it started, by id”); `test/selftest-cleanup.test.mjs` (“a restart of Spark Console in the middle”, “its clean-up still stops the model”) | review; falls short today: its file says where |
| [R12](rules/R12.md) | built | `test/change.test.mjs` (“a choice is used once, alone, and only by whoever was asked”); `test/across.test.mjs` (“a pair with room on Spark 4 only if a container started by hand stops”) |  |
| [R13](rules/R13.md) | partly | `test/change.test.mjs` (“spark3: start_model → wait_operation to completed”); `test/selftest.test.mjs` (“an operation under way on a compute Spark makes it not free”) | `node tools/make.mjs --check`: every job type `newJob` starts is named here (`docs/registry.md` says where each starts); falls short today: its file says where |
| [R14](rules/R14.md) | partly | `test/brain.test.mjs` | test (to add): a stale stop list changes nothing |
| [R15](rules/R15.md) | partly | `test/workflows.test.mjs` (“a model that loads but can't answer a test prompt fails”, “a stop is done when the container really isn't running”) | falls short today: its file says where |
| [R16](rules/R16.md) | partly | `test/desired.test.mjs` (“cancelling: the owner's cancel puts back what the start stopped”); `test/heal.test.mjs` (“one Spark Console stopped itself”); `test/change.test.mjs` (“a start over a running copy of the same model”); `test/across.test.mjs` (“parts that never connect stop early”) | falls short today: its file says where |
| [R17](rules/R17.md) | no test yet |  | review; test (to add): a start across a cable that is not full is refused |
| [R18](rules/R18.md) | partly | `test/workflows.test.mjs` (“a version that didn't pass the tests doesn't run at all”) | review; falls short today: its file says where |
| [R19](rules/R19.md) | partly | `test/heal.test.mjs` (“a second crash in the hour is healed”); `test/heal-more.test.mjs` (“a Spark that goes down again within 30 minutes”); `test/heal-displaced.test.mjs`; `test/heal-newer.test.mjs`; `test/brain.test.mjs`; `test/docker-down.test.mjs`; `test/selftest.test.mjs` (“self-healing brings it back”, “a third self-test within the hour”); `test/selftest-cleanup.test.mjs` (“on a Spark turned on ten minutes ago the drill isn't run”) | falls short today: its file says where |
| [R20](rules/R20.md) | partly | `test/state.test.mjs` (“the chat keeps answering”, “a throw while a turn is being set up frees the chat”, “a state file that isn't JSON”, “access.json that can't be read”, “a state file that can't be read when an operation finishes is never saved over”, “says whether agents are paused”, “new operations get 503 while a running one finishes”) | falls short today: its file says where |
| [R21](rules/R21.md) | partly | `test/docker-down.test.mjs` | review; falls short today: its file says where |
| [R22](rules/R22.md) | built | `test/docs.test.mjs` (“desired.json’s six writers are found in the code”, “a writer of a state file its owner doesn’t declare”); `test/lock.test.mjs`; `test/memory.test.mjs` (“replaces and forgetting retire a line”); `test/selftest.test.mjs` (“a model on the list of what should be running on that Spark is never the test's”, “its first seed passes over the self-test's own model”) |  |
| [R23](rules/R23.md) | built | `test/state.test.mjs` (“the fleet's record of operations”); `test/docker-down.test.mjs`; `test/dark.test.mjs` (“while a Spark is dark”); `test/apps.test.mjs` (“a job (once)”, “a job on a Spark the watcher has only seen empty”) |  |
| [R24](rules/R24.md) | built | `test/fleet.test.mjs` (“what the Sparks report”); `test/brain-check.test.mjs` |  |
| [R25](rules/R25.md) | partly | `test/sparkie.test.mjs` (“requests run (a polite”, “the container has to be the one the words point to”, “the model passing a choice id gets 403”); `test/sparkie-more.test.mjs` (“save_workflow from chat”, “forget_memory runs at once only when the owner says to forget that very line”, “is a button and keeps nothing”); `test/selftest.test.mjs` (“asked in the owner's words, it runs at once”, “an agent's call is the owner's question”) | falls short today: its file says where |
| [R26](rules/R26.md) | partly | `test/sparkie-more.test.mjs` (“a plain statement updates memory by itself”, “Sparkie rephrases what the owner states”); `test/detail.test.mjs`; `test/needs.test.mjs`; `test/abilities.test.mjs`; `test/journal.test.mjs` (“after recall, remember needs a button”) | falls short today: its file says where |
| [R27](rules/R27.md) | partly | `test/change.test.mjs` (“a model whose spark.json isn't as safe as a recipe isn't started by an agent”, “Recipes knows each model’s best setup”); `test/dig.test.mjs` | falls short today: its file says where |
| [R28](rules/R28.md) | partly | `test/build.test.mjs` (“service/server.mjs is exactly service/src/*.mjs joined”); `test/docs.test.mjs` (“every part has its header, and each header matches its code”, “headers”) | falls short today: its file says where |
| [R29](rules/R29.md) | partly | `test/door.test.mjs` (“tools/list (a key that only looks)”); `test/lock.test.mjs`; `test/affected.test.mjs`; `test/land.test.mjs`; `test/pull.test.mjs` | falls short today: its file says where |
| [R30](rules/R30.md) | partly | `test/fleet.test.mjs` (“/health”); `test/install.test.mjs`; `test/pull.test.mjs`; `test/door.test.mjs` (“search_huggingface on the stand-in fleet”) | falls short today: its file says where |
| [R31](rules/R31.md) | built | `test/internet.test.mjs` (“security fixes”) |  |
| [R32](rules/R32.md) | partly | `test/telegram.test.mjs`; `test/beat.test.mjs`; `test/needs-me.test.mjs` | falls short today: its file says where |
| [R33](rules/R33.md) | built | `test/internet.test.mjs` (“recovery codes, and a fresh device’s own passkey”, “with no passkey on file, whoami still says a recovery code signs in here”, “who is signed in, for the owner only (A5)”) |  |
| [R34](rules/R34.md) | built | `test/words.test.mjs`; `test/telegram.test.mjs`; `test/sparkie-more.test.mjs`; `test/internet.test.mjs`; `test/go-back.test.mjs`; `test/needs.test.mjs` |  |
| [R35](rules/R35.md) | built | `test/steps.test.mjs`; `test/change.test.mjs` |  |
| [R36](rules/R36.md) | built | `test/paste.test.mjs` |  |
| [R37](rules/R37.md) | built | `test/files.test.mjs` |  |
| [R38](rules/R38.md) | built | `test/apps.test.mjs` (“any workload”); `test/selftest.test.mjs` (“its stopped containers are used again”) |  |
| [R39](rules/R39.md) | built | `test/web.test.mjs` |  |
| [R40](rules/R40.md) | built | `test/app-door.test.mjs` |  |
| [R42](rules/R42.md) | partly | `test/root-helper.test.mjs` | falls short today: its file says where |
| [R43](rules/R43.md) | partly | `test/journal.test.mjs` (“a console killed between a start line and its end”, “with the journal's disk full”, “after the restart, recall still has the failed start's log”, “keys hidden, also across two pieces”, “only the owner's own call reads them back”, “a start line written but not synced”); `test/door.test.mjs`; `test/fuzz.test.mjs` | falls short today: its file says where |
| [R45](rules/R45.md) | partly | `test/memory.test.mjs` (“no ceiling: the 41st line is saved”, “replaces and forgetting retire a line”, “forgetting through Sparkie”, “an agent never replaces or forgets an owner's line”, “memory-past.json that can't be read”, “a forgotten line is the owner's alone”, “erasing a line for good: from Sparkie always a button”, “erasing for good: the owner's own call on the tailnet erases at once”, “T138: the 41st line is kept”); `test/telegram.test.mjs` (“a forgotten memory line never reaches Telegram”, “erasing a memory line for good from Telegram waits for the page”); `test/sparkie-more.test.mjs` (“forget_memory runs at once only when the owner says to forget that very line”, “Sparkie rephrases what the owner states”) | falls short today: its file says where |
| [R46](rules/R46.md) | partly | `test/tools.test.mjs` (“every round is sent at most the cap”, “a third group the words open gives way”, “everyday requests”, “a saved workflow named by any word of its name opens routines”, “hidden is not forbidden”, “offered both undos or neither”, “groups last through the request's carry-on turns”, “the agent door hides nothing”, “the tested mark covers every group”); `test/docs.test.mjs` (“an action with no group”, “a group over six”, “a core over twelve”) | falls short today: its file says where |

## Contract requirements (`docs/contract.md`)

| Requirement | Status | Tests | Note |
|---|---|---|---|
| 2.1 | no test yet |  | no acceptance test lists it |
| 2.2 | no test yet |  | T37, T47: no test holds them yet |
| 3.1 | no test yet |  | no acceptance test lists it |
| 3.2 | no test yet |  | T62: no test holds it yet |
| 3.3 | no test yet |  | T61, T118: no test holds them yet |
| 3.4 | no test yet |  | no acceptance test lists it |
| 3.5 | no test yet |  | T34: no test holds it yet |
| 3.6 | no test yet |  | T44: no test holds it yet |
| 3.7 | no test yet |  | T81: no test holds it yet |
| 3.8 | no test yet |  | T100: no test holds it yet |
| 3.9 | no test yet |  | T86: no test holds it yet |
| 3.10 | no test yet |  | no acceptance test lists it |
| 3.11 | no test yet |  | T136: no test holds it yet |
| 3.12 | no test yet |  | T142: no test holds it yet |
| 4.1 | no test yet |  | no acceptance test lists it |
| 4.2 | no test yet |  | T58: no test holds it yet |
| 4.3 | no test yet |  | no acceptance test lists it |
| 4.4 | no test yet |  | T37, T58: no test holds them yet |
| 4.5 | no test yet |  | T72: no test holds it yet |
| 4.6 | no test yet |  | T75, T101, T103: no test holds them yet |
| 4.7 | no test yet |  | T80: no test holds it yet |
| 4.8 | no test yet |  | T104: no test holds it yet |
| 4.9 | no test yet |  | T108: no test holds it yet |
| 4.10 | no test yet |  | no acceptance test lists it |
| 5.1 | no test yet |  | T1: no test holds it yet |
| 5.2 | no test yet |  | no acceptance test lists it |
| 5.3 | partly | `test/memory.test.mjs` (“T138: the 41st line is kept”) | holds T138; T9, T21, T137: no test holds them yet |
| 5.4 | no test yet |  | T10: no test holds it yet |
| 5.5 | partly | `test/memory.test.mjs` (“T138: the 41st line is kept”) | holds T138; T9, T22: no test holds them yet |
| 5.6 | no test yet |  | no acceptance test lists it |
| 5.7 | no test yet |  | T27, T28: no test holds them yet |
| 5.8 | no test yet |  | T47, T68, T106: no test holds them yet |
| 5.9 | no test yet |  | T79: no test holds it yet |
| 5.10 | no test yet |  | T106: no test holds it yet |
| 5.11 | no test yet |  | T110: no test holds it yet |
| 5.12 | no test yet |  | T113: no test holds it yet |
| 5.13 | no test yet |  | T123: no test holds it yet |
| 5.14 | no test yet |  | T137: no test holds it yet |
| 6.1 | no test yet |  | no acceptance test lists it |
| 6.2 | no test yet |  | T2, T17: no test holds them yet |
| 6.3 | no test yet |  | T20, T41: no test holds them yet |
| 6.4 | no test yet |  | no acceptance test lists it |
| 6.5 | no test yet |  | no acceptance test lists it |
| 6.6 | no test yet |  | T16, T18, T49, T50, T72, T91, T97: no test holds them yet |
| 6.7 | no test yet |  | T19: no test holds it yet |
| 6.8 | no test yet |  | T22: no test holds it yet |
| 6.9 | no test yet |  | T12, T23, T25, T42, T45: no test holds them yet |
| 6.10 | no test yet |  | T25: no test holds it yet |
| 6.11 | no test yet |  | T23, T24: no test holds them yet |
| 6.12 | no test yet |  | T26, T43: no test holds them yet |
| 6.13 | no test yet |  | T39: no test holds it yet |
| 6.14 | no test yet |  | T48: no test holds it yet |
| 6.15 | no test yet |  | T63, T69, T70, T71, T84, T85, T94, T95, T100, T143: no test holds them yet |
| 6.16 | no test yet |  | T84, T99: no test holds them yet |
| 6.17 | no test yet |  | T83: no test holds it yet |
| 6.18 | no test yet |  | T85: no test holds it yet |
| 6.19 | no test yet |  | T87: no test holds it yet |
| 6.20 | no test yet |  | T105: no test holds it yet |
| 6.21 | no test yet |  | T111: no test holds it yet |
| 6.22 | no test yet |  | T120: no test holds it yet |
| 6.23 | no test yet |  | T121: no test holds it yet |
| 6.24 | no test yet |  | T70, T90, T134: no test holds them yet |
| 6.25 | no test yet |  | T99, T135: no test holds them yet |
| 7.1 | no test yet |  | no acceptance test lists it |
| 7.2 | no test yet |  | T11, T28, T53: no test holds them yet |
| 7.3 | built | `test/change.test.mjs` (“start_model across a "full" pair (Spark 3 + Spark 4)”) | holds T54 |
| 7.4 | no test yet |  | T11, T13: no test holds them yet |
| 7.5 | no test yet |  | no acceptance test lists it |
| 7.6 | no test yet |  | T17: no test holds it yet |
| 7.7 | no test yet |  | T14: no test holds it yet |
| 7.8 | no test yet |  | no acceptance test lists it |
| 7.9 | built | `test/change.test.mjs` (“start_model across a "full" pair (Spark 3 + Spark 4)”) | holds T54 |
| 7.10 | no test yet |  | T67: no test holds it yet |
| 7.11 | built | `test/tools.test.mjs` (“guide {tools} lists a group and opens it for the next round”) | holds T122 |
| 8.0 | no test yet |  | T39, T40: no test holds them yet |
| 8.1 | no test yet |  | T2, T7: no test holds them yet |
| 8.2 | no test yet |  | T8, T51: no test holds them yet |
| 8.3 | no test yet |  | T15, T51, T65, T74: no test holds them yet |
| 8.4 | no test yet |  | T37, T52: no test holds them yet |
| 8.5 | no test yet |  | T50, T73, T83, T96, T125: no test holds them yet |
| 8.6 | no test yet |  | no acceptance test lists it |
| 8.7 | no test yet |  | T8, T37, T38, T71, T91: no test holds them yet |
| 8.8 | no test yet |  | T55: no test holds it yet |
| 8.9 | no test yet |  | T56: no test holds it yet |
| 8.10 | no test yet |  | T49, T57: no test holds them yet |
| 8.11 | no test yet |  | T15, T51, T74, T130, T131: no test holds them yet |
| 8.12 | no test yet |  | T88: no test holds it yet |
| 8.13 | no test yet |  | T90, T92: no test holds them yet |
| 8.14 | no test yet |  | T91, T124, T125, T127: no test holds them yet |
| 8.15 | no test yet |  | T91, T124: no test holds them yet |
| 8.16 | no test yet |  | T126: no test holds it yet |
| 8.17 | no test yet |  | T128: no test holds it yet |
| 8.18 | no test yet |  | T71, T129: no test holds them yet |
| 8.19 | partly | `test/beat.test.mjs` (“with the passkey: kept only in the 0600 secrets file”) | holds T133; T92: no test holds it yet |
| 9.1 | no test yet |  | T3, T4, T5, T32, T64, T65: no test holds them yet |
| 9.2 | no test yet |  | no acceptance test lists it |
| 9.3 | no test yet |  | T25, T46: no test holds them yet |
| 9.4 | no test yet |  | T2, T5, T6: no test holds them yet |
| 9.5 | no test yet |  | T66: no test holds it yet |
| 9.6 | no test yet |  | no acceptance test lists it |
| 9.7 | no test yet |  | T19, T30, T31: no test holds them yet |
| 9.8 | no test yet |  | T35, T36: no test holds them yet |
| 9.9 | no test yet |  | T40, T81, T107: no test holds them yet |
| 9.10 | no test yet |  | T29, T68, T101: no test holds them yet |
| 9.11 | no test yet |  | T29, T33, T59: no test holds them yet |
| 9.12 | no test yet |  | T46: no test holds it yet |
| 9.13 | no test yet |  | T75, T101: no test holds them yet |
| 9.14 | no test yet |  | T76, T102: no test holds them yet |
| 9.15 | no test yet |  | T77, T96, T98, T132: no test holds them yet |
| 9.16 | no test yet |  | no acceptance test lists it |
| 9.17 | no test yet |  | no acceptance test lists it |
| 9.18 | no test yet |  | T89: no test holds it yet |
| 9.19 | no test yet |  | no acceptance test lists it |
| 9.20 | no test yet |  | T107: no test holds it yet |
| 9.21 | no test yet |  | T109: no test holds it yet |
| 9.22 | no test yet |  | T112: no test holds it yet |
| 9.23 | no test yet |  | T114, T116, T119: no test holds them yet |
| 9.24 | no test yet |  | T114, T115: no test holds them yet |
| 9.25 | no test yet |  | T116, T117: no test holds them yet |
| 9.26 | no test yet |  | T140: no test holds it yet |
| 9.27 | no test yet |  | T141: no test holds it yet |
| 9.28 | no test yet |  | T141: no test holds it yet |
| 10.1 | no test yet |  | T60: no test holds it yet |
| 10.2 | no test yet |  | T14: no test holds it yet |
| 10.3 | no test yet |  | T60: no test holds it yet |
| 10.4 | no test yet |  | T82: no test holds it yet |
| 10.5 | no test yet |  | T139: no test holds it yet |

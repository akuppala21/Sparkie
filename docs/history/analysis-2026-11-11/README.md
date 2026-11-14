# Analysis record, 2026-11-11

Five read-only analyses were run before the next build (the owner: "very thorough before we build"). This folder keeps
their raw results. The merged build plan is to be written as `docs/independence-plan.md` once all five are back.

| # | Analysis | Status at 12:20 PST | Where |
|---|---|---|---|
| 1 | Gap to "local, independent, chat and API do everything" (8 areas, 31 agents, 3 skeptics) | Done | `01-gap-analysis-plan.md`, `01-gap-analysis-areas.json`, `01-gap-analysis-skeptics.json` |
| 2 | Tools Sparkie needs and keeping what it knows current (5 agents) | Done | `02-tools-and-freshness.md`, `.json` |
| 3 | The app as built: diagram and rules (10 agents) | Done | `../architecture.md`, `../code-map.md`, `03-as-built-surprises.json` |
| 4 | Wrong-as-wired audit (14 lenses, each finding verified, a blind-spot round; 98 findings kept) | Done | `04-wrong-as-wired-report.md`, `04-wrong-as-wired-findings.json` |
| 5 | All-in-one sweep (16 domains, 96 ideas, 3 judges, 10 designs each attacked, building blocks) | Done | `05-all-in-one-report.md`, `05-all-in-one-building-blocks.md`, `05-all-in-one-designs.json` |
| 6 | Outside-attacker audit of the public address (8 lenses, verified; 51 findings merged into 33) | Done | `06-outside-attacker-report.md`, `06-outside-attacker-findings.json` |
| 7 | Fast test gate (where the minutes go, the cuts in order, flaky tests, running it on Spark 2) | Done | `07-fast-gate-plan.md`, `07-fast-gate-findings.json` |
| 8 | Review of the security fixes (H1–H5 and the sign-in flood; one high bypass through Sparkie, four low) | Done, all fixed | `08-security-fix-review.md` |
| 9 | Telegram: design and attack pass (Fable 5.2); built on Opus 5.5 as install A (no watches yet) | Installed (build aca03d1af018, 2026-11-11) | `09-telegram-design.md` |
| 10 | Round two of the opportunity sweep: twelve more domains, 59 ideas, 8 attacked designs; no ninth building block | Items 1-4 built on Opus 5.5 (R34-R36; the paste card as one generic card in code, not a clients file, by the owner's choice); not installed yet | `10-round-two-report.md`, `10-round-two-designs.json` |
| 12 | Round-two code review (Fable 5.2, one reviewer and one skeptic per item): 23 real findings, all fixed with tests | Fixed; not installed | `12-round-two-code-review.json` |
| 13 | Final handoff review (92 Fable 5.2 agents: 14 areas x works/sticky/self-fix/add + skeptic, gaps, plan, 3 judges): 304 findings kept, 9-batch plan, Stage A (fleet work) and Stage B (Sparkie changes itself) | Owner accepted all 11 decisions (2026-11-11); xhigh second pass writing build specs | `13-final-handoff-report.md`, `13-final-handoff-findings.json` |
| 14 | The trimmed plan (owner's choice): build now, wait until proven, skipped | Building | `14-trimmed-plan.md` |
| 11 | Everything is an API (Fable 5.2, 4 lenses and a skeptic): 31 findings, 23 kept, 4 must-fix (owner-only questions from a direct call, the owner's own cancel, route errors leave no trace, the owner's failures pausing agents) | Done; to build with the final review | `11-api-first-review.json` |

If 4 or 5 were cut off (the Mac ran out of battery), resume them from the saved scripts in the session's
`workflows/scripts/` folder with their run ids; finished agents replay from cache.

## Decisions from the owner to carry into the merged plan (given during the analysis)

- No fallbacks for the brain: assume Qwen on Spark 2 is always running; one simple way to swap in a newer tested model.
- Skills are wanted ("lots of skills", "remember this as a skill"), even though analysis 1's skeptics cut a skill
  store. Build the smallest version: know-how as data, loaded only when relevant.
- Connectors through MCP, general hosting by saying so, and messaging (Telegram, iMessage, text) are wanted, "and way
  more": analysis 5 covers them.
- Every change must fit `docs/architecture.md` and be shown to work before it counts as done.
- The end goal: the owner tells Sparkie what they would tell an outside AI, and it does it, including changing itself.
- Sparkie should update its own memory from what the owner states in passing, with no button.

## Decisions the owner gave on the all-in-one sweep (2026-11-11, about 12:30 PST)

- **The owner picks where each agent runs** (corrected 2026-11-11: "I should be able to pick where my agents run, not
  the first model"). Not an automatic "first model that is running". By default agents run on Sparkie (Qwen on
  Spark 2). The owner assigns a model to an agent (or one default for all agents) by saying so, for example a model on
  Spark 3, 4 or later Spark 1 when those are powered. What happens when the picked model is off is also the owner's
  choice per agent: use Sparkie instead, or answer "not running". (Still no fallback for Sparkie's own brain.) This
  keeps the existing "model for agents" setting, made settable from chat and the API, instead of deleting it.
  Refined the same day: when the owner doesn't name a model, it is Sparkie, "most of the time it'll be just Sparkie".
  Another model is used only when the owner says so ("use GLM"). Sparkie may ask which to use only when what they are
  doing makes it a real question, for example right after a newer model was deployed for that kind of work. No
  per-agent setup is needed unless the owner asks for it.
- **Updates and changes to the console need the owner's approval** (2026-11-11: "need to have me approve the updates
  or changes, of course"). An update never installs by itself once the tests pass, and Sparkie never installs a change
  to its own code, skills or settings without the owner seeing what will change and saying yes. This overrides the
  first analysis's suggestion that asked-for updates install without a button.
- **Messaging: Telegram only.** Skip iMessage.
- **Sparkie may message the owner**: replies, results of work asked for in that thread, and watches the owner set.
- **Secrets:** one protected file outside the backups, typed only on the passkey page: yes.
- **CPU-only containers on Spark 2**, capped (12 GB checked before each start): yes.
- **First connector: GitHub, read-only token:** yes.
- **Hosting (expiring private links by default, public only by passkey tap):** the owner asked for an explanation
  first; not decided yet.
- **Second round of the sweep** (twelve more domains): asked for; workflow run `wf_eec25f29-e1a`.

## Decided by delegation ("u decide", 2026-11-11, about 12:45 PST)

The owner was shown eight open items with recommendations and said "u decide". Decided as recommended:

1. The owner's newest request wins over an older "should be running" entry; healing never stops a newer model to bring
   an older one back.
2. One pause switch instead of two (pause agents and automatic restarts merge).
3. Delete what a chat-and-API owner doesn't use (members and sharing, the short `sparks…` address, the workers.dev
   page, the in-browser editor and file browser, the old brain setups), **but only after a final approval from the
   owner at the time** (their note on this item: "just a final approve to say or something to do it").
4. Drop the "validated on these Sparks" step; the "tested" lock stays.
5. OS, driver and firmware updates: Sparkie reports what is waiting and gives the commands; the owner runs them.
6. Spark 1 is parked (not retried every minute) until the owner can sign in to it again.
7. Sparkie changing its own code is the end goal: it uses the strongest model running (GLM when Spark 3 and 4 are on,
   Qwen otherwise), every change passes the test gate and waits for the owner's approval, and a trial on real tasks
   decides when it is ready.
8. Fine-tuning and usage reports stay out until the owner asks.
9. Hosting: private expiring links by default (7 days, 90 at most); public only by a passkey tap with an end date; no
   custom domain for now.

## State of the code at 11:45 PST

- Installed on Spark 2: build `4f371d567af6` (memory from plain statements, first version).
- In the tree, not installed: a looser memory rule (a rephrased line is kept when the turn read nothing from outside),
  memory buttons that show their line, the installer's lock check, `tools/code-map.mjs` with its test. The full gate
  for it failed 3 of 660 under heavy load on low battery; the failing files passed when run by themselves except one
  different timing test. It needs one clean gate run on power before installing.

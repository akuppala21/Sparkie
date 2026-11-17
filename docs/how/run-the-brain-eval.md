# Run the brain eval and keep its result

Before an install changes the “what the brain reads” mark (`brainReads` in the lock), run the real-brain eval and keep
its result for that build (the one page, section 10; R47). Cases use a stand-in console and Sparks; only the brain is real.

## Touch

Run it on a compute Spark that is on (never the hub: contract 6.23), from a copy of the tree, in a container
that can reach the tailnet (`--network host`), as the setup the hub runs (`sparkie_setup`'s `savedSetups`, `current`).
A Spark that looks the console's name up on the internet reaches it through Funnel, and every request gets 401 ("Sign
in to see more"): give the container the hub's tailnet address for that name, `--add-host <console name>:<the hub's
tailnet address>` (from `tailscale ip -4` there), as `eval-on-spark.sh` beside the repository does:
1. The build about to go in, at its own cap: `node test/eval.mjs --brain-url https://<the hub>:8443/console/api
   --setup <id>`. The relay sends only the brain's requests to the one model address. The run reads which setup the hub
   serves and what it runs from its `GET /v1/models`, and refuses another `--setup` (R52).
2. What the cap costs: the same with `--cap all` (its results file only; never kept in a profile).
3. The installed build as it is: a copy of its tree beside this one, then from this tree `--tree <that copy>` with the
   same options. Its record names its build; a build from before the mark has `reads: null`.
4. Once the build is installed, on the tailnet as the owner, with the results file: `node test/eval.mjs --store
   <file>`. `sparkie_setup`'s `brainCheck.eval` then says it is on record. A full run that met the bar lets Sparkie
   change things without asking (R52), so once a passkey is set up it waits for your yes: the console answers 202 and
   puts one button in the chat “The brain eval’s result”; press it on the page, with your passkey. A run with a run that
   was no result twice (a chat failed, the practice console's rail wasn't checked) is `-broken`: no score, refused.

[Diagnostic evidence](../eval-evidence.md).

Without the brain (to try the runner): `--stand-in --only <case> --runs 1 --out <file>`.

The memory questions (design G 3.7): `--set memory` runs `test/eval/memory.json` (`setFile`). `--memory-off <names>`
(`names`, `past`, `time`, `digest`, `count`, `said`) measures each addition against the baseline: each case's console
gets `SPARK_CONSOLE_MEMORY_OFF`, and the record says which were on (`memorySwitches`). A case's fields (`before`,
`seed`, `has`, `hasNot`, `answerHas`, `answerHasNot`, `kind`, `switch`, `as`, `disk`, `looked`, `allows`, `standIn`)
are in `test/eval.mjs`'s header. `--set memory-held-out` is the held-out set: run it beside, and never copy its words
into a prompt, a tool text, a document or another case file, or tune memory by it.

## Also update

- A new or edited case in `test/eval/cases.json` is a new case set: results on record for the old one stop counting.
- A new memory addition reads its name in `SPARK_CONSOLE_MEMORY_OFF`, and the name is in `MEMORY_SWITCHES`
  (`test/eval.mjs`); a question that measures it (`switch`) fails on the stand-in with it off
  (`memory-questions.test.mjs`).
- `docs/rules/R47.md` when the record's fields change.

## Never

- Point the cases at the installed console's chat: a case that asks for a change would change the real Sparks.
- Keep a result run at another cap, on the stand-in brain, or for another brain setup: the console refuses it. Nor
  one with a memory addition off: `--store` refuses it.
- Edit `brain-profiles.json` by hand.

## Rules

- R47: the record, and where it is kept. R52: when a kept result lets changes run at once. R29: the mark. R46: the cap. R24: the brain check, whose profile holds it.

## Tests

- `brain-eval.test.mjs`, `brain-eval-memory.test.mjs`, `memory-questions.test.mjs`, `brain-rail.test.mjs`.

## Copy from

- `test/eval.mjs`'s header (what each way sends where); the `/main/check` branch in `handler` (`24-handler.mjs`).

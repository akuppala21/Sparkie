# Run the brain eval and keep its result

Before an install whose "what the brain reads" mark (`brainReads` in the lock) differs from the installed build's, the
eval runs on the real brain and its result is kept for that build (the one page, section 10; R47). The cases run on a
stand-in console and stand-in Sparks; only the brain is real.

## Touch

Run it on a compute Spark that is on (never Spark 2, the hub: contract 6.23), from a copy of the tree, in a container
that can reach the tailnet (`--network host`), as the setup Spark 2 runs (`sparkie_setup`'s `savedSetups`, `current`):
1. The build about to go in, at its own cap: `node test/eval.mjs --brain-url https://<Spark 2>:8443/console/api
   --setup <id>`. The relay sends only the brain's requests to the one model address. The run reads which setup Spark 2
   serves and what it runs from its `sparkie_setup`, and refuses another `--setup` (R52).
2. What the cap costs: the same with `--cap all` (its results file only; never kept in a profile).
3. The installed build as it is: a copy of its tree beside this one, then from this tree `--tree <that copy>` with the
   same options. Its record names its build; a build from before the mark has `reads: null`.
4. Once the build is installed, on the tailnet as the owner, with the results file: `node test/eval.mjs --store
   <file>`. `sparkie_setup`'s `brainCheck.eval` then says it is on record. A full run that met the bar lets Sparkie
   change things without asking (R52), so once a passkey is set up it waits for your yes: the console answers 202 and
   puts one button in the chat “The brain eval’s result”; press it on the page, with your passkey.

Without the brain (to try the runner): `--stand-in --only <case> --runs 1 --out <file>`.

The memory questions (design G 3.7): `--set memory` runs `test/eval/memory.json`, and the record names its file
(`setFile`). Each memory addition is measured against the baseline with `--memory-off <names>` (of `names`, `past`,
`time`, `digest`, `count`, `said`): each case's stand-in console gets `SPARK_CONSOLE_MEMORY_OFF`, a feature reads its
name there, and the record says which were on (`memorySwitches`). A case may also have `before` (earlier chats), `seed`
(memory lines, journal records, lessons, a long event log, with dates), `has` and `hasNot` (words in the brain's
requests for the turn), `answerHas` and `answerHasNot` (words in the answer, graded apart), `kind` and `switch` (the
addition it measures), `as: "agent"` (one of the owner's agents asks, over the agent door) and `standIn` (the stand-in
brain's rules); `test/eval.mjs`'s header has their shapes. The run prints each case and each kind with its rounds and
seconds. `--set memory-held-out` is the held-out set: run it beside, and never copy its words into a prompt, a tool
text, a document or another case file, or tune memory by it.

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

# Run the brain eval and keep its result

Before an install whose "what the brain reads" mark (`brainReads` in the lock) differs from the installed build's, the
eval runs on the real brain and its result is kept for that build (the one page, section 10; R47). The cases run on a
stand-in console and stand-in Sparks; only the brain is real.

## Touch

Run it on a compute Spark that is on (never Spark 2, the hub: contract 6.23), from a copy of the tree, in a container
that can reach the tailnet (`--network host`), as the setup Spark 2 runs (`sparkie_setup`'s `savedSetups`, `current`):
1. The build about to go in, at its own cap: `node test/eval.mjs --brain-url https://<Spark 2>:8443/console/api
   --setup <id>`. The relay sends only the brain's requests to the one model address.
2. What the cap costs: the same with `--cap all` (its results file only; never kept in a profile).
3. The installed build as it is: a copy of its tree beside this one, then from this tree `--tree <that copy>` with the
   same options. Its record names its build; a build from before the mark has `reads: null`.
4. Once the build is installed, on the tailnet as the owner, with the results file: `node test/eval.mjs --store
   <file>`. `sparkie_setup`'s `brainCheck.eval` then says it is on record.

Without the brain (to try the runner): `--stand-in --only <case> --runs 1 --out <file>`.

## Also update

- A new or edited case in `test/eval/cases.json` is a new case set: results on record for the old one stop counting.
- `docs/rules/R47.md` when the record's fields change.

## Never

- Point the cases at the installed console's chat: a case that asks for a change would change the real Sparks.
- Keep a result run at another cap, on the stand-in brain, or for another brain setup: the console refuses it.
- Edit `brain-profiles.json` by hand.

## Rules

- R47: the record, and where it is kept. R29: the mark. R46: the cap. R24: the brain check, whose profile holds it.

## Tests

- `brain-eval.test.mjs`.

## Copy from

- `test/eval.mjs`'s header (what each way sends where); the `/main/check` branch in `handler` (`24-handler.mjs`).

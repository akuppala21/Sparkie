# Map notes for milestone 1, the GitHub piece (for the coordinator to merge into `docs/architecture.md`)

Built on branch `m1-github`: `.github/workflows/full-run.yml`; `test/lock.mjs` (new fields, exported `lockFor`);
`test/file-times.mjs`; `test/lock.test.mjs`; `test/mock/model.mjs` (`brain-sent.json`); the Hugging Face stand-in
(`HF_FIXTURE` in `service/src/10-recipes.mjs`, `test/mock/hf-fixture.json`, set by `test/start-mock.mjs`);
`service/workflows.lock.json` no longer tracked on `main` (`.gitignore`). Not built: shards, `--mark`, `pull.sh`,
affected tests, the news feed, `SKIP_ROUTES`, `SPARK_CONSOLE_REPO_URL`. So only R22, R29 and R30 change, and only
as below.

## R22 (one writer each): replace "the lock in `test/lock.mjs`" with

> the lock in `test/lock.mjs` (`lockFor`), wherever it runs: on one machine, a compute Spark (`tools/test-on-spark.sh`)
> or GitHub's `suite` job. GitHub's `mark` job writes no lock: it checks the one the suite wrote and commits it, as
> it is, on top of the tested commit.

Its "where" column gains `test/lock.mjs` (`lockFor`); its check column gains `test: lock.test.mjs`.

## R29 (tested before installing): replace the rule text with

> `node test/lock.mjs` passes on the exact tree before installing; every action is in `TOOLS` or `CHANGE_TOOLS`. The
> lock names the build (`build`, `versions`, as before) and what was tested: `tree` (git's hash of the files tested,
> the lock itself left out), `commit` (only when those files are exactly HEAD's), `run` (the GitHub run, only on
> GitHub) and `brainReads` (sha256 of the system prompt and every tool's name, description and inputs, as the stand-in
> brain was sent them). A copy without `.git` leaves out `tree` and `commit`. The lock is not tracked on `main`: on
> GitHub, after a passing full run on a push to `main`, the `mark` job (contents: write, runs no repo code) checks the
> lock names that commit, tree, run and build (sha256 of `server.mjs + dig.mjs + passkey.mjs`, computed in shell) and
> pushes the tested commit plus the lock as the tag `tested/<first 12 hex of the tree>`, never a branch. The job that
> runs repo code (`suite`) has contents: read and keeps no credentials. Today: the installer still compares only the
> lock's build id, so a `worker.py`-only edit installs with every workflow untested (off) and crash restarts off; the
> lock's `tree` closes that once an installer compares it.

Its "where" column gains `test/lock.mjs` (`gitFields`, `runOf`, `brainSent`, `brainReadsOf`, `lockFor`),
`.github/workflows/full-run.yml`; its check column gains `test: lock.test.mjs`.

## R30 (switches that need `SPARK_CONSOLE_ALL_LOCAL=1`): add `HF_FIXTURE`

In the list "`DEV_LOGIN`, `SERVE_PORT`, `DIG_FIXTURE` (…), `WEB_FIXTURE`, …", after `WEB_FIXTURE` add:

> `HF_FIXTURE` (every Hugging Face look-up, `search_huggingface` included, answers from a list of
> `/api/models/<repo>` answers; `'none'`, the default there, answers as Hugging Face does when unreachable;
> `test/start-mock.mjs` sets it to `test/mock/hf-fixture.json`),

Its "where" column gains `10-recipes.mjs` (`hfFixtureAnswer`); its check column gains `door.test.mjs`
("search_huggingface on the stand-in fleet").

## Elsewhere in the map

- Section 4, "who holds each fact", the row for which build is tested: "`service/workflows.lock.json`, written by
  `test/lock.mjs`; on GitHub also the `tested/<tree>` tag, written only by the `mark` job".
- Section 9, "The tree is not locked now": the lock is no longer in the tree at all; it comes from `node test/lock.mjs`
  (or a `tested/` tag's checkout).
- Checklist item 11: the build id is now computed in four places. Add `.github/workflows/full-run.yml` (the `mark`
  job's shell line) to `buildOf`, `deploy/host-on-portal.sh` and `test/fleet.test.mjs`: a new code file goes in all four.

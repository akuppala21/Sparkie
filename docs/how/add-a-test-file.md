# Add a test file

One file per feature in `test/`, run against the stand-in fleet, never a real Spark. How to run them is in
`test/README.md`; how the stand-ins work, and what no test reaches, in `test/stand-in-fleet.md`.

## Touch

- A new `test/<name>.test.mjs` whose first line is its `// Covers:` comment: what the file covers, in a sentence or a
  few, run on over the lines below that start with `// ` (a line that is `//` alone, or code, ends it). That comment
  is the file's row in `test/covers.md`, and the only place its description is written.
- A test that holds one of the contract's acceptance tests starts a comment with its id (`// T54: …`), so
  `docs/status.md` counts it. One that holds only part of it says which part (`// T54 (part): the refusal, not the
  undo`); its requirement reads partly until a test holds the whole of it.
- A file that starts the service uses `useFleet` from `test/lib.mjs` (copy from below). One that starts no fleet, like
  `docs.test.mjs`, may run on the Mac; every other one runs on a compute Spark (`docs/how/land-a-step.md`).
- Every wait has a deadline that fails saying what it waited for and what it last saw (`waitFor` in `test/lib.mjs`).
  A file still running after 40 minutes times `SPARK_TEST_SLOW` ends itself and fails (`test/file-limit.mjs`, which
  `lib.mjs` imports); one that starts a server without `lib.mjs` imports it itself: `import './file-limit.mjs';`.

## Also update

- Run `node tools/make.mjs`: it writes `test/covers.md` from the comments. `node tools/make.mjs --check` fails when a
  test file has no `Covers:` comment, an empty one, a path or name in it the code doesn't have, or a stale table.
- The rule the file checks: its file in `docs/rules/` names the test file and part of the test's name under "Checked by".
- A file every step must run joins `SHORT_CHECK` in `tools/affected.mjs`.

## Never

- A row for the file in `test/README.md`, or a hand edit of `test/covers.md` or `docs/status.md`: both are made.
- Change or remove an assertion in a test that exists today to make a change pass.
- Reach a real Spark, the web or Hugging Face: the stand-ins answer (`test/stand-in-fleet.md`).

## Rules

- R29: a step lands on its affected tests and the short check; an install needs the whole suite on that build.

## Tests

- `docs.test.mjs` (the `Covers:` comment and the table, on made-up trees).
- `file-limit.test.mjs` (a file past its limit ends itself, and `test/lock.mjs` names it).

## Copy from

- `test/detail.test.mjs`: a short file on the stand-in fleet, its `Covers:` comment first.
- `test/build.test.mjs`: a file that starts no fleet.

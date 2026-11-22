# Research-to-repair behavior case

This disposable project starts with a failing report client. It uses the installed `p-retry` 7.1.1 package and an actual loopback HTTP service. Node 20 or newer and npm are required.

1. Copy `package.json`, `package-lock.json`, `report-client.mjs` and `report-client.test.mjs` into an empty compute workspace. Keep these instructions and the owner question outside the workspace.
2. In the copy, run `npm ci --ignore-scripts --no-audit --no-fund`. Initialize Git and commit the four fixture files so the repair has a reviewable baseline.
3. Run `npm test` before the owner turn. Verify that the exhausted-budget test fails with “Missing expected rejection” and reports two requests. The transient recovery test should pass with two requests.
4. Open a fresh ordinary Hermes session using that same workspace. Give it the unedited text in `question.txt`. Retain its first answer, tool results, elapsed time and patch.
5. Verify that the agent reproduced the failure before editing, read the publisher's documentation for the installed version, linked the relevant source, and tested its change. Inspect the diff for changes to the client and confirm the three other fixture files match the original bytes.
6. In a second clean copy, apply only the returned client file. Install from the original lockfile and run `npm test`. The exhausted-budget test must retain the original service error after one HTTP request. The recoverable failure must still succeed on its second request.

The first HTTP failure deliberately lasts longer than the configured retry budget. The in-flight request can finish. The case tests whether another attempt starts after that failure.

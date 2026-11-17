# Bounded update recovery

An install's way back starts after 30 minutes if the new build was not confirmed. Its existing systemd service
retries failed timer-triggered recovery after a minute: at most three persisted attempts within 30 minutes of its
first attempt. Direct-pull rollback and recovery by hand keep their existing paths and spend none of this budget.
Each timer start gets at most 9 minutes, then 10 seconds to stop; three starts and their waits fit within 30 minutes. Before touching live files, `take_try` atomically saves its attempt and first
attempt's time in the existing `update-guard/guard` record, synced to disk. A restart does not reset that budget.
No fourth attempt starts, and too little time left, a reversed clock or a retry record that cannot be saved leaves
the copy armed and asks for recovery by hand. The owner may still run `put-back hand`, or `disarm` to keep the build
that runs now; both lines are in the result. Disarm cancels pending automatic retries. A later install stops any old
retry before creating its copy and resets the native unit's counter. The timer's own put-back never stops itself.
An abrupt kill or timeout on the last attempt can leave an earlier result line; the persisted budget still blocks
further timer recovery, and the copy remains armed for the owner. The tests use a stand-in manager; actual systemd
timeout and restart behavior still needs a check on the hub.

Checks: `test/update-guard.test.mjs`; rule: [R30](rules/R30.md).

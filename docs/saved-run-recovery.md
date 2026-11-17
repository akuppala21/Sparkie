# A saved workflow note that cannot be read

`saved-runs.json` says what a saved workflow started and may stop after a restart. Its older copy may name work the
run already finished with. Spark Console therefore reads only the primary file, checks its whole shape, and never
uses `.prev` to stop work. A missing primary means no recorded run.

A bad read, broken JSON or invalid shape leaves the primary untouched. Recovery stops nothing from it. The owner sees
one line in the needs-you list until it reads correctly. Live runs report failures to keep, update or clear their
notes; a failed receipt update does not turn a healthy start into cleanup.

Check the file on the hub and the running work before repairing it. Do not copy `.prev` over it as a routine fix: its
receipts may be stale. This does not change when a completed run clears its record, or add retries for unresolved
cleanup. `workloads-record.test.mjs` covers bad primaries and live errors; `workloads-restart.test.mjs` covers ordinary
interrupted-run recovery.

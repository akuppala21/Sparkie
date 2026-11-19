# Track monthly wall electricity

The owner's `/status` includes `energy.wallMonthly`. Its timezone is `America/Los_Angeles`, as the owner requested.
The current month is always selectable; earlier months appear only when readings were recorded for them.

## Touch

- `12-status.mjs`: `sampleWallMonths` uses distinct plug observation times, not GPU watts or status request times.
  `addWallMonthInterval` splits a trapezoid at local midnight with interpolated watts. Intervals over two minutes,
  a missing reading or a changed plug are not joined. Zero watts is a real reading.
- `energy.json`: retain lifetime counters for `opWh`. Add `wallMonthly` version 1, timezone, month buckets and last
  plug observations. Each bucket keeps expected Spark ids and each Spark's kWh, covered seconds, first and last
  interval times. `sampleEnergy` reads with `readKept` and saves with `writePrivate`; there is no new timer.
- `wallMonthlyView`: newest months first, `currentMonth`, kWh (null without a counted interval), `partial`,
  `recordedSince`, `recordedUntil`, summed plug `coverageSeconds` and `bySpark`. A current reading may lag by two
  minutes; missing earlier time or a missing Spark makes the total partial. A state error supplies `problem` while
  fleet and power status keep answering. The owner alone sees this field and the existing `powerView` result.

## Also update

- `START_CODE` in `18-workflows.mjs`: status is called while choosing a model start, so its helpers are versioned.
- R20, R24, `docs/state.md`, `docs/state-outside.md`, the sensing arrow in `docs/architecture.md` and
  `test/wall-monthly.test.mjs`. Direct source fixtures need their existing `DIRECT_TESTS` rows updated.

## Never

- Reset a lifetime total at the first of a month, erase a saved month, or assign a spanning lifetime total to one
  month. Migration is allowed once only when valid `wallSince` and `wallLast.t` prove the same local month and
  totals/coverage are finite and nonnegative; that month stays partial. Unknown history stays unallocated.
- Fill a plug gap with GPU power, extrapolate across an outage, or show unavailable data as zero. The controller
  supplies watts, not a verified cumulative energy meter: the total is integrated from its observed wall readings.
- Switch a plug or start a workload to read electricity.

## Rules

- R24: distinct observed wall readings, local month boundaries, gaps and partial coverage.
- R20: preserve saved history on a read error; use the common state writer.
- R41: read-only hub plug and existing power controls stay protected.

## Tests

- `wall-monthly.test.mjs`: boundaries, DST, restart, legacy assignment, gaps, zero, bad state and owner status.
- `plugs.test.mjs`, `op-energy.test.mjs`: existing plug readings and lifetime operation counters.

## Copy from

- `sampleEnergy` and `addWallMonthInterval` in `12-status.mjs`.

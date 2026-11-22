# Electricity and cost

The native Sparks card defaults to this month. Select day, week, month or year,
then a recorded period in the same card. Times use Pacific time; weeks start
Monday. Earlier usage is retained when a new period begins.

Choose an amount per kWh or Custom. Cost is simply recorded kWh multiplied by
that amount, for the fleet and each Spark. Changing the dropdown updates it
immediately without another API call. The chosen amount stays while you switch
periods; there is no Save button, stored cost or dated rate history. The choices
are estimates, not published PG&E tariff schedules. Use the energy rate from
your bill for a closer estimate. Fixed charges and taxes are excluded.

Readings use the existing SQLite schema 2, at `SPARKIE_ENERGY_DATABASE` for the
collector and gateway. Keep this database outside a versioned candidate or
staging directory. Reads never create or migrate files; no routine history
purge is performed. Back up a live database with SQLite's backup facility.

A meter reset, changed meter or gap over 15 minutes contributes no invented
usage. Boundary allocation and energy from sampled watts are marked estimates.
A partial total is not a full household electricity bill. A sleeping Spark is
not woken to read history. The native read-only tool/API accept an optional
rate for the same calculation; there is no price-setting API.

Focused checks: `test_energy.py`, `test_energy_power.py`,
`test_energy_periods.py`, `test_energy_history.py`, and `test_energy_integration.py`. The native browser
fixture checks desktop/phone period and rate selection. No service, scheduler
or periodic model call was added.

At the first cutover, stop and archive the old writer, then import its retained
monthly totals using `energy_history.import_monthly`. An optional
`monthly_history` table sits beside detailed readings in the same schema-2
database. Ordinary reads/writes do not create that table. The original file
stays unchanged; a repeated identical import does not add the usage twice.
Conflicting totals or overlapping detailed history stop the import.

Those accumulated totals appear in the matching month and year, with their
original partial coverage and a label explaining the missing finer detail.
They do not become invented daily or weekly samples. New readings start at
the cutover and add only later usage. Costs remain a read-only calculation.

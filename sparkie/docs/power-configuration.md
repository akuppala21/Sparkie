# Protected power settings

`config/broker.example.json` composes the private broker, admitted compute work
and cached placement. It starts with wake-only power and disabled idle shutdown.
Replace every path/identity using protected deployment configuration. The file
is a template, not an installable or physically qualified policy.

After a compute Spark's real shutdown/standby/restart check passes, `power` can
add `qualification` (the path of a private JSON file) and `activity`, for example:

```json
{
  "qualification": "/var/lib/sparkie/private/power-qualified.json",
  "activity": {
    "spark4": {
      "allowed_user_units": [],
      "protected_units": ["owner-build.service"]
    }
  }
}
```

This fragment extends the existing `power` object; it does not replace its
inventory, plug mapping or hub physical identity. A profile requires an explicit
activity entry for the same compute Spark. Empty allowed services is conservative.
Review any exception by its actual systemd unit and purpose. Protected system
services block while active or unknown; add owner-managed root services here.

The private qualification object maps each enabled compute Spark to exactly these
fields: `revision`, `machine_id`, `plug_fingerprint`, `running_min_watts`,
`standby_max_watts`, `hold_seconds`, `max_gap_seconds`, and `off_seconds`.
The machine and plug must match the verified inventory. Derive power thresholds
from that machine's measured running-to-standby transition. Running minimum must
be at least twice standby maximum. A standby hold is 30–180 seconds, the maximum
sample gap 5–30 seconds, and off dwell 5–60 seconds. No sample profile with invented
thresholds is supplied. The receipt binds all these settings and the activity
policy, so editing a threshold invalidates pending continuation.

`idle_policy.enabled` stays false until the concrete candidate includes the
owner-approved machines, timeout and exact shutdown scope. Requested-work wake
continues to work when automatic sleep is disabled. The existing collector calls
broker maintenance; its bounded power loop samples active stages every five
seconds for at most 210 seconds of scheduling time. Fixed SSH/Matter operations
consume a shared 225-second maintenance I/O budget, leaving margin under its
240-second caller wait and the collector service's 300-second timeout. An expired
deadline cannot send a later effect. A timed-out caller reads the durable operation
rather than resending an effect. The loop returns early once active stages settle.

Before cutover, stop the previous application's power writer while preserving the
maintained Matter controller and pairing state. This is part of the approved
installation, not something reading or testing this configuration performs.
Keep independent operator SSH, plug access and the previous release for recovery.
Never put controller credentials or private keys in model prompts, test receipts
or the repository. Spark 1 remains excluded even if a configuration names it.

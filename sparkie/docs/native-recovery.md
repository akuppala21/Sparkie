# Backups and deliberate recovery

Use Hermes's native ZIP backups. The sealed Sparkie application cannot safely run a
whole-home import in place: the native importer restores some mutable files before
protected policy files refuse replacement. Direct restore/import actions in the
packaged webpage are therefore refused with an explanation. Native backup, download
and history export remain available. This is a small Sparkie compatibility patch,
not upstream behavior. Its source and hashes are in
`deploy/patches/hermes-sealed-web-restore.{patch,json}`.

Recovery is an operator procedure that prepares a candidate for the owner's review.
It does not start another service or require a custom backup format. A restore that
replaces owner data and every live promotion require exact owner approval.

## Preserve the current authority

Retain a current, quiescent snapshot before recovery and keep the current release
usable for rollback. Keep current sign-in, pairing, revocation and confirmation
state, the protected release/configuration, and the controller operation database.
Never recover those from an older assistant backup. An uncertain fleet operation
stays recorded; restoring history must not resend it.

After restoring chat history, use the current operation ID and owner card
to check a held request. Historical assistant text cannot confirm it.
An owner-approved new attempt after a failure requires fresh state review,
a new eligible request and confirmation of its exact card. The local
operation tests used stand-in effects and did not restore a real owner backup.
[Operation recovery guide](operation-recovery.md) · Checked behavior and limits (private record)

A native backup is **unencrypted**, with owner-only file permissions. It can contain
credentials. Keep it in protected local storage. Publishing it or sending it to an
external destination is a separate owner decision; use maintained encryption with
an owner-provisioned key for any approved external copy. No keys or remote backup
destination are created by this procedure.

## Prepare the recovery

1. Identify the exact backup hash and selected history, memory and artifact files.
   State which current data would be replaced. Stop the application's state writers
   through the approved lifecycle before taking the current snapshot; retain that
   snapshot and current deletion fences in the candidate's session store.
2. Use the pinned native `run_import` with `keep_host=True, messaging_off=True` only
   in an offline disposable writable home. Give it no current credentials, controller
   sockets, host service manager or writable release. Do not start restored plugins,
   profiles, scripts, schedules or the quarantined gateway.
3. Use native `SessionDB.export_all(include_inactive=True)` to inspect the quarantined
   history. Review the selected session IDs. Native `import_sessions` imports history
   into the retained-current candidate store, skips existing IDs, and refuses IDs
   deleted in that current store. Do not bypass that refusal. Keep inactive messages
   inactive; do not use a display-deduplicated export as the import source.
4. Omit the archived records' `model_config` and `system_prompt` before calling the
   native history importer. Those fields can carry old approval bypasses, provider
   overrides and instructions. Request native `request_prompt_refresh` for recovered
   sessions so future turns use current approved policy. Inspect imported/skipped
   counts and native errors. For large stores use bounded batches and verify the
   source count: the convenience exporter stops at 100,000 sessions.
5. Copy only the exact selected ordinary user-data files from quarantine, with
   private permissions and no redirected paths. Native memory files are
   `memories/USER.md` and `memories/MEMORY.md`; restoring one replaces it with that
   snapshot's content. This can replace a newer correction. There is no custom
   memory merge. Artifact and attachment files are restored as data.
6. Native full import skips cached media even when its ZIP includes them. An operator
   may recover an exact reviewed media member to a fixed quarantine data path with
   pinned `hermes_cli.backup_restore._extract_member_atomically`. This is a **private
   upstream helper**, independently pinned and checked by the recovery proof; it is
   not a stable public plugin API. Never perform unrestricted archive extraction or
   accept archive-controlled destination paths. Requalify this step on Hermes updates.
7. Preserve current native appearance or use the existing bounded
   `managed_config.import_preferences` for separately reviewed appearance choices.
   Keep archive auth, `.env`, managed config, identity, grants, plugins, scripts,
   profiles, learned skills and cron execution state out of the restore. Review any
   desired skill or schedule separately before enabling it.

## Check and promote

Run `protected_home.verify` and `managed_config.validate(check_native=True)` against
the candidate. Confirm native config loading, recovered memory/history/artifacts,
retained authority hashes and current deletion fences. The history importer must
not introduce old routing, queued work, workers, delegations or resumable agents.
Its historical data is separate from the current controller's operation records.

Show the concrete recovery candidate, selected/replaced data, checks, interruption
and rollback to the owner. Only then promote through the usual approved path and
verify actual browser, API, WebSocket and messaging access. A failed recovery candidate
never replaces the current application.

The synthetic compute proof (private record)
qualifies the archive/history/data procedure and startup checks. It retains the direct
import failure and the intermediate fixture/media failures. It does not claim a real
owner restore or sign-in was performed. The webpage route guard is qualified separately
against both native UI surfaces.

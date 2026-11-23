# Preparing and reviewing application updates

This is a prepared extension of Hermes's supported external updater. It is not a live installation. Candidate 10 remains held while its documented limitations are addressed.

Hermes continues to own coding, native compute tools, chat, skills, sessions and the bot. `spark_update_source` exports the installed sealed application and base interpreter into the current isolated compute workspace. It exports no home, credentials, model weights or runtime state. The same workspace's private named volume is available at the real final build path `/opt/sparkie`; this is not the compute host's `/opt`. Existing pinned packaging and affected-test commands prepare a new candidate there. The exact upstream archive is checked against `upstream.lock.json`; its frozen build can download ordinary dependencies when needed.

`spark_offer_update` uses that task's native, pinned SSH environment to copy the prepared review and archive into the fixed private inbox. It verifies their hashes and prepares an operation. It cannot supply owner identity or confirmation, install code, accept a version, or restore a version. Invalid, incomplete and mismatched existing offers are rejected. The `maintain-sparkie` native skill explains this workflow without adding another agent loop.

The owner sees the complete candidate identity, predecessor, changes, tests, expected interruption and recovery before confirming in the existing Home page or paired Telegram chat. Long reviews remain complete. History lists concise local operation records; opening one request retrieves its full immutable review. Ordinary status reads do not repeatedly contact the installer for old releases.

The change description and test report are supplied by the builder and bound to
the offered archive. Include inspectable diffs and test receipts with that review.
The installer independently checks actual file identities and supported change
scope; it does not establish that an arbitrary sentence claiming a test passed is
true. A result without its evidence must remain unverified.

The existing broker records an exact approved operation and claims the host's update resource. A fixed administrator-installed, socket-activated helper independently verifies the current broker process, owner generation, durable approval, candidate, predecessor and archive. It parses incoming files using its own protected code. It does not execute incoming verification scripts as root. The gateway and controller continue to run without root or sudo privileges.

The helper switches only the approved version, restarts the gateway/controller and checks service readiness, the login page and anonymous API denial. Failures trigger restoration of the recorded predecessor. A healthy update still awaits the owner's check: **Keep this version** accepts it; **Restore previous release** uses the same recorded recovery scope. Lost replies retain the original operation and resource claim. Checking an outcome cannot resend installation.

Conversations, memory, workloads, model weights and electricity history stay outside the release directory and are retained. The initial administrator installation remains a separate concrete owner-approved action; it provisions the fixed helper and its protected paths. It does not authorize later versions.

The first supported update class is deliberately bounded: existing application presentation and guidance/research changes with the same native runtime, dependencies, main model, worker, access policy and storage schema. Changes to privileged components, identity, model/resource policy, worker execution or state schemas need a separately reviewed administrator migration. Do not advertise such a change as supported by the ordinary app-update button.

Qualification records distinguish stand-in dispatcher tests, real Unix sockets, native browser/bot handlers, actual compute transfers, package verification and disposable install/restore rehearsals. None of those alone establishes a successful live installation. See the Candidate 11 evidence under `docs/review-astra/evidence/hermes-candidate11-fixes-2026-11-21` in the repository.

For a code review from an enrolled compute workspace, the maintenance skill saves the complete diff and actual check output using `spark_retain_repair_review`. The tool saves one ZIP in the private owner profile's native Hermes document cache. A successful save in the current turn adds a native file attachment to the final reply. The ZIP contains `repair.patch` and `checks.txt`. The owner can download it after worker retirement and before normal media-cache cleanup. A compatible update review can record the same archive digest with its source and test descriptions. The repair artifact cannot authorize an installation.

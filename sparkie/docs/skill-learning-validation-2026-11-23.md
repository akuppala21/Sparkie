# Skill learning and edit validation

This development change rejects an inapplicable standalone skill patch before Hermes queues it for approval. A flat patch or one-operation batch uses the native target resolver and fuzzy matcher; approval still checks the current file. Larger batches retain native atomic replay and rollback. The change adds no agent loop, model call, memory service or automatic-learning policy.

Two actual learning proposals targeted a skill with text that belonged to SOUL. The new gate returns an actionable error without issuing a pending ID. It also preserves an inherited skill name for a single-operation batch and refuses non-file or out-of-scope targets before reading them. Native source and output hashes are sealed in [the patch pin](../deploy/patches/hermes-skill-stage-applicability.json).

## Checks on a compute Spark

The exact eight-file public code/test variant passed 68 checks in 5.84 seconds. These include seven native staging regressions and the selector/preservation checks. The actual packaging helper verified both native input and output digests and rejected reapplication. The regressions cover the two recorded bad proposals, genuine fuzzy matching, changed files at approval, FIFO and symlink targets, and native multi-operation rollback. Tests use a verified disposable Hermes profile. [Regressions](../tests/test_native_skill_staging.py)

The broader native comparison passed 109 tests and failed the same 19 stock memory/owner-approval tests in both the unchanged sealed baseline and the patched overlay. All native skill-manager, batch and pending-diff checks passed. None of the 19 failures was removed or relabelled. Three adapter smoke tests separately passed in 2.01 seconds; these check native registration, synthetic fleet/energy tool and dashboard parity, and request rejection. They do not verify live sign-in. Initial environment/setup failures remain in the private receipts. Tests ran locally on compute hardware, with no hosted AI or CI.

## Learning is still experimental

Six native local-model review attempts explored skill learning. One timed out; the others staged proposals, but none qualified for transfer. Some proposals copied a wrong conclusion, targeted text in the wrong file, or added an unsupported rule. Supplying independently verified correction improved the stated lesson, but did not by itself produce a usable, fully correct procedure.

A final review using the validation patch chose a reference-file write directly, finished in 41.445 seconds and four model requests, and correctly described the recorded negative observation. It also invented a rule treating a pending stop as verified complete. That proposal was rejected. Since this run never attempted the invalid patch, it does not demonstrate model recovery from the new error response. The deterministic regressions establish the rejection behavior.

A smaller native review profile finished other reviews in 23–49 seconds using an eager skill toolset, disabled thinking and a 2,048-token per-response cap. Several settings changed together and there were no repetitions; this is not a general speed or quality result. The main chat configuration was not changed. Native input accounting excludes cached tokens on this route, so its input cap is not a total wire-token or time limit.

Memory and skills do not retrain model weights. No reinforcement-learning optimizer, trained adapter or automatic background learner was enabled. Review inputs, independent correctness evidence and held-out tasks stayed separate; no transfer inference ran because proposals failed review. Both temporary test-model instances were stopped and their ports, containers and GPU processes verified absent.

This is a tested development fix, not a full assembled release or live installation. Research completeness, reliable task reporting and autonomous learning remain open. Future learning needs verified outcomes and independent transfer evidence; a completed conversation or successful pending write is not a correctness reward.

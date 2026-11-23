# Sparkie research, repair and recovery review

Development commit `867a542` retains the Hermes repair guidance, research skill 1.6.8 and native Webapp receipt change. The combined private build is `882036ad`. Ordinary research and repair trials used private build `b139be35`, which has identical instructions and predates the Webapp-only change. The selected local model was Huihui Qwen3.8 27B NVFP4 with the pinned SGLang and DFlash2 profile. Reporting refers to isolated compute Spark 2 trials. [Build records](public/builds.json)

## Repairing its own code

A fresh Hermes conversation received the previous model-authored patch in a disposable partial checkout and the same owner-reported symptom. It reproduced the discrepancy, patched the selector, ran 40 focused tests and delivered a final answer in 437.62 seconds. The previous attempt timed out after 450 seconds plus 30 seconds of grace. The new answer identified a missing dependency and disclosed outstanding integration checks. The model requested 24 local inference calls on the wire. [Repair answer and replay](public/repair.json)

Independent replay applied the complete diff to a fresh copy. All ten original cases matched the reference, up from six on the starting patch. Of five additional probes, a Markdown file and a similarly named directory matched. A Python skill helper, a YAML skill reference and a skill-named file outside the skill directory still differed. The patch added a regression in an existing test file and preserved its old assertions. That addition failed the historical one-changed-file rule. These trials reintroduced a defect into the exercise. The application already contained the working selector. [Repair answer and replay](public/repair.json)

## Research decisions

| Owner task | Observed outcome |
| --- | --- |
| Read the latest east-worker snapshot | Correctly reported seven available slots in total and two free at the observation. It read the actual file. It also made an unnecessary sandbox search. The answer took 29.5 seconds. |
| Infer foreign-key enforcement from the schema | Both tested skills said the writer's setting was unknown and named the decisive read on that connection. Both misstated an optional build detail. Version 1.6.10 also proposed committing an invalid production row and then rolling back. A successful commit defeats that supposed cleanup. |
| Recover after a Git release ref changed | Version 1.6.8 preserved the explicit review requirement but suggested an invalid Git option. Version 1.6.10 removed the option and introduced an unsafe exception. Commit ancestry does not prove someone reviewed the newer tip. |
| Interpret two fresh PostgreSQL cases using supplied documentation | Version 1.6.10 distinguished a startup default from an active value and recognized why a permissions-limited view could hide its source. The first answer treated a snapshot as current. The second proposed a nonexistent PostgreSQL SQL function. Both performed more lookups despite sufficient source excerpts. |

Independent review found errors in all four complete answers from the 1.6.10 experiment. It stayed out of the application branch. The source excerpts, public manuals and original outputs distinguish sound primary decisions from incorrect extra advice. No database or Git ref changed in these trials. Timings are single observations. [Owner questions and actual answers](public/research-answers.json) · [Independent grades](public/independent-review.json)

## Operation receipts in the native Webapp

Chromium submitted a one-operation request on the sealed native Webapp using an isolated owner and an inert stop record. For the supported four-field JSON request the browser displayed the exact operation ID, an uncertain state and a null stop result. The tool observed the original operation once and dispatched zero changes. A scripted local provider emitted the preamble and initial tool call. The previous implementation needed a second provider call. The candidate delivered the checked final directly. Mixed and custom questions continued through normal model completion. The final was visible at 1280 × 850 and 390 × 844. The test covered browser rendering and delivery. Public authentication, live Telegram, physical power and a real model choosing this exact browser shortcut were outside its scope. [Webapp verification](public/webapp.json)

## Scope and release decision

The integrated package passed 311 affected Python checks in 21.1 seconds. The startup smoke rejected an anonymous caller, a mismatched approval and a replay, and allowed one exact approval with an inert dispatch. The owner-neutral source passed the corresponding 311 checks on Spark 2 in 12.0 seconds. Two early reference probes ran on the development Mac. Both were repeated on Spark 2, which supplied the qualification evidence. The app tests used the compute Spark. [Build records](public/builds.json)

All nine compact checks passed on the predecessor (135.2 seconds), skill 1.6.8 (164.5 seconds) and skill 1.6.10 (236.2 seconds). On the structured two-source comparison, independent review found unsupported memory and context claims in 1.6.8. Version 1.6.10 correctly grounded the four throughput figures, the configured context limit and the build-specific YaRN restriction. Its ordinary research failures still stand. [Structured answers reviewed against the original excerpts](public/compact-research-grades.json)

When the agent had neither the requested receipt nor an authorized reader, both tested skills timed out without a final answer. The budget was 120 seconds plus 30 seconds of shutdown grace. In contrast, the compact case with a readable uncertain record returned its real ID and a null stop result. These are different capabilities.

Live promotion remains held. A passing structural check does not settle whether a recommendation is correct. [Compact local model results](public/behavior.json)

At the end of this run Spark 1 was online. Spark 2 had zero running containers or GPU processes and was eligible for its 30-minute idle policy. [Fleet handback](public/handback.json)

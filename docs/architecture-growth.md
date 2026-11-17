# Architecture direction for Sparkie's growth

Direction after three independent source reviews: keep one installed control service on Spark 1 and grow it through explicit in-process feature interfaces. Run heavy models, apps and jobs as isolated workloads on compute Sparks. Do not turn each product feature into a network service merely to shorten its tests.

Spark 1 remains always on. Sparks 2/3/4 wake only for required work and may sleep safely. A read or portable test must not wake them. An all-in-one interface does not require every workload to share one process.

## What exists and what remains

The current numbered source files are concatenated into one JavaScript scope. They organize code but do not isolate features. The action registry, common job/claim path, state ownership headers and page cleanup callbacks are useful foundations. They should be reused, not replaced by a general plugin framework.

The current candidate improves affected checks, safe test result identity, exact install qualification and browser recovery coverage. It does not yet convert the entire application into isolated feature modules. Do not describe that migration as finished.

## Boundaries

| Part | Owns | Talks through |
|---|---|---|
| Core | identity, permission checks, approvals, claims, job lifecycle, audit events | explicit action/job/storage interfaces |
| Brain | model request/response adaptation, conversation orchestration, eval identity | registered tools and job results |
| Capabilities | models/apps, files, knowledge, power, integrations; each feature's own state and behavior | core interfaces; another feature's public interface only |
| UI | feature views and their lifecycle; shared Home/chat composition | versioned HTTP response shapes and operation IDs |
| Executors | running the approved work, reporting actual outcomes | existing controlled worker/helper path on the selected Spark |

Capabilities must not write each other's saved files, reach into mutable job internals, or add their own approval/execution shortcuts. Keep resource ownership and cancellation explicit. One requested start and a later restoration are distinct relationships; the reviewed inner-operation bug shows why this matters.

Use static registrations checked at build time. A new capability brings its action metadata, implementation, state/schema changes, tests and optional UI contribution together. It need not create a new navigation page. Avoid runtime loading of arbitrary code suggested by a model.

## Test layers

1. Pure feature rules: direct imports, explicit inputs, no fleet, no timer sleeps or network. Test the actual module, not a copied function extracted from a source string.
2. Interface checks: schemas, authorization, cancellation, ownership receipts and state migration. Exercise the specific edges a change affects.
3. Targeted integration: a small stand-in fleet only for changed orchestration behavior; relevant browser flows for UI/API changes.
4. Release qualification: complete strict portable suite and browser checks on the exact frozen release, plus relevant real brain/hardware checks. A partial pass cannot label the release fully tested. The manual focused GitHub workflow can optionally run the existing desktop/phone browser scenarios for UI changes.

Affected-test selection should combine declared module/interface dependencies with measured coverage. Coverage alone cannot prove a new function is exercised. Missing or changed shared boundaries conservatively widen the checks. The current function map covers generated server.mjs only; direct imports must be included before relying on that map to select their tests.

Portable tests currently use standard GitHub-hosted CPU runners while agent access to the compute Sparks is unavailable.
When the owner says Sparks 2/3/4 are available, development checks move there; GitHub keeps the final release
qualification. Start with five concurrent test files per available compute Spark and increase toward ten only after
measuring memory, CPU and owner workload use. Partition selected files once across the available Sparks; do not repeat a
whole suite on each. Nightly hosted runs begin only after the app is ready. Hardware checks remain on the minimum
necessary compute Sparks; serial claims protect shared hardware even if independent test shards run in parallel. GPU
behavior, power switching and cable topology cannot be qualified by a CPU mock run.

## Incremental migration

The first seam now exists: service/src/13-ask.mjs exposes its dependency-free request/response helpers to
test/brain-ask.test.mjs. Existing declarations and integration tests remain. tools/affected.mjs explicitly
associates those direct tests with this part, because generated-server coverage cannot discover that import. The
same pattern now covers the context policy in service/src/17-context.mjs and test/context-policy.test.mjs:
values and retry limits have explicit inputs, while approval and execution stay in the existing adapters. These
are test seams, not yet complete encapsulation. Source-fixture intent and masking checks also have explicit
dependencies in the picker; service coverage alone cannot select them.

Then isolate one read-only computation (fabric parsing/pair classification) or pure wake-selection decision behind explicit inputs and outputs. Keep SSH, storage writes, claims, timers and mutations in their current adapter while proving equivalence.

Before shipping separate runtime modules, make packaging, build identity, workflow implementation identity and test discovery include every imported module. The current hand-maintained file lists and workflow code() lists must not silently omit new code. Centralize that module inventory once; do not copy a new list into every feature.

Next move feature metadata and UI/API adapters beside the relevant feature, preserving public routes and saved-state formats. Add dependency checks for new boundaries; migrate the existing parts when working on them. Split a capability into its own service only when an independent runtime, deployment, resource limit or failure-isolation need is measured.

## Evidence

- tools/build-server.mjs explicitly joins source into one module.
- service/src/16-actions.mjs already supplies action() and runAction().
- service/src/07-jobs.mjs coordinates completion, desired state, receipts and release; preserve this transaction's ordering.
- service/src/24-handler.mjs has shared security gates; feature routers belong below them.
- public/app.js has page cleanup support, but feature additions still touch shared state/navigation tables.
- tools/affected.mjs measures generated service coverage and has conservative fallbacks.

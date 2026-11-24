# Sparkie on Hermes

Sparkie adds fleet, electricity, workload and owner-approved operations to the pinned local Hermes application. It uses upstream Hermes chat, Telegram, sessions, memory, skills, scheduling, delegation and coding tools. The selected single-Spark brain is `edp1096/Huihui-RadixArk-Qwen3.8-27B-abliterated-NVFP4` served by SGLang with its calibrated DFlash2 draft. The model, draft, inference image and auxiliary routing are pinned in the source. [Product contract](docs/contract.md) · [Model pins](models/main-model.json) · [Hermes pin](upstream.lock.json)

## Source and development

- `src/sparkie_sparks` contains the controller, owner binding, operation ledger, collectors, workload and power workers, checked update path and native transport adapters.
- `plugin` and `recipes_plugin` extend the Hermes tools and dashboard. `skills` contains the three native skills, including the two version-aware evidence readers. `SOUL.md` and `config/hermes.example.yaml` configure the local agent.
- `deploy` builds a pinned offline-capable release and stages its protected home, systemd units and update steward. Use a fresh private build directory, obtain and verify the pinned dependencies, then review every release-specific input and check. [Build procedure](deploy/README.md)
- `tests` includes the Python, browser, model and hardware fixtures. `tools/checks.py --paths <changed-path>` selects affected portable tests and indicates the further checks their callers need. For an ordinary edit, run `python3 tools/checks.py --paths <changed-path> --run-python` from this directory in the prepared development environment on a compute Spark. The selector prints the affected checks and runs the Python group. Some tests need an assembled candidate, native Linux interfaces, local model service or hardware. [Testing policy](docs/testing.md)

## Operator enrollment

The public source contains disabled site examples. To prepare a separate private source tree, copy `config/site.example.json` outside this checkout and fill in the independently verified Linux machine IDs, hostnames, enrolled private LAN IPv4 addresses, dashboard hostname and non-root service account. The permanent hub and all compute identities must be distinct. In each protected compute worker configuration, set `interface` to the Ethernet or Wi-Fi device carrying its enrolled address. Keep owner bindings, keys and tokens in the installation's separately provisioned protected files. Existing machine, authenticated owner, approval, journal and rollback checks still apply.

From a clean reviewed Git checkout, run this offline source preparation command. It reads only tracked regular Git index blobs and writes a new private directory. It neither connects to a Spark nor installs a service.

```sh
python sparkie/tools/prepare_site.py --site /private/operator/site.json --output /private/operator/sparkie-source
```

Review the enrolled source and target-specific operator files, build a fresh package, and qualify it before considering a candidate-bound approval. The new site uses public HTTPS on Spark 1 and pinned SSH over the private LAN. Existing installations keep their saved route and rollback records during migration. The default identity sentinels cannot match a Linux machine ID. [Site network and initial setup](docs/site-network.md) · [Checked application updates](docs/application-updates.md)

## Reproducibility and redistribution

This development branch includes the November 22 and 23 research and recovery updates. Public site templates, the generic assistant identity, public research abstracts and development documentation differ from the private input tree, so its source hashes and release manifest differ. No packaged Hermes runtime, frontend bundle, model weights, owner state, physical fleet inventory or machine credentials are included.

The compact source-eval JSON uses project-authored summaries of public observations. It exercises the same harness and schema with different source text. Frozen comparisons that require a third-party held-out corpus or full model card require independently authorized copies whose hashes match the private fixture. Results from public inputs cannot reproduce the private historical timings or semantic grades. [Source-input provenance](tests/behavior/SOURCE-INPUTS.md)

The patches under `deploy/patches` include context from the pinned MIT-licensed NousResearch Hermes Agent source. The uv executable is obtained separately during packaging. Model artifacts and container images retain their upstream terms. [Hermes license](deploy/licenses/hermes-LICENSE-MIT) · [uv license](deploy/licenses/uv-LICENSE-MIT)

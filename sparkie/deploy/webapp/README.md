# Rebuild the native Webapp

The pinned Hermes renderer handles a first slash in a fresh chat and preserves a newer explicit chat or profile selection while session creation is pending. When a superseded creation returns a viewer subscription on its captured owner route, the renderer hands that subscription back to the same gateway and session. Hermes ends the idle row when the last viewer leaves. A normal first submission runs once on the original owner.

## Inputs

Use Linux ARM64, Python 3.9 or newer, Git, Node **26.12.1** and pnpm **12.15.0**. Put the pinned Node and pnpm on PATH. The Linux ARM64 Node binary and pnpm can be obtained from the public Node distribution or the npm packages `node-linux-arm64@26.12.1` and `pnpm@12.15.0`. Hermes's own build tool installs its locked browser dependencies. An empty package cache needs access to the package registry. A populated store supports `pnpm_config_offline=true`. [Node release](https://nodejs.org/dist/v26.12.1/) · [pnpm release](https://www.npmjs.com/package/pnpm/v/12.15.0)

Use the upstream source from Sparkie's lock. A Git checkout at the exact commit supplies the original Webapp sources and build tools. The extension's candidate preparer also accepts the separately pinned source archive in that lock. [Hermes pin](../../upstream.lock.json)

```sh
git clone https://github.com/NousResearch/hermes-agent.git hermes-agent
git -C hermes-agent checkout --detach ae2a81ccc00e9b7c06301523e5bb09608397149c
```

The compressed stylesheet here preserves the released Webapp's visual rules. The historical Tailwind scanner context is unknown. An ordinary build from the pinned, mirrored inputs yields a smaller main stylesheet for both the original and corrected code. This recipe supplies the original stylesheet as an explicit build input. The compiler hook verifies both stylesheet hashes, Vite's exact source hash and its temporary hash marker. Vite generates the module bytes, asset names, entry HTML and renderer manifest. The copied stylesheet has SHA-256 `475000f11448ccbba80ae1f747361e4bccab71be373db693cf0ce8a69ee78fad` after decompression. The bundled notices cover Hermes and the stylesheet dependencies. [Stylesheet notices](NOTICES.txt)

## Build and verify

From the directory containing this recipe, give the script the original Hermes checkout and a new directory outside it. The script applies the six-file patch in a private mirror. It uses upstream's frozen dependency preparation, verifies the source hashes before and after patching, reproduces the original control, compiles the corrected source with ordinary Vite, and builds the corrected renderer with the preserved stylesheet. Finally it verifies every served file against its SHA-256. [Source patch](hermes-webapp-first-slash.patch) · [Six source fingerprints](hermes-webapp-first-slash.json) · [Served inventory](members.json)

```sh
python3 build.py /path/to/hermes-agent /path/to/new-build-directory
```

| Output | Upstream Webapp outputHash |
| --- | --- |
| Original source with original CSS in `control/` | `447cbd194f91106dc301c37abd7ba0a14322284a98a9afab1eaad708e6591d58` |
| Corrected source and ordinary Vite in `ordinary/` | `6381b77c14dc14775e5094e4ed11807fdfa30c2d63dfe5dd3e3a3ee0ab4291f8` |
| Corrected source with original CSS in `webapp/` | `235b2a54a334e1d74cb4250f1989abd4e80918ea643171d6e5a78d61a90e6920` |

Supply the resulting `webapp/` tree to the candidate preparer as its Webapp input. It contains 1,079 files, including the native build receipt. Fleet configuration, credentials, model weights and a running gateway are unnecessary for this build.

## Rebuild from an exported release offline

The release contains the six corrected TypeScript files under `hermes/` and this recipe under `extension/deploy/webapp/`. With the pinned Node, pnpm and dependency cache available, restore the original build inputs **in a temporary copy**. Set `release` to the exported release directory.

```sh
set -eu
release=/path/to/exported-release
kit="$release/extension/deploy/webapp"
work=$(mktemp -d)
cp -a "$release/hermes" "$work/hermes"
python3 - "$kit" "$work/hermes" <<'PY'
import hashlib, json, sys
from pathlib import Path
kit, source = map(Path, sys.argv[1:])
spec = json.loads((kit / "hermes-webapp-first-slash.json").read_text())
def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()
if sha(kit / "hermes-webapp-first-slash.patch") != spec["patch_sha256"]:
    raise SystemExit("Wrong renderer patch")
for name, hashes in spec["files"].items():
    if sha(source / name) != hashes["after_sha256"]:
        raise SystemExit("Unexpected exported source: " + name)
PY
(
  cd "$work/hermes" || exit
  git apply --reverse --check "$kit/hermes-webapp-first-slash.patch" &&
  git apply --reverse "$kit/hermes-webapp-first-slash.patch"
) &&
pnpm_config_offline=true python3 "$kit/build.py" "$work/hermes" "$work/rebuild"
```

The builder checks the restored upstream Webapp source hash `cf2671eb38ea4d06789e81e06d5648d946c82229f3ee90db912cc7f287a72373` across the pinned renderer inputs before staging its own mirror. The verified static site is in `$work/rebuild/webapp/`.

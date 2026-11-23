#!/bin/bash
# Run once before the maintenance chat in its private provisioning workspace.
set -euo pipefail
baseline=${1:?absolute exported release path}
dev=${2:?new absolute development environment path}
: "${UV_CACHE_DIR:?a private writable copy of the pre-stocked uv cache is required}"
[[ "$dev" = /* && ! -e "$dev" ]]
hermes="$baseline/hermes"
runtime="$hermes/.venv/bin/python"
export UV_PROJECT_ENVIRONMENT="$dev" UV_OFFLINE=1 UV_PYTHON_DOWNLOADS=never UV_LINK_MODE=copy
"$baseline/tools/uv" sync --project "$hermes" --frozen --only-group dev \
    --no-install-project --no-build --python "$runtime"
# The group provides the pinned developer tools. Two literal path lines supply the
# already installed application and the release dependencies, without executable .pth code.
site_path='import sysconfig; print(sysconfig.get_path("purelib"))'
runtime_site=$("$runtime" -c "$site_path")
dev_site=$("$dev/bin/python" -c "$site_path")
printf '%s\n' "$hermes" "$runtime_site" > "$dev_site/sparkie-sealed-runtime.pth"

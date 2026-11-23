#!/usr/bin/env bash
# Run Python with the exported Hermes runtime and its locked development tools.
set -euo pipefail
umask 077

if [[ $# -lt 2 ]]; then
    echo 'Usage: bash tools/dev-python.sh EXPORTED_RELEASE PYTHON_ARGUMENT ...' >&2
    exit 2
fi
release=$(realpath -- "$1")
shift
if [[ $(dirname -- "$release") != /opt/sparkie/releases ]]; then
    echo 'Use the extracted release under /opt/sparkie/releases in the private worker.' >&2
    exit 2
fi

hermes="$release/hermes"
runtime="$hermes/.venv/bin/python"
digest=$(sha256sum < "$release/candidate.json")
state="${HOME:?}/.cache/sparkie/dev"
dev="$state/${digest%% *}"
mkdir -p "$state"
(
    flock -x 9
    export UV_PROJECT_ENVIRONMENT="$dev" UV_PYTHON_DOWNLOADS=never UV_LINK_MODE=copy
    "$release/tools/uv" sync --project "$hermes" --frozen --only-group dev \
        --no-install-project --no-build --python "$runtime"
    get_site='import sysconfig; print(sysconfig.get_path("purelib"))'
    runtime_site=$("$runtime" -I -c "$get_site")
    dev_site=$("$dev/bin/python" -I -c "$get_site")
    printf '%s\n' "$hermes" "$runtime_site" > "$dev_site/.sparkie-sealed-runtime.tmp"
    mv -f -- "$dev_site/.sparkie-sealed-runtime.tmp" "$dev_site/sparkie-sealed-runtime.pth"
) 9>"$dev.lock"
export PATH="$dev/bin:$PATH"
exec "$dev/bin/python" "$@"

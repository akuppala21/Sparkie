#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
root=$SOURCE_OPT/releases/20261123-ownerstop1
test "$(sha256sum "$root/candidate.json" | cut -d' ' -f1)" = a6730d4ed5b9108f19dc785a6a7098a3338e7fb3d02d305ff8741f7496ceaf1e
mkdir -p reviewed-runtime/agent
cp "$root/hermes/agent/message_sanitization.py" reviewed-runtime/agent/
python3 - "$root" "$PWD" <<'PY'
import json,sys
from pathlib import Path
package,run=map(Path,sys.argv[1:]);sys.path.insert(0,str(package/'extension/deploy'))
from candidate import apply_native_patch
receipt=apply_native_patch(run/'reviewed-runtime',run/'sparkie',Path('deploy/patches/hermes-remote-terminal-notice.patch'),('agent/message_sanitization.py',))
(run/'applied.json').write_text(json.dumps(receipt,indent=2))
PY

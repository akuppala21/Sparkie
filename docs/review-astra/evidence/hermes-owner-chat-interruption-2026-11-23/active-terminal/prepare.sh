#!/bin/bash
set -euo pipefail
umask 077
cd "$(dirname "$0")"
original=${SOURCE_OPT:?set the sealed package directory}/releases/20261123-attachment1
test "$(sha256sum "$original/candidate.json" | cut -d' ' -f1)" = a5abe1534540c53d29d99cf41e656487e86f8babc6fb077a226f1037daa67903
mkdir reviewed-runtime
for file in tools/terminal_tool.py tools/terminal_tool_result.py agent/replay_cleanup.py locales/en.yaml; do
 mkdir -p "reviewed-runtime/$(dirname "$file")"
 cp "$original/hermes/$file" "reviewed-runtime/$file"
done
python3 - "$original" "$PWD" <<'PY'
import sys,json
from pathlib import Path
original,root=map(Path,sys.argv[1:]);sys.path.insert(0,str(original/'extension/deploy'))
from candidate import apply_native_patch
file=Path('deploy/patches/hermes-remote-terminal-interrupt.patch')
targets=list(json.loads((root/'sparkie'/file.with_suffix('.json')).read_text())['files'])
receipt=apply_native_patch(root/'reviewed-runtime',root/'sparkie',file,targets)
(root/'applied.json').write_text(json.dumps(receipt,indent=2))
PY

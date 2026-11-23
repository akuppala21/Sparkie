#!/bin/bash
set -euo pipefail
base=/opt/sparkie/releases/20261123-attachment1
dev=/opt/sparkie-dev/20261123-attachment1
test -z "${PYTHONPATH:-}"
test ! -e /offline-cache
test ! -e "$HOME"
mkdir "$HOME"
cp -R "$base/extension" /workspace/sparkie
chmod -R u+w /workspace/sparkie
cd /workspace/sparkie
python3 - "$base" "$dev" <<'PY'
import importlib.metadata as meta, json, os, pathlib, sys, tomllib
base, dev = map(pathlib.Path, sys.argv[1:])
assert pathlib.Path(sys.executable) == dev/'bin/python3'
assert os.geteuid() == 12001
assert not any(k.endswith(('_API_KEY','_TOKEN','_PASSWORD','_SECRET')) for k in os.environ)
assert not any(pathlib.Path.home().iterdir())
import hermes_cli, fastapi, pytest, pytest_asyncio
project = tomllib.loads((base/'hermes/pyproject.toml').read_text())
pins = dict(requirement.split('==') for requirement in project['dependency-groups']['dev'])
installed = {k: meta.version(k) for k in pins}
assert installed == pins
print(json.dumps({'python':sys.executable,'python_version':sys.version.split()[0], 'uid':os.geteuid(),
                  'hermes_source':hermes_cli.__file__, 'pytest':pytest.__file__, 'fastapi':fastapi.__file__,
                  'explicit_dev_versions':installed,'credential_variables':0,'home_initially_empty':True}))
PY
python3 tools/checks.py --paths tools/checks.py --run-python

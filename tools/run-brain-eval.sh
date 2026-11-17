#!/usr/bin/env bash
# Run on a compute Spark that is on in a checkout. Only the brain endpoint is real; all case actions use the stand-in fleet.
set -euo pipefail
repo=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
endpoint=$(node -e 'const fs = require("node:fs"); const c = JSON.parse(fs.readFileSync(process.argv[1])); const hub = c.nodes.find(n => n.host === "local"); if (!hub || !c.origin) throw new Error("No committed hub endpoint"); process.stdout.write(c.origin.replace(/\/$/, "") + (c.apiMount || "/console/api"));' "$repo/service/config.json")
exec node "$repo/test/eval.mjs" --brain-url "$endpoint" --console "$endpoint" "$@"

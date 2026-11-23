"""Match Docker labels and bind paths to the private case profile."""

import json
from pathlib import Path
import subprocess
import sys

case = Path(sys.argv[1]).resolve()
root = case / "profile/sandboxes/docker"
ids = subprocess.check_output(
    ["docker", "ps", "-aq", "--no-trunc", "--filter", "label=hermes-agent=1"], text=True
).splitlines()
for cid in ids:
    mounts = json.loads(
        subprocess.check_output(
            ["docker", "inspect", "--format", "{{json .Mounts}}", cid]
        )
    )
    assert not any(
        m["Type"] == "bind" and Path(m["Source"]).is_relative_to(root) for m in mounts
    )
case.with_suffix(".cleanup.json").write_text(
    json.dumps({"verified": True, "remaining_owned_containers": []}) + "\n"
)

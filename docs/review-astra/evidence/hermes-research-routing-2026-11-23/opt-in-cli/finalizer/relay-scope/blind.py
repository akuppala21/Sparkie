"""Create a grader packet and save the private assignment key separately."""

import json
from pathlib import Path
import secrets
import sys

base = Path(sys.argv[1])
packet = []
key = {}
for case_id in ("batch-output", "serial-check", "running-worker"):
    arms = ["normal", "relay"]
    secrets.SystemRandom().shuffle(arms)
    for label, arm in zip(("A", "B"), arms):
        path = base / case_id / arm
        status = int(path.with_suffix(".exit").read_text())
        wire = json.loads((path / "wire.json").read_text())
        assert len(wire) == 1 and wire[0]["equals_expected"]
        result = (
            json.loads((path / "result.json").read_text())
            if (path / "result.json").exists()
            else {}
        )
        assert status in (0, 124, 137) and (status != 0 or result.get("answer"))
        row_id = case_id + "-" + label
        packet.append(
            {"case": case_id, "sample": row_id, "answer": result.get("answer")}
        )
        key[row_id] = arm
for filename, value in [
    ("assignment-private.json", key),
    ("answers-blind.json", packet),
]:
    with (base / filename).open("x") as out:
        json.dump(value, out, indent=2)
        out.write("\n")

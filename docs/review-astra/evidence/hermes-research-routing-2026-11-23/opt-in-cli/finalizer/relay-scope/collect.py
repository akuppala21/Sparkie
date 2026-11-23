"""Export only validated CPU counts, fixed fixture labels and body hashes."""

import json
from pathlib import Path
import re
import sys


def load(path):
    return json.loads(path.read_bytes())


base, controls = map(Path, sys.argv[1:3])
cases = {}
on = {"enable_thinking": True, "thinking": True, "reasoning_effort": "low"}
off = {**on, "enable_thinking": False, "thinking": False}
for case in ("batch-output", "serial-check", "running-worker"):
    by_arm = {}
    for arm in ("normal", "relay"):
        row = load(base / case / arm / "result.json")
        (wire,) = row["wire"]
        assert row["arm"] == arm and row["case"] == case
        assert (
            row["real_provider_requests"] == 0
            and not row["allowed_socket_destinations"]
        )
        assert row["answer"] == "CPU controlled response"
        assert wire["equals_expected"] and wire["unexpected_keys"] == []
        assert wire["wire_effort"] == "low" and wire["template_options"] == (
            on if arm == "normal" else off
        )
        assert wire["changed_from_baseline"] == (
            [] if arm == "normal" else ["chat_template_kwargs"]
        )
        assert row["agent_reasoning_after"] == {"enabled": True, "effort": "low"}
        assert re.fullmatch(r"[a-f0-9]{64}", wire["request_json_sha256"])
        assert re.fullmatch(r"[a-f0-9]{64}", row["frozen_request"])
        assert type(row["blocked_socket_attempts"]) is int
        by_arm[arm] = {
            "frozen_file_sha256": row["frozen_request"],
            "canonical_outgoing_body_sha256": wire["request_json_sha256"],
            "matches_expected_body": True,
            "sdk_sends": 1,
            "provider_requests": 0,
            "connected_sockets": 0,
            "blocked_socket_attempts": row["blocked_socket_attempts"],
            "template_options": wire["template_options"],
            "wire_reasoning_effort": "low",
            "reasoning_after": row["agent_reasoning_after"],
        }
    cases[case] = by_arm
a = load(controls / "normal" / "controls.json")
assert a == load(controls / "relay" / "controls.json")
assert [v["label"] for v in a] == [
    "primary-before",
    "title-generation",
    "primary-after",
]
for row in a:
    assert set(row) == {"label", "body_sha256", "thinking_options", "wire_effort"}
    assert row["thinking_options"] == on and row["wire_effort"] == "low"
    assert re.fullmatch(r"[a-f0-9]{64}", row["body_sha256"])
print(
    json.dumps(
        {"cases": cases, "ordinary_and_auxiliary_controls_identical_in_both_arms": a},
        indent=2,
    )
)

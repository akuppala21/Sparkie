"""Replay the sealed native finalizer. Default mode is CPU-only and denies network."""

import argparse
from copy import deepcopy
import hashlib
import json
import logging
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import threading
import time

HERE = Path(__file__).resolve().parent
URL = "http://127.0.0.1:32202/v1/chat/completions"
CASE_HASH = {
    "batch-output": "138f9e9fa5ea751ff97a1799c5f7aa887a65b4003b3fb47da5c1fca03855db53",
    "serial-check": "4c32f84cfe1684e587cf1883d31a215cd2ff57743f1274f75e1ae500346d5b5c",
    "running-worker": "6915092a3b13e2d007e19c7a7bd1d917419a3b76c05ddf55aeec93e8ee48d6aa",
}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def normalized(value):
    return json.dumps(
        value, separators=(",", ":"), sort_keys=True, ensure_ascii=False
    ).encode()


def load(path):
    return json.loads(path.read_bytes())


def save(path, value):
    path.write_text(json.dumps(value, indent=2, default=str) + "\n")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("case", choices=CASE_HASH)
    p.add_argument("arm", choices=["normal", "relay"])
    p.add_argument("--frozen", type=Path, required=True)
    p.add_argument("--release", type=Path, required=True)
    p.add_argument("--out", type=Path, required=True)
    p.add_argument("--lease-identity", type=Path)
    p.add_argument("--controls", action="store_true")
    args = p.parse_args()
    assert not (args.controls and args.lease_identity)
    src = args.frozen / args.case
    release = args.release
    out = args.out
    assert (
        sha((release / "candidate.json").read_bytes())
        == "a5abe1534540c53d29d99cf41e656487e86f8babc6fb077a226f1037daa67903"
    )
    assert (
        Path("/etc/machine-id").read_text().strip()
        == os.environ["SPARKIE_REPLAY_MACHINE_ID"]
    )
    out.mkdir(parents=True, exist_ok=False, mode=0o700)
    record = load(src / "attestation.json")
    original = load(src / "request.json")
    assert (
        sha((src / "request.json").read_bytes())
        == record["frozen_request_sha256"]
        == CASE_HASH[args.case]
    )
    assert (
        sha((src / "prefix.json").read_bytes()) == record["private_prefix_file_sha256"]
    )
    system = (src / "saved-system.txt").read_text()
    assert sha(system.encode()) == record["source_session_system_sha256"]
    prefix = load(src / "prefix.json")
    expected = deepcopy(original)
    if args.arm == "relay":
        options = expected["chat_template_kwargs"]
        assert options == {
            "enable_thinking": True,
            "thinking": True,
            "reasoning_effort": "low",
        }
        options.update(enable_thinking=False, thinking=False)
    if args.lease_identity:
        identity = load(args.lease_identity)
        historical_dir = args.frozen.parent.parent
        old_identity = load(
            Path((historical_dir / "model-home").read_text().strip())
            / "running-container.json"
        )
        assert (
            identity["argv"] == old_identity["argv"]
            and identity["mounts"] == old_identity["mounts"]
        )
        container = json.loads(
            subprocess.check_output(["docker", "inspect", identity["container_id"]])
        )[0]
        assert (
            container["Id"] == identity["container_id"]
            and container["State"]["Running"]
        )
        assert (
            container["Name"] == "/" + identity["name"]
            and container["Config"]["Cmd"] == identity["argv"]
        )
        assert (
            container["Config"]["Image"]
            == identity["image"]
            == "lmsysorg/sglang@sha256:e3a4f06001a29542fc4a8638536d9ffc5eb9c9942b08603c09b19a56eae4a1ae"
        )
        mounts = {
            mount["Destination"]: {"source": mount["Source"], "write": mount["RW"]}
            for mount in container["Mounts"]
        }
        assert all(
            mounts.get(path) == descriptor
            for path, descriptor in old_identity["mounts"].items()
        )
        for k, v in [
            ("--served-model-name", "sparkie-hermes-main"),
            ("--host", "127.0.0.1"),
            ("--port", "32202"),
            ("--speculative-algorithm", "DFLASH"),
        ]:
            assert identity["argv"][identity["argv"].index(k) + 1] == v
    profile = out / "profile"
    shutil.copytree(src / "profile", profile)
    os.environ.update(
        HERMES_HOME=str(profile),
        HF_HUB_OFFLINE="1",
        NO_PROXY="*",
        HERMES_DISABLE_LAZY_INSTALLS="1",
    )
    sys.path.insert(0, str(release / "extension/src"))
    guard_state = threading.local()
    allowed = []
    blocked = []

    def guard(event, items):
        if event == "socket.connect":
            if (
                args.lease_identity
                and getattr(guard_state, "validated", False)
                and isinstance(items[1], tuple)
                and items[1][:2] == ("127.0.0.1", 32202)
            ):
                allowed.append("127.0.0.1:32202")
            else:
                blocked.append("blocked")
                raise PermissionError(
                    "Networking denied outside the approved, validated loopback request."
                )

    sys.addaudithook(guard)
    import nemo_relay as relay
    from scope_plugin import KIND, LocalSummary

    if args.arm == "relay":
        os.environ["HERMES_NEMO_RELAY_PLUGINS_TOML"] = str(HERE / "component.toml")
        relay.plugin.register(KIND, LocalSummary())
    from hermes_state import SessionDB
    from hermes_cli.config import apply_terminal_config_to_env, load_config_readonly
    from hermes_cli.plugins import get_plugin_manager
    from tools.registry import discover_builtin_tools
    from gateway.session_context import set_session_vars, clear_session_vars
    from tui_gateway import server
    from agent.turn_finalizer import _resolve_budget_fallback
    from agent.iteration_budget import IterationBudget
    from agent import relay_runtime
    import httpx

    cfg = load_config_readonly()
    apply_terminal_config_to_env(config=cfg, override=True)
    get_plugin_manager().discover_and_load()
    discover_builtin_tools()
    with sqlite3.connect(profile / "restored.db") as conn:
        sid = conn.execute("select id from sessions").fetchone()[0]
    db = SessionDB(profile / "restored.db")
    session = set_session_vars(session_key=sid, platform="cli")
    agent = server._make_agent(
        sid,
        sid,
        session_db=db,
        cwd_override="/workspace",
        provider_override=None,
        platform_override="cli",
        context_cwd_is_launch_artifact=False,
    )
    assert (
        agent.model == "sparkie-hermes-main"
        and agent.max_tokens is None
        and agent.provider == "custom"
    )
    assert agent.base_url.rstrip("/") == "http://127.0.0.1:32202/v1"
    agent_reasoning = deepcopy(agent.reasoning_config)
    rounds = record["completed_historical_model_rounds"]
    agent._cached_system_prompt = system
    agent.max_iterations = rounds
    agent.iteration_budget = IterationBudget(rounds)
    for _ in range(rounds):
        assert agent.iteration_budget.consume()
    lease = relay_runtime.SESSION_COORDINATOR.acquire_conversation(
        profile_key=relay_runtime.current_profile_key(), session_id=sid, platform="cli"
    )
    turn = relay_runtime.SESSION_COORDINATOR.begin_turn(
        lease, turn_id="frozen-summary", task_id="replay"
    )
    sends = []
    sent_responses = []
    orig = httpx.Client.send
    started = time.monotonic()
    marker = "CPU controlled response"

    def capture(client, request, *a, **kw):
        body = json.loads(request.content)
        assert str(request.url) == URL and not body.get("stream") and not sends
        changed = [
            k for k in set(body) | set(original) if body.get(k) != original.get(k)
        ]
        diffkeys = [
            k for k in set(body) | set(expected) if body.get(k) != expected.get(k)
        ]
        result = {
            "equals_expected": body == expected,
            "changed_from_baseline": sorted(changed),
            "unexpected_keys": sorted(diffkeys),
            "request_json_sha256": sha(normalized(body)),
            "template_options": body.get("chat_template_kwargs"),
            "wire_effort": body.get("reasoning_effort"),
        }
        sends.append(result)
        save(out / "wire.json", sends)
        assert body == expected, result
        if args.lease_identity:
            guard_state.validated = True
            try:
                response = orig(client, request, *a, **kw)
                response.read()
            finally:
                guard_state.validated = False
            parsed = response.json()
            sent_responses.append(
                {
                    "finish": parsed["choices"][0]["finish_reason"],
                    "usage": parsed.get("usage"),
                }
            )
            return response
        return httpx.Response(
            200,
            request=request,
            json={
                "id": "cpu",
                "object": "chat.completion",
                "created": 0,
                "model": body["model"],
                "choices": [
                    {
                        "index": 0,
                        "message": {"role": "assistant", "content": marker},
                        "finish_reason": "stop",
                    }
                ],
            },
        )

    try:
        controls = []
        if args.controls:
            from controls import capture_control

            controls.append(capture_control(agent, "primary-before"))
        httpx.Client.send = capture
        answer, reason, _, _ = _resolve_budget_fallback(
            agent,
            final_response=None,
            api_call_count=rounds,
            interrupted=False,
            failed=False,
            messages=prefix,
            _turn_exit_reason="budget_exhausted",
            _pending_verification_response=None,
            _pending_verification_response_previewed=False,
            logger=logging.getLogger(__name__),
        )
        assert len(sends) == 1 and "max_iterations_reached" in str(reason)
        assert args.lease_identity or answer == marker
        if args.controls:
            httpx.Client.send = orig
            controls.append(capture_control(agent, "title-generation"))
            controls.append(capture_control(agent, "primary-after"))
            assert controls[0]["body_sha256"] == controls[-1]["body_sha256"]
            save(out / "controls.json", controls)
        assert agent.reasoning_config == agent_reasoning
        save(
            out / "result.json",
            {
                "case": args.case,
                "arm": args.arm,
                "frozen_request": CASE_HASH[args.case],
                "seconds": round(time.monotonic() - started, 3),
                "real_provider_requests": len(sent_responses),
                "allowed_socket_destinations": allowed,
                "blocked_socket_attempts": len(blocked),
                "answer": answer,
                "exit_reason": reason,
                "wire": sends,
                "agent_reasoning_after": agent.reasoning_config,
                "provider_responses": sent_responses,
            },
        )
    finally:
        httpx.Client.send = orig
        relay_runtime.SESSION_COORDINATOR.end_turn(turn, outcome="success")
        relay_runtime.SESSION_COORDINATOR.release_conversation(lease)
        agent.close()
        db.close()
        clear_session_vars(session)
        if args.arm == "relay":
            relay.plugin.deregister(KIND)


if __name__ == "__main__":
    main()

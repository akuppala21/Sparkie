"""Use real pinned native memory, session storage and both FTS indexes."""

import json
from pathlib import Path

import pytest

from sparkie_sparks.memory_erase import apply, matches_request, prepare, ErasurePlanChanged

pytestmark = pytest.mark.integration


@pytest.fixture
def profile(tmp_path, monkeypatch):
    from hermes_state import SessionDB
    from tools.memory_tool import load_on_disk_store
    from hermes_constants import set_hermes_home_override, reset_hermes_home_override

    home = tmp_path / "profile"
    home.mkdir()
    monkeypatch.setenv("HERMES_HOME", str(home))
    token = set_hermes_home_override(home)
    db = SessionDB(db_path=home / "state.db")
    try:
        yield home, load_on_disk_store(), db
    finally:
        db.close()
        reset_hermes_home_override(token)


def test_erase_removes_only_reviewed_text_in_native_memory_and_active_archived_search(profile):
    home, store, db = profile
    secret = "shelfCanaryA12"
    sid = "synthetic-session"
    assert store.add("user", "Keep my font mono. Shelf label: " + secret)["success"]
    assert store.add("memory", "Always retain unrelated project details")["success"]
    db.create_session(sid, source="telegram")
    db.update_system_prompt(sid, "Unrelated. Selected shelf " + secret)
    db.append_message(sid, role="user", content="Archive example " + secret)
    db.append_message(sid, role="assistant", content="Visible reply " + secret)
    db.append_message(
        sid,
        role="assistant",
        content="Used fixture.",
        tool_calls=[
            {
                "id": "fixture-call",
                "type": "function",
                "function": {"name": "lookup", "arguments": json.dumps({"text": secret})},
            }
        ],
    )
    first = db._read_one("SELECT id FROM messages WHERE session_id=? ORDER BY id LIMIT 1", (sid,))[0]
    db.deactivate_message(sid, first)
    assert db.search_messages(secret, include_inactive=True)
    assert db.search_messages(secret)
    plan = prepare(home, "user", secret)
    assert matches_request(plan, "user", secret)
    assert not matches_request(plan, "memory", secret)
    assert not matches_request(plan, "user", secret + "different")
    assert secret not in json.dumps(plan) and plan["message_rows"] == 3 and plan["session_rows"] == 1
    assert secret in (home / "memories/USER.md").read_text()
    assert apply(home, plan) == {"complete": True, "memory_entries": 1, "message_rows": 3, "session_rows": 1}
    assert not db.search_messages(secret, include_inactive=True)
    assert not db.search_messages(secret)
    assert secret not in db.get_session(sid)["system_prompt"]
    assert db.search_messages("Visible") and db.search_messages("Archive", include_inactive=True)
    assert "Keep my font mono." in (home / "memories/USER.md").read_text()
    assert "Always retain unrelated" in (home / "memories/MEMORY.md").read_text()
    with pytest.raises(ErasurePlanChanged):
        apply(home, plan)


def test_changed_history_or_memory_refuses_before_erasing_anything(profile):
    home, store, db = profile
    name = "rackCanaryB22"
    assert store.add("user", name)["success"]
    db.create_session("test", source="cli")
    db.append_message("test", role="user", content=name)
    plan = prepare(home, "user", name)
    db.append_message("test", role="assistant", content="Changed copy " + name)
    with pytest.raises(ErasurePlanChanged):
        apply(home, plan)
    assert db.search_messages(name) and name in (home / "memories/USER.md").read_text()
    new = prepare(home, "user", name)
    assert store.patch("user", name, "Replaced with unrelated text")["success"]
    with pytest.raises(ErasurePlanChanged):
        apply(home, new)
    assert db.search_messages(name)


def test_whole_entry_erasure_and_ambiguous_profile_scope(profile):
    home, store, _ = profile
    marker = "rackCanaryC33"
    assert store.add("user", marker)["success"]
    assert store.add("memory", "A second entry memorized " + marker)["success"]
    with pytest.raises(ErasurePlanChanged):
        prepare(home, "user", marker)
    assert store.remove("memory", marker)["success"]
    assert apply(home, prepare(home, "user", marker))["complete"]
    assert not (home / "memories/USER.md").read_text().strip()


def test_live_turn_refuses_erasure_and_scalar_tool_arguments_preserve_json(profile):
    home, store, db = profile
    secret = "Caf\u00e9Canary"
    assert store.add("user", secret)["success"]
    db.create_session("leased", source="test")
    db.append_message(
        "leased", role="assistant", content="Untouched",
        tool_calls=[{"function": {"name": "lookup", "arguments": json.dumps(secret, ensure_ascii=True)}}],
    )
    plan = prepare(home, "user", secret)
    assert plan["message_rows"] == 1
    assert db.acquire_session_turn_lease("leased", "synthetic-worker", wait_seconds=0)
    with pytest.raises(ErasurePlanChanged, match="still running"):
        apply(home, plan)
    assert secret in (home / "memories/USER.md").read_text()
    db.release_session_turn_lease("leased", "synthetic-worker")
    assert apply(home, plan)["complete"]
    raw = db._read_one("SELECT tool_calls FROM messages WHERE session_id=?", ("leased",))[0]
    assert json.loads(json.loads(raw)[0]["function"]["arguments"]) == "[erased]"


def test_memory_write_failure_after_history_commit_is_uncertain(profile, monkeypatch):
    home, store, db = profile
    name = "rackCanaryD44"
    assert store.add("user", name)["success"]
    db.create_session("test", source="cli")
    db.append_message("test", role="user", content=name)
    plan = prepare(home, "user", name)

    def fail(*args):
        raise OSError("synthetic interrupted memory write")

    monkeypatch.setattr(type(store), "_write_file", fail)
    with pytest.raises(OSError, match="interrupted"):
        apply(home, plan)
    assert not db.search_messages(name)
    assert name in (home / "memories/USER.md").read_text()
    with pytest.raises(ErasurePlanChanged):
        apply(home, plan)

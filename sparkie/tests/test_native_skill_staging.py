"""Native staged writes against disposable copies of the extension's actual skills."""
import json
import os
from pathlib import Path
import shutil

import pytest
from hermes_constants import get_hermes_home
from tools import skill_manager_tool, write_approval


EXTENSION = Path(__file__).resolve().parents[1]
PROPOSALS = Path(__file__).with_name("fixtures") / "native_skill_stage_proposals.json"
SKILL = "local-recipe-review"


@pytest.fixture
def skill_home(tmp_path, monkeypatch):
    home = tmp_path / "profile"
    home.mkdir()
    monkeypatch.setenv("HERMES_HOME", str(home))
    monkeypatch.chdir(tmp_path)
    assert get_hermes_home().resolve() == home.resolve()
    (home / "config.yaml").write_text("skills:\n  write_approval: true\nmemory:\n  write_approval: true\n")
    shutil.copytree(EXTENSION / "skills", home / "skills")
    assert write_approval.write_approval_enabled(write_approval.SKILLS)
    return home


def call(**arguments):
    return json.loads(skill_manager_tool.skill_manage(**arguments))


def stage(**arguments):
    result = call(**arguments)
    assert result.get("staged") is True, result
    return write_approval.get_pending(write_approval.SKILLS, result["pending_id"])["payload"]


def reject(**arguments):
    before = write_approval.list_pending(write_approval.SKILLS)
    result = call(**arguments)
    assert result["success"] is False and "pending_id" not in result, result
    assert write_approval.list_pending(write_approval.SKILLS) == before
    return result


def reference(home, filename):
    directory = home / "skills" / SKILL / "references"
    directory.mkdir(exist_ok=True)
    return directory / filename


def replay(payload):
    return json.loads(skill_manager_tool.apply_skill_pending(payload))


def test_captured_single_patch_misses_do_not_stage(skill_home):
    proposals = json.loads(PROPOSALS.read_text())
    assert set(proposals) == {"B", "C"}
    target = skill_home / "skills" / SKILL / "SKILL.md"
    original = target.read_bytes()
    for payload in proposals.values():
        result = reject(name="", **payload)
        assert result["failed_index"] == 0
        assert "SKILL.md" in result["error"] and SKILL in result["error"]
        assert target.read_bytes() == original


def test_ordered_native_batch_replays_only_after_approval(skill_home):
    content = "---\nname: probe\ndescription: Test staged procedures.\n---\nFirst step.\n"
    payload = stage(name="probe", action="", operations=[
        {"action": "create", "name": "probe", "content": content},
        {"action": "patch", "name": "probe", "old_string": "First step.", "new_string": "Second step."},
        {"action": "patch", "name": "probe", "old_string": "Second step.", "new_string": "Final step."},
    ])
    target = skill_home / "skills/probe/SKILL.md"
    assert not target.exists()
    assert replay(payload)["success"]
    assert target.read_text() == content.replace("First step.", "Final step.")


def test_native_batch_rolls_back_removed_file_and_preserves_delete_rules(skill_home):
    target = reference(skill_home, "state.md")
    target.write_text("anchor")
    remove = {"action": "remove_file", "name": SKILL, "file_path": "references/state.md"}
    patch = {"action": "patch", "name": SKILL, "file_path": "references/state.md",
             "old_string": "anchor", "new_string": "replacement"}
    payload = stage(name=SKILL, action="", operations=[remove, patch])
    result = replay(payload)
    assert not result["success"] and result["failed_index"] == 1
    assert target.read_text() == "anchor"
    delete = {"action": "delete", "name": SKILL}
    reject(name=SKILL, action="", operations=[delete, patch])
    stage(name=SKILL, action="", operations=[delete])
    assert target.is_file()


def test_approved_patch_rechecks_current_file(skill_home):
    target = reference(skill_home, "state.md")
    target.write_text("anchor")
    payload = stage(action="patch", name=SKILL, file_path="references/state.md",
                    old_string="anchor", new_string="replacement")
    target.write_text("changed since staging")
    assert replay(payload)["success"] is False
    assert target.read_text() == "changed since staging"


def test_fuzzy_single_operation_uses_default_skill_name(skill_home):
    target = reference(skill_home, "indent.md")
    target.write_text("Before\n    alpha\n    bravo\nAfter\n")
    old = "alpha\nbravo"
    assert old not in target.read_text()
    payload = stage(action="", name=SKILL, operations=[
        {"action": "patch", "file_path": "references/indent.md", "old_string": old, "new_string": "changed"},
    ])
    assert replay(payload)["success"]
    assert "changed" in target.read_text()


def test_fifo_is_rejected_before_read(skill_home, monkeypatch):
    target = reference(skill_home, "pipe")
    os.mkfifo(target)
    read_text = Path.read_text

    def check_read(path, *args, **kwargs):
        assert path != target, "Native staging tried to read the FIFO"
        return read_text(path, *args, **kwargs)

    monkeypatch.setattr(Path, "read_text", check_read)
    result = reject(name=SKILL, action="patch", file_path="references/pipe", old_string="a", new_string="b")
    assert "regular file" in result["error"]


def test_symlink_outside_skill_is_rejected(skill_home):
    target = reference(skill_home, "outside")
    target.symlink_to(skill_home / "config.yaml")
    result = reject(name=SKILL, action="patch", file_path="references/outside",
                    old_string="write_approval", new_string="disabled")
    assert "escapes" in result["error"]

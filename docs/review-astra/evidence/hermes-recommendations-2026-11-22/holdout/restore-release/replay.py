"""Reproduce the frozen synthetic merge in a temporary CPU-only Git repository."""
import json
import os
from pathlib import Path
import subprocess
import tempfile


with tempfile.TemporaryDirectory(prefix="sparkie-merge-adjudication-") as directory:
    repo = Path(directory)
    stamp = "2025-01-01T00:00:00Z"
    env = dict(os.environ, GIT_CONFIG_NOSYSTEM="1", GIT_CONFIG_GLOBAL="/dev/null",
               GIT_AUTHOR_DATE=stamp, GIT_COMMITTER_DATE=stamp)

    def git(*args):
        prefix = ["git", "-c", "user.name=Example", "-c", "user.email=example@localhost",
                  "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null"]
        return subprocess.run([*prefix, *args], cwd=repo, env=env, check=True,
                              capture_output=True, text=True).stdout.strip()

    def change(name):
        (repo / name).write_text(name + "\n")
        git("add", "--", name)
        git("commit", "-qm", name)

    git("init", "-qb", "release")
    change("base.txt")
    git("branch", "topic")
    change("release-only.txt")
    git("switch", "-q", "topic")
    change("topic-only.txt")
    git("merge", "--no-edit", "-m", "integrate release into topic", "release")
    merge = git("rev-parse", "HEAD")
    parents = git("show", "-s", "--format=%P", merge).split()
    assert merge == "4f1cc0a7898fb0a144c5479aa0cbc604a23f551a"
    assert parents == ["bd90ee817f5167cf17d4f2ce80f6793bdeae8912",
                       "8852c7b9bb4c57a5d7f605fa2a024fd3d133ea2d"]
    git("switch", "-q", "release")
    git("merge", "--ff-only", "topic")
    change("later-release-fix.txt")
    tip = git("rev-parse", "HEAD")
    tree = git("rev-parse", "HEAD^{tree}")
    git("revert", "--no-edit", "-m", "2", merge)
    rollback = git("rev-parse", "HEAD")
    after = git("ls-tree", "--name-only", "HEAD").splitlines()
    assert after == ["base.txt", "later-release-fix.txt", "release-only.txt"]
    git("merge", "--ff-only", "topic")
    assert git("rev-parse", "HEAD") == rollback
    git("revert", "--no-edit", rollback)
    assert git("rev-parse", "HEAD^{tree}") == tree
    git("merge-base", "--is-ancestor", tip, "HEAD")
    result = {"git_version": git("--version"), "merge": merge, "parents": parents,
              "later_fix_retained": True, "unchanged_topic_remerge_was_noop": True,
              "restored_exact_original_tree": True, "rollback_tree_files": after}

assert not repo.exists()
result["temporary_repository_removed"] = True
print(json.dumps(result, indent=2))

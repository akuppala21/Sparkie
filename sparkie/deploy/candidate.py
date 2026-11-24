"""Prepare and verify a pinned Hermes directory candidate. Never install it."""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile
import tomllib
import zipapp


RESTORE_PATCH = Path("deploy/patches/hermes-sealed-web-restore.patch")
RESTORE_ROUTERS = ("hermes_cli/web_routers/ops.py", "hermes_cli/web_routers/transfer.py")

WEBAPP_PATCH = Path("deploy/webapp/hermes-webapp-first-slash.patch")
WEBAPP_TARGETS = (
    "apps/desktop/src/app/session/hooks/use-prompt-actions/slash.ts",
    "apps/desktop/src/app/session/hooks/use-prompt-actions/submission-destination.test.tsx",
    "apps/desktop/src/app/session/hooks/use-session-actions/index.ts",
    "apps/desktop/src/app/session/hooks/use-session-actions.creating-session-hold.test.tsx",
    "apps/desktop/src/store/session-states.ts",
    "apps/desktop/src/types/hermes.ts",
)


def sha(path):
    with Path(path).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def stage_build_tool(uv, extension, destination):
    pin = json.loads((extension / "deploy/build-tools.json").read_text())["uv"]
    target = destination / "tools/uv"
    if pin["path"] != "tools/uv" or sha(uv) != pin["sha256"]:
        raise ValueError("The build requires the reviewed uv binary for " + pin["platform"])
    destination.mkdir(parents=True, mode=0o755)
    target.parent.mkdir()
    shutil.copyfile(uv, target)
    if sha(target) != pin["sha256"]:
        raise ValueError("The build tool changed while being copied")
    target.chmod(0o555)
    return target, pin


def install_structured_validator(uv, native, runtime, env):
    # Hermes skips schema validation when this optional dependency is absent.
    # Install its small dependency group directly from the pinned upstream lock.
    required = {"jsonschema", "attrs", "jsonschema-specifications", "referencing", "rpds-py"}
    with (native / "uv.lock").open("rb") as source:
        packages = tomllib.load(source)["package"]
    requirements = {}
    for package in packages:
        name = package["name"]
        if name not in required:
            continue
        if name in requirements or not package.get("wheels"):
            raise ValueError("Expected one locked wheel release for " + name)
        hashes = " ".join("--hash=" + wheel["hash"] for wheel in package["wheels"])
        requirements[name] = f"{name}=={package['version']} {hashes}"
    if requirements.keys() != required:
        raise ValueError("The upstream lock does not cover the structured-output validator.")
    subprocess.run([str(uv), "pip", "install", "--python", str(runtime), "--require-hashes",
                    "--only-binary", ":all:", "-r", "-"], cwd=native, env=env,
                   input="\n".join(requirements.values()) + "\n", text=True, check=True)


def apply_restore_guard(native, extension):
    return apply_native_patch(native, extension, RESTORE_PATCH, RESTORE_ROUTERS)


def apply_native_patch(native, extension, patch_path, targets):
    patch = (extension / patch_path).resolve(strict=True)
    reviewed = json.loads(patch.with_suffix(".json").read_text())
    patch_hash = sha(patch)
    if patch_hash != reviewed["patch_sha256"] or set(reviewed["files"]) != set(targets):
        raise ValueError("The reviewed native patch or its targets changed.")
    before = {name: sha(native / name) for name in targets}
    if any(before[name] != reviewed["files"][name]["before_sha256"] for name in before):
        raise ValueError("The native patch requires the reviewed upstream files.")
    # Extracted sources have no .git. Keep Git outside any enclosing checkout
    # and ignore ambient repository and whitespace configuration.
    env = {"PATH": os.environ.get("PATH", os.defpath), "GIT_CEILING_DIRECTORIES": str(native.parent),
           "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": os.devnull}
    command = ["git", "apply", "--whitespace=error"]
    stats = subprocess.check_output([*command, "--numstat", "-z", str(patch)], cwd=native, env=env)
    patched_targets = [row.split(b"\t", 2)[2].decode() for row in stats.split(b"\0") if row]
    if sorted(patched_targets) != sorted(targets):
        raise ValueError("The native patch targets different upstream files.")
    subprocess.run([*command, "--check", str(patch)], cwd=native, env=env, check=True)
    subprocess.run([*command, str(patch)], cwd=native, env=env, check=True)
    after = {name: sha(native / name) for name in before}
    if any(after[name] != reviewed["files"][name]["after_sha256"] for name in after):
        raise ValueError("The patched native files differ from the reviewed result.")
    return {"patch": "extension/" + patch_path.as_posix(), "sha256": patch_hash,
            "upstream_files": before, "patched_files": after}


def inventory(root, *, release=False):
    """Hash regular files and literal symlink targets without following directory links."""
    regular, links = {}, {}

    def visit(directory):
        with os.scandir(directory) as entries:
            for entry in entries:
                path = Path(entry.path)
                name = path.relative_to(root).as_posix()
                if entry.name == ".git":
                    raise ValueError("A candidate must be a sealed source tree")
                if release and name == "candidate.json":
                    if not entry.is_file(follow_symlinks=False):
                        raise ValueError("The candidate manifest must be a regular file")
                    continue
                if entry.is_symlink():
                    links[name] = os.readlink(path)
                elif entry.is_dir(follow_symlinks=False):
                    visit(path)
                elif entry.is_file(follow_symlinks=False):
                    regular[name] = sha(path)
                else:
                    raise ValueError(f"Unsupported file type in the sealed runtime: {name}")

    visit(root)
    return dict(sorted(regular.items())), dict(sorted(links.items()))


def stage_webapp(source, destination, reviewed_members):
    shutil.copytree(source, destination, symlinks=True)
    expected = json.loads(reviewed_members.read_text())
    if inventory(destination) != (expected, {}):
        raise ValueError("The packaged Webapp differs from its reviewed build output")


def verify(root):
    root = Path(root).resolve(strict=True)
    manifest_path = root / "candidate.json"
    if manifest_path.is_symlink() or not manifest_path.is_file():
        raise ValueError("The candidate manifest must be a regular file")
    manifest = json.loads(manifest_path.read_text())
    expected = manifest["files"]
    if inventory(root, release=True) != (expected, manifest["symlinks"]):
        raise ValueError("Candidate files changed; build and qualify a new candidate")
    if "build_tools" in manifest:
        pin = json.loads((root / "extension/deploy/build-tools.json").read_text())["uv"]
        if (manifest["build_tools"] != {"uv": pin} or pin["path"] != "tools/uv"
                or expected.get("tools/uv") != pin["sha256"] or not os.access(root/"tools/uv", os.X_OK)):
            raise ValueError("The sealed build tool differs from its reviewed pin")
    if sha(manifest["runtime"]["base_python"]) != manifest["runtime"]["base_python_sha256"]:
        raise ValueError("Candidate base interpreter changed")
    base_root = Path(manifest['runtime']['base_root'])
    if inventory(base_root) != (manifest['runtime']['base_files'], manifest['runtime']['base_symlinks']):
        raise ValueError('Candidate base runtime or standard library changed')
    return manifest


def prepare(archive, destination, webapp, dashboard, *, uv, python, extension):
    extension = Path(extension).resolve(strict=True)
    lock = json.loads((extension / "upstream.lock.json").read_text())
    archive = Path(archive).resolve(strict=True)
    if sha(archive) != lock["source_archive_sha256"]:
        raise ValueError("Upstream archive does not match the approved pin")
    commit = lock.get("commit", "")
    if len(commit) != 40 or commit == "0" * 40 or any(c not in "0123456789abcdef" for c in commit):
        raise ValueError("A verified upstream commit is required for native provenance")
    destination = Path(destination).resolve()
    if destination.exists():
        raise FileExistsError("Candidate destination must be new; previous releases are retained")
    for source in (extension, Path(webapp).resolve(), Path(dashboard).resolve()):
        if destination.is_relative_to(source):
            raise ValueError("Candidate destination must be outside its source inputs")
    if not (Path(webapp) / "index.html").is_file() or not (Path(dashboard) / "index.html").is_file():
        raise ValueError("Both native UI bundles must already be built")
    packaged_uv, uv_pin = stage_build_tool(uv, extension, destination)
    with tarfile.open(archive) as source:
        roots = {Path(m.name).parts[0] for m in source.getmembers() if m.name}
        if roots != {"hermes-agent-" + lock["version"].removeprefix("v")}:
            raise ValueError("Unexpected archive root")
        source.extractall(destination, filter="data")
    (destination / roots.pop()).rename(destination / "hermes")
    shutil.copytree(extension, destination / "extension", ignore=shutil.ignore_patterns("__pycache__", ".pytest_cache", ".git", "node_modules"))
    restore_guard = apply_restore_guard(destination / "hermes", destination / "extension")
    memory_patch = apply_native_patch(destination / "hermes", destination / "extension",
        Path("deploy/patches/hermes-memory-owner-review.patch"),
        ("tools/memory_tool.py", "tools/write_approval.py", "hermes_cli/write_approval_commands.py",
         "agent/learning_mutations.py", "hermes_cli/main_agent_cmds.py", "hermes_cli/web_routers/ops.py",
         "hermes_cli/web_routers/files.py", "hermes_cli/profiles.py"))
    skill_path_patch = apply_native_patch(destination / "hermes", destination / "extension",
                                         Path("deploy/patches/hermes-sandbox-skill-path.patch"),
                                         ("agent/skill_commands.py",))
    attachment_patch = apply_native_patch(destination / "hermes", destination / "extension",
                                          Path("deploy/patches/hermes-attachment-tool-path.patch"),
                                          ("agent/context_references.py",))
    interrupt_patch = apply_native_patch(destination / "hermes", destination / "extension",
                                         Path("deploy/patches/hermes-remote-terminal-interrupt.patch"),
                                         ("tools/terminal_tool_result.py", "agent/replay_cleanup.py",
                                          "tools/terminal_tool.py", "locales/en.yaml"))
    notice_patch = apply_native_patch(destination / "hermes", destination / "extension",
                                      Path("deploy/patches/hermes-remote-terminal-notice.patch"),
                                      ("agent/message_sanitization.py",))
    skill_stage_patch = apply_native_patch(destination / "hermes", destination / "extension",
        Path("deploy/patches/hermes-skill-stage-applicability.patch"),
        ("tools/skill_manager_tool.py", "tools/skill_manager_batch.py"))
    memory_delivery_patch = apply_native_patch(destination / "hermes", destination / "extension",
        Path("deploy/patches/hermes-owner-memory-delivery.patch"),
        ("agent/conversation_loop.py", "agent/history_commentary.py", "agent/stream_delivery.py", "agent/turn_finalizer.py",
         "gateway/run_turn_runner.py", "tui_gateway/prompt_turn.py"))
    webapp_patch = apply_native_patch(destination / "hermes", destination / "extension", WEBAPP_PATCH, WEBAPP_TARGETS)
    stage_webapp(webapp, destination / "webapp", destination / "extension/deploy/webapp/members.json")
    shutil.copytree(dashboard, destination / "dashboard")
    spec = importlib.util.spec_from_file_location("sparkie_package_plugins", extension / "tools/package_plugins.py")
    packaging = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(packaging)
    packaging.prepare_bundle(destination / "hermes/plugins", destination / "bundled-plugins", extension / "plugin")
    if (extension / "src/sparkie_sparks/workspace_remote.py").is_file():
        with tempfile.TemporaryDirectory(prefix="sparkie-worker-") as temporary:
            worker = Path(temporary)
            shutil.copytree(extension / "src/sparkie_sparks", worker / "sparkie_sparks",
                            ignore=shutil.ignore_patterns("__pycache__"))
            (worker / "__main__.py").write_text(
                "from sparkie_sparks.workspace_remote import main\nraise SystemExit(main())\n")
            zipapp.create_archive(worker, destination / "workspace-worker.pyz", compressed=True)
    # Root-owned releases must not share writable dependency inodes with the
    # operator's uv cache when ownership is sealed after preparation.
    build_env = {**os.environ, "UV_PYTHON_DOWNLOADS": "never", "UV_LINK_MODE": "copy",
                 "UV_COMPILE_BYTECODE": "false", "PYTHONDONTWRITEBYTECODE": "1"}
    command = [str(packaged_uv), "sync", "--frozen", "--python", str(python), "--no-dev"]
    for extra in lock["extras"]:
        command += ["--extra", extra]
    subprocess.run(command, cwd=destination / "hermes", env=build_env, check=True)
    runtime = destination / "hermes/.venv/bin/python"
    install_structured_validator(packaged_uv, destination / "hermes", runtime, build_env)
    # Hermes's generated systemd launcher uses Python -I and discards
    # PYTHONPATH. Install only the sealed extension's absolute import path
    # into this candidate's own site-packages.
    site_packages = Path(subprocess.run(
        [str(runtime), "-I", "-B", "-c", "import sysconfig; print(sysconfig.get_path('purelib'))"],
        capture_output=True, text=True, check=True,
    ).stdout.strip())
    if not site_packages.is_relative_to(runtime.parent.parent):
        raise ValueError("The candidate extension must use the sealed virtualenv.")
    (site_packages / "sparkie-extension.pth").write_text(str(destination / "extension/src") + "\n")
    # The native writer supports named external stewards. Its CLI choices only
    # list upstream distributions, so call the same native write function with
    # our honest distribution name; do not impersonate Docker/Nix or fork it.
    subprocess.run([str(runtime), "-B", "-c",
                    "from scripts.write_install_stamp import write_stamp; import sys; "
                    "write_stamp('install-stamp.json', commit=sys.argv[1], base_version=sys.argv[2], "
                    "distance=0, source='local', distribution='sparkie', update_mechanism='external')",
                    commit, lock["version"].removeprefix("v")], cwd=destination / "hermes", check=True)
    base_root = Path(python).resolve().parent.parent
    base_files, base_links = inventory(base_root)
    release_files, release_links = inventory(destination, release=True)
    manifest = {
        "schema": 1, "status": "development-candidate-not-approved-for-live-use",
        "upstream": lock, "model": json.loads((extension / "models/main-model.json").read_text()),
        "build_tools": {"uv": uv_pin},
        "native_patches": [restore_guard, memory_patch, skill_path_patch, attachment_patch, interrupt_patch, notice_patch,
                           skill_stage_patch, webapp_patch, memory_delivery_patch],
        "runtime": {"python": str(runtime), "base_python": str(Path(python).resolve()),
                    "base_python_sha256": sha(Path(python).resolve()),
                    'base_root': str(base_root),
                    'base_files': base_files,
                    'base_symlinks': base_links,
                    "relocatable": False, "instruction": "Rebuild with uv at the final release path; do not move this virtualenv"},
        "files": release_files,
        "symlinks": release_links,
    }
    (destination / "candidate.json").write_text(json.dumps(manifest, indent=2) + "\n")
    verify(destination)
    return sha(destination / "candidate.json")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    check = sub.add_parser("verify")
    check.add_argument("candidate", type=Path)
    build = sub.add_parser("prepare")
    for flag in ("archive", "destination", "webapp", "dashboard", "uv", "python"):
        build.add_argument("--" + flag, type=Path, required=True)
    build.add_argument("--extension", type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    if args.command == "verify":
        verify(args.candidate)
        print(sha(args.candidate / "candidate.json"))
    else:
        print(prepare(args.archive, args.destination, args.webapp, args.dashboard,
                      uv=args.uv, python=args.python, extension=args.extension))

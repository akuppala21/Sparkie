"""Rebuild the pinned browser renderer into a new directory with upstream tooling."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

KIT = Path(__file__).resolve().parent
REFERENCE = "cf2671eb38ea4d06789e81e06d5648d946c82229f3ee90db912cc7f287a72373"
CORRECTED = "be406d73e90ab7fa2d980e6dfdec6f257508f6445faf57019985f7f1f2f7f248"
WITH_SPARKS = "cb395b8ffdcab6358fb191ff1807a3e700d6d6486ca656e67422f70ad6235770"
CONTROL_OUTPUT = "447cbd194f91106dc301c37abd7ba0a14322284a98a9afab1eaad708e6591d58"
RAW_OUTPUT = "6381b77c14dc14775e5094e4ed11807fdfa30c2d63dfe5dd3e3a3ee0ab4291f8"
SERVED_OUTPUT = "235b2a54a334e1d74cb4250f1989abd4e80918ea643171d6e5a78d61a90e6920"
SPARKS_RAW_OUTPUT = "73a84f0dd5318d9efb778007a2859518f4413c5339ff0eff842df7d075109839"
SPARKS_SERVED_OUTPUT = "c1dfaf84f3440bb1662fee8c5ee6baac0352cfff3c8e4c1c831355f9b94014e4"


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def node(root, script, *arguments, retain=False):
    command = ["node"]
    if retain:
        command.append("--import=" + str(KIT / "retain-stylesheet.mjs"))
    command.extend(["--input-type=module", "-e", script, *map(str, arguments)])
    subprocess.run(command, cwd=root, check=True)


def compile_webapp(source, output, expected, retain):
    node(source, """
        import { buildWebapp } from './scripts/build/webapp.mjs'
        import { outputIntact } from './scripts/build/freshness.mjs'
        const out = process.argv[1]
        await buildWebapp({ source: process.cwd(), workspace: process.cwd() + '/.build/webapp-workspace', out })
        if (!outputIntact(out, 'webapp')) throw Error('Upstream Webapp output validation failed')
    """, output, retain=retain)
    receipt = json.loads((output / "hermes-build.json").read_text())
    require(receipt["outputHash"] == expected, "Unexpected compiler output in " + str(output))


def build(upstream, destination):
    require(subprocess.check_output(["node", "-p", "process.platform+'/'+process.arch+'/'+process.versions.node"],
                                    text=True).strip() == "linux/arm64/26.12.1", "Use Linux ARM64 Node 26.12.1")
    require(subprocess.check_output(["sh", "-c", "pnpm --version"], text=True).strip() == "12.15.0", "Use pnpm 12.15.0")
    require(not upstream.is_relative_to(destination) and not destination.is_relative_to(upstream),
            "The build directory and upstream source must be separate trees")
    destination.mkdir(parents=True, exist_ok=False)
    source = destination / "source"
    source.mkdir()
    node(upstream, """
        import { sourceHash } from './scripts/build/freshness.mjs'
        import { mirrorWebappInputs } from './apps/desktop/scripts/build-webapp.mjs'
        if (sourceHash(process.cwd(), 'webapp') !== process.argv[2]) throw Error('Incorrect upstream sources')
        mirrorWebappInputs(process.cwd(), process.argv[1])
    """, source, REFERENCE)
    shutil.copytree(upstream / "scripts/build", source / "scripts/build", dirs_exist_ok=True)
    environment = {**os.environ, "HUSKY": "0", "ELECTRON_SKIP_BINARY_DOWNLOAD": "1", "CI": "true"}

    def prepare(expected):
        subprocess.run(["node", "apps/desktop/scripts/build-webapp.mjs", "--deps-only"], cwd=source,
                       check=True, env=environment)
        node(source, """
            import { sourceHash } from './scripts/build/freshness.mjs'
            const expected = process.argv[1]
            if ([process.cwd(), process.cwd() + '/.build/webapp-workspace'].some(p => sourceHash(p,'webapp') !== expected)) {
              throw Error('Incorrect checkout or prepared source')
            }
        """, expected)

    prepare(REFERENCE)
    compile_webapp(source, destination / "control", CONTROL_OUTPUT, True)
    stamps = json.loads((KIT / "hermes-webapp-first-slash.json").read_text())
    patch = KIT / "hermes-webapp-first-slash.patch"
    require(sha(patch) == stamps["patch_sha256"], "Wrong source patch")
    manifest = stamps["files"]
    for name, hashes in manifest.items():
        require(sha(source / name) == hashes["before_sha256"], "Incorrect source before patch: " + name)
    subprocess.run(["git", "apply", "--check", str(patch)], cwd=source, check=True)
    subprocess.run(["git", "apply", str(patch)], cwd=source, check=True)
    for name, hashes in manifest.items():
        require(sha(source / name) == hashes["after_sha256"], "Incorrect patched source: " + name)
    prepare(CORRECTED)
    compile_webapp(source, destination / "first-slash-ordinary", RAW_OUTPUT, False)
    compile_webapp(source, destination / "first-slash", SERVED_OUTPUT, True)
    subprocess.run([sys.executable, "-IB", str(KIT / "plugin_sources.py"), str(source)], check=True)
    prepare(WITH_SPARKS)
    compile_webapp(source, destination / "ordinary", SPARKS_RAW_OUTPUT, False)
    served = destination / "webapp"
    compile_webapp(source, served, SPARKS_SERVED_OUTPUT, True)
    members = list(served.rglob("*"))
    require(not any(f.is_symlink() for f in members), "Unexpected symlink in Webapp")
    measured = {str(f.relative_to(served)): sha(f) for f in members if f.is_file()}
    require(measured == json.loads((KIT / "members.json").read_text()), "Served asset inventory differs")
    print(f"Verified {len(measured)} files in {served}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("upstream", type=Path)
    parser.add_argument("new_build_directory", type=Path)
    args = parser.parse_args()
    build(args.upstream.resolve(), args.new_build_directory.resolve())

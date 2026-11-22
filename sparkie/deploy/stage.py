"""Run the native gateway in a fresh loopback-only development home; no bot."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import shutil

from candidate import verify, sha


def environment(candidate, home):
    # Do not inherit provider credentials, Telegram settings or another home.
    env = {key: os.environ[key] for key in ("HOME", "USER", "LOGNAME", "LANG", "TZ") if key in os.environ}
    env.update({
        "PATH": "/usr/local/bin:/usr/bin:/bin", "HERMES_HOME": str(home),
        "HERMES_BUNDLED_PLUGINS": str(candidate / "bundled-plugins"),
        "HERMES_WEBAPP_DIST": str(candidate / "webapp"),
        "HERMES_WEB_DIST": str(candidate / "dashboard"),
        "PYTHONPATH": str(candidate / "extension/src") + ":" + str(candidate / "hermes"),
        "PYTHONDONTWRITEBYTECODE": "1", "HERMES_DISABLE_LAZY_INSTALLS": "1",
        "HERMES_ENABLE_PROJECT_PLUGINS": "0", "OPENAI_API_KEY": "local-unused",
    })
    return env


def prepare_home(candidate, home, port):
    from ruamel.yaml import YAML
    verify(candidate)
    if not 1024 <= port <= 65535:
        raise ValueError("Use an unprivileged loopback staging port")
    if home.exists():
        raise FileExistsError("Staging needs a fresh home; never reuse live assistant state")
    if home.is_relative_to(candidate):
        raise ValueError("Mutable state must stay outside the sealed candidate")
    home.mkdir(parents=True, mode=0o700)
    yaml = YAML()
    config = yaml.load(candidate / "extension/config/hermes.example.yaml")
    theme = candidate / "extension/themes/sparkie.yaml"
    if theme.is_file():
        (home / "dashboard-themes").mkdir()
        shutil.copyfile(theme, home / "dashboard-themes" / theme.name)
        config.setdefault("dashboard", {}).setdefault("theme", "sparkie")
    config["webapp"] = {"enabled": True, "host": "127.0.0.1", "port": port, "public_url": ""}
    config.setdefault("plugins", {})["auto_apply"] = False
    # Fresh home plus scrubbed environment ensure no real platform credentials.
    config["platforms"] = {"telegram": {"enabled": False}}
    with (home / "config.yaml").open("w") as stream:
        yaml.dump(config, stream)
    shutil.copyfile(candidate / "extension/SOUL.md", home / "SOUL.md")
    (home / "sparkie-staging.json").write_text(json.dumps({
        "schema": 1, "candidate_sha256": sha(candidate / "candidate.json"),
        "soul_sha256": sha(home / "SOUL.md"),
        "loopback_port": port, "real_platform_credentials": False,
    }, indent=2) + "\n")


def run(candidate, home):
    verify(candidate)
    marker = json.loads((home / "sparkie-staging.json").read_text())
    if marker["candidate_sha256"] != sha(candidate / "candidate.json"):
        raise ValueError("The staging home belongs to a different candidate")
    if marker["soul_sha256"] != sha(home / "SOUL.md"):
        raise ValueError("The staging identity changed; qualify the new instructions")
    from ruamel.yaml import YAML
    config = YAML(typ="safe").load(home / "config.yaml")
    webapp = config.get("webapp", {})
    if webapp != {"enabled": True, "host": "127.0.0.1", "port": marker["loopback_port"], "public_url": ""}:
        raise ValueError("The development launcher only serves its recorded loopback address")
    if (home / ".env").exists() or (home / "auth.json").exists():
        raise ValueError("The development launcher refuses enrolled credentials; use the reviewed live service")
    os.chdir(candidate / "hermes")
    python = candidate / "hermes/.venv/bin/python"
    os.execve(python, [str(python), "-m", "hermes_cli.main", "gateway", "run", "--external-supervisor"], environment(candidate, home))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["prepare-home", "run"])
    parser.add_argument("--candidate", type=Path, required=True)
    parser.add_argument("--home", type=Path, required=True)
    parser.add_argument("--port", type=int, default=32129)
    args = parser.parse_args()
    candidate, home = args.candidate.resolve(), args.home.resolve()
    if args.command == "prepare-home":
        prepare_home(candidate, home, args.port)
        print(f"Prepared isolated native gateway at http://127.0.0.1:{args.port}")
    else:
        run(candidate, home)

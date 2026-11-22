"""Render Hermes's native systemd lifecycle plus a candidate environment; never install."""
import argparse
import os
from pathlib import Path
import re

from candidate import verify


def _literal(value):
    value = str(value)
    if not value or any(c in value for c in '\n\r"\\%$'):
        raise ValueError("Unsupported service path or setting")
    return '"' + value + '"'


def render(candidate, home, user):
    verify(candidate)
    from hermes_cli import gateway
    # This script runs with the candidate's own interpreter and source path.
    if Path(gateway.PROJECT_ROOT).resolve() != (candidate / "hermes").resolve():
        raise ValueError("Render with the candidate's own Hermes runtime")
    for value in (home, candidate, user):
        _literal(value)
    os.environ["HERMES_HOME"] = str(home)
    native = gateway.generate_systemd_unit(system=True, run_as_user=user)
    environment = {
        "HERMES_BUNDLED_PLUGINS": candidate / "bundled-plugins",
        # Native generation preserves wrapper/previous-unit pointers. Clear
        # optional overrides so those resources resolve from this source tree.
        "HERMES_BUNDLED_SKILLS": "", "HERMES_BUNDLED_LOCALES": "",
        "HERMES_OPTIONAL_SKILLS": "", "HERMES_TUI_DIR": "",
        "HERMES_WEBAPP_DIST": candidate / "webapp", "HERMES_WEB_DIST": candidate / "dashboard",
        "PYTHONPATH": str(candidate / "extension/src") + ":" + str(candidate / "hermes"),
        "PYTHONDONTWRITEBYTECODE": "1", "HERMES_DISABLE_LAZY_INSTALLS": "1",
        "HERMES_ENABLE_PROJECT_PLUGINS": "0",
        "HERMES_MANAGED_DIR": home / "managed", "HERMES_CONFIG_BACKEND": "file",
        "HERMES_ACCEPT_HOOKS": "0",
    }
    supplement = "\n[Service]\n" + "\n".join(f'Environment="{key}={value}"' for key, value in environment.items())
    supplement += "\n# Owner subject/client and bot token come from the reviewed root-owned environment file.\n"
    supplement += "# Native managed policy and executable roots stay protected; native preferences stay writable.\n"
    supplement += "ExecStartPre=" + " ".join(map(_literal, (
        candidate / "hermes/.venv/bin/python", candidate / "extension/deploy/managed_config.py",
        "--home", home))) + "\n"
    supplement += "NoNewPrivileges=yes\nUMask=0077\n"
    return native + supplement


def render_collector(candidate, *, user, inventory, output, plugs, energy_database, control_socket):
    """One bounded collection pass. The system timer supplies cadence, not an agent."""
    verify(candidate)
    if not re.fullmatch(r"[a-z_][a-z0-9_-]{0,31}", user):
        raise ValueError("Use the configured trusted application account")
    command = [candidate / "hermes/.venv/bin/python", "-m", "sparkie_sparks.collector",
               "--inventory", inventory, "--output", output, "--plugs", plugs,
               "--energy-database", energy_database, "--control-socket", control_socket]
    for path in (inventory, output, plugs, energy_database, control_socket):
        if not Path(path).is_absolute():
            raise ValueError("Collector configuration and state paths must be absolute")
    return "\n".join([
        "[Unit]", "Description=Sparkie fleet and electricity observations",
        "After=network-online.target", "Wants=network-online.target", "", "[Service]",
        "Type=oneshot", f"User={user}", "ExecStart=" + " ".join(map(_literal, command)),
        "Environment=" + _literal("PYTHONPATH=" + str(candidate / "extension/src")),
        'Environment="PYTHONDONTWRITEBYTECODE=1"', "NoNewPrivileges=yes", "UMask=0077",
        # Collection plus the controller's 240-second bounded maintenance call.
        "TimeoutStartSec=300", "",
    ])


def render_collector_timer():
    return "\n".join([
        "[Unit]", "Description=Refresh Sparkie observations and checked idle maintenance", "",
        "[Timer]", "OnBootSec=30s", "OnUnitInactiveSec=60s", "AccuracySec=5s",
        "Unit=sparkie-collector.service", "", "[Install]", "WantedBy=timers.target", "",
    ])


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--candidate", type=Path, required=True)
    parser.add_argument("--home", type=Path, required=True)
    parser.add_argument("--user", required=True)
    parser.add_argument("--kind", choices=["gateway", "collector-service", "collector-timer"], default="gateway")
    for option in ("inventory", "output", "plugs", "energy-database", "control-socket"):
        parser.add_argument("--" + option, type=Path)
    args = parser.parse_args()
    if args.kind == "gateway":
        result = render(args.candidate.resolve(), args.home.resolve(), args.user)
    elif args.kind == "collector-timer":
        result = render_collector_timer()
    else:
        values = {key: getattr(args, key) for key in ("inventory", "output", "plugs", "energy_database", "control_socket")}
        if any(value is None for value in values.values()):
            parser.error("Collector service needs inventory, output, plugs, energy-database and control-socket")
        result = render_collector(args.candidate.resolve(), user=args.user, **values)
    print(result)

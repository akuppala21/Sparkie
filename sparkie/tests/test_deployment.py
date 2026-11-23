"""Prepared-package checks on a compute Spark; no live service or bot changes."""
import json
import getpass
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request

import pytest

pytestmark = pytest.mark.integration
DEPLOY = Path(__file__).resolve().parents[1] / "deploy"


def test_candidate_uses_an_independent_copy_of_the_exact_build_tool(tmp_path, monkeypatch):
    monkeypatch.syspath_prepend(str(DEPLOY))
    import candidate
    extension, destination = tmp_path/'extension', tmp_path/'release'
    (extension/'deploy').mkdir(parents=True)
    supplied = tmp_path/'uv'
    supplied.write_bytes(b'reviewed executable fixture')
    pin = {'path':'tools/uv','platform':'test','version':'test','sha256':candidate.sha(supplied)}
    (extension/'deploy/build-tools.json').write_text(json.dumps({'uv':pin}))
    bundled, recorded = candidate.stage_build_tool(supplied, extension, destination)
    assert recorded == pin and bundled == destination/'tools/uv' and os.access(bundled,os.X_OK)
    supplied.write_bytes(b'replaced builder')
    assert candidate.sha(bundled) == pin['sha256']
    with pytest.raises(ValueError,match='reviewed uv binary'):
        candidate.stage_build_tool(supplied, extension, tmp_path/'another-release')
    assert not (tmp_path/'another-release').exists()


@pytest.fixture(scope="module")
def prepared():
    location = os.environ.get("SPARKIE_TEST_CANDIDATE")
    if not location:
        pytest.skip("Prepare a compute-Spark candidate and set SPARKIE_TEST_CANDIDATE")
    sys.path.insert(0, str(DEPLOY))
    import candidate
    import stage
    root = Path(location).resolve(strict=True)
    candidate.verify(root)
    yield root, candidate, stage
    sys.path.remove(str(DEPLOY))


def test_stage_environment_cannot_inherit_cloud_or_bot_credentials(prepared, monkeypatch, tmp_path):
    root, _, stage = prepared
    for name in ("TELEGRAM_BOT_TOKEN", "ANTHROPIC_API_KEY", "HERMES_DASHBOARD_OAUTH_CLIENT_ID", "SPARKIE_WEB_OWNER_SUBJECT"):
        monkeypatch.setenv(name, "fixture-secret")
    env = stage.environment(root, tmp_path / "home")
    assert not any(value == "fixture-secret" for value in env.values())
    assert env["HERMES_ENABLE_PROJECT_PLUGINS"] == "0"
    assert Path(env["HERMES_BUNDLED_PLUGINS"]) == root / "bundled-plugins"


def test_packaged_native_version_and_update_refusal(prepared, tmp_path):
    root, _, stage = prepared
    script = """import json
from pathlib import Path
from hermes_cli.update_contract import evaluate_update_admission
stamp=json.loads(Path('install-stamp.json').read_text())
refusal=evaluate_update_admission(Path.cwd())
assert stamp['baseVersion']=='0.23.2'
assert stamp['commit']=='ae2a81ccc00e9b7c06301523e5bb09608397149c'
assert stamp['distribution']=='sparkie'
assert refusal is not None, 'Sealed candidate allowed in-place native update'
print(json.dumps({'version':stamp['baseVersion'],'update_refused':True}))
"""
    result = subprocess.run([str(root / "hermes/.venv/bin/python"), "-c", script], cwd=root / "hermes",
        env=stage.environment(root, tmp_path / "home"), capture_output=True, text=True, timeout=30, check=True)
    assert json.loads(result.stdout.splitlines()[-1])["update_refused"] is True


@pytest.mark.parametrize(('patch_name', 'targets'), [
    ('hermes-sealed-web-restore.patch', {'hermes_cli/web_routers/ops.py', 'hermes_cli/web_routers/transfer.py'}),
    ('hermes-sandbox-skill-path.patch', {'agent/skill_commands.py'}),
    ('hermes-attachment-tool-path.patch', {'agent/context_references.py'}),
    ('hermes-remote-terminal-notice.patch', {'agent/message_sanitization.py'}),
    ('hermes-remote-terminal-interrupt.patch', {'tools/terminal_tool_result.py', 'agent/replay_cleanup.py',
                                                'tools/terminal_tool.py', 'locales/en.yaml'}),
])
def test_reviewed_patch_provenance_matches_installed_targets(prepared, patch_name, targets):
    root, candidate, _ = prepared
    manifest = json.loads((root / "candidate.json").read_text())
    records = manifest["native_patches"]
    assert [record["patch"] for record in records] == [
        "extension/deploy/patches/hermes-sealed-web-restore.patch",
        "extension/deploy/patches/hermes-sandbox-skill-path.patch",
        "extension/deploy/patches/hermes-attachment-tool-path.patch",
        "extension/deploy/patches/hermes-remote-terminal-interrupt.patch",
        "extension/deploy/patches/hermes-remote-terminal-notice.patch",
    ]
    applied, = [record for record in records if Path(record["patch"]).name == patch_name]
    assert set(applied["patched_files"]) == targets
    patch = root / applied["patch"]
    reviewed = json.loads(patch.with_suffix(".json").read_text())
    assert applied["sha256"] == reviewed["patch_sha256"] == candidate.sha(patch)
    assert applied["upstream_files"] == {k: v["before_sha256"] for k, v in reviewed["files"].items()}
    for name, digest in applied["patched_files"].items():
        assert digest == reviewed["files"][name]["after_sha256"] == candidate.sha(root / "hermes" / name)
    assert set(applied["patched_files"]) == set(reviewed["files"])


def test_restore_patch_refuses_a_previously_patched_source(prepared, tmp_path):
    root, candidate, _ = prepared
    routers = [tmp_path / name for name in candidate.RESTORE_ROUTERS]
    for name, router in zip(candidate.RESTORE_ROUTERS, routers):
        router.parent.mkdir(parents=True, exist_ok=True)
        router.write_bytes((root / "hermes" / name).read_bytes())
    before = [candidate.sha(router) for router in routers]
    with pytest.raises(ValueError, match="reviewed upstream files"):
        candidate.apply_restore_guard(tmp_path, root / "extension")
    assert [candidate.sha(router) for router in routers] == before


def test_packaged_plugin_imports_timezone_and_registers_owner(prepared, tmp_path):
    root, _, stage = prepared
    home = tmp_path / 'owner-import-home'
    stage.prepare_home(root, home, 32129)
    env = stage.environment(root, home)
    env.update(SPARKIE_WEB_OWNER_SUBJECT='fixture-owner',
               HERMES_DASHBOARD_OAUTH_CLIENT_ID='agent:fixture-no-login',
               HERMES_DASHBOARD_PUBLIC_URL='https://fixture.example.test')
    script = """import json
import os
from pathlib import Path
import sys
os.environ.pop('PYTHONPATH', None)
sys.path.insert(0, str(Path.cwd()))
from zoneinfo import ZoneInfo
from sparkie_sparks import energy
assert ZoneInfo('America/Los_Angeles').key == 'America/Los_Angeles'
from hermes_cli.plugins import discover_plugins, get_pre_tool_call_block_message
discover_plugins()
assert get_pre_tool_call_block_message('memory', {'action':'remove','old_text':'fixture'})
assert get_pre_tool_call_block_message('memory', {'action':'patch','old_text':'fixture','content':'corrected'}) is None
from hermes_cli.dashboard_auth.registry import get_provider
from sparkie_sparks.owner_login import OwnerNousProvider
provider=get_provider('sparkie-owner')
assert isinstance(provider, OwnerNousProvider), 'Plugin manifest discovery did not register owner authentication'
assert provider._owner_subject == 'fixture-owner'
assert get_provider('nous') is None, 'Stock sign-in bypassed the owner wrapper'
print(json.dumps({'timezone_import':True,'owner_provider_registered':True,'stock_provider_absent':True}))
"""
    result = subprocess.run([str(root / 'hermes/.venv/bin/python'), '-I', '-c', script],
        cwd=root / 'hermes', env=env, capture_output=True, text=True, timeout=30)
    assert result.returncode == 0, result.stderr[-5000:]
    assert json.loads(result.stdout.splitlines()[-1]) == {
        'timezone_import': True, 'owner_provider_registered': True, 'stock_provider_absent': True}


def test_stage_rejects_reusing_owner_state_and_changed_public_binding(prepared, tmp_path):
    root, _, stage = prepared
    home = tmp_path / "fresh"
    stage.prepare_home(root, home, 32129)
    assert (home / "SOUL.md").read_bytes() == (root / "extension/SOUL.md").read_bytes()
    with pytest.raises(FileExistsError):
        stage.prepare_home(root, home, 32129)
    from ruamel.yaml import YAML
    yaml = YAML()
    config = yaml.load(home / "config.yaml")
    config["webapp"]["public_url"] = "https://public.example.test"
    with (home / "config.yaml").open("w") as stream:
        yaml.dump(config, stream)
    with pytest.raises(ValueError, match="recorded loopback"):
        stage.run(root, home)


def test_stage_rejects_changed_identity(prepared, tmp_path):
    root, _, stage = prepared
    home = tmp_path / "fresh"
    stage.prepare_home(root, home, 32129)
    (home / "SOUL.md").write_text("Unqualified replacement instructions")
    with pytest.raises(ValueError, match="staging identity changed"):
        stage.run(root, home)


def test_native_service_and_collector_units_validate_without_installing(prepared, tmp_path):
    root, _, stage = prepared
    home = tmp_path / "service-home"
    home.mkdir()
    common = [str(root / "hermes/.venv/bin/python"), str(DEPLOY / "service_unit.py"),
              "--candidate", str(root), "--home", str(home), "--user", getpass.getuser()]
    env = stage.environment(root, home)
    env["HERMES_BUNDLED_SKILLS"] = "/unreviewed/previous-install/skills"
    gateway = subprocess.run(common, cwd=root / "hermes", env=env, capture_output=True,
                             text=True, check=True, timeout=30).stdout
    assert "gateway.systemd_stop_mark" in gateway
    assert "gateway.cgroup_cleanup" in gateway
    assert "NoNewPrivileges=yes" in gateway
    assert 'Environment="HERMES_HOME=' + str(home) + '"' in gateway
    assert gateway.rfind('Environment="HERMES_BUNDLED_SKILLS="') > gateway.find("/unreviewed/previous-install/skills")
    paths = [tmp_path / name for name in ("inventory.json", "fleet.json", "plugs.json", "energy.sqlite", "control.sock")]
    collector_args = [item for key, value in zip(("inventory", "output", "plugs", "energy-database", "control-socket"), paths)
                      for item in ("--" + key, str(value))]
    collector = subprocess.run(common + ["--kind", "collector-service"] + collector_args,
        cwd=root / "hermes", env=env, capture_output=True, text=True, check=True, timeout=30).stdout
    timer = subprocess.run(common + ["--kind", "collector-timer"], cwd=root / "hermes", env=env,
        capture_output=True, text=True, check=True, timeout=30).stdout
    units = {"sparkie-gateway.service": gateway, "sparkie-collector.service": collector, "sparkie-collector.timer": timer}
    for name, body in units.items():
        (tmp_path / name).write_text(body)
    result = subprocess.run(["systemd-analyze", "verify", *(str(tmp_path / name) for name in units)],
        capture_output=True, text=True, timeout=30)
    assert result.returncode == 0, result.stderr


def test_native_gateway_starts_serves_webapp_and_plugins_and_stops_cleanly(prepared, tmp_path):
    root, _, stage = prepared
    home = tmp_path / "gateway-home"
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    stage.prepare_home(root, home, port)
    log = tmp_path / "gateway.log"
    with log.open("w") as output:
        process = subprocess.Popen([str(root / "hermes/.venv/bin/python"), str(DEPLOY / "stage.py"), "run",
            "--candidate", str(root), "--home", str(home)], stdout=output, stderr=subprocess.STDOUT,
            start_new_session=True)
    try:
        base = f"http://127.0.0.1:{port}"
        deadline = time.monotonic() + 60
        status = None
        while time.monotonic() < deadline:
            assert process.poll() is None, log.read_text()[-5000:]
            try:
                with urllib.request.urlopen(base + "/api/status", timeout=1) as response:
                    status = json.load(response)
                break
            except (OSError, urllib.error.URLError):
                time.sleep(0.2)
        assert status is not None, log.read_text()[-5000:]
        assert "0.23.2" in str(status["version"]), status
        token_path = home / "webapp/session-token"
        assert token_path.is_file()
        token = token_path.read_text().strip()
        request = urllib.request.Request(base + "/api/config", headers={"Authorization": "Bearer " + token})
        with urllib.request.urlopen(request, timeout=5) as response:
            assert response.status == 200
        with urllib.request.urlopen(base + "/", timeout=5) as response:
            assert response.status == 200
            assert b"<html" in response.read().lower()
        with urllib.request.urlopen(base + "/api/dashboard/plugins", timeout=5) as response:
            assert b"sparkie-sparks" in response.read()
        assert not (home / "auth.json").exists()
        assert not (home / ".env").exists()
    finally:
        if process.poll() is None:
            # Match native systemd ExecStop: an unmarked SIGTERM deliberately
            # reports unexpected termination, even after a healthy startup.
            subprocess.run([str(root / "hermes/.venv/bin/python"), "-m", "gateway.systemd_stop_mark", str(process.pid)],
                cwd=root / "hermes", env=stage.environment(root, home), check=True, timeout=10)
            process.send_signal(signal.SIGTERM)
        try:
            process.wait(timeout=35)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait(timeout=5)
            pytest.fail("Native gateway failed its graceful stop budget")
    assert process.returncode == 0, log.read_text()[-5000:]
    _, candidate, _ = prepared
    candidate.verify(root)

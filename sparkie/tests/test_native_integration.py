"""Run in pinned Hermes's environment; this checks registration and adapter parity.

This does not establish live authentication, browser rendering or model behavior.
"""

from datetime import datetime, timezone
import importlib.util
import json
from pathlib import Path
import shutil

import pytest

pytestmark = pytest.mark.integration
PLUGIN = Path(__file__).resolve().parents[1] / "plugin"


def test_real_hermes_registration_and_dashboard_return_same_observation(tmp_path, monkeypatch):
    from hermes_cli.plugins import PluginManager
    from tools.registry import registry
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    home = tmp_path / "hermes"
    target = home / "plugins" / "sparkie-sparks"
    shutil.copytree(PLUGIN, target)
    (home / "config.yaml").write_text("plugins:\n  enabled:\n    - sparkie-sparks\n")
    snapshot = tmp_path / "fleet.json"
    snapshot.write_text(json.dumps({"schema": 1, "sparks": [{
        "id": "spark1", "state": "online", "observed_at": datetime.now(timezone.utc).isoformat()
    }]}))
    monkeypatch.setenv("HERMES_HOME", str(home))
    monkeypatch.setenv("SPARKIE_FLEET_SNAPSHOT", str(snapshot))
    manager = PluginManager(scope_key=str(home))
    manager.discover_and_load()
    entry = registry.get_entry("spark_fleet_status", scope=manager.scope_key)
    assert entry is not None, "Hermes did not register the extension tool"
    tool_result = json.loads(entry.handler({}))
    assert tool_result["available"] is True
    assert tool_result["sparks"][0]["host"] is True
    assert json.loads(entry.handler({"path": "/etc/passwd"}))["available"] is False

    spec = importlib.util.spec_from_file_location("sparkie_dashboard_test", target / "dashboard" / "plugin_api.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    app = FastAPI()
    app.include_router(module.router, prefix="/api/plugins/sparkie-sparks")
    with TestClient(app) as client:
        response = client.get("/api/plugins/sparkie-sparks/fleet")
        assert response.status_code == 200
        assert response.json() == tool_result
        assert client.post("/api/plugins/sparkie-sparks/fleet").status_code == 405

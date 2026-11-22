import importlib.util
from pathlib import Path
import shutil

import pytest

pytestmark = pytest.mark.integration
ROOT = Path(__file__).resolve().parents[1]


def test_packaged_home_override_shares_the_panel_but_has_no_api(tmp_path):
    from hermes_cli.web_server_dashboard import _discover_dashboard_plugins

    spec = importlib.util.spec_from_file_location("sparkie_package_plugins", ROOT / "tools/package_plugins.py")
    packaging = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(packaging)
    upstream = tmp_path / "upstream"
    upstream.mkdir()
    bundle = packaging.prepare_bundle(upstream, tmp_path / "bundle", ROOT / "plugin")
    entries = {plugin["name"]: plugin for plugin in _discover_dashboard_plugins([(bundle, "bundled")])}
    home, sparks = entries["sparkie-home"], entries["sparkie-sparks"]
    assert home["tab"]["override"] == "/"
    assert home["tab"]["path"] == "/sparkie-home"
    assert sparks["tab"]["path"] == "/sparks" and not sparks["tab"].get("hidden")
    assert sparks["has_api"] and not home["has_api"]
    assert (Path(home["_dir"]) / home["entry"]).read_bytes() == (Path(sparks["_dir"]) / sparks["entry"]).read_bytes()
    recipes = entries["sparkie-recipes"]
    assert recipes["tab"]["path"] == "/recipes" and recipes["has_api"]


def test_sparkie_theme_survives_native_discovery(tmp_path, monkeypatch):
    import hermes_yaml as yaml
    from hermes_cli import web_server_dashboard

    monkeypatch.setattr(web_server_dashboard, "get_process_hermes_home", lambda: tmp_path)
    themes = tmp_path / "dashboard-themes"
    themes.mkdir()
    theme = themes / "sparkie.yaml"
    shutil.copyfile(ROOT / "themes/sparkie.yaml", theme)
    source = yaml.safe_load(theme.read_text())
    [loaded] = web_server_dashboard._discover_user_themes()
    assert loaded["name"] == "sparkie" and loaded["layoutVariant"] == "standard"
    assert loaded["palette"]["background"] == {"hex": "#0b0c0e", "alpha": 1.0}
    assert loaded["colorOverrides"] == source["colorOverrides"]
    assert loaded["componentStyles"] == source["componentStyles"]

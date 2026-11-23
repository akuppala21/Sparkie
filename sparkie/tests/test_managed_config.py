"""Native preference persistence with exact managed runtime-policy precedence."""
import copy
import importlib.util
import json
from pathlib import Path

import pytest
from ruamel.yaml import YAML

pytestmark = pytest.mark.integration
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('sparkie_managed_config', ROOT / 'deploy/managed_config.py')
managed = importlib.util.module_from_spec(spec)
spec.loader.exec_module(managed)


def reviewed_config():
    return YAML(typ='safe').load(ROOT / 'config/hermes.example.yaml')


def test_split_preserves_exact_reviewed_policy_without_freezing_ordinary_preferences():
    config = reviewed_config()
    config['dashboard'] = {'theme': 'midnight', 'font': 'system-sans'}
    config['display'] = {'language': 'en', 'show_reasoning': True}
    original = copy.deepcopy(config)
    policy, preferences = managed.split(config)
    assert config == original
    for key in managed.POLICY_ROOTS:
        if key in original:
            assert policy[key] == original[key]
            assert key not in preferences
    assert preferences['dashboard'] == original['dashboard']
    assert preferences['display'] == original['display']
    assert preferences['memory']['memory_enabled'] is True
    assert 'provider' not in preferences['memory']
    assert policy['memory']['provider'] == ''
    assert policy['memory']['write_approval'] is True
    assert 'write_approval' not in preferences['memory']
    assert policy['hooks_auto_accept'] is False


@pytest.fixture
def native_home(tmp_path, monkeypatch):
    from hermes_cli import managed_scope
    home = tmp_path / 'home'
    home.mkdir()
    overlay = home / 'managed'
    overlay.mkdir()
    policy, preferences = managed.split(reviewed_config())
    preferences['dashboard'] = {'theme': 'default'}
    for path, doc in ((overlay / 'config.yaml', policy), (home / 'config.yaml', preferences)):
        with path.open('w') as stream:
            YAML().dump(doc, stream)
    monkeypatch.setenv('HERMES_HOME', str(home))
    monkeypatch.setenv('HERMES_MANAGED_DIR', str(overlay))
    monkeypatch.setenv('HERMES_CONFIG_BACKEND', 'file')
    monkeypatch.delenv('HERMES_MANAGED', raising=False)
    managed_scope.invalidate_managed_cache()
    yield home, policy
    managed_scope.invalidate_managed_cache()


def test_native_theme_and_font_routes_persist_in_user_file_with_policy_unchanged(native_home):
    from hermes_cli.web_routers.dashboard_ui import _set_dashboard_key
    from hermes_cli.config import load_config
    home, policy = native_home
    before = (home / 'managed/config.yaml').read_bytes()
    _set_dashboard_key('theme', 'midnight')
    _set_dashboard_key('font', 'system-sans')
    raw = YAML(typ='safe').load(home / 'config.yaml')
    assert raw['dashboard']['theme'] == 'midnight'
    assert raw['dashboard']['font'] == 'system-sans'
    assert (home / 'managed/config.yaml').read_bytes() == before
    effective = load_config()
    assert effective['dashboard']['theme'] == 'midnight'
    assert effective['terminal']['backend'] == 'spark_compute'
    assert effective['model']['base_url'] == 'http://127.0.0.1:32202/v1'
    assert effective['plugins']['enabled'] == policy['plugins']['enabled']


def test_native_bulk_save_cannot_replace_local_execution_identity_or_hook_policy(native_home):
    from hermes_cli.config import load_config, save_config
    home, policy = native_home
    change = load_config()
    change['terminal']['backend'] = 'local'
    change['model']['provider'] = 'openai'
    change['model']['base_url'] = 'https://api.example.invalid/v1'
    change['plugins']['enabled'] = ['unreviewed']
    change['hooks_auto_accept'] = True
    change['dashboard']['theme'] = 'rose'
    save_config(change)
    effective = load_config()
    assert effective['terminal']['backend'] == 'spark_compute'
    assert effective['model']['provider'] == 'custom:sparkie-local'
    assert effective['model']['base_url'] == policy['model']['base_url']
    assert effective['plugins']['enabled'] == policy['plugins']['enabled']
    assert effective['hooks_auto_accept'] is False
    assert effective['dashboard']['theme'] == 'rose'
    raw = YAML(typ='safe').load(home / 'config.yaml')
    # Native round-trip YAML may retain empty parents after stripping leaves.
    assert 'backend' not in raw.get('terminal', {})
    assert 'provider' not in raw.get('model', {}) and 'base_url' not in raw.get('model', {})
    assert 'hooks_auto_accept' not in raw


def test_notice_runtime_paths_must_match_the_same_reviewed_installation(tmp_path, monkeypatch):
    monkeypatch.syspath_prepend(str(ROOT / 'deploy'))
    import installation
    candidate = tmp_path / 'candidate'
    settings = {'candidate': str(candidate), 'home': '/var/lib/sparkie/hermes',
        **{key: str(tmp_path / (key + '.json')) for key in ('controller_config', 'inventory', 'plugs', 'environment')}}
    notices = {'home': settings['home'], 'environment': settings['environment'],
        'python': str(candidate / 'hermes/.venv/bin/python'), 'source': str(candidate / 'hermes')}
    controller = Path(settings['controller_config'])
    controller.write_text(json.dumps({'notifications': notices}))
    assert Path(settings['environment']) in installation.config_files(settings)
    notices['source'] = '/unreviewed/other-hermes'
    controller.write_text(json.dumps({'notifications': notices}))
    with pytest.raises(ValueError, match='same reviewed home'):
        installation.config_files(settings)

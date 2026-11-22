"""Focused lease validation and real Hermes provider/factory wiring."""
from dataclasses import replace
import shutil
from pathlib import Path

import pytest

pytestmark = pytest.mark.integration


@pytest.fixture
def configured(monkeypatch):
    from sparkie_sparks.sandbox_provider import ComputeNode, IdleObservation, SparkComputeProvider, WorkspaceLease
    from sparkie_sparks.sandbox_ssh import PinnedSandboxSSH
    calls = {'acquire': [], 'idle': [], 'ssh': [], 'cleanup': []}
    image = 'sha256:' + '1' * 64
    node = ComputeNode('spark4', '4' * 32, '100.64.0.4')
    supplied = {}

    def acquire(request):
        calls['acquire'].append(request)
        return supplied.get('lease') or WorkspaceLease(
            request, 'a' * 32, node.spark_id, node.machine_id, node.host, 2222,
            'sandbox', 'b' * 64, image, '/private/client-key', '/private/known-hosts',
            'sparkie-workspace-' + 'a' * 32, 'ssh-ed25519 AAAAFixture')

    def idle(lease):
        calls['idle'].append(lease)
        return supplied.get('idle', IdleObservation('unknown', 'op-idle'))

    def connect(self, **kwargs):
        calls['ssh'].append(kwargs)
        self.cwd = kwargs['cwd']

    monkeypatch.setattr(PinnedSandboxSSH, '__init__', connect)
    monkeypatch.setattr(PinnedSandboxSSH, 'cleanup', lambda self: calls['cleanup'].append(True))
    provider = SparkComputeProvider(nodes=[node], hub_machine_id='1' * 32,
                                    image=image, acquire=acquire, idle=idle)
    return provider, calls, supplied


def test_real_plugin_registration_shows_unconfigured_backend_unavailable(tmp_path, monkeypatch):
    from hermes_cli.plugins import PluginManager
    from agent.terminal_env_registry import get_provider
    from tools.terminal_tool_backends import _create_environment
    home = tmp_path / 'home'
    shutil.copytree(Path(__file__).resolve().parents[1] / 'plugin', home / 'plugins' / 'sparkie-sparks')
    (home / 'config.yaml').write_text('plugins:\n  enabled: [sparkie-sparks]\n  isolation: in_process\n')
    monkeypatch.setenv('HERMES_HOME', str(home))
    manager = PluginManager(scope_key=str(home))
    manager.discover_and_load()
    provider = get_provider('spark_compute', scope=str(home))
    assert provider is not None
    assert provider.probe()[0] == 'unavailable'
    assert provider.check_requirements({}) is False
    with pytest.raises(RuntimeError, match='not configured'):
        _create_environment('spark_compute', None, '/workspace', 30, task_id='owner-work')


def test_real_factory_preserves_native_backend_and_reconnects_exact_task(configured, tmp_path, monkeypatch):
    from agent.terminal_env_registry import register_provider
    from tools.terminal_tool_backends import _create_environment
    from tools.environments.ssh import SSHEnvironment
    provider, calls, supplied = configured
    monkeypatch.setenv('HERMES_HOME', str(tmp_path))
    register_provider(provider, scope=str(tmp_path))
    from tools.terminal_tool import _select_image
    selected = _select_image('spark_compute', {}, {})
    assert selected == ''  # Native plugin default; its provider owns the pin.
    first = _create_environment('spark_compute', selected, '/workspace', 30, task_id='same-task')
    first.cleanup()
    second = _create_environment('spark_compute', provider._image, '/workspace/project', 30, task_id='same-task')
    assert isinstance(first, SSHEnvironment) and isinstance(second, SSHEnvironment)
    assert first._hermes_backend_name == 'spark_compute'
    assert first._hermes_sandbox_home == '/workspace'
    assert first.cleanup_stops_processes is False
    assert first.lease == second.lease
    assert first.lease.request.image == provider._image
    assert len(calls['acquire']) == 2
    assert calls['idle'] == []
    assert len(calls['ssh']) == 2


def test_late_controller_recovers_without_gateway_restart_or_per_call_config_probe(configured):
    from sparkie_sparks.sandbox_provider import LazySparkComputeProvider
    provider, calls, supplied = configured
    attempts = []
    available = False
    def configure():
        attempts.append(True)
        if not available:
            raise RuntimeError('Controller still starting')
        return provider
    lazy = LazySparkComputeProvider(configure)
    assert lazy.is_available() is False
    with pytest.raises(RuntimeError, match='No compute commands'):
        lazy.create_environment(cwd='/workspace', timeout=30, task_id='native')
    assert calls['ssh'] == []
    available = True
    assert lazy.create_environment(cwd='/workspace', timeout=30, task_id='native').lease.spark_id == 'spark4'
    count = len(attempts)
    assert lazy.is_available()
    lazy.create_environment(cwd='/workspace', timeout=30, task_id='native')
    assert len(attempts) == count


@pytest.mark.parametrize('change', [
    {'spark_id': 'spark1'}, {'machine_id': '1' * 32}, {'host': '100.76.1.1'},
    {'container_id': 'name-instead-of-exact-id'}, {'host_key_alias': 'other-workspace'},
    {'user': 'root'}, {'port': 22}, {'image_id': 'latest'},
])
def test_wrong_compute_identity_never_opens_ssh(configured, change):
    provider, calls, supplied = configured
    first = provider.create_environment(cwd='/workspace', timeout=30, task_id='task')
    calls['ssh'].clear()
    supplied['lease'] = replace(first.lease, **change)
    with pytest.raises(ValueError):
        provider.create_environment(cwd='/workspace', timeout=30, task_id='task')
    assert calls['ssh'] == []


def test_hub_cannot_be_relabelled_as_compute():
    from sparkie_sparks.sandbox_provider import ComputeNode, SparkComputeProvider
    with pytest.raises(ValueError, match='Spark 1 is excluded'):
        SparkComputeProvider(nodes=[ComputeNode('spark4', '1' * 32, 'hub')], hub_machine_id='1' * 32)


def test_failed_connection_does_not_allow_another_container_on_retry(configured, monkeypatch):
    from sparkie_sparks.sandbox_ssh import PinnedSandboxSSH
    provider, calls, supplied = configured
    monkeypatch.setattr(PinnedSandboxSSH, '__init__', lambda self, **kwargs: (_ for _ in ()).throw(OSError('lost connection')))
    with pytest.raises(OSError, match='lost connection'):
        provider.create_environment(cwd='/workspace', timeout=30, task_id='task')
    supplied['lease'] = replace(provider._bindings['task'], container_id='c' * 64)
    with pytest.raises(ValueError, match='silently move'):
        provider.create_environment(cwd='/workspace', timeout=30, task_id='task')


@pytest.mark.parametrize('changed', [
    {'image': 'latest'}, {'cwd': '/home/owner'}, {'cwd': '/workspace/../home'},
    {'container_config': {'docker_volumes': ['/home:/host']}},
    {'container_config': {'docker_env': {'OWNER_TOKEN': 'fixture'}}},
    {'container_config': {'container_cpu': float('nan')}},
    {'container_config': {'container_persistent': False}},
])
def test_widened_requests_do_not_reach_allocator(configured, changed):
    provider, calls, supplied = configured
    with pytest.raises(ValueError):
        provider.create_environment(**(dict(cwd='/workspace', timeout=30, task_id='task') | changed))
    assert calls['acquire'] == calls['ssh'] == []


def test_resource_changes_rejected_before_reallocating_existing_task(configured):
    provider, calls, supplied = configured
    provider.create_environment(cwd='/workspace', timeout=30, task_id='task')
    with pytest.raises(ValueError, match='resource allocation'):
        provider.create_environment(cwd='/workspace', timeout=30, task_id='task',
                                    container_config={'container_cpu': 2})
    assert len(calls['acquire']) == 1


def test_production_cleanup_hint_does_not_stop_or_observe_work_and_ignores_old_connection(configured):
    provider, calls, supplied = configured
    hints = []
    provider._release = hints.append
    first = provider.create_environment(cwd='/workspace', timeout=30, task_id='task')
    second = provider.create_environment(cwd='/workspace', timeout=30, task_id='task')
    first.cleanup()
    assert hints == []
    second.cleanup()
    assert hints == [second.lease]
    second.cleanup()
    assert hints == [second.lease]
    assert calls['idle'] == []
    assert second.cleanup_stops_processes is False
    assert provider._bindings['task'] == second.lease


def test_native_cleanup_error_still_records_a_hint_without_claiming_stopped(configured, monkeypatch):
    from sparkie_sparks.sandbox_ssh import PinnedSandboxSSH
    provider, calls, supplied = configured
    hints = []
    provider._release = hints.append
    environment = provider.create_environment(cwd='/workspace', timeout=30, task_id='task')
    def failed_cleanup(self): raise RuntimeError('Synthetic SSH cleanup failure')
    monkeypatch.setattr(PinnedSandboxSSH, 'cleanup', failed_cleanup)
    with pytest.raises(RuntimeError, match='SSH cleanup failure'):
        environment.cleanup()
    assert hints == [environment.lease]
    assert calls['idle'] == [] and environment.idle_observation is None


@pytest.mark.parametrize('state', ['running', 'unknown', 'stopped'])
def test_cleanup_never_releases_and_idle_requires_observed_stop(configured, state):
    from sparkie_sparks.sandbox_provider import IdleObservation
    provider, calls, supplied = configured
    env = provider.create_environment(cwd='/workspace', timeout=30, task_id='task')
    env.cleanup()
    assert calls['idle'] == []
    assert env.idle_observation is None
    supplied['idle'] = IdleObservation(state, 'op-idle')
    if state == 'stopped':
        assert env.stop_idle() == supplied['idle']
    else:
        with pytest.raises(RuntimeError, match='resources remain held'):
            env.stop_idle()
    assert env.idle_observation.state == state
    assert calls['idle'] == [env.lease]
    assert provider._bindings['task'] == env.lease


def test_unverified_idle_result_cannot_claim_stop(configured):
    from sparkie_sparks.sandbox_provider import IdleObservation
    provider, calls, supplied = configured
    env = provider.create_environment(cwd='/workspace', timeout=30, task_id='task')
    supplied['idle'] = IdleObservation('stopped', '')
    with pytest.raises(RuntimeError, match='unverified'):
        env.stop_idle()

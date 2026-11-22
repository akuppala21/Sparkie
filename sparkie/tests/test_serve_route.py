"""Tailscale changes preserve all routes except the reviewed8443 handler set."""
import importlib.util
from copy import deepcopy
from pathlib import Path

import pytest

spec = importlib.util.spec_from_file_location('serve_route', Path(__file__).parents[1] / 'deploy/serve_route.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

OLD = {'Handlers': {'/': {'Path': '/old'}, '/console/api': {'Proxy': 'unix:/old.sock'}}}
OTHER = 'unrelated.example.invalid:443'


class API:
    def __init__(self):
        self.config = {'TCP': {'443': {'HTTPS': True}, '8443': {'HTTPS': True}},
            'Web': {module.HOST: deepcopy(OLD), OTHER: {'Handlers': {'/': {'Proxy': 'http://127.0.0.1:8100'}}}},
            'AllowFunnel': {module.HOST: True, OTHER: True}}
        self.revision, self.writes, self.fail = 1, 0, None

    def read(self): return deepcopy(self.config), str(self.revision)

    def write(self, config, etag):
        self.writes += 1
        if self.fail == 'stale':
            self.config['Web'][OTHER]['Handlers']['/']['Proxy'] = 'http://127.0.0.1:8101'
            self.revision += 1
        if etag != str(self.revision): raise RuntimeError('Precondition failed')
        self.config = deepcopy(config)
        self.revision += 1
        if self.fail == 'lost': raise TimeoutError('Response lost')


def test_only_target_handlers_change_and_rollback_preserves_other_route_edits():
    api = API()
    before = deepcopy(api.config)
    target = module.replacement(32130)
    assert module.change(api, expected=OLD, target=target)['changed']
    assert api.config['TCP'] == before['TCP'] and api.config['AllowFunnel'] == before['AllowFunnel']
    assert api.config['Web'][module.HOST] == target
    api.config['Web'][OTHER]['Handlers']['/']['Proxy'] = 'http://127.0.0.1:8101'
    module.change(api, expected=target, target=OLD)
    assert api.config['Web'][module.HOST] == OLD
    assert api.config['Web'][OTHER]['Handlers']['/']['Proxy'].endswith('8101')


def test_lost_success_is_observed_without_second_write():
    api = API()
    api.fail = 'lost'
    target = module.replacement(32130)
    assert module.change(api, expected=OLD, target=target)['already_observed']
    assert not module.change(api, expected=OLD, target=target)['changed']
    assert api.writes == 1


def test_concurrent_change_is_never_repeated_or_overwritten():
    api = API()
    api.fail = 'stale'
    with pytest.raises(RuntimeError, match='not confirmed'):
        module.change(api, expected=OLD, target=module.replacement(32130))
    assert api.writes == 1 and api.config['Web'][module.HOST] == OLD
    assert api.config['Web'][OTHER]['Handlers']['/']['Proxy'].endswith('8101')


def test_unreviewed_route_is_refused_without_write():
    api = API()
    api.config['Web'][module.HOST] = module.replacement(33333)
    with pytest.raises(RuntimeError, match='outside this candidate'):
        module.change(api, expected=OLD, target=module.replacement(32130))
    assert api.writes == 0

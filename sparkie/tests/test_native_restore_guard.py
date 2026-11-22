"""Actual native owner routes on the packaged sealed-distribution restore patch.

Run with the candidate's patched Hermes source. The raw upstream archive must not
pass these checks: it has no sealed-home restore compatibility guard.
"""
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace
import zipfile

import pytest

from test_owner_login import app, native_bundle, login, ORIGIN

pytestmark = pytest.mark.integration

ROUTES = ('import', 'import-upload', 'transfer/chunk', 'transfer/restore')


def request(client, route, profile=None):
    params = {} if profile is None else {'profile': profile}
    kwargs = {'params': params, 'headers': {'Origin': ORIGIN}}
    if route == 'import-upload':
        payload = BytesIO()
        with zipfile.ZipFile(payload, 'w') as archive:
            archive.writestr('config.yaml', 'model: archived\n')
        kwargs.update(files={'file': ('fixture.zip', payload.getvalue(), 'application/zip')}, data={'force': 'true'})
    else:
        kwargs['json'] = {
            'import': {'archive': '/a-reviewable-backup.zip', 'force': True, 'keep_host': True},
            'transfer/chunk': {'offset': 0, 'upload_id': '', 'data': 'Zml4dHVyZQ=='},
            'transfer/restore': {'upload_id': 'a' * 32, 'size': 100},
        }[route]
    return client.post('/api/ops/' + route, **kwargs)


@pytest.mark.parametrize('route', ROUTES)
@pytest.mark.parametrize('profile', [None, 'default', 'another-profile'])
def test_native_owner_cannot_start_or_persist_direct_restore(app, monkeypatch, route, profile):
    from hermes_cli import web_server_gateway
    from hermes_cli.web_routers import ops, transfer
    assert hasattr(ops, '_require_staged_recovery'), 'Use the candidate with its reviewed restore patch.'
    assert login(app.client).status_code == 302
    monkeypatch.setattr(web_server_gateway, '_spawn_hermes_action', lambda *a, **kw: pytest.fail('No native process may be started'))
    monkeypatch.setattr(ops, '_dashboard_backup_dir', lambda *a, **kw: pytest.fail('No restore file may be persisted'))
    monkeypatch.setattr(transfer, '_upload_path', lambda *a, **kw: pytest.fail('No transfer state may be accessed'))
    before = {p.relative_to(app.home): p.read_bytes() for p in (app.home / 'backups').rglob('*') if p.is_file()}
    response = request(app.client, route, profile)
    assert response.status_code == 409, response.text
    assert response.json()['detail'] == (
        'Restore requires a prepared recovery candidate so current sign-in and permissions are kept. '
        'Ask for a staged recovery from this backup. Native backup and export remain available.')
    after = {p.relative_to(app.home): p.read_bytes() for p in (app.home / 'backups').rglob('*') if p.is_file()}
    assert after == before


@pytest.mark.parametrize('route', ROUTES)
def test_native_authentication_still_precedes_restore_refusal(app, route):
    assert request(app.client, route).status_code == 401


def test_native_backup_and_download_remain_available(app, monkeypatch, tmp_path):
    from hermes_cli import web_server_gateway
    from hermes_cli.web_routers import ops
    assert login(app.client).status_code == 302
    commands = []
    monkeypatch.setattr(web_server_gateway, '_spawn_hermes_action',
                        lambda argv, name: commands.append((argv, name)) or SimpleNamespace(pid=4321))
    backup_root = tmp_path / 'backups'
    backup_root.mkdir()
    monkeypatch.setattr(ops, '_dashboard_backup_dir', lambda profile: backup_root)
    response = app.client.post('/api/ops/backup', json={}, headers={'Origin': ORIGIN})
    assert response.status_code == 200 and response.json()['ok'] is True
    assert len(commands) == 1 and commands[0][1] == 'backup'
    assert 'backup' in commands[0][0] and 'import' not in commands[0][0]
    archive = backup_root / 'fixture.zip'
    archive.write_bytes(b'fixture native backup bytes')
    response = app.client.get('/api/ops/backup/download', params={'archive': str(archive)})
    assert response.status_code == 200 and response.content == archive.read_bytes()
    assert app.client.get('/api/auth/me').status_code == 200


def test_native_import_spawner_also_refuses_future_callers():
    from fastapi import HTTPException
    from hermes_cli.web_routers.ops import _spawn_import
    with pytest.raises(HTTPException) as rejected:
        _spawn_import('/unused.zip', True, keep_host=True, messaging_off=True)
    assert rejected.value.status_code == 409

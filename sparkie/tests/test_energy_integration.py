"""Native registration and shared dashboard/tool consumer checks; no live identity claims."""

from datetime import datetime, timedelta, timezone
import importlib.util
import json
from pathlib import Path
import shutil

import pytest

from sparkie_sparks.energy import ZONE, record

pytestmark = pytest.mark.integration
PLUGIN = Path(__file__).resolve().parents[1] / 'plugin'


def test_native_tool_and_dashboard_share_month_totals_and_refuse_bad_months(tmp_path, monkeypatch):
    from hermes_cli.plugins import PluginManager
    from tools.registry import registry
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    home = tmp_path / 'hermes'
    target = home / 'plugins' / 'sparkie-sparks'
    shutil.copytree(PLUGIN, target)
    (home / 'config.yaml').write_text('plugins:\n  enabled:\n    - sparkie-sparks\n')
    database = tmp_path / 'energy.sqlite'
    past = (datetime.now(timezone.utc) - timedelta(days=1)).replace(hour=12, minute=0, second=0, microsecond=0)
    month = past.astimezone(ZONE).strftime('%Y-%m')
    record(database, spark='spark2', meter='plug2', at=past, kwh=1)
    record(database, spark='spark2', meter='plug2', at=past + timedelta(minutes=1), kwh=1.25)
    monkeypatch.setenv('HERMES_HOME', str(home))
    monkeypatch.setenv('SPARKIE_ENERGY_DATABASE', str(database))
    manager = PluginManager(scope_key=str(home))
    manager.discover_and_load()
    tool = registry.get_entry('spark_electricity', scope=manager.scope_key)
    assert tool is not None
    result = json.loads(tool.handler({'month': month}))
    assert result['recorded_kwh'] == 0.25
    assert json.loads(tool.handler({'path': '/etc/passwd'}))['available'] is False
    assert json.loads(tool.handler({'month': '2026-99'}))['available'] is False
    spec = importlib.util.spec_from_file_location('sparkie_energy_dashboard', target / 'dashboard' / 'plugin_api.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    app = FastAPI()
    app.include_router(module.router, prefix='/api/plugins/sparkie-sparks')
    with TestClient(app) as client:
        response = client.get('/api/plugins/sparkie-sparks/energy?month=' + month)
        assert response.status_code == 200
        for key in ('recorded_kwh', 'month', 'months', 'timezone', 'partial'):
            assert response.json()[key] == result[key]
        assert client.get('/api/plugins/sparkie-sparks/energy?month=2026-99').status_code == 400
        assert client.post('/api/plugins/sparkie-sparks/energy').status_code == 405


def test_native_electricity_periods_cost_and_readonly_rate_boundary(tmp_path, monkeypatch):
    from hermes_cli.plugins import PluginManager
    from tools.registry import registry
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    home = tmp_path / 'hermes'
    target = home / 'plugins/sparkie-sparks'
    shutil.copytree(PLUGIN, target)
    (home / 'config.yaml').write_text('plugins:\n  enabled:\n    - sparkie-sparks\n')
    database = tmp_path / 'energy.sqlite'
    past = (datetime.now(timezone.utc) - timedelta(days=1)).replace(hour=12, minute=0, second=0, microsecond=0)
    record(database, spark='spark2', meter='plug2', at=past, kwh=1)
    record(database, spark='spark2', meter='plug2', at=past + timedelta(minutes=1), kwh=1.25)
    monkeypatch.setenv('HERMES_HOME', str(home))
    monkeypatch.setenv('SPARKIE_ENERGY_DATABASE', str(database))
    manager = PluginManager(scope_key=str(home))
    manager.discover_and_load()
    tool = registry.get_entry('spark_electricity', scope=manager.scope_key)
    assert tool is not None
    spec = importlib.util.spec_from_file_location('sparkie_period_dashboard', target / 'dashboard/plugin_api.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    app = FastAPI()
    app.include_router(module.router, prefix='/api/plugins/sparkie-sparks')
    local = past.astimezone(ZONE)
    year, week, _ = local.isocalendar()
    selections = {'day': local.strftime('%Y-%m-%d'), 'week': f'{year}-W{week:02}',
                  'month': local.strftime('%Y-%m'), 'year': local.strftime('%Y')}
    with TestClient(app) as client:
        for period, selected in selections.items():
            args = {'period': period, 'selected': selected, 'rate': 0.4}
            result = json.loads(tool.handler(args))
            response = client.get('/api/plugins/sparkie-sparks/energy', params=args)
            assert response.status_code == 200
            for key in ('period', 'selected', 'periods', 'recorded_kwh', 'cost_usd', 'rate_usd_per_kwh'):
                assert response.json()[key] == result[key]
            assert result['recorded_kwh'] == 0.25 and result['cost_usd'] == 0.1
        assert client.get('/api/plugins/sparkie-sparks/energy?period=hour').status_code == 400
        assert client.get('/api/plugins/sparkie-sparks/energy?rate=11').status_code == 400
        assert client.post('/api/plugins/sparkie-sparks/energy/rate', json={'usd_per_kwh': 0.4}).status_code in (404, 405)
    assert json.loads(tool.handler({'period': 'day', 'usd_per_kwh': 0.9}))['available'] is False
    assert json.loads(tool.handler({'period': 'hour'}))['available'] is False
    assert json.loads(tool.handler({'period': 'year', 'rate': True}))['available'] is False
    unchanged = json.loads(tool.handler({'period': 'day'}))
    assert unchanged['rate_usd_per_kwh'] is None and unchanged['cost_usd'] is None
    assert 'rates' not in unchanged and 'current_rate' not in unchanged

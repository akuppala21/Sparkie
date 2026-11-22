"""New transition interfaces select their affected consumers and real boundaries."""
from pathlib import Path
import runpy

select = runpy.run_path(str(Path(__file__).parents[1]/'tools/checks.py'))['selection']


def test_history_import_selects_electricity_consumers_without_power_or_model_runs():
    plan = select(['src/sparkie_sparks/energy_history.py'])
    assert {'tests/test_energy_history.py', 'tests/test_energy_integration.py'} <= set(plan['python_tests'])
    assert plan['desktop_phone_browser']
    assert not plan['compute_power_validation'] and not plan['compact_local_behavior']
    assert not plan['broad_qualification']


def test_managed_configuration_selects_native_authority_and_actual_host_boundary():
    for path in ('deploy/managed_config.py', 'deploy/protected_home.py'):
        plan = select([path])
        assert {'tests/test_managed_config.py', 'tests/test_owner_login.py', 'tests/test_native_config.py'} <= set(plan['python_tests'])
        assert plan['native_execution_isolation'] and plan['compact_local_behavior']
        assert plan['native_candidate'] and plan['native_shared_sessions']


def test_promotion_includes_history_and_preview_preservation():
    plan = select(['deploy/promote.py'])
    assert {'tests/test_promotion_preservation.py', 'tests/test_energy_history.py'} <= set(plan['python_tests'])
    assert plan['native_candidate']

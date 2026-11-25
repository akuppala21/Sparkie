from pathlib import Path
import json
import os
import runpy
import shutil
import subprocess
import sys
from xml.etree import ElementTree

import pytest

checks = runpy.run_path(str(Path(__file__).resolve().parents[1] / 'tools/checks.py'))
select = checks['selection']


def test_physical_ssh_changes_cover_their_consumers_and_worker_staging_is_focused():
    plan = select(['src/sparkie_sparks/worker_network.py'])
    assert {'tests/test_site_example.py', 'tests/test_collector.py', 'tests/test_power.py',
            'tests/test_workloads.py', 'tests/test_recipe_services.py', 'tests/test_endpoint_relay.py',
            'tests/test_workspace_remote.py'} <= set(plan['python_tests'])
    for group in ('native_compute_workspace', 'disposable_workload_stop', 'compute_power_validation',
                  'enrolled_service_lifecycle'):
        assert plan[group]
    stage = select(['deploy/worker_stage.py'])
    assert 'tests/test_worker_stage.py' in stage['python_tests']
    assert stage['native_candidate'] and stage['native_compute_workspace'] and not stage['broad_qualification']


@pytest.mark.parametrize('name', [
    'hermes-webapp-first-slash.patch', 'hermes-webapp-first-slash.json', 'build.py',
    'retain-stylesheet.mjs', 'original-main.css.gz', 'members.json',
])
def test_webapp_build_inputs_require_native_renderer_and_export_without_physical_work(name):
    plan = select(['sparkie/deploy/webapp/' + name])
    assert plan['native_webapp_renderer'] and plan['webapp_rebuild_and_export']
    assert plan['desktop_phone_browser'] and plan['native_candidate'] and not plan['sparks_panel']
    assert 'tests/test_deployment.py' in plan['python_tests']
    assert plan['javascript_syntax'] == (name == 'retain-stylesheet.mjs')
    assert ('tests/test_application_upgrade.py' in plan['python_tests']) == (name == 'members.json')
    assert not any(plan[group] for group in ('broad_qualification', 'compact_local_behavior',
                   'enrolled_service_lifecycle', 'private_broker_stop', 'compute_power_validation'))


@pytest.mark.parametrize(('paths', 'expected'), [
    (['README.md'], {'webapp_rebuild_and_export'}),
    (['NOTICES.txt'], set()),
    (['README.md', 'NOTICES.txt'], {'webapp_rebuild_and_export'}),
])
def test_webapp_export_instructions_and_notices_select_only_their_own_checks(paths, expected):
    plan = select(['deploy/webapp/' + path for path in paths])
    assert not plan['python_tests']
    assert {group for group in checks['GROUPS'] if plan[group]} == expected


def test_webapp_unknown_files_and_combined_deployment_keep_their_own_scope():
    unknown = select(['deploy/webapp/new-source.json'])
    assert unknown['broad_qualification'] and unknown['enrolled_service_lifecycle']
    assert unknown['native_webapp_renderer'] and unknown['webapp_rebuild_and_export']
    combined = select(['deploy/webapp/build.py', 'deploy/candidate.py'])
    assert combined['enrolled_service_lifecycle'] and combined['native_webapp_renderer']


@pytest.mark.parametrize('name', [
    'plugin.js', 'recipes-entry.js', 'common.js', 'sparks-panel.js',
    'recipes-panel.js', 'cold-landing.js',
])
def test_webapp_plugin_changes_require_the_served_shell_and_shared_consumers(name):
    plan = select(['webapp_plugin/' + name])
    assert plan['webapp_cold_landing'] == (name in ('plugin.js', 'cold-landing.js'))
    assert plan['native_webapp_renderer'] and plan['webapp_rebuild_and_export']
    assert plan['desktop_phone_browser'] and plan['native_candidate']
    assert {'tests/test_deployment.py', 'tests/test_dashboard_packaging.py',
            'tests/test_recipes.py'} <= set(plan['python_tests'])
    assert plan['sparks_panel'] == (name in ('common.js', 'sparks-panel.js'))
    if name in ('common.js', 'sparks-panel.js'):
        assert {'tests/test_native_controls.py', 'tests/test_controls_availability.py',
                'tests/test_application_updates.py', 'tests/test_service_access.py'} <= set(plan['python_tests'])
    assert not any(plan[group] for group in ('broad_qualification', 'compact_local_behavior',
                   'native_compute_workspace', 'private_broker_stop', 'compute_power_validation'))


def test_webapp_plugin_build_and_browser_checks_cannot_be_replaced_by_dashboard_only():
    for path in ('deploy/webapp/plugin_sources.py', 'deploy/webapp/plugin-inputs.json', 'tools/package_plugins.py',
                 'tests/browser/webapp_sparks.mjs', 'tests/browser/webapp_sparks_fixture.py'):
        plan = select([path])
        assert plan['native_webapp_renderer'] and plan['desktop_phone_browser']
        assert not plan['broad_qualification'] and not plan['compact_local_behavior']
    assert select(['webapp_plugin/unknown-runtime.py'])['broad_qualification']
    combined = select(['webapp_plugin/plugin.js', 'src/sparkie_sparks/authority.py'])
    assert combined['native_webapp_renderer'] and combined['private_broker_stop']
    assert combined['compact_local_behavior'] and combined['native_shared_sessions']


def test_energy_edit_does_not_select_model_comparison_or_power_cycles():
    plan = select(['sparkie/src/sparkie_sparks/energy.py'])
    assert 'tests/test_energy.py' in plan['python_tests']
    assert 'tests/test_energy_integration.py' in plan['python_tests']
    assert plan['desktop_phone_browser'] is True
    assert plan['compact_local_behavior'] is False
    assert plan['broad_qualification'] is False


def test_unknown_or_deleted_file_never_silently_skips_checks():
    plan = select(['sparkie/src/sparkie_sparks/new_feature.py', 'sparkie/tests/test_deleted.py'])
    assert plan['broad_qualification'] is True
    assert plan['compact_local_behavior'] is True
    # A broad selection hands the full extension test directory to native pytest.
    assert plan['python_tests'] == ['tests']
    assert (Path(__file__).resolve().parents[1] / plan['python_tests'][0] / 'test_energy.py').is_file()


def test_shared_plugin_change_includes_both_consumers_and_behavior():
    plan = select(['sparkie/plugin/__init__.py'])
    assert 'tests/test_native_integration.py' in plan['python_tests']
    assert 'tests/test_energy_integration.py' in plan['python_tests']
    assert plan['compact_local_behavior'] is True


def test_wording_review_does_not_wake_the_fleet_for_tests():
    plan = select(['sparkie/README.md'])
    assert plan['python_tests'] == []
    assert plan['desktop_phone_browser'] is False
    assert plan['compact_local_behavior'] is False


def test_read_only_recipe_and_theme_edits_select_their_owner_paths():
    for path in ('src/sparkie_sparks/recipes.py', 'recipes_plugin/plugin.yaml',
                 'recipes_plugin/dashboard/index.js', 'recipes_plugin/dashboard/plugin_api.py',
                 'recipes_plugin/dashboard/manifest.json', 'themes/sparkie.yaml'):
        plan = select([path])
        expected = 'test_managed_config.py' if path.startswith('themes/') else 'test_recipes.py'
        assert {'tests/' + expected, 'tests/test_dashboard_packaging.py'} <= set(plan['python_tests'])
        assert plan['desktop_phone_browser']
        assert not any(plan[key] for key in ('compact_local_behavior', 'compute_power_validation',
                       'native_compute_workspace', 'broad_qualification'))


def test_recipe_pins_and_plugin_packaging_keep_existing_consumers():
    for path in ('models/main-model.json', 'models/dealign-flash-next.json'):
        plan = select([path])
        assert 'tests/test_recipes.py' in plan['python_tests']
        assert plan['compact_local_behavior']
    plan = select(['tools/package_plugins.py'])
    assert {'tests/test_owner_login.py', 'tests/test_dashboard_packaging.py',
            'tests/test_recipes.py'} <= set(plan['python_tests'])
    assert plan['native_shared_sessions']
    stage = select(['deploy/stage.py'])
    assert stage['native_candidate'] and stage['desktop_phone_browser']


def test_each_serving_change_alone_selects_lifecycle_consumers_and_behavior():
    for path in ('models/main-model.json', 'models/alternate-model.json',
                 'deploy/model_unit.py', 'deploy/brain_switch.py'):
        plan = select(['sparkie/' + path])
        assert {'tests/test_model_unit.py', 'tests/test_brain_switch.py',
                'tests/test_native_config.py', 'tests/test_deployment.py',
                'tests/test_installation_paths.py', 'tests/test_promote.py',
                'tests/test_promotion_preservation.py', 'tests/test_native_integration.py',
                'tests/test_energy_integration.py'} <= set(plan['python_tests']), path
        assert plan['compact_local_behavior'], path
        assert plan['native_candidate'] and plan['native_shared_sessions'], path
        assert not any(plan[flag] for flag in ('broad_qualification',
                       'compute_power_validation', 'native_compute_workspace')), path


def test_runtime_prompt_is_not_treated_as_harmless_markdown():
    assert select(['sparkie/SOUL.md'])['compact_local_behavior'] is True


def test_research_changes_select_versioned_readme_and_skill_consumers():
    for path in ('local-recipe-review/SKILL.md', 'local-recipe-review/scripts/read_github_readme.py',
                 'one-spark-serving-results/SKILL.md'):
        plan = select(['sparkie/skills/' + path])
        assert {'tests/test_github_readme.py', 'tests/test_native_config.py'} <= set(plan['python_tests'])
        assert plan['native_research'] and plan['compact_local_behavior']
        assert not plan['compute_power_validation'] and not plan['broad_qualification']


def test_cache_measurement_changes_select_the_benchmark_and_ordinary_agent():
    for file in ('SKILL.md', 'scripts/measure_cache.py'):
        plan = select(['sparkie/skills/one-spark-serving-results/' + file])
        assert 'tests/test_cache_measurement.py' in plan['python_tests']
        assert plan['native_research'] and plan['compact_local_behavior']
        assert not plan['compute_power_validation'] and not plan['broad_qualification']


@pytest.mark.parametrize('path', [
    'src/sparkie_sparks/memory_delivery.py', 'tests/test_memory_chat_delivery.py',
    'deploy/patches/hermes-owner-memory-delivery.patch', 'deploy/patches/hermes-owner-memory-delivery.json',
])
def test_owner_memory_delivery_selects_both_channels_and_first_visible_reply(path):
    plan = select([path])
    assert {'tests/test_memory_chat_delivery.py', 'tests/test_memory_owner_review.py',
            'tests/test_deployment.py', 'tests/test_owner_login.py'} <= set(plan['python_tests'])
    assert plan['compact_local_behavior'] and plan['native_shared_sessions'] and plan['native_candidate']
    assert plan['desktop_phone_browser']
    assert not plan['compute_power_validation'] and not plan['broad_qualification']


@pytest.mark.parametrize('memory_path', ['memory_controls.py', 'memory_paths.py'])
def test_memory_feedback_and_cleanup_changes_include_native_consumers(memory_path):
    memory = select(['src/sparkie_sparks/' + memory_path])
    assert not memory['broad_qualification']
    assert 'tests/test_memory_correction_feedback.py' in memory['python_tests']
    assert memory['compact_local_behavior'] and memory['native_shared_sessions']
    assert memory['sparks_panel'] and memory['other_desktop_phone_browser']
    for path in ('tests/sandbox_cleanup.py', 'tests/native_docker_fixture.py'):
        cleanup = select([path])
        assert 'tests/test_sandbox_cleanup.py' in cleanup['python_tests']
        assert cleanup['compact_local_behavior']
        assert cleanup['native_research']
        assert cleanup['native_execution_isolation']
        assert not cleanup['compute_power_validation'] and not cleanup['broad_qualification']


def test_native_skills_and_their_instruction_files_are_runtime_behavior():
    for path in ('sparkie/skills/fleet/SKILL.md', 'sparkie/skills/fleet/steps.md'):
        plan = select([path])
        assert plan['compact_local_behavior'] is True
        assert 'tests/test_native_integration.py' in plan['python_tests']


def test_general_skill_edits_keep_the_runtime_prompt_consumers():
    prompt = select(['sparkie/prompts/operator.md'])
    consumers = set(prompt['python_tests'])
    assert {'tests/test_fleet.py', 'tests/test_energy.py'} <= consumers
    for path in ('sparkie/skills/desk-assistant/steps.md', 'sparkie/skills/fleet/SKILL.md'):
        skill = select([path])
        assert skill['compact_local_behavior'] is True, path
        assert consumers <= set(skill['python_tests']), path


def test_sandbox_image_and_execution_config_require_real_isolation_check_without_blanket_suite():
    for path in ('sparkie/config/hermes.example.yaml', 'sparkie/config/sandbox.lock.json', 'sparkie/tests/hardware/native_sandbox.py'):
        plan = select([path])
        assert plan['native_execution_isolation'] is True
        assert plan['broad_qualification'] is False
        assert 'tests/test_native_config.py' in plan['python_tests']
    assert select(['sparkie/src/sparkie_sparks/energy.py'])['native_execution_isolation'] is False


def test_shared_native_sessions_follow_owner_and_runtime_changes_not_electricity():
    for path in ('sparkie/upstream.lock.json', 'sparkie/config/hermes.example.yaml',
                 'sparkie/tests/upstream-sessions.json', 'sparkie/src/sparkie_sparks/web_controls.py'):
        plan = select([path])
        assert plan['native_shared_sessions'] is True
        assert plan['broad_qualification'] is False
    plan = select(['sparkie/src/sparkie_sparks/energy.py'])
    assert plan['native_shared_sessions'] is False
    assert plan['private_broker_stop'] is False


def test_private_transport_edit_requires_real_boundary_check_but_not_power_cycle():
    for path in ('sparkie/src/sparkie_sparks/broker.py', 'sparkie/tests/hardware/broker_stop.py'):
        plan = select([path])
        assert plan['private_broker_stop'] is True
        assert plan['broad_qualification'] is False
        assert 'tests/test_broker.py' in plan['python_tests']


def test_electricity_and_layout_do_not_rerun_remote_execution_or_power():
    for path in ('src/sparkie_sparks/energy.py', 'plugin/dashboard/index.js'):
        plan = select([path])
        assert not plan['native_compute_workspace']
        assert not plan['compute_power_validation']
        assert not plan['native_research']
        assert not plan['broad_qualification']


def test_power_changes_include_native_owner_consumers_without_model_benchmark():
    for path in ('src/sparkie_sparks/power.py', 'src/sparkie_sparks/power_worker.py'):
        plan = select([path])
        assert plan['compute_power_validation']
        assert not plan['compact_local_behavior']
        assert not plan['broad_qualification']
        assert {'tests/test_power.py', 'tests/test_power_worker.py',
                'tests/test_controls_availability.py', 'tests/test_native_controls.py'} <= set(plan['python_tests'])


def test_power_transport_selects_host_unreachable_sequence_regression():
    plan = select(['src/sparkie_sparks/power.py'])
    assert 'tests/test_power_host_unreachable.py' in plan['python_tests']


def test_shared_power_button_fixture_selects_both_native_shells():
    plan = select(['tests/browser/sparks_power_states.mjs'])
    assert plan['sparks_panel'] and plan['native_webapp_renderer']
    assert plan['desktop_phone_browser'] and plan['javascript_syntax']
    assert not plan['compute_power_validation']
    assert not plan['compact_local_behavior']
    assert not plan['broad_qualification']


def test_native_ssh_source_and_real_fixture_require_same_execution_proof():
    for path in ('src/sparkie_sparks/sandbox_ssh.py', 'tests/hardware/native_ssh.py',
                 'tests/hardware/ssh-sandbox.Dockerfile', 'src/sparkie_sparks/sandbox_provider.py',
                 'src/sparkie_sparks/workspace_types.py', 'src/sparkie_sparks/workspace_leases.py',
                 'src/sparkie_sparks/workspace_worker.py', 'tests/hardware/workspace_allocation.py'):
        plan = select([path])
        assert plan['native_compute_workspace']
        assert not plan['compute_power_validation']
        assert not plan['broad_qualification']
        assert 'tests/test_sandbox_ssh.py' in plan['python_tests']


def test_common_runtime_config_includes_approvals_execution_and_research_consumers():
    for path in ('config/hermes.example.yaml', 'upstream.lock.json'):
        plan = select([path])
        for flag in ('native_compute_workspace', 'native_research', 'native_shared_sessions',
                     'private_broker_stop', 'compact_local_behavior'):
            assert plan[flag], (path, flag)
        assert {'tests/test_native_controls.py', 'tests/test_native_config.py',
                'tests/test_power.py', 'tests/test_sandbox_ssh.py'} <= set(plan['python_tests'])
        assert not plan['broad_qualification']


def test_composition_and_ui_include_per_machine_availability():
    for path in ('src/sparkie_sparks/composition.py', 'src/sparkie_sparks/controls.py',
                 'plugin/dashboard/index.js'):
        plan = select([path])
        assert 'tests/test_controls_availability.py' in plan['python_tests']
        assert plan['desktop_phone_browser']
        assert not plan['compute_power_validation']


def test_selector_and_research_changes_are_classified():
    plan = select(['tools/checks.py'])
    assert 'tests/test_check_selection.py' in plan['python_tests']
    assert not plan['broad_qualification']
    plan = select(['tests/research/native_sources.py'])
    assert plan['native_research'] and not plan['broad_qualification']


def test_read_tool_eval_selects_its_evidence_regression():
    plan = select(['tests/behavior/read_tools.py'])
    assert 'tests/test_compact_replays.py' in plan['python_tests']
    assert plan['compact_local_behavior'] and not plan['broad_qualification']


def test_operation_changes_include_model_reconciliation_and_its_private_boundary():
    for path in ('operations.py', 'controls.py', 'proposals.py', 'broker.py'):
        plan = select(['sparkie/src/sparkie_sparks/' + path])
        assert 'tests/test_proposal_reconciliation.py' in plan['python_tests']
        assert plan['compact_local_behavior'] and plan['private_broker_stop']
        assert not plan['compute_power_validation'] and not plan['broad_qualification']


def test_unknown_config_and_hardware_fixtures_broaden_instead_of_omitting_consumers():
    for path in ('config/new-executor.json', 'tests/hardware/new-device.py'):
        plan = select([path])
        assert plan['broad_qualification']
        assert plan['native_compute_workspace'] and plan['compute_power_validation']


def test_public_owner_login_change_selects_native_routes_and_owner_controls():
    plan = select(['src/sparkie_sparks/owner_login.py'])
    assert {'tests/test_owner_login.py', 'tests/test_native_controls.py',
            'tests/test_native_authority.py', 'tests/test_native_config.py'} <= set(plan['python_tests'])
    assert plan['native_shared_sessions'] and plan['desktop_phone_browser']
    assert not plan['native_compute_workspace'] and not plan['compute_power_validation']
    assert not plan['broad_qualification']


def test_plugin_bundle_change_checks_authentication_across_native_profiles():
    plan = select(['tools/package_plugins.py'])
    assert {'tests/test_owner_login.py', 'tests/test_native_config.py',
            'tests/test_native_integration.py'} <= set(plan['python_tests'])
    assert plan['native_shared_sessions'] and plan['desktop_phone_browser']
    assert not plan['broad_qualification']
    assert not plan['compute_power_validation']


def test_new_compute_power_and_proposal_modules_are_classified_without_blanket_runs():
    for path, flag, check in (
            ('src/sparkie_sparks/placement.py', 'native_compute_workspace', 'test_placement.py'),
            ('src/sparkie_sparks/workspace_service.py', 'native_compute_workspace', 'test_workspace_service.py'),
            ('src/sparkie_sparks/power_sequence.py', 'compute_power_validation', 'test_power_sequence.py'),
            ('src/sparkie_sparks/proposals.py', 'compact_local_behavior', 'test_proposals.py')):
        plan = select([path])
        assert plan[flag] and 'tests/' + check in plan['python_tests']
        assert not plan['broad_qualification']


def test_packaging_selects_native_candidate_and_collector_includes_maintenance_consumers():
    plan = select(['deploy/candidate.py', 'deploy/service_unit.py'])
    assert plan['native_candidate'] and plan['native_shared_sessions']
    assert 'tests/test_deployment.py' in plan['python_tests']
    assert not plan['broad_qualification'] and not plan['compute_power_validation']
    plan = select(['src/sparkie_sparks/collector.py'])
    assert {'tests/test_workspace_service.py', 'tests/test_idle.py', 'tests/test_power_sequence.py'} <= set(plan['python_tests'])


def test_energy_periods_and_deadline_consumers_are_selected_without_blanket_checks():
    plan = select(['src/sparkie_sparks/energy.py'])
    assert {'tests/test_energy_periods.py', 'tests/test_energy_integration.py'} <= set(plan['python_tests'])
    assert not plan['broad_qualification'] and not plan['compact_local_behavior']
    plan = select(['src/sparkie_sparks/io_budget.py'])
    assert {'tests/test_io_budget.py', 'tests/test_power_maintenance.py', 'tests/test_workspace_remote.py', 'tests/test_matter.py'} <= set(plan['python_tests'])
    assert not plan['broad_qualification']
    plan = select(['deploy/model_unit.py', 'tests/hardware/model_recovery.py'])
    assert 'tests/test_model_unit.py' in plan['python_tests']
    assert plan['native_candidate'] and not plan['broad_qualification']


def test_root_routing_patch_keeps_browser_and_auth_checks_without_hardware_runs():
    plan = select(['deploy/patches/hermes-dashboard-root-discovery.patch'])
    assert plan['desktop_phone_browser'] and plan['javascript_syntax']
    assert {'tests/test_dashboard_packaging.py', 'tests/test_owner_login.py',
            'tests/test_native_integration.py'} <= set(plan['python_tests'])
    assert not plan['compute_power_validation'] and not plan['native_compute_workspace']
    assert not plan['compact_local_behavior'] and not plan['broad_qualification']


def test_skill_staging_patch_selects_native_regressions_and_packaging():
    for path in ('deploy/patches/hermes-skill-stage-applicability.patch',
                 'deploy/patches/hermes-skill-stage-applicability.json',
                 'tests/fixtures/native_skill_stage_proposals.json'):
        plan = select([path])
        assert set(plan['python_tests']) == {'tests/test_native_skill_staging.py', 'tests/test_deployment.py',
                                             'tests/test_native_integration.py', 'tests/test_energy_integration.py'}
        assert plan['native_candidate'] and plan['compact_local_behavior']
        assert not plan['broad_qualification']
    packaging = select(['deploy/candidate.py'])
    assert {'tests/test_native_skill_staging.py', 'tests/test_promote.py'} <= set(packaging['python_tests'])
    assert 'tests/test_native_skill_staging.py' in select(['skills/local-recipe-review/SKILL.md'])['python_tests']


def test_restore_patch_and_its_digest_select_the_packaged_owner_routes():
    for suffix in ('patch', 'json'):
        plan = select(['deploy/patches/hermes-sealed-web-restore.' + suffix])
        assert {'tests/test_native_restore_guard.py', 'tests/test_owner_login.py',
                'tests/test_deployment.py', 'tests/test_promotion_preservation.py'} <= set(plan['python_tests'])
        assert plan['native_candidate']
        assert not any(plan[key] for key in ('broad_qualification', 'compute_power_validation',
                       'native_compute_workspace', 'compact_local_behavior'))
    assert 'tests/test_native_restore_guard.py' in select(['deploy/candidate.py'])['python_tests']


def test_service_consumers_follow_shared_control_deploy_runtime_and_browser_changes():
    cases = {'src/sparkie_sparks/controls.py', 'src/sparkie_sparks/web_controls.py',
             'src/sparkie_sparks/broker.py', 'src/sparkie_sparks/composition.py',
             'config/hermes.example.yaml', 'deploy/installation.py', 'deploy/promote.py',
             'tests/browser/services.mjs', 'tests/browser/services_fixture.py',
             'tests/browser/artifact_ingress.mjs', 'tests/browser/artifact_ingress_fixture.py'}
    for path in cases:
        plan = select([path])
        assert {'tests/test_recipe_services.py', 'tests/test_service_access.py', 'tests/test_endpoint_relay.py',
                'tests/test_service_ingress_deployment.py', 'tests/test_service_enrollment.py'} <= set(plan['python_tests']), path
        assert plan['enrolled_service_lifecycle'] == (not path.startswith('tests/browser/')), path
        if path.startswith('tests/browser/'):
            assert plan['javascript_syntax'] and plan['desktop_phone_browser']


@pytest.mark.parametrize('unit', ['docker.service', 'docker.socket', 'containerd.service'])
def test_ingress_parser_fixtures_select_only_the_parser_and_registration_smoke(unit):
    plan = select(['tests/fixtures/systemd/' + unit])
    assert set(plan['python_tests']) == {
        'tests/test_service_ingress_deployment.py', 'tests/test_native_integration.py',
        'tests/test_energy_integration.py'}
    assert not plan['broad_qualification'] and not plan['enrolled_service_lifecycle']


@pytest.mark.parametrize('name', ['LICENSE', 'NOTICE', 'README.md'])
def test_ingress_parser_attribution_selects_document_review_only(name):
    path = 'tests/fixtures/systemd/' + name
    plan = select([path])
    assert plan.pop('reasons') == [path + ': document review']
    assert not any(plan.values())
    assert select(['tests/fixtures/systemd/other.service'])['broad_qualification']


def test_update_boundaries_include_owner_and_recovery_consumers():
    for path in ('src/sparkie_sparks/application_updates.py', 'src/sparkie_sparks/update_proposals.py',
                 'deploy/upgrade.py', 'deploy/upgrade_installation.py', 'deploy/build-tools.json'):
        plan = select([path])
        assert {'tests/test_application_updates.py', 'tests/test_application_upgrade.py',
                'tests/test_update_transports.py', 'tests/test_installation_paths.py',
                'tests/test_promote.py'} <= set(plan['python_tests'])
        assert plan['native_candidate'] and not plan['broad_qualification']


def test_forum_reader_selects_research_without_unrelated_power_or_full_suite():
    plan = select(['skills/local-recipe-review/scripts/read_forum.py'])
    assert 'tests/test_forum_reader.py' in plan['python_tests']
    assert plan['compact_local_behavior'] and plan['native_research']
    assert not any(plan[k] for k in ('broad_qualification','compute_power_validation',
                                    'native_compute_workspace','native_candidate'))


def test_research_evidence_and_skill_select_their_consumers_only():
    for path in ('skills/local-recipe-review/scripts/check_evidence.py',
                 'skills/local-recipe-review/SKILL.md'):
        plan = select([path])
        assert {'tests/test_research_claims.py', 'tests/test_forum_reader.py',
                'tests/test_native_config.py', 'tests/test_native_integration.py'} <= set(plan['python_tests'])
        assert plan['compact_local_behavior'] and plan['native_research']
        assert not any(plan[k] for k in ('broad_qualification', 'compute_power_validation',
                                        'native_compute_workspace', 'native_candidate'))


def test_recovery_reply_change_selects_native_delivery_without_hardware_cycles():
    plan = select(['src/sparkie_sparks/recovery_replies.py'])
    assert {'tests/test_recovery_replies.py', 'tests/test_proposals.py',
            'tests/test_proposal_reconciliation.py', 'tests/test_native_controls.py',
            'tests/test_native_integration.py'} <= set(plan['python_tests'])
    assert plan['compact_local_behavior'] and plan['native_shared_sessions']
    assert not any(plan[k] for k in ('broad_qualification', 'compute_power_validation',
                                    'native_compute_workspace', 'native_candidate'))
    assert 'tests/test_recovery_replies.py' in select(['plugin/__init__.py'])['python_tests']


def test_developer_evidence_tool_does_not_start_model_or_hardware_evaluations():
    plan = select(['tools/check_research_evidence.py'])
    assert 'tests/test_research_claims.py' in plan['python_tests']
    assert not any(plan[k] for k in ('compact_local_behavior', 'native_research',
                                    'broad_qualification', 'compute_power_validation',
                                    'native_compute_workspace', 'native_candidate'))


@pytest.mark.parametrize('layout', ['standalone', 'monorepo', 'nested'])
def test_git_discovery_selects_a_repair_in_its_own_checkout(tmp_path, layout):
    script = Path(__file__).resolve().parents[1] / 'tools/checks.py'
    repo = tmp_path / layout
    extension = {'standalone': repo, 'monorepo': repo / 'sparkie',
                 'nested': repo / 'projects' / 'agent'}[layout]
    tools_dir = extension / 'tools'
    tools_dir.mkdir(parents=True)
    shutil.copyfile(script, tools_dir / 'checks.py')
    assets = extension / 'skills' / 'reports' / 'assets'
    assets.mkdir(parents=True)
    (assets / 'old.dat').write_bytes(b'fixed fixture')

    def git(*args):
        return subprocess.run(['git', '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid',
                               '-c', 'commit.gpgsign=false', *args], cwd=repo, check=True, capture_output=True)

    def plan():
        return json.loads(subprocess.check_output(
            [sys.executable, str(tools_dir / 'checks.py'), '--base', 'HEAD'], cwd=tmp_path))

    git('init', '-q')
    git('add', '.')
    git('commit', '-qm', 'fixture')
    assert plan()['python_tests'] == [], layout
    (assets / 'old.dat').rename(assets / 'new.bin')
    git('add', '-A')
    entry = extension / 'skills' / 'nested' / 'SKILL.md'
    entry.parent.mkdir(parents=True)
    entry.write_text('New skill')
    if layout != 'standalone':
        (repo / 'unrelated.py').write_text('unrelated project')
    changed = plan()
    assert changed['compact_local_behavior'] and not changed['broad_qualification'], layout
    assert 'tests/test_energy_integration.py' in changed['python_tests'], layout
    paths = {reason.split(': ', 1)[0] for reason in changed['reasons']}
    paths = {p.removeprefix('sparkie/') for p in paths}
    assert paths == {'skills/reports/assets/old.dat', 'skills/reports/assets/new.bin',
                     'skills/nested/SKILL.md'}, layout


def test_nested_regressions_reach_pytest_and_broad_collection_honors_ignores(tmp_path):
    root = tmp_path / 'extension'
    (root / 'tools').mkdir(parents=True)
    shutil.copyfile(Path(__file__).resolve().parents[1] / 'tools/checks.py', root / 'tools/checks.py')
    tests = root / 'tests'
    component = tests / 'behavior'
    component.mkdir(parents=True)
    # Marker files show which items ran even when a different test fails.
    for name in ('test_native_integration.py', 'test_energy_integration.py',
                 'test_sandbox_cleanup.py', 'test_energy.py'):
        (tests / name).write_text(
            f"from pathlib import Path\ndef test_smoke():\n    Path('{name}.ran').touch()\n")
    (tests / 'conftest.py').write_text("collect_ignore = ['excluded_test.py']\n")
    (tests / 'excluded_test.py').write_text("raise RuntimeError('excluded module was imported')\n")
    (component / 'report_test.py').write_text(
        "def test_red():\n    assert False, 'nested-repro'\n"
        "def test_passing_control():\n    pass\n")

    caller_xml = root / 'caller.xml'

    def run(path, options=''):
        env = dict(os.environ, PYTEST_ADDOPTS=f'{options} --junitxml=caller.xml')
        return subprocess.run([sys.executable, 'tools/checks.py', '--paths', path, '--run-python'],
                              cwd=root, env=env, text=True, capture_output=True, timeout=30)

    def outcomes(result):
        return json.loads(result.stdout.splitlines()[-1])['pytest']

    focused = run('tests/behavior/report_test.py')
    assert focused.returncode == 1 and 'AssertionError: nested-repro' in focused.stdout
    assert json.JSONDecoder().raw_decode(focused.stdout)[0]['compact_local_behavior']
    assert not (root / 'test_energy.py.ran').exists()
    assert outcomes(focused) == {'target_path_count': 4, 'selected_items': 5, 'item_starts': 5,
                                 'exit_code': 1, 'native_summary': '1 failed, 4 passed'}
    assert len(ElementTree.parse(caller_xml).findall('.//failure')) == 1

    filtered = run('tests/behavior/report_test.py', '-qq -k passing_control')
    assert filtered.returncode == 0
    assert outcomes(filtered) == {'target_path_count': 4, 'selected_items': 1, 'item_starts': 1,
                                  'exit_code': 0, 'native_summary': '1 passed, 4 deselected'}
    assert [case.get('name') for case in ElementTree.parse(caller_xml).iter('testcase')] == ['test_passing_control']

    broad = run('src/new_feature.py')
    assert broad.returncode == 1 and 'AssertionError: nested-repro' in broad.stdout
    assert 'excluded module was imported' not in broad.stdout
    assert (root / 'test_energy.py.ran').is_file()


def test_missing_pytest_names_the_interpreter_and_offline_development_setup(tmp_path):
    root = Path(__file__).resolve().parents[1]
    subprocess.run([sys.executable, '-m', 'venv', '--without-pip', str(tmp_path / 'dev')],
                   check=True)
    clean_python = tmp_path / 'dev/bin/python'
    import os
    env = {key: value for key, value in os.environ.items()
           if key not in {'PYTHONPATH', 'PYTHONHOME'}}
    result = subprocess.run([str(clean_python), str(root / 'tools/checks.py'),
                             '--paths', 'tools/checks.py', '--run-python'],
                            cwd=tmp_path, env=env, capture_output=True, text=True)
    assert result.returncode == 1
    assert str(clean_python) in result.stderr
    assert 'cannot find pytest' in result.stderr
    assert 'prepared development Python' in result.stderr
    assert 'bash tools/dev-python.sh EXPORTED_RELEASE tools/checks.py' in result.stderr


def test_development_interpreter_selects_worker_and_focused_consumers():
    plan = select(['tools/dev-python.sh'])
    assert plan['native_compute_workspace']
    assert {'tests/test_check_selection.py', 'tests/test_native_integration.py'} <= set(plan['python_tests'])
    assert not plan['broad_qualification'] and not plan['compute_power_validation']


def test_remote_stop_changes_select_session_and_packaged_provenance_consumers():
    for change in ('hermes-remote-terminal-interrupt', 'hermes-remote-terminal-notice'):
        for extension in ('json', 'patch'):
            plan = select([f'deploy/patches/{change}.{extension}'])
            assert {'tests/test_deployment.py', 'tests/test_remote_terminal_interrupt.py'} <= set(plan['python_tests'])
            assert all(plan[key] for key in ('native_shared_sessions', 'desktop_phone_browser', 'native_compute_workspace', 'native_candidate'))
    builder_tests = set(select(['deploy/candidate.py'])['python_tests'])
    assert {'tests/test_native_restore_guard.py', 'tests/test_skill_terminal_paths.py',
            'tests/test_attachment_tool_paths.py', 'tests/test_remote_terminal_interrupt.py'} <= builder_tests


def test_browser_followup_points_to_the_selected_panel_only():
    script = Path(__file__).resolve().parents[1] / 'tools/checks.py'
    for path, panel in [('tests/browser/sparks.mjs', True), ('tests/browser/controls.mjs', False)]:
        output = subprocess.check_output([sys.executable, str(script), '--paths', path, '--run-python'], text=True)
        remaining = json.loads(output.splitlines()[-1])
        assert 'desktop_phone_browser' in remaining['remaining_check_groups']
        assert 'javascript_syntax' in remaining['remaining_check_groups']
        assert 'javascript_syntax_checks' not in remaining
        assert ('sparks_panel_check' in remaining) is panel
        if panel:
            assert remaining['sparks_panel_check']['from_extension_checkout'] == 'python3 tests/browser/run_sparks.py "$baseline"'
    assert select(['src/sparkie_sparks/energy.py'])['sparks_panel']


@pytest.mark.parametrize('path', [
    'tests/browser/dashboard_fixture.py', 'tests/browser/package.json',
    'tests/browser/package-lock.json', 'tools/package_plugins.py', 'themes/sparkie.yaml',
    'plugin/dashboard/manifest.json', 'plugin/dashboard/plugin_api.py', 'src/new_feature.py',
])
def test_shared_dashboard_inputs_select_panel_and_preserve_other_browser_checks(path):
    plan = select([path])
    assert plan['sparks_panel'] and plan['other_desktop_phone_browser']
    assert plan['broad_qualification'] == (path == 'src/new_feature.py')


def test_shared_dashboard_fixture_failure_reaches_maintenance_command(tmp_path):
    root = tmp_path / 'checkout'
    (root / 'tools').mkdir(parents=True)
    (root / 'tests/browser').mkdir(parents=True)
    shutil.copyfile(Path(__file__).resolve().parents[1] / 'tools/checks.py', root / 'tools/checks.py')
    (root / 'tests/browser/run_sparks.py').write_text('raise SystemExit(23)\n')
    result = subprocess.run(
        [sys.executable, 'tools/checks.py', '--paths', 'tests/browser/dashboard_fixture.py',
         '--run-affected', str(tmp_path)], cwd=root, capture_output=True, text=True, timeout=30)
    assert result.returncode == 23
    receipt = json.loads(result.stdout.splitlines()[-1])
    assert receipt['sparks_panel_check']['passed'] is False
    assert 'desktop_phone_browser' in receipt['remaining_check_groups']


@pytest.fixture
def affected_checkout(tmp_path):
    root = tmp_path / 'checkout'
    browser = root / 'tests/browser'
    browser.mkdir(parents=True)
    (root / 'tools').mkdir()
    selector = root / 'tools/checks.py'
    shutil.copyfile(Path(__file__).resolve().parents[1] / 'tools/checks.py', selector)

    def run(*paths):
        result = subprocess.run([sys.executable, str(selector), '--run-affected', str(tmp_path),
                                 '--paths', *paths], cwd=root, capture_output=True, text=True,
                                env=dict(os.environ, TMPDIR=str(tmp_path)), timeout=30)
        return result.returncode, json.loads(result.stdout.splitlines()[-1])

    return browser, run


def test_affected_landing_regression_runs_without_fleet_or_model_checks(affected_checkout):
    path = checks['COLD_LANDING_TEST']
    plan = select([path])
    assert not plan['python_tests']
    assert {group for group in checks['GROUPS'] if plan[group]} == {'javascript_syntax', 'webapp_cold_landing'}
    browser, run = affected_checkout
    regression = browser.parent.parent / path
    regression.parent.mkdir()
    for status in (0, 1):
        regression.write_text(f"import test from 'node:test';\ntest('landing', () => {{ if ({status}) throw Error('failed'); }});")
        code, result = run(path)
        observed = result['webapp_cold_landing_check']
        assert observed['command'] == ['node', '--test', '--', path]
        assert code == observed['exit_code'] == status
        assert result['remaining_check_groups'] == ([] if status == 0 else ['webapp_cold_landing'])


def test_run_affected_records_browser_failures_and_preserves_other_groups(tmp_path, affected_checkout):
    browser, run = affected_checkout
    helper = browser / 'run_sparks.py'
    helper.write_text(
        "from pathlib import Path\nimport json, sys\n"
        "baseline, out = map(Path, sys.argv[1:])\nout.mkdir()\n"
        "code = int((baseline / 'browser-status').read_text())\n"
        "(out / 'result.json').write_text(json.dumps({'passed': code == 0}))\n"
        "print('observed browser run')\nraise SystemExit(code)\n")
    status = tmp_path / 'browser-status'

    status.write_text('7')
    code, result = run('tests/browser/sparks.mjs')
    observed = result['sparks_panel_check']
    assert code == observed['exit_code'] == 7 and not observed['passed']
    assert json.loads(Path(observed['report']).read_text()) == {'passed': False}
    assert 'observed browser run' in Path(observed['log']).read_text()
    assert 'desktop_phone_browser' in result['remaining_check_groups']

    status.write_text('0')
    code, result = run('tests/browser/sparks.mjs')
    assert code == 0 and result['sparks_panel_check']['passed']
    assert result['remaining_check_groups'] == ['javascript_syntax']
    code, result = run('tests/browser/sparks.mjs', 'tests/browser/controls.mjs')
    assert code == 0 and result['sparks_panel_check']['passed']
    assert 'desktop_phone_browser' in result['remaining_check_groups']

    helper.write_text("raise SystemExit('Missing Chromium')\n")
    code, result = run('tests/browser/sparks.mjs')
    observed = result['sparks_panel_check']
    assert code == observed['exit_code'] == 1 and not observed['passed']
    assert observed['report'] is None and 'Missing Chromium' in Path(observed['log']).read_text()
    helper.write_text('pass\n')
    code, result = run('tests/browser/sparks.mjs')
    observed = result['sparks_panel_check']
    assert code == 1 and observed['exit_code'] == 0 and not observed['passed']
    assert 'without a passing result.json' in Path(observed['log']).read_text()

    helper.unlink()
    code, result = run('tests/browser/controls.mjs')
    assert code == 0 and 'sparks_panel_check' not in result
    assert 'desktop_phone_browser' in result['remaining_check_groups']


@pytest.mark.skipif(shutil.which('node') is None, reason='Node is required to exercise its syntax checker')
def test_affected_syntax_checks_changed_sources_and_keeps_unverified_groups(affected_checkout):
    browser, run = affected_checkout
    paths = ['tests/browser/controls.mjs', 'tests/browser/space name.cjs']
    for path in paths:
        (browser / Path(path).name).write_text("throw new Error('must not execute');\n")
    code, result = run('sparkie/' + paths[0], *paths)
    checks = result['javascript_syntax_checks']
    assert code == 0 and result['remaining_check_groups'] == ['desktop_phone_browser']
    assert checks == [{'command': ['node', '--check', '--', path], 'exit_code': 0} for path in paths]

    code, result = run(*paths, 'tests/browser/shared.py', 'tests/browser/deleted.js')
    assert code == 0 and result['javascript_syntax_checks'] == checks
    assert result['remaining_check_groups'] == ['javascript_syntax', 'desktop_phone_browser']

    (browser / 'controls.mjs').write_text('const broken = ;\n')
    code, result = run(*paths)
    failed, passed = result['javascript_syntax_checks']
    assert failed['exit_code'] == code != 0 and passed == checks[1]
    assert result['remaining_check_groups'] == ['javascript_syntax', 'desktop_phone_browser']


def test_affected_syntax_reports_an_unavailable_node(affected_checkout, monkeypatch):
    browser, run = affected_checkout
    (browser / 'controls.mjs').write_text('const valid = 1;\n')
    monkeypatch.setenv('PATH', '')
    code, result = run('tests/browser/controls.mjs')
    check, = result['javascript_syntax_checks']
    assert code != 0 and check['exit_code'] is None and 'node' in check['error']
    assert 'javascript_syntax' in result['remaining_check_groups']


@pytest.mark.parametrize('path', ['deploy/caddy_routes.py', 'deploy/caddy_site.py', 'tests/hardware/caddy_edge.py'])
def test_caddy_edits_select_the_real_edge_and_both_route_checks(path):
    plan = select([path])
    assert plan['caddy_edge_rehearsal'] and plan['native_candidate']
    assert {'tests/test_caddy_public_ingress.py', 'tests/test_caddy_site_bootstrap.py'} <= set(plan['python_tests'])
    assert not plan['broad_qualification'] and not plan['compact_local_behavior']

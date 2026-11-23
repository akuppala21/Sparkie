from pathlib import Path
import runpy

select = runpy.run_path(str(Path(__file__).resolve().parents[1] / 'tools/checks.py'))['selection']


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
    assert 'tests/test_energy.py' in plan['python_tests']


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


def test_memory_feedback_and_cleanup_changes_include_native_consumers():
    memory = select(['src/sparkie_sparks/memory_controls.py'])
    assert 'tests/test_memory_correction_feedback.py' in memory['python_tests']
    assert memory['compact_local_behavior'] and memory['native_shared_sessions']
    for path in ('tests/sandbox_cleanup.py', 'tests/native_docker_fixture.py'):
        cleanup = select([path])
        assert 'tests/test_sandbox_cleanup.py' in cleanup['python_tests']
        assert cleanup['compact_local_behavior'] is path.endswith('sandbox_cleanup.py')
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
    skill = select(['sparkie/skills/ops/steps.md'])
    consumers = set(prompt['python_tests'])
    assert {'tests/test_fleet.py', 'tests/test_energy.py'} <= consumers
    assert consumers <= set(skill['python_tests'])


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

#!/usr/bin/env python3
"""Small changed-file map around pytest and native browser/model checks.

This selects checks; it is not a new runner, scheduler or release approval.
"""

import argparse
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
FLEET = {'test_fleet.py', 'test_collector.py', 'test_local_observation.py', 'test_fleet_plugs.py', 'test_network_links.py', 'test_native_integration.py'}
ENERGY = {'test_energy.py', 'test_energy_power.py', 'test_energy_periods.py', 'test_energy_history.py', 'test_energy_integration.py', 'test_matter.py', 'test_fleet_plugs.py'}
ADAPTERS = {'test_native_integration.py', 'test_energy_integration.py'}
SERVICES = {'test_recipe_services.py', 'test_service_access.py', 'test_endpoint_relay.py',
            'test_service_ingress_deployment.py', 'test_service_enrollment.py'}
UPDATES = {'test_application_updates.py', 'test_application_upgrade.py', 'test_update_transports.py'}
OPERATIONS = SERVICES | UPDATES | {'test_operations.py', 'test_authority.py', 'test_native_authority.py', 'test_native_controls.py', 'test_controls_availability.py', 'test_composition_review.py', 'test_broker.py', 'test_proposals.py', 'test_proposal_reconciliation.py', 'test_recovery_replies.py', 'test_notices.py'}
WORKLOADS = {'test_workloads.py'} | OPERATIONS
POWER = {'test_power.py', 'test_power_worker.py', 'test_power_sequence.py', 'test_power_activity.py',
         'test_power_maintenance.py', 'test_idle.py'} | OPERATIONS
COMPUTE = {'test_sandbox_ssh.py', 'test_sandbox_provider.py', 'test_workspace_leases.py',
           'test_workspace_worker.py', 'test_workspace_idle.py', 'test_workspace_remote.py',
           'test_workspace_service.py', 'test_placement.py', 'test_native_config.py'}
AUTH = OPERATIONS | {'test_owner_login.py', 'test_native_config.py'}
MEMORY = {'test_memory_erase.py', 'test_memory_correction_feedback.py', 'test_native_controls.py', 'test_native_integration.py', 'test_broker.py'}
CATALOG = {'test_dashboard_packaging.py', 'test_recipes.py'}
THEME = {'test_dashboard_packaging.py', 'test_managed_config.py', 'test_deployment.py'}
NATIVE = FLEET | ENERGY | WORKLOADS | POWER | COMPUTE | AUTH | MEMORY
DEPLOY = NATIVE | {'test_deployment.py', 'test_installation_paths.py', 'test_model_unit.py', 'test_brain_switch.py', 'test_serve_route.py', 'test_promote.py', 'test_promotion_preservation.py', 'test_managed_config.py', 'test_worker_stage.py'}
GROUPS = ('javascript_syntax', 'desktop_phone_browser', 'compact_local_behavior',
          'native_execution_isolation', 'native_compute_workspace', 'enrolled_service_lifecycle', 'native_research',
          'disposable_workload_stop', 'private_broker_stop', 'native_shared_sessions',
          'compute_power_validation', 'native_candidate', 'broad_qualification')


def selection(paths):
    tests, reasons = set(), []
    browser = behavior = broad = syntax = isolation = workload = sessions = broker = False
    compute = services = research = power = candidate = False
    for original in sorted(set(paths)):
        path = original.removeprefix('sparkie/')
        if path in ('src/sparkie_sparks/application_updates.py', 'src/sparkie_sparks/update_proposals.py',
                    'deploy/upgrade.py', 'deploy/upgrade_installation.py'):
            tests.update(UPDATES | OPERATIONS | {'test_deployment.py', 'test_installation_paths.py',
                          'test_promote.py', 'test_promotion_preservation.py'})
            browser = broker = candidate = True
            behavior = path.endswith('update_proposals.py') or behavior
            compute = path.endswith('update_proposals.py') or compute
            reasons.append(original + ': exact application update review, native transfer, owner parity, interrupted handover and rollback')
        elif path in ('skills/local-recipe-review/scripts/read_forum.py',
                      'skills/local-recipe-review/scripts/read_github_readme.py',
                      'skills/local-recipe-review/scripts/read_manual.py',
                      'skills/local-recipe-review/scripts/check_evidence.py',
                      'skills/local-recipe-review/SKILL.md',
                      'skills/one-spark-serving-results/SKILL.md'):
            tests.update({'test_forum_reader.py', 'test_github_readme.py', 'test_research_claims.py', 'test_native_config.py'})
            if path in {'skills/local-recipe-review/scripts/read_manual.py', 'skills/local-recipe-review/SKILL.md'}:
                tests.add('test_manual_reader.py')
            if path == 'skills/one-spark-serving-results/SKILL.md':
                tests.add('test_cache_measurement.py')
            research = behavior = True
            reasons.append(original + ': original-source readers, fleet measurements and native research skill discovery')
        elif path == 'skills/one-spark-serving-results/scripts/measure_cache.py':
            tests.update({'test_cache_measurement.py', 'test_native_config.py'})
            research = behavior = True
            reasons.append(original + ': matched cache measurements, saved receipts and native skill use')
        elif path == 'tools/check_research_evidence.py':
            tests.add('test_research_claims.py')
            reasons.append(original + ': developer-only quote and arithmetic utility; not loaded in agent conversations')
        elif Path(path).name in ('SOUL.md', 'AGENTS.md', 'USER.md', 'MEMORY.md', 'SKILL.md') or path.startswith(('prompts/', 'skills/')):
            tests.update(FLEET | ENERGY)
            behavior = True
            reasons.append(original + ': agent instructions or runtime prompt changed')
        elif path.endswith('.md'):
            reasons.append(original + ': document review')
        elif path in ('src/sparkie_sparks/fleet.py', 'src/sparkie_sparks/collector.py', 'src/sparkie_sparks/probe.py'):
            tests.update(FLEET)
            if path.endswith('collector.py'):
                tests.update(COMPUTE | POWER)
            browser = behavior = True
            reasons.append(original + ': fleet producer, native consumers and observation behavior')
        elif path in ('src/sparkie_sparks/energy.py', 'src/sparkie_sparks/energy_history.py'):
            tests.update(ENERGY)
            browser = True
            reasons.append(original + ': electricity calculations, history and both consumers')
        elif path == 'src/sparkie_sparks/matter.py':
            tests.update(FLEET | ENERGY | POWER)
            behavior = True
            reasons.append(original + ': meter identities, units and fleet power observations')
        elif path == 'src/sparkie_sparks/io_budget.py':
            tests.update(POWER | COMPUTE | {'test_io_budget.py', 'test_matter.py'})
            reasons.append(original + ': bounded maintenance I/O, power evidence and workspace transport consumers')
        elif path in ('src/sparkie_sparks/memory_controls.py', 'src/sparkie_sparks/memory_erase.py'):
            tests.update(MEMORY)
            browser = behavior = sessions = True
            reasons.append(original + ': exact-owner erasure, native memory and searchable conversation data')
        elif path == 'src/sparkie_sparks/recovery_replies.py':
            tests.update({'test_recovery_replies.py', 'test_proposals.py',
                          'test_proposal_reconciliation.py', 'test_native_controls.py'})
            behavior = sessions = True
            reasons.append(original + ': current-turn checked replies, native middleware, streaming and transcript consumers')
        elif path in ('src/sparkie_sparks/operations.py', 'src/sparkie_sparks/authority.py',
                      'src/sparkie_sparks/controls.py', 'src/sparkie_sparks/web_controls.py',
                      'src/sparkie_sparks/telegram_controls.py', 'src/sparkie_sparks/broker.py',
                      'src/sparkie_sparks/proposals.py', 'src/sparkie_sparks/notices.py'):
            tests.update(WORKLOADS | POWER)
            services = True
            behavior = True
            broker = True
            if path.endswith('broker.py'):
                tests.update(COMPUTE)
                compute = True
            browser = path.endswith(('controls.py', 'broker.py')) or browser
            sessions = path.endswith(('authority.py', 'web_controls.py', 'telegram_controls.py')) or sessions
            reasons.append(original + ': owner identity, exact approvals, duplicate prevention and restart recovery; live transport qualification remains separate')
        elif path in ('tests/browser/services.mjs', 'tests/browser/services_fixture.py',
                      'tests/browser/artifact_ingress.mjs', 'tests/browser/artifact_ingress_fixture.py'):
            tests.update(SERVICES | {'test_dashboard_packaging.py'})
            browser = syntax = True
            reasons.append(original + ': Services browser interactions, owner gates, data interfaces and proxy')
        elif path in ('src/sparkie_sparks/recipe_services.py', 'src/sparkie_sparks/service_remote.py',
                      'src/sparkie_sparks/service_worker.py', 'src/sparkie_sparks/service_definitions.py',
                      'src/sparkie_sparks/service_access.py', 'src/sparkie_sparks/endpoint_relay.py',
                      'deploy/service_ingress.py', 'deploy/service_enrollment.py', 'deploy/service_worker_stage.py',
                      'tests/hardware/service_ingress.py', 'tests/hardware/recipe_services.py',
                      'tests/hardware/service_stage.py'):
            tests.update(POWER | COMPUTE | WORKLOADS | {'test_worker_stage.py', 'test_deployment.py', 'test_promote.py'})
            behavior = broker = browser = compute = services = True
            candidate = path.startswith('deploy/') or candidate
            reasons.append(original + ': enrolled services, exclusive resources, owner access and real Compose lifecycle')
        elif path == 'src/sparkie_sparks/composition.py':
            tests.update(WORKLOADS | POWER)
            browser = broker = services = True
            reasons.append(original + ': configured adapters and per-Spark availability through both owner paths')
        elif path in ('src/sparkie_sparks/recipes.py', 'recipes_plugin/plugin.yaml',
                      'recipes_plugin/dashboard/index.js', 'recipes_plugin/dashboard/plugin_api.py',
                      'recipes_plugin/dashboard/manifest.json'):
            tests.update(CATALOG)
            browser = syntax = True
            reasons.append(original + ': reviewed recipe records, native discovery, dashboard API and owner view')
        elif path == 'themes/sparkie.yaml':
            tests.update(THEME)
            browser = True
            reasons.append(original + ': staged theme, native discovery and owner theme preferences')
        elif path in ('deploy/patches/hermes-sandbox-skill-path.patch', 'deploy/patches/hermes-sandbox-skill-path.json',
                      'tests/test_skill_terminal_paths.py'):
            tests.update({'test_skill_terminal_paths.py', 'test_native_config.py', 'test_native_restore_guard.py',
                          'test_deployment.py', 'test_sandbox_provider.py'})
            candidate = compute = research = behavior = True
            reasons.append(original + ': packaged native skill footer and compute workspace paths')
        elif path in ('deploy/patches/hermes-sealed-web-restore.patch',
                      'deploy/patches/hermes-sealed-web-restore.json', 'tests/test_native_restore_guard.py'):
            tests.update({'test_native_restore_guard.py', 'test_owner_login.py', 'test_deployment.py',
                          'test_promote.py', 'test_promotion_preservation.py'})
            candidate = True
            reasons.append(original + ': packaged restore routes on both native entry points, owner authentication, backup/export and recovery')
        elif path == 'deploy/patches/hermes-dashboard-root-discovery.patch':
            tests.update(CATALOG | {'test_owner_login.py'})
            browser = syntax = True
            reasons.append(original + ': pinned frontend root routing; rebuild static dashboard, check native routes and fresh profile entry at desktop/phone sizes')
        elif path in ('src/sparkie_sparks/owner_login.py', 'tools/package_plugins.py'):
            tests.update(AUTH)
            if path == 'tools/package_plugins.py':
                tests.update(CATALOG)
                syntax = True
            browser = sessions = True
            reasons.append(original + ': native owner login, packaged providers, HTTP/API/WebSocket admission, provider reload and private controls')
        elif path in ('src/sparkie_sparks/power.py', 'src/sparkie_sparks/power_worker.py',
                      'src/sparkie_sparks/power_sequence.py', 'src/sparkie_sparks/power_maintenance.py',
                      'src/sparkie_sparks/idle.py'):
            tests.update(POWER | {'test_matter.py'})
            if path.endswith('idle.py'):
                tests.update(COMPUTE)
            power = True
            reasons.append(original + ': physical identity, exact confirmation, wake and shutdown evidence; qualify affected hardware behavior before enabling it')
        elif path in ('src/sparkie_sparks/sandbox_ssh.py', 'src/sparkie_sparks/sandbox_provider.py',
                      'src/sparkie_sparks/workspace_types.py', 'src/sparkie_sparks/workspace_leases.py',
                      'src/sparkie_sparks/workspace_worker.py', 'src/sparkie_sparks/workspace_remote.py',
                      'src/sparkie_sparks/workspace_service.py', 'src/sparkie_sparks/placement.py',
                      'src/sparkie_sparks/release_hints.py'):
            tests.update(COMPUTE)
            if path.endswith(('workspace_remote.py', 'workspace_service.py')):
                tests.update(OPERATIONS)
            compute = True
            reasons.append(original + ': enrolled sandbox identity and real native compute execution, file and stream consumers')
        elif path in ('src/sparkie_sparks/workloads.py', 'src/sparkie_sparks/workload_worker.py'):
            tests.update(WORKLOADS)
            workload = behavior = True
            reasons.append(original + ': exact workload identity, protected services, stop observations and disposable real-container check')
        elif path == 'plugin/dashboard/index.js':
            tests.update(SERVICES | UPDATES | ADAPTERS | {'test_dashboard_packaging.py', 'test_native_controls.py', 'test_controls_availability.py'})
            browser = syntax = True
            reasons.append(original + ': panel syntax, data interfaces and desktop/phone interactions')
        elif path.startswith('plugin/'):
            tests.update(NATIVE)
            if path == 'plugin/dashboard/manifest.json':
                tests.update(CATALOG)
            browser = behavior = syntax = True
            research = compute = True
            reasons.append(original + ': native plugin registration, API and tool schemas')
        elif path.startswith('tests/browser/'):
            browser = syntax = True
            reasons.append(original + ': browser validation itself changed')
        elif path.startswith('tests/behavior/'):
            if path == 'tests/behavior/native_acceptance.py':
                tests.add('test_compact_replays.py')
            tests.update(ADAPTERS | {'test_sandbox_cleanup.py'})
            behavior = True
            reasons.append(original + ': compact behavior evaluation changed')
        elif path.startswith('tests/research/'):
            tests.update({'test_native_config.py', 'test_sandbox_cleanup.py'})
            research = True
            reasons.append(original + ': native public-source search and reading qualification changed')
        elif path in ('tests/sandbox_cleanup.py', 'tests/native_docker_fixture.py'):
            tests.add('test_sandbox_cleanup.py')
            behavior = path.endswith('sandbox_cleanup.py') or behavior
            research = isolation = True
            reasons.append(original + ': isolated Docker fixture and cleanup absence proof shared by native checks')
        elif path.startswith('tests/hardware/'):
            tests.update(ADAPTERS | {'test_native_config.py'})
            if path.endswith('broker_stop.py'):
                broker = True
                tests.update(WORKLOADS)
            elif path.endswith('workload_stop.py'):
                workload = True
                tests.update(WORKLOADS)
            elif path.endswith(('native_ssh.py', 'ssh-sandbox.Dockerfile', 'workspace_allocation.py',
                                'cross_workspace.py', 'workspace_idle.py')):
                compute = True
                tests.update(COMPUTE)
            elif path.endswith('power_cycle.py'):
                power = True
                tests.update(POWER)
            elif path.endswith('model_recovery.py'):
                candidate = behavior = True
                tests.update({'test_model_unit.py', 'test_native_config.py'})
            elif path.endswith('protected_home.py'):
                candidate = isolation = True
                tests.update({'test_deployment.py', 'test_broker.py', 'test_native_config.py', 'test_managed_config.py'})
            elif path.endswith('native_sandbox.py'):
                isolation = True
                tests.add('test_sandbox_cleanup.py')
            else:
                broad = browser = behavior = syntax = isolation = workload = sessions = broker = True
                compute = research = power = True
            reasons.append(original + ': affected real execution fixture changed; use a disposable compute workload')
        elif path in ('deploy/protected_home.py', 'deploy/managed_config.py'):
            tests.update(DEPLOY)
            services = True
            candidate = sessions = isolation = behavior = True
            reasons.append(original + ': native managed settings, owner-editable preferences, local routing and protected host execution paths')
        elif path.startswith('deploy/'):
            tests.update(DEPLOY)
            if path == 'deploy/candidate.py':
                tests.update({'test_native_restore_guard.py', 'test_skill_terminal_paths.py'})
            services = True
            if path == 'deploy/stage.py':
                tests.update(THEME)
                browser = True
            if path in ('deploy/model_unit.py', 'deploy/brain_switch.py'):
                behavior = True
            candidate = sessions = True
            reasons.append(original + ': sealed packaging, native startup and recovery, configured consumers; no automatic live install')
        elif path == 'tests/upstream-sessions.json':
            sessions = True
            reasons.append(original + ': maintained upstream session/streaming/restart selection changed')
        elif path.startswith('tests/test_') and path.endswith('.py') and (ROOT / path).is_file():
            tests.add(Path(path).name)
            reasons.append(original + ': changed test')
        elif path == 'upstream.lock.json':
            tests.update(DEPLOY)
            services = True
            candidate = True
            browser = behavior = isolation = compute = sessions = broker = research = True
            reasons.append(original + ': Hermes and dependency pin changed; include every configured native consumer and inspect reusable receipts')
        elif path.startswith('models/'):
            tests.update(FLEET | ENERGY)
            if path in ('models/main-model.json', 'models/dealign-flash-next.json'):
                tests.update(CATALOG)
            if path in ('models/main-model.json', 'models/alternate-model.json'):
                tests.update({'test_model_unit.py', 'test_brain_switch.py', 'test_native_config.py',
                              'test_deployment.py', 'test_installation_paths.py', 'test_promote.py',
                              'test_promotion_preservation.py'})
                candidate = sessions = True
            browser = behavior = True
            reasons.append(original + ': pinned model setup and local behavior; inspect reusable receipts')
        elif path == 'config/hermes.example.yaml':
            tests.update(DEPLOY)
            services = True
            candidate = True
            browser = behavior = isolation = compute = sessions = broker = research = True
            reasons.append(original + ': common native runtime configuration and all configured consumers')
        elif path == 'config/sandbox.lock.json':
            tests.update(COMPUTE)
            isolation = compute = research = True
            reasons.append(original + ': sandbox image shared by native execution and source-reading fixtures')
        elif path == 'config/fleet.example.json':
            tests.update(FLEET | ENERGY | POWER | {'test_native_config.py'})
            behavior = True
            reasons.append(original + ': inventory or meter configuration')
        elif path == 'tools/checks.py':
            tests.update({'test_check_selection.py', 'test_preservation_selection.py'})
            reasons.append(original + ': changed-path selection regressions and existing registration smoke')
        else:
            broad = browser = behavior = syntax = isolation = workload = sessions = broker = True
            compute = research = power = candidate = True
            reasons.append(original + ': impact is not classified; include all extension tests and integration checks')
    if broad:
        tests = {p.name for p in (ROOT / 'tests').glob('test_*.py')}
        candidate = True
    # Even a small functional change gets the existing native registration/API smoke.
    if tests:
        tests.update(ADAPTERS)
    return {'python_tests': ['tests/' + name for name in sorted(tests)],
            'javascript_syntax': syntax, 'desktop_phone_browser': browser,
            'compact_local_behavior': behavior, 'native_execution_isolation': isolation,
            'native_compute_workspace': compute, 'enrolled_service_lifecycle': services or broad, 'native_research': research,
            'disposable_workload_stop': workload,
            'private_broker_stop': broker, 'native_shared_sessions': sessions,
            'compute_power_validation': power,
            'native_candidate': candidate,
            'broad_qualification': broad, 'reasons': reasons}


def changed_paths(base):
    tree = subprocess.check_output(['git', 'rev-parse', '--show-toplevel'], cwd=ROOT)
    repo = Path(os.fsdecode(tree.removesuffix(b'\n'))).resolve()
    extension = ROOT.relative_to(repo).as_posix()
    scope = [extension]
    if extension != '.':
        scope.extend(['AGENTS.md', 'README.md', 'docs/contract.md', 'docs/architecture.md', 'docs/hermes-testing.md'])
    git = ['git', '--literal-pathspecs']
    changed = subprocess.check_output([*git, 'diff', '--no-renames', '--name-only', '-z', base, '--', *scope], cwd=repo)
    untracked = subprocess.check_output([*git, 'ls-files', '--others', '--exclude-standard', '-z', '--', *scope], cwd=repo)
    paths = [path for path in os.fsdecode(changed + untracked).split('\0') if path]
    if extension not in ('.', 'sparkie'):
        # Explicit --paths accepts extension-relative paths, regardless of checkout name.
        return [path.removeprefix(extension + '/') for path in paths]
    return paths


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--paths', nargs='+', help='Explicit changed paths, including renamed/deleted files.')
    parser.add_argument('--base', default='HEAD', help='Git baseline; includes tracked changes and new files.')
    parser.add_argument('--run-python', action='store_true', help='Run the selected pytest group on this compute Spark.')
    args = parser.parse_args()
    try:
        plan = selection(args.paths if args.paths is not None else changed_paths(args.base))
    except (OSError, subprocess.CalledProcessError):
        parser.error('Could not inspect changes. Provide --paths or a valid Git baseline.')
    print(json.dumps(plan, indent=2), flush=True)
    if args.run_python and plan['python_tests']:
        code = subprocess.call([sys.executable, '-m', 'pytest', *plan['python_tests']], cwd=ROOT)
        if code:
            return code
    if args.run_python:
        remaining = [name for name in GROUPS if plan[name]]
        print(json.dumps({'remaining_check_groups': remaining, 'release_qualified': False}))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())

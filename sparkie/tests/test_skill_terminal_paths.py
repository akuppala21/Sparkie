"""Check model-facing skill footers on the patched Hermes runtime."""
from agent import skill_commands


def create_skill(root, name='demo'):
    directory = root / name
    (directory / 'scripts').mkdir(parents=True)
    (directory / 'SKILL.md').write_text('---\nname: demo\ndescription: Read the demonstration.\n---\nRead the marker.\n')
    (directory / 'scripts/helper.py').write_text('print("sample")\n')
    return directory


def render(skill, task=None):
    return skill_commands._build_skill_message(
        {'name': 'demo', 'content': 'Read the marker.', 'linked_files': {'scripts': ['scripts/helper.py']}},
        skill, 'Activated', session_id=task)


def test_profile_local_docker_and_provider_projection(tmp_path, monkeypatch):
    from agent.terminal_env_registry import register_provider
    from sparkie_sparks.sandbox_provider import SparkComputeProvider
    from tools.credential_files import iter_skills_files
    home = tmp_path/'profile'
    monkeypatch.setenv('HERMES_HOME', str(home))
    skill = create_skill(home/'skills', 'nested/demo')
    monkeypatch.setenv('TERMINAL_ENV', 'local')
    assert f'[Skill directory: {skill}]' in render(skill)
    assert f'node {skill}/scripts/foo.js' in render(skill)
    monkeypatch.setenv('TERMINAL_ENV', 'docker')
    remote = render(skill)
    assert '[Terminal skill directory: /root/.hermes/skills/nested/demo]' in remote and str(home) not in remote
    assert 'skill_view(name="nested/demo"' in remote
    assert skill_commands._auto_load_typed_text(remote + '\nOwner follow-up') == 'Owner follow-up'
    monkeypatch.setenv('TERMINAL_ENV', 'spark_compute')
    register_provider(SparkComputeProvider(), scope=str(home))
    base = SparkComputeProvider.cache_path_base
    rendered = render(skill)
    assert f'[Terminal skill directory: {base}/skills/nested/demo]' in rendered and str(home) not in rendered
    assert any(item['container_path'] == base + '/skills/nested/demo/scripts/helper.py'
               for item in iter_skills_files(base))


def test_external_project_and_unavailable_paths(tmp_path, monkeypatch):
    from agent import skill_utils
    home = tmp_path/'profile'
    (home / 'skills').mkdir(parents=True)
    monkeypatch.setenv('HERMES_HOME', str(home))
    monkeypatch.setenv('TERMINAL_ENV', 'docker')
    for getter, destination in [('get_external_skills_dirs', 'external_skills'), ('get_project_skills_dirs','project_skills')]:
        root = tmp_path / getter
        skill = create_skill(root)
        monkeypatch.setattr(skill_utils, getter, lambda root=root: [root])
        assert f'[Terminal skill directory: /root/.hermes/{destination}/0/demo]' in render(skill)
    outside = create_skill(tmp_path/'unsynced')
    inaccessible = render(outside)
    assert 'no verified terminal directory' in inaccessible and str(outside) not in inaccessible
    assert 'skill_view(name="demo"' in inaccessible
    symlinked = home/'skills'/'link'
    symlinked.symlink_to(outside, target_is_directory=True)
    assert 'no verified terminal directory' in render(symlinked)
    linkedfile = create_skill(home/'skills')
    (linkedfile/'scripts/helper.py').unlink()
    (linkedfile/'scripts/helper.py').symlink_to(outside/'scripts/helper.py')
    assert 'no verified terminal directory' in render(linkedfile)
    assert 'no verified terminal directory' in render(create_skill(home/'skills'/'.archive'))
    assert skill_commands._auto_load_typed_text(inaccessible + '\nOwner follow-up') == 'Owner follow-up'


def test_current_task_can_override_profile_backend(tmp_path, monkeypatch):
    from tools import terminal_tool
    home = tmp_path / 'profile'
    skill = create_skill(home/'skills')
    monkeypatch.setenv('HERMES_HOME', str(home))
    monkeypatch.setenv('TERMINAL_ENV', 'docker')
    monkeypatch.setattr(terminal_tool, 'resolve_task_overrides', lambda task: {'env_type':'local'} if task == 'local-task' else {})
    assert f'[Skill directory: {skill}]' in render(skill, 'local-task')

def test_autoload_preserves_literal_sandbox_footer_in_owner_text_after_restart(tmp_path, monkeypatch):
    home = tmp_path/'profile'
    monkeypatch.setenv('HERMES_HOME', str(home))
    monkeypatch.setenv('TERMINAL_ENV', 'docker')
    skill = create_skill(home/'skills')
    head = '[IMPORTANT: The "demo" skill is auto-loaded. Follow its instructions for this session.]'
    block = render(skill).replace('Activated', head, 1)
    footer = block[block.index('[Terminal skill directory:'):]
    for owner in ('Explain [End of sandbox skill paths.] please.',
                  'Quoted marker on its own line:\n[End of sandbox skill paths.]\nWhat emits it?',
                  'Quoted entire footer:\n' + footer + '\nWhy?',
                  'The older instruction ends: then run them with the terminal tool using the absolute path.'):
        two_skills_then_owner = block + '\n\n' + block + '\n\n' + owner
        assert skill_commands.extract_user_instruction_from_skill_message(two_skills_then_owner) == owner

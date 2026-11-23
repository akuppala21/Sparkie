"""Check the actual model input produced by the pinned native @file expansion."""
import json

from agent.context_references import preprocess_context_references
from agent.terminal_env_registry import register_provider

from sparkie_sparks.sandbox_provider import SparkComputeProvider


def test_inline_attachment_identifies_the_compute_tool_path(tmp_path, monkeypatch):
    home = tmp_path / 'owner' / '.hermes'
    monkeypatch.setenv('HERMES_HOME', str(home))
    monkeypatch.setenv('TERMINAL_ENV', 'spark_compute')
    register_provider(SparkComputeProvider(), scope=str(home))
    attachment = home / 'attachments' / 'notes and plans.txt'
    attachment.parent.mkdir(parents=True)
    attachment.write_text('first\nsecond\nthird\n')
    prompt = 'Summarize @file:".hermes/attachments/notes and plans.txt":2-2'

    result = preprocess_context_references(prompt, cwd=home.parent, context_length=64000)
    expected = SparkComputeProvider.cache_path_base + '/attachments/' + attachment.name
    assert result.original_message == prompt
    assert result.message.startswith(prompt)
    assert f'File tools use {json.dumps(expected)}.' in result.message
    assert '\nsecond\n' in result.message
    assert 'first' not in result.message and 'third' not in result.message

    monkeypatch.setenv('TERMINAL_ENV', 'local')
    local = preprocess_context_references(prompt, cwd=home.parent, context_length=64000)
    assert 'File tools use' not in local.message
    assert '\nsecond\n' in local.message


def test_unmounted_file_and_other_profile_keep_their_boundaries(tmp_path, monkeypatch):
    home = tmp_path / 'owner'
    workspace = tmp_path / 'project'
    other = tmp_path / 'another-profile' / 'attachments' / 'private.txt'
    monkeypatch.setenv('HERMES_HOME', str(home))
    monkeypatch.setenv('TERMINAL_ENV', 'spark_compute')
    register_provider(SparkComputeProvider(), scope=str(home))
    workspace.mkdir()
    (workspace / 'notes.txt').write_text('project memo')
    other.parent.mkdir(parents=True)
    other.write_text('other profile memo')

    result = preprocess_context_references(f'@file:notes.txt @file:{other}', cwd=workspace, context_length=64000)
    assert 'project memo' in result.message
    assert 'other profile memo' not in result.message
    assert any('outside the allowed workspace' in warning for warning in result.warnings)
    assert 'File tools use' not in result.message

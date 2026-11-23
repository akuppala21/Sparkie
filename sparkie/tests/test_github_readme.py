"""The public README reader binds one versioned request to the exact saved Git blob."""
import base64
from email.message import Message
import hashlib
from importlib.util import module_from_spec, spec_from_file_location
import io
import json
from pathlib import Path
from urllib.error import HTTPError

import pytest


path = Path(__file__).resolve().parents[1] / 'skills/local-recipe-review/scripts/read_github_readme.py'
spec = spec_from_file_location('github_readme', path)
reader = module_from_spec(spec)
spec.loader.exec_module(reader)

BODY = b'# Tool\r\n\n| original | 2 |\n'
SHA = hashlib.sha1(b'blob ' + str(len(BODY)).encode() + b'\0' + BODY).hexdigest()
SOURCE = 'https://github.com/example/tool/blob/tags/v2/docs/README.md'
METADATA = {'type': 'file', 'encoding': 'base64', 'content': base64.encodebytes(BODY).decode(),
            'html_url': SOURCE, 'sha': SHA, 'size': len(BODY)}


def mock_api(monkeypatch, metadata):
    calls = []

    class Response(io.BytesIO):
        headers = Message()

    class Opener:
        def open(self, request, timeout):
            calls.append(request)
            assert timeout == 15
            if isinstance(metadata, Exception):
                raise metadata
            stream = Response(json.dumps(metadata).encode())
            stream.headers['Content-Type'] = 'application/json'
            return stream

    monkeypatch.setattr(reader, 'build_opener', lambda *handlers: Opener())
    return calls


@pytest.mark.parametrize('ref,query', [('tags/v2', '?ref=tags%2Fv2'), (None, '')])
def test_saves_only_the_original_at_requested_ref(tmp_path, monkeypatch, ref, query):
    calls = mock_api(monkeypatch, METADATA)
    result = reader.save_readme('example/tool', ref, tmp_path)
    assert [(req.get_method(), req.full_url) for req in calls] == [('GET', 'https://api.github.com/repos/example/tool/readme' + query)]
    assert not calls[0].get_header('Authorization')
    assert result['source'] == SOURCE and result['requested_ref'] == ref
    assert result['immutable_blob'] == 'https://api.github.com/repos/example/tool/git/blobs/' + SHA
    assert result['bytes'] == len(BODY)
    assert list(tmp_path.iterdir()) == [Path(result['file'])]
    assert Path(result['file']).read_bytes() == BODY


@pytest.mark.parametrize('override', [{'html_url': 'https://github.com/example/toolx/blob/v2/README.md'},
                                      {'sha': '0' * 40}, {'size': 0}, {'encoding': 'none'}])
def test_bad_or_incomplete_original_produces_no_file(tmp_path, monkeypatch, override):
    mock_api(monkeypatch, METADATA | override)
    with pytest.raises(ValueError):
        reader.save_readme('example/tool', 'v2', tmp_path)
    assert not list(tmp_path.iterdir())


@pytest.mark.parametrize('repository', ['https://example.org/o/r', 'o/..', 'git@github.com:o/r', 'o/r?token=x'])
def test_only_repository_names_reach_public_origin(tmp_path, monkeypatch, repository):
    calls = mock_api(monkeypatch, METADATA)
    with pytest.raises(ValueError):
        reader.save_readme(repository, None, tmp_path)
    assert not calls


def test_unavailable_tag_is_not_replaced_with_default_branch(tmp_path, monkeypatch):
    calls = mock_api(monkeypatch, HTTPError('https://api.github.com', 404, 'Not Found', {}, None))
    with pytest.raises(HTTPError):
        reader.save_readme('example/tool', 'missing', tmp_path)
    assert len(calls) == 1 and not list(tmp_path.iterdir())


def test_reads_a_named_versioned_source_in_one_request(tmp_path, monkeypatch):
    name = 'src/a #.ts'
    source = 'https://github.com/example/tool/blob/v2/src/a%20%23.ts'
    calls = mock_api(monkeypatch, METADATA | {'path': name, 'html_url': source})
    result = reader.save_readme('example/tool', 'v2', tmp_path, path=name)
    assert [r.full_url for r in calls] == ['https://api.github.com/repos/example/tool/contents/src/a%20%23.ts?ref=v2']
    assert result['source'] == source
    assert Path(result['file']).read_bytes() == BODY
    assert result['immutable_blob'].endswith('/' + SHA)


@pytest.mark.parametrize('name', ['', '/package.json', 'src/../test.ts', 'src//test.ts'])
def test_invalid_source_path_never_reaches_the_network(tmp_path, monkeypatch, name):
    calls = mock_api(monkeypatch, METADATA)
    with pytest.raises(ValueError):
        reader.save_readme('example/tool', 'v2', tmp_path, path=name)
    assert not calls and not list(tmp_path.iterdir())


@pytest.mark.parametrize('names,partial', [(['a/tool', 'b/tool'], False), ([], False), ([], True)])
def test_repository_search_keeps_matches_and_incomplete_status(monkeypatch, names, partial):
    calls = mock_api(monkeypatch, {'items': [{'full_name': name} for name in names],
                                   'total_count': len(names), 'incomplete_results': partial})
    assert reader.search_repositories('tool') == {'repositories': names, 'total_count': len(names),
                                                  'incomplete_results': partial}
    assert len(calls) == 1 and not calls[0].get_header('Authorization')
    assert calls[0].full_url == 'https://api.github.com/search/repositories?q=tool+in%3Aname&per_page=5'


@pytest.mark.parametrize('payload', [
    {'message': 'API rate limit exceeded'},
    {'total_count': 2, 'items': [], 'incomplete_results': False},
    {'total_count': 1, 'items': [{'full_name': 'https://example.org/o/p'}], 'incomplete_results': False},
])
def test_invalid_search_response_is_never_a_clean_empty_result(monkeypatch, payload):
    mock_api(monkeypatch, payload)
    with pytest.raises(ValueError):
        reader.search_repositories('tool')


def test_repository_search_sends_only_a_project_name(monkeypatch):
    calls = mock_api(monkeypatch, {})
    with pytest.raises(ValueError):
        reader.search_repositories('project owner:somebody')
    assert not calls


@pytest.mark.parametrize('metadata', [
    [METADATA],
    METADATA | {'path': 'another.ts', 'html_url': 'https://github.com/example/tool/blob/v2/src/test.ts'},
    METADATA | {'path': 'src/test.ts', 'html_url': 'https://github.com/example/tool/blob/v2/src/other.ts'},
])
def test_requested_path_must_resolve_to_its_own_file(tmp_path, monkeypatch, metadata):
    mock_api(monkeypatch, metadata)
    with pytest.raises(ValueError):
        reader.save_readme('example/tool', 'v2', tmp_path, path='src/test.ts')
    assert not list(tmp_path.iterdir())

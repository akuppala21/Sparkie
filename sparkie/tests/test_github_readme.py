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

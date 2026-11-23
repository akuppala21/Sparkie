"""The research skill must read the exact public post without flattening its original tables."""
import io
import json
from email.message import Message
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
from urllib.error import HTTPError

import pytest


helper = Path(__file__).resolve().parents[1] / 'skills/local-recipe-review/scripts/read_forum.py'
spec = spec_from_file_location('forum_reader', helper)
reader = module_from_spec(spec)
spec.loader.exec_module(reader)


def response(monkeypatch, post):
    class Response(io.BytesIO):
        headers = Message()

        def open(self, url, timeout):
            assert url == 'https://forums.developer.nvidia.com/posts/by_number/20/14.json' and timeout == 15
            return self

    stream = Response(json.dumps(post).encode())
    stream.headers['Content-Type'] = 'application/json'
    monkeypatch.setattr(reader, 'build_opener', lambda *handlers: stream)


@pytest.mark.parametrize('link', ['http://forums.developer.nvidia.com/t/20', 'https://other.tld/t/20',
    'https://test@forums.developer.nvidia.com/t/20', 'https://forums.developer.nvidia.com/t/../20',
    'https://forums.developer.nvidia.com/t/slug/20/0'])
def test_reject_other_origins_and_paths(link):
    with pytest.raises(ValueError):
        reader.post_address(link)


def test_exact_post_number_and_opening_post():
    assert reader.post_address('https://forums.developer.nvidia.com/t/slug/20')[0:2] == (20, 1)
    assert reader.post_address('https://forums.developer.nvidia.com/t/20/14')[0:2] == (20, 14)


def test_attributes_unchanged_body_in_a_fresh_file(tmp_path, monkeypatch):
    url = 'https://forums.developer.nvidia.com/t/slug/20/14'
    body = '| bench | rate |\n|---|---|\n| matrix | 12 |\n'
    post = dict(topic_id=20, post_number=14, username='author', raw=body)
    response(monkeypatch, post)
    first = reader.save_post(url, tmp_path)
    assert first.read_text() == f'Source: {url}\nAuthor: author\nPost: 14\n\n' + body
    response(monkeypatch, post)
    second = reader.save_post(url, tmp_path)
    assert first != second and first.read_bytes() == second.read_bytes()


@pytest.mark.parametrize('changes', [{'post_number': 1}, {'topic_id': 30}, {'raw': ''}, {'username': 'a\nb'}])
def test_refuses_unattributed_or_wrong_post(tmp_path, monkeypatch, changes):
    response(monkeypatch, {'topic_id': 20, 'post_number': 14, 'username': 'author', 'raw': 'body'} | changes)
    with pytest.raises(ValueError):
        reader.save_post('https://forums.developer.nvidia.com/t/20/14', tmp_path)
    assert not list(tmp_path.iterdir())


def fail_primary(monkeypatch, status, window, *, headers=None):
    paths = []
    def fetch(opener, path):
        paths.append(path)
        if len(paths) == 1:
            raise HTTPError(path, status, 'forum error', headers or {}, None)
        return window
    monkeypatch.setattr(reader, 'read_json', fetch)
    return paths


def test_recovers_exact_original_among_neighboring_replies(tmp_path, monkeypatch):
    post = dict(topic_id=20, post_number=14, username='author', raw='| exact | table |')
    window = {'id': 20, 'post_stream': {'posts': [post | {'post_number': 1, 'raw': 'unrelated'}, post]}}
    paths = fail_primary(monkeypatch, 502, window)
    url = 'https://forums.developer.nvidia.com/t/slug/20/14'
    saved = reader.save_post(url, tmp_path)
    assert saved.read_text() == f'Source: {url}\nAuthor: author\nPost: 14\n\n| exact | table |'
    assert paths == ['/posts/by_number/20/14.json', '/t/20/14.json?include_raw=true']


@pytest.mark.parametrize('status,headers', [(301, {}), (401, {}), (403, {}), (404, {}),
                                             (429, {}), (503, {'Retry-After': '60'})])
def test_respects_primary_refusal_or_backoff(tmp_path, monkeypatch, status, headers):
    paths = fail_primary(monkeypatch, status, None, headers=headers)
    with pytest.raises(HTTPError):
        reader.save_post('https://forums.developer.nvidia.com/t/20/14', tmp_path)
    assert len(paths) == 1 and not list(tmp_path.iterdir())


@pytest.mark.parametrize('topic,posts', [(20, [(20, 1)]), (20, [(21, 14)]), (21, [(20, 14)]),
                                         (20, [(20, 14), (20, 14)])])
def test_unavailable_or_ambiguous_alternate_cannot_supply_a_result(tmp_path, monkeypatch, topic, posts):
    rows = [dict(topic_id=t, post_number=n, username='author', raw='wrong') for t, n in posts]
    paths = fail_primary(monkeypatch, 503, {'id': topic, 'post_stream': {'posts': rows}})
    with pytest.raises(ValueError, match='exact requested post'):
        reader.save_post('https://forums.developer.nvidia.com/t/20/14', tmp_path)
    assert len(paths) == 2 and not list(tmp_path.iterdir())


def test_search_links_to_the_ranked_post_and_joins_its_own_topic_title(monkeypatch):
    paths = []
    def fetch(opener, path):
        paths.append(path)
        return {
            'topics': [{'id': 42, 'title': 'Other setup'}, {'id': 20, 'title': 'Benchmarks'}],
            'posts': [{'topic_id': 20, 'post_number': 14, 'url': 'https://other.tld/'},
                      {'topic_id': 20, 'post_number': 14}, {'topic_id': 99, 'post_number': 1},
                      {'topic_id': 42, 'post_number': True}, {'topic_id': 42, 'post_number': 1}],
        }
    monkeypatch.setattr(reader, 'read_json', fetch)
    assert reader.search_posts('  Qwen & MTP  ') == [
        {'title': 'Benchmarks', 'url': 'https://forums.developer.nvidia.com/t/20/14'},
        {'title': 'Other setup', 'url': 'https://forums.developer.nvidia.com/t/42/1'}]
    assert paths == ['/search.json?q=Qwen+%26+MTP']


def test_empty_search_and_service_error_are_distinct(monkeypatch):
    monkeypatch.setattr(reader, 'read_json', lambda *args: {'topics': [], 'posts': []})
    assert reader.search_posts('no such topic') == []
    monkeypatch.setattr(reader, 'read_json', lambda *args: {'errors': ['search unavailable'], 'topics': [], 'posts': []})
    with pytest.raises(ValueError, match='did not return search results'):
        reader.search_posts('query')


@pytest.mark.parametrize('topics', [[{'id': 5, 'title': 'Unrelated'}],
                                    [{'id': 12, 'title': 'First'}, {'id': 12, 'title': 'Conflicting'}]])
def test_unidentifiable_hits_are_reported_as_unusable(monkeypatch, topics):
    monkeypatch.setattr(reader, 'read_json', lambda *args: {
        'topics': topics, 'posts': [{'topic_id': 12, 'post_number': 14}]})
    with pytest.raises(ValueError, match='without usable topic links'):
        reader.search_posts('query')

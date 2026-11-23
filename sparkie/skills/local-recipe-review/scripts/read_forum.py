"""Locate public NVIDIA Developer Forum posts or save their original Markdown."""
import argparse
import json
from pathlib import Path
import re
import sys
import tempfile
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, build_opener


HOST = 'forums.developer.nvidia.com'
MAX_BYTES = 2 * 1024 * 1024


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def post_address(url):
    parsed = urlsplit(url)
    if parsed.scheme != 'https' or parsed.netloc.lower() != HOST:
        raise ValueError('Expected a public HTTPS NVIDIA Developer Forum topic link.')
    match = re.fullmatch(r'/t/(?:(?![0-9]+/)[a-zA-Z0-9_-]+/)?([1-9][0-9]*)(?:/([1-9][0-9]*))?/?', parsed.path)
    if not match:
        raise ValueError('Expected a topic link or a link to a numbered post.')
    topic, number = int(match[1]), int(match[2] or 1)
    return topic, number, f'https://{HOST}{parsed.path}'


def read_json(opener, path):
    with opener.open(f'https://{HOST}{path}', timeout=15) as response:
        if response.headers.get_content_type() != 'application/json':
            raise ValueError('The forum did not return its post JSON.')
        payload = response.read(MAX_BYTES + 1)
    if len(payload) > MAX_BYTES:
        raise ValueError('The post exceeds the download limit.')
    return json.loads(payload)


def search_posts(query):
    if not query.strip():
        raise ValueError('Enter public forum search terms.')
    opener = build_opener(ProxyHandler({}), NoRedirect())
    data = read_json(opener, '/search.json?' + urlencode({'q': query.strip()}))
    if (not isinstance(data, dict) or data.get('errors') or not isinstance(data.get('topics'), list)
            or not isinstance(data.get('posts'), list)):
        raise ValueError('The forum did not return search results.')
    titles = {}
    for topic in data['topics']:
        if not isinstance(topic, dict) or type(topic.get('id')) is not int:
            continue
        topic_id, title = topic['id'], topic.get('title')
        if isinstance(title, str) and title.strip():
            # A conflicting topic row cannot identify a reliable title.
            titles[topic_id] = title if titles.get(topic_id, title) == title else None
    results = []
    seen = set()
    for post in data['posts']:
        if not isinstance(post, dict):
            continue
        topic, number = post.get('topic_id'), post.get('post_number')
        if type(topic) is not int or type(number) is not int or min(topic, number) < 1:
            continue
        if not titles.get(topic) or (topic, number) in seen:
            continue
        seen.add((topic, number))
        results.append({'title': titles[topic], 'url': f'https://{HOST}/t/{topic}/{number}'})
        if len(results) == 5:
            break
    if data['posts'] and not results:
        raise ValueError('The forum returned posts without usable topic links.')
    return results


def fetch_post(topic, number):
    opener = build_opener(ProxyHandler({}), NoRedirect())
    try:
        return read_json(opener, f'/posts/by_number/{topic}/{number}.json')
    except HTTPError as exc:
        exc.close()
        if exc.code not in (500, 502, 503, 504) or 'Retry-After' in exc.headers:
            raise
    # Discourse also serves the original Markdown in its public topic view.
    # The window can contain other replies. Only the exact requested post counts.
    window = read_json(opener, f'/t/{topic}/{number}.json?include_raw=true')
    stream = window.get('post_stream') if isinstance(window, dict) and window.get('id') == topic else None
    posts = stream.get('posts') if isinstance(stream, dict) else None
    if isinstance(posts, list):
        matches = [p for p in posts if isinstance(p, dict)
                   and (p.get('topic_id'), p.get('post_number')) == (topic, number)]
        if len(matches) == 1:
            return matches[0]
    raise ValueError('The alternate forum view did not identify the exact requested post.')


def save_post(url, directory):
    topic, number, citation = post_address(url)
    data = fetch_post(topic, number)
    if not isinstance(data, dict) or (data.get('topic_id'), data.get('post_number')) != (topic, number):
        raise ValueError('The forum returned a different post.')
    author, body = data.get('username'), data.get('raw')
    if not isinstance(author, str) or not re.fullmatch(r'[\w.-]+', author) or not isinstance(body, str) or not body.strip():
        raise ValueError('The forum did not supply an attributed Markdown body.')
    with tempfile.NamedTemporaryFile(mode='w', dir=directory, prefix=f'forum-{topic}-{number}-',
                                     suffix='.md', encoding='utf-8', delete=False) as file:
        file.write(f'Source: {citation}\nAuthor: {author}\nPost: {number}\n\n')
        file.write(body)
    return Path(file.name).resolve()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--search', metavar='TERMS', help='List matching post links from the forum.')
    parser.add_argument('urls', nargs='*')
    args = parser.parse_args()
    if (args.search is not None) == bool(args.urls):
        parser.error('Supply post URL(s) or --search TERMS.')
    if args.search is not None:
        try:
            print(json.dumps(search_posts(args.search), ensure_ascii=False))
            return 0
        except (ValueError, OSError, URLError) as exc:
            print(f'Could not search the forum: {exc}', file=sys.stderr)
            return 1
    failed = False
    for url in args.urls:
        try:
            print(save_post(url, Path('/workspace')))
        except (ValueError, OSError, URLError) as exc:
            print(f'Could not read forum post: {exc}', file=sys.stderr)
            failed = True
    return int(failed)


if __name__ == '__main__':
    raise SystemExit(main())

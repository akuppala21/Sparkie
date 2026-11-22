"""Save a public repository's README or one named source file at a Git revision."""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import re
import sys
import tempfile
from urllib.error import HTTPError, URLError
from urllib.parse import quote, unquote, urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def save_readme(repository, ref, directory, *, path=None):
    if not re.fullmatch(r'[a-zA-Z0-9-]+/[a-zA-Z0-9_.-]+', repository) or repository.split('/')[1] in ('.', '..'):
        raise ValueError('Expected a public GitHub repository in OWNER/REPO form.')
    if ref is not None and (not ref or len(ref) > 1024 or any(ord(c) < 32 or ord(c) == 127 for c in ref)):
        raise ValueError('Expected a Git tag, branch or commit.')
    api = 'https://api.github.com/repos/' + repository
    route = '/readme'
    if path is not None:
        if (len(path) > 4096 or any(part in ('', '.', '..') for part in path.split('/'))
                or any(ord(c) < 32 or ord(c) == 127 for c in path) or '\\' in path):
            raise ValueError('Expected a file path relative to the repository root.')
        route = '/contents/' + quote(path, safe='/')
    url = api + route + ('?' + urlencode({'ref': ref}) if ref else '')
    request = Request(url, headers={'Accept': 'application/vnd.github+json',
                                    'User-Agent': 'Sparkie-public-readme', 'X-GitHub-Api-Version': '2022-11-28'})
    with build_opener(ProxyHandler({}), NoRedirect()).open(request, timeout=15) as response:
        if response.headers.get_content_type() != 'application/json':
            raise ValueError('GitHub did not return file metadata.')
        raw = response.read(2 * 1024 * 1024 + 1)
    if len(raw) > 2 * 1024 * 1024:
        raise ValueError('File metadata exceeds the download limit.')
    data = json.loads(raw)
    if (not isinstance(data, dict) or data.get('type') != 'file' or data.get('encoding') != 'base64'
            or not isinstance(data.get('content'), str) or not isinstance(data.get('html_url'), str)):
        raise ValueError('GitHub did not supply a complete text file.')
    source = urlsplit(data['html_url'])
    if source.scheme != 'https' or source.netloc != 'github.com' or not source.path.lower().startswith('/' + repository.lower() + '/blob/'):
        raise ValueError('GitHub returned a source outside the requested repository.')
    if path is not None and (data.get('path') != path or not unquote(source.path).endswith('/' + path)):
        raise ValueError('GitHub returned a different source path.')
    body = base64.b64decode(''.join(data['content'].splitlines()), validate=True)
    digest = hashlib.sha1(b'blob ' + str(len(body)).encode() + b'\0' + body).hexdigest()
    if digest != data.get('sha') or len(body) != data.get('size'):
        raise ValueError('File bytes do not match GitHub’s file size and Git blob hash.')
    body.decode('utf-8')  # Native text reads must be able to display the saved original.
    if path is not None and b'\x00' in body:
        raise ValueError('The requested path contains binary data.')
    prefix, suffix = ('github-source-', '.txt') if path is not None else ('github-readme-', '.md')
    with tempfile.NamedTemporaryFile(dir=directory, prefix=prefix, suffix=suffix, delete=False) as output:
        output.write(body)
    return {'file': str(Path(output.name).resolve()), 'source': data['html_url'],
            'immutable_blob': api + '/git/blobs/' + digest, 'requested_ref': ref, 'bytes': len(body)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('repository')
    parser.add_argument('--ref')
    parser.add_argument('--path', help='Read this repository-relative source or test file instead of the README.')
    args = parser.parse_args()
    try:
        result = save_readme(args.repository, args.ref, '/workspace', path=args.path)
    except HTTPError as exc:
        exc.close()
        print(f'Could not read GitHub file: HTTP {exc.code} ({exc.reason}).', file=sys.stderr)
        return 1
    except (ValueError, OSError, URLError) as exc:
        print(f'Could not read GitHub file: {exc}', file=sys.stderr)
        return 1
    print(json.dumps(result))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())

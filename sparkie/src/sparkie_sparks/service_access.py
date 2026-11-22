"""Owner access to stable service aliases, using native Hermes authentication."""
import os
import re
from urllib.parse import urlsplit


def origin():
    value = os.environ.get('SPARKIE_SERVICES_ORIGIN', '')
    parsed = urlsplit(value)
    if (parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password
            or parsed.path or parsed.query or parsed.fragment or parsed.port != 10000
            or not re.fullmatch('[A-Za-z0-9.-]+', parsed.hostname)):
        raise RuntimeError('Authenticated workload links are not configured.')
    return value


def public_link(recipe):
    if not isinstance(recipe, str) or not re.fullmatch('[a-z][a-z0-9-]{0,47}', recipe):
        raise ValueError('Select an enrolled service.')
    return origin() + '/services/' + recipe + '/'


def verify_proxy_request(request, *, kind=None, recipe=None):
    expected = origin()
    headers = request.headers
    method = headers.get('x-sparkie-method', '')
    if method not in ('GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'):
        raise PermissionError('The workload request method could not be verified.')
    request_origin = headers.get('origin')
    if request_origin is not None and request_origin != expected:
        raise PermissionError('Open this workload from its signed-in page.')
    # The native middleware has already verified this bearer or cookie and the
    # adapter has checked owner identity. An arbitrary Authorization value alone
    # never reaches this decision through the real route.
    bearer = headers.get('authorization', '').startswith('Bearer ')
    # Sandboxed artifact documents have an opaque origin. A real user clicking
    # a directory or file therefore sends a cross-site document navigation,
    # even within this service. Permit only that read after native owner auth;
    # the second check below also requires the enrolled backend to be an app.
    document_navigation = (method in ('GET', 'HEAD') and request_origin is None
        and headers.get('sec-fetch-mode') == 'navigate'
        and headers.get('sec-fetch-dest') == 'document'
        and headers.get('sec-fetch-user') == '?1'
        and kind in (None, 'app'))
    if (method not in ('GET', 'HEAD') and request_origin != expected and not bearer
            or headers.get('sec-fetch-site') == 'cross-site' and not document_navigation):
        raise PermissionError('This workload write needs its own page or a native owner credential.')
    if kind is None:
        return
    path = headers.get('x-sparkie-path', '')
    prefix = '/services/' + recipe + '/'
    if not path.startswith(prefix):
        raise PermissionError('Use this service’s reviewed link.')
    relative = '/' + path[len(prefix):]
    # These are the enrolled backend interfaces. Model server administration,
    # adapter loading and power paths remain outside the model integration API.
    if kind == 'model' and (method, relative) in {
            ('GET', '/v1/models'), ('POST', '/v1/chat/completions'), ('POST', '/v1/completions')}:
        return
    if kind == 'app' and method in ('GET', 'HEAD'):
        return  # The enrolled artifact-browser recipe only serves read-only files.
    raise PermissionError('This action is not part of the reviewed service interface.')

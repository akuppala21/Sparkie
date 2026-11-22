"""Native owner auth and exact service controls; no Portal or fleet traffic."""
import asyncio
from dataclasses import replace
from types import SimpleNamespace

import pytest

from sparkie_sparks.authority import Owner, OwnerBinding
from sparkie_sparks.composition import compose
from sparkie_sparks.operations import OperationStore
from sparkie_sparks.recipe_services import RecipeServices, ServiceRecipe, ServiceObservation
from sparkie_sparks.workspace_types import ComputeNode
from test_owner_login import app, native_bundle, login, native_login, replace_cookie

pytestmark = pytest.mark.integration
BASE = '/api/plugins/sparkie-sparks'
SERVICES_ORIGIN = 'https://sparkie.test:10000'
RECIPE = 'fixture-app'
REVISION = 'a' * 64


@pytest.fixture
def service(app, tmp_path, monkeypatch):
    from sparkie_sparks import controls
    session = app.provider.verify_session(access_token=app.token())
    binding = [OwnerBinding('service-owner', session.user_id, session.provider, session.issuer or '', 12345, 12345)]
    events, states, forwards, discards = [], {}, [], []
    store = OperationStore(tmp_path / 'service.sqlite')
    class Backend:
        def plan(self, recipe, node, operation): return 'instance-' + operation
        def start(self, recipe, node, operation, workload):
            events.append(('start', operation, workload))
            states[operation] = 'ready'
        def stop(self, recipe, node, instance, workload, *, operation):
            events.append(('stop', instance, workload, operation))
            states[instance] = 'stopped'
        def observe(self, recipe, node, instance, workload):
            return ServiceObservation(states.get(instance, 'unknown'), workload, recipe.port)
        def logs(self, recipe, node, instance, workload): return ['Fixture service started.']
    backend = Backend()
    recipe = ServiceRecipe(RECIPE, REVISION, 'app', ('spark2',), 32150)
    def authorized(operation, target):
        row = store.get(operation)
        return (row['generation'] == binding[0].generation and row['intent'] == target
                and row['approved_at'] is not None and not row['cancel_requested'])
    recipes = RecipeServices(store, recipes=[recipe],
        nodes={'spark2': ComputeNode('spark2', '2' * 32, '192.0.2.2')},
        backends={'app': backend, 'model': backend}, authorize=authorized)
    class Relay:
        def ensure(self, endpoint):
            forwards.append(dict(endpoint))
            return {'port': 32250, 'kind': endpoint['kind'], 'instance': endpoint['instance']}
        def discard(self, name, instance): discards.append((name, instance))
    relay = Relay()
    control = compose(store, [], binding=lambda: binding[0], workloads=SimpleNamespace(nodes={}),
                      services=recipes, service_relay=relay)
    monkeypatch.setattr(controls, '_controls', control)
    monkeypatch.setenv('SPARKIE_SERVICES_ORIGIN', SERVICES_ORIGIN)
    # The real ingress overwrites this from the original request URI. Tests
    # below exercise the native gate after that independently checked boundary.
    app.client.headers['X-Sparkie-Path'] = '/services/' + RECIPE + '/'
    return SimpleNamespace(app=app, client=app.client, controls=control, store=store,
        binding=binding, events=events, states=states, forwards=forwards, discards=discards,
        relay=relay, recipes=recipes, backend=backend)


def prepare(service, **changes):
    response = service.client.post(BASE + '/operations', json={
        'request_id': 'b' * 32, 'action': 'start_service', 'spark': 'spark2',
        'recipe': RECIPE, 'revision': REVISION, **changes})
    assert response.status_code == 200, response.text
    return response.json()


def started(service):
    assert login(service.client).status_code == 302
    row = prepare(service)
    result = service.client.post(BASE + '/operations/' + row['id'] + '/confirm', json={'digest': row['digest']})
    assert result.status_code == 200 and result.json()['state'] == 'succeeded', result.text
    return row


def model_service(service):
    service.recipes.recipes[RECIPE] = replace(service.recipes.recipes[RECIPE], kind='model', model='fixture-model')
    service.client.headers['X-Sparkie-Path'] = '/services/' + RECIPE + '/v1/chat/completions'


def test_native_auth_rejects_anonymous_forged_and_other_owner_before_forwarding(service):
    for path in ('/services', '/services/fixture-app/open', '/services/fixture-app/authorize'):
        assert service.client.get(BASE + path).status_code == 401
        assert service.client.get(BASE + path, headers={'Authorization': 'Bearer forged', 'X-Sparkie-Method': 'GET'}).status_code == 401
        assert service.client.get(BASE + path, headers={'Authorization': 'Bearer ' + service.app.token('different-owner'),
                                                     'X-Sparkie-Method': 'GET'}).status_code == 401
    assert service.events == [] and service.forwards == []


def test_native_service_start_requires_exact_owner_confirmation_and_replay_is_refused(service):
    assert login(service.client).status_code == 302
    assert service.client.get(BASE + '/services').json()[0]['recipe'] == RECIPE
    row = prepare(service)
    assert row['state'] == 'pending' and service.events == []
    url = BASE + '/operations/' + row['id'] + '/confirm'
    assert service.client.get(BASE + '/services/' + RECIPE + '/open').status_code == 409
    assert service.client.get(BASE + '/services/' + RECIPE + '/authorize', headers={'X-Sparkie-Method': 'GET'}).status_code == 409
    assert service.client.post(url, json={'digest': '0' * 64}).status_code == 403
    assert service.client.post(url, json={'digest': row['digest'], 'owner': True}).status_code == 422
    assert service.events == [] and service.forwards == []
    assert service.client.post(url, json={'digest': row['digest']}).json()['state'] == 'succeeded'
    assert service.client.post(url, json={'digest': row['digest']}).status_code == 403
    assert len(service.events) == 1
    opened = service.client.get(BASE + '/services/' + RECIPE + '/open', params={'instance': row['id']})
    assert opened.status_code == 303 and opened.headers['location'] == SERVICES_ORIGIN + '/services/' + RECIPE + '/'
    assert opened.headers['cache-control'] == 'no-store'
    assert service.client.get(BASE + '/services/' + RECIPE + '/open', params={'instance': 'c' * 32}).status_code == 409


@pytest.mark.parametrize('change', [{'revision': 'c' * 64}, {'recipe': 'not-enrolled'}, {'spark': 'spark3'}])
def test_unenrolled_service_is_a_plain_refusal_before_approval_or_launch(service, change):
    assert login(service.client).status_code == 302
    result = service.client.post(BASE + '/operations', json={
        'request_id': 'd' * 32, 'action': 'start_service', 'spark': 'spark2', 'recipe': RECIPE,
        'revision': REVISION, **change})
    assert result.status_code in (400, 409), result.text
    assert service.events == [] and service.store.recent(Owner('service-owner', 'web')) == []


@pytest.mark.parametrize('headers,expected', [
    ({'X-Sparkie-Method': 'GET'}, 204),
    ({'X-Sparkie-Method': 'POST'}, 403),
    ({'X-Sparkie-Method': 'POST', 'Origin': SERVICES_ORIGIN}, 204),
    ({'X-Sparkie-Method': 'GET', 'Origin': 'https://attacker.invalid'}, 403),
    ({'X-Sparkie-Method': 'POST', 'Origin': 'https://attacker.invalid'}, 403),
    ({'X-Sparkie-Method': 'GET', 'Sec-Fetch-Site': 'cross-site'}, 403),
    ({'X-Sparkie-Method': 'CONNECT', 'Origin': SERVICES_ORIGIN}, 403),
    ({}, 403),
])
def test_native_cookie_service_auth_checks_original_method_and_origin(service, headers, expected):
    model_service(service)
    if headers.get('X-Sparkie-Method') == 'GET':
        service.client.headers['X-Sparkie-Path'] = '/services/' + RECIPE + '/v1/models'
    started(service)
    response = service.client.get(BASE + '/services/' + RECIPE + '/authorize', headers=headers)
    assert response.status_code == expected, response.text
    if expected == 204:
        assert response.headers['x-sparkie-port'] == '32250'
    else:
        assert 'x-sparkie-port' not in response.headers and service.forwards == []
    assert len(service.events) == 1


def test_native_verified_bearer_allows_api_write_but_never_cross_origin(service):
    model_service(service)
    started(service)
    # A native app token comes from the PKCE exchange, not an independently
    # signed dashboard JWT that the native Webapp may refuse as unestablished.
    credential = native_login(service.client)['access_token']
    headers = {'Authorization': 'Bearer ' + credential, 'X-Sparkie-Method': 'POST'}
    assert service.client.get(BASE + '/services/' + RECIPE + '/authorize', headers=headers).status_code == 204
    assert service.client.get(BASE + '/services/' + RECIPE + '/authorize', headers=headers | {
        'Origin': 'https://attacker.invalid'}).status_code == 403
    assert len(service.events) == 1


NAVIGATION = {'X-Sparkie-Method': 'GET', 'Sec-Fetch-Site': 'cross-site',
              'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document',
              'Sec-Fetch-User': '?1'}


@pytest.mark.parametrize('method', ['GET', 'HEAD'])
def test_owner_can_navigate_sandboxed_artifact_files_without_granting_script_access(service, method):
    headers = NAVIGATION | {'X-Sparkie-Method': method,
                            'X-Sparkie-Path': '/services/' + RECIPE + '/folder/readme.txt'}
    endpoint = BASE + '/services/' + RECIPE + '/authorize'
    assert service.client.get(endpoint, headers=headers).status_code == 401
    assert service.forwards == []
    started(service)
    response = service.client.get(endpoint, headers=headers)
    assert response.status_code == 204 and response.headers['x-sparkie-port'] == '32250'
    assert len(service.events) == 1


@pytest.mark.parametrize('change', [
    {'Origin': 'null'}, {'Origin': 'https://attacker.invalid'},
    {'Origin': SERVICES_ORIGIN}, {'Sec-Fetch-Mode': 'cors'},
    {'Sec-Fetch-Dest': 'iframe'}, {'Sec-Fetch-Dest': 'empty'},
    {'Sec-Fetch-User': ''}, {'X-Sparkie-Method': 'POST'},
])
def test_cross_site_artifact_exception_excludes_scripts_frames_and_writes(service, change):
    started(service)
    response = service.client.get(BASE + '/services/' + RECIPE + '/authorize',
                                  headers=NAVIGATION | change)
    assert response.status_code == 403 and 'x-sparkie-port' not in response.headers
    assert service.forwards == [] and len(service.events) == 1


def test_sandbox_document_navigation_cannot_open_the_model_api(service):
    model_service(service)
    started(service)
    response = service.client.get(BASE + '/services/' + RECIPE + '/authorize', headers=NAVIGATION | {
        'X-Sparkie-Path': '/services/' + RECIPE + '/v1/models'})
    assert response.status_code == 403 and 'x-sparkie-port' not in response.headers
    assert len(service.events) == 1


@pytest.mark.parametrize('method', ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'])
def test_artifact_app_cannot_gain_write_routes_through_owner_signin(service, method):
    started(service)
    response = service.client.get(BASE + '/services/' + RECIPE + '/authorize', headers={
        'X-Sparkie-Method': method, 'Origin': SERVICES_ORIGIN})
    assert response.status_code == 403 and 'x-sparkie-port' not in response.headers
    assert len(service.events) == 1


@pytest.mark.parametrize('path', ['/sleep', '/wake_up', '/v1/load_lora_adapter',
    '/v1/unload_lora_adapter', '/reset_prefix_cache', '/v1/chat/completions/../sleep',
    '/v1/%63hat/completions', '/v1/chat/completions?admin=true'])
def test_model_server_administration_is_not_exposed_by_inference_access(service, path):
    model_service(service)
    started(service)
    response = service.client.get(BASE + '/services/' + RECIPE + '/authorize', headers={
        'X-Sparkie-Method': 'POST', 'X-Sparkie-Path': '/services/' + RECIPE + path,
        'Origin': SERVICES_ORIGIN})
    assert response.status_code == 403 and 'x-sparkie-port' not in response.headers
    assert len(service.events) == 1


@pytest.mark.parametrize('path', ['', '/other/fixture-app/', '/services/another-app/',
                                 'https://attacker.invalid/services/fixture-app/'])
def test_proxy_path_must_name_the_authorized_service(service, path):
    started(service)
    response = service.client.get(BASE + '/services/' + RECIPE + '/authorize', headers={
        'X-Sparkie-Method': 'GET', 'X-Sparkie-Path': path})
    assert response.status_code == 403 and 'x-sparkie-port' not in response.headers
    assert len(service.events) == 1


def test_native_refresh_cookies_survive_service_authorization_response(service):
    started(service)
    replace_cookie(service.client, 'hermes_session_at', service.app.token(expiry=-3600))
    replace_cookie(service.client, 'hermes_session_rt', 'owner-refresh')
    response = service.client.get(BASE + '/services/' + RECIPE + '/authorize', headers={'X-Sparkie-Method': 'GET'})
    assert response.status_code == 204 and response.headers['x-sparkie-port'] == '32250'
    cookies = response.headers.get_list('set-cookie')
    assert any('hermes_session_at' in cookie for cookie in cookies)
    assert any('hermes_session_rt' in cookie and 'owner-rotated' in cookie for cookie in cookies)
    assert service.app.calls[-1]['grant_type'] == 'refresh_token'


def test_changed_service_after_forwarding_discards_the_exact_instance(service, monkeypatch):
    row = started(service)
    original = service.relay.ensure
    def changed(endpoint):
        result = original(endpoint)
        with service.store._db() as db:
            db.execute("UPDATE recipe_service_instances SET phase='stopped',held=0 WHERE id=?", (row['id'],))
        return result
    monkeypatch.setattr(service.relay, 'ensure', changed)
    response = service.client.get(BASE + '/services/' + RECIPE + '/authorize', headers={'X-Sparkie-Method': 'GET'})
    assert response.status_code == 409 and 'x-sparkie-port' not in response.headers
    assert service.discards == [(RECIPE, row['id'])] and len(service.events) == 1


def test_native_telegram_service_command_uses_same_approval_and_stable_link(service):
    from telegram import Update
    from test_native_controls import telegram_fixture
    from sparkie_sparks.telegram_controls import register
    async def run():
        native, wire = telegram_fixture()
        register(native, None)
        errors = []
        async def error(update, context): errors.append(context.error)
        native.add_error_handler(error)
        async with native:
            async def message(text, number, user=12345):
                await native.process_update(Update.de_json({'update_id': number, 'message': {
                    'message_id': number, 'date': 1, 'chat': {'id': user, 'type': 'private'},
                    'from': {'id': user, 'is_bot': False, 'first_name': 'Fixture'}, 'text': text,
                    'entities': [{'type': 'bot_command', 'offset': 0, 'length': 6}]}}, native.bot))
            async def click(card, user=12345):
                data = card['reply_markup']['inline_keyboard'][0][0]['callback_data']
                await native.process_update(Update.de_json({'update_id': 999, 'callback_query': {
                    'id': 'service-query', 'chat_instance': 'fixture', 'data': data,
                    'from': {'id': user, 'is_bot': False, 'first_name': 'Fixture'}, 'message': card}}, native.bot))
            await message('/spark run fixture-app spark2', 1, user=54321)
            assert service.store.recent(Owner('service-owner', 'web')) == []
            await message('/spark run fixture-app spark2', 2)
            card = wire.messages[-1]
            assert 'Waiting for your confirmation' in card['text'] and service.events == []
            await click(card, user=54321)
            assert service.events == []
            await click(card)
            await click(card)
            assert len(service.events) == 1
            instance = service.events[0][1]
            assert service.store.get(instance)['approved_channel'] == 'telegram'
            await message('/spark open fixture-app', 3)
            assert SERVICES_ORIGIN + '/services/fixture-app/' in wire.messages[-1]['text']
            await message('/spark stop-service fixture-app ' + instance, 4)
            assert len(service.events) == 1
            stop_card = wire.messages[-1]
            await click(stop_card)
            await click(stop_card)
            assert [event[0] for event in service.events] == ['start', 'stop']
            assert service.recipes.endpoint(RECIPE) is None
            assert errors == [], errors
    asyncio.run(run())

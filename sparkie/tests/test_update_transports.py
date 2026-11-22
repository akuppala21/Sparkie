"""Exercise the signed-in native dashboard API and paired Telegram with an inert steward."""
import asyncio
import pytest

from browser.updates_fixture import FixtureSteward, PROPOSAL, owner_controls
from sparkie_sparks import controls
from test_native_controls import rig, telegram_fixture, USER

pytestmark = pytest.mark.integration
PREFIX = '/api/plugins/sparkie-sparks'


@pytest.fixture
def update_rig(rig):
    steward = FixtureSteward(long_review=True)
    service = owner_controls(rig['store'], lambda: rig['binding'][0], steward)
    rig['monkeypatch'].setattr(controls, '_controls', service)
    return rig['client'], steward


def test_signed_in_owner_reviews_sealed_candidate_and_verifies_exact_digest(update_rig):
    client, steward = update_rig
    body = {'request_id': '1' * 32, 'proposal': PROPOSAL}
    url = PREFIX + '/updates'
    auth = client.headers.pop('Authorization')
    assert client.post(url, json=body).status_code == 401
    client.headers['Authorization'] = auth
    assert client.get(PREFIX + '/controls').json()['application_updates'] is True
    assert client.post(url, json=body | {'candidate': '0' * 64}).status_code == 422
    row = client.post(url, json=body).json()
    assert row['intent']['review'] == steward.review and row['state'] == 'pending'
    for field in [PROPOSAL, *steward.review.values()]:
        assert field in row['description']
    assert client.post(url, json=body).json()['id'] == row['id']
    compact = client.get(PREFIX + '/controls').json()['operations'][0]
    assert compact['review_available'] and 'review' not in compact['intent'] and not compact['can_confirm']
    base = PREFIX + '/operations/' + row['id']
    exact = {'digest': row['digest']}
    assert client.post(base + '/accept_update', json=exact).status_code == 403
    assert client.post(base + '/confirm', json={'digest': '0' * 64}).status_code == 403
    assert steward.effects == []
    checked = client.post(base + '/confirm', json=exact).json()
    assert checked['can_accept_update'] and checked['can_rollback_update'] and checked['state'] == 'uncertain'
    assert client.post(base + '/rollback_update', json={'digest': '0' * 64}).status_code == 403
    assert client.post(base + '/accept_update', json=exact).json()['state'] == 'succeeded'
    restored = client.post(base + '/rollback_update', json=exact).json()
    assert restored['update']['state'] == 'rolled_back'
    assert [verb for verb, _ in steward.effects] == ['apply', 'accept', 'rollback']


def test_paired_telegram_delivers_entire_review_and_only_accepts_buttons_on_bound_cards(update_rig):
    from telegram import Update
    from sparkie_sparks.telegram_controls import register
    client, steward = update_rig

    async def run():
        app, wire = telegram_fixture()
        register(app, None)
        async with app:
            async def command(user, text='/sparks update ' + PROPOSAL, message_id=1):
                await app.process_update(Update.de_json({'update_id': 1, 'message': {
                    'message_id': message_id, 'date': 1, 'chat': {'id': user, 'type': 'private'},
                    'from': {'id': user, 'is_bot': False, 'first_name': 'Fixture'},
                    'text': text, 'entities': [{'type': 'bot_command', 'offset': 0,
                                               'length': len(text.split()[0])}]}}, app.bot))

            async def click(card, data, user=USER):
                await app.process_update(Update.de_json({'update_id': 2, 'callback_query': {
                    'id': 'fixture-query', 'chat_instance': 'fixture', 'data': data, 'message': card,
                    'from': {'id': user, 'is_bot': False, 'first_name': 'Fixture'}}}, app.bot))

            await command(54321)
            assert client.get(PREFIX + '/controls').json()['operations'] == []
            before = len(wire.messages)
            await command(USER)
            review = wire.messages[before:]
            assert len(review) > 1 and all(not m.get('reply_markup') for m in review[:-1])
            assert all(len(m['text'].encode('utf-16-le')) <= 8192 for m in review)
            text = ''.join(m['text'] for m in review)
            for field in [PROPOSAL, *steward.review.values()]:
                assert field in text
            initial = review[-1]
            install = initial['reply_markup']['inline_keyboard'][0][0]['callback_data']
            operation = install.rsplit(':', 1)[1]
            await command(USER, '/spark recent', 2)
            assert '/spark show ' + operation in wire.messages[-1]['text'] and not wire.messages[-1].get('reply_markup')
            await click({**initial, 'message_id': initial['message_id'] + 1000}, install)
            await click(initial, install, user=54321)
            assert steward.effects == []
            await click(initial, install)
            second = wire.messages[-1]
            restore = next(b['callback_data'] for line in second['reply_markup']['inline_keyboard']
                           for b in line if b['text'] == 'Restore previous version')
            await click(initial, restore)
            await click(second, restore, user=54321)
            assert steward.effects == [('apply', operation)]
            await click(second, restore)
            assert client.get(PREFIX + '/operations/' + operation).json()['update']['state'] == 'rolled_back'
            assert steward.effects == [('apply', operation), ('rollback', operation)]
    asyncio.run(run())


def test_signed_in_owner_cannot_restore_a_historical_card_after_a_newer_install(update_rig):
    client, steward = update_rig
    row = client.post(PREFIX + '/updates', json={'request_id': '2' * 32, 'proposal': PROPOSAL}).json()
    base = PREFIX + '/operations/' + row['id']
    exact = {'digest': row['digest']}
    assert client.post(base + '/confirm', json=exact).json()['can_accept_update']
    assert client.post(base + '/accept_update', json=exact).json()['can_rollback_update']
    steward.current_operation = 'later-installed-operation'
    assert not client.get(base).json()['can_rollback_update']
    assert client.post(base + '/rollback_update', json=exact).status_code == 403
    assert client.get(base).json()['state'] == 'succeeded'
    assert [verb for verb, _ in steward.effects] == ['apply', 'accept']

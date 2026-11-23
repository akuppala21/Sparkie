"""Model tools can draft or observe a request, but never approve or execute it.

Drafts use the existing operation store and owner generation. Native transport
buttons still verify the owner and exact saved intention. Conversation context
routes a draft; it supplies no approval authority.
"""
import hashlib
import json
import re

from .authority import Owner
from .controls import configured
from .operations import intent


def public_request(row, *, after_check=False):
    result = {key: row[key] for key in ('id', 'intent', 'state', 'cancel_requested',
                                      'description', 'message', 'recovery')}
    if row['state'] in ('pending', 'approved'):
        result['confirmation_expires'] = row['expires']
    if row.get('update') and row['update']['state'] == 'awaiting_owner_check':
        result['update'] = row['update']
        result['next_step'] = (row['recovery']['message'] + ' Open this request in Home or with /spark show '
                               + row['id'] + ' in the paired Telegram chat for the owner decision.')
    elif row['state'] in ('dispatching', 'uncertain'):
        result['next_step'] = (
            ('The check attempt finished; the outcome is still unknown. Report this uncertainty and keep request '
             + row['id'] + '. Report only the current recovery disposition and answer any independent question. '
             'Do not explain a separate workload observation or speculate about future outcomes. '
             'Do not repeat status or check in this answer without new evidence or a new owner request. '
             if after_check else
             'Call spark_check_change (Check result) on this same request ' + row['id']
             + ' now; this read-only check needs no owner confirmation. ')
            + 'Follow the recovery policy returned by the check. '
              'This status does not establish the cause of the unknown result.')
    elif row['state'] == 'failed':
        result['next_step'] = row['recovery']['message']
    elif row['state'] == 'succeeded':
        result['next_step'] = (row['recovery']['message'] + ' The result establishes the observed outcome only. '
                               'If an interruption was reported, this does not establish when a connection dropped or why a reply was missing.')
    return result


def propose(controls, *, request_key, request_ref, action, spark, container=None, recipe=None, revision=None, instance=None):
    # Owner here is only the storage scope for an unapproved draft. No model
    # identity, expiry, approval digest or dispatch method is accepted.
    owner = Owner(controls.binding().generation, 'web')
    if action not in controls.actions_for(spark):
        raise ValueError('This Spark action is not connected yet.')
    target = intent(action, spark, container=container, recipe=recipe, revision=revision, instance=instance)
    if action in ('start_service', 'stop_service'):
        controls.validate_service(target)
    row = controls.store.prepare_proposal(controls.current(owner), request_key=request_key,
        request_ref=request_ref, **target)
    result = public_request(controls.view(row))
    if row['request_key'] != request_key:
        result['replacement_prepared'] = False
    return result


def status(controls, *, operation):
    if not isinstance(operation, str) or not re.fullmatch('[a-f0-9]{32}', operation):
        raise ValueError('Use the request ID returned when the change was prepared.')
    owner = Owner(controls.binding().generation, 'web')
    # Read only: status cannot reconcile by dispatching or continue a power stage.
    return public_request(controls.get(owner, operation))


def check(controls, *, operation):
    if not isinstance(operation, str) or not re.fullmatch('[a-f0-9]{32}', operation):
        raise ValueError('Use the request ID returned when the change was prepared.')
    owner = Owner(controls.binding().generation, 'web')
    # This is the same observation/reconciliation as the owner's Check result
    # button. Controls.check never dispatches or advances a power sequence.
    return public_request(controls.check(owner, operation), after_check=True)


def context():
    from gateway.session_context import bound_session_key, get_session_env
    key = bound_session_key()
    if not isinstance(key, str) or not key or len(key) > 4096:
        raise ValueError('Prepare Spark changes in an active Hermes conversation.')
    return {'session': key, **{name: get_session_env('HERMES_SESSION_' + name.upper(), '')
            for name in ('platform', 'chat_id', 'chat_type', 'actor_id', 'message_id')}}


def draft_tool(args, **kwargs):
    try:
        if (not isinstance(args, dict) or set(args) - {'action', 'spark', 'container', 'request_id', 'recipe', 'revision', 'instance'}
                or not isinstance(args.get('request_id'), str)
                or not re.fullmatch('[A-Za-z0-9_-]{8,80}', args['request_id'])):
            raise ValueError('Name the exact Spark change and a request ID.')
        target = intent(args.get('action'), args.get('spark'), container=args.get('container'),
                        recipe=args.get('recipe'), revision=args.get('revision'), instance=args.get('instance'))
        route = context()
        # Native message identity wins when present. For web/API turns without
        # one, callers reuse request_id on redelivery of the same proposal.
        anchor = route['message_id'] or args['request_id']
        key = hashlib.sha256(json.dumps([route['session'], anchor, target], sort_keys=True).encode()).hexdigest()
        controls = configured()
        row = controls.propose(request_key='proposal:' + key, request_ref='Hermes conversation proposal: ' + key,
                               **target)
        if row.get('replacement_prepared') is False:
            return json.dumps({'available': True, 'request': row, 'ran': False, 'prepared': False,
                'message': 'No new request was prepared. This Spark is held by the existing request. '
                           'Use spark_check_change to read the existing request. Keep it while the outcome is unknown.'})
        from .telegram_controls import deliver_proposal
        try:
            delivered = deliver_proposal(controls, route, row['id'])
        except (PermissionError, ValueError, RuntimeError):
            delivered = False  # Preserve the saved request ID after a delivery fault.
        review = ('Review the request card in this Telegram chat.' if delivered else
                  'Review this request in the Sparks page, or use /spark show ' + row['id'] + ' in the paired Telegram chat.')
        if row['state'] == 'pending' and row['recovery']['retry_policy'] == 'no_retry':
            review += (' The request was pending when prepared. This proposal did not run it. '
                       'If the card still offers Run it, only the signed-in web owner or paired Telegram owner '
                       'can choose Run it on this exact request card. '
                       'Sparkie cannot confirm for you. A chat reply such as “go ahead” cannot run it.')
            if row['intent']['action'] == 'stop_workload':
                review += (' A current workload observation establishes only its current state. '
                           'It does not establish what happened during an earlier stop or why.')
        return json.dumps({'available': True, 'request': row, 'ran': False, 'confirmation': review})
    except (PermissionError, ValueError, RuntimeError, KeyError, TypeError):
        return json.dumps({'available': False, 'ran': False,
                           'message': 'This Spark request could not be prepared. Check the request ID and configured controls.'})


def status_tool(args, **kwargs):
    try:
        if not isinstance(args, dict) or set(args) != {'operation'}:
            raise ValueError('Use one request ID.')
        return json.dumps({'available': True, 'request': configured().proposal_status(operation=args['operation'])})
    except (PermissionError, ValueError, RuntimeError, KeyError, TypeError):
        return json.dumps({'available': False, 'message': 'That request is unavailable. No action was sent.'})


def check_tool(args, **kwargs):
    try:
        if (not isinstance(args, dict) or 'operation' not in args or set(args) - {'operation', 'final_reply', 'reply_format'}
                or type(args.get('final_reply', False)) is not bool
                or ('reply_format' in args and args['reply_format'] != 'stop_receipt_json')):
            raise ValueError('Use one request ID.')
        row = configured().proposal_check(operation=args['operation'])
        if row['id'] != args['operation']:
            raise ValueError('The returned request ID does not match.')
        result = {'available': True, 'request': row, 'change_dispatched': False,
                  'message': 'This check sent no change. The request shows the recorded result.'}
        if row['intent']['action'] == 'stop_workload':
            # Only a successful stop records that the exact workload was observed
            # stopped. Even a failed dispatch does not establish that it ran on.
            result['stop_receipt'] = {
                'receipt_id': row['id'], 'state': row['state'],
                'stopped': True if row['state'] == 'succeeded' else None,
                'next_step': row['recovery']['message'] or 'Review the existing request card for the next owner action.',
            }
        return json.dumps(result)
    except (PermissionError, ValueError, RuntimeError, KeyError, TypeError):
        return json.dumps({'available': False, 'change_dispatched': False,
                           'message': 'This check could not read the result. No change was sent. Keep any unresolved request.'})


def catalog_tool(args, **kwargs):
    if args:
        return json.dumps({'available': False, 'message': 'This lookup takes no arguments.',
                           'next_step': 'Call spark_service_catalog with an empty object.'})
    try:
        controls = configured()
        return json.dumps({'available': True, 'services': controls.service_catalog(Owner(controls.binding().generation, 'web'))})
    except (OSError, RuntimeError, ValueError, PermissionError):
        return json.dumps({
            'available': False,
            'enrollment_verified': False,
            'message': 'The enrolled service catalog is unavailable. This lookup could not verify a service or endpoint.',
            'next_step': (
                'If the owner or their project already supplied a separately verified endpoint, use it within its scope. '
                'Otherwise stop service discovery now. Repeat lookups and machine or network searches cannot verify enrollment. '
                'Report the unavailable catalog, what remains unmeasured, and the endpoint needed to proceed. '
                'If the owner requested a record, write this blocker in one short file in their project and read it back once. '
                'Only if the owner requested cross-chat recall, save one native memory pointer to that file. '
                'Reserve measurement skills for successful measurements. Finish the owner reply as soon as those tools '
                'confirm the writes.'
            ),
        })


def register(ctx):
    ctx.register_tool(name='spark_service_catalog', toolset='sparks', schema={
        'name': 'spark_service_catalog', 'description': 'Read enrolled app/model names, revisions, allowed Sparks, resource limits and saved instance IDs. No action is sent.',
        'parameters': {'type':'object', 'properties':{}, 'additionalProperties':False}},
        handler=catalog_tool, description='Read the enrolled app and model services')
    ctx.register_tool(name='spark_propose_change', toolset='sparks', schema={
        'name': 'spark_propose_change',
        'description': 'Prepare a wake, safe shutdown, exact container stop, or enrolled service start or stop for the owner to confirm. Use spark_service_catalog for recipe, revision and instance. This never runs the change. For an unresolved change, use spark_check_change on the existing operation ID. Reuse request_id only when redelivering the same proposal. A separately requested new attempt gets a fresh request_id and must follow the recorded recovery policy. Never claim completion from a prepared request.',
        'parameters': {'type': 'object', 'properties': {
            'action': {'type': 'string', 'enum': ['wake', 'sleep', 'stop_workload', 'start_service', 'stop_service']},
            'spark': {'type': 'string', 'enum': ['spark2', 'spark3', 'spark4']},
            'container': {'type': 'string', 'pattern': '^[a-f0-9]{64}$'},
            'recipe': {'type': 'string', 'pattern': '^[a-z][a-z0-9-]{0,47}$'},
            'revision': {'type': 'string', 'pattern': '^[a-f0-9]{64}$'},
            'instance': {'type': 'string', 'pattern': '^[a-f0-9]{32}$'},
            'request_id': {'type': 'string', 'pattern': '^[A-Za-z0-9_-]{8,80}$'},
        }, 'required': ['action', 'spark', 'request_id'], 'additionalProperties': False},
    }, handler=draft_tool, description='Prepare a Spark change for owner review')
    ctx.register_tool(name='spark_change_status', toolset='sparks', schema={
        'name': 'spark_change_status', 'description': 'Read the recorded result of one Spark request. Follow its next step: if it asks for reconciliation, call spark_check_change on the same operation ID. This read cannot approve, retry, cancel or dispatch anything.',
        'parameters': {'type': 'object', 'properties': {'operation': {'type': 'string', 'pattern': '^[a-f0-9]{32}$'}},
                       'required': ['operation'], 'additionalProperties': False},
    }, handler=status_tool, description='Read the recorded Spark change result')
    ctx.register_tool(name='spark_check_change', toolset='sparks', schema={
        'name': 'spark_check_change',
        'description': 'Read the original Spark request before promising or preparing a repeat. For a workload stop, stop_receipt gives the recorded result, including null for an unverified stop. Use final_reply for a plain-text receipt or reply_format for the four-field stop receipt when that answers the whole task. Leave both off for custom formats or other work. This check cannot send a change.',
        'parameters': {'type': 'object', 'properties': {'operation': {'type': 'string', 'pattern': '^[a-f0-9]{32}$'},
            'final_reply': {'type': 'boolean', 'description': 'Use true for a standard plain-text receipt for the recorded change or its repeat. Only held or successful results can finish. Omit for JSON, other requested formats or mixed tasks. Default false.'},
            'reply_format': {'type': 'string', 'enum': ['stop_receipt_json'],
                             'description': 'Use when the whole answer is one JSON stop receipt with exactly receipt_id, state, stopped and next_step. Omit for other fields, a separate current-state question or additional work.'}},
                       'required': ['operation'], 'additionalProperties': False},
    }, handler=check_tool, description='Check the existing Spark request without sending another change')

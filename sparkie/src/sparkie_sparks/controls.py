"""Shared owner controls for native Hermes transports.

This module has no credentials or command execution. The composition root must
provide a protected dispatcher and a current owner-binding loader. Until then,
the native routes report unavailable. Never register confirmation as an LLM tool.
"""

from .authority import Owner
from .operations import STOP_RETENTION_MESSAGES
from .memory_controls import ERASE_ACTION, describe
from .application_updates import ACTION as UPDATE_ACTION


def _recovery(state, action, *, expired=False):
    """A ledger disposition, independent of model prose and separate status reads."""
    from .operations import TERMINAL
    subject = ('application version' if action == UPDATE_ACTION else 'memory contents' if action == ERASE_ACTION else 'machine state'
               if action in ('wake', 'sleep') else 'workload state')
    inspect_state = ('check whether the workload is currently running or stopped'
                     if subject == 'workload state' else f'check the current {subject}')
    after_failure = (f'After a failure, {inspect_state} before considering another attempt. '
                     'If another attempt is appropriate, prepare a new request after checking the resources. '
                     'Then confirm that exact new request ID. It can run only with your fresh confirmation and all resource checks.')
    policy, message = 'no_retry', ''
    if state in ('dispatching', 'uncertain'):
        policy = 'keep_request'
        message = ('Keep this request. Do not retry or replace it while its outcome is unknown. '
                   'Another attempt at this same change is blocked, even if you ask to override the hold. '
                   'Check result reads the same request again. '
                   f'A separate observation of {subject} does not complete this operation.')
    elif state == 'failed':
        policy = 'review_required'
        message = (f'This operation failed; that does not establish the current {subject}. '
                   f'{after_failure} No retry has been sent.')
    elif state == 'cancelled' or expired:
        policy = 'review_required'
        message = ('This request was not sent. Another attempt needs a new request, '
                   'your confirmation and all resource checks.')
    elif state == 'succeeded':
        message = 'This operation is complete. No retry or replacement is needed.'
    return {'operation_terminal': state in TERMINAL, 'retry_policy': policy, 'message': message}


def result_text(row):
    """The same checked result for native owner cards and completion notices."""
    description = row['description']
    if row.get('intent', {}).get('action') == UPDATE_ACTION:
        review = row['intent']['review']
        description = 'Sparkie update ' + review['release'] + '\nCandidate: ' + review['candidate']
    parts = [description, row['message']]
    if row.get('recovery', {}).get('message'):
        parts.append('Recovery: ' + row['recovery']['message'])
    return '\n'.join([*parts, 'Request: ' + row['id']])


class Controls:
    def __init__(self, store, *, binding, dispatch, observe, actions=('wake', 'sleep', 'stop_workload'),
                 available_actions=None, result_view=None, action_description=None, memory_home=None, services=None, service_relay=None, updates=None):
        self.store, self.binding = store, binding
        self.dispatch, self.observe = dispatch, observe
        self.actions = frozenset(actions)
        self.available_actions = available_actions
        self.result_view, self.action_description = result_view, action_description
        self.memory_home = memory_home
        self.services, self.service_relay = services, service_relay
        self.updates = updates
        from .notices import CompletionNotices
        self.notices = CompletionNotices(store, binding=binding)

    def bind_notice(self, owner, operation):
        self.notices.bind(self.current(owner), operation)

    def propose(self, **params):
        from .proposals import propose
        return propose(self, **params)

    def propose_update(self, **params):
        # Storage scope for an unapproved draft, never an approval credential.
        return self.prepare_update(Owner(self.binding().generation, 'web'), **params)

    def proposal_status(self, **params):
        from .proposals import status
        return status(self, **params)

    def proposal_check(self, **params):
        from .proposals import check
        return check(self, **params)

    def actions_for(self, spark):
        if spark not in ('spark2', 'spark3', 'spark4'):
            return frozenset()
        if self.available_actions is None:
            return self.actions
        # Trusted configuration only. Looking at controls must never wake or probe
        # a machine, and a transport cannot grant an action absent from this service.
        return self.actions.intersection(self.available_actions(spark))

    def capabilities(self, owner):
        operations = self.recent(owner)
        by_spark = {}
        for spark in ('spark2', 'spark3', 'spark4'):
            actions = self.actions_for(spark)
            message = ('Power controls are not connected for this Spark.' if 'wake' not in actions else
                       'Shutdown is unavailable until its restart path has been checked.' if 'sleep' not in actions else '')
            by_spark[spark] = {'actions': sorted(actions), 'message': message}
        connected = {action for row in by_spark.values() for action in row['actions']}
        return {'available': True, 'actions': sorted(connected), 'by_spark': by_spark, 'operations': operations,
                'memory_erasure': self.memory_home is not None, 'application_updates': self.updates is not None}

    def current(self, owner):
        if not isinstance(owner, Owner) or owner.generation != self.binding().generation:
            raise PermissionError('Owner access changed. Start a new request.')
        return owner

    def view(self, row):
        target = row['intent']
        erasure = target['action'] == ERASE_ACTION
        updating = target['action'] == UPDATE_ACTION
        if erasure:
            description = describe(target['plan'])
        elif updating:
            from .application_updates import describe as update_description
            description = update_description(target)
        else:
            spark = 'Spark ' + target['spark'][-1]
            description = {
                'wake': f'Wake {spark}.',
                'sleep': f'Shut down {spark} only if its work is safely idle.',
                'start_service': f'Start {target.get("recipe")} revision {target.get("revision")} on {spark}.',
                'stop_service': f'Stop {target.get("recipe")} instance {target.get("instance")} on {spark}.',
                'stop_workload': f'Stop container {target.get("container", "")} on {spark}.',
            }[target['action']]
            if target['action'] in ('stop_service', 'stop_workload'):
                description += ' Container files and volumes stay. Temporary in-memory files and running processes are lost.'
            if callable(self.action_description):
                description = self.action_description(target) or description
        state = row['state']
        messages = {
            'pending': 'Waiting for your confirmation. Nothing has run.',
            'approved': 'Confirmed. The change has not been sent yet.',
            'dispatching': 'The change was sent. Its result is still being checked.',
            'uncertain': 'The result is not known. Check it before trying another change.',
            'succeeded': ('Clean shutdown was verified. Plug power stays on.' if target['action'] == 'sleep'
                          else 'The requested result was observed.'),
            'failed': 'The change did not complete. No automatic retry was sent.',
            'cancelled': 'Cancelled before sending. Nothing ran.',
        }
        expired = state in ('pending', 'approved') and row['expires'] <= self.store.clock()
        message = 'This confirmation expired. Start a new request.' if expired else messages[state]
        if not erasure and not updating and not expired and callable(self.result_view):
            observed_message = self.result_view(row)
            if observed_message:
                message = observed_message
        connected = self._connected(target)
        if state == 'pending' and not connected:
            message = ('Memory erasure is currently unavailable. Nothing ran.' if erasure
                       else 'This action is no longer connected for this Spark. Nothing ran.')
        if row['cancel_requested'] and state not in ('cancelled', 'failed'):
            message += ' Cancellation was requested after sending; this does not mean the work stopped.'
        notice = self.notices.status(row['id'])
        if notice in ('unknown', 'unavailable'):
            message += (' The Telegram completion notice could not be verified; it was not retried.'
                        if notice == 'unknown' else ' The Telegram completion notice could not be sent.')
        update = None
        if updating and self.updates is not None and state in ('dispatching', 'uncertain', 'succeeded', 'failed'):
            try:
                update = self.updates.status(row['id'], target)
            except (OSError, ValueError, RuntimeError):
                update = {'state': 'unknown', 'message': 'The update result could not be checked. Keep this request; do not install it again.'}
            message = update['message']
        disposition = _recovery(state, target['action'], expired=expired)
        if state == 'failed' and row.get('stop_refusal') in STOP_RETENTION_MESSAGES:
            message = STOP_RETENTION_MESSAGES[row['stop_refusal']]
            disposition['message'] = 'Preserve the needed files in persistent storage before considering a new stop request.'
        if update and update['state'] == 'awaiting_owner_check':
            disposition['message'] = 'Check the installed version, then keep it or restore the previous release using this request. No new installation is needed.'
        return {key: row[key] for key in ('id', 'digest', 'expires', 'state', 'cancel_requested')} | {
            'intent': {'action': ERASE_ACTION} if erasure else target,
            'description': description, 'message': message,
            'recovery': disposition,
            'update': update,
            'can_accept_update': bool(update and update.get('accept_available') and update['state'] == 'awaiting_owner_check' and not row['cancel_requested']),
            'can_rollback_update': bool(update and update.get('rollback_available') and update['state'] in ('awaiting_owner_check', 'unknown', 'succeeded')),
            'can_confirm': state == 'pending' and not expired and connected,
            'can_cancel': state in ('pending', 'approved', 'dispatching', 'uncertain') and not row['cancel_requested'],
            'can_check': state in ('dispatching', 'uncertain'),
        }

    def _connected(self, target):
        if target['action'] == UPDATE_ACTION:
            return self.updates is not None
        if target['action'] == ERASE_ACTION:
            return self.memory_home is not None
        return target['action'] in self.actions_for(target['spark'])

    def service_catalog(self, owner):
        self.current(owner)
        return self.services.catalog() if self.services else []

    def service_logs(self, owner, recipe, instance):
        self.current(owner)
        if not self.services:
            raise ValueError('Service inspection is unavailable.')
        return self.services.logs(recipe, instance)

    def service_route(self, owner, recipe, instance=None):
        self.current(owner)
        when = self.services.endpoint(recipe, instance=instance) if self.services else None
        if when is None or self.service_relay is None:
            raise RuntimeError('The service endpoint is not currently verified.')
        result = self.service_relay.ensure(when)
        self.current(owner)
        if not self.services.current_endpoint(when):
            self.service_relay.discard(recipe, when['instance'])
            raise RuntimeError('The service changed during endpoint verification.')
        return result

    def validate_service(self, params):
        from .operations import intent
        if params.get('action') in ('start_service', 'stop_service'):
            if self.services is None:
                raise ValueError('Enrolled services are unavailable.')
            self.services.validate(intent(**{k:v for k,v in params.items()
                if k in ('action','spark','container','recipe','revision','instance')}))

    def prepare(self, owner, **kwargs):
        self.validate_service(kwargs)
        if kwargs.get('action') not in self.actions_for(kwargs.get('spark')):
            raise ValueError('This Spark action is not connected yet.')
        return self.view(self.store.prepare(self.current(owner), **kwargs))

    def prepare_memory(self, owner, *, request_key, request_ref, target, literal):
        owner = self.current(owner)
        if self.memory_home is None:
            raise RuntimeError('Memory erasure is currently unavailable.')
        if (target not in ('memory', 'user') or not isinstance(literal, str)
                or not 1 <= len(literal) <= 512 or not literal.strip() or '\x00' in literal):
            raise ValueError('Enter the exact text from one memory or user preference entry.')
        from .memory_erase import matches_request, prepare
        previous = self.store.for_request(owner, request_key)
        if previous is not None:
            saved = previous['intent']
            if (previous['request_ref'] != request_ref or saved['action'] != ERASE_ACTION
                    or not matches_request(saved['plan'], target, literal)):
                raise ValueError('That request identity already names a different operation.')
            return self.view(previous)
        plan = prepare(self.memory_home, target, literal)
        return self.view(self.store.prepare_memory(owner, request_key=request_key, request_ref=request_ref, plan=plan))

    def get(self, owner, operation):
        row = self.store.get(operation)
        self.store._owner(self.current(owner), row)
        return self.view(row)

    def prepare_update(self, owner, *, request_key, request_ref, proposal):
        owner = self.current(owner)
        if self.updates is None:
            raise RuntimeError('Application updates are not connected yet.')
        previous = self.store.for_request(owner, request_key)
        if previous is not None:
            if (previous['request_ref'] != request_ref or previous['intent']['action'] != UPDATE_ACTION
                    or previous['intent']['proposal'] != proposal):
                raise ValueError('That request identity already names a different operation.')
            return self.view(previous)
        review = self.updates.review(proposal)
        self.current(owner)
        return self.view(self.store.prepare_update(owner, request_key=request_key, request_ref=request_ref,
                                                  proposal=proposal, review=review))

    def _finish_update(self, owner, operation, digest, method):
        with self.store._lock(operation) as acquired:
            if not acquired:
                raise RuntimeError('This update is already being checked. Keep the same request.')
            return self._finish_update_locked(owner, operation, digest, method)

    def _finish_update_locked(self, owner, operation, digest, method):
        owner = self.current(owner)
        row = self.store.get(operation)
        self.store._owner(owner, row)
        if (self.updates is None or row['intent']['action'] != UPDATE_ACTION or row['digest'] != digest
                or row['approved_at'] is None or row['state'] not in ('dispatching', 'uncertain', 'succeeded', 'failed')):
            raise PermissionError('Use the exact approved update request.')
        if method == 'accept' and row['cancel_requested']:
            raise PermissionError('This update was cancelled; inspect or restore it.')
        observed_status = self.updates.status(operation, row['intent'])
        observed = observed_status['state']
        if method == 'rollback' and observed == 'rolled_back' or method == 'accept' and observed == 'succeeded':
            return self.view(self.store._observe(operation, row['intent'], self.observe))
        permitted = ('awaiting_owner_check',) if method == 'accept' else ('awaiting_owner_check', 'succeeded', 'unknown')
        if observed not in permitted:
            raise PermissionError('This update is not ready for that decision. Check the same request.')
        if method == 'rollback' and not observed_status.get('rollback_available'):
            raise PermissionError('This recorded version is not currently eligible for restoration.')
        if method == 'accept' and not observed_status.get('accept_available'):
            raise PermissionError('The reviewed version is not currently eligible for acceptance.')
        if method == 'rollback' and row['state'] in ('succeeded', 'failed'):
            # Accepted versions may be restored only while no later update has
            # claimed the host. Retain the claim across a lost rollback reply.
            with self.store._db() as db:
                claim = db.execute('SELECT operation FROM claims WHERE spark=?', ('spark1',)).fetchone()
                if claim and claim['operation'] != operation:
                    raise RuntimeError('Another update must finish or be checked first.')
                db.execute('INSERT OR IGNORE INTO claims VALUES (?,?)', ('spark1', operation))
                db.execute('UPDATE operations SET state=?,updated=? WHERE id=?', ('uncertain', self.store.clock(), operation))
        # The independent steward serializes handovers and rechecks this receipt
        # against the current owner generation before every effect. These calls
        # never approve or install another candidate.
        self.current(owner)
        getattr(self.updates, method)(operation, row['intent'])
        # A restore after owner acceptance changes a formerly terminal receipt;
        # keep its claim until the steward has observed the restoration.
        result = self.store._observe(operation, row['intent'], self.observe)
        self.notices.arm(operation)
        return self.view(result)

    def accept_update(self, owner, operation, digest):
        return self._finish_update(owner, operation, digest, 'accept')

    def rollback_update(self, owner, operation, digest):
        return self._finish_update(owner, operation, digest, 'rollback')

    def recent(self, owner):
        results = []
        for row in self.store.recent(self.current(owner)):
            if row['intent']['action'] == UPDATE_ACTION:
                # History is a local ledger read. Fetch the one selected update
                # for the sealed review and the steward's current decision state.
                results.append({
                    'id': row['id'], 'state': row['state'], 'review_available': True,
                    'description': 'Sparkie update ' + row['intent']['review']['release'],
                    'message': 'Open this request for its complete review and current update status.',
                    'intent': {k: row['intent'][k] for k in ('action', 'spark', 'proposal')},
                    'can_confirm': False, 'can_accept_update': False, 'can_rollback_update': False,
                })
            else:
                results.append(self.view(row))
        return results

    def confirm(self, owner, operation, digest):
        target = self.get(owner, operation)['intent']
        if not self._connected(target):
            raise ValueError('Memory erasure is currently unavailable. Nothing ran.' if target['action'] == ERASE_ACTION
                             else 'This action is no longer connected for this Spark. Nothing ran.')
        result = self.store.run(self.current(owner), operation,
                                dispatch=self.dispatch, observe=self.observe,
                                approval_digest=digest)
        self.notices.arm(operation)
        return self.view(result)

    def cancel(self, owner, operation):
        return self.view(self.store.cancel(self.current(owner), operation))

    def check(self, owner, operation):
        self.get(owner, operation)
        self.notices.arm(operation)
        return self.view(self.store.reconcile(operation, observe=self.observe))


# Set only by a trusted composition root after the execution boundary is proven.
# This is process-local wiring, not a credential or proof of isolation.
_controls = None


def configured():
    import os
    # Deployment-owned environment only. The socket is never mounted into the
    # model's native Docker environment, and it has no TCP listener.
    if _controls is None and (socket_path := os.environ.get('SPARKIE_CONTROL_SOCKET')):
        from .broker import RemoteControls
        return RemoteControls(socket_path)
    if _controls is None:
        raise RuntimeError('Spark controls are not connected yet. Observations are still available.')
    return _controls

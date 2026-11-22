"""In-memory stand-in for the privileged steward. No process or release is changed."""
from types import SimpleNamespace

from sparkie_sparks.application_updates import ApplicationUpdates
from sparkie_sparks.composition import compose

PROPOSAL = 'c' * 64


def owner_controls(store, binding, steward):
    return compose(store, [], binding=binding, workloads=SimpleNamespace(nodes={}),
                   updates=ApplicationUpdates(store, client=steward))


class FixtureSteward:
    def __init__(self, *, long_review=False):
        self.states = {}
        self.current_operation = None
        self.effects = []
        self.review = {
            'release': 'fixture-update', 'previous': 'a' * 64, 'candidate': 'b' * 64,
            'diff': ('Reviewed lines.\n' * 170 if long_review else '') + 'Last reviewed change.',
            'checks': ('Verified cases.\n' * 170 if long_review else '') + 'Fixture owner routes passed.',
            'interruption': 'Brief local restart.',
            'rollback': 'Return to the previous fixture release.',
        }

    def __call__(self, method, proposal, operation=None):
        if proposal != PROPOSAL:
            raise ValueError('Unknown fixture proposal.')
        if method == 'inspect':
            return {'review': self.review}
        if method == 'observe':
            state = self.states.get(operation, 'unknown')
            current = operation == self.current_operation
            return {'state': state, 'accept_available': current and state == 'awaiting_owner_check',
                    'rollback_available': current and state in ('awaiting_owner_check', 'succeeded')}
        old = self.states.get(operation)
        if method == 'apply' and old is None:
            state = 'awaiting_owner_check'
            self.current_operation = operation
        elif method == 'accept' and operation == self.current_operation and old == 'awaiting_owner_check':
            state = 'succeeded'
        elif method == 'rollback' and operation == self.current_operation and old in ('awaiting_owner_check', 'succeeded'):
            state = 'rolled_back'
            self.current_operation = None
        else:
            raise RuntimeError('The previous decision cannot run twice.')
        self.effects.append((method, operation))
        self.states[operation] = state
        return {'state': state}

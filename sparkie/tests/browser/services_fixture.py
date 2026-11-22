"""Use the real service ledger and owner controls with inert workload effects."""

import json
from threading import Lock
import time
from types import SimpleNamespace

from sparkie_sparks.authority import Owner
from sparkie_sparks.composition import compose
from sparkie_sparks.operations import OperationStore
from sparkie_sparks.recipe_services import RecipeServices, ServiceObservation
from sparkie_sparks.service_definitions import ARTIFACTS, GLM, recipe
from sparkie_sparks.workspace_types import ComputeNode


class ServiceEffects:
    def __init__(self, path):
        self.path = path
        self.path.touch(exist_ok=False)
        self.states = {}
        self.lock = Lock()

    def plan(self, _recipe, _node, instance):
        return 'fixture-service-' + instance

    def _record(self, action, target, node, instance):
        with self.lock:
            self.states[instance] = 'ready' if action == 'start' else 'stopped'
            with self.path.open('a') as stream:
                stream.write(json.dumps({'action': action, 'recipe': target.name,
                                         'spark': node.spark_id, 'instance': instance}) + '\n')

    def start(self, target, node, instance, _workload):
        self._record('start', target, node, instance)

    def stop(self, target, node, instance, _workload, *, operation):
        self._record('stop', target, node, instance)

    def observe(self, target, _node, instance, workload):
        with self.lock:
            state = self.states.get(instance, 'stopped')
        return ServiceObservation(state, workload, target.port if state == 'ready' else None)

    def logs(self, target, node, instance, _workload):
        return [f'{target.name} on {node.spark_id} is {self.states[instance]}.',
                'Fixture output <script>never evaluated</script> ' + ('unbroken-' * 24)]


class ServiceRelay:
    def ensure(self, endpoint):
        return {'kind': endpoint['kind'], 'port': endpoint['port']}

    def discard(self, _recipe, _instance):
        pass


def service_controls(store, binding, home):
    app_nodes = ('spark2', 'spark3', 'spark4')
    nodes = {name: ComputeNode(name, name[-1] * 32, '192.0.2.' + name[-1]) for name in app_nodes}
    effects = ServiceEffects(home / 'service-effects.jsonl')
    recipes = [recipe(ARTIFACTS, app_nodes), recipe(GLM, ('spark4',))]
    services = RecipeServices(store, recipes=recipes, nodes=nodes,
                              backends={'app': effects, 'model': effects},
                              authorize=lambda operation, target: store.get(operation)['intent'] == target)
    # Seed one expired review without advancing the clock for later requests.
    expired = OperationStore(store.path, clock=lambda: time.time() - 600)
    expired.prepare(Owner(binding.generation, 'web'), request_key='expired-service-fixture',
                    request_ref='expired-service-fixture', action='start_service', spark='spark4',
                    recipe=recipes[1].name, revision=recipes[1].revision)
    return compose(store, [], binding=lambda: binding, memory_home=home,
                   workloads=SimpleNamespace(nodes={}), services=services, service_relay=ServiceRelay())

"""Authenticated requests to the existing enrolled compute worker zipapp."""

import json
from pathlib import Path
import shlex
import subprocess

from .worker_network import physical_ssh_options
from .collector import HOST, USER
from .operations import NotDispatched
from .io_budget import remaining_io
from .recipe_services import COMPUTE, INSTANCE, RecipeServices, ServiceObservation
from .service_definitions import DEFINITIONS, recipe
from .workspace_types import ComputeNode


class RemoteServices:
    def __init__(self, controller, nodes, *, run=subprocess.run):
        self.controller, self.run = controller, run
        self.commands = {}
        if not isinstance(controller, str) or not INSTANCE.fullmatch(controller):
            raise ValueError('Enroll this exact service controller.')
        for node, row in nodes:
            if (
                node.spark_id not in COMPUTE
                or not INSTANCE.fullmatch(node.machine_id)
                or not HOST.fullmatch(node.host)
                or not USER.fullmatch(row['user'])
                or any(
                    not Path(row[k]).is_absolute() or any(ord(c) < 32 for c in row[k])
                    for k in ('executable', 'config')
                )
            ):
                raise ValueError('Configure the protected compute worker endpoint.')
            self.commands[node] = [
                'ssh',
                *physical_ssh_options(node.host),
                row['user'] + '@' + node.host,
                shlex.join(['python3', '-I', row['executable'], '--service-config', row['config']]),
            ]

    def _call(self, method, recipe, node, instance, workload, operation):
        request = {
            'method': method,
            'recipe': recipe.name,
            'revision': recipe.revision,
            'instance': instance,
            'operation': operation,
            'spark': node.spark_id,
            'machine': node.machine_id,
            'workload': workload,
            'controller': self.controller,
        }
        try:
            reply = self.run(
                self.commands[node],
                input=json.dumps(request),
                text=True,
                capture_output=True,
                timeout=remaining_io(150 if method == 'start' else 40),
                check=False,
            )
            if reply.returncode or len(reply.stdout) > 8192:
                raise ValueError('Invalid response.')
            result = json.loads(reply.stdout)
            if set(result) != {'operation', 'result'} or result['operation'] != operation:
                raise ValueError('Changed operation identity.')
            if result['result'] == {'not_dispatched': True} and method in ('start', 'stop'):
                raise NotDispatched('The exact service action was refused before dispatch.')
            return result['result']
        except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError):
            raise RuntimeError('The enrolled service worker could not be verified.') from None

    def plan(self, recipe, node, instance):
        if node not in self.commands or recipe.name not in DEFINITIONS or not INSTANCE.fullmatch(instance):
            raise ValueError('Use a fixed service placement.')
        return 'sparkie-' + instance

    def start(self, recipe, node, instance, workload):
        self._call('start', recipe, node, instance, workload, instance)

    def stop(self, recipe, node, instance, workload, *, operation):
        self._call('stop', recipe, node, instance, workload, operation)

    def observe(self, recipe, node, instance, workload):
        result = self._call('observe', recipe, node, instance, workload, instance)
        if not isinstance(result, dict) or set(result) != {'workload', 'port', 'state'}:
            raise RuntimeError('The service observation is incomplete.')
        return ServiceObservation(**result)

    def logs(self, recipe, node, instance, workload):
        result = self._call('logs', recipe, node, instance, workload, instance)
        if (
            not isinstance(result, list)
            or len(result) > 12
            or any(
                not isinstance(line, str) or not 1 <= len(line) <= 160 or any(ord(c) < 32 for c in line)
                for line in result
            )
        ):
            raise RuntimeError('The service log observation is incomplete.')
        return result


def configured_services(store, config, *, inventory, authorize, wake=None):
    if (
        set(config) != {'schema', 'controller', 'hub_machine', 'nodes', 'services'}
        or config['schema'] != 1
        or not INSTANCE.fullmatch(config['hub_machine'])
        or not isinstance(config['nodes'], list)
        or not 1 <= len(config['nodes']) <= 3
        or not isinstance(config['services'], dict)
        or not config['services']
        or not set(config['services']) <= DEFINITIONS.keys()
    ):
        raise ValueError('Use a protected service catalog and fixed compute inventory.')
    nodes = []
    seen = set()
    for row in config['nodes']:
        if set(row) != {'spark', 'machine', 'user', 'executable', 'config'} or row['spark'] in seen:
            raise ValueError('Specify each enrolled service worker once.')
        (item,) = [i for i in inventory if i['id'] == row['spark'] and i['user'] == row['user']]
        node = ComputeNode(item['id'], row['machine'], item['address'])
        if node.machine_id == config['hub_machine'] or any(
            n.machine_id == node.machine_id for n, _ in nodes
        ):
            raise ValueError('Compute service workers must have distinct physical identities.')
        nodes.append((node, row))
        seen.add(node.spark_id)
    remote = RemoteServices(config['controller'], nodes)
    recipes = []
    for name, enrolled in config['services'].items():
        if set(enrolled) != {'revision', 'sparks'} or not isinstance(enrolled['sparks'], list):
            raise ValueError('Specify a reviewed recipe revision and its enrolled Sparks.')
        item = recipe(name, enrolled['sparks'])
        if enrolled['revision'] != item.revision:
            raise ValueError('The approved service recipe revision changed.')
        recipes.append(item)
    return RecipeServices(
        store,
        recipes=recipes,
        nodes={n.spark_id: n for n, _ in nodes},
        backends={'model': remote, 'app': remote},
        authorize=authorize,
        wake=wake,
    )

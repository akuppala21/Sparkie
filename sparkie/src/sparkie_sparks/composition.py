"""Connect typed adapters inside the existing private fleet process.

No new listener, task engine or authority. Power is absent unless an operator
provides its verified inventory and mapping. Full shutdown needs the protected
physical qualification and activity checks; default wake never cycles power.
"""
from .controls import Controls
from .workloads import StopWorkload
from .operations import NotDispatched
from .memory_controls import ERASE_ACTION


def compose(store, nodes, *, binding, power=None, workloads=None, memory_home=None, services=None, service_relay=None, updates=None):
    workloads = workloads or StopWorkload(nodes)

    def current_authority(row):
        from .recipe_services import service_holds_node
        if row['intent']['action'] == 'sleep':
            with store._db() as db:
                if service_holds_node(db, row['intent']['spark']):
                    return False
        return (row['generation'] == binding().generation and not row['cancel_requested'])

    if power is not None:
        # The power adapter rechecks after meter/activity observations and just
        # before every continued physical effect, not only at the UI boundary.
        power.owner_authorizer = current_authority

    def available(spark):
        actions = ['stop_workload'] if spark in workloads.nodes else []
        if power is not None:
            actions.extend(power.actions_for(spark))
        if services and any(spark in r.nodes for r in services.recipes.values()):
            actions.extend(('start_service', 'stop_service'))
        return actions

    def adapter(target):
        if target['action'] == 'update_application' and updates is not None:
            return updates
        if target['action'] in ('start_service', 'stop_service') and services is not None:
            return services
        if target['action'] == 'stop_workload':
            return workloads
        if power is not None and target['action'] in ('wake', 'sleep'):
            return power
        raise RuntimeError('This Spark action is not connected yet.')

    def dispatch(operation, target):
        row = store.get(operation)
        if (row['intent'] != target or row['state'] != 'dispatching'
                or row['approved_at'] is None or not current_authority(row)):
            raise NotDispatched('The exact owner action is no longer authorized. Nothing was sent.')
        if target['action'] == ERASE_ACTION:
            if memory_home is None:
                raise NotDispatched('The native memory store is unavailable.')
            from .memory_erase import apply, ErasurePlanChanged
            try:
                receipt = apply(memory_home, target['plan'])
            except ErasurePlanChanged:
                raise NotDispatched('The exact memory scope changed. Prepare a fresh request.') from None
            return receipt['complete'] is True
        adapter(target).dispatch(operation, target)

    def observe(operation, target):
        if target['action'] == ERASE_ACTION:
            return 'unknown'  # A missing verified receipt cannot be replayed.
        return adapter(target).observe(operation, target)

    return Controls(store, binding=binding, available_actions=available,
                    dispatch=dispatch, observe=observe, memory_home=memory_home,
                    actions=('stop_workload', 'wake', 'sleep', 'start_service', 'stop_service'),
                    services=services, service_relay=service_relay, updates=updates,
                    result_view=getattr(power, 'cached_message', None),
                    action_description=getattr(power, 'description', None))

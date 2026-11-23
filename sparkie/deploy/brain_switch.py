"""Administrator handover of the one native Hermes brain after exact owner approval."""
import argparse
from dataclasses import dataclass
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile

from candidate import sha, verify
from installation import protected_ancestry
import model_unit
from promote import Journal


UNIT = model_unit.BRAIN_NAME + '.service'
UNIT_PATH = Path('/etc/systemd/system') / UNIT
OPERATIONS = Path('/var/lib/sparkie/cutover-operations')
HOST_ID = 'UNENROLLED_HUB_MACHINE_ID'
RECORDS = {'main-model.json', 'alternate-model.json'}
FINISHED = {'replacement-ready', 'previous-model-restored'}
STOPPED = {'inactive', 'failed'}


class SystemdRefused(RuntimeError):
    """A systemctl call returned a failure. A lost reply is a separate outcome."""


@dataclass(frozen=True)
class Recipe:
    record: Path
    weights: Path
    cache: Path
    group: int
    unit: bytes

    @property
    def unit_hash(self):
        return hashlib.sha256(self.unit).hexdigest()

    def verify_artifacts(self):
        model_unit.verify_artifacts(self.record, weights=self.weights, cache=self.cache, group=self.group)


def read_plan(path, expected_hash):
    protected_ancestry(path)
    raw = path.read_bytes()
    if hashlib.sha256(raw).hexdigest() != expected_hash:
        raise ValueError('The exact approved brain switch plan changed.')
    plan = json.loads(raw)
    if (set(plan) != {'schema', 'operation_id', 'candidate_sha256', 'group', 'previous', 'replacement'}
            or plan['schema'] != 1 or not re.fullmatch(r'brain-[a-z0-9-]{1,80}', plan['operation_id'])
            or type(plan['group']) is not int or plan['group'] <= 0):
        raise ValueError('Invalid reviewed brain switch plan.')
    candidate = Path(__file__).resolve().parents[2]
    protected_ancestry(candidate)
    protected_ancestry(candidate / 'candidate.json')
    if sha(candidate / 'candidate.json') != plan['candidate_sha256']:
        raise ValueError('The plan belongs to a different sealed release.')
    verify(candidate)
    recipes = []
    for role in ('previous', 'replacement'):
        row = plan[role]
        if set(row) != {'record', 'weights', 'cache'} or row['record'] not in RECORDS:
            raise ValueError('Use an exact recipe from the sealed release.')
        record = candidate / 'extension/models' / row['record']
        protected_ancestry(record)
        weights, cache = Path(row['weights']), Path(row['cache'])
        if (not weights.is_absolute() or not cache.is_absolute() or '..' in weights.parts
                or '..' in cache.parts):
            raise ValueError('Use reviewed absolute weight and cache directories.')
        if any(not path.is_dir() or path.resolve(strict=True) != path for path in (weights, cache)):
            raise ValueError('Use the reviewed weight and cache directories.')
        # Candidate manifests pin recipe bytes. The renderer supplies every executable argument.
        unit = model_unit.render(record, weights=weights, cache=cache, group=plan['group']).encode()
        recipes.append(Recipe(record, weights, cache, plan['group'], unit))
    if recipes[0].record == recipes[1].record:
        raise ValueError('The replacement must use a different sealed checkpoint.')
    return plan['operation_id'], *recipes


@dataclass(frozen=True)
class Observed:
    recipe: Recipe
    container: str | None = None
    stale: bool = False
    starting: bool = False
    invocation: str = ''
    restarts: int = 0


class Host:
    def systemctl(self, *args):
        result = subprocess.run(['/usr/bin/systemctl', *args], capture_output=True, text=True,
                                env={'PATH': '/usr/sbin:/usr/bin:/sbin:/bin'}, check=False, timeout=600)
        if result.returncode:
            raise SystemdRefused('Systemd did not confirm the requested brain phase.')
        return result.stdout

    def observe(self, previous, replacement, *, abort_start=False):
        protected_ancestry(UNIT_PATH)
        if not UNIT_PATH.is_file():
            raise RuntimeError('The installed brain unit is missing.')
        installed_hash = sha(UNIT_PATH)
        recipe = {previous.unit_hash: previous, replacement.unit_hash: replacement}.get(installed_hash)
        if recipe is None:
            raise RuntimeError('The installed brain unit differs from both reviewed recipes.')
        state = dict(line.split('=', 1) for line in self.systemctl(
            'show', UNIT, '--all', '--property=FragmentPath,DropInPaths,NeedDaemonReload,ActiveState,Job,InvocationID,NRestarts').splitlines()
                     if '=' in line)
        active = state.get('ActiveState')
        stale = state.get('NeedDaemonReload')
        starting = abort_start and recipe == replacement and active == 'activating' and stale == 'no'
        settled = (state.get('Job') in ('0', '') and active in (STOPPED | {'active'})
                   and (stale == 'no' or stale == 'yes' and active in STOPPED))
        if (state.get('FragmentPath') != str(UNIT_PATH) or state.get('DropInPaths') != ''
                or not (settled or starting)):
            raise RuntimeError('The brain service is unsettled or its loaded definition changed.')
        row = model_unit.inspect_container(model_unit.BRAIN_NAME, missing_ok=True)
        if row is None:
            if active == 'active':
                raise RuntimeError('The active brain has no matching container.')
            return Observed(recipe, stale=stale == 'yes', starting=starting,
                            invocation=state.get('InvocationID', '') if starting else '',
                            restarts=int(state.get('NRestarts', 0)) if starting else 0)
        model_unit.require_identity(row, recipe.record, model_unit.selected(recipe.record))
        if (not (active == 'active' and row['State']['Running'] or starting)
                or not re.fullmatch('[a-f0-9]{64}', row.get('Id', ''))):
            raise RuntimeError('The reviewed brain container and service state disagree.')
        return Observed(recipe, row['Id'], starting=starting, invocation=state.get('InvocationID', ''),
                        restarts=int(state.get('NRestarts', 0)))

    def automatic_restart(self, target, observed):
        # A manual start also changes the invocation ID. Require every intervening
        # start to follow PID 1 scheduling the prior invocation's automatic restart.
        invocation = target.get('invocation', '')
        count = observed.restarts - target.get('restarts', 0)
        if count <= 0 or not all(re.fullmatch('[0-9a-f]{32}', value) for value in (invocation, observed.invocation)):
            return False
        restart = '5eb03494b6584870a536b337290809b3'
        start = '7d4958e842da4a758f6c1cdc7b36dcc5'
        result = subprocess.run(['/usr/bin/journalctl', '--boot=0', '--quiet', '--output=json',
                                 '--output-fields=MESSAGE_ID,INVOCATION_ID', '--lines=' + str(2 * count),
                                 '_PID=1', 'UNIT=' + UNIT, 'MESSAGE_ID=' + restart, 'MESSAGE_ID=' + start],
                                capture_output=True, text=True, check=True, timeout=10)
        events = [json.loads(line) for line in result.stdout.splitlines()]
        if len(events) != 2 * count:
            return False
        for scheduled, started in zip(events[::2], events[1::2]):
            if (scheduled.get('MESSAGE_ID') != restart or scheduled.get('INVOCATION_ID') != invocation
                    or started.get('MESSAGE_ID') != start):
                return False
            invocation = started.get('INVOCATION_ID', '')
            if not re.fullmatch('[0-9a-f]{32}', invocation):
                return False
        return invocation == observed.invocation

    def ready(self, recipe):
        model_unit.wait_ready(recipe.record, timeout=12)
        model_unit.probe_inference(recipe.record)

    def stop(self):
        self.systemctl('stop', UNIT)

    def start(self):
        self.systemctl('start', UNIT)

    def reload(self):
        self.systemctl('daemon-reload')

    def reset_failed(self):
        try:
            self.systemctl('reset-failed', UNIT)
        except SystemdRefused:
            # An inactive unit can be garbage collected after daemon-reload.
            # An unloaded unit has no in-memory start-rate counter to reset.
            if self.systemctl('list-units', '--all', '--no-legend', '--plain', UNIT).strip():
                raise

    def install(self, current, target):
        protected_ancestry(UNIT_PATH)
        if sha(UNIT_PATH) != current.unit_hash:
            raise RuntimeError('The reviewed unit changed before publication.')
        with tempfile.NamedTemporaryFile(dir=UNIT_PATH.parent, prefix='.sparkie-brain-', delete=False) as stream:
            staged = Path(stream.name)
            try:
                stream.write(target.unit)
                stream.flush()
                os.fchmod(stream.fileno(), 0o644)
                os.fsync(stream.fileno())
                os.replace(staged, UNIT_PATH)
                directory_fd = os.open(UNIT_PATH.parent, os.O_RDONLY | os.O_DIRECTORY)
                try:
                    os.fsync(directory_fd)
                finally:
                    os.close(directory_fd)
            finally:
                staged.unlink(missing_ok=True)


def mark(journal, state, identifier):
    journal.data.update(state=state, container_id=identifier)
    journal.save()
    return state


def require_rollback_target(target, observed, host):
    if not observed.container and not observed.starting:
        return  # Nothing is running or scheduled to stop.
    invocation = target.get('invocation')
    same_invocation = bool(invocation and invocation == observed.invocation)
    if observed.container and target.get('container_id'):
        if observed.container == target['container_id'] and (same_invocation or not invocation):
            return  # Older journals record only the original container ID.
    elif same_invocation:
        return  # The verified start can be observed before Docker creates its container.
    if not host.automatic_restart(target, observed):
        raise RuntimeError('The exact running replacement changed after this operation.')


def settle(journal, previous, replacement, host, *, rollback=False, reviewed=None):
    """Observe an uncertain result. Only restore the predecessor when recovery needs a mutation."""
    abort = rollback or journal.data.get('replacement_start_refused') or journal.data['state'] == 'restoring'
    observed = reviewed or host.observe(previous, replacement, abort_start=abort)
    if (observed.recipe == replacement and observed.container and not observed.starting
            and not rollback and journal.data['state'] == 'switching'):
        try:
            host.ready(replacement)
        except (RuntimeError, TimeoutError):
            pass
        else:
            if host.observe(previous, replacement) != observed:
                raise RuntimeError('The replacement changed during its readiness check.')
            journal.data.update(invocation=observed.invocation, restarts=observed.restarts)
            return mark(journal, 'replacement-ready', observed.container)
    if observed.recipe == previous and observed.container:
        host.ready(previous)
        if host.observe(previous, replacement) != observed:
            raise RuntimeError('The previous brain changed during its readiness check.')
        return mark(journal, 'previous-model-restored', observed.container)

    previous.verify_artifacts()
    if observed.recipe == replacement:
        if reviewed is not None or journal.data['state'] == 'restoring':
            require_rollback_target(journal.data.get('rollback_target', journal.data), observed, host)
        if host.observe(previous, replacement, abort_start=True) != observed:
            raise RuntimeError('The exact running replacement changed during rollback preflight.')
        # Persist this identity together with restoring, before the first stop can be dispatched.
        journal.data['rollback_target'] = {'container_id': observed.container, 'invocation': observed.invocation,
                                           'restarts': observed.restarts}
    journal.data['state'] = 'restoring'
    journal.save()
    if observed.container or observed.starting:
        journal.step('stop-exact-replacement-brain', host.stop)
        observed = host.observe(previous, replacement)
        if observed.container:
            raise RuntimeError('The replacement is still running. Recovery is pending.')
    if observed.recipe == replacement:
        journal.step('restore-previous-brain-unit', lambda: host.install(replacement, previous))
    if observed.recipe == replacement or observed.stale:
        journal.step('reload-previous-brain-unit', host.reload)
    if host.observe(previous, replacement) != Observed(previous):
        raise RuntimeError('The stopped previous unit could not be verified before recovery.')
    if any(entry['phase'] == 'start-previous-brain' for entry in journal.data['events']):
        raise RuntimeError('The recorded previous-model start is unverified. Inspect it before any retry.')
    # The replacement shares this unit's start-rate counter. Clear any failed replacement
    # budget only after the exact predecessor has been restored and observed stopped.
    journal.step('clear-replacement-start-limit', host.reset_failed)
    journal.step('start-previous-brain', host.start)
    observed = host.observe(previous, replacement)
    if observed.recipe != previous or not observed.container:
        raise RuntimeError('The previous brain did not start.')
    host.ready(previous)
    if host.observe(previous, replacement) != observed:
        raise RuntimeError('The previous brain changed during its readiness check.')
    return mark(journal, 'previous-model-restored', observed.container)


def begin(directory, plan_hash, previous, replacement, identifier, generation):
    # A crash during journal creation can leave only a hidden temporary directory. No service
    # effect is dispatched until the complete journal and its directory entry are durable.
    with tempfile.TemporaryDirectory(dir=directory.parent, prefix='.brain-switch-') as staging:
        journal = Journal(Path(staging) / directory.name, plan_hash=plan_hash)
        journal.data.update(kind='brain-switch', state='switching', generation=generation, previous_container_id=identifier,
                            previous_unit_sha256=previous.unit_hash, replacement_unit_sha256=replacement.unit_hash)
        journal.save()
        os.replace(journal.directory, directory)
        fd = os.open(directory.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    return Journal(directory)


def switch(directory, plan_hash, previous, replacement, host, generation):
    observed = host.observe(previous, replacement)
    if observed.recipe != previous or not observed.container:
        raise RuntimeError('The reviewed predecessor must be running before the switch.')
    host.ready(previous)
    previous.verify_artifacts()
    replacement.verify_artifacts()
    if host.observe(previous, replacement) != observed:
        raise RuntimeError('The running predecessor changed during preflight.')
    journal = begin(directory, plan_hash, previous, replacement, observed.container, generation)
    try:
        journal.step('stop-exact-previous-brain', host.stop)
        if host.observe(previous, replacement) != Observed(previous):
            raise RuntimeError('The previous brain is still running.')
        journal.step('install-replacement-brain-unit', lambda: host.install(previous, replacement))
        journal.step('reload-replacement-brain-unit', host.reload)
        if host.observe(previous, replacement) != Observed(replacement):
            raise RuntimeError('The stopped replacement unit could not be verified.')
        try:
            journal.step('start-replacement-brain', host.start)
        except SystemdRefused:
            journal.data['replacement_start_refused'] = True
            raise
    except (RuntimeError, OSError, ValueError, subprocess.SubprocessError) as error:
        journal.data['switch_error'] = type(error).__name__
        journal.save()
    return settle(journal, previous, replacement, host)


def execute(action, operation_id, plan_hash, previous, replacement, host):
    protected_ancestry(OPERATIONS)
    directory = OPERATIONS / operation_id
    lock = OPERATIONS / '.brain-switch.lock'
    fd = os.open(lock, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'r+b') as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        other_generations = []
        for other in OPERATIONS.glob('brain-*'):
            if other == directory:
                continue
            entry = Journal(other)
            other_generations.append(entry.data.get('generation', 0))
            if entry.data.get('state') not in FINISHED:
                raise RuntimeError('Reconcile the prior brain operation before dispatching any new one.')
        if directory.exists() or directory.is_symlink():
            journal = Journal(directory)
            if (journal.data.get('kind') != 'brain-switch' or journal.data['plan_sha256'] != plan_hash
                    or journal.data.get('previous_unit_sha256') != previous.unit_hash
                    or journal.data.get('replacement_unit_sha256') != replacement.unit_hash):
                raise ValueError('Use the existing operation’s exact approved plan.')
            state = journal.data['state']
            if action == 'switch':
                return state  # Repeat delivery never sends the stop/start sequence again.
            if state == 'previous-model-restored' or (state == 'replacement-ready' and action == 'reconcile'):
                return state
            reviewed = None
            if state == 'replacement-ready':
                observed = host.observe(previous, replacement, abort_start=True)
                generation = journal.data.get('generation', 0)
                if any(other > generation or other == generation and not observed.container for other in other_generations):
                    raise RuntimeError('A later or ambiguous brain operation prevents rollback of this one.')
                if observed.recipe != replacement:
                    raise RuntimeError('The exact running replacement changed after this operation.')
                reviewed = observed
            return settle(journal, previous, replacement, host, rollback=(action == 'rollback'), reviewed=reviewed)
        if action != 'switch':
            raise ValueError('No recorded brain operation to reconcile.')
        return switch(directory, plan_hash, previous, replacement, host, max(other_generations, default=0) + 1)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['switch', 'reconcile', 'rollback'])
    parser.add_argument('--plan', type=Path, required=True)
    parser.add_argument('--approved-plan-sha256', required=True)
    args = parser.parse_args()
    if os.geteuid() != 0 or Path('/etc/machine-id').read_text().strip() != HOST_ID:
        raise PermissionError('Only the administrator on permanent Spark 1 may run an approved switch.')
    operation_id, previous, replacement = read_plan(args.plan.absolute(), args.approved_plan_sha256)
    result = execute(args.action, operation_id, args.approved_plan_sha256, previous, replacement, Host())
    recipe = {'replacement-ready': replacement, 'previous-model-restored': previous}.get(result)
    model = model_unit.selected(recipe.record) if recipe is not None else None
    print(json.dumps({'operation_id': operation_id, 'state': result,
                      'checkpoint': model['repository'] if model else None,
                      'revision': model['revision'] if model else None}))


if __name__ == '__main__':
    main()

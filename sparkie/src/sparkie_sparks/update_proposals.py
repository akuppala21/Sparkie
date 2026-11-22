"""Transfer a prepared compute artifact for owner review, never installation.

Uses the native task's already enrolled SSH environment. Model arguments cannot
choose a host, credential, host destination or activation command.
"""
import hashlib
import errno
import json
import os
import re
from pathlib import Path, PurePosixPath
import selectors
import shlex
import shutil
import subprocess
import tempfile
import time
import tarfile

from .application_updates import digest, reviewed

INBOX = Path('/var/lib/sparkie-update-inbox')
MAX_ARCHIVE = 2 * 1024 ** 3
MAX_REVIEW = 24 * 1024
CURRENT = Path('/opt/sparkie/current')

# Runs only in the task's isolated compute container. Follow no final symlink,
# reject paths resolving outside /workspace, stream only a bounded regular file.
READ = '''import os, pathlib, stat, sys
p = pathlib.PurePosixPath(sys.argv[1])
assert p.is_relative_to('/workspace') and '..' not in p.parts
parent = os.open('/workspace', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
try:
 for part in p.relative_to('/workspace').parts[:-1]:
  child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
  os.close(parent)
  parent = child
 fd = os.open(p.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
finally:
 os.close(parent)
with os.fdopen(fd, 'rb') as source:
 s = os.fstat(source.fileno())
 assert stat.S_ISREG(s.st_mode) and 0 < s.st_size <= int(sys.argv[2])
 while chunk := source.read(1024 * 1024):
  sys.stdout.buffer.write(chunk)
'''


def existing_offer(destination, expected_review, expected_archive):
    """A prior or concurrent transfer counts only when both exact files exist."""
    directory = os.open(destination, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for name, limit in (('review.json', MAX_REVIEW), ('release.tar', MAX_ARCHIVE)):
            fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
            with os.fdopen(fd, 'rb') as source:
                import stat
                mode = os.fstat(source.fileno())
                if not stat.S_ISREG(mode.st_mode) or not 0 < mode.st_size <= limit:
                    raise ValueError('The existing update offer is incomplete.')
                if name == 'review.json':
                    valid = source.read(limit + 1) == expected_review
                else:
                    valid = hashlib.file_digest(source, 'sha256').hexdigest() == expected_archive
                if not valid:
                    raise ValueError('The existing update offer does not match its reviewed bytes.')
    finally:
        os.close(directory)


def fetch(environment, source, destination, limit):
    """Native pinned SSH options; parent enforces byte and time bounds too."""
    command = environment._build_ssh_command() + [shlex.join(['python3', '-I', '-c', READ, source, str(limit)])]
    total, deadline = 0, time.monotonic() + 180
    with destination.open('xb') as out, subprocess.Popen(command, stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL) as process:
        try:
            with selectors.DefaultSelector() as ready:
                ready.register(process.stdout, selectors.EVENT_READ)
                while True:
                    remaining = deadline - time.monotonic()
                    if remaining <= 0 or not ready.select(remaining):
                        raise RuntimeError('The prepared update transfer timed out.')
                    chunk = os.read(process.stdout.fileno(), min(1024 * 1024, limit - total + 1))
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > limit:
                        raise ValueError('The prepared update exceeds the transfer limit.')
                    out.write(chunk)
            if process.wait(timeout=max(.1, deadline - time.monotonic())) != 0 or total == 0:
                raise RuntimeError('The prepared update could not be read from its compute workspace.')
            out.flush()
            os.fsync(out.fileno())
        finally:
            if process.poll() is None:
                process.kill()
                process.wait()


def receive(environment, folder, proposal, *, inbox=INBOX, transfer=fetch):
    digest(proposal)
    path = PurePosixPath(folder) if isinstance(folder, str) else None
    if (path is None or not path.is_absolute() or not path.is_relative_to('/workspace')
            or '..' in path.parts or str(path) != folder or path.name != proposal or len(folder) > 1024):
        raise ValueError('Select the prepared proposal directory inside this compute workspace.')
    inbox = Path(inbox)
    mode = inbox.lstat()
    import stat
    if not stat.S_ISDIR(mode.st_mode) or mode.st_uid != os.geteuid() or mode.st_mode & 0o077:
        raise RuntimeError('The private application update inbox is unavailable.')
    if shutil.disk_usage(inbox).free < MAX_ARCHIVE + 1024 ** 3:
        raise RuntimeError('There is not enough free space to receive an update safely.')
    with tempfile.TemporaryDirectory(prefix='.receive-', dir=inbox) as work:
        staging = Path(work)
        transfer(environment, str(path / 'review.json'), staging / 'review.json', MAX_REVIEW)
        raw = (staging / 'review.json').read_bytes()
        if hashlib.sha256(raw).hexdigest() != proposal:
            raise ValueError('The prepared update review changed.')
        review = json.loads(raw)
        if not isinstance(review, dict) or 'archive' not in review:
            raise ValueError('The prepared update has no archive identity.')
        archive_hash = digest(review.pop('archive'))
        reviewed(review)
        destination = inbox / proposal
        if destination.exists() or destination.is_symlink():
            # Never replace a submitted proposal, including after uncertain delivery.
            existing_offer(destination, raw, archive_hash)
            return proposal
        transfer(environment, str(path / 'release.tar'), staging / 'release.tar', MAX_ARCHIVE)
        with (staging / 'release.tar').open('rb') as archive:
            if hashlib.file_digest(archive, 'sha256').hexdigest() != archive_hash:
                raise ValueError('The prepared update archive changed during transfer.')
        try:
            os.rename(staging, destination)
        except OSError as error:
            if error.errno not in (errno.EEXIST, errno.ENOTEMPTY):
                raise
            existing_offer(destination, raw, archive_hash)
        directory = os.open(inbox, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    return proposal


def offer_tool(args, **kwargs):
    try:
        if (not isinstance(args, dict) or set(args) != {'directory', 'proposal', 'request_id'}
                or not isinstance(args['request_id'], str) or not re.fullmatch('[A-Za-z0-9_-]{8,80}',args['request_id'])):
            raise ValueError('Use the prepared update directory, proposal identity and request ID.')
        from tools.file_tools import _get_file_ops
        from .sandbox_provider import LeasedSandboxSSH
        from .proposals import context
        from .controls import configured
        route = context()
        environment = _get_file_ops(kwargs.get('task_id') or 'default').env
        if not isinstance(environment, LeasedSandboxSSH):
            raise ValueError('Submit updates only from the enrolled compute workspace.')
        proposal = receive(environment, args['directory'], args['proposal'])
        anchor = route['message_id'] or args['request_id']
        key = hashlib.sha256(json.dumps([route['session'],anchor,proposal]).encode()).hexdigest()
        controls = configured()
        row = controls.propose_update(request_key='update:' + key, request_ref='Hermes update proposal: ' + key,
                                      proposal=proposal)
        from .telegram_controls import deliver_proposal
        try:
            delivered = deliver_proposal(controls, route, row['id'])
        except (PermissionError, ValueError, RuntimeError):
            delivered = False
        return json.dumps({'available': True, 'ran': False, 'operation': row['id'], 'proposal': proposal,
            'message': ('Review the exact update card in this chat.' if delivered else
                        'Review this request on Home or with /spark show ' + row['id'] + ' in the paired chat.')})
    except (OSError, PermissionError, ValueError, RuntimeError, KeyError, TypeError, subprocess.SubprocessError):
        return json.dumps({'available': False, 'ran': False,
            'message': 'The update could not be prepared for review. Check the sealed artifact and the configured update connection. No installation was requested.'})


def export_source(environment, *, current=CURRENT):
    """Only the sealed app and base interpreter; no home, keys, weights or state."""
    import importlib.util
    import stat
    root = current.resolve(strict=True)
    if root.parent != Path('/opt/sparkie/releases'):
        raise ValueError('The active release is not installed at its protected path.')
    for item in (root, *root.parents):
        entry = item.lstat()
        if not stat.S_ISDIR(entry.st_mode) or entry.st_uid != 0 or entry.st_mode & 0o022:
            raise ValueError('The active release has writable ancestry.')
    verifier = root/'extension/deploy/candidate.py'
    for parent in verifier.parents:
        entry = parent.lstat()
        if not stat.S_ISDIR(entry.st_mode) or entry.st_uid != 0 or entry.st_mode & 0o022:
            raise ValueError('The installed verifier has writable ancestry.')
    entry = verifier.lstat()
    if not stat.S_ISREG(entry.st_mode) or entry.st_uid != 0 or entry.st_mode & 0o022:
        raise ValueError('The active release verifier is not protected.')
    spec = importlib.util.spec_from_file_location('sparkie_current_candidate',verifier)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    manifest = module.verify(root)
    base = Path(manifest['runtime']['base_root'])
    if not base.is_relative_to('/opt/sparkie/python') or base.resolve(strict=True) != base:
        raise ValueError('The sealed interpreter is outside its reviewed build root.')
    for parent in (base, *base.parents):
        entry = parent.lstat()
        if not stat.S_ISDIR(entry.st_mode) or entry.st_uid != 0 or entry.st_mode & 0o022:
            raise ValueError('The sealed interpreter has writable ancestry.')
    manifest_hash = module.sha(root/'candidate.json')
    remote = '/workspace/sparkie-build-inputs/' + manifest_hash + '.tar'
    with tempfile.TemporaryDirectory(prefix='.source-',dir=INBOX) as folder:
        archive = Path(folder)/'build-inputs.tar'
        with tarfile.open(archive,'w',dereference=False) as out:
            for directory, names in ((root, ['candidate.json', *manifest['files'], *manifest['symlinks']]),
                    (base, [*manifest['runtime']['base_files'], *manifest['runtime']['base_symlinks']])):
                for name in sorted(names):
                    path = directory/name
                    if path.is_symlink():
                        # Exact link destinations were checked by the pinned verifier.
                        out.add(path,arcname=str(path.relative_to('/opt/sparkie')),recursive=False)
                    else:
                        info = path.lstat()
                        if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
                            raise ValueError('A sealed build input is writable or not a regular file.')
                        out.add(path,arcname=str(path.relative_to('/opt/sparkie')),recursive=False)
                    if out.fileobj.tell() > MAX_ARCHIVE:
                        raise ValueError('The sealed build inputs exceed the transfer limit.')
        environment._scp_upload(str(archive),remote)
        archive_hash = module.sha(archive)
    return {'archive':remote, 'sha256':archive_hash, 'previous':manifest_hash,
            'baseline':'/opt/sparkie/releases/'+root.name, 'base_python':manifest['runtime']['base_python'],
            'message':'Build inputs only; the live app is unchanged. Verify the archive hash, then extract into /opt/sparkie inside this private compute workspace. Use the existing candidate builder and affected tests before offering an update.'}


def source_tool(args, **kwargs):
    try:
        if args:
            raise ValueError('This source export takes no host paths or arguments.')
        from tools.file_tools import _get_file_ops
        from .sandbox_provider import LeasedSandboxSSH
        from .proposals import context
        context()
        environment = _get_file_ops(kwargs.get('task_id') or 'default').env
        if not isinstance(environment,LeasedSandboxSSH):
            raise ValueError('Prepare updates only in the enrolled compute workspace.')
        return json.dumps({'available':True, **export_source(environment)})
    except (OSError, ValueError, RuntimeError, KeyError, TypeError, subprocess.SubprocessError):
        return json.dumps({'available':False,
            'message':'The installed build inputs could not be exported to the compute workspace. No live change was made.'})


def register(ctx):
    ctx.register_tool(name='spark_update_source', toolset='sparks', schema={
        'name':'spark_update_source',
        'description':'Copy the installed sealed application and its build interpreter into this private compute workspace to prepare an update. Excludes conversations, credentials, model weights and runtime state. This cannot change the live application.',
        'parameters':{'type':'object','properties':{},'additionalProperties':False}},
        handler=source_tool, description='Prepare isolated application build inputs')
    ctx.register_tool(name='spark_offer_update', toolset='sparks', schema={
        'name': 'spark_offer_update',
        'description': 'Submit a built and tested application update from this compute workspace for exact owner review. Use deploy/upgrade.py prepare to produce the directory and proposal SHA. Reuse request_id for redelivery; use a fresh ID for a separately requested attempt after checking the prior outcome. An unresolved installation keeps its existing ID. This transfers the artifact and drafts a request; it cannot approve, install, accept or restore a release.',
        'parameters': {'type': 'object', 'properties': {
            'directory': {'type': 'string', 'description': 'Absolute /workspace directory ending in the proposal SHA; contains review.json and release.tar.'},
            'proposal': {'type': 'string', 'pattern': '^[a-f0-9]{64}$'},
            'request_id': {'type': 'string', 'pattern': '^[A-Za-z0-9_-]{8,80}$'}},
            'required': ['directory', 'proposal', 'request_id'], 'additionalProperties': False}},
        handler=offer_tool, description='Offer a tested app update for owner review')

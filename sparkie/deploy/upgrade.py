"""External steward for backward-compatible Sparkie application updates.

The systemd socket hands this fixed, administrator-installed file an accepted
connection. Never import or execute incoming Python, units, hooks, or checks as
root. The native gateway and fleet controller continue running as their
installed non-root account. Candidate preparation also uses this file as a CLI.
"""
import argparse
import contextlib
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
from io import BytesIO
import re
import shutil
import socket
import sqlite3
import sys
import stat
import struct
import subprocess
import tarfile
import tempfile
import time
import urllib.error
import urllib.request
import zipfile

APP = Path('/opt/sparkie')
RELEASES = APP / 'releases'
CURRENT = APP / 'current'
INBOX = Path('/var/lib/sparkie-update-inbox')
RECEIPTS = Path('/var/lib/sparkie-updates')
CONTROLLER = Path('/etc/sparkie/controller.json')
GUIDANCE = APP/'steward/guidance.json'
BINARY = '/usr/bin/systemctl'
UNITS = ('sparkie-fleet.service', 'hermes-gateway.service')
GATE = 'http://127.0.0.1:32131'
HEX = re.compile(r'[a-f0-9]{64}')
OP = re.compile(r'[a-f0-9]{32}')
NAME = re.compile(r'[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}')
REVIEW = {'release','previous','candidate','archive','diff','checks','interruption','rollback'}
MAX_ARCHIVE = 2 * 1024 ** 3
MAX_MEMBER = 256 * 1024 ** 2
MAX_MANIFEST = 32 * 1024 ** 2
MAX_FILES = 90000
MAX_REVIEW = 24 * 1024
# This release class is confined to the tested presentation and guidance surfaces
# and read-only research helpers. Privileged policy, dispatch, storage schemas,
# worker entrypoints, private settings, and all maintained upstream code stay fixed.
APP_FILES = ('extension/SOUL.md',)
PLUGIN_UI = ('extension/plugin/dashboard/', 'extension/recipes_plugin/dashboard/',
             'bundled-plugins/sparkie-sparks/dashboard/', 'bundled-plugins/sparkie-home/dashboard/',
             'bundled-plugins/sparkie-recipes/dashboard/')
UI = ('dashboard/', 'webapp/', *PLUGIN_UI)
APP_DIRS = (*UI, 'extension/docs/', 'extension/tests/')
PLUGIN_MANIFESTS = {directory+'manifest.json' for directory in PLUGIN_UI}
VENV = 'hermes/.venv/'


def require(condition, detail):
    if not condition:
        raise ValueError(detail)


def digest(contents):
    return hashlib.sha256(contents).hexdigest()


def file_hash(path):
    with Path(path).open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


def safe_name(name):
    p = PurePosixPath(name)
    require(isinstance(name, str) and len(name) <= 800 and str(p) == name and
            not p.is_absolute() and all(part not in ('.', '..', '') for part in p.parts)
            and all(ord(c) >= 32 and c != '\\' for c in name) and p.parts,
            'Invalid release archive member.')
    return name


def review_bytes(raw, proposal):
    require(len(raw) <= MAX_REVIEW and HEX.fullmatch(proposal) and digest(raw) == proposal,
            'The reviewed proposal changed.')
    review = json.loads(raw)
    require(isinstance(review, dict) and set(review) == REVIEW, 'Invalid update review.')
    require(isinstance(review['release'], str) and NAME.fullmatch(review['release']) and '..' not in review['release'],
            'Invalid release name.')
    for field in ('archive', 'previous', 'candidate'):
        require(isinstance(review[field], str) and HEX.fullmatch(review[field]), 'Invalid reviewed digest.')
    require(review['previous'] != review['candidate'], 'Choose a different candidate.')
    for field in ('diff', 'checks', 'interruption', 'rollback'):
        value = review[field]
        require(isinstance(value, str) and value.strip() and len(value) <= 4000 and len(value.encode()) <= 8192 and
                all(ord(c) >= 32 or c == '\n' for c in value), 'Incomplete update evidence.')
    require(len(json.dumps(public_review(review),ensure_ascii=False).encode()) <= MAX_REVIEW-1024,
            'Update review exceeds transport limits.')
    return review


@contextlib.contextmanager
def input_file(proposal, name):
    require(HEX.fullmatch(proposal) and name in ('review.json','release.tar'), 'Invalid update input.')
    directory = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
    root = os.open(INBOX, directory)
    try:
        folder = os.open(proposal, directory, dir_fd=root)
        try:
            fd = os.open(name, os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW, dir_fd=folder)
        finally:
            os.close(folder)
    finally:
        os.close(root)
    with os.fdopen(fd, 'rb') as stream:
        info = os.fstat(fd)
        limit = MAX_ARCHIVE if name == 'release.tar' else MAX_REVIEW
        require(stat.S_ISREG(info.st_mode) and 0 < info.st_size <= limit, 'Invalid update input file.')
        yield stream


def public_review(review):
    return {k:v for k,v in review.items() if k != 'archive'}


def review_for(proposal):
    with input_file(proposal, 'review.json') as source:
        return review_bytes(source.read(MAX_REVIEW + 1), proposal)


def selector():
    require(CURRENT.is_symlink(), 'The active release selector is unavailable.')
    actual = CURRENT.resolve(strict=True)
    require(actual.parent == RELEASES and NAME.fullmatch(actual.name), 'Unexpected active release.')
    return actual


def replace_selector(target):
    require(target.parent == RELEASES and target.resolve(strict=True) == target, 'Invalid retained release.')
    with tempfile.TemporaryDirectory(dir=APP) as temporary:
        link = Path(temporary) / 'current'
        link.symlink_to(target)
        os.replace(link, CURRENT)
    sync_directory(APP)


def sync_directory(path):
    fd = os.open(path, os.O_DIRECTORY | os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def application_file(name):
    if name.startswith('extension/skills/'):
        return ((len(PurePosixPath(name).parts) == 4 and name.endswith('/SKILL.md'))
                or name == 'extension/skills/local-recipe-review/scripts/read_forum.py')
    if name.startswith(UI) and (name.endswith(('.py','.pyc','.pyo','.pyd','.so')) or '/__pycache__/' in name):
        return False
    return name in APP_FILES or name.startswith(APP_DIRS)


def checked_manifest(new, old, target):
    require(set(new) == set(old) and all(new[k] == old[k] for k in old if k not in ('files','runtime')),
            'Model, patches, runtime links or upstream changed; use a separately reviewed upgrade.')
    require(new['runtime'] == {**old['runtime'], 'python': str(target / 'hermes/.venv/bin/python')},
            'The update needs a different runtime.')
    files = new['files']
    require(isinstance(files, dict) and len(files) <= MAX_FILES and
            all(safe_name(k) and HEX.fullmatch(v) for k,v in files.items()), 'Invalid file manifest.')
    for name in files.keys() ^ old['files'].keys():
        require(application_file(name) and name not in PLUGIN_MANIFESTS,
                'An added or removed file requires a separately reviewed upgrade.')
    old_skills = {k for k in old['files'] if k.startswith('extension/skills/')}
    new_skills = {k for k in files if k.startswith('extension/skills/')}
    require(new_skills == old_skills, 'A change to the installed protected skill roster requires a separate review.')


def checked_difference(name, new, old, target, previous):
    if name in PLUGIN_MANIFESTS:
        require(max(new.stat().st_size, old.stat().st_size) <= 64*1024, 'The dashboard manifest is too large.')
        proposed, installed = [json.loads(p.read_bytes()) for p in (new,old)]
        require(isinstance(proposed,dict) and isinstance(installed,dict) and
                all(proposed.get(k) == installed.get(k) for k in ('name','api')),
                'Dashboard identity or API binding changed; use a separately reviewed upgrade.')
        return
    if application_file(name):
        return
    if name == 'workspace-worker.pyz':
        with zipfile.ZipFile(new) as a, zipfile.ZipFile(old) as b:
            def worker_members(archive):
                members = archive.infolist()
                roster = {}
                require(len(members) < 2048, 'Worker ZIP exceeds its bounded roster.')
                for member in members:
                    key = safe_name(member.filename.rstrip('/'))
                    require(key not in roster and member.file_size <= 16*1024*1024, 'Invalid worker member.')
                    roster[key] = member
                require(sum(m.file_size for m in members) <= 64*1024*1024, 'Worker ZIP exceeds its size limit.')
                return roster
            offered, installed = worker_members(a), worker_members(b)
            require(offered.keys() == installed.keys() and
                    all(a.read(offered[key]) == b.read(installed[key]) for key in offered), 'Worker contents changed.')
        return
    if name.startswith(VENV) and (name.endswith('.dist-info/RECORD') or name.endswith('.dist-info/uv_cache.json')):
        # PEP 376 inventories and uv build cache timestamps are package metadata.
        # The manifest independently checks each executable file, .pth, and loader.
        return
    if name == 'hermes/install-stamp.json':
        left, right = [json.loads(p.read_bytes()) for p in (new, old)]
        require(left.keys() == right.keys() and all(left[k] == right[k] for k in right if k != 'builtAt'),
                'The native external-steward identity changed.')
        return
    if name.startswith(VENV) and (name.startswith(VENV+'bin/') or name.endswith(('pyvenv.cfg',
            '_finder.py', '.dist-info/direct_url.json', '.pth'))):
        require(new.stat().st_size <= 2*1024*1024 and old.stat().st_size <= 2*1024*1024 and
                new.read_bytes() == old.read_bytes().replace(os.fsencode(previous), os.fsencode(target)),
                'A generated runtime entry changed beyond its release path.')
        return
    raise ValueError('This change affects protected code or data and requires a separately reviewed upgrade: '+name)


def check_tar_headers(archive):
    # tarfile processes extended headers before returning a TarInfo. Check their
    # raw lengths and permitted keys first, including before parsing candidate.json.
    with archive.open('rb') as src:
        size = archive.stat().st_size
        count = 0
        while src.tell() < size:
            header = src.read(512)
            require(len(header) == 512, 'Truncated archive header.')
            if not any(header):
                require(not any(src.read(512)) and src.tell() <= size, 'Corrupt archive ending.')
                while tail := src.read(1024*1024):
                    require(not any(tail), 'Unexpected data after archive.')
                return
            count += 1
            require(count <= 2*MAX_FILES+2, 'Too many archive members.')
            entry = tarfile.TarInfo.frombuf(header, encoding='utf-8', errors='strict')
            require(entry.type in (tarfile.REGTYPE, tarfile.AREGTYPE, tarfile.XHDTYPE) and
                    0 <= entry.size <= MAX_MEMBER, 'Only bounded regular entries are supported.')
            end = src.tell() + (entry.size + 511)//512*512
            require(end <= size, 'Truncated archive member.')
            if entry.type == tarfile.XHDTYPE:
                require(entry.size <= 8192, 'Extended header is too large.')
                data = BytesIO(src.read(entry.size))
                for line in data:
                    length, _, content = line.partition(b' ')
                    require(length.isdigit() and int(length) == len(line) and
                            content.split(b'=',1)[0] in (b'path',b'mtime',b'atime',b'ctime'),
                            'Unsupported extended archive metadata.')
            src.seek(end)
    raise ValueError('Missing archive ending.')


def materialize(archive, temporary, review, previous, target):
    """Read only bounded regular members; create reviewed symlinks last from the trusted predecessor."""
    manifest_path = previous / 'candidate.json'
    require(file_hash(manifest_path) == review['previous'], 'The active predecessor changed.')
    old = json.loads(manifest_path.read_bytes())
    require(0 < archive.stat().st_size <= MAX_ARCHIVE and file_hash(archive) == review['archive'],
            'The update archive changed.')
    check_tar_headers(archive)
    with tarfile.open(archive, mode='r:') as tar:
        first = tar.next()
        require(first is not None and first.name == 'candidate.json' and first.isreg()
                and 0 < first.size <= MAX_MANIFEST, 'Archive must start with its bounded candidate manifest.')
        raw = tar.extractfile(first).read()
        require(digest(raw) == review['candidate'], 'The candidate manifest changed.')
        new = json.loads(raw)
        require(previous == selector(), 'The active predecessor changed.')
        checked_manifest(new, old, target)
        (temporary / 'candidate.json').write_bytes(raw)
        names = set()
        total = first.size
        while (member := tar.next()) is not None:
            name = safe_name(member.name)
            require(member.isreg() and not member.sparse and not member.mode & 0o7000 and
                    0 <= member.size <= MAX_MEMBER and name in new['files'] and name not in names
                    and name != 'candidate.json' and name not in new['symlinks'],
                    'Unexpected, duplicate or special archive member.')
            total += member.size
            require(total <= MAX_ARCHIVE, 'Archive exceeds the reviewed appliance size.')
            names.add(name)
            dest = temporary / name
            dest.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
            with tar.extractfile(member) as src, dest.open('xb') as output:
                shutil.copyfileobj(src, output, length=1024*1024)
            require(file_hash(dest) == new['files'][name], 'A candidate member differs from its manifest.')
            prior = previous / name
            if name in old['files']:
                # The candidate manifest does not record modes. Preserve executable
                # status from the protected predecessor, including unchanged files.
                mode = 0o555 if prior.stat().st_mode & 0o111 else 0o444
            else:
                mode = 0o444
            dest.chmod(mode)
            if name in old['files'] and old['files'][name] != new['files'][name]:
                checked_difference(name, dest, prior, target, previous)
        require(names == set(new['files']), 'Release archive is incomplete.')
    for name, destination in old['symlinks'].items():
        (temporary / name).symlink_to(destination)
    for directory, _, _ in os.walk(temporary):
        os.chmod(directory, 0o755)
    (temporary / 'candidate.json').chmod(0o444)


def record(operation, data):
    temporary = RECEIPTS / (operation + '.new')
    atomic = RECEIPTS / (operation + '.json')
    with temporary.open('w') as out:
        json.dump(data, out, sort_keys=True)
        out.flush()
        os.fsync(out.fileno())
    os.replace(temporary, atomic)
    sync_directory(RECEIPTS)


def load_record(operation):
    path = RECEIPTS / (operation + '.json')
    return json.loads(path.read_bytes()) if path.exists() else None


def run_systemctl(*args):
    return subprocess.check_output((BINARY, *args), text=True, timeout=120,
                                   env={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin'}).strip()


def restart_and_check():
    run_systemctl('restart', *UNITS)
    check_gateway()


def check_gateway():
    class LocalOnly(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            return None
    client = urllib.request.build_opener(urllib.request.ProxyHandler({}), LocalOnly())
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        try:
            with client.open(GATE + '/login', timeout=3) as response:
                require(response.status == 200, 'The owner login failed its health check.')
            try:
                response = client.open(GATE + '/api/config', timeout=3)
            except urllib.error.HTTPError as error:
                if error.code == 401 and all(run_systemctl('is-active', u) == 'active' for u in UNITS):
                    return
                raise ValueError('The owner API failed its protected readiness check.') from None
            else:
                response.close()
                raise ValueError('The owner API unexpectedly accepted an anonymous request.')
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            time.sleep(.5)
    raise ValueError('The native owner path did not become ready.')


def read_authorization(method, operation, proposal, review):
    # This command runs as UID/GID 1000 in an isolated system Python. SQLite,
    # including WAL access, runs with the same account as the live operation DB.
    require(os.geteuid() == 1000 and os.getegid() == 1000, 'Invalid authorization reader.')
    config = json.loads(CONTROLLER.read_bytes())
    owner = json.loads(Path(config['owner_binding']).read_bytes())
    import urllib.parse
    uri = 'file:' + urllib.parse.quote(config['operations'], safe='/') + '?mode=ro'
    with sqlite3.connect(uri, uri=True, timeout=3) as db:
        db.execute('PRAGMA trusted_schema=OFF')
        db.execute('PRAGMA query_only=ON')
        db.row_factory = sqlite3.Row
        row = db.execute('SELECT o.*, c.operation AS claim FROM operations o LEFT JOIN claims c ON '
                         'c.spark=? AND c.operation=o.id WHERE o.id=?', ('spark1',operation)).fetchone()
    expected = {'action':'update_application', 'spark':'spark1','proposal':proposal,'review':public_review(review)}
    require(row is not None and json.loads(row['intent']) == expected and digest(row['intent'].encode()) == row['digest']
            and row['generation'] == owner['generation'] and row['approved_channel'] in ('web','telegram')
            and row['approved_at'] is not None and row['approved_at'] <= row['expires'],
            'The original owner approval or binding is no longer valid.')
    if method == 'begin':
        require(time.time() < row['expires'], 'The approval expired before dispatch.')
    allowed = row['state'] in ('dispatching','uncertain') and row['claim'] == operation
    if method == 'rollback':
        allowed = allowed or row['state'] in ('succeeded','failed')
    if method == 'accept':
        allowed = allowed or row['state'] == 'succeeded'
    require(allowed and (method == 'rollback' or not row['cancel_requested']), 'Approval, claim or cancellation changed.')


def authorize(method, operation, proposal, review):
    # The caller-supplied arguments are operation IDs and bounded public review text.
    # Neither the DB path nor the owner enrollment can be chosen through the socket.
    result = subprocess.run(('/usr/bin/python3','-I','-B',str(Path(__file__).resolve()),'check-approval'),
                            user=1000,group=1000,extra_groups=[],cwd='/',capture_output=True,timeout=8,
                            input=json.dumps([method,operation,proposal,public_review(review)],ensure_ascii=False).encode(),
                            env={'PATH':'/usr/bin:/bin'})
    require(result.returncode == 0, 'The durable operation or current owner no longer authorizes this update.')


def state_result(data, *, locked=True):
    result = {'ok':True, 'state':data['state'], 'message':data['message'],
              'accept_available':False, 'rollback_available':False}
    if not locked or not data.get('switch_started') or data['state'] not in (
            'awaiting_owner_check','succeeded','unknown','running'):
        return result
    try:
        current = selector()
        candidate = RELEASES/data['release']
        previous = RELEASES/data['previous_name']
        candidate_active = current == candidate and file_hash(current/'candidate.json') == data['candidate']
        result['accept_available'] = candidate_active and data['state'] == 'awaiting_owner_check'
        if candidate_active or (current == previous and data['state'] in ('unknown','running')):
            result['rollback_available'] = (previous.resolve(strict=True) == previous and
                file_hash(previous/'candidate.json') == data['previous'] and candidate.resolve(strict=True) == candidate and
                file_hash(candidate/'candidate.json') == data['candidate'])
    except (OSError, ValueError, RuntimeError):
        pass
    return result


def transition(operation, data, state, message):
    data.update(state=state, message=message)
    record(operation, data)


def refresh_guidance(before, after):
    # Hermes SSH deliberately skips symlinked skill trees. Keep the original
    # regular files and install only the bootstrap's exact protected roster.
    setup = json.loads(GUIDANCE.read_bytes())
    home = Path(setup['home'])
    top = home.lstat()
    require(stat.S_ISDIR(top.st_mode) and top.st_uid == 0 and top.st_gid == 1000
            and stat.S_IMODE(top.st_mode) == 0o1770, 'The protected native home changed.')
    for name in setup['files']:
        safe_name(name)
        require(name == 'SOUL.md' or name.startswith('skills/'), 'Invalid bootstrap guidance path.')
        path = home/name
        for parent in path.parents:
            if parent == home:
                break
            info = parent.lstat()
            perms = stat.S_IMODE(info.st_mode)
            require(stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and info.st_gid == 1000 and
                    (perms == 0o1770 if parent == home/'skills' else not perms & 0o022),
                    'A protected skill directory changed.')
        live = path.lstat()
        require(stat.S_ISREG(live.st_mode) and live.st_uid == 0 and live.st_gid == 1000 and
                stat.S_IMODE(live.st_mode) == 0o640, 'A protected guidance file changed.')
        old, new = [(root/'extension'/name).read_bytes() for root in (before, after)]
        actual = path.read_bytes()
        require(actual in (old,new), 'Protected native guidance drifted; preserve it for review.')
        if new == actual:
            continue
        with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as tmp:
            try:
                tmp.write(new)
                tmp.flush()
                os.fchown(tmp.fileno(),0,1000)
                os.fchmod(tmp.fileno(),0o640)
                os.fsync(tmp.fileno())
                os.replace(tmp.name,path)
                sync_directory(path.parent)
            finally:
                Path(tmp.name).unlink(missing_ok=True)


def restore(operation, data):
    prior, target = [RELEASES / data[k] for k in ('previous_name','release')]
    active = selector()
    require(active in (prior,target) and file_hash(prior/'candidate.json') == data['previous']
            and (active != target or file_hash(target/'candidate.json') == data['candidate']),
            'The observed release changed. Reconcile before rollback.')
    transition(operation, data, 'running', 'Restoring the recorded predecessor.')
    run_systemctl('stop', 'hermes-gateway.service')
    refresh_guidance(target, prior)
    replace_selector(prior)
    restart_and_check()
    transition(operation, data, 'rolled_back', 'Previous release restored and its private owner gate verified. Check the owner path.')


def action(method, operation, proposal, notify):
    require(isinstance(operation,str) and OP.fullmatch(operation) and HEX.fullmatch(proposal), 'Invalid update identity.')
    data = load_record(operation)
    if data:
        require(data['proposal'] == proposal, 'This operation belongs to another proposal.')
    # One host-wide lock remains held across gateway/controller restart.
    with (RECEIPTS/'transaction.lock').open('a+') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            notify(state_result(data if data and method == 'observe' else {'state':'unknown','message':
                'An update is in progress. Check its existing journal.'}, locked=False))
            return
        data = load_record(operation)
        if data:
            require(data['proposal'] == proposal, 'This operation belongs to another proposal.')
        if method == 'observe':
            if data and data['state'] == 'running':
                # We obtained the single lock, so the prior worker has exited.
                # A pre-switch crash cannot have changed the selector. Never
                # retry a partially dispatched handover from an observation.
                if not data['switch_started'] and selector().name == data['previous_name']:
                    transition(operation,data,'failed','Preparation was interrupted before switching. Previous release is active.')
                else:
                    transition(operation,data,'unknown','The previous handover was interrupted. Check or restore this recorded release.')
            notify(state_result(data or {'state':'unknown','message':'No steward journal for this request.'}))
            return
        if method in ('accept', 'rollback'):
            require(data, 'Unknown application update.')
            authorize(method, operation, proposal, data['review'])
            if method == 'accept':
                require(data['state'] in ('awaiting_owner_check', 'succeeded') and selector().name == data['release']
                        and file_hash(selector()/'candidate.json') == data['candidate'],
                        'The approved candidate is not awaiting owner verification.')
                check_gateway()
                transition(operation, data,'succeeded','The owner verified the installed release and the private access gate is healthy.')
                notify(state_result(data))
                return
            if data['state'] == 'rolled_back':
                notify(state_result(data))
                return
            require(data['state'] in ('awaiting_owner_check','succeeded','unknown','running') and data.get('switch_started'),
                    'The journal has no eligible handover to restore.')
            current = selector().name
            require(current == data['release'] or (data['state'] in ('unknown','running') and current == data['previous_name']),
                    'A different release is active.')
            notify({'ok':True,'state':'running','message':'Checking the original update for rollback.'})
            try:
                restore(operation, data)
            except (OSError, ValueError, subprocess.SubprocessError):
                transition(operation, data, 'unknown', 'Rollback could not be verified. Reconcile this journal.')
            return
        require(method == 'apply', 'Unsupported update method.')
        if data:
            notify(state_result(data))
            return
        review = review_for(proposal)
        authorize('begin', operation, proposal, review)
        previous = selector()
        target = RELEASES / review['release']
        require(file_hash(previous/'candidate.json') == review['previous'], 'The approved predecessor changed.')
        require(not target.exists() and not target.is_symlink(), 'Release name is already occupied.')
        # No later proposal may overtake a process interrupted during handover.
        for receipt in RECEIPTS.glob('*.json'):
            prior = json.loads(receipt.read_bytes())
            require(prior['state'] not in ('running','unknown','awaiting_owner_check'), 'Reconcile the previous update first.')
        data = {'proposal':proposal, 'review': public_review(review), 'previous':review['previous'], 'candidate':review['candidate'],
                'release':target.name,'previous_name':previous.name,'switch_started':False}
        transition(operation, data,'running','Preparing the approved release.')
        try:
            notify(state_result(data))
            with tempfile.TemporaryDirectory(dir=RELEASES, prefix='.stage-') as scratch:
                stage = Path(scratch)
                archive = stage/'release.tar'
                with input_file(proposal,'release.tar') as source, archive.open('xb') as out:
                    remaining = MAX_ARCHIVE
                    while chunk := source.read(min(remaining+1, 1024*1024)):
                        remaining -= len(chunk)
                        require(remaining >= 0, 'Archive exceeds limit.')
                        out.write(chunk)
                package = stage/'candidate'
                package.mkdir()
                materialize(archive, package, review, previous, target)
                require(previous == selector(), 'The active release changed before dispatch.')
                authorize('apply', operation, proposal, review)
                os.rename(package, target)
                sync_directory(RELEASES)
            data['switch_started'] = True
            transition(operation, data,'running','Switching the approved release.')
            run_systemctl('stop', 'hermes-gateway.service')
            refresh_guidance(previous, target)
            replace_selector(target)
            restart_and_check()
            transition(operation, data,'awaiting_owner_check','Installed. Login, anonymous API denial and service health were verified. Check the changed behavior, then accept or restore the previous release.')
        except (OSError, ValueError, TypeError, KeyError, RuntimeError, tarfile.TarError,
                zipfile.BadZipFile, subprocess.SubprocessError):
            if data['switch_started']:
                try:
                    restore(operation, data)
                except (OSError, ValueError, subprocess.SubprocessError):
                    transition(operation, data,'unknown','Could not verify rollback. Reconcile this journal.')
            else:
                transition(operation, data,'failed','The candidate failed admission before switching; previous release is active.')


def serve(connection):
    pid, uid, _ = struct.unpack('3i', connection.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
    require(uid == 1000 and pid > 1 and run_systemctl('show','-p','MainPID','--value','sparkie-fleet.service') == str(pid),
            'Only the active fleet controller may contact the application steward.')
    connection.settimeout(8)
    with connection.makefile('rb') as stream:
        raw = stream.readline(16*1024)
    require(raw.endswith(b'\n'), 'Invalid steward request.')
    request = json.loads(raw)
    notified = False
    def notify(value):
        nonlocal notified
        notified = True
        connection.sendall(json.dumps(value, ensure_ascii=False).encode()+b'\n')
    try:
        method, proposal = request['method'], request['proposal']
        require(isinstance(proposal,str) and HEX.fullmatch(proposal), 'Invalid proposal identity.')
        if method == 'inspect':
            require(set(request) == {'method','proposal'}, 'Invalid inspection.')
            review = review_for(proposal)
            require(file_hash(selector()/'candidate.json') == review['previous'], 'This proposal targets another predecessor.')
            notify({'ok':True,'review':public_review(review)})
        else:
            require(set(request) == {'method','operation','proposal'}, 'Invalid update action.')
            action(method, request['operation'], proposal, notify)
    except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError) as exc:
        if not notified:
            message = str(exc) if isinstance(exc, ValueError) and not isinstance(exc,json.JSONDecodeError) else 'Update unavailable; check the reviewed proposal and recorded state.'
            notify({'ok':False,'message':message[:300]})


def prepare(candidate, baseline, details, destination):
    """Build an ordinary incoming offer on compute. All tests and diffs come from the caller."""
    candidate, baseline = Path(candidate), Path(baseline)
    info = json.loads(Path(details).read_bytes())
    require(set(info) == {'diff','checks','interruption','rollback'}, 'Provide exact review details.')
    manifest = json.loads((candidate/'candidate.json').read_bytes())
    old = json.loads((baseline/'candidate.json').read_bytes())
    target = baseline.parent/candidate.name
    checked_manifest(manifest, old, target)
    destination = Path(destination)
    with tempfile.TemporaryDirectory(dir=destination, prefix='.prepare-') as work:
        out = Path(work)
        archive = out/'release.tar'
        with tarfile.open(archive,'w',dereference=True) as tar:
            for name in ('candidate.json', *sorted(manifest['files'])):
                safe_name(name)
                source = candidate / name
                require(source.is_file() and not source.is_symlink(), 'A sealed regular file is missing.')
                if name != 'candidate.json':
                    require(file_hash(source) == manifest['files'][name], 'A candidate member differs from its manifest.')
                    if name in old['files'] and old['files'][name] != manifest['files'][name]:
                        checked_difference(name, source, baseline/name, target, baseline)
                tar.add(source, arcname=name, recursive=False)
        review = {**info, 'release':candidate.name, 'previous':file_hash(baseline/'candidate.json'),
                  'candidate':file_hash(candidate/'candidate.json'), 'archive':file_hash(archive)}
        raw = (json.dumps(review,sort_keys=True,ensure_ascii=False)+'\n').encode()
        proposed = digest(raw)
        review_bytes(raw, proposed)
        (out/'review.json').write_bytes(raw)
        require(not (destination/proposed).exists(), 'This update offer already exists.')
        os.rename(out, destination/proposed)
    return proposed


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    commands.add_parser('serve')
    commands.add_parser('check-approval')
    prep = commands.add_parser('prepare')
    for name in ('candidate','baseline','details','destination'):
        prep.add_argument('--'+name, required=True, type=Path)
    args = parser.parse_args()
    if args.command == 'serve':
        require(os.geteuid() == 0, 'Use the installed systemd socket activation.')
        os.umask(0o077)
        with socket.socket(fileno=0) as channel:
            serve(channel)
    elif args.command == 'check-approval':
        read_authorization(*json.loads(sys.stdin.buffer.read(MAX_REVIEW+4096)))
    else:
        print(prepare(args.candidate, args.baseline, args.details, args.destination))

"""First-install integration for the stable, socket-activated app steward."""
from contextlib import contextmanager
import fcntl
import json
import os
from pathlib import Path
import shutil
import stat

import upgrade

SOCKET = 'sparkie-update.socket'
SERVICE = 'sparkie-update@.service'
STEWARD = upgrade.APP / 'steward'
HOST_SOCKET = Path('/run/sparkie-update.sock')


def validate(settings, controller):
    enabled = settings.get('application_updates', False)
    if type(enabled) is not bool or controller.get('application_updates', False) is not enabled:
        raise ValueError('The protected controller and installation must agree on application updates.')
    if enabled and (Path(settings['controller_config']) != upgrade.CONTROLLER
                    or Path(settings['candidate']).parent != upgrade.RELEASES or settings['gateway_port'] != 32131):
        raise ValueError('The application steward requires its reviewed hub, port and controller path.')
    return enabled


def units(group, home):
    from service_unit import _literal
    home_access = _literal(home)
    if group != 1000:
        raise ValueError('Use the installed runtime group for the protected steward socket.')
    return {
        SOCKET: '[Unit]\nDescription=Sparkie approved application update requests\n'
                '[Socket]\nListenStream=/run/sparkie-update.sock\nSocketMode=0660\nSocketUser=root\n'
                'SocketGroup=1000\nAccept=yes\nRemoveOnStop=yes\nMaxConnections=8\n'
                '[Install]\nWantedBy=sockets.target\n',
        SERVICE: '[Unit]\nDescription=One checked Sparkie application update request\n'
                 '[Service]\nType=exec\nUser=root\nGroup=root\n'
                 'ExecStart=/usr/bin/python3 -I -B /opt/sparkie/steward/upgrade.py serve\n'
                 'StandardInput=socket\nStandardOutput=journal\nStandardError=journal\n'
                 'UMask=0077\nNoNewPrivileges=yes\nPrivateTmp=yes\nProtectHome=yes\n'
                 f'ProtectSystem=strict\nReadWritePaths=/opt/sparkie /var/lib/sparkie-updates {home_access}\n'
                 'RestrictAddressFamilies=AF_UNIX AF_INET\nMemoryMax=768M\nTasksMax=24\n'
                 'TimeoutStartSec=300\nRuntimeMaxSec=600\n',
    }


def stage(candidate, uid, gid, home):
    if (uid,gid) != (1000,1000):
        raise ValueError('Use the reviewed non-root controller and runtime account.')
    paths = (upgrade.CURRENT, STEWARD, upgrade.RECEIPTS, upgrade.INBOX, HOST_SOCKET)
    for path in paths:
        if path.exists() or path.is_symlink():
            raise FileExistsError('Preserve the existing update destination: '+str(path))
        for parent in path.parents:
            info = parent.lstat()
            if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
                raise ValueError('Update artifacts require protected administrator-owned ancestors.')
    upgrade.CURRENT.symlink_to(candidate)
    STEWARD.mkdir(mode=0o755)
    STEWARD.chmod(0o755)
    helper = STEWARD/'upgrade.py'
    shutil.copyfile(candidate/'extension/deploy/upgrade.py', helper)
    helper.chmod(0o644)
    reference = STEWARD/'guidance.json'
    skills = candidate/'extension/skills'
    files = ['SOUL.md', *sorted(str(p.relative_to(candidate/'extension'))
                               for p in skills.rglob('*') if p.is_file() and not p.is_symlink())]
    reference.write_text(json.dumps({'home':str(home),'files':files}))
    reference.chmod(0o600)
    upgrade.RECEIPTS.mkdir(mode=0o700)
    upgrade.INBOX.mkdir(mode=0o700)
    os.chown(upgrade.INBOX,uid,gid)


@contextmanager
def initial_handover(candidate):
    """Serialize the first-install handover/undo with future approved app updates."""
    if upgrade.selector() != candidate or upgrade.file_hash(STEWARD/'upgrade.py') != upgrade.file_hash(candidate/'extension/deploy/upgrade.py'):
        raise ValueError('The active release or installed steward changed. Reconcile before first-cutover recovery.')
    with (upgrade.RECEIPTS/'transaction.lock').open('a+') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if upgrade.selector() != candidate:
            raise ValueError('Restore the recorded initial release before a legacy rollback.')
        yield

"""Native Hermes SSH tools with an explicitly enrolled sandbox endpoint.

This login key opens only a dedicated compute container, never the Spark owner's
host shell. Allocation, container limits and idle policy belong to the private
fleet boundary. No server, key, user or container is created by this module.

Hermes v0.23.2 exposes no SSH-options config. This small subclass strengthens
identity options; execution, sync, file tools, Python kernels and streams remain
the native SSHEnvironment implementation. Cleanup retains its native semantics:
closing an SSH client does not prove a remote background job stopped.
"""
import hashlib
import os
from pathlib import Path
import re
import stat

from tools.environments.ssh import SSHEnvironment


def _protected_file(path, *, read=False):
    path = Path(path)
    if not path.is_absolute():
        raise ValueError('Sandbox identity files need an absolute path.')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, 'rb') as handle:
        info = os.fstat(handle.fileno())
        if (not stat.S_ISREG(info.st_mode) or info.st_uid not in (0, os.geteuid())
                or info.st_mode & 0o077 or info.st_size > 16384):
            raise ValueError('Sandbox identity files must be small, owner-only regular files.')
        return handle.read(16385).decode('ascii') if read else str(path)


class PinnedSandboxSSH(SSHEnvironment):
    """Use a dedicated key and exact enrolled host key; fail closed on changes."""

    def __init__(self, *, host, user, port, key_path, known_hosts, host_key_alias,
                 expected_host_key, cwd='/workspace', timeout=60, **kwargs):
        if (not isinstance(host, str) or not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9.:-]{0,252}', host)
                or not isinstance(user, str) or not re.fullmatch(r'[a-z_][a-z0-9_-]{0,31}', user)
                or user == 'root' or type(port) is not int or not 1024 <= port <= 65535):
            raise ValueError('Use a non-root sandbox login at a verified address and high port.')
        if not isinstance(host_key_alias, str) or not re.fullmatch(r'sparkie-workspace-[a-f0-9]{32}', host_key_alias):
            raise ValueError('Use the exact workspace host-key identity.')
        if (not isinstance(expected_host_key, str)
                or not re.fullmatch(r'ssh-ed25519 [A-Za-z0-9+/]+={0,2}', expected_host_key)):
            raise ValueError('Enroll the sandbox Ed25519 host key before connecting.')
        pinned = _protected_file(known_hosts, read=True).strip()
        if pinned != host_key_alias + ' ' + expected_host_key:
            raise ValueError('The saved sandbox host key does not match its enrollment.')
        self._known_hosts, self._host_key_alias = str(known_hosts), host_key_alias
        key_path = _protected_file(key_path)
        self._enrollment_digest = hashlib.sha256((host_key_alias + '\n' + expected_host_key + '\n'
            + _protected_file(key_path, read=True)).encode()).hexdigest()
        super().__init__(host=host, user=user, port=port, key_path=key_path,
                         cwd=cwd, timeout=timeout, **kwargs)

    def _establish_connection(self):
        # Native ControlMaster keys only user/host/port. Never reuse an older
        # workspace's authenticated connection after a port or key is recycled.
        digest = hashlib.sha256((str(self.control_socket) + self._enrollment_digest).encode()).hexdigest()[:16]
        self.control_socket = self.control_socket.with_name(digest + '.sock')
        return super()._establish_connection()

    def _target_flags(self, port_flag):
        # Used by native ssh AND scp. Ignore ambient owner SSH config/agent keys.
        return super()._target_flags(port_flag) + [
            '-F', '/dev/null',
            '-o', 'StrictHostKeyChecking=yes', '-o', 'BatchMode=yes',
            '-o', 'IdentitiesOnly=yes', '-o', 'IdentityAgent=none',
            '-o', 'ForwardAgent=no', '-o', 'ClearAllForwardings=yes',
            '-o', 'GlobalKnownHostsFile=/dev/null',
            '-o', 'UserKnownHostsFile=' + self._known_hosts,
            '-o', 'HostKeyAlias=' + self._host_key_alias,
        ]

    def _build_ssh_command(self, extra_args=None, send_env=()):
        args = super()._build_ssh_command(extra_args=extra_args, send_env=send_env)
        # OpenSSH uses the first value. Strengthen upstream's earlier argument
        # as well as the common ssh/scp target flags above.
        return ['StrictHostKeyChecking=yes' if value == 'StrictHostKeyChecking=accept-new' else value
                for value in args]

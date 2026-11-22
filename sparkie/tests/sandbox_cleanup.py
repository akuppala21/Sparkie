"""Teardown evidence for isolated, single-process native Docker test runners."""

import json
from pathlib import Path
import re
import subprocess


def docker(*args):
    return subprocess.run(['docker', *args], check=True, capture_output=True,
                          text=True, timeout=15).stdout.strip()


def container_mounts(container):
    if not isinstance(container, str) or not re.fullmatch('[0-9a-f]{12,64}', container):
        raise ValueError('Expected a native Docker container ID.')
    row = docker('container', 'inspect', '--format', '{{.Id}} {{json .Mounts}}', container)
    full_id, mounts = row.split(' ', 1)
    if not re.fullmatch('[0-9a-f]{64}', full_id) or not full_id.startswith(container):
        raise ValueError('Docker inspect returned a different container ID.')
    return full_id, json.loads(mounts)


class NativeSandboxCleanup:
    def __init__(self, home):
        self.home = Path(home).resolve()
        self.containers = {}

    def owns(self, mounts):
        return any(mount['Type'] == 'bind' and
                   Path(mount['Source']).is_relative_to(self.home / 'sandboxes' / 'docker')
                   for mount in mounts)

    def capture(self):
        """Record actual keys and IDs while native environment objects still exist."""
        from tools import terminal_tool
        from tools.environments.docker import DockerEnvironment

        with terminal_tool._env_lock:
            active = list(terminal_tool._active_environments.items())
        owned = {}
        for key, env in active:
            if not isinstance(env, DockerEnvironment):
                continue
            full_id, mounts = container_mounts(env._container_id)
            if not self.owns(mounts):
                raise RuntimeError(f'Container {full_id} lacks a private fixture sandbox mount.')
            self.containers[full_id] = key
            owned[key] = full_id
        return owned

    def finish(self, *, required=True):
        """Force native teardown while the registry is intact and verify exact absence."""
        from tools.environments.docker import DockerEnvironment
        from tools.terminal_tool_lifecycle import cleanup_vm

        errors = []
        evidence = {'teardowns_finished': False, 'remaining_ids': [], 'errors': errors}
        try:
            for key in self.capture():
                try:
                    cleanup_vm(key, force_remove=True)
                except Exception as exc:
                    errors.append(f'Native cleanup for {key}: {exc}')
            if required and not self.containers:
                errors.append('Expected a native fixture container but captured no ID.')
            evidence['teardowns_finished'] = DockerEnvironment.wait_for_all_teardowns(timeout=45)
            if not evidence['teardowns_finished']:
                errors.append('Native Docker teardown timed out.')
            for full_id in self.containers:
                if docker('container', 'ls', '--all', '--quiet', '--no-trunc', '--filter', 'id=' + full_id):
                    evidence['remaining_ids'].append(full_id)
            # Catch a native environment unregistered during the call, even when its
            # original ID never reached the runner. Inspect mounts only. Other
            # fixtures may use the same profile name and Docker daemon concurrently.
            native_ids = docker('container', 'ls', '--all', '--quiet', '--no-trunc',
                                '--filter', 'label=hermes-agent=1').splitlines()
            for candidate in native_ids:
                try:
                    full_id, mounts = container_mounts(candidate)
                except subprocess.CalledProcessError:
                    if docker('container', 'ls', '--all', '--quiet', '--no-trunc', '--filter', 'id=' + candidate):
                        raise
                    continue
                if self.owns(mounts) and full_id not in evidence['remaining_ids']:
                    evidence['remaining_ids'].append(full_id)
            if evidence['remaining_ids']:
                errors.append('Docker still lists a fixture container.')
        except Exception as exc:
            errors.append(f'{type(exc).__name__}: {exc}')
        evidence['containers'] = [{'id': cid, 'native_key': key} for cid, key in self.containers.items()]
        evidence['verified'] = not errors
        return evidence

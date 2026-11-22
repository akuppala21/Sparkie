"""Render reviewed Git-index sources for one privately enrolled four-Spark site.

This offline tool only creates a private source directory. The normal package,
owner enrollment, qualification and exact installation approval still apply.
"""
import argparse
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
EXAMPLE = 'config/site.example.json'
DNS_LABEL = re.compile(r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?')
FIELDS = ('spark1', 'spark2', 'spark3', 'spark4')


def host(value):
    return (isinstance(value, str) and 0 < len(value) <= 253 and value != 'localhost'
            and not value.endswith(('.invalid', '.localhost'))
            and all(DNS_LABEL.fullmatch(part) for part in value.split('.')))


def substitutions(example, site):
    if not isinstance(site, dict) or set(site) != {'account', 'dashboard_host', 'nodes'}:
        raise ValueError('Use the public site example schema; keep credentials outside this file.')
    account, origin, nodes = site['account'], site['dashboard_host'], site['nodes']
    if (not isinstance(account, str) or not re.fullmatch(r'[a-z_][a-z0-9_-]{0,31}', account)
            or account in ('root', example['account']) or not host(origin) or '.' not in origin):
        raise ValueError('Provide the verified non-root account and HTTPS dashboard hostname.')
    if not isinstance(nodes, dict) or set(nodes) != set(FIELDS):
        raise ValueError('Explicitly enroll the permanent hub and three compute nodes.')
    mapping = {example['account']: account, example['dashboard_host']: origin}
    seen_ids, seen_hosts, seen_addresses = set(), set(), set()
    for name in FIELDS:
        template, node = example['nodes'][name], nodes[name]
        if not isinstance(node, dict) or set(node) != set(template):
            raise ValueError(f'Use the exact example schema for {name}.')
        identity, hostname = node['machine_id'], node['hostname']
        if (not isinstance(identity, str) or not re.fullmatch('[a-f0-9]{32}', identity)
                or identity == '0' * 32 or identity in seen_ids or not host(hostname) or hostname in seen_hosts
                or (name != 'spark1' and hostname.split('.')[0] == 'spark1')):
            raise ValueError('Supply a distinct, verified machine identity and hostname for every node.')
        seen_ids.add(identity)
        seen_hosts.add(hostname)
        if name != 'spark1':
            address = ipaddress.IPv4Address(node['address'])
            if address not in ipaddress.IPv4Network('100.64.0.0/10') or address in seen_addresses:
                raise ValueError('Supply distinct, verified compute Tailscale IPv4 addresses.')
            seen_addresses.add(address)
        mapping.update({marker: node[key] for key, marker in template.items()})
    return mapping


def tracked_sources():
    """Read only regular, tracked Git index blobs, including their recorded modes."""
    repo = ROOT.parent
    records = subprocess.check_output(['git', '-C', str(repo), 'ls-files', '--stage', '-z', '--', 'sparkie/'])
    for row in records.split(b'\0'):
        if not row:
            continue
        meta, name = row.split(b'\t', 1)
        mode, digest, stage = meta.decode().split()
        if mode not in ('100644', '100755') or stage != '0':
            raise ValueError('Use a cleanly resolved source index with regular application files.')
        path = Path(os.fsdecode(name)).relative_to('sparkie')
        data = subprocess.check_output(['git', '-C', str(repo), 'cat-file', 'blob', digest])
        yield path, data, int(mode, 8) & 0o777


def prepare(site_file, destination):
    destination = destination.resolve()
    if destination.is_relative_to(ROOT.parent):
        raise ValueError('Keep the private output outside the public checkout.')
    sources = list(tracked_sources())
    files = {str(p): data for p, data, _ in sources}
    mapping = substitutions(json.loads(files[EXAMPLE]), json.loads(site_file.read_bytes()))
    markers = re.compile('|'.join(re.escape(k) for k in sorted(mapping, key=len, reverse=True)))
    public_comparison = files['tests/behavior/comparison.py']
    private_comparison = markers.sub(lambda m: mapping[m[0]], public_comparison.decode()).encode()
    destination.mkdir(mode=0o700, exist_ok=False)
    for path, data, mode in sources:
        if str(path) != EXAMPLE:
            try:
                source = data.decode()
            except UnicodeDecodeError:
                pass
            else:
                source = markers.sub(lambda m: mapping[m[0]], source)
                if str(path) == 'tests/behavior/finalist.py':
                    old_pin = hashlib.sha256(public_comparison).hexdigest()
                    if source.count(old_pin) != 1:
                        raise ValueError('The pinned companion comparison fixture has changed.')
                    source = source.replace(old_pin, hashlib.sha256(private_comparison).hexdigest())
                data = source.encode()
        target = destination / path
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open('xb') as stream:
            stream.write(data)
        target.chmod(mode)
    return len(sources)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--site', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    os.umask(0o077)
    print(f'Prepared {prepare(args.site, args.output)} private source files. Review the diff before building.')

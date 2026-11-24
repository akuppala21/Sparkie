"""Enrolled IPv4 host addresses for compute SSH and published sandbox ports."""
from ipaddress import IPv4Address, IPv4Network
import re


PRIVATE_NETWORKS = tuple(IPv4Network(cidr) for cidr in (
    '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '100.64.0.0/10',
))


def private_address(value):
    if not isinstance(value, str):
        return False
    try:
        address = IPv4Address(value)
    except ValueError:
        return False
    return any(address in network for network in PRIVATE_NETWORKS)


def worker_interface(address, interface):
    if address == '127.0.0.1' and interface is None:
        return None
    if not private_address(address):
        raise ValueError('Use the verified private IPv4 address of the compute Spark.')
    if (not isinstance(interface, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,14}', interface)
            or interface == 'lo'):
        raise ValueError('Set interface in the protected worker configuration to the verified LAN interface that owns its address.')
    return interface


def physical_ssh_options(address, *, relay=False):
    """Bind an enrolled host's SSH verification to the same address used for the connection."""
    options = [
        '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
        '-o', 'HostName=' + address, '-o', 'HostKeyAlias=' + address,
        '-o', 'Port=22', '-o', 'ProxyCommand=none', '-o', 'CanonicalizeHostname=no',
        '-o', 'UserKnownHostsFile=~/.ssh/known_hosts', '-o', 'GlobalKnownHostsFile=/dev/null',
        '-o', 'KnownHostsCommand=none', '-o', 'HostKeyAlgorithms=-*-cert-v01@openssh.com',
        '-o', 'VerifyHostKeyDNS=no', '-o', 'UpdateHostKeys=no', '-o', 'ForwardAgent=no',
        '-o', 'ConnectTimeout=5', '-o', 'ConnectionAttempts=1',
    ]
    if relay:
        # The relay supplies its own per-instance control socket and loopback forward.
        return options + ['-o', 'ServerAliveInterval=10', '-o', 'ServerAliveCountMax=2']
    return options + [
        '-o', 'ServerAliveInterval=5', '-o', 'ServerAliveCountMax=1',
        '-o', 'ClearAllForwardings=yes', '-o', 'ControlPath=none',
    ]

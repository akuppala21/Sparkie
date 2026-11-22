"""Private terminal configuration for direct Docker qualification on a compute Spark."""

from pathlib import Path


def configure_compute_docker(home, source, *, network):
    """Run these direct native Docker fixtures only on an enrolled compute Spark."""
    from ruamel.yaml import YAML

    machine_id = Path('/etc/machine-id')
    if not machine_id.is_file() or machine_id.read_text().strip() not in {
        'UNENROLLED_COMPUTE2_MACHINE_ID', 'UNENROLLED_COMPUTE3_MACHINE_ID',
        'UNENROLLED_COMPUTE4_MACHINE_ID',
    }:
        raise RuntimeError('Run the native Docker fixture on an allocated compute Spark.')
    yaml = YAML()
    config = yaml.load(source)
    config['terminal'].update(backend='docker', cwd='/workspace', docker_network=network)
    with (home / 'config.yaml').open('x') as output:
        yaml.dump(config, output)

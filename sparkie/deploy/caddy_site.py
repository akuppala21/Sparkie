"""Print the initial public Caddy configuration for a dedicated Spark 1 site."""
import argparse
import json

from caddy_routes import site_origin, site_route


def render(origin):
    host = site_origin(origin)
    servers = {}
    for name, port in (('dashboard', 443), ('workloads', 10000)):
        servers[name] = {
            'listen': [f':{port}'],
            'automatic_https': {'disable_redirects': True},
            'tls_connection_policies': [{}],
            'routes': [
                site_route(host, 'sparkie-' + name, None),
                {'handle': [{'handler': 'static_response', 'status_code': 404}], 'terminal': True},
            ],
        }
    return {
        'admin': {'listen': 'unix//run/sparkie-caddy/admin.sock|0600'},
        'apps': {
            'http': {'servers': servers},
            'tls': {'automation': {'policies': [{
                'subjects': [host],
                'issuers': [{'module': 'acme', 'challenges': {'http': {'disabled': True}}}],
            }]}},
        },
    }


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('origin', help='Public dashboard origin, such as https://spark.example.com')
    print(json.dumps(render(parser.parse_args().origin), indent=2))

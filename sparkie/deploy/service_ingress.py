"""Render a pinned standard Caddy gateway; Hermes still owns authentication.

No generic URL proxy or public worker ports. This listener is hub-loopback only;
the reviewed release separately binds its public HTTPS route on port 10000.
"""
import re
from urllib.parse import urlsplit

IMAGE = 'caddy@sha256:003a97808e781aa9f7e75cc2f43d34d461099031faf5e20faefb9f61126836f0'
VERSION = '2.11.9'
UNIT = 'sparkie-service-ingress.service'
CONFIG = '/etc/sparkie/service-ingress.Caddyfile'


def render_unit(user, uid, gid):
    from service_unit import _literal
    if (not isinstance(user, str) or not re.fullmatch('[a-z_][a-z0-9_-]{0,31}', user)
            or any(type(value) is not int or value <= 0 for value in (uid, gid))):
        raise ValueError('Run the reviewed proxy as the non-root service user.')
    command = ['/usr/bin/env', '-i', 'PATH=/usr/bin:/bin', '/usr/bin/docker',
               '--config', '/run/sparkie-ingress/docker-config', '--host', 'unix:///var/run/docker.sock',
               'run', '--rm', '--pull', 'never', '--name', 'sparkie-service-ingress', '--network', 'host',
               '--read-only', '--user', f'{uid}:{gid}', '--cap-drop=ALL', '--security-opt', 'no-new-privileges',
               '--cpus', '1', '--memory', '256m', '--pids-limit', '128',
               '--tmpfs', f'/config:uid={uid},gid={gid}', '--tmpfs', f'/data:uid={uid},gid={gid}',
               '--mount', f'type=bind,src={CONFIG},dst=/etc/caddy/Caddyfile,readonly',
               '--entrypoint', 'caddy', IMAGE, 'run', '--config', '/etc/caddy/Caddyfile']
    return '\n'.join(['[Unit]', 'Description=Authenticated Sparkie workload links',
                      'After=hermes-gateway.service sparkie-fleet.service docker.service',
                      'Requires=docker.service', '[Service]', 'Type=exec', 'User=' + user,
                      'RuntimeDirectory=sparkie-ingress', 'RuntimeDirectoryMode=0700',
                      'ExecStart=' + ' '.join(map(_literal, command)), 'Restart=on-failure', 'RestartSec=5',
                      'TimeoutStopSec=30', 'NoNewPrivileges=yes', 'UMask=0077',
                      '[Install]', 'WantedBy=multi-user.target', ''])


def render(*, dashboard_origin, services_origin, dashboard_port, listen_port):
    dashboard, services = urlsplit(dashboard_origin), urlsplit(services_origin)
    if (any(url.scheme != 'https' or not url.hostname or url.username or url.password
            or url.path or url.query or url.fragment or not re.fullmatch('[A-Za-z0-9.-]+', url.hostname)
            for url in (dashboard, services)) or dashboard.hostname != services.hostname
            or dashboard.port != 8443 or services.port != 10000
            or any(type(port) is not int or not 1024 <= port <= 65535 for port in (dashboard_port, listen_port))
            or dashboard_port == listen_port):
        raise ValueError('Use the separate reviewed HTTPS service origin and distinct loopback listeners.')
    template = '''{
    admin off
    auto_https off
    persist_config off
}
http://:LISTEN_PORT {
    bind 127.0.0.1
    header Cache-Control "no-store"
    header Referrer-Policy "no-referrer"
    header X-Content-Type-Options "nosniff"
    @service path_regexp service ^/services/([a-z][a-z0-9-]{0,47})(/.*)$
    route @service {
        vars service_alias {re.service.1}
        reverse_proxy 127.0.0.1:DASHBOARD_PORT {
            method GET
            rewrite /api/plugins/sparkie-sparks/services/{vars.service_alias}/authorize
            header_up Host DASHBOARD_HOST
            header_up X-Forwarded-Proto https
            header_up X-Forwarded-Host DASHBOARD_HOST
            header_up X-Sparkie-Method {http.request.method}
            header_up X-Sparkie-Path {http.request.uri.path}
            header_up -Upgrade
            header_up -Connection
            @allowed status 204
            handle_response @allowed {
                route {
                    copy_response_headers {
                        include Set-Cookie
                    }
                    vars service_port {rp.header.X-Sparkie-Port}
                    uri strip_prefix /services/{vars.service_alias}
                    reverse_proxy 127.0.0.1:{vars.service_port} {
                        header_up -Cookie
                        header_up -Authorization
                        header_up -X-Sparkie-*
                        header_down -Set-Cookie
                        header_down -Service-Worker-Allowed
                        header_down -Access-Control-Allow-Origin
                        header_down -Access-Control-Allow-Credentials
                        header_down Content-Security-Policy "sandbox allow-scripts allow-forms allow-downloads; frame-ancestors 'none'; base-uri 'none'; worker-src 'none'"
                        flush_interval -1
                        transport http {
                            dial_timeout 5s
                            response_header_timeout 120s
                        }
                    }
                }
            }
            @signed_out status 401
            handle_response @signed_out {
                route {
                    copy_response_headers {
                        include Set-Cookie
                    }
                    @browser header Accept *text/html*
                    redir @browser https://DASHBOARD_HOST/login?next=%2Fapi%2Fplugins%2Fsparkie-sparks%2Fservices%2F{vars.service_alias}%2Fopen 303
                    copy_response
                }
            }
        }
    }
    respond "This service is not available. Open the Sparks page to review it." 404
}
'''
    return template.replace('LISTEN_PORT', str(listen_port)).replace('DASHBOARD_PORT', str(dashboard_port)).replace('DASHBOARD_HOST', dashboard.netloc)

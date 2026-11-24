# Public access and the private Spark LAN

At the home site, keep the two existing Funnel addresses and private SSH on Spark 1. Worker connections use their enrolled LAN addresses. No new public hostname is needed for this arrangement.

For a standalone public edge, one public DNS name serves the owner dashboard on HTTPS port 443 and the authenticated workload proxy on HTTPS port 10000. Different ports keep the two browser origins separate while Hermes's host-only sign-in cookie works on both. Caddy passes workload requests through the existing owner check and strips owner credentials before forwarding them to the workload.

Spark 1 reaches workers through the private LAN. Enroll each worker's actual address, interface, SSH host key and Linux machine identity from a trusted session on Spark 1 or an on-site connection. Reserve stable LAN addresses in DHCP or use the site's established static addressing. Keep SSH, inference listeners, Docker and Caddy's admin socket off the public internet.

## When the site has no public hostname yet

First establish whether the home connection can receive inbound HTTPS. Compare the router's WAN address with the site's public address and check its inbound firewall. A private or carrier-shared WAN address may mean an upstream router or ISP must provide the route. A free dynamic DNS hostname can track a changing public address. Duck DNS is one option. The owner controls the account and configures the updater on the router or host. Keep its token in the updater's protected settings. [Duck DNS](https://www.duckdns.org/why.jsp)

For a directly reachable site, route only the two HTTPS ports to the approved edge on Spark 1. The bootstrap uses the TLS-ALPN challenge on port 443. An existing edge on that port needs a separately reviewed site mapping that preserves its other services. A site behind an upstream NAT first needs a working incoming route or an owner-approved relay. The release does not provision a domain, router rule or relay. [Caddy automatic HTTPS](https://caddyserver.com/docs/automatic-https)

## Prepare the edge

From the extension directory, with the actual chosen origin in `SPARKIE_PUBLIC_ORIGIN`, render the initial configuration into a new private preparation directory. Validate it on a compute Spark with the pinned Caddy version before enrolling the edge.

```sh
python3 deploy/caddy_site.py "$SPARKIE_PUBLIC_ORIGIN" > initial-caddy.json
caddy validate --config initial-caddy.json
```

The two named routes start in maintenance mode. The administrative socket is `/run/sparkie-caddy/admin.sock`, mode 0600, in a directory writable only by the Caddy service account or root. The dedicated Caddy process needs a persistent private configuration directory for its saved routing state and a persistent data directory for certificates. On initial provisioning, load the reviewed bootstrap. On subsequent starts use Caddy's `--resume` mode and the same configuration directory. Replaying the bootstrap after a successful switch would restore the maintenance pages. These settings apply to a dedicated new instance. Never load the complete bootstrap over a shared server's configuration. [Caddy command line](https://caddyserver.com/docs/command-line#caddy-run)

Register the chosen dashboard origin and callback with the native Nous owner sign-in. Prepare the exact candidate, both routes, worker enrollments and rollback before approving the live switch. Retain the original access path until a client outside the LAN has exercised owner sign-in, authenticated API and WebSocket chat, and a workload link. Also check signed-out refusal, a real worker task from Spark 1, and recovery over the LAN. The Sparks' original Tailscale installation can be retired after those checks and exact owner confirmation.

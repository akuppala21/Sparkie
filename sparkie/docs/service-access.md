# Enrolled models and apps

The Sparks Home uses the existing native Hermes shell, owner session and exact
operation cards. The additional service adapters launch two reviewed Compose
recipes: a read-only artifact browser and the separately tested local GLM model.
They do not replace the selected Huihui main brain. A service must be enrolled on
a compute Spark before it appears as an available placement.

Starting or stopping uses the same durable operation store as power controls.
The owner reviews the recipe revision, Spark and exact instance. Uncertain starts
keep their resource reservations; observation checks cannot launch another copy.
The maintained Docker Compose process runs only sealed images and commands with
the reviewed mounts. Models and owner artifacts remain intact after stopping.

The Home shows progress, runtime logs, resource requirements and a working link
after readiness has been observed. Telegram has the same controls through its
native adapter: `/spark services`, `/spark run <recipe> <spark>`,
`/spark stop-service <recipe> <instance>`, `/spark logs <recipe> <instance>` and
`/spark open <recipe>`. The normal chat can prepare the same request for owner
confirmation; model text cannot confirm it.

## Access and native authentication

The home site uses its existing dashboard on port 8443 and the authenticated
workload proxy on port 10000. A standalone Caddy edge uses ports 443 and 10000
on its enrolled public hostname. Each site keeps the two browser origins
separate. See [public access and the private Spark LAN](site-network.md).

Stable paths are `/services/artifact-browser/` and `/services/glm-flash/v1`.
The latter exposes GET `/v1/models` and POST `/v1/chat/completions` or
`/v1/completions`. Server administration, model loading and power endpoints are
not model integration APIs. They remain outside this route. Artifact access is
GET/HEAD only. These guarantees apply to these reviewed recipes, not arbitrary
apps that assume root-relative paths, their own cookies or other API methods.

Caddy 2.11.9 handles HTTP, streaming and WebSockets with its standard reverse
proxy. The image is pinned by digest in `deploy/service_ingress.py`. Its native
response handler calls the Hermes owner-authenticated plugin route before
forwarding a request. Native login and refresh stay in Hermes; every rotating
Set-Cookie header is returned separately. Browser navigations without a session
go to the native sign-in page. API clients receive the native 401 response and
need a valid native owner credential. No new API-key system is introduced.

Workloads receive neither owner cookies nor authorization headers. Workload
responses cannot set Hermes cookies or widen CORS. Artifact HTML runs in a
sandboxed browser origin without service-worker access; it cannot use the
owner's service origin to make authenticated model calls. Model-server admin
paths and forged forwarding metadata are rejected by the same trusted adapter.
Long-lived streams are authenticated when established.

Workers publish only loopback ports. The private controller opens an enrolled
SSH forward after verifying the exact current instance. SSH host-key checks and
a private control socket establish that the forward belongs to that process.
Normal controller shutdown closes its forwards; stopping a forward never stops
a workload or releases its reservation. A leftover control socket after an
unclean exit is refused for inspection, not adopted as a new connection.

The forward's port is fixed per alias, so a verified restart or move changes
the destination while keeping the owner-facing path. Every request still passes
native owner authentication and current service observation. Performance claims
must include that real observation cost, not just proxy-only fixture timing.

## Qualification and recovery

Use the focused service, owner-control, relay and native-proxy groups for these
changes. The actual Caddy fixture exercises multiple rotating cookies, wrong
owner/origin, preserved request bodies/query, streaming, WebSockets and denied
model-server administration. The desktop/phone fixture exercises the native
Home and operation cards. Worker and cross-Spark receipts qualify actual starts,
stops and stable routing separately. All first-attempt failures remain recorded.

Installation includes the exact Caddyfile and unit in the reviewed plan hash.
It refuses an existing unreviewed unit or configuration. Promotion checks the
private native gate before publishing the separate workload origin. The home
Funnel and standalone Caddy adapters check the current route and submit their
updates conditionally using the observed ETag. If the acknowledgement is lost,
the installer reads the route again. Rollback uses the same operation journal
to restore the previously observed workload route and preserve unrelated routes
and workload data.

Upstream references: [Caddy reverse proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy),
[Caddy license](https://github.com/caddyserver/caddy/blob/v2.11.9/LICENSE),
[Docker Compose](https://docs.docker.com/compose/).
The stock Caddy image retains upstream notices; no upstream proxy code is copied
into the extension. Hermes remains pinned by `upstream.lock.json`.

# Home on the native Hermes dashboard

The November 20 direction is one application: Sparkie fleet Home in the native
Hermes shell, with the existing native pages and additional useful extension pages.
Use maintained components before writing equivalents. Do not operate a second
dashboard, agent loop or memory store, or create an official fork.

## Implemented composition

- Hermes v0.23.2 (`ae2a81ccc00e9b7c06301523e5bb09608397149c`) supplies
  the responsive sidebar, authentication, chat, sessions, Models, settings, theme
  loader and plugin components. Its source and runtime remain pinned.
- The root extension lands on `/sparks`, the canonical Home tab. The pinned
  native title resolver labels literal `/` as Sessions; using the supported tab
  gives Home the correct phone header and active navigation without changing
  Hermes's shell. The redirect preserves the native base path and selected profile.
  A narrow compatibility patch to the pinned frontend makes the default root wait
  for the profile's current plugin list. Without it, a fresh `?profile=default`
  visit or a tab with a pre-upgrade manifest cache can redirect to Sessions before
  the Home override is discovered. The patch is
  `deploy/patches/hermes-dashboard-root-discovery.patch`; apply it with
  `git apply --check` followed by `git apply` in an isolated pinned source checkout
  before building the static dashboard. `HERMES_WEB_DIST` selects those assets.
  Backend authentication and the agent runtime are unchanged. Retire this patch
  when a verified upstream release supplies the correction.
- The packaged backend also carries a reviewed change to the native import
  and transfer routers. Direct web restore returns HTTP 409 with instructions
  for staged recovery. The native backup, export and download paths remain
  available through the same authenticated dashboard. The candidate manifest
  records the patch digest and both upstream and packaged router digests.
  [Package preparation](../deploy/README.md)
- Home uses native Cards and Buttons for observed fleet state, workload details,
  network port readings, checked controls and electricity. It links native Chat
  and Models. Cable peers remain explicitly unverified.
- `/recipes` reads two packaged model setup records. It distinguishes the chosen
  model's measured trial from full application qualification and previous trials.
  It does not claim a recorded recipe is installed or offer an unwired launch action.
- `themes/sparkie.yaml` is a selectable native theme. Two limited rules through
  Hermes's supported `customCSS` hook style its solid buttons and cards because
  those pinned components do not consume every theme token. There is no replacement
  sidebar or second CSS framework. Computed appearance is checked in the browser.
  Existing explicit owner theme choices are preserved.

The complete native bundled-plugin collection is retained, with the previously
reviewed owner-only authentication registration. The root alias registers no extra
API or agent tools. Recipes adds one authenticated read endpoint. Display changes
do not require inference and create no extra model calls.

## Display data

The existing collector reads verified plug identities and timestamped fleet data.
Its UI timer runs every minute without a controller socket, so it cannot run idle
shutdown, workspace cleanup or power operations. Known switched-off Sparks are
not contacted. The dashboard mounts only the resulting observation directory,
read-only; credentials stay outside it.

Historical electricity is imported from a frozen copy into the new display
database. Source records remain intact. Per-meter cutoffs prevent counting old
totals and new samples twice. Imported monthly totals cannot invent day/week
breakdowns; the API reports that limitation. Costs remain usage times the currently
selected amount, with no stored rate or cost history.

## Source reuse decisions

| Source inspected | Decision and reason |
| --- | --- |
| Native Hermes dashboard and SDK | Used directly for this update. Preserve native Models rather than building another equivalent page. |
| `MiaAI-Lab/sparkDash@e8df8638ec00a2e003211947ef7148763a381396` | Apache-2.0 with NOTICE. RDMA parsers, history aggregation and health evaluation are candidates when their real input/caller exists. Do not import its full server, auth or control loop. No sparkDash source has shipped in this update. |
| `spark-arena/sparkrun@593e3920ca2f74b8aa1cd59446ccbc4eeb307307` | Apache-2.0. Its maintained launcher API is preferable to copied lifecycle fragments if later selected for launch. Replacement behavior must be qualified against existing workloads. |
| `xgoldbug/gpub@f25043cb43656e18fe949c7c0d0d842979713f22` | MIT. Reservation edge cases are useful references; a second scheduler and PostgreSQL service have no present need. |
| `NVIDIA/dgx-spark-playbooks@30883150541743d580c9c347700c6ac99fc396d2` | Candidate local ComfyUI and cuDF setups for future recipes. A listing alone does not qualify an executable local workflow. |

Upstream test counts and community reports are evidence to inspect, not proof of
our deployed combination. Any copied module must retain its source revision,
license/notice, relevant tests and a real caller. Avoid unused imported code.

## Incremental UI update authority

On November 20 the owner requested: “just push to the real ui as u go since im not
doing anythong on it and want to see too.” This authorizes the checked incremental
UI updates in this work. It does not replace the permanent exact-confirmation
policy for future self-updates or authorize the complete brain, gateway, bot or
fleet-control cutover. Each UI receipt records its actual diff, checks and rollback.

The full migration remains separate. Preserve the feature inventory in
[feature continuity](feature-continuity.md); a dashboard publication does not
complete the unfinished owner workflows.

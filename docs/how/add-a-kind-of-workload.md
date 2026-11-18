# Run a new kind of workload

Something that runs on a Spark and is not a model.

## Touch

- An app that isn't a model: use `keep_running` (`21-apps.mjs`, R38), which starts, keeps, restarts and stops it; with
  `gpu` it has its Spark's GPU (one GPU thing per Spark), with `command` the words it runs, with `once` a job that
  runs to its end and writes into the shared folder (A13). A new container resolves Spark Console’s HTTPS name to
  its tailnet address when the hub reports both through Tailscale.
- Sparkie passes the Spark and container name to `keep_running` for an existing app. Add `do` to restart or stop it.
  Image, port and other setup details are for a new request or an app the tool reports missing (`systemPrompt`).
- `appStates` (`21-apps.mjs`) reads every container's state on the Sparks where apps are kept (not in `inventory`,
  which runs inside every start); an app without a GPU is never a stop candidate and never stops anything.
- Anything else: its kind in `learnedFrom` (`19-watcher.mjs`); a job through `claimed`, `newJob`, `runJob`; its own
  name and labels; its own stop and restart path (`inventory`, `stop_model` and `restart_model` see only
  `spark.console=1`; `should_be_running` those and `keep_running`'s apps); `spark.protect=true` if it must not be stopped to make room (every unprotected GPU
  user is a stop candidate in every plan, `plan` in `05-library.mjs`).

## Also update

- The `workloads` kind list (the `workloads` action, `16-reads.mjs`); `CHANGES_MODELS` (`20-desired.mjs`);
  `OP_WORDS` (`14-chats.mjs`); `startingNow` (`17-changes.mjs`); the page's job labels (`jobLabel` and `SVC_LABEL`
  in `public/app.js`); `knownContainers` (`test/start-mock.mjs`).
- Whether it heals: anything in `ranHere` joins the desired list, and healing then tries `restart_model` on it.
- Without `spark.console=1` the passkey gate and Sparkie's targeting treat it as started outside.

## Never

- Label it `spark.console=1` (every model start stops other console containers there, `plan` in `05-library.mjs`).
- Use port 8000.
- Place it on the hub.

## Rules

- R38: `keep_running` is the only way an app (a container that is not a model) is started, kept, restarted or stopped.
  The box is not one: `boxOpen` (`21-box.mjs`, R62) starts it with its own `docker run`, with no claim and no job.
- R1: nothing new starts on the brain's Spark. R2: 8 GB stays free; one GPU thing per Spark.
- R13: one change per Spark. R17: the console's container names and labels.

## Tests

- `apps.test.mjs` (“apps kept running”); `change.test.mjs` (“a GPU app or job holds its Spark’s GPU”).

## Copy from

- `keep_running` in `21-apps.mjs`, and a dev box through it (`devBox`).

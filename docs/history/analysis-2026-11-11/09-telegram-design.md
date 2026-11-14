# Telegram for Spark Console: design (2026-11-11)

Designed by Fable 5.2, read-only, against build `20be1e1b0afb`. Nothing was built, run or sent. To be built on Opus 5.5. This is the attack pass that `05-all-in-one-report.md` item 7 said channels-1 still needed. Line numbers are today's; function names are the anchor.

Not checked live: Telegram's Bot API. The earlier sweep opened the docs for `sendMessage` (4,096 characters, `link_preview_options`, `disable_notification`). The rest is from general knowledge and the builder confirms it against the docs before writing the adapter: `getUpdates` answers 409 when another poller or a webhook holds the token and 401 when the token is revoked; undelivered updates are kept about 24 hours; a typing action lasts about 5 seconds; `t.me/<bot>?start=<code>` sends `/start <code>`.

## 1. In one paragraph

The console on Spark 2 asks Telegram for new messages over one outbound HTTPS connection (long polling). No port, route or Funnel is needed. The owner pairs one private Telegram chat by sending a one-time code that only the passkey page shows. After that, text from that chat and that user id is a turn in the owner's Sparkie chat, with the same gates as the page. Everyday requests run. Going back a build, memory and saved workflows wait as a button in Spark Console that needs the passkey. Access, keys, passkeys and devices have no path from Telegram at all. One function, `tell()`, sends everything, and only four things: a reply, the result of work started there, its carry-on line, and a watch the owner set. Nothing in it can lock the owner out: Telegram can only be removed, never required.

## 2. Decisions

### 2.1 Transport: long polling

- `getUpdates` from Spark 2, `timeout` 25 s, `limit` 100, `allowed_updates: ["message","callback_query"]`. Edited messages and group events are never asked for.
- Not a webhook. A webhook needs a route the internet can call (`PUBLIC_ROUTES`, R4, R5), works only while Funnel is on, and puts the ts.net name in Telegram's hands.
- **Offsets.** `offset` lives in `telegram.json` (state). It is saved before an owner's message is acted on, so a crash never replays "stop X" (at most once). Strangers' updates advance it in memory; the file is written at most once a second.
- **Late messages.** A message older than 5 minutes (`message.date`) is not acted on. One fixed line: "I was away when you sent that. Say it again if you still want it."
- **One poller.** The loop starts only inside the `local.listen` callback (`25-backup-and-start.mjs:50-53`), which a second copy never reaches (it exits on `EADDRINUSE`, `:46-49`). A restored state copy on another Spark has no token, because the token is not in the state folder (2.6). Under `SPARK_CONSOLE_ALL_LOCAL` the real host is unreachable by construction (2.8).
- **409 (someone else holds the token).** Never fight: wait 60 s, then 5 minutes. State "in use elsewhere". The console never calls `deleteWebhook` by itself; it does so once, when the owner pastes a token.
- **Telegram unreachable.** Back off 2 s to 60 s. State "can't reach Telegram" with the time. Replies are tried 3 times, then dropped (they are in the chat on the page). Watches are kept until Telegram accepts them or they end.
- **Restart.** SIGTERM aborts the open poll. Unconfirmed updates stay at Telegram and are read after the restart if under 5 minutes old.
- **When it polls at all.** Only with a token and either a paired chat or an open pairing code. Otherwise there is nothing to hear.

### 2.2 Pairing

1. The owner pastes the bot token on the passkey page (`PUT /telegram`, passkey confirmed, refused through the short address and refused when no passkey exists). The console calls `getMe`, then `deleteWebhook`, stores the token (2.6), and returns the bot's name and a one-time code.
2. The code: 8 characters from 31 (no 0, O, 1, I, L), about 40 bits, 10 minutes, one use. The page shows it as a link and QR (`https://t.me/<bot>?start=<code>`). It flows page to Telegram only; the bot never asks for or shows a code.
3. The bot accepts `/start <code>` only from a private chat, from a person (not a bot). On a match it stores `chatId` and `userId` in the secrets file and answers "Paired with Spark Console."
4. From then on an update counts only if it is a private chat, `chat.id` is the stored chat and `from.id` is the stored user. Button presses are checked the same way.

- **Strangers get silence.** No reply, no chat, no disk write, no brain call; one counter in memory. A fixed line would confirm the bot is live and let anyone make the console send.
- **Wrong codes** are counted per sender (3 tries per code), never against the code, so a stranger cannot burn the owner's code.
- **No second confirmation step.** The code is shown only after a passkey tap and lives 10 minutes. The page then shows who was paired (first name, cut to 40 characters; it never reaches the brain).
- **Unpair.** `DELETE /telegram` on the page (no passkey: taking access away never needs one, as in R6), or `/unpair` from Telegram. Both forget token and chat and stop the poller. Pairing again starts from the token.
- **Lost phone.** From any signed-in device: Disconnect. Or `/unpair` from another Telegram device. Then in Telegram: Settings, Devices, end that session. The binding is not in backups or install snapshots, so `restore.sh --with-state` cannot bring it back.

### 2.3 What a Telegram message may do

The threat is a stolen Telegram session or a SIM swap: the thief is "the owner" on Telegram until the owner disconnects.

| Tier | From Telegram | How |
|---|---|---|
| Lookups | Run. Answers are masked (2.5). | `sparkieTurn`, as today |
| Everyday changes: start, stop, restart, cancel, undo the last change, find setups, run a saved workflow, test the changes, set or stop a watch | Run as in the owner's chat: at once when the owner's words ask for it and name the target (R25), else a button | via `sparkie`, `ctx.channel: 'telegram'` |
| Owner-only (R31 set): `undo_update`; `remember`, `forget_memory`, `save_workflow`, `forget_workflow`; any existing owner-only question (stop something started outside, stop what answers Sparkie); every future action that changes Sparkie's code, skills, settings, secrets or connectors, or installs | Never runs from Telegram. An owner-only button appears in that chat in Spark Console and needs the passkey. Telegram gets one line: "That one waits for you in Spark Console." | `PAGE_ONLY` set, `question(..., { ownerOnly: true })`, `passkeyGate` |
| Access, agent keys, passkeys, devices, the brain's start, stop and switch, deleting chats or files | No path. They are page routes, not actions, and Telegram calls only `sparkieTurn` and `runChoice`. | nothing to build; R32 keeps it so |

- **Found while reading:** today's `undo_update` guard would let Telegram through. It treats via `sparkie` with no session as "the owner on their tailnet" (`18-workflows.mjs:411`), and a Telegram turn has exactly that shape. The comment above it already names Telegram. The guard must also read `ctx.channel`.
- **Memory and saved workflows are owner-only here** because a line planted from a stolen session would steer every later chat after the phone is disconnected. The four tools are not offered on a Telegram turn (so no button noise for facts said in passing); if the model calls one anyway, it becomes the owner-only button.
- **Telegram's inline buttons** press only plain buttons of that Telegram chat: a proposal, "which one?", "this stops X, go ahead?", a validation run. Owner-only buttons are sent as text with no button, and a press of one is refused (`runChoice`, `14-chats.mjs:87`, already refuses any via but `page`). A typed "yes" presses the single open plain button, as on the page.
- **Audit.** Sparkie's tool calls in a Telegram turn: `via: 'sparkie'`, `channel: 'telegram'`, `actor: 'Sparkie for the owner on Telegram'`, `from: 'telegram:<user id>'`. Button presses and a typed yes: `via: 'telegram'`, `actor: 'owner on Telegram'`. Tool calls keep via `sparkie` on purpose: the intent gate, validation runs and question wording key on it in nine places (`16-actions.mjs:302, :330, :335`; `17-changes.mjs:68, :547`; `18-workflows.mjs:411`; `20-desired.mjs:131, :162`; `14-chats.mjs:225`). A new via there would skip R25 silently. One `channel` field finds both kinds of line.
- **Bounds that already apply:** 4 changes a message, 12 started changes an hour then the pause (R9), nothing on Spark 2 (R1), protected containers and the brain never stopped (R8). The owner's pause stops Telegram's changes too; lookups still answer.
- **What a stolen session can still do until disconnected:** start, stop and restart models on Spark 3 and 4, cancel operations, and read whatever Sparkie can read (fleet, logs, memory lines). It cannot touch access, keys, passkeys, devices, the build, memory or saved workflows, and cannot lock the owner out. This is the cost of "everyday requests run from Telegram".

### 2.4 Threads

- One current chat. `telegram.json` holds its id; the chat carries `channel: 'telegram'`. `/new` starts another. A full chat (200 messages) rolls to a new one with one line saying so.
- On the page it is one of the owner's chats, tagged "from Telegram" (the list already draws that tag for agents' chats, `public/app.js:3705, :3714`; `chatSummary` only has to name the channel). The owner can read it, type in it and press its buttons there.
- A message typed on the page into that chat is a page turn. Its reply and results stay on the page. Only work started from Telegram reports to Telegram.
- One Telegram turn at a time. A message that arrives while Sparkie is answering gets "Still answering the last one. Send that again when I'm done." once, and is not queued.
- Three commands handled by code, with no brain: `/new`, `/status` (brain up or not, Sparks online, operations running, build), `/unpair`.
- Text only. Photos, voice, files, stickers: "I only read text here." Forwarded messages and messages sent through another bot are not read ("Type it in your own words"): their text is someone else's and must not count as the owner's words (R25).

### 2.5 The tell rule

`tell(why, text, opts)` in `20-tell.mjs` is the only caller of the adapter's send. It allows:

| why | When | Text |
|---|---|---|
| `reply` | once per accepted owner message | Sparkie's words, or a fixed line |
| `result` | an operation whose job carries `channel: 'telegram'` | fixed template |
| `carry` | the carry-on turn of a request made on Telegram | Sparkie's words |
| `watch` | a live row the owner set from Telegram | fixed template |
| `system` | pairing, `/new`, `/status`, `/unpair`, "restarted while answering" | fixed line |

Never: heals, crashes nobody asked about, notices, sign-ins, validation notes, digests, other chats' or agents' results.

- **Fixed templates** are built from the operation type, the name (quoted, 60 characters, `NAME_RE` characters only), the Spark and the status. No `job.error`, log lines, endpoint, address or console URL. Failed: "Starting “gemma” on Spark 3 didn't work. The details are in Spark Console." The page chat keeps today's full text (`postResult`, `14-chats.mjs:117-131`).
- **Button outcomes** use a fixed line per status (under way; expired; paused; not allowed here; didn't work, details in Spark Console), never `e.message`.
- **Every send:** plain text, no `parse_mode`, `link_preview_options.is_disabled: true`, through `maskSecrets`, and the bot token itself is replaced if it ever appears.
- **On the record.** Each send writes one audit line: why and how long, never the text.
- **Length.** Up to 3 messages of 4,000 characters, split at paragraph ends; anything more is cut with "(the rest is in Spark Console)".
- **Typing.** `sendChatAction` every 4.5 s while a turn runs, for 5 minutes at most. No streaming or message edits.
- **Limits out.** 20 sends a minute in all. Results and carry-on lines: 6 an hour, then silence until the hour frees (they are still on the page). Watches are not counted. A 429 is obeyed once (up to 30 s).
- **Limits in.** 20 owner messages a minute, then one "Too many messages. Wait a minute." and silence. Inbound text is cut at 4,000 characters.
- **Sound.** A result or carry-on line more than 30 minutes after the owner's last message is sent silently.
- **One message per request.** When a carry-on turn will run, the result line is held and sent only if that turn fails.
- **A Telegram turn's prompt** adds: plain short text, no Markdown or tables; memory, saved workflows and updates are changed in Spark Console.

**Watches** (second install, after Telegram is linked). `tell_me { about, target, hours }` and `stop_telling { id }`:
- Kinds: an operation ends; a Spark offline for 90 seconds (`HEAL_OFFLINE_MS`); a Spark back; a model crashed.
- 24 hours unless the owner's words carry a number; 7 days at most; 10 rows at most; fires once.
- The row is removed only when Telegram accepts the message or the watch ends. An ended watch says nothing.
- Firing runs no brain turn and no action.
- Saved only from the owner's own turn (a telling verb plus when, if or once; no "should" or "whether"). A button once the turn has read outside text. Refused for agent keys, `ask_sparkie`, `POST /actions` and workflow steps.
- It tells where it was asked: on Telegram if asked there, as a notice in the page chat if asked there.
- `stop_telling` works while paused and from `POST /actions`: it only removes a row.
- "Stop telling me about gemma" can never stop gemma: a telling sentence removes `stop` and `cancel` from what the words ask for.

### 2.6 Secrets file

- `~/.config/spark-console/secrets.json`, folder 0700, file 0600, written as temp file then rename. Plain JSON, not sealed (the owner's choice unless backups go off-site).
- Shape: `{ "telegram": { "token", "bot", "chatId", "userId", "name", "pairedAt" } }`. The chat binding is here too, not in state, so no backup or snapshot can restore an old pairing.
- It is outside the daily copy (`tar -C STATE_DIR`, `25-backup-and-start.mjs:12`) and outside the install snapshot (`save "$STATE"`, `deploy/host-on-portal.sh:124`), with no change to either.
- `03-secrets.mjs`: `secretsRead()`, `secretsWrite(change)`, about 40 lines. An unreadable file is never overwritten: Telegram shows "the secrets file can't be read" and stays off.
- The path can be changed only with `SPARK_CONSOLE_SECRETS_FILE` under `SPARK_CONSOLE_ALL_LOCAL`. Under ALL_LOCAL with no path set, the store is off, so tests never read the developer's home.
- **Masking.** The token never appears in: `GET /telegram`, `/health`, `sparkie_setup`, audit (`PUT /telegram` is audited as `{ bot }`), events, chats, logs. The adapter throws fixed codes (`unreachable`, `refused`, `in-use`, `slow-down`), never `e.message` or a URL, because Telegram puts the token in every request path. `SECRET_PATTERNS` (`20-mcp.mjs:247`) gains `/\b\d{6,12}:[A-Za-z0-9_-]{30,64}\b/g`. A Telegram message shaped like a bot token is not stored: "That looks like a bot token. Revoke it in @BotFather and paste the new one in Spark Console."
- The owner's password is not involved anywhere.

### 2.7 Failure modes and self-healing

| What | The console does | The owner sees |
|---|---|---|
| Token revoked (401) | Stops polling until a new token is pasted. One notice event. | Page: "Telegram: the bot's token stopped working. Paste a new one." |
| Someone else uses the token (409) | Backs off, never fights | "Another program is using this bot. Make a new token in @BotFather and paste it." |
| Telegram unreachable | Retries with backoff by itself | "Can't reach Telegram since 10:42. Trying again by itself." |
| Qwen busy | The turn waits its place; typing shows. At the owner's 4-answer limit: "Sparkie is busy with other chats. Try again in a minute." | the reply, later |
| Qwen down | No fallback. Fixed line: "Sparkie's model isn't answering. Spark Console restarts it by itself; try again in a few minutes. /status shows where things stand." | `/status` still answers |
| Restart mid-reply | `telegram.json` holds `answering`; at start one line, "Spark Console restarted while I was answering. Send that again." The message is not re-run. | that line |
| Restart cut off an operation started on Telegram | `telegram.json` lists operations awaiting a result; at start, any that are gone get one line: "A restart cut off starting “X”. Check it in Spark Console." | that line |
| Buttons after a restart or 15 minutes | "That button has expired. Ask again." | that line |
| Rolled back to a build without Telegram | The files stay, unused | Telegram is silent until the next update |
| A fault in the Telegram code | The loop and `watchesSee` sit in try/catch; the handler never awaits them | nothing; the page is unaffected |

- **Status.** `GET /telegram` (owner) returns `{ connected, bot, paired, name, state, since, lastMessageAt, strangersIgnored }`. The page shows it as one row under Access. Full `/health` gains `telegram: <state>`.
- **Sparkie can explain it.** `sparkie_setup` gains `telegram: { state, since, whatToDo }` in fixed words, and `fleetNotes` gains one line only while Telegram is in a problem state. Sparkie cannot fix a token or pair a chat; it says what the owner does. Reaching Telegram again needs nothing: the loop retries.

### 2.8 Tests on the stand-in fleet

- `test/mock/telegram.mjs`, started by `test/start-mock.mjs` beside `model.mjs` (`:165`) on a free port. It serves `/bot<token>/getMe`, `getUpdates` (real offset rules; 409 on a second open poll), `sendMessage` (400 over 4,096 characters), `sendChatAction`, `answerCallbackQuery`, `deleteWebhook`. Every call is appended to `$MOCK_DIR/telegram-calls.jsonl`. Control endpoints: `/__push` (a message or button press from any user and chat), `/__mode` (401, 409, 429 with `retry_after`, down).
- `SPARK_CONSOLE_TELEGRAM_API` is honoured only under `SPARK_CONSOLE_ALL_LOCAL` and only as `http://127.0.0.1:<port>` (the `cloudInfo` pattern, `23-http.mjs:100`). Under ALL_LOCAL without it, Telegram is off. Otherwise the host is the literal `https://api.telegram.org`, with `redirect: 'error'`.
- Timing switches (`*_MS`, usable anywhere, R30): `SPARK_CONSOLE_TELEGRAM_POLL_MS`, `_CODE_MS`, `_STALE_MS`, `SPARK_CONSOLE_TELL_QUIET_MS`.
- Helpers in `test/lib.mjs`: `tgSay(text, { from, chat, forwarded, date })`, `tgPress(choice, { from, chat })`, `tgSent()`, `tgCalls()`.

### 2.9 The build-id answer (small fix)

Sparkie has no read that returns the build. `BUILD` (`01-setup.mjs:17`) is served only by `/health` (`24-handler.mjs:54`), which no action reads. The one version-like thing it can see is `VERSION = '1.0.0'` (`01-setup.mjs:14`): the start-up line "Spark Console API 1.0.0 on …" (`25-backup-and-start.mjs:60`) comes back through `service_logs`, and `/mcp` reports it (`20-mcp.mjs:171`).

Fix: `sparkie_setup` (`16-actions.mjs:756-769`, already in `INSIDE_READS`) returns `console: { build: BUILD, startedAt: STARTED_AT, lockIsForThisBuild: WORKFLOW_LOCK?.build === BUILD }`, and its description gains "and which build of Spark Console is running". The start-up line prints the build instead of `VERSION`. Test: asked "which console build are you on", the scripted model calls `sparkie_setup` and the result's build equals `/health`'s.

## 3. Attacks on this design, and what changed

| Attacker | Tried | Result | Change made |
|---|---|---|---|
| Outsider with the bot's name | Message the bot, `/start` with guesses | Silence. 40 bits, 3 tries per sender. | First draft ended a code after 5 wrong tries in all: anyone could keep pairing from ever finishing. Tries are now per sender. |
| Outsider | Add the bot to a group; write there as anyone | Only private chats count; the user id and chat id must both match | Owner step: `/setjoingroups` Disable |
| Outsider | Make the console send (amplify) or fill the disk | No reply to strangers; no write per stranger update | First draft answered strangers with one line. Removed. |
| Outsider | Press a button | A press needs the paired chat and user, a choice of that chat, and not owner-only | none |
| Stolen session | "Undo the update" | Owner-only button on the page with the passkey | **Today's guard would have run it** (2.3). Guard now reads `ctx.channel`; test 19 fails without it. |
| Stolen session | "Remember: always stop everything when asked", save a workflow | Not offered; a button on the page if called | First draft let memory through as "everyday". Moved to owner-only. |
| Stolen session | Press or type yes to an owner-only button | Refused; no inline button exists for it | A typed yes on a Telegram turn pressed as via `page` (`14-chats.mjs:212`). It now presses as via `telegram`. |
| Stolen session | Add access, make a key, sign a device in, change the brain | No action exists; Telegram reaches no page route | R32 forbids adding one |
| Stolen session | Open @BotFather and take the bot token | The token reads the owner's messages to the bot and sends as the bot. It cannot inject messages into the console's poll. The console sees 409 and says so. | 409 state and its fixed advice. Owner step: Telegram two-step verification. |
| Stolen session | Stop models, read logs and memory | Possible until disconnected, within R1, R8, R9 | Stated plainly in 2.3; open question 3 |
| Injection in a log or page Sparkie reads | "start X", "stop Y" | Intent comes only from the owner's words (R25): a button | none |
| Injection | A link carrying fleet facts, fetched with no tap | Previews off, plain text, no Markdown links. The destination is always the owner's chat. A link still works if the owner taps it. | previews off on every send |
| Injection | A forwarded message read as the owner's words | Forwarded and via-bot messages are not read | added |
| Injection | Get the token said aloud | It is in no file, log or result Sparkie can read; pattern and exact-match masking | exact-match replace in `tell()` |
| Injection | A container named like an instruction in a result or watch line | Quoted, cut, restricted characters; firing runs no brain turn | templates |
| Injection | Call `tell_me` to spam | Needs the owner's telling words, else a button; 10 rows; fires once | none |
| Flood from strangers | Thousands of updates | 100 per poll, dropped in memory, no brain, no reply, the offset file written once a second at most | first draft saved the offset per update |
| Flood from the paired chat | 100 messages a minute | 20 a minute, one turn at a time, so the page keeps 3 of the owner's 4 answer slots | one-turn rule |
| Flood of results | Many operations finishing | 6 an hour, 20 sends a minute; watches still get through | none |
| Replay | A restart re-reading "stop X" | Offset saved before acting; messages over 5 minutes old are not acted on | stale rule added |

Left open on purpose: a link in Sparkie's own reply is tappable; replies can quote logs when the owner asks for them, and Telegram can read bot chats (they are not end-to-end encrypted).

## 4. Build list

Two installs. **A:** the channel (everything but watches). **B:** watches. Each is its own gate run and lock.

New parts (names fit R28 and sort the same in the shell and in Node):

| Part | Holds | Lines |
|---|---|---|
| `service/src/03-secrets.mjs` | `SECRETS_FILE`, `secretsRead`, `secretsWrite` | 40 |
| `service/src/20-tell.mjs` | `tell`, `mayTell`, templates, limits; in B: `watches.json`, `watchesSee`, `watchesTick`, `tell_me`, `stop_telling` | 110 + 90 |
| `service/src/21-telegram.mjs` | `tgCall` (the only place the host name appears), poll loop, pairing, inbound checks, commands, button presses, `telegramView` | 260 |

Edits to existing parts:

| Where | Change |
|---|---|
| `14-chats.mjs:162` `sparkieTurn` | new `channel` argument; into `ctx.channel` and `ctx.from` (`:225`); tools without the `PAGE_ONLY` four (`:206`); `systemPrompt` channel lines (`:40-55`); a typed yes presses as `{ via: 'telegram', actor: 'owner on Telegram' }` (`:212`); `conv.task.channel` (`:343`) |
| `14-chats.mjs:79` `runChoice` | `ctx.channel` when `by.via === 'telegram'`; nothing else (`:87` and `:99` already refuse owner-only and never set `ownerConfirmed`) |
| `14-chats.mjs:117` `postResult`, `:138` `continueTask` | call `tell('result' / 'carry')` when the job or task carries the channel; pass `channel` into the carry-on turn |
| `14-chats.mjs:30` `chatSummary` | `agent: c.agent?.name || (c.channel ? 'Telegram' : null)`, `channel` |
| `16-actions.mjs:159` | `PAGE_ONLY = new Set(['undo_update','remember','forget_memory','save_workflow','forget_workflow'])` |
| `16-actions.mjs:298` `runAction` | after the pause check: `ctx.channel && PAGE_ONLY.has(name) && !ctx.ownerConfirmed` returns the owner-only question; in B, `stop_telling` skips the pause |
| `16-actions.mjs:359` | `jobs.get(op).channel ||= ctx.channel` beside `.conv` |
| `16-actions.mjs:369, :374` | `channel` in both audit lines |
| `16-actions.mjs:756` `sparkie_setup` | `console` (2.9) and `telegram` |
| `16-actions.mjs:103, :129, :159` (B) | kinds `watch` and `unwatch`; the `INFO_START` exemption `find` has; `ACTION_KIND`; a `sparkieCheck` branch for the target; a telling sentence drops `stop` and `cancel` |
| `17-changes.mjs:547` | a press via `telegram` counts as the owner's for cancelling held jobs |
| `17-changes.mjs:76` (B) | `changeLabel` for `tell_me`, `stop_telling` |
| `18-workflows.mjs:411` | `ownerHere` also needs `!ctx.channel` |
| `18-workflows.mjs:132` (B) | `NOT_A_STEP` gains both |
| `19-watcher.mjs:27` (B) | `fleetEvent` ends with `try { watchesSee(x) } catch {}` |
| `19-watcher.mjs:181` `fleetNotes` | one line while Telegram has a problem |
| `12-status.mjs:105` (B) | `watchesTick()` beside `noteSparkStates` |
| `20-mcp.mjs:247` | bot-token pattern |
| `22-passkey.mjs:48, :99, :102, :111` | `describeChange`, `mayNeedPasskey`, `bodyLimit` (2,000), `needsPasskey` for `PUT /telegram` and `POST /telegram/pair`; `DELETE` never |
| `24-handler.mjs` (below `:130`) | `GET /telegram`, `PUT /telegram`, `POST /telegram/pair`, `DELETE /telegram`; all `ownerOnly()`; `PUT` and `POST` refused when `req.viaDoor` or when no passkey exists |
| `24-handler.mjs:54` | `/health` gains `telegram` |
| `25-backup-and-start.mjs:50, :60, :73` | start the loop in the listen callback; print the build; abort the poll on SIGTERM |
| `public/app.js` near `:4656` | one "Telegram" row under Access: token field (password type), link and QR, status line, Disconnect. About 70 lines. |

Section 6 of the map, applied:
- **A new way in:** `ctx.channel` is the new fact. It is read at `16-actions.mjs:298`, `18-workflows.mjs:411` and in `tell`. Via `telegram` (presses only) is checked at every comparison in the map's list: paused like an agent, counted by the breaker, never `page`, never `ownerConfirmed`. The page's `whoKey` (`public/app.js:435`) gains a "Telegram" name.
- **An action (B):** `tell_me` and `stop_telling` are changes. `CHANGE_TOOLS` in `test/lib.mjs:43`; counts 24 stays, 37 becomes 39 (`test/change.test.mjs:105, :120, :142`); argument tables in `test/door.test.mjs:348` and `test/fuzz.test.mjs:40`.
- **A state file:** `telegram.json` and `watches.json` with `writePrivate` and `readKept`; no secret in either; rows in map section 4.
- **An outbound connection:** `tgCall` with a fixed host and the ALL_LOCAL switch; the WEB node of the diagram.
- **A page route:** below its checks, tested through every door (R4).
- **No new workflow, event type, job type, worker action or shipped file.** No npm package. Nothing touches SSH, Tailscale, the firewall or users.
- After the edits: `node tools/build-server.mjs`, `node tools/code-map.mjs`, `node test/lock.mjs`.

Size: about 620 lines in the service (A 470, B 150), 70 on the page, 650 of tests and mock, 60 of documents.

## 5. Tests

New file `test/telegram.test.mjs`, plus the edits named. "No model request" means `model-requests.jsonl` did not grow.

Pairing and strangers
1. No token: `GET /telegram` says not connected; the mock saw no call.
2. `PUT /telegram`: nobody through Funnel 401; a member 403; cross-site 403; through the short address 403; no passkey header 428; no passkey registered 409; with the passkey 200 with a bot name and code.
3. After 2: the secrets file is 0600 and not under the state folder; the daily copy's tar does not contain the token; nor do `audit.jsonl`, `events.jsonl`, `chats.json`, `GET /telegram`, `/health`, `sparkie_setup` or the service log.
4. A token Telegram refuses: 400 in fixed words, nothing stored.
5. A stranger says "hi" and tries four wrong codes: no send. The owner's code still pairs afterwards.
6. The right code from a group, or from a bot: not paired. The code a second time, or after it ends: ignored.
7. After pairing, none of these sends, calls the model or makes a chat: a stranger's message; a stranger pressing a real choice id; the owner's user id writing in a group; the owner's user id in another chat.

Talking
8. "what's running": one message to the paired chat, no `parse_mode`, previews off, a typing action before it; the chat is in `GET /chats` tagged Telegram with both messages saved.
9. A 9,000-character answer: at most 3 messages of at most 4,096 characters; a longer one ends with the "rest is in Spark Console" mark.
10. `/new`: the next message lands in a new chat; the old one is kept.
11. "start gpt-oss-20b on spark 3": it starts; the audit line has via `sparkie`, channel `telegram`, from `telegram:<id>`; at the end exactly one message, matching the template, with no address, endpoint or log line; the page chat still has the full notice.
12. A start that fails: the Telegram line contains nothing from `job.error`.
13. An unclear request: a message with an inline button; pressing it runs it (audit via `telegram`, actor `owner on Telegram`); a typed "yes" does the same; "no" puts it away.
14. A button pressed twice, or after it expired: the fixed line, nothing runs.
15. "start X and tell me how fast it is": one message at the end, not two.
16. A second message while Sparkie answers: "Still answering" once; it never runs later.
17. A forwarded message, a photo, an edited message, a message 6 minutes old: a fixed line or nothing; no model request. 5,000 characters: cut to 4,000.
18. A token-shaped message: the fixed line; not in `chats.json`.

Tiers
19. "undo the update" from Telegram: no rollback in the audit; no inline button; a press of that choice from Telegram is refused; on the page without the passkey 428, with it the undo runs. (Fails on today's guard.)
20. "remember that Spark 3 is the coding box": `memory.json` unchanged; the tools offered on that turn lack the four; a scripted model that calls `remember`, `forget_memory`, `save_workflow` or `forget_workflow` anyway gets an owner-only question and nothing changes.
21. Stopping something started outside the console: text only on Telegram; a press is refused.
22. Owner's pause on: a change from Telegram is refused in fixed words; a lookup and `/status` still answer.
23. With the hourly limit at 3: the 4th change from Telegram trips the pause.

Injection
24. The owner asks "why did it fail"; the scripted model reads a log that says to start a model and calls `start_model`: a button, no start.
25. A reply with a link: previews off. A reply that echoes the bot token or an `hf_` key: `[hidden]`.
26. A container whose name reads like an instruction: quoted and cut in the result line; no model request when it is sent.

Flood
27. 500 stranger updates, then one owner message: answered; no send to strangers; `telegram.json` written a bounded number of times; `/health` answers throughout.
28. 30 owner messages in a minute: at most 20 accepted, one "Too many messages" line, one turn at a time; a page chat answers during it.
29. Ten results in an hour: six messages.
30. The mock answers 429 with `retry_after` 2: one wait, one send; never over 20 sends a minute.

Failures
31. 401 on `getUpdates`: state "token stopped working"; polling stops; `GET /telegram` and `sparkie_setup` say so; a new token resumes.
32. 409: backs off; state "in use elsewhere"; `deleteWebhook` is never called by the loop.
33. Telegram down, then back: backoff; `/health` fine; the waiting message is answered once.
34. SIGTERM during a slow answer: after the restart one "restarted while I was answering" line; the message is not run again.
35. An operation started from Telegram and cut off by a restart: one line after the restart.
36. The brain stopped: the fixed line; `/status` answers with no model request.
37. A second copy of the service on the same port: the mock never sees two open polls.
38. `DELETE /telegram`, and `/unpair`: the secrets entry is gone, polling stops, a later owner message gets silence.

Source and switches (`test/build.test.mjs`)
39. `api.telegram.org` appears only in `21-telegram.mjs`; the send call appears only in `tell`'s sender; `SPARK_CONSOLE_TELEGRAM_API` and `SPARK_CONSOLE_SECRETS_FILE` are read only behind `ALL_LOCAL`; under ALL_LOCAL without them no call is made.

Watches (B)
40. "tell me here when the download finishes": a reply naming it and 24 hours; one message at the end; the row is gone.
41. Spark 3 offline 20 seconds: nothing. Offline past the limit: one message. Offline, back, offline: still one.
42. A watch past its end: nothing, and nothing says it ended. An 11th watch is refused.
43. "stop telling me about gemma" with gemma running: the watch is removed and gemma is still running; `stop_model` and `cancel_operation` were not called.
44. `stop_telling` while paused, and by `POST /actions`: works.
45. Telegram down when a watch fires: the row stays and the message goes out once Telegram is back.
46. `tell_me` after the turn read a log: a button. By an agent key: `[not_allowed]`. `POST /actions/tell_me`: refused. `save_workflow` with a `tell_me` step: refused.
47. A restart with a watch live: still listed; fires once.
48. "tell me what's running" and "tell me if I should stop gemma": no watch.

Edits to existing tests: `test/door.test.mjs:459` gains the bot-token shape; `test/sparkie.test.mjs` gains the build question (2.9); tool lists and counts as in section 4.

## 6. Rule and contract text

### R32 (for `docs/architecture.md`, under Shipping, after R31)

| Rule | Why | Where | Check |
|---|---|---|---|
| **R32.** Telegram (2026-11-11): the console polls Telegram from Spark 2 and never opens a route for it; only one loop polls, started after the local port is bound, and a 409 backs off. An update counts only from the paired private chat and user id; everyone else gets silence. The words go through `sparkieTurn` with `ctx.channel`, so R25 holds; a press or typed yes from Telegram runs as via `telegram`, never `page`, and never sets `ownerConfirmed`. Any guard that treats a session as "not on the tailnet" treats a channel the same. Actions in `PAGE_ONLY` (`undo_update`, memory, saved workflows, and any later action that changes Sparkie's code, skills, settings, secrets or connectors, or installs) never run from a channel: they become an owner-only button, pressed on the page with the passkey. No action may change access, keys, passkeys or devices. `tell()` is the only sender and sends only a reply, the result or carry-on of work started in that chat, or a watch the owner set: plain text, previews off, masked, results and watches from fixed templates with no error, log, address or secret. The bot token and the chat binding live only in `~/.config/spark-console/secrets.json` (0600), outside the state folder, are typed only on the passkey page, and appear in no result, log, event or audit line. `SPARK_CONSOLE_TELEGRAM_API` and `SPARK_CONSOLE_SECRETS_FILE` need `SPARK_CONSOLE_ALL_LOCAL=1`. Telegram can always be removed without the passkey and is never needed to sign in. | A stolen Telegram session or SIM swap must not become the owner on the page, undo a fix, plant memory or lock the owner out; nothing leaves the house that the owner did not ask for. | 21-telegram.mjs (`tgCall`, the loop, pairing); 20-tell.mjs (`tell`, `mayTell`); 03-secrets.mjs; 16-actions.mjs (`PAGE_ONLY`, `runAction`); 18-workflows.mjs (`undo_update`); 14-chats.mjs (`sparkieTurn`, `runChoice`) | test: telegram.test.mjs; build.test.mjs (host name and sender in one place) |

Other map edits in the same change: 32 parts, 15 changes after B; a Telegram node on the diagram (outbound from the service to WEB, into CHAT); section 4 rows for the secrets file, `telegram.json`, `watches.json`; section 6 "A state file" no longer says there is no secret store, and "An outbound connection" names the one exception to "never send fleet or personal data out"; R6's list, R7 (token pattern) and R30's switch list.

### `docs/contract.md`

- **4.10**, new paragraph at the end: "*(2026-11-11)* **Telegram.** The owner can also talk to Sparkie from Telegram on any phone or laptop, with no Tailscale there. One private chat is paired with a one-time code from the passkey page; nobody else is answered. Everyday requests work as in the owner's chat. Going back a build and changes to Sparkie's memory or saved workflows wait as a button in Spark Console, with the passkey; access, keys, passkeys and devices are never changed from Telegram. The chat shows in Spark Console like any other. Disconnecting needs no passkey, and Telegram is never needed to sign in (8.3). Members don't get it. Telegram can read bot chats; whether to use it on a work device is the owner's call."
- **8.7**, one bullet: "*(2026-11-11)* from Telegram: going back a build, and changing Sparkie's memory or saved workflows."
- **8.12**, add: "*(2026-11-11)* One outside service is spoken to on purpose once the owner connects it: Telegram's Bot API, outbound from Spark 2 only. What leaves is what 13 allows, to the owner's paired chat only, and each send is on the record (its kind and size, not its text)."
- **9.16**, replace "Nothing is pushed to the phone." with: "It is not sent to Telegram: a digest is not a reply, a result of work started there, or a watch (13). A watch is separate: "tell me when the download finishes" brings one message, once, where the owner asked."
- **13**, replace the first bullet with: "voice, and any message the owner didn't ask for. *(changed 2026-11-11)* Sparkie may message the owner's paired Telegram chat with exactly three things: a reply to a message sent there, the result of work started there, and a watch the owner set. Never heals, crashes nobody asked about, sign-ins, notices or digests (9.16)."
- **T78** keeps "nothing is pushed". New acceptance rows for tests 8, 11, 19 and 40 above.

## 7. Owner steps

1. In Telegram: Settings, Privacy and Security, turn on Two-Step Verification. Without it a SIM swap is enough to become you there.
2. Message @BotFather: `/newbot`, pick a name, copy the token. Then `/setjoingroups` and choose Disable.
3. In Spark Console at the main address: Access, Telegram, paste the token, tap the passkey.
4. Tap the link (or scan the QR) it shows, then Start in Telegram. The bot says "Paired with Spark Console."
5. Say yes to the contract changes in section 6 (13 is the one that reverses an earlier "not wanted").

If the phone is lost: Disconnect under Access from any signed-in device, or send `/unpair` from another Telegram device; then end that session in Telegram's Devices list.

## 8. Open questions for the owner

1. **"Remember…" from Telegram.** As designed it waits as a button in Spark Console, because a planted line outlives a stolen phone. The other choice is to let it through like on the page. Recommend: keep it owner-only for now, and revisit once memory lines record where they came from.
2. **Work devices.** Nothing here goes around NVIDIA's filter: the device talks to Telegram, and Spark 2 fetches from Telegram. But fleet facts then pass through Telegram, readable by Telegram, on a work device. Recommend: personal phone only until you have checked NVIDIA's rules.
3. **A quiet link.** Should Telegram drop to look-only when the passkey has not been used anywhere for 30 days, so a forgotten pairing cannot change the fleet? Recommend: not now. The tiers, the pause and two-step verification cover it, and it would surprise you at a bad moment.

## 9. As built (2026-11-11, install A)

Built on Opus 5.5 as designed, with the owner's three open questions taken at their recommendations (memory from Telegram waits in Spark Console; personal phone only until NVIDIA's rules are checked; no automatic look-only). Differences from the design:

- `undo_update` from Telegram asks its own owner-only question (it names the build it would go back to); the other four page-only actions get the generic one from `runAction`. Both are on the audit with `channel: 'telegram'`.
- The page's Telegram panel is under Access → Agents, below the agent keys.
- The limits on messages in and out can be raised on the stand-in fleet only (`SPARK_CONSOLE_TELEGRAM_LIMITS`, needs ALL_LOCAL); the flood tests run on a fleet of their own with the real limits.
- Not built yet: watches (`tell_me`, `stop_telling`), install B. Test cases 12 (a failed start's line) and 23 (the hourly breaker from Telegram) are covered by the templates and the existing breaker tests, not by new ones.

Tests: `test/telegram.test.mjs`, 26 cases on a stand-in Bot API (`test/mock/telegram.mjs`).

## 10. Review of the build (Fable 5.2) and what changed

Nothing high. Fixed, all nine:
1. **Medium.** `GET /telegram` returned the live pairing code. The code now comes only in the answer to the passkey-confirmed `PUT` or `POST`; the page keeps it and checks every few seconds until the chat is paired.
2. **Medium.** A carry-on turn that couldn't start lost the held results. `continueTask` now sends them when the turn throws.
3. **Medium.** `AbortSignal.any` needs a newer Node than the installer accepts. The signals are now combined by hand.
4. **Medium.** Disconnecting could fail on a bad write, or claim success when the file was unreadable. It now turns Telegram off in memory at once, and says `forget-failed` with what to remove by hand. The "Disconnected" line goes only after the write.
5. **Low.** Stale restart lines. Only work started in a chat is tagged, and a job's end always clears it.
6. **Low.** A held line was stranded by a new message. A direct result now takes held lines with it.
7. **Low.** A reconnect mid-batch kept the old bot's offset. The batch stops once the loop is told to stop.
8. **Low.** Saved-workflow steps dropped the channel. Steps now carry it, so `PAGE_ONLY` holds inside them.
9. **Low.**
   - Pairing keeps its code if the write fails.
   - A turn that can't start says why.
   - A reply dropped by the minute limit is on the audit.

Added in the same build at the owner's request (rule R33):
- **Recovery codes.** Ten one-time codes, made with the passkey and kept as hashes in the secrets file.
- **A fresh device's own passkey.** A browser just signed in with a recovery code or a code may add its own passkey once, within 15 minutes.
- **A clearer sign-in screen.** It now says when a browser reaches Spark Console over the internet even with Tailscale on (iCloud Private Relay, secure DNS) instead of waiting forever. `/whoami` gains `via`.

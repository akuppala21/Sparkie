/* ───────── the owner's words: /status, /pause, /restart sparkie, /stop, /undo update, /help (round two, 2026-11-11) ───────── */
// Area: safety        Rules: R34        Tests: words.test.mjs
// Owns: none
// Timers: none        Wakes: none
// Typed as the whole message in the owner's own page chat, they're answered by code before any model call, so they work
// with Sparkie's model down or stuck (docs/analysis-2026-11-11/10-round-two-report.md, item 1; contract 8.13). They are
// not tools: no agent, no /mcp or /v1, no carry-on turn. They can only look, pause agents' changes, bring back the
// brain's own container (restart it, or start it again when it is stopped or gone: the same container, or the saved
// setup; never another model), end Sparkie's answer in that chat (/stop), or go back a build. /undo update is the one
// word that runs an action (undo_update, through runAction as the page, so that action's own guard decides, R31).
// In the paired Telegram chat (21-telegram.mjs) /status, /pause, /restart sparkie, /stop and /help work too; /undo
// update never does there. Resuming is never a word (it needs the passkey, or the file by hand). On the page each answer
// is saved as one Spark Console notice quoting the word, so Sparkie later reads it as data.
const OWNER_WORDS = ['/status', '/pause', '/restart sparkie', '/stop', '/undo update', '/help'];
// The whole message, trimmed and lowercased ("/restart_sparkie" too); "/pause now" or "please /pause" is not a word.
function ownerWord(text) {
  const t = String(text).trim().toLowerCase().replace(/_/g, ' ');
  return t.length <= 40 && OWNER_WORDS.includes(t) ? t : null;
}
const BRAIN_WORD_MIN_UP_MS = 10 * 60000;
// With Sparkie's own model not answering, an owner's one-line message starting with "/" that isn't a word gets /help
// instead of a failed turn. With it answering, or chat routed to another model, such a message goes to Sparkie.
async function nearMissWord(text) {
  const t = String(text).trim();
  if (!t.startsWith('/') || t.length > 40 || t.includes('\n') || chatTarget()?.kind !== 'main') return null;
  // (longer than the status check's own 3-second look at the brain, so a frozen brain still counts as not answering)
  const late = Symbol('late');
  const m = await Promise.race([recentMain(), sleep(6000).then(() => late)]).catch(() => null);
  // A look that didn't come back in time means Sparkie's model isn't answering promptly either (a frozen brain holds the
  // look's own request): /help, which is a fine answer to a mistyped word even when the model was only slow.
  if (m === late) return '/help';
  return m?.configured && !(m.state === 'running' && m.healthy) ? '/help' : null;
}
// Where Spark Console itself runs (its settings file is there), in words.
const consoleSparkWords = () => { const n = NODES.find(x => x.host === 'local'); return n ? `on ${sparkName(n)}` : 'on the Spark that runs Spark Console'; };

// Where things stand, from Spark Console's own record: no model call, never waits on another Spark (the brain check is
// capped at 8 seconds). Telegram's /status is the same text.
async function statusText() {
  let brain = 'not checked';
  try {
    const m = await Promise.race([recentMain(), sleep(8000).then(() => null)]);
    brain = !m ? 'not checked (slow to answer)' : !m.configured ? 'not set up' : !m.online ? 'not checked (its Spark didn’t answer)'
      : m.state !== 'running' ? 'stopped' : m.healthy ? 'running, and its server responds' : 'running, but its server doesn’t respond';
  } catch {}
  const chat = chatTarget(), s = agentSettings();
  const online = NODES.filter(n => !knownOffline(n)).map(n => sparkName(n));
  const running = [...jobs.values()].filter(j => j.status === 'running').length;
  // What is waiting on the owner (20-needs.mjs): the same lines as fleet_status's needsOwner, right after Sparkie's own.
  const needs = needsLines();
  return maskSecrets([`Sparkie: ${brain}.`,
    chat?.kind === 'endpoint' ? `Sparkie’s chat runs on ${String(chat.title || chat.model).slice(0, 80)} right now, not on its own model.${chat.node && nodeById(chat.node) && knownOffline(nodeById(chat.node)) ? ' Its Spark isn’t reachable, so chat can’t answer.' : ''}` : null,
    needs.length ? `Needs you:\n${needs.map(t => `- ${t}`).join('\n')}` : 'Needs you: nothing.',
    `Sparks online: ${online.length ? online.join(', ') : 'none'}.`, `Operations running: ${running}.`, `Spark Console build ${BUILD}.`,
    `Agents’ changes: ${s.halted ? (s.autoPaused ? 'paused automatically' : 'paused') : 'on'}.`,
    `Open to the internet: ${funnelOn === null ? 'not known' : funnelOn ? 'yes' : 'no'}.`].filter(Boolean).join('\n'));
}

function pauseWord(via) {
  const was = agentSettings(), already = was.halted && !was.autoPaused;
  setAgentSettings({ halted: true, autoPaused: false });
  audit({ via, actor: 'owner', action: 'agent-settings', args: { halted: true, word: '/pause' }, ok: true });
  if (!already) fleetEvent({ type: 'operation', operation: 'agents paused', status: 'completed', by: 'owner' });
  // (on Telegram: no file path, and it's never resumed from there, R32)
  return `${already ? 'Already paused.' : 'Paused.'} Operations started by Sparkie, an agent, Telegram or the API stop at their next step and put back what they changed. Models already running stay up. Self-healing is off while paused.
${via === 'telegram' ? 'To resume: in Spark Console, your account menu → Agents and Telegram, with your passkey. It can’t be resumed from Telegram.' : `To resume: your account menu → Agents and Telegram, with your passkey. Or by hand ${consoleSparkWords()}: set "halted": false in ${SETTINGS_FILE}.`}`;
}

async function restartWord(via) {
  const chat = chatTarget();
  if (chat?.kind === 'endpoint') return `Sparkie’s chat runs on ${String(chat.title || chat.model).slice(0, 80)} right now, so restarting Sparkie’s own model wouldn’t help. Nothing was changed.`;
  if (!MAIN) return 'Sparkie’s model isn’t set up. Nothing was changed.';
  const busyWords = `Sparkie’s model is being started, stopped or switched, or something else is changing on ${sparkName(mainNode() || { id: MAIN.node })}, right now. Nothing was changed. /status shows where it stands.`;
  if (brainRestarting) return 'Sparkie’s model is already restarting. /status shows when its server responds.';
  if (mainBusy() || busySparks.has(MAIN.node)) return busyWords;
  const m = await mainStatus().catch(() => null);
  if (!m?.online) return `Couldn’t check Sparkie’s model on ${sparkName(mainNode() || { id: MAIN.node })}. Nothing was changed.`;
  const x = { spark: MAIN.node, container: MAIN.container };
  // Not running: stopped (exited, created), or gone from Docker (a failed switch, or removed by hand). The saved setup
  // starts again through the same job as the page's Start, which removes the old container first (a stopped one keeps
  // its /tmp, where a stale rendezvous file can hang the load: review, 2026-11-12), and everything else on that Spark
  // keeps running (the word never stops anything to make room).
  if (m.state !== 'running') {
    const gone = m.state === 'missing';
    let job;
    try {
      const keep = (await mainPlan()).steps.filter(s => s.kind === 'stop').map(s => s.container);
      job = claimed([MAIN.node], 'starting Sparkie’s model', () => newJob('main-start', { node: MAIN.node, model: MAIN.title || MAIN.served }));
      runJob(job, j => startMain(j, keep));
    } catch (e) { return `Sparkie’s model ${gone ? 'is gone from Docker' : 'isn’t running'}, and it can’t be started right now: ${String(e.message).split('\n')[0].slice(0, 300)} Nothing was changed.`; }
    audit({ via, actor: 'owner', action: 'start_sparkie', args: { ...x, word: '/restart sparkie' }, ok: true, outcome: 'started', operation: job.id });
    return `Sparkie’s model ${gone ? 'was gone from Docker' : 'wasn’t running'}, so it’s starting again from its saved setup (${MAIN.title || MAIN.served}). Nothing else on ${sparkName(mainNode() || { id: MAIN.node })} is stopped for it. It takes a few minutes to load; /status shows when its server responds.`;
  }
  // Running: Docker's own start time, so the limit holds across a console restart: a model still loading isn't restarted.
  const started = Date.parse(m.startedAt), upMs = Number.isFinite(started) ? Date.now() - started : 0, mins = Math.max(1, Math.round(upMs / 60000));
  if (upMs < BRAIN_WORD_MIN_UP_MS) return `${Number.isFinite(started) ? `Sparkie’s model started ${mins} minute${mins === 1 ? '' : 's'} ago and may still be loading` : 'Docker didn’t say when Sparkie’s model started, so it may still be loading'}; a restart would make that longer. Nothing was changed. Try again once it has run 10 minutes.`;
  if (brainRestarting) return 'Sparkie’s model is already restarting. /status shows when its server responds.';
  if (mainBusy() || busySparks.has(MAIN.node)) return busyWords;
  fleetEvent({ type: 'operation', operation: 'Sparkie’s model restarting', status: 'started', by: 'owner', spark: x.spark, container: x.container });
  // A restart takes a few minutes: it goes on after this answer.
  restartBrain().then(r => {
    if (!r) return;
    audit({ via, actor: 'owner', action: 'restart_sparkie', args: { ...x, word: '/restart sparkie' }, ok: r.code === 0, ...(r.code ? { error: maskSecrets((r.err || r.out).slice(0, 300)) } : {}) });
    fleetEvent({ type: 'operation', operation: 'Sparkie’s model restarted', status: r.code ? 'failed' : 'completed', by: 'owner', spark: x.spark, container: x.container });
  }).catch(e => console.error(`Restarting Sparkie’s model: ${e.message}`));
  return 'Restarting Sparkie’s model. It takes a few minutes to load again; /status shows when its server responds.';
}

// /stop: Sparkie's answer in this chat ends, and so does its carrying on with that request (stopTurn, 14-chats.mjs). It
// never cancels an operation and never stops a model.
function stopWord(conv) {
  if (conv && stopTurn(conv)) return 'Stopped. Sparkie’s answer in this chat ends here, and it won’t carry on with that request. Operations already started keep running and post their results here. No model was stopped. To stop an operation, ask Sparkie to cancel it.';
  return 'Sparkie isn’t answering in this chat and has nothing to carry on with, so there was nothing to stop. Operations and models are as they were.';
}

// Where every install puts the by-hand way back (deploy/go-back.sh, deploy/RECOVERY.txt).
const BY_HAND_DIR = `${homedir()}/.local/share/spark-console`;
// /undo update: the page's Undo update, typed. It is the undo_update action through runAction as the page, so that
// action's own guard decides (R31): on the owner's tailnet it runs; a device signed in over the internet gets the
// owner-only button, pressed here with the passkey. It is not a word on Telegram.
async function undoWord(viewer, conv) {
  let asked = null;
  try {
    const out = await runAction('undo_update', viewer, {}, { via: 'page', actor: 'owner', request: '/undo update', chat: conv.id, conv: conv.id, canChange: true, onQuestion: q => { asked = q; } });
    if (asked) return { reply: asked.question, choices: sparkieMessageChoices(asked) };
    return { reply: out?.note || 'Going back a build. Spark Console restarts in a moment.' };
  } catch (e) { return { reply: e.message }; }
}

function helpWord() {
  const lines = ['These work even when Sparkie can’t answer. Type the word alone:',
    '/status: where things stand, from Spark Console’s own record',
    '/pause: pause agents’ changes (resume in your account menu → Agents and Telegram, with your passkey)',
    '/restart sparkie: restart Sparkie’s model when it’s stuck, or start it again when it’s stopped',
    '/stop: end Sparkie’s answer in this chat and its carrying on; operations and models keep running',
    '/undo update: go back to the build from before the last update (Spark Console restarts; signed in from the internet, it asks for your passkey)',
    '/help: this list'];
  lines.push('', '/key NAME and then the key (HF_TOKEN, say, or GITHUB): give Sparkie a key once; it is kept by name and never shown. A heartbeat address from Healthchecks.io can be pasted as it is.');
  lines.push('', 'By hand, in a terminal:');
  if (MAIN) lines.push(`  restart Sparkie’s model (on ${sparkName(mainNode() || { id: MAIN.node })}): ${brainRestartCommand()}`);
  lines.push(`  go back a build (${consoleSparkWords()}): bash ${BY_HAND_DIR}/go-back.sh (other by-hand steps: ${BY_HAND_DIR}/RECOVERY.txt)`);
  lines.push(`  resume agents’ changes (${consoleSparkWords()}): set "halted": false in ${SETTINGS_FILE}`);
  return lines.join('\n');
}

// The page's chat route calls this for the owner's own chat (never one that carries `agent`). The answer comes back in
// the same event stream as Sparkie's, so the page needs nothing new.
async function answerOwnerWord(res, conv, word, via, typed = null, viewer = null) {
  const undo = word === '/undo update' ? await undoWord(viewer, conv) : null;
  const reply = undo ? undo.reply : word === '/status' ? await statusText() : word === '/pause' ? pauseWord(via)
    : word === '/restart sparkie' ? await restartWord(via) : word === '/stop' ? stopWord(conv) : helpWord();
  const head = typed ? `${String(typed).trim().slice(0, 40)}\nThat isn’t one of the words, and Sparkie’s model isn’t answering.` : word;
  const message = { role: 'assistant', content: `${maskSecrets(head)}\n${maskSecrets(reply)}`, createdAt: new Date().toISOString(), notice: true, word: true,
    ...(undo?.choices?.length ? { choices: undo.choices } : {}) };
  // (A full chat still gets the answer; it just isn't saved there.)
  if (conv.messages.length < LIMITS.messages) {
    conv.messages.push(message);
    conv.updatedAt = message.createdAt;
    saveChats();
  }
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', 'x-accel-buffering': 'no' });
  res.write(`data: ${JSON.stringify({ type: 'started' })}\n\n`);
  res.end(`data: ${JSON.stringify({ type: 'done', message })}\n\n`);
}

/* ───────── the owner's passkey: confirming changes to who has access ───────── */
// One portal for everyone: Tailscale says who you are (owner, member, or someone asking), and for the few changes to
// who has access (people, invites, agent keys and their rights, resuming paused agents) the owner also confirms with a
// passkey (Touch ID, Face ID, a phone or a security key). Each confirmation signs a one-time challenge bound to that
// exact request, so a program on the owner's device can't make those changes with Tailscale's identity alone. Until a
// passkey is set up, these changes need none (nothing can lock the owner out).
const PASSKEYS_FILE = `${STATE_DIR}/passkeys.json`;
function passkeys() {
  const v = readJson(PASSKEYS_FILE);
  if (!v && existsSync(PASSKEYS_FILE)) throw new HttpError(500, `${PASSKEYS_FILE} can’t be read. Fix it, or remove it to start over (then set up your passkey again).`);
  return Array.isArray(v?.keys) ? v.keys : [];
}
const savePasskeys = keys => writePrivate(PASSKEYS_FILE, { keys });
// Spark Console's one address (config.json's origin, and this machine's name as Tailscale reports it), and the domains
// a passkey can be made for: that address's host, and the tailnet's domain.
const passkeyOrigins = () => [...new Set([CONFIG.origin, selfOrigin].filter(o => /^https:\/\/[a-z0-9.-]+(:\d+)?$/.test(o || '')))];
function passkeyRpIds() {
  const ids = [];
  for (const o of passkeyOrigins()) {
    const host = new URL(o).hostname, parts = host.split('.');
    if (parts.length >= 4) ids.push(parts.slice(1).join('.'));
    ids.push(host);
  }
  return [...new Set(ids)];
}
// A passkey whose counter went backwards may have been copied. It's noted (Activity and the audit log), not refused:
// refusing could lock the owner out if it's their only passkey.
function counterNote(k) {
  audit({ via: 'page', actor: 'owner', action: 'passkey-counter-went-back', args: { passkey: k.name }, ok: false });
  fleetEvent({ type: 'notice', text: `Your passkey “${k.name}” reported a lower count than before. If you didn’t copy it to another device, remove it and set up a new one.` });
}
const challenges = new Map();
const actionHash = (method, path, body) => createHash('sha256').update(`${method} ${path} ${JSON.stringify(body ?? {})}`).digest('hex');
function newChallenge(viewer, purpose, hash = null) {
  for (const [id, c] of challenges) if (c.exp < Date.now()) challenges.delete(id);
  // When it's full, the oldest request makes way, so a new confirmation always gets through.
  while (challenges.size >= 150) challenges.delete(challenges.keys().next().value);
  const id = randomBytes(9).toString('hex'), challenge = passkey.b64url(randomBytes(32));
  challenges.set(id, { login: viewer.login, purpose, hash, challenge, exp: Date.now() + 3 * 60000 });
  return { challengeId: id, challenge };
}
// What a confirmation is for, in plain words, from the service itself: shown before the owner confirms, so the page
// can't pass one change off as another.
function describeChange(method, path, body = {}) {
  const who = id => accessList().members.find(u => u.id === id)?.login || 'someone';
  const perms = p => (p && typeof p === 'object' ? [`uses ${(p.nodeIds || []).map(id => sparkName(nodeById(id) || { id })).join(', ') || 'no Sparks'}`,
    p.deploy ? 'can run and stop models' : null, p.chat ? `chats with ${ASSISTANT_NAME}` : null, p.files && p.files !== 'none' ? `own files: ${p.files}` : null,
    p.sharedFiles && p.sharedFiles !== 'none' ? `shared files: ${p.sharedFiles}` : null].filter(Boolean).join('; ') : '');
  const member = path.match(/^\/access\/([a-f0-9]{16})$/), agent = path.match(/^\/agents\/([a-f0-9]{12})$/), pk = path.match(/^\/auth\/passkeys\/(.+)$/);
  const agentName = id => { try { return agentKeys().find(k => k.id === id)?.name || 'an agent'; } catch { return 'an agent'; } };
  const keyName = id => { try { return passkeys().find(k => k.id === id)?.name || 'a passkey'; } catch { return 'a passkey'; } };
  if (method === 'POST' && path === '/access') return `Give ${clean(body.login, 200)} access (${perms(body.permissions)})`;
  if (method === 'PUT' && member) return `Change ${who(member[1])}’s access to: ${perms(body.permissions)}`;
  if (method === 'DELETE' && member) return `Remove ${who(member[1])}’s access`;
  if (method === 'POST' && path === '/access/requests') return `${body.decision === 'approve' ? 'Approve' : 'Decline'} ${clean(body.login, 200)}’s request${body.decision === 'approve' ? ` (${clean(body.preset, 20)})` : ''}`;
  if (method === 'PUT' && path === '/access/invite') return body.url ? `Save the Tailscale share link ${clean(body.url, 400)}` : 'Remove the saved share link';
  if (method === 'POST' && path === '/agents') return `Create a key for a new agent, “${clean(body.name, 60)}”`;
  if (method === 'PUT' && agent) return [body.act === true ? `Let ${agentName(agent[1])} start, stop and restart models` : body.act === false ? `Make ${agentName(agent[1])} look-only` : null,
    body.internet === true ? `let ${agentName(agent[1])}’s key work from anywhere, without Tailscale` : body.internet === false ? `make ${agentName(agent[1])}’s key work on your tailnet only` : null].filter(Boolean).join(', ');
  if (method === 'PUT' && path === '/agents/settings') return [body.halted === false ? 'Resume agents’ changes' : body.halted === true ? 'Pause agents’ changes' : null,
    body.selfHeal === true ? 'turn on automatic restarts' : body.selfHeal === false ? 'turn off automatic restarts' : null].filter(Boolean).join(', ') || 'Change agent settings';
  if (method === 'DELETE' && pk) return `Remove the passkey “${keyName(pk[1])}”`;
  if (method === 'POST' && path === '/auth/passkey/register') return `Add a new passkey, “${clean(body.name, 60)}”`;
  if (method === 'POST' && path === '/auth/device/approve') {
    const d = deviceCodes.get(String(body.code || '').toUpperCase());
    return d ? `Let ${d.kind === 'terminal' ? 'a terminal' : 'a browser'} called “${d.name}” sign in as you (code ${d.userCode}, asked from ${d.from || 'an unknown address'})`
      : `Let the device with code ${clean(body.code, 12)} sign in as you`;
  }
  if (method === 'POST' && path === '/workflows/validate') return 'Validate the changed workflows: run each one’s check with a small model on Spark 3 or 4, then put things back';
  if (method === 'POST' && path === '/rollback') return 'Go back to the build installed before this one (Spark Console restarts)';
  if (method === 'POST' && path === '/auth/recovery') return 'Make 10 new recovery codes (the old ones stop working)';
  if (method === 'PUT' && path === '/telegram') return 'Connect a Telegram bot, so you can talk to Sparkie from Telegram once you pair your chat';
  if (method === 'POST' && path === '/telegram/pair') return 'Show a new code to pair your Telegram chat with Spark Console';
  if (method === 'PUT' && path === '/telegram/needs') return body?.on === true ? 'Let Spark Console send you one Telegram line when something new needs you (at most 3 a day)' : 'Stop the “needs you” lines on Telegram';
  if (method === 'PUT' && path === '/heartbeat') return 'Save your outside check’s address, so Spark Console sends it an empty request at hc-ping.com every 5 minutes';
  const chatGone = path.match(/^\/chats\/([^/]+)$/);
  if (method === 'DELETE' && chatGone) return `Delete the chat “${clean(chatData().conversations.find(c => c.id === chatGone[1])?.title || chatGone[1], 80)}”`;
  if (method === 'POST' && /^\/chats\/[^/]+\/choose$/.test(path)) {
    const c = pendingChoices.get(String(body.choice || ''));
    return c ? `${c.label}${c.args?.__validate ? ' (its first run, which validates it for Sparkie and agents)' : ''}` : 'Press a button in a chat';
  }
  const how = body.setup ? ` with recipe setup ${clean(body.setup, 40)}` : body.verified ? ' the way it ran before' : '';
  const stops = Array.isArray(body.stop) && body.stop.length ? `, stopping ${body.stop.map(x => clean(x, 160)).join(', ')}` : '';
  if (method === 'POST' && path === '/deploy') return `Deploy ${clean(body.model, 200)} on ${sparkName(nodeById(body.node) || { id: clean(body.node, 40) })}${how}${stops}${body.allowRemoteCode ? ', and let it run its own code' : ''}`;
  if (method === 'POST' && path === '/deploy/cluster') return `Deploy ${clean(body.model, 200)} across ${(Array.isArray(body.nodes) ? body.nodes : []).map(id => sparkName(nodeById(id) || { id: clean(id, 40) })).join(' + ')}${how}${stops}${body.allowRemoteCode ? ', and let it run its own code' : ''}`;
  const files = path.match(/^\/nodes\/([^/]+)\/files$/);
  if (method === 'POST' && files) {
    const where = `${clean(body.path, 1000)} (${body.area === 'shared' ? 'shared files' : 'your files'}) on ${sparkName(nodeById(files[1]) || { id: clean(files[1], 40) })}`;
    return body.operation === 'rename' ? `Rename ${where} to ${clean(body.destination, 1000)}` : `${body.operation === 'delete' ? 'Delete' : 'Change'} ${where}`;
  }
  return `${method} ${path}`;
}
function takeChallenge(id, viewer, purpose) {
  const c = challenges.get(String(id || ''));
  if (!c || c.exp < Date.now() || c.purpose !== purpose || c.login.toLowerCase() !== String(viewer.login).toLowerCase()) throw new HttpError(409, 'That passkey request expired. Try again.');
  challenges.delete(String(id));
  return c;
}
const passkeyNeeded = (kind, message) => Object.assign(new HttpError(428, message), { passkey: kind });
const mayNeedPasskey = path => /^\/(access|agents|auth)(\/|$)/.test(path) || /^\/deploy(\/cluster)?$/.test(path) || path === '/stop' || /^\/chats\/[^/]+(\/choose)?$/.test(path)
  || /^\/nodes\/[^/]+\/files$/.test(path) || path === '/workflows/validate' || path === '/rollback' || /^\/telegram(\/(pair|needs))?$/.test(path) || path === '/heartbeat';
// Each kind of request keeps its own size limit when the passkey check reads it first.
const bodyLimit = path => (path.startsWith('/agents') ? 4000 : path.startsWith('/telegram') || path === '/heartbeat' ? 2000 : path.startsWith('/auth') ? 50000 : /\/files$/.test(path) ? 400000 : 1e5);
// A deploy's stop list names something Spark Console didn't start (known to the watcher as not ours, or not known).
function stopsOutside(stop) {
  if (!Array.isArray(stop)) return false;
  const ours = new Set(Object.values(knowledge.workloads || {}).filter(w => w.byConsole).map(w => `${w.spark}/${w.name}`));
  return stop.some(x => !ours.has(String(x)));
}
// Which requests need the owner's passkey. Taking access away (removing a person or an agent, declining, pausing
// agents) never does.
function needsPasskey(method, path, body, haveKeys) {
  if (method === 'GET') return false;
  if (method === 'DELETE' && /^\/access\/[a-f0-9]{16}$/.test(path)) return false;
  if (method === 'POST' && path === '/access/requests' && body?.decision === 'decline') return false;
  if (/^\/access(\/|$)/.test(path)) return true;
  // A model that runs its own code could take over the Spark it runs on.
  if (method === 'POST' && (path === '/deploy' || path === '/deploy/cluster')) return body?.allowRemoteCode === true || stopsOutside(body?.stop);
  if (method === 'POST' && path === '/agents') return true;
  if (method === 'PUT' && /^\/agents\/[a-f0-9]{12}$/.test(path)) return true;
  if (method === 'PUT' && path === '/agents/settings') return !(body && Object.keys(body).length === 1 && body.halted === true);
  if (method === 'DELETE' && path.startsWith('/auth/passkeys/')) return true;
  if (method === 'POST' && path === '/auth/passkey/register') return haveKeys;
  // Deleting anything is the owner's, with their passkey (docs/contract.md 8.2, 8.7): a file, a chat.
  if (method === 'POST' && /^\/nodes\/[^/]+\/files$/.test(path)) return body?.operation === 'delete';
  if (method === 'DELETE' && /^\/chats\/[^/]+$/.test(path)) return true;
  // Letting a new device in (4.10). Validation runs, "Test the changes" and going back to the last good build no longer
  // need it (v3.1, 6.3 and 8.7): the owner wants agents to do those by themselves.
  if (method === 'POST' && path === '/auth/device/approve') return true;
  // New recovery codes (they sign a browser in from anywhere).
  if (method === 'POST' && path === '/auth/recovery') return true;
  // Connecting Telegram, and each pairing code (R32). Disconnecting never needs it.
  if ((method === 'PUT' && path === '/telegram') || (method === 'POST' && path === '/telegram/pair')) return true;
  // Switching the needs-me line on (H5); off never needs it.
  if (method === 'PUT' && path === '/telegram/needs') return body?.on === true;
  // Saving the outside heartbeat's address (20-beat.mjs, R32); removing it never needs it.
  if (method === 'PUT' && path === '/heartbeat') return true;
  return false;
}
// Members never write hidden files or folders, nor does a terminal signed in from the internet: .git/hooks,
// .vscode/tasks.json or .envrc run code when a folder is opened on a Spark.
async function refuseHiddenFiles(req, path, terminal = false) {
  if (req.method !== 'POST' || !/^\/nodes\/[^/]+\/files$/.test(path)) return;
  const body = await readBody(req, bodyLimit(path));
  if (!['write', 'mkdir', 'rename'].includes(body?.operation)) return;
  const hidden = p => String(p || '').split(/[\\/]+/).some(part => part.startsWith('.'));
  if (hidden(body.path) || hidden(body.destination)) throw new HttpError(403, terminal ? 'Hidden files and folders (names starting with a dot) aren’t changed from a terminal signed in from the internet: use the page, or Tailscale.'
    : 'Hidden files and folders (names starting with a dot) can only be changed by the owner.');
}
// The owner confirms with a one-time challenge for exactly this change, signed by one of their passkeys. Until a
// passkey is set up, these changes need none.
async function passkeyGate(req, path, viewer) {
  if (req.method === 'GET' || !mayNeedPasskey(path)) return;
  const body = await readBody(req, bodyLimit(path));
  // An automatic pause is undone without a passkey (the owner can always get agents going again).
  if (req.method === 'PUT' && path === '/agents/settings' && body && Object.keys(body).length === 1 && body.halted === false && agentSettings().autoPaused) return;
  // Stopping something started outside Spark Console (an owner-only question's answer) is the owner's own, with their
  // passkey (docs/contract.md 8.7). A validation run no longer is (v3.1).
  const pressed = /^\/chats\/[^/]+\/choose$/.test(path) ? pendingChoices.get(String(body?.choice || '')) : null;
  const ownerQuestion = Boolean(pressed?.ownerOnly);
  // The passkey file is only read for requests that may need it, so pausing or removing an agent always works.
  // Going back a build from a device signed in over the internet needs the passkey too: a stolen cookie mustn't be able
  // to undo a security fix while the console is public. From the tailnet it doesn't (v3.1).
  const rollbackFromInternet = Boolean(viewer.session) && req.method === 'POST' && path === '/rollback';
  // A browser just signed in with a recovery code, or let in with a code, adds its own passkey once without another.
  if (req.method === 'POST' && path === '/auth/passkey/register' && newDevicePasskeyOpen(viewer)) return;
  if (!ownerQuestion && !rollbackFromInternet && !needsPasskey(req.method, path, body, true)) return;
  const keys = passkeys();
  if (!keys.length) return;
  const raw = req.headers['x-spark-passkey'];
  if (!raw) throw passkeyNeeded('confirm', 'Confirm it’s you with your passkey.');
  let a;
  try { a = JSON.parse(Buffer.from(String(raw), 'base64url').toString('utf8')); } catch { throw new HttpError(400, 'That passkey answer couldn’t be read.'); }
  const c = takeChallenge(a?.challengeId, viewer, 'confirm');
  if (c.hash !== actionHash(req.method, path, body)) throw new HttpError(409, 'That passkey confirmation was for a different change. Try again.');
  let ok;
  try { ok = passkey.verifyAssertion(a, { challenge: c.challenge, origins: passkeyOrigins(), stored: keys }); } catch (e) { throw new HttpError(403, e.message); }
  const k = keys.find(x => x.id === ok.id);
  Object.assign(k, { signCount: ok.signCount, lastUsedAt: new Date().toISOString() });
  savePasskeys(keys);
  if (ok.counterWentBack) counterNote(k);
  audit({ via: 'page', actor: 'owner', action: 'passkey-confirmed', args: { method: req.method, path, passkey: k.name }, ok: true });
  if (viewer.session?.id) markPasskey(viewer.session.id);
}


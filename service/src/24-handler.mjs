/* ───────── the public page ───────── */
// Area: ways in
// Rules: R1, R3, R4, R5, R8, R9, R11, R22, R27, R30, R33, R34, R38, R40
// Tests: fleet.test.mjs, api.test.mjs, internet.test.mjs, passkey.test.mjs
// Owns: none
// Timers: none        Wakes: none
// Anyone may see the fleet's hardware and load, from the internet too. Internet (Funnel) traffic carries no Tailscale
// identity, so it never gets past the sign-in check: this is the only thing it can read. Nothing here names a model,
// container, job, chat, person, hostname or address.
const PUBLIC_EVERY = 5000;
let publicCache = null;
const publicHits = new Map();
function publicFleet(req) {
  if (overLimit(publicHits, clientAddress(req) || '-', 60000, 90)) throw new HttpError(429, 'Too many requests. Try again in a minute.');
  return publicValue();
}
function publicValue() {
  const now = Date.now();
  if (publicCache && now - publicCache.at < PUBLIC_EVERY) return publicCache.value;
  const s = statusCache?.value;
  const value = {
    updatedAt: s?.updatedAt || null,
    sparks: NODES.map(n => {
      const x = s?.nodes?.find(y => y.id === n.id), on = Boolean(x?.reachable && x.state === 'online');
      const pick = k => (on && typeof x[k] === 'number' && Number.isFinite(x[k]) ? x[k] : null);
      return { id: n.id, name: sparkName(n), online: on, gpuUtilization: pick('gpuUtilization'), memoryTotalGiB: pick('memoryTotalGiB'),
        memoryFreeGiB: pick('memoryFreeGiB'), gpuPowerWatts: pick('gpuPowerWatts'), temperature: pick('temperature') };
    }),
    links: (lastCheck?.pairs || []).filter(p => p.fastLink === 'full').map(p => [p.a, p.b]),
    // Where Sign in on the public page leads: the main address, open to the internet (it works with Tailscale off, on
    // the phone: 2026-11-11) or on the tailnet.
    console: funnelOn && /^https:\/\//.test(consoleOrigin()) ? `${consoleOrigin()}/`
      : /^https:\/\/[a-z0-9.-]+\.ts\.net(:\d+)?$/.test(consoleOrigin()) ? `${consoleOrigin()}/` : null,
  };
  publicCache = { at: now, value };
  return value;
}

const PUBLIC_ROUTES = ['/public/fleet', '/public/ask', '/whoami', ...SIGNIN_ROUTES];
const clientAddress = req => String(req.headers['x-forwarded-for'] || '').split(',').pop().trim().replace(/^\[|\]$/g, '');
function requestGate(req, path) {
  const viaSocket = !req.socket.remoteAddress;
  if (!viaSocket && tcpApiOff) throw new HttpError(403, 'Spark Console’s API is only served through Tailscale.');
  // An app's page opened through the app door (this name's port 10000, R40) never reaches the API, not even to read.
  if (req.headers.origin && doorHosts().some(h => req.headers.origin === `https://${h}`)) throw new HttpError(403, 'Apps opened through the app door can’t use Spark Console’s API.');
  // From the internet: the public routes, or a device the owner signed in, or an agent with its key (4.10).
  if (req.headers['tailscale-funnel-request'] && !PUBLIC_ROUTES.includes(path) && !carriesCredential(req)) throw new HttpError(401, 'Sign in to see more.');
  const blocked = ALL_LOCAL ? sparkAddresses() : blockedAddresses;
  if (!blocked && !PUBLIC_ROUTES.includes(path)) throw new HttpError(503, 'Spark Console is starting. Try again in a few seconds.');
  const from = clientAddress(req);
  if (from && blocked?.has(from) && !path.startsWith('/v1/')) {
    throw new HttpError(403, 'Requests from the Sparks themselves can’t act as a person. Open Spark Console from your own device.');
  }
}

const handler = async (req, res) => {
  const url = new URL(req.url, 'http://local');
  const path = url.pathname.replace(/^\/console\/api(?=\/|$)/, '') || '/';
  try {
    if (path === '/health') {
      return send(res, 200, req.headers['tailscale-funnel-request'] ? { ok: true } : { ok: true, version: VERSION, build: BUILD, startedAt: STARTED_AT, node: process.version, modelsHost: CONFIG.modelsHost,
        jobsRunning: [...jobs.values()].filter(j => j.status === 'running').length, replying: replying.size, apiLocked: tcpApiOff,
        agentsPaused: agentSettings().halted === true, internet: funnelOn, lastBackup, sparksOnline: NODES.filter(n => !knownOffline(n)).length, telegram: tg.state,
        workflows: Object.fromEntries(WORKFLOWS.map(w => [w.id, workflowStatus(w.id).state])) });
    }
    requestGate(req, path);
    if (req.method === 'GET' && path === '/public/fleet') return send(res, 200, publicFleet(req));
    let viewer = await viewerFor(req);
    // Who's here: someone on the list, someone on the tailnet who isn't (they can ask), or a visitor from the internet.
    const funnel = Boolean(req.headers['tailscale-funnel-request']);
    const tailnetLogin = !funnel && LOGIN_RE.test(String(req.headers['tailscale-user-login'] || '')) ? String(req.headers['tailscale-user-login']).slice(0, 200) : null;
    if (req.method === 'GET' && path === '/whoami') {
      const asked = !viewer && tailnetLogin ? (ownAccess()?.requests || []).some(r => r.login === tailnetLogin) : false;
      // signin: this address can sign the owner in with a passkey (4.10). session: how this device is signed in.
      const signin = !viewer && !tailnetLogin && Boolean(accessList().owner) && (() => { try { return passkeys().length > 0; } catch { return false; } })();
      // recovery: a recovery code would sign this visitor in right now (R33), passkey on file or not: at least one unused
      // code that can be read. Yes or no only, never how many. The sign-in page shows "Use a recovery code" from it (F18).
      const recovery = !viewer && !tailnetLogin && Boolean(accessList().owner) && recoveryView().left > 0;
      // via: how this request arrived. A browser on a device with Tailscale on can still arrive from the internet (its own
      // name lookup: iCloud Private Relay, secure DNS), and the page says so instead of waiting for Tailscale.
      return send(res, 200, { login: viewer?.login || tailnetLogin, access: viewer ? viewer.role : 'none', asked, signin, recovery, session: viewer?.session?.kind || null,
        via: funnel ? 'internet' : 'tailnet' });
    }
    // Signing a device in (a passkey, or a code the owner lets in), and signing out.
    if (SIGNIN_ROUTES.includes(path)) return await signinRoute(req, res, path, viewer);
    // An agent with its own key, from anywhere (4.10): the agent door and the model address only, and only when the
    // request has no Tailscale identity (someone else's identity with the owner's key is still refused).
    if (!viewer && !tailnetLogin && (path === '/mcp' || path.startsWith('/v1/'))) viewer = keyViewer(req);
    if (req.method === 'POST' && path === '/access/ask') {
      if (viewer) throw new HttpError(409, 'You already have access.');
      if (!tailnetLogin) throw new HttpError(401, 'Connect Tailscale on this device, signed in as yourself, then ask.');
      if (req.headers['x-spark-console'] !== '1' || !sameOrigin(req)) throw new HttpError(403, 'Cross-site request blocked.');
      const body = await readBody(req, 4000);
      askAccess(tailnetLogin, clean(req.headers['tailscale-user-name'], 80).replace(/@/g, ' '), clean(body?.note, 200), true, tailnetLogin);
      return send(res, 202, { ok: true });
    }
    // From the public page: no identity, so they say which email they'll use with Tailscale.
    if (req.method === 'POST' && path === '/public/ask') {
      if (viewer || tailnetLogin) throw new HttpError(409, 'You’re signed in to Tailscale already: reload the page to ask from there.');
      if (req.headers['x-spark-console'] !== '1' || !sameOrigin(req)) throw new HttpError(403, 'Cross-site request blocked.');
      const body = await readBody(req, 4000), email = clean(body?.email, 200).toLowerCase();
      if (!LOGIN_RE.test(email)) throw new HttpError(400, 'Enter the email you sign in to Tailscale with.');
      askAccess(email, clean(body?.name, 80).replace(/@/g, ' '), clean(body?.note, 200), false, clientAddress(req) || '-');
      return send(res, 202, { ok: true });
    }
    if (!viewer) throw new HttpError(401, funnel ? `Sign in to Spark Console first. (${authProblem || 'not signed in'})`
      : `Open Spark Console from your tailnet, signed in as someone the owner added. (${authProblem || 'unknown'})`);
    // Your own agents, through the agent door (MCP): they bring their own key, not the page's header.
    if (path === '/mcp') return await mcpDoor(req, res, viewer);
    const owner = viewer.role === 'owner', chatRoute = /^\/chats(\/|$)/.test(path), filesRoute = /^\/nodes\/[^/]+\/files$/.test(path);
    const agentRoute = path.startsWith('/v1/'), editorRoute = path.startsWith('/connect/');
    if (req.method !== 'GET' && !editorRoute) {
      if (agentRoute) {
        // Agents don't send the console's header. A page on another site would send its Origin, and requiring JSON
        // makes browsers ask first (CORS), which this service never allows.
        if (!String(req.headers['content-type'] || '').startsWith('application/json') || !sameOrigin(req)) throw new HttpError(403, 'Send JSON from an agent or tool, not from a web page on another site.');
      // The page's changes come from a browser, which always names its Origin on these requests.
      } else if (req.headers['x-spark-console'] !== '1' || !req.headers.origin || !sameOrigin(req)) throw new HttpError(403, 'Cross-site request blocked.');
      // Members with the go-ahead may run and stop models on their own Sparks; each route checks which Sparks.
      const runRoute = ['/deploy', '/deploy/cluster', '/stop', '/recipes/download'].includes(path);
      if (!owner && runRoute && !canManage(viewer)) throw new HttpError(403, 'Running and stopping models isn’t enabled for your account. Ask the owner.');
      if (!owner && !chatRoute && !filesRoute && !agentRoute && !runRoute) throw new HttpError(403, 'Only the owner can change that.');
    }
    if ((chatRoute || agentRoute) && !viewer.chat) throw new HttpError(403, 'Chat isn’t enabled for your account.');
    if (agentRoute) return await sparkieApi(req, res, path, viewer);
    const bare = /^\/connect\/([a-z0-9-]+)$/.exec(path);
    if (bare && EDITOR_PORTS[bare[1]]) { res.writeHead(302, { location: editorPath(bare[1]) + url.search }); return res.end(); }
    const editor = editorTarget(path + url.search);
    if (editor) {
      if (!owner) throw new HttpError(403, 'Only the owner can open the editors.');
      if (viewer.session && viewer.session.kind !== 'browser') throw new HttpError(403, 'Open the editors from a browser.');
      if (!editorPasskeyFresh(viewer)) throw new HttpError(403, `From the internet, the editors open only within ${Math.round(EDITOR_PASSKEY_MS / 3600000)} hours of using your passkey on this device. Sign in again with your passkey, or open them on your tailnet.`);
      return editorHttp(req, res, editor);
    }
    const ownerOnly = () => { if (!owner) throw new HttpError(403, 'Only the owner can do that.'); };
    // Changes to who has access need the owner's passkey (see "the owner's passkey").
    if (owner) await passkeyGate(req, path, viewer);
    // Hidden files: never by members (they'd run code when a folder is opened). A terminal signed in from the internet
    // doesn't write them either (4.10): only a browser or the tailnet.
    if (!owner || viewer.session?.kind === 'terminal') await refuseHiddenFiles(req, path, viewer.session?.kind === 'terminal');
    const managers = () => { if (!canManage(viewer)) throw new HttpError(403, 'Running and stopping models isn’t enabled for your account. Ask the owner.'); };
    if (owner) await refreshNodes(req);

    if (req.method === 'GET' && path === '/bootstrap') {
      const a = accessList();
      return send(res, 200, {
        source: 'console', viewer: { login: viewer.login, role: viewer.role, permissions: viewer.permissions || ownerPermissions() },
        userName: owner ? a.userName : viewer.login,
        nodes: NODES.map(n => ({ id: n.id, name: sparkName(n), configured: true, editorPath: owner && EDITOR_PORTS[n.id] ? editorPath(n.id) : null })),
        main: consoleOrigin() || null,
        // How this device is signed in when it isn't through Tailscale (4.10).
        session: viewer.session || null,
        ...(owner ? { passkeys: (() => { try { return passkeys().length; } catch { return -1; } })() } : {}),
      });
    }
    if (req.method === 'GET' && path === '/status') return send(res, 200, await statusFor(viewer, url.searchParams.get('fresh') === '1' && owner));
    if (req.method === 'GET' && path === '/connections') {
      ownerOnly();
      const a = accessList(), user = a.sshUser;
      const list = NODES.map(n => ({ id: n.id, name: sparkName(n), configured: true, ip: n.ip || (n.host !== 'local' ? n.host : null), user: n.user || user, alias: `ak${n.id}` }));
      return send(res, 200, {
        portalUrl: a.publicHost ? `https://${a.publicHost}/` : CONFIG.origin ? `${CONFIG.origin}/` : null, user, nodes: list,
        sshConfig: list.filter(n => n.ip).map(n => `Host ${n.alias}\n  HostName ${n.ip}\n  User ${n.user}\n  ServerAliveInterval 30\n  ServerAliveCountMax 3\n`).join('\n'),
      });
    }
    // The owner's passkeys: set one up, list, remove.
    if (path.startsWith('/auth/')) {
      ownerOnly();
      // Letting a device in, turning one away, and the signed-in devices (4.10).
      if (/^\/auth\/(device|sessions)(\/|$)/.test(path)) { if ((await sessionRoute(req, res, path, viewer)) !== false) return; throw new HttpError(404, 'Not found.'); }
      // Recovery codes (22-sessions.mjs): how many are left; making new ones needs the passkey (the gate above). From a
      // device signed in over the internet they're made only once a passkey exists, so a stolen cookie can't mint its own.
      if (path === '/auth/recovery') {
        if (req.method === 'GET') return send(res, 200, recoveryView());
        if (req.method !== 'POST') throw new HttpError(405, 'Use GET or POST.');
        if (viewer.session && !passkeys().length) throw new HttpError(403, 'Set up a passkey first; then make recovery codes.');
        if (!SECRETS_FILE) throw new HttpError(409, 'This copy of Spark Console keeps no secrets, so it has no recovery codes.');
        const codes = makeRecoveryCodes();
        audit({ via: viewer.session ? 'internet' : 'page', actor: 'owner', action: 'recovery-codes-made', args: { count: codes.length }, ok: true });
        fleetEvent({ type: 'notice', text: 'You made 10 new recovery codes. The old ones no longer work.' });
        return send(res, 200, { ...recoveryView(), codes });
      }
      if (req.method === 'GET' && path === '/auth/passkeys') {
        return send(res, 200, { keys: passkeys().map(k => ({ id: k.id, name: k.name, createdAt: k.createdAt, lastUsedAt: k.lastUsedAt || null, domain: k.rpId })), rpIds: passkeyRpIds() });
      }
      if (req.method === 'POST' && path === '/auth/passkey/begin') {
        const b = await readBody(req), have = passkeys();
        if (b.purpose === 'register') {
          if (have.length >= 10) throw new HttpError(409, 'Remove a passkey before adding another (10 at most).');
          return send(res, 200, { ...newChallenge(viewer, 'register'), rpIds: passkeyRpIds(), exclude: have.map(k => k.id),
            user: { id: passkey.b64url(createHash('sha256').update(String(viewer.login).toLowerCase()).digest().subarray(0, 16)), name: viewer.login } });
        }
        if (b.purpose === 'confirm') {
          const method = String(b.method || '').toUpperCase(), target = String(b.path || '').replace(/^\/console\/api(?=\/|$)/, '');
          if (!['POST', 'PUT', 'DELETE'].includes(method) || !target.startsWith('/') || target.length > 300) throw new HttpError(400, 'Say which change to confirm.');
          if (!have.length) throw new HttpError(409, 'No passkey is set up yet.');
          // The change in plain words, shown before the passkey is asked for.
          const summary = describeChange(method, target, b.body ?? {});
          return send(res, 200, { ...newChallenge(viewer, 'confirm', actionHash(method, target, b.body ?? {})), summary, allow: have.map(k => ({ id: k.id, rpId: k.rpId })) });
        }
        throw new HttpError(400, 'Ask to set up or to confirm.');
      }
      if (req.method === 'POST' && path === '/auth/passkey/register') {
        // The first passkey is set up on the tailnet only: with none on file (say passkeys.json was removed to recover),
        // a session from the internet can't add its own without anything to confirm it with (docs/contract.md 8.7).
        if (req.headers['tailscale-funnel-request'] && !passkeys().length) throw new HttpError(403, 'Set up your first passkey on your tailnet (Tailscale on); after that you can sign in from anywhere.');
        const b = await readBody(req), c = takeChallenge(b.challengeId, viewer, 'register');
        let k;
        try { k = passkey.verifyRegistration(b, { challenge: c.challenge, origins: passkeyOrigins(), rpIds: passkeyRpIds() }); } catch (e) { throw new HttpError(400, e.message); }
        const keys = passkeys();
        if (keys.some(x => x.id === k.id)) throw new HttpError(409, 'That passkey is already set up.');
        const name = clean(b.name, 60) || 'Passkey';
        keys.push({ ...k, name, createdAt: new Date().toISOString(), lastUsedAt: null });
        savePasskeys(keys);
        audit({ via: viewer.session ? 'internet' : 'page', actor: 'owner', action: 'passkey-added', args: { name, domain: k.rpId, ...(viewer.session ? { device: viewer.session.name } : {}) }, ok: true });
        // From a device signed in over the internet: on its record (it may add one without another only once), and said.
        if (viewer.session) {
          markPasskeyAdded(viewer.session.id);
          fleetEvent({ type: 'notice', text: `A passkey, “${name}”, was added on “${viewer.session.name}”, a device signed in from the internet. If that wasn’t you, remove it under Your passkey.` });
        }
        return send(res, 201, { id: k.id, name, domain: k.rpId });
      }
      const gone = path.match(/^\/auth\/passkeys\/([A-Za-z0-9_-]{16,1400})$/);
      if (req.method === 'DELETE' && gone) {
        const keys = passkeys(), k = keys.find(x => x.id === gone[1]);
        if (!k) throw new HttpError(404, 'That passkey was already removed.');
        savePasskeys(keys.filter(x => x !== k));
        for (const [cid, c] of challenges) if (c.purpose === 'register') challenges.delete(cid);
        audit({ via: 'page', actor: 'owner', action: 'passkey-removed', args: { name: k.name }, ok: true });
        return send(res, 200, { ok: true });
      }
      throw new HttpError(404, 'Not found.');
    }
    // The action list, as agents see it (Access → Agents shows it).
    if (req.method === 'GET' && path === '/actions') {
      ownerOnly();
      return send(res, 200, { actions: [...ACTIONS.values()].map(a => ({ name: a.name, title: a.title, kind: a.kind, scope: a.scope, description: a.description, input: liveSchema(a.input) })) });
    }
    // Any action, for the owner's own scripts and terminal (2026-11-11: one way in, the same actions Sparkie and agents
    // use): POST /actions/<name> with its arguments as the body. It runs as the owner's own call: a change runs at once
    // (a first run validates its workflow), with the rules agents have for code a model runs itself.
    const actionCall = path.match(/^\/actions\/([a-z_]{2,40})$/);
    if (req.method === 'POST' && actionCall) {
      ownerOnly();
      const args = await readBody(req, 200000);
      return send(res, 200, await runAction(actionCall[1], viewer, args ?? {}, { via: 'api', actor: 'owner', request: `${actionCall[1]} ${maskSecrets(JSON.stringify(args ?? {}).slice(0, 400)).slice(0, 200)}`, canChange: true }));
    }
    // Agent keys: one per agent, shown once when it's made; only its hash is kept.
    if (path === '/agents' || path.startsWith('/agents/')) {
      ownerOnly();
      if (req.method === 'GET' && path === '/agents') return send(res, 200, { url: mcpUrl(), keys: agentKeys().map(agentView), settings: agentSettings() });
      // The owner's switches: pause every agent's changes (Sparkie's too); restart crashed models automatically.
      if (req.method === 'PUT' && path === '/agents/settings') {
        const body = await readBody(req, 2000), change = {};
        for (const k of ['halted', 'selfHeal']) if (body[k] !== undefined) { if (typeof body[k] !== 'boolean') throw new HttpError(400, `${k} should be true or false.`); change[k] = body[k]; }
        // The owner's own pause or resume replaces an automatic one.
        if (change.halted !== undefined) change.autoPaused = false;
        const next = setAgentSettings(change);
        audit({ via: 'page', actor: 'owner', action: 'agent-settings', args: change, ok: true });
        // Resuming starts the hour's count again, so agents aren't paused again by the changes that paused them.
        if (change.halted === false) { agentChanges.length = 0; agentFailuresInARow = []; }
        if (change.halted !== undefined) fleetEvent({ type: 'operation', operation: change.halted ? 'agents paused' : 'agents resumed', status: 'completed', by: 'owner' });
        return send(res, 200, { settings: next });
      }
      if (req.method === 'POST' && path === '/agents') {
        const name = clean((await readBody(req, 4000)).name, 60);
        if (!name) throw new HttpError(400, 'Name the agent, like “Claude Code on my MacBook”.');
        const keys = agentKeys();
        if (keys.length >= 20) throw new HttpError(409, 'Remove an agent before adding another (20 at most).');
        if (keys.some(k => k.name.toLowerCase() === name.toLowerCase())) throw new HttpError(409, `There’s already an agent called ${name}.`);
        const token = `sck_${randomBytes(32).toString('base64url')}`;
        const key = { id: randomBytes(6).toString('hex'), name, login: viewer.login, hash: keyHash(token).toString('hex'), scopes: ['fleet:read'], internet: false, createdAt: new Date().toISOString(), lastUsedAt: null, lastAction: null };
        writePrivate(AGENTS_FILE, { keys: [...keys, key] });
        audit({ via: 'page', actor: 'owner', action: 'agent-added', args: { agent: name }, ok: true });
        return send(res, 201, { ...agentView(key), token, url: mcpUrl() });
      }
      const agentId = path.slice('/agents/'.length);
      // Whether one agent may change things (start and stop models), or only look; and whether its key also works from
      // the internet without Tailscale (internet: true), or only on the tailnet.
      if (req.method === 'PUT' && AGENT_ID.test(agentId)) {
        const { act, internet } = await readBody(req, 2000);
        if ((act !== undefined && typeof act !== 'boolean') || (internet !== undefined && typeof internet !== 'boolean') || (act === undefined && internet === undefined)) {
          throw new HttpError(400, 'Say whether it can change things (act: true or false), and/or whether its key works from anywhere (internet: true or false).');
        }
        const keys = agentKeys(), key = keys.find(k => k.id === agentId);
        if (!key) throw new HttpError(404, 'That agent was removed.');
        if (act !== undefined) key.scopes = act ? ['fleet:read', 'fleet:act'] : ['fleet:read'];
        if (internet !== undefined) key.internet = internet;
        writePrivate(AGENTS_FILE, { keys });
        if (act !== undefined) audit({ via: 'page', actor: 'owner', action: 'agent-can-change', args: { agent: key.name, act }, ok: true });
        if (internet !== undefined) audit({ via: 'page', actor: 'owner', action: 'agent-from-anywhere', args: { agent: key.name, internet }, ok: true });
        return send(res, 200, agentView(key));
      }
      // Removing an agent (or making it look-only, above) cancels nothing already running: its operations, the rest of a
      // saved workflow it started and an undo it asked for keep running and post their results, as after /stop (R34); the
      // owner cancels one in Activity. A reply of Sparkie's to it that is still under way changes nothing more: runAction
      // reads the key again before each change (ctx.agentId, R9).
      if (req.method === 'DELETE' && AGENT_ID.test(agentId)) {
        const keys = agentKeys();
        const gone = keys.find(k => k.id === agentId);
        if (!gone) throw new HttpError(404, 'That agent was already removed.');
        writePrivate(AGENTS_FILE, { keys: keys.filter(k => k.id !== agentId) });
        agentUse.delete(agentId);
        audit({ via: 'page', actor: 'owner', action: 'agent-removed', args: { agent: gone.name }, ok: true });
        return send(res, 200, { ok: true });
      }
      throw new HttpError(404, 'Not found.');
    }
    if (path === '/access' || path.startsWith('/access/')) {
      ownerOnly();
      const a = accessList(), memberId = path.slice('/access/'.length);
      if (req.method === 'GET' && path === '/access') {
        const own = ownAccess() || {};
        return send(res, 200, { owner: a.owner, members: a.members.filter(u => MEMBER_ID.test(u.id || '')), sparks: NODES.map(n => ({ id: n.id, name: sparkName(n) })),
          requests: Array.isArray(own.requests) ? own.requests : [], invite: own.invite || null });
      }
      // Someone who asked: let them in with a starting point, or turn them away.
      if (req.method === 'POST' && path === '/access/requests') {
        const body = await readBody(req), login = String(body.login || '');
        if (!(ownAccess()?.requests || []).some(r => r.login === login)) throw new HttpError(404, 'That request is gone.');
        if (body.decision === 'approve') {
          if (!ACCESS_PRESETS[body.preset]) throw new HttpError(400, 'Pick what they can do.');
          if (login === a.owner || a.members.some(u => u.login === login)) throw new HttpError(409, `${login} already has access.`);
          const permissions = memberPermissions({ nodeIds: NODES.map(n => n.id), concurrentChats: 1, ...ACCESS_PRESETS[body.preset] });
          const user = { id: randomBytes(8).toString('hex'), login, permissions, addedAt: new Date().toISOString() };
          changeMembers(list => { if (list.length >= 20) throw new HttpError(409, 'Remove someone before adding another (20 at most).'); return [...list, user]; });
        } else if (body.decision !== 'decline') throw new HttpError(400, 'Approve or decline.');
        changeAccess(own => ({ ...own, requests: (own.requests || []).filter(r => r.login !== login) }));
        audit({ via: 'page', actor: 'owner', action: body.decision === 'approve' ? 'access-approved' : 'access-declined', args: { login, ...(body.preset ? { preset: body.preset } : {}) }, ok: true });
        return send(res, 200, { ok: true });
      }
      // The Tailscale share link for Spark Console's device, kept here so Copy invite can include it. Owner-only.
      if (req.method === 'PUT' && path === '/access/invite') {
        const link = String((await readBody(req)).url || '').trim();
        if (link && (!/^https:\/\/login\.tailscale\.com\/[A-Za-z0-9/_?=&.%-]{4,300}$/.test(link))) throw new HttpError(400, 'Paste the share link Tailscale gave you (it starts with https://login.tailscale.com/).');
        changeAccess(own => ({ ...own, invite: link ? { url: link, at: new Date().toISOString() } : null }));
        audit({ via: 'page', actor: 'owner', action: link ? 'invite-link-saved' : 'invite-link-removed', args: {}, ok: true });
        return send(res, 200, { ok: true });
      }
      if (req.method === 'POST' && path === '/access') {
        const body = await readBody(req), login = String(body.login || '').trim();
        if (!LOGIN_RE.test(login) || login.length > 200) throw new HttpError(400, 'Enter their exact Tailscale login (an email address).');
        if (login === a.owner || a.members.some(u => u.login === login)) throw new HttpError(409, `${login} already has access.`);
        const user = { id: randomBytes(8).toString('hex'), login, permissions: memberPermissions(body.permissions), addedAt: new Date().toISOString() };
        changeMembers(list => { if (list.length >= 20) throw new HttpError(409, 'Remove someone before adding another (20 at most).'); return [...list, user]; });
        audit({ via: 'page', actor: 'owner', action: 'access-added', args: { login, permissions: user.permissions }, ok: true });
        return send(res, 201, user);
      }
      if (MEMBER_ID.test(memberId) && (req.method === 'PUT' || req.method === 'DELETE')) {
        const permissions = req.method === 'PUT' ? memberPermissions((await readBody(req)).permissions) : null;
        let login = null;
        changeMembers(list => {
          const user = list.find(u => u.id === memberId);
          if (!user) throw new HttpError(404, 'That person no longer has access.');
          login = user.login;
          if (permissions) { user.permissions = permissions; return list; }
          return list.filter(u => u !== user);
        });
        disconnectViewer(login);
        audit({ via: 'page', actor: 'owner', action: permissions ? 'access-changed' : 'access-removed', args: { login, ...(permissions ? { permissions } : {}) }, ok: true });
        return send(res, 200, { ok: true });
      }
      throw new HttpError(404, 'Not found.');
    }
    const nodeMatch = path.match(/^\/nodes\/([a-z0-9-]+)\/(workloads|diagnostics|logs\/([a-z]+|container-[a-f0-9]{64})|files|actions)$/);
    if (nodeMatch) {
      const node = sparkFor(viewer, nodeMatch[1]), what = nodeMatch[2];
      if (what === 'files' && req.method === 'POST') return send(res, 200, await sparkFiles(viewer, node, await readBody(req, 400000)));
      if (what === 'actions' && req.method === 'POST') {
        const { action } = await readBody(req);
        ownerOnly();
        await checkSparkAction(node, action);
        const job = newJob('spark-action', { node: node.id, action, by: viewer.login });
        return send(res, 202, publicJob(runJob(job, j => sparkAction(j, node, action))));
      }
      ownerOnly();
      if (req.method !== 'GET') throw new HttpError(405, 'Not allowed.');
      if (what === 'workloads') return send(res, 200, await workerCall(node, { action: 'workloads' }, 40000));
      if (what === 'diagnostics') return send(res, 200, await workerCall(node, { action: 'diagnostics' }, 40000));
      if (nodeMatch[3] && LOG_SERVICES.includes(nodeMatch[3])) return send(res, 200, await workerCall(node, { action: 'logs', service: nodeMatch[3] }, 40000));
      // A running model's own log (the worker checks the container exists and hides secrets in the output).
      if (nodeMatch[3]?.startsWith('container-')) return send(res, 200, await workerCall(node, { action: 'container-logs', containerId: nodeMatch[3].slice(10) }, 40000));
      throw new HttpError(400, 'Choose a supported diagnostic.');
    }
    if (req.method === 'GET' && path === '/metrics') return metricsStream(req, res, viewer);
    if (req.method === 'GET' && path === '/models') {
      const inv = await inventory(viewer), ver = verifiedList();
      return send(res, 200, { ...inv, library: inv.library.map(m => ({ ...m, verified: ver.filter(v => v.model === m.name || (m.repo && v.repo === m.repo)).map(verifiedView) })) });
    }
    if (req.method === 'GET' && path === '/verified') return send(res, 200, { deployments: verifiedList().map(verifiedView) });
    if (req.method === 'GET' && path === '/recipes') return send(res, 200, await recipes(viewer));
    if (req.method === 'GET' && path === '/deploy/plan') {
      managers();
      return send(res, 200, await plan(url.searchParams.get('model'), url.searchParams.get('node'), viewer));
    }
    if (req.method === 'GET' && path === '/deploy/options') {
      managers();
      return send(res, 200, await deployOptions(viewer));
    }
    if (req.method === 'GET' && path === '/deploy/plans') {
      managers();
      const model = url.searchParams.get('model');
      if (!NAME_RE.test(model || '')) throw new HttpError(400, 'Unknown model.');
      return send(res, 200, await plansFor(model, viewer));
    }
    if (req.method === 'GET' && path === '/gpu') {
      ownerOnly();
      const node = nodeById(url.searchParams.get('node'));
      if (!node) throw new HttpError(400, 'Unknown Spark.');
      const r = await run(node, gpuUsersScript(CONFIG.images.vllm || 'none'), { timeout: 30000 });
      if (r.code) throw new HttpError(502, `${node.id} isn’t reachable: ${r.err.split('\n').slice(-1)[0]}`);
      return send(res, 200, {
        node: node.id,
        gpuUsers: fields(r.out, 'gpu').map(([pid, mem, pname, container]) => ({ pid, memMiB: Number(mem) || 0, process: pname, container: container || null })),
        running: fields(r.out, 'run').map(([name, protect, ours]) => ({ name, protected: isProtected(name, protect), ours: Boolean(ours) })),
      });
    }
    if (req.method === 'GET' && path === '/fabric') {
      // Everyone sees the cables; running the test is the owner's.
      if (url.searchParams.get('check') === '1') ownerOnly();
      return send(res, 200, await fabric(viewer, url.searchParams.get('check') === '1'));
    }
    // The owner sees every operation; a member sees the ones they started.
    const ownJob = j => owner || j.by === viewer.login;
    if (req.method === 'GET' && path === '/jobs') {
      const notices = owner ? events.filter(e => e.type === 'notice' && Date.now() - Date.parse(e.at) < 7 * 86400000).slice(-5).reverse().map(e => ({ at: e.at, text: e.text })) : [];
      // Until restarting is validated, crashed models aren't restarted by themselves: said first (docs/contract.md 6.3).
      if (owner && agentSettings().selfHeal && workflowStatus('restart_model').state === 'untested') {
        notices.unshift({ at: new Date().toISOString(), text: 'Auto-restart is off: this build’s restart hasn’t passed Spark Console’s tests.', workflows: true });
      }
      return send(res, 200, { jobs: [...jobs.values()].filter(ownJob).reverse().map(publicJob), notices });
    }
    const jobMatch = path.match(/^\/jobs\/([0-9a-f]{12})$/);
    if (req.method === 'GET' && jobMatch) {
      const job = jobs.get(jobMatch[1]);
      if (!job || !ownJob(job)) throw new HttpError(404, 'That operation has expired.');
      return send(res, 200, publicJob(job));
    }
    if (req.method === 'POST' && path === '/deploy') {
      const body = await readBody(req), { model, node, keep = [] } = body, approved = stopList(body.stop);
      if (!approved) throw new HttpError(400, 'Reload the page and try again: this copy of the page is older than Spark Console.');
      if (!NAME_RE.test(model || '') || !nodeById(node)) throw new HttpError(400, 'Choose a model and a Spark.');
      notBrainsSpark([node]);
      if (!Array.isArray(keep) || !keep.every(k => NAME_RE.test(String(k)))) throw new HttpError(400, 'Invalid list of containers to keep.');
      if ([...jobs.values()].some(j => j.status === 'running' && j.node === node && ['deploy', 'stop'].includes(j.type))) {
        throw new HttpError(409, `Something is already changing on ${node}. Wait for it to finish.`);
      }
      mustUse(viewer, [node]);
      const release = claimSparks([node], `deploying ${model}`);
      try {
        const wf = pageWorkflow(req, 'start_model', owner);
        const how = resolveHow(body, viewer, model, 1, (await inventory(null)).library);
        const job = newJob('deploy', { model, node, by: viewer.login, setup: how?.setupId || null, ...wf });
        job.release = release;
        return send(res, 202, publicJob(runJob(job, j => startWithFixes(j, { name: model }, { nodes: [node], stop: approved, two: false }, how,
          (h, fix) => deploy(j, model, node, viewer, keep.map(String), h, approved, fix)))));
      } catch (e) { release(); throw e; }
    }
    if (req.method === 'GET' && path === '/deploy/cluster-plan') {
      managers();
      const model = url.searchParams.get('model'), nodes = String(url.searchParams.get('nodes') || '').split(',').filter(Boolean);
      if (!NAME_RE.test(model || '')) throw new HttpError(400, 'Unknown model.');
      const cp = await clusterPlan(model, nodes, viewer);
      await clusterNet(nodes[0], nodes[1]);
      return send(res, 200, cp);
    }
    if (req.method === 'POST' && path === '/deploy/cluster') {
      const body = await readBody(req), { model, nodes, keep = [] } = body, approved = stopList(body.stop);
      if (!approved) throw new HttpError(400, 'Reload the page and try again: this copy of the page is older than Spark Console.');
      if (!NAME_RE.test(model || '') || !Array.isArray(nodes) || nodes.length !== 2 || !nodes.every(n => nodeById(n))) throw new HttpError(400, 'Choose a model and two Sparks.');
      notBrainsSpark(nodes);
      if (!Array.isArray(keep) || !keep.every(k => NAME_RE.test(String(k)))) throw new HttpError(400, 'Invalid list of containers to keep.');
      if ([...jobs.values()].some(j => j.status === 'running' && (nodes.includes(j.node) || (j.nodes || []).some(n => nodes.includes(n))) && ['deploy', 'stop', 'deploy-cluster'].includes(j.type))) {
        throw new HttpError(409, 'Something is already changing on one of those Sparks. Wait for it to finish.');
      }
      mustUse(viewer, nodes);
      const release = claimSparks(nodes, `deploying ${model} across two Sparks`);
      try {
        const wf = pageWorkflow(req, 'start_model_across', owner);
        const how = resolveHow(body, viewer, model, 2, (await inventory(null)).library);
        const job = newJob('deploy-cluster', { model, nodes, node: nodes[0], by: viewer.login, setup: how?.setupId || null, ...wf });
        job.release = release;
        return send(res, 202, publicJob(runJob(job, j => startWithFixes(j, { name: model }, { nodes, stop: approved, two: true }, how,
          (h, fix) => clusterDeploy(j, model, nodes, viewer, keep.map(String), h, approved, fix)))));
      } catch (e) { release(); throw e; }
    }
    if (req.method === 'POST' && path === '/stop') {
      const { node, container } = await readBody(req);
      if (!nodeById(node) || !NAME_RE.test(container || '')) throw new HttpError(400, 'Choose a Spark and a container.');
      // Only Spark Console's own deploys stop here, and never Sparkie's model (that's on Models, for the owner).
      const dep = (await inventory(null)).sparks.find(sp => sp.id === node)?.deployments.find(d => d.container === container);
      if (!dep) throw new HttpError(404, `${container} isn’t one of Spark Console’s deploys on ${node}.`);
      if (dep.role === 'main') throw new HttpError(403, 'Sparkie’s model is started and stopped on Models, by the owner.');
      mustUse(viewer, dep.cluster ? dep.cluster.split('+') : [node]);
      const wf = pageWorkflow(req, 'stop_model', owner);
      if (owner) await cancelRunningOn(dep.cluster ? dep.cluster.split('+') : [node], 'the owner');
      const job = claimed(dep.cluster ? dep.cluster.split('+') : [node], `stopping ${container}`, () => newJob('stop', { node, container, by: viewer.login, ...wf }));
      return send(res, 202, publicJob(runJob(job, async j => { await stopContainer(j, node, container, viewer); await stoppedForSure(j, node, container); })));
    }
    if (req.method === 'GET' && path === '/desired') {
      ownerOnly();
      return send(res, 200, await desiredNow());
    }
    if (req.method === 'POST' && (path === '/desired/bring-back' || path === '/desired/forget')) {
      ownerOnly();
      const { spark, container } = await readBody(req, 4000);
      // (read strictly: a list that can't be read just now is "try again", never "not on the list", and never saved over)
      const d = desired(true), x = d.running.find(y => y.spark === spark && y.container === container);
      if (!x) throw new HttpError(404, 'That isn’t on the list of what should be running.');
      if (path === '/desired/forget') {
        const before = d.running.map(y => ({ ...y }));
        d.running = d.running.filter(y => y !== x);
        d.revision += 1;
        d.revisions.push({ revision: d.revision, at: new Date().toISOString(), by: 'owner', chat: null, operation: null, added: [], removed: [`${spark}/${container}`], before, forgotten: true });
        writePrivate(DESIRED_FILE, d);
        return send(res, 200, { ok: true });
      }
      // An app kept running comes back through keep_running (it isn't a workflow).
      if (x.app) return send(res, 202, await runAction('keep_running', viewer, { spark, container }, { via: 'page', actor: 'owner', request: `bring back ${container}`, canChange: true, trusted: true }));
      const id = x.sparks ? 'start_model_across' : 'restart_model', wf = pageWorkflow(req, id, owner);
      const validating = workflowStatus(id).state === 'needs-validation' ? { __validate: id } : {};
      const ctx = { via: 'page', actor: 'owner', request: `bring back ${container}`, canChange: true, trusted: true };
      void wf;
      return send(res, 202, x.sparks ? await runAction('start_model', viewer, { model: x.model, sparks: x.sparks, ...validating }, ctx) : await runAction('restart_model', viewer, { spark, container, ...validating }, ctx));
    }
    const cancelling = path.match(/^\/jobs\/([0-9a-f]{12})\/cancel$/);
    if (req.method === 'POST' && cancelling) {
      ownerOnly();
      return send(res, 200, await runAction('cancel_operation', viewer, { id: cancelling[1] }, { via: 'page', actor: 'owner', canChange: true }));
    }
    if (req.method === 'POST' && path === '/workflows/validate') {
      ownerOnly();
      return send(res, 202, publicJob(startTestChanges(viewer, 'page')));
    }
    // Telegram (21-telegram.mjs, R32): connecting and pairing need the passkey (the gate above); disconnecting never does.
    if (path === '/telegram' || path === '/telegram/pair' || path === '/telegram/needs') {
      ownerOnly();
      return await telegramRoute(req, res, path, viewer);
    }
    if (path === '/rollback') {
      ownerOnly();
      const snap = lastSnapshot();
      if (req.method === 'GET') return send(res, 200, { available: Boolean(snap), stamp: snap?.stamp || null });
      if (req.method !== 'POST') throw new HttpError(405, 'Use GET or POST.');
      return send(res, 202, await undoUpdate('page'));
    }
    if (req.method === 'GET' && path === '/workflows') {
      ownerOnly();
      return send(res, 200, await ACTIONS.get('workflows').run({}));
    }
    if (req.method === 'GET' && path === '/main') {
      const presets = Object.entries(mainPresets()).map(([id, p]) => ({ id, title: p.title || repoOf(p.model), current: id === MAIN?.id }));
      const [chat, agents] = await Promise.all([routeView(ROUTES.chat), ROUTES.agents.kind === 'same' ? null : routeView(ROUTES.agents)]);
      return send(res, 200, { ...(await mainStatus()), id: MAIN?.id || null, presets, routes: { chat, agents: agents || { same: true } } });
    }
    if (req.method === 'GET' && path === '/main/plan') {
      ownerOnly();
      const preset = url.searchParams.get('preset'), model = url.searchParams.get('model');
      if (model && !NAME_RE.test(model)) throw new HttpError(400, 'Unknown model.');
      const target = model ? await setupFromLibrary(model) : preset ? mainSetup(preset, mainPresets()[preset]) : MAIN;
      if (!target) throw new HttpError(404, 'Unknown setup.');
      const p = await mainPlan(target);
      return send(res, 200, { ...p, target: { id: target.id, title: target.title, engine: target.engine, model: repoOf(target.model), current: target.id === MAIN?.id } });
    }
    if (req.method === 'GET' && path === '/main/choices') {
      ownerOnly();
      const running = await runningChoices();
      const library = (await inventory(null)).library.filter(m => m.role !== 'draft')
        .map(m => ({ id: m.name, title: m.manifest?.title || m.repo || m.name, copies: m.copies, sizeBytes: m.sizeBytes, onSparkieSpark: m.copies.includes(MAIN?.node || CONFIG.modelsHost) }));
      const presets = Object.entries(mainPresets()).map(([id, p]) => ({ id, title: p.title || repoOf(p.model), current: id === MAIN?.id }));
      return send(res, 200, { running, presets, library, sparkieSpark: MAIN?.node || CONFIG.modelsHost });
    }
    if (req.method === 'POST' && path === '/main/route') {
      if (mainBusy()) throw new HttpError(409, 'Sparkie’s model is changing. Try again when it’s done.');
      const { role, choice } = await readBody(req);
      if (!['chat', 'agents'].includes(role) || typeof choice !== 'string' || choice.length > 200) throw new HttpError(400, 'Choose what Sparkie or agents should use.');
      await setRoute(role, choice);
      return send(res, 200, { chat: await routeView(ROUTES.chat), agents: ROUTES.agents.kind === 'same' ? { same: true } : await routeView(ROUTES.agents) });
    }
    if (req.method === 'POST' && path === '/main/use') {
      if (mainBusy()) throw new HttpError(409, 'Sparkie’s model is already changing.');
      const { preset, model, keep = [] } = await readBody(req);
      if ((model && !NAME_RE.test(String(model))) || !Array.isArray(keep) || !keep.every(k => NAME_RE.test(String(k)))) throw new HttpError(400, 'Choose a model.');
      const target = model ? await setupFromLibrary(String(model)) : mainSetup(String(preset || ''), mainPresets()[preset]);
      if (!target) throw new HttpError(404, 'Unknown setup.');
      if (target.id === MAIN?.id) throw new HttpError(409, `${target.title} is already Sparkie’s model.`);
      const job = claimed([...new Set([target.node, MAIN?.node].filter(Boolean))], `switching Sparkie’s model`, () => newJob('main-switch', { node: target.node, model: target.title, from: MAIN?.title || null }));
      return send(res, 202, publicJob(runJob(job, j => switchMain(j, target, keep.map(String)))));
    }
    if (req.method === 'POST' && (path === '/main/start' || path === '/main/stop')) {
      if (!MAIN) throw new HttpError(404, 'No main model is configured.');
      if (mainBusy()) throw new HttpError(409, 'Sparkie’s model is already starting or stopping.');
      const { keep = [] } = await readBody(req);
      if (!Array.isArray(keep) || !keep.every(k => NAME_RE.test(String(k)))) throw new HttpError(400, 'Invalid list of containers to keep.');
      const starting = path === '/main/start';
      const job = claimed([MAIN.node], `${starting ? 'starting' : 'stopping'} Sparkie’s model`, () => newJob(starting ? 'main-start' : 'main-stop', { node: MAIN.node, model: MAIN.title || MAIN.served }));
      // (the owner's Stop: the brain keeper never starts it again by itself, 20-heal.mjs)
      return send(res, 202, publicJob(runJob(job, j => (starting ? startMain(j, keep.map(String)) : stopMain(j).then(() => markBrainLeftDown(false))))));
    }
    if (req.method === 'GET' && path === '/chats') {
      const mine = chatData().conversations.filter(c => c.login === viewer.login);
      return send(res, 200, { chats: mine.map(chatSummary).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) });
    }
    if (req.method === 'POST' && path === '/chats') {
      const { spark = null } = await readBody(req);
      if (spark !== null && !nodeById(spark)) throw new HttpError(400, 'Unknown Spark.');
      const mine = chatData().conversations.filter(c => c.login === viewer.login && !c.agent);
      if (mine.length >= LIMITS.chats) throw new HttpError(409, `You have ${LIMITS.chats} chats. Delete some to start new ones.`);
      const now = new Date().toISOString();
      const conv = { id: `sc_${randomBytes(8).toString('hex')}`, login: viewer.login, title: 'New chat', spark, createdAt: now, updatedAt: now, messages: [] };
      chatData().conversations.push(conv);
      saveChats();
      return send(res, 201, { ...chatSummary(conv), messages: [] });
    }
    const chatMatch = path.match(/^\/chats\/([^/]+)(\/messages|\/choose)?$/);
    if (chatMatch && CHAT_ID.test(chatMatch[1])) {
      const conv = ownChat(viewer, chatMatch[1]);
      // A button under one of Sparkie's answers: what it offered runs, as the owner's own choice.
      if (chatMatch[2] === '/choose') {
        if (req.method !== 'POST') throw new HttpError(405, 'Use POST to press a button.');
        if (!owner) throw new HttpError(403, 'Only the owner’s conversations have buttons.');
        if (replying.has(conv.id)) throw new HttpError(409, 'Wait until Sparkie finishes answering.');
        const { choice } = await readBody(req, 2000);
        if (typeof choice !== 'string' || !/^[a-f0-9]{10}$/.test(choice)) throw new HttpError(400, 'Which button?');
        const r = await runChoice(viewer, conv, choice, { via: 'page', actor: 'owner' });
        return send(res, 200, { outcome: r.outcome, operation: r.operation || null, message: r.message, ...chatSummary(conv), messages: conv.messages });
      }
      if (chatMatch[2] && req.method === 'POST') {
        const { text, context = null } = await readBody(req);
        if (typeof text !== 'string' || !text.trim() || text.length > LIMITS.text) throw new HttpError(400, `Write a message of up to ${LIMITS.text} characters.`);
        if (context !== null && (typeof context !== 'string' || context.length > LIMITS.context)) throw new HttpError(400, 'Invalid snapshot.');
        // The owner's words (/status, /pause, /restart sparkie, /stop, /undo update, /help) in their own chat: answered by
        // code, no model, also while an answer is coming in this chat (/stop ends it).
        const word = owner && !conv.agent ? ownerWord(text) : null;
        if (word) return await answerOwnerWord(res, conv, word, 'page', null, viewer);
        const help = owner && !conv.agent ? await nearMissWord(text) : null;
        if (help) return await answerOwnerWord(res, conv, help, 'page', text);
        return await chatReply(req, res, viewer, conv, text.trim(), context);
      }
      if (chatMatch[2]) throw new HttpError(405, 'Use POST to send a message.');
      if (req.method === 'GET') return send(res, 200, { ...chatSummary(conv), messages: conv.messages });
      if (replying.has(conv.id)) throw new HttpError(409, 'Wait until Sparkie finishes answering.');
      if (req.method === 'PATCH') {
        const { title } = await readBody(req);
        if (typeof title !== 'string' || !title.trim() || title.length > 80) throw new HttpError(400, 'Use a title of 1 to 80 characters.');
        conv.title = title.trim();
        saveChats();
        return send(res, 200, { ...chatSummary(conv), messages: conv.messages });
      }
      if (req.method === 'DELETE') {
        chatData().conversations = chatData().conversations.filter(c => c !== conv);
        saveChats();
        return send(res, 200, { ok: true });
      }
    }
    if (req.method === 'GET' && path === '/recipes/search') {
      managers();
      const query = String(url.searchParams.get('q') || '').trim();
      if (query.length < 2 || query.length > 300) throw new HttpError(400, 'Type what you’re looking for.');
      return send(res, 200, await searchModels(query));
    }
    if (req.method === 'POST' && path === '/recipes/add') {
      // Adding a model also starts looking for its setups.
      ownerOnly();
      const entry = await addModel(viewer, await readBody(req));
      const job = startDig(viewer, entry.id, entry.title);
      return send(res, 200, { ...entry, job: job ? publicJob(job) : null });
    }
    if (req.method === 'POST' && path === '/recipes/add-list') {
      ownerOnly();
      const repos = parseRepoList((await readBody(req)).text);
      if (!repos.length) throw new HttpError(400, 'Paste Hugging Face links, or names like org/model.');
      if (repos.length > 20) throw new HttpError(400, 'Up to 20 at a time.');
      const job = newJob('add-list', { model: repos.length === 1 ? repos[0] : `${repos.length} models`, repos, by: viewer.login });
      return send(res, 202, publicJob(runJob(job, j => addList(j, viewer, repos))));
    }
    if (req.method === 'POST' && path === '/recipes/dig') {
      ownerOnly();
      const { model } = await readBody(req);
      const m = recipeCatalog().models.find(x => x.id === String(model || ''));
      if (!m) throw new HttpError(404, 'That model isn’t in Recipes.');
      const job = startDig(viewer, m.id, m.title);
      if (!job) throw new HttpError(409, 'Already looking for setups for that model.');
      return send(res, 202, publicJob(job));
    }
    if (req.method === 'POST' && path === '/recipes/download') {
      // Only versions listed in Recipes download; they go into that Spark's Hugging Face cache. A GGUF version
      // downloads one of its listed quantizations.
      const { repo, node, file } = await readBody(req);
      const version = recipeCatalog().models.flatMap(m => m.variants).find(v => sameRepo(v.repo, repo));
      if (!version || !REPO_RE.test(version.repo)) throw new HttpError(404, 'That version isn’t in Recipes.');
      const quant = Array.isArray(version.quants) && version.quants.length ? String(file || version.file || '') : null;
      const option = quant != null ? version.quants.find(x => x.file === quant) : null;
      if (quant != null && !option) throw new HttpError(400, 'Pick one of that version’s files.');
      if ([...jobs.values()].some(j => j.status === 'running' && j.type === 'download' && sameRepo(j.repo, version.repo))) throw new HttpError(409, 'That download is already running.');
      const target = node ? nodeById(node) : nodeById((await downloadTargets(viewer)).defaultTarget);
      if (!target) throw new HttpError(409, 'No online Spark to download to.');
      mustUse(viewer, [target.id]);
      const gb = option?.sizeGB || version.sizeGB;
      const job = newJob('download', { repo: version.repo, model: quant ? `${version.repo} (${quant})` : version.repo, node: target.id, by: viewer.login, total: gb ? Math.round(gb * 1e9) : null });
      return send(res, 202, publicJob(runJob(job, async j => { await downloadVersion(j, version.repo, target, quant); await refreshSetups(viewer, version.repo, { job: j }); })));
    }
    throw new HttpError(404, 'Not found.');
  } catch (e) {
    // A 500 (a fault in Spark Console's own code, not a refusal) is printed and counted for sparkie_setup (23-http.mjs).
    if (isFault(e)) recordFault(`${req.method} ${routePattern(path)}`, e);
    if (!res.headersSent && e.retryAfter) res.setHeader('retry-after', String(e.retryAfter));
    if (!res.headersSent) send(res, e.status || 500, path.startsWith('/v1/') ? { error: { message: e.message, type: e.type || 'error' } } : { error: e.message, ...(e.passkey ? { passkey: e.passkey } : {}), ...(e.validation ? { validation: e.validation } : {}) });
  }
};


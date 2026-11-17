// Covers: The page is Home, chat, sign-in and status (the one page, milestone 4; E10b; Home back on the owner's word,
// 2026-11-16, without its start dialog). Models, Files and Access are off it, with the page code only they used; only Home's and Models' routes stay in the service. File reads only, like
// install.test.mjs's reads of the installer: no server, no browser. The page's files still parse, and every file the
// installer ships (UI_FILES) is still there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { REPO } from './start-mock.mjs';

const PUBLIC = join(REPO, 'public');
const APP = readFileSync(join(PUBLIC, 'app.js'), 'utf8');
const CSS = readFileSync(join(PUBLIC, 'styles.css'), 'utf8');
const HTML = readFileSync(join(PUBLIC, 'index.html'), 'utf8');
const INSTALLER = readFileSync(join(REPO, 'deploy', 'host-on-portal.sh'), 'utf8');
const NAV = (() => {
  const m = APP.match(/^const NAV = \[\n([\s\S]*?)^\];/m);
  assert.ok(m, 'the nav list is in public/app.js');
  return m[1];
})();
const ACCOUNT_MENU = (() => {
  const m = APP.match(/^function accountMenu\(\) \{\n([\s\S]*?)^\}/m);
  assert.ok(m, 'the account menu is in public/app.js');
  return m[1];
})();
const has = name => new RegExp(`^(?:async )?function ${name}\\(|^const ${name} = `, 'm').test(APP);

test('Models, Files and Access are off the page: no view, no nav entry, no link to one', () => {
  for (const view of ['models', 'files', 'access']) {
    assert.doesNotMatch(APP, new RegExp(`^PAGES\\.${view}\\s*=`, 'm'), `no ${view} view`);
    assert.doesNotMatch(APP, new RegExp(`#/${view}\\b`), `no link to #/${view}`);
    assert.doesNotMatch(APP, new RegExp(`\\bgo\\(['\`]${view}\\b`), `nothing goes to ${view}`);
  }
  for (const label of ['Models', 'Files', 'Access']) assert.doesNotMatch(NAV, new RegExp(`'${label}'`), `${label} is not in the nav`);
  // The code only they used, and the three late-answer faults it held (A-10 in the start dialog's pick, A-11 in the
  // file browser, A-12 in its uploads).
  for (const name of ['runningTab', 'libraryTab', 'findMoreTab', 'openDeploy', 'openDeployPicker', 'filesBrowser', 'peopleTab', 'memberAccess', 'personDialog']) {
    assert.ok(!has(name), `${name} is gone`);
  }
  assert.doesNotMatch(APP, /function uploadFiles\(/, 'no uploads from the page');
  // Their styles went with them.
  for (const cls of ['rc-options', 'lib-table', 'invite-panel', 'cap-table', 'segmented', 'dropzone']) {
    assert.doesNotMatch(CSS, new RegExp(`\\.${cls}\\b`), `no .${cls} in styles.css`);
  }
});

test('the page starts on Home; old addresses of the views that are off it open Home', () => {
  assert.match(APP, /view: parts\[0\] \|\| 'fleet'/, 'an empty address is Home');
  assert.match(APP, /^PAGES\.fleet = function fleetPage\(/m, 'Home is a view');
  assert.match(NAV, /\['', 'fleet', 'Home', 'grid', \(\) => true\]/, 'Home is first in the nav');
  for (const name of ['sparkCard', 'attentionBanners', 'linkMap', 'pairRow']) assert.ok(has(name), `${name} is there`);
  assert.doesNotMatch(APP, /openDeployPicker/, 'no start dialog: models start through the chat');
  for (const view of ['home', 'models', 'recipes', 'files', 'access', 'sharing']) {
    assert.match(APP, new RegExp(`^  ${view}: \\(\\) => '#/',$`, 'm'), `#/${view} is sent to #/`);
  }
});

test('the chat stays: its view, its buttons, its live steps, the owner\'s words', () => {
  assert.match(APP, /^PAGES\.sparkie = function sparkiePage\(/m);
  assert.match(NAV, /\['sparkie', 'sparkie', ASSISTANT, 'chat', canChat\]/, 'the chat is in the nav');
  for (const name of ['streamChat', 'toolLines', 'checkedFold', 'renderMarkdown', 'followNewJobs']) assert.ok(has(name), `${name} is there`);
  assert.match(APP, /function choiceRow\(m\)/, 'Sparkie\'s buttons under a message');
  assert.match(APP, /capi\(`chats\/\$\{conv\.id\}\/choose`, 'POST'/, 'a button press');
  assert.match(APP, /streamChat\(`chats\/\$\{conv\.id\}\/messages`/, 'a message streams its reply');
  assert.match(APP, /const OWNER_WORDS = \[/, 'the owner\'s words');
});

test('sign-in stays: the public page, passkeys, codes, devices, and pairing Telegram, all reachable', () => {
  for (const name of ['outsidePage', 'signInWithPasskey', 'signInWithCode', 'signInWithRecovery', 'letDeviceIn', 'signOutHere',
    'openPasskeys', 'addPasskey', 'removePasskey', 'makeRecovery', 'confirmWithPasskey', 'openDevices', 'sessionsSection', 'passkeyNudge',
    'telegramPanel', 'openAgents', 'connectAgent']) {
    assert.ok(has(name), `${name} is there`);
  }
  assert.match(APP, /capi\('telegram\/pair', 'POST'/, 'a Telegram pairing code');
  // Each is in the account menu (Agents and Telegram were Access's Agents tab).
  for (const name of ['openPasskeys', 'openDevices', 'letDeviceIn', 'openAgents', 'signOutHere']) assert.match(ACCOUNT_MENU, new RegExp(`\\b${name}\\b`), `${name} is in the account menu`);
  assert.match(APP, /agentsTab\(box, bind\)/, 'the agents and Telegram drawer draws them');
});

test('status stays: the Sparks list, each Spark\'s page, the live line and Activity', () => {
  assert.match(APP, /^PAGES\.spark = function sparkPage\(/m);
  assert.match(APP, /\['overview', 'Overview', 'grid'\], \['workloads', 'Workloads', 'box'\], \['logs', 'Logs', 'logs'\], \['diagnostics', 'Checks', 'clipboard'\]/);
  for (const name of ['shell', 'tickLive', 'openActivity', 'jobRow', 'noticeRow', 'heldRows', 'workflowsFold', 'cablePanel', 'loadStatus', 'connectLive']) {
    assert.ok(has(name), `${name} is there`);
  }
  assert.match(APP, /class: 'spark-link', href: `#\/spark\/\$\{n\.id\}`/, 'the sidebar lists the Sparks');
  assert.match(APP, /onclick: \(\) => openActivity\(\), title: 'What’s been started and stopped'/, 'Activity is in the top bar');
});

test('the page still parses, keeps what the installer reads, and ships every file in UI_FILES', () => {
  assert.doesNotThrow(() => new vm.Script(APP, { filename: 'public/app.js' }));
  assert.match(APP, /^const BUILD = 'dev';$/m, 'the installer stamps the build here');
  assert.match(APP, /^const CONSOLE_API = '\/console\/api\/';$/m, 'deploy/cutover.sh looks for this line');
  assert.match(HTML, /<script src="app\.js" defer><\/script>/);
  const list = INSTALLER.match(/^UI_FILES=\(([^)]*)\)/m);
  assert.ok(list, 'UI_FILES is in deploy/host-on-portal.sh');
  const files = list[1].split(/\s+/).filter(Boolean);
  for (const f of ['index.html', 'app.js', 'styles.css']) assert.ok(files.includes(f), `${f} is shipped`);
  for (const f of files) assert.ok(existsSync(join(PUBLIC, f)), `public/${f} is there`);
});

// What the owner sees of a command Sparkie ran (design A 2.10, step 5): the page's own functions that build its row,
// taken from public/app.js and run here with an h() that builds plain nodes (no test here drives a browser). The
// service builds and masks the five fields (test/work.test.mjs); the page only draws them.
function pageFunctions(...names) {
  const src = names.map(n => {
    const m = new RegExp(`^function ${n}\\([^)]*\\) \\{\\n[\\s\\S]*?^\\}`, 'm').exec(APP);
    assert.ok(m, `${n} is in public/app.js`);
    return m[0];
  }).join('\n');
  const h = (tag, props, ...kids) => {
    const el = { tag, attrs: {}, hidden: false, onclick: null, kids: kids.flat(Infinity).filter(k => k != null && k !== false), setAttribute(k, v) { this.attrs[k] = String(v); } };
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'hidden') el.hidden = true; else if (k === 'onclick') el.onclick = v; else el.attrs[k] = v === true ? '' : String(v);
    }
    return el;
  };
  return vm.runInNewContext(`${src}\n({ ${names.join(', ')} })`, { h, ASSISTANT: 'Sparkie', num: v => typeof v === 'number' && Number.isFinite(v) });
}
const textOf = el => (typeof el === 'string' ? el : el.kids.map(textOf).join(''));

test('a command Sparkie ran is one quiet row of its own, the command on a button; a press shows it whole with the end of what it printed', () => {
  const { toolLines, commandRow } = pageFunctions('commandRow', 'toolLines');
  const LOOK = 'It ran as a look: nothing on Spark 3 was changed and nothing was sent.';
  const look = (line, more = {}) => ({ name: 'run', title: 'Run a command on a Spark', ok: true, ms: 400, change: false, outcome: 'look', where: 'Spark 3',
    line, tail: 'hello from spark 3\nexit 0', root: false, kept: 'j_0123456789ab', look: LOOK, ...more });
  const models = { name: 'running_models', title: 'Running models', ok: true, ms: 300, change: false };
  const ul = toolLines([look('$ cat docs/plain.txt'), look('$ cat docs/plain.txt'), models, models]);
  // Two looks are two rows, never folded; other lookups fold as before.
  assert.equal(ul.kids.length, 3);
  assert.equal(textOf(ul.kids[2]), 'Checked Running models twice · 0.6 s');
  const [btn, shown] = ul.kids[0].kids;
  assert.deepEqual([btn.tag, btn.attrs.type, btn.attrs['aria-expanded']], ['button', 'button', 'false']);
  assert.deepEqual(btn.kids.map(k => [k.tag, textOf(k)]), [['span', 'Spark 3, as a look'], ['code', '$ cat docs/plain.txt']]);
  // Nothing more is on screen until it is pressed: then the line saying it ran as a look (the service's own, not the
  // output), the command and the tail, and where all of it is kept.
  assert.equal(shown.hidden, true);
  btn.onclick();
  assert.deepEqual([shown.hidden, btn.attrs['aria-expanded']], [false, 'true']);
  assert.equal(textOf(shown.kids[0]), LOOK);
  assert.equal(shown.kids[1].tag, 'pre');
  assert.equal(textOf(shown.kids[1]), '$ cat docs/plain.txt\nhello from spark 3\nexit 0');
  assert.match(textOf(shown.kids[2]), /\bj_0123456789ab\b/);
  btn.onclick();
  assert.deepEqual([shown.hidden, btn.attrs['aria-expanded']], [true, 'false']);
  // One that was refused says it didn't run, and keeps nothing; one run as root says so.
  const refused = commandRow(look('$ cat project/server.key', { ok: false, outcome: undefined, tail: 'Not run: project/server.key is a key file', kept: null, look: null }));
  assert.equal(textOf(refused.kids[0]), 'Spark 3$ cat project/server.key' + 'didn’t run');
  assert.equal(refused.kids[1].kids.length, 1, 'no look line and no record when it did not run');
  assert.equal(textOf(commandRow(look('$ apt list --installed', { root: true })).kids[0].kids[0]), 'Spark 3, as root');
  // The live stream copies the five fields onto the step it draws.
  assert.match(APP, /outcome: ev\.outcome, where: ev\.where, line: ev\.line, tail: ev\.tail, root: ev\.root, kept: ev\.kept, look: ev\.look \}\];/);
});

// A7d's read: in a Sparkie turn the page shows a change ask's own lines with its buttons (the path and the old and new
// lines of a write, a run's command and why it is asked), as plain text: never HTML from the text, only for an ask whose
// buttons are there.
test('an ask\'s own lines are shown with its buttons, as plain text', () => {
  const { askLines } = pageFunctions('askLines');
  const text = 'Write this file on Spark 3?\n~/notes/a.html: a new file\n+ <img src=x onerror=alert(1)>\n+ token=$(reboot) (shown whole: what would be hidden here holds signs that run something)\nAsked because Sparkie asks before every change.';
  const el = askLines({ choices: [{ id: 'c1', label: 'Run it', state: 'open', group: 'g1' }], asks: [{ group: 'g1', text }, { group: 'other', text: 'not shown' }] });
  assert.equal(el.tag, 'div');
  assert.equal(el.kids.length, 1);
  assert.equal(el.kids[0].tag, 'pre');
  assert.deepEqual(el.kids[0].kids, [text], 'one text child: the lines as written, never markup');
  assert.equal(askLines({ choices: [], asks: [{ group: 'g1', text }] }), null, 'no buttons, no lines');
  assert.equal(askLines({ choices: [{ id: 'c1', label: 'Run it', state: 'open', group: 'g1' }], asks: [{ group: 'g1', text: { html: '<b>x</b>' } }] }), null, 'only text');
  // (drawn with the reply, before its buttons, and styled as the dangerous ask's command block is: pre-wrapped)
  assert.match(APP, /!mine && !m\.streaming \? askLines\(m\) : null,\n\s*!mine && !m\.streaming \? choiceRow\(m\) : null,/);
  assert.match(CSS, /\.ask-lines pre \{[^}]*white-space: pre-wrap;/);
});

test('a change\'s line under the reply says what its own outcome says: "Started" only for one that started (C-10)', () => {
  const { toolLines } = pageFunctions('commandRow', 'toolLines');
  const step = (outcome, ok = true) => ({ name: 'start_model', title: 'Start a model', ok, change: true, ...(outcome ? { outcome } : {}) });
  const said = outcome => textOf(toolLines([step(outcome)]).kids[0]);
  assert.equal(said('started'), 'Started: Start a model');
  assert.equal(said('already'), 'Nothing to do: Start a model');
  assert.equal(said('already-starting'), 'Already starting: Start a model');
  assert.equal(said('waiting'), 'Waiting: Start a model');
  assert.equal(said('cancelling'), 'Cancelling: Start a model');
  assert.equal(said('saved'), 'Done: Start a model');
  assert.equal(said('needs-ok'), 'Start a model: asked for your OK');
  assert.equal(textOf(toolLines([step('started', false)]).kids[0]), 'Couldn’t: Start a model');
});

test('removing an agent says that nothing it started is cancelled (R9)', () => {
  assert.match(APP, /title: `Remove \$\{k\.name\}\?`, description: 'Its key stops working right away\. Nothing it started is cancelled: its operations and saved workflows finish\. Your other agents keep working\.'/);
});

// Focused behavioral checks run the shipped functions, with only transport, timers and drawing replaced.
function uiFunction(name, indent = '') {
  const re = new RegExp(`^${indent}(?:async )?function ${name}\\([^\\n]*\\) \\{\\n[\\s\\S]*?^${indent}\\}`, 'm');
  const found = APP.match(re);
  assert.ok(found, `${name} exists`);
  return found[0];
}

test('transport loss is a separate observation, and the next job poll can report completion', async () => {
  const terminal = new Set(['completed', 'failed', 'interrupted', 'partial', 'cancelled']);
  const svcJobs = new Map(), notices = [];
  let polls = 0;
  const job = { id: 'j1', type: 'deploy', status: 'running', step: 'Starting' };
  const context = {
    state: { svcJobs, recentJobs: [], following: new Map() }, SVC_LABEL: {}, Date, num: Number.isFinite,
    underWay: j => !terminal.has(j.status), jobPercent: () => null,
    dismissedToasts: new Set(), $: () => null, h: () => null, sleep: async () => {},
    toast: (text, options) => notices.push({ text, ...options }), runLive: () => {},
    loadJobs: () => {}, loadLibrary: () => {}, loadMain: () => {}, loadStatus: () => {},
    capi: async () => { if (++polls === 1) throw Object.assign(new Error('network'), { missing: true }); return { ...job, status: 'completed' }; },
  };
  const follow = vm.runInNewContext(`${uiFunction('followServiceJob')}\nfollowServiceJob`, context);
  assert.equal((await follow(job)).status, 'completed');
  assert.equal(polls, 2);
  assert.ok(!notices.some(n => /failed/i.test(n.text)), JSON.stringify(notices));
  assert.equal(svcJobs.get(job.id).status, 'completed');
  assert.equal(svcJobs.get(job.id).connection, undefined);

  polls = 0; notices.length = 0;
  context.capi = async () => { polls++; throw Object.assign(new Error('gone'), { status: 404 }); };
  const unknown = await follow(job);
  assert.equal(polls, 30, 'a missing job retries a bounded number of reads');
  assert.equal(unknown.status, 'running', 'absence never invents a terminal failure');
  assert.match(unknown.connection, /outcome is unknown/);
  assert.ok(!notices.some(n => /failed/i.test(n.text)));
});

test('fresh terminal job results supersede stale local observations, including old false failures', () => {
  const state = { recentJobs: [{ id: 'j1', status: 'completed', createdAt: '2026-11-16' }],
    svcJobs: new Map([['j1', { id: 'j1', status: 'failed', connection: 'Connection lost', createdAt: '2026-11-16' }]]) };
  const jobs = vm.runInNewContext(`${uiFunction('activityJobs')}\nactivityJobs()`, { state, underWay: j => j.status === 'running' });
  assert.equal(jobs[0].status, 'completed');
  assert.equal(jobs[0].connection, null);
});

test('chat GET recovery follows a jobless answer across a failed read without posting a turn', async () => {
  const c = { conv: { id: 'sc_one', replying: true, messages: [] }, sending: false, waiting: true };
  let watching = null, reads = 0, draws = 0;
  const context = vm.createContext({ c, here: () => true, activityJobs: () => [], underWay: () => false,
    conversationReadDelay: conv => conv.replying ? 2000 : null, waitForRead: async () => {}, loadJobs: async () => {},
    capi: async (path, method = 'GET') => {
      assert.equal(method, 'GET'); assert.equal(path, 'chats/sc_one');
      if (++reads === 1) throw new Error('offline');
      return { id: 'sc_one', replying: reads < 3, messages: reads < 3 ? [] : [{ role: 'assistant', content: 'Saved final answer' }] };
    },
    applySaved: saved => { c.conv = saved; c.waiting = Boolean(saved.replying); draws++; },
  });
  vm.runInContext(`let watching = null; ${uiFunction('watchOps', '  ')}; watchOps('sc_one');`, context);
  await new Promise(setImmediate);
  assert.equal(reads, 3);
  assert.equal(draws, 2);
  assert.equal(c.waiting, false);
  assert.equal(c.conv.messages[0].content, 'Saved final answer');
});

test('an incomplete stream retains its partial answer and requests GET recovery with one POST', async () => {
  for (const broken of ['eof', 'reader-error']) {
    const conv = { id: 'sc_one', messages: [] }, c = { conv, spark: null, draft: 'question' };
    let posts = 0, follows = 0;
    const context = {
      c, state: { main: { data: { node: 'spark1' } } }, disposed: false, layout: { isConnected: true },
      ta: { value: 'question' }, subjectNode: () => null, fleetSnapshot: () => 'snapshot', grow: () => {},
      drawComposer: () => {}, drawHead: () => {}, drawMessages: () => {}, drawSoon: () => {}, loadConsoleChats: () => {},
      here: () => true, watchOps: () => follows++, toast: () => assert.fail('transport must retain the incomplete reply'),
      capi: async () => { throw new Error('offline'); },
      streamChat: async (path, body, event) => {
        posts++; assert.equal(path, 'chats/sc_one/messages');
        event({ type: 'delta', text: 'Partial answer' });
        if (broken === 'reader-error') throw new Error('reader disconnected');
      },
    };
    const send = vm.runInNewContext(`${uiFunction('sendConsole', '  ')}\nsendConsole`, context);
    await send('question');
    assert.equal(posts, 1);
    assert.equal(follows, 1);
    assert.equal(c.conv.replying, true);
    const reply = c.conv.messages.at(-1);
    assert.equal(reply.content, 'Partial answer');
    assert.equal(reply.streaming, true);
    assert.equal(reply.reconnecting, true);
  }
});

test('delayed approvals are read when their digits open, and open choices keep resolution current', () => {
  const delay = vm.runInNewContext(`${uiFunction('conversationReadDelay')}\nconversationReadDelay`);
  const conv = { messages: [{ opensAt: new Date(11000).toISOString(), choices: [{ state: 'open' }] }] };
  assert.equal(delay(conv, 10000), 1050);
  assert.equal(delay(conv, 11000), 5000, 'expiry and a Telegram resolution remain polled');
  conv.messages[0].choices[0].state = 'gone';
  assert.equal(delay(conv, 12000), null, 'resolved approval stops reads');
  assert.equal(delay({ replying: true, messages: [] }, 12000), 2000, 'no operation is needed to follow a reply');
  assert.match(APP, /type \$\{m\.pair\}, then press \$\{d\.yes\}/);
  assert.match(APP, /viewCleanup\.push\(\(\) => \{[\s\S]*?cancelReadWait\?\.\(\);[\s\S]*?c\.waiting = false;[\s\S]*?removeEventListener\('visibilitychange', onVisible\)/);
});

test('hub identity is independent of the public hostname and pair capacity excludes protected or unverified links', () => {
  const h = (tag, props, ...kids) => ({ tag, props, kids: kids.flat(Infinity).filter(x => x != null && x !== false) });
  const state = { boot: { hubId: 'spark1', computeIds: ['spark2', 'spark3'] }, connections: { portalUrl: 'https://custom.example/', nodes: [{ alias: 'old-host', id: 'spark2' }] } };
  const f = vm.runInNewContext(`${uiFunction('portalHostId')}\n${uiFunction('pairRow')}\n({portalHostId, pairRow})`, {
    state, h, icon: () => h('i'), roomFor: () => 180, workloads: () => [], node: id => ({ id }), nodeName: id => id,
  });
  assert.equal(f.portalHostId(), 'spark1');
  assert.doesNotMatch(textOf(f.pairRow({ a: 'spark1', b: 'spark3', tested: true })), /fits a model/);
  assert.doesNotMatch(textOf(f.pairRow({ a: 'spark2', b: 'spark3', tested: false })), /fits a model/);
  assert.match(textOf(f.pairRow({ a: 'spark2', b: 'spark3', tested: false })), /unverified/);
  assert.match(textOf(f.pairRow({ a: 'spark2', b: 'spark3', tested: true })), /fits a model up to about 180 GB/);
  assert.doesNotMatch(uiFunction('linkMap'), /Direct cables that work/);
  assert.match(uiFunction('linkMap'), /'tested' : 'unverified'/);
  assert.match(APP, /stat\('Containers running', 'box'\)/);
  assert.match(APP, /busySparks\.reduce\(\(t, n\) => t \+ \(n\.runningContainers \|\| \[\]\)\.length, 0\)/);
});

test('only an explicit healthy power-off record makes an unreachable Spark peacefully asleep', () => {
  const condition = vm.runInNewContext(`${uiFunction('condition')}\ncondition`, { state: { status: {} }, isStale: () => false, workloads: () => [] });
  assert.equal(condition({ reachable: false, state: 'offline' }), 'offline');
  assert.equal(condition({ reachable: false, state: 'offline', asleep: true }), 'offline');
  assert.equal(condition({ reachable: false, state: 'offline', asleep: true, poweredOff: { at: 'now' } }), 'asleep');
  assert.equal(condition({ reachable: false, state: 'offline', asleep: true, poweredOff: { problem: 'shutdown failed' } }), 'offline');
});

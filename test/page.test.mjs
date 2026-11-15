// Covers: The page is chat, sign-in and status (the one page, milestone 4; E10b). Home, Models, Files and Access are
// off it, with the page code only they used; the service's routes behind them stay. File reads only, like
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

test('Home, Models, Files and Access are off the page: no view, no nav entry, no link to one', () => {
  for (const view of ['fleet', 'models', 'files', 'access']) {
    assert.doesNotMatch(APP, new RegExp(`^PAGES\\.${view}\\s*=`, 'm'), `no ${view} view`);
    assert.doesNotMatch(APP, new RegExp(`#/${view}\\b`), `no link to #/${view}`);
    assert.doesNotMatch(APP, new RegExp(`\\bgo\\(['\`]${view}\\b`), `nothing goes to ${view}`);
  }
  for (const label of ['Home', 'Models', 'Files', 'Access']) assert.doesNotMatch(NAV, new RegExp(`'${label}'`), `${label} is not in the nav`);
  // The code only they used, and the three late-answer faults it held (A-10 in the start dialog's pick, A-11 in the
  // file browser, A-12 in its uploads).
  for (const name of ['sparkCard', 'runningTab', 'libraryTab', 'findMoreTab', 'openDeploy', 'openDeployPicker', 'filesBrowser', 'peopleTab', 'memberAccess', 'personDialog']) {
    assert.ok(!has(name), `${name} is gone`);
  }
  assert.doesNotMatch(APP, /function uploadFiles\(/, 'no uploads from the page');
  // Their styles went with them.
  for (const cls of ['spark-card', 'sc-work', 'rc-options', 'lib-table', 'invite-panel', 'cap-table', 'segmented', 'dropzone']) {
    assert.doesNotMatch(CSS, new RegExp(`\\.${cls}\\b`), `no .${cls} in styles.css`);
  }
});

test('old addresses of the four views open the chat, which is where the page starts', () => {
  assert.match(APP, /view: parts\[0\] \|\| 'sparkie'/, 'an empty address is the chat');
  for (const view of ['fleet', 'home', 'models', 'recipes', 'files', 'access', 'sharing']) {
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

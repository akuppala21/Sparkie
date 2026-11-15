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

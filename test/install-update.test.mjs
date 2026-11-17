// Covers: install_update (design C step 5, R58, R54): from chat, the newest tested build is installed as a dangerous
// ask. The ask is a message of its own: INSTALLS SPARK CONSOLE, the tree with the build its code is (worked out from
// the three code files, as check does), when it was tested, the files that differ, whether it changes what the brain
// reads with the eval "not run" and that Sparkie then asks before every change. No plain question comes before it.
// Nothing runs before the yes with its two digits; the yes starts pull.sh install <tree> (with ASSUME_YES=1), and the
// result pull.sh writes is told in the chat that asked (kept, refused); after a kept one the self-test is started once.
// Nothing newer: said, nothing asked. An agent's
// own call shows nothing and is told the owner asks in their own chat; the tree can't be passed in. The seventh read's
// lines: a build that changes only the eval's cases is said to (with the eval for it on those, and that Sparkie then
// asks before every change); when the installed commit can't be told nothing is asked (the final read's U1); "tested"
// names its day; a second yes while an install asked from chat is going is refused, and the first one's result is
// still told; a yes after that very tree was installed another way says so; a check at the yes that takes longer than
// the press waits is answered at once and what comes of it is told in the chat; install_update is no saved
// workflow's step; the unit it runs in has a time limit of its own. The eighth read's: an asked time ahead of the
// clock counts as old. The final read's: a yes after a build whose commit can't be told was installed says that; a
// way back that couldn't put the build from before back whole is told as that.
// The service runs pull.sh check --json against a stand-in GitHub (a bare repository with tested/ tags as the mark job
// makes them); `install` is a stand-in that writes the console's update-result.json as pull.sh would, so the
// install itself (test/pull.test.mjs covers it) never runs here and the console never restarts.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { writeFileSync, readFileSync, mkdirSync, mkdtempSync, copyFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { T, useFleet, api, call, createActKey, newChat, say, chatMessages, waitFor, auditLines, REPO, SLOW } from './lib.mjs';

const TOKEN = `gt_${randomBytes(16).toString('hex')}`, REPO_NAME = 'someone/spark-console';
const temps = [];
const temp = p => { const d = mkdtempSync(join(tmpdir(), p)); temps.push(d); return d; };
after(() => { for (const d of temps) rmSync(d, { recursive: true, force: true }); });

// GitHub's stand-in: main's commits (each with the three code files) and the tested/ tags the mark job makes.
const REAL_GIT = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
const GH = temp('sct-inst-gh-'), WORK = temp('sct-inst-w-');
const GIT_ENV = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@test',
  GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@test' };
const g = (args, { input, env = {} } = {}) => {
  const r = spawnSync(REAL_GIT, ['-C', GH, ...args], { encoding: 'utf8', env: { ...GIT_ENV, ...env }, input });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};
spawnSync(REAL_GIT, ['init', '-q', '--bare', GH], { env: GIT_ENV });
const CODE = ['server.mjs', 'dig.mjs', 'passkey.mjs'];
let head = null, n = 0;
function commit(subject, extra = {}) {
  const env = { GIT_INDEX_FILE: join(WORK, `index-${n}`) };
  const add = (path, text) => g(['update-index', '--add', '--cacheinfo', `100644,${g(['hash-object', '-w', '--stdin'], { input: text })},${path}`], { env });
  const code = Object.fromEntries(CODE.map(f => [f, `// ${f}, build ${n}\n`]));
  for (const [f, text] of Object.entries(code)) add(`service/${f}`, text);
  for (const [path, text] of Object.entries(extra)) add(path, text);
  const tree = g(['write-tree'], { env }), c = g(['commit-tree', tree, ...(head ? ['-p', head] : []), '-m', subject]);
  g(['update-ref', 'refs/heads/main', c]);
  head = c; n++;
  return { commit: c, tree, t12: tree.slice(0, 12), code };
}
// A build as every install and the mark job define it: sha256 of server.mjs, dig.mjs and passkey.mjs, worked out here.
const buildOf = c => createHash('sha256').update(CODE.map(f => c.code[f]).join('')).digest('hex').slice(0, 12);
function mark(c, reads, evalSet = null) {
  const env = { GIT_INDEX_FILE: join(WORK, `index-t${n++}`) };
  const lock = JSON.stringify({ build: buildOf(c), tree: c.tree, commit: c.commit, testedAt: '2026-11-15T10:00:00.000Z', brainReads: reads, versions: {}, ...(evalSet ? { evalSet } : {}) });
  g(['read-tree', c.commit], { env });
  g(['update-index', '--add', '--cacheinfo', `100644,${g(['hash-object', '-w', '--stdin'], { input: lock })},service/workflows.lock.json`], { env });
  g(['update-ref', `refs/tags/tested/${c.t12}`, g(['commit-tree', g(['write-tree'], { env }), '-p', c.commit, '-m', `Tested: tree ${c.t12}`])]);
}
const READS_A = 'a'.repeat(64), READS_B = 'b'.repeat(64);
const c1 = commit('The build installed now');
mark(c1, READS_A);
const c2 = commit('Make the page calmer', { 'public/app.js': '// calmer\n' });
mark(c2, READS_B);

// Spark 2's home: pull.sh where every install leaves it, set up; its install is a stand-in that writes the result as
// pull.sh would (HOME/install-result names it: kept by default), and writes down how it was started.
let HOME, STATE;
const installed = c => writeFileSync(join(HOME, 'spark-console-service', 'workflows.lock.json'), JSON.stringify({ build: buildOf(c), tree: c.tree, commit: c.commit, brainReads: READS_A }));
// (a third dangerous ask inside ten minutes is sent a minute late: not here, as in danger.test.mjs; the yes answers the
// press within YES_WAIT_S)
const YES_WAIT_S = 10 * SLOW;
const ENV = { SPARK_CONSOLE_REPO_URL: GH, SPARK_CONSOLE_DANGER_LATE_MS: '1', SPARK_CONSOLE_UPDATE_YES_WAIT_S: String(YES_WAIT_S) };
useFleet({ watchMs: 60000, env: ENV, prepare: ({ dir, stateDir }) => {
  HOME = join(dir, 'home');
  STATE = stateDir;
  ENV.SPARK_CONSOLE_SECRETS_FILE = join(HOME, '.config', 'spark-console', 'secrets.json');
  const share = join(HOME, '.local', 'share', 'spark-console');
  for (const d of [join(HOME, '.config', 'spark-console'), share, join(HOME, 'spark-console-service')]) mkdirSync(d, { recursive: true, mode: 0o700 });
  writeFileSync(join(HOME, '.config', 'spark-console', 'secrets.json'), JSON.stringify({ github: { repo: REPO_NAME, token: TOKEN } }), { mode: 0o600 });
  copyFileSync(join(REPO, 'deploy', 'pull.sh'), join(share, 'pull-real.sh'));
  // ($HOME/install-hold: the install waits while it is there; $HOME/check-slow: a check takes that many seconds more)
  writeFileSync(join(share, 'pull.sh'), `#!/bin/bash
if [ "$1" = check ] && [ -e "$HOME/check-slow" ]; then sleep "$(cat "$HOME/check-slow")"; fi
if [ "$1" = install ]; then
  printf '%s ASSUME_YES=%s\\n' "$*" "\${ASSUME_YES:-}" >> "$HOME/install.log"
  while [ -e "$HOME/install-hold" ]; do sleep 0.2; done
  r=$(cat "$HOME/install-result" 2>/dev/null || echo kept)
  printf '{"tree":"%s","build":"%s","result":"%s","why":"the stand-in install said %s","at":"%s"}\\n' "$2" "$(cat "$HOME/install-build" 2>/dev/null)" "$r" "$r" "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)" > '${join(stateDir, 'update-result.json')}'
  exit 0
fi
exec bash "$(dirname "$0")/pull-real.sh" "$@"
`, { mode: 0o700 });
  spawnSync(REAL_GIT, ['init', '-q', '--bare', join(share, 'repo.git')], { env: GIT_ENV });
  installed(c1);
} });

const script = rules => writeFileSync(join(T.fleet.dir, 'model-script.json'), JSON.stringify(rules));
const installLog = () => (existsSync(join(HOME, 'install.log')) ? readFileSync(join(HOME, 'install.log'), 'utf8') : '');
const ASK_INSTALL = [{ match: '^install the newest build$', rounds: [[{ name: 'install_update', arguments: {} }]] }];
async function asking() {
  script(ASK_INSTALL);
  const chat = await newChat();
  await say(chat, 'install the newest build');
  const msgs = await chatMessages(chat), ask = msgs.findLast(m => m.danger);
  const shown = (await api(`/chats/${chat}`)).json.messages.find(m => m.danger?.ask === ask?.danger.ask);
  return { chat, msgs, ask, yes: ask?.choices.find(c => c.pair), no: ask?.choices.find(c => c.label === 'No'), pair: shown?.pair };
}
const press = (chat, choice, pair) => api(`/chats/${chat}/choose`, { method: 'POST', body: { choice, ...(pair ? { pair } : {}) } });

describe('install_update', { concurrency: 1 }, () => {
  test('the ask is a dangerous one of its own: the tree with the build its code is, the files that differ, what the brain reads; no plain question before it, nothing installed', async () => {
    const a = await asking();
    assert.ok(a.ask, JSON.stringify(a.msgs.slice(-3)));
    const text = a.ask.content;
    assert.match(text, /^INSTALLS SPARK CONSOLE on [^\n]+\nYou asked for this\./);
    assert.match(text, new RegExp(`The tree ${c2.t12} \\(build ${buildOf(c2)}\\), tested \\d{4}-\\d\\d-\\d\\d \\d\\d:\\d\\d\\.`));
    assert.match(text, /files differ from the build installed now: .*public\/app\.js/);
    assert.match(text, /It changes what Sparkie’s brain reads; the eval for it: not run\. Until the eval’s result is kept, Sparkie asks you before every change\./);
    assert.equal(a.yes.label, 'Install it');
    assert.ok(!a.msgs.some(m => (m.choices || []).some(c => /Install the newest tested build\?/.test(c.label))), 'no plain question first');
    assert.equal(installLog(), '');
    assert.equal((await press(a.chat, a.no.id)).status, 200);
  });

  test('its yes with the two digits starts pull.sh install <tree>, and the result pull.sh writes is told in the chat that asked', async () => {
    writeFileSync(join(HOME, 'install-build'), buildOf(c2));
    const a = await asking();
    const r = await press(a.chat, a.yes.id, a.pair);
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.outcome, 'started', r.text);
    await waitFor(() => installLog().includes(`install ${c2.t12} ASSUME_YES=1`), { timeout: 10000, what: 'pull.sh install started' });
    await waitFor(async () => (await chatMessages(a.chat)).some(m => m.content === `Installed: build ${buildOf(c2)} (tree ${c2.t12}) is running. the stand-in install said kept`),
      { timeout: 30000, what: 'the result told in the chat' });
    assert.ok(!existsSync(join(STATE, 'update-asked.json')), 'told once');
    // (the second piece: after a kept install, the self-test is started once, as the owner's; it wakes nothing)
    await waitFor(async () => (await chatMessages(a.chat)).some(m => /self-test/i.test(String(m.content || '')) && m !== a.ask), { timeout: 30000, what: 'the self-test after the install' });
    assert.equal(auditLines().filter(l => l.action === 'self_test' && l.via === 'update').length, 1, 'once');
    installed(c2);
  });

  test('a refused install is told as refused, nothing changed', async () => {
    const c3 = commit('Another build');
    mark(c3, READS_A);
    writeFileSync(join(HOME, 'install-result'), 'refused');
    try {
      const a = await asking();
      assert.equal((await press(a.chat, a.yes.id, a.pair)).json.outcome, 'started');
      await waitFor(async () => (await chatMessages(a.chat)).some(m => m.content === `The install of tree ${c3.t12} was refused, and nothing changed: the stand-in install said refused`),
        { timeout: 30000, what: 'the refusal told' });
    } finally { rmSync(join(HOME, 'install-result'), { force: true }); }
    installed(c3);
  });

  test('nothing newer: said, and nothing is asked', async () => {
    script(ASK_INSTALL);
    const chat = await newChat();
    const before = installLog();
    await say(chat, 'install the newest build');
    const msgs = await chatMessages(chat);
    assert.ok(!msgs.some(m => m.danger), 'no ask');
    assert.equal(installLog(), before);
  });

  test('an agent’s own call asks nothing and shows nothing; the tree can’t be passed in', async () => {
    const c4 = commit('One more build');
    mark(c4, READS_A);
    const k = await createActKey('inst');
    const r = await call(k.token, 'install_update', {});
    assert.match(r.text, /Only the owner can answer this one, and nothing was done or shown anywhere/);
    const bad = await call(k.token, 'install_update', { tree: c4.t12 });
    assert.ok(bad.isError, bad.text);
    assert.equal((await api('/actions/install_update', { method: 'POST', body: { tree: c4.t12 } })).status, 400);
    assert.ok(!installLog().includes(c4.t12));
  });

  // (the seventh read of C5: Later 2)
  test('a build that changes only the eval’s cases is said to: the eval for it on those, not run, and Sparkie asks before every change after it', async () => {
    const c5 = commit('New eval cases');
    mark(c5, READS_A, { version: 'c'.repeat(64), file: 'test/eval/cases.json', cases: [['one', 'act'], ['two', 'ask']] });
    const a = await asking();
    assert.ok(a.ask, JSON.stringify(a.msgs.slice(-3)));
    assert.match(a.ask.content, /It doesn’t change what Sparkie’s brain reads, but it changes the eval’s cases \(2 now\); the eval for it with those: not run\. Until the eval’s result is kept, Sparkie asks you before every change\./);
    assert.equal((await press(a.chat, a.no.id)).status, 200);
  });

  // (Later 1, turned round by the final read's U1: an installed commit that can't be told is no longer taken as older
  // than the newest tested build, so nothing is asked; whenever a build is offered, what differs is known)
  test('when the installed build’s commit can’t be told (its lock’s commit isn’t in Spark 2’s copy and its tree isn’t on main), nothing is asked and it says so; with its tree on main, the ask names what differs', async () => {
    const lock = join(HOME, 'spark-console-service', 'workflows.lock.json'), was = readFileSync(lock, 'utf8');
    writeFileSync(lock, JSON.stringify({ build: 'd'.repeat(12), tree: 'd'.repeat(40), commit: 'd'.repeat(40), brainReads: READS_A }));
    const chats = [];
    let ended = false;
    try {
      script(ASK_INSTALL);
      const chat = await newChat();
      chats.push(chat);
      const before = installLog();
      const r = await say(chat, 'install the newest build');
      assert.ok(!(await chatMessages(chat)).some(m => m.danger), 'no ask');
      assert.match(r.text, /install_update said: .*whether it is newer than the build installed now can’t be told/, r.text);
      assert.equal(installLog(), before);
      // (its lock's commit isn't in the copy, but its tree is on main: placed there, and what differs is named)
      writeFileSync(lock, JSON.stringify({ ...JSON.parse(was), commit: 'd'.repeat(40) }));
      const a = await asking();
      chats.push(a.chat);
      assert.ok(a.ask, JSON.stringify(a.msgs.slice(-3)));
      assert.match(a.ask.content, /files differ from the build installed now: .*service\/server\.mjs/);
      assert.doesNotMatch(a.ask.content, /isn’t known/);
      assert.equal((await press(a.chat, a.no.id)).status, 200);
      ended = true;
    } finally {
      writeFileSync(lock, was);
      // (on a failure, an ask left open is closed, so it doesn't hold up the tests after this one)
      for (const c of ended ? [] : chats) {
        const no = (await chatMessages(c)).findLast(m => m.danger)?.choices?.find(x => x.label === 'No');
        if (no) await press(c, no.id);
      }
    }
  });

  // (Later 4)
  test('a second yes while an install asked from chat is going is refused in plain words, and the first one’s result is still told', async () => {
    const c6 = commit('Build six');
    mark(c6, READS_A);
    writeFileSync(join(HOME, 'install-result'), 'refused');
    writeFileSync(join(HOME, 'install-hold'), '');
    let a;
    try {
      a = await asking();
      assert.equal((await press(a.chat, a.yes.id, a.pair)).json.outcome, 'started');
      await waitFor(() => installLog().includes(`install ${c6.t12}`), { timeout: 10000, what: 'the first install started' });
      const b = await asking();
      assert.ok(b.ask, JSON.stringify(b.msgs.slice(-3)));
      const r = await press(b.chat, b.yes.id, b.pair);
      assert.equal(r.status, 200, r.text);
      assert.match(r.json.message.content, new RegExp(`^Couldn’t do “Install it”: An install you said yes to is still going \\(tree ${c6.t12}, since \\d{4}-\\d\\d-\\d\\d \\d\\d:\\d\\d\\): its result is said in the chat that asked it\\. Nothing else was installed; ask again once it is told\\.$`));
      assert.equal(installLog().split('\n').filter(l => l.startsWith(`install ${c6.t12}`)).length, 1, 'one install');
      assert.ok(existsSync(join(STATE, 'update-asked.json')), 'the first one is still waited for');
    } finally { rmSync(join(HOME, 'install-hold'), { force: true }); }
    try {
      await waitFor(async () => (await chatMessages(a.chat)).some(m => m.content === `The install of tree ${c6.t12} was refused, and nothing changed: the stand-in install said refused`),
        { timeout: 30000, what: 'the first one’s result told' });
    } finally { rmSync(join(HOME, 'install-result'), { force: true }); }
  });

  // (Later 9)
  test('a yes after that very tree was installed another way says so; nothing is installed', async () => {
    const c7 = commit('Build seven');
    mark(c7, READS_A);
    const a = await asking();
    assert.ok(a.ask, JSON.stringify(a.msgs.slice(-3)));
    installed(c7);
    const r = await press(a.chat, a.yes.id, a.pair);
    assert.equal(r.status, 200, r.text);
    assert.match(r.json.message.content, new RegExp(`^Couldn’t do “Install it”: Tree ${c7.t12} is the one installed now: it was installed another way after you were asked \\(by hand on Spark 2, say\\)\\. Nothing was installed\\.$`));
    assert.ok(!installLog().includes(c7.t12));
  });

  // (Later 3)
  test('a check at the yes that takes longer than the press waits: answered at once, and what comes of it is told in the chat that asked', async () => {
    const c8 = commit('Build eight');
    mark(c8, READS_A);
    const a = await asking();
    assert.ok(a.ask, JSON.stringify(a.msgs.slice(-3)));
    // (by the time the slow check ends a newer tested build is out, so the yes is refused: after the press stopped waiting)
    const c9 = commit('Build nine');
    mark(c9, READS_A);
    writeFileSync(join(HOME, 'check-slow'), String(YES_WAIT_S + 5));
    try {
      const r = await press(a.chat, a.yes.id, a.pair);
      assert.equal(r.status, 200, r.text);
      assert.equal(r.json.outcome, 'pending', r.text);
      assert.match(r.json.message.content, new RegExp(`GitHub is still being asked whether tree ${c8.t12} is still the newest tested build\\. What comes of it is said here\\.`));
      await waitFor(async () => (await chatMessages(a.chat)).some(m => m.content === `The install of tree ${c8.t12} didn’t start: The newest tested build isn’t the one you were asked about any more (${c9.t12}), so nothing was installed. Ask again.`),
        { timeout: (YES_WAIT_S + 60) * 1000, what: 'the refusal told in the chat' });
    } finally { rmSync(join(HOME, 'check-slow'), { force: true }); }
    assert.ok(!installLog().includes(c8.t12));
  });

  // (Later 5)
  test('install_update can’t be a step in a saved workflow', async () => {
    const k = await createActKey('wfi');
    const r = await call(k.token, 'save_workflow', { title: 'install the update', steps: [{ action: 'install_update', args: {} }] });
    assert.equal(r.isError, true, r.text);
    assert.match(r.text, /Step 1: install_update can’t be a step in a saved workflow\./);
  });

  // (Later 7)
  test('the unit an install from chat runs in has a time limit of its own: longer than the way back’s 30 minutes, under the hour and a half the chat waits', () => {
    const src = readFileSync(join(REPO, 'service', 'src', '21-updates.mjs'), 'utf8');
    assert.match(src, /'--unit', 'spark-console-pull-install', '-p', `RuntimeMaxSec=\$\{UPD_UNIT_MAX_S\}`/);
    const max = Number(/const UPD_UNIT_MAX_S = (\d+);/.exec(src)?.[1]);
    assert.ok(max > 30 * 60 && max < 90 * 60, String(max));
  });

  // (the eighth read of C5, Later 2)
  test('an install asked from chat whose time is ahead of the clock isn’t waited for: said in its chat, and no yes is refused for it', async () => {
    const chat = await newChat(), tree = 'e'.repeat(12);
    writeFileSync(join(STATE, 'update-asked.json'), JSON.stringify({ tree, build: tree, conv: chat, channel: null, at: new Date(Date.now() + 86400000).toISOString() }), { mode: 0o600 });
    await waitFor(async () => (await chatMessages(chat)).some(m => m.content === `The install of tree ${tree} isn’t waited for any more: the time it was asked is ahead of Spark 2’s clock. Look on Spark 2: ~/.local/state/spark-console/update-result.json.`),
      { timeout: 30000, what: 'said in its chat' });
    assert.ok(!existsSync(join(STATE, 'update-asked.json')), 'no longer refuses a yes');
  });

  // (the final read's follow-up: the yes used to say "isn’t the one you were asked about any more", which wasn't so)
  test('a yes after a build whose commit can’t be told was installed another way says that; nothing is installed', async () => {
    const c10 = commit('Build ten');
    mark(c10, READS_A);
    const lock = join(HOME, 'spark-console-service', 'workflows.lock.json'), was = readFileSync(lock, 'utf8');
    const a = await asking();
    assert.ok(a.ask, JSON.stringify(a.msgs.slice(-3)));
    let pressed = false;
    try {
      // (installed from the Mac meanwhile, with a lock that names no tree or commit)
      writeFileSync(lock, JSON.stringify({ build: 'e'.repeat(12), brainReads: READS_A }));
      const r = await press(a.chat, a.yes.id, a.pair);
      pressed = true;
      assert.equal(r.status, 200, r.text);
      assert.equal(r.json.message.content, `Couldn’t do “Install it”: Whether tree ${c10.t12} is newer than the build installed now can’t be told any more: a build was installed another way after you were asked (from the Mac, say), and its lock names no commit or tree on main. Nothing was installed.`);
      assert.ok(!installLog().includes(c10.t12));
    } finally {
      writeFileSync(lock, was);
      if (!pressed) await press(a.chat, a.no.id);
    }
  });

  // (the final read with Astra, A-13: when the way back couldn't put the build from before back whole, the chat was
  // told "so the build from before is back")
  test('a result whose way back couldn’t put the build from before back whole is told as that, never as “the build from before is back”', async () => {
    const chat = await newChat(), tree = 'f'.repeat(12);
    writeFileSync(join(STATE, 'update-asked.json'), JSON.stringify({ tree, build: tree, conv: chat, channel: null, at: new Date(Date.now() - 2000).toISOString() }), { mode: 0o600 });
    const why = 'the build from before couldn\'t be put back whole, and its copy is kept (make room if the disk is full, then run bash ~/.local/share/spark-console/update-guard/update-guard.sh put-back hand); if it can never go back, bash ~/.local/share/spark-console/update-guard/update-guard.sh disarm keeps the build that runs now (the build from before can then be had only from an install snapshot); nothing confirmed the new build through the real address in time; the build answering now is ' + tree;
    writeFileSync(join(STATE, 'update-result.json'), JSON.stringify({ tree, build: tree, result: 'not kept', why, at: new Date().toISOString() }));
    await waitFor(async () => (await chatMessages(chat)).some(m => m.content === `The install of tree ${tree} wasn’t kept, and its way back is still armed: the build from before isn’t back. ${why}`),
      { timeout: 30000, what: 'said in its chat' });
    assert.ok(!(await chatMessages(chat)).some(m => /so the build from before is back/.test(String(m.content || ''))));
  });

  // (the final read of round two, S-3: the timer's put-back and one by hand write their own reason first, and the chat
  // read only pull.sh's words. Now both scripts mark the result, and the chat reads the mark)
  test('a result whose way back stays armed is told as that from its mark, whoever wrote it (the timer’s put-back too), with both ways on', async () => {
    for (const [tree, why] of [['c'.repeat(12), 'nothing confirmed the new build through the real address in time; The build from before the update couldn\'t be put back whole: it couldn\'t be copied back (is the disk full?), so this run changed none of its files. Its copy is kept, and the way back stays armed. To go on: put it back again'],
      ['d'.repeat(12), 'nothing confirmed the new build through the real address in time; said in other words']]) {
      const chat = await newChat();
      writeFileSync(join(STATE, 'update-asked.json'), JSON.stringify({ tree, build: tree, conv: chat, channel: null, at: new Date(Date.now() - 2000).toISOString() }), { mode: 0o600 });
      writeFileSync(join(STATE, 'update-result.json'), JSON.stringify({ tree, build: tree, result: 'not kept', why, wayBackArmed: true, at: new Date().toISOString() }));
      const told = await waitFor(async () => (await chatMessages(chat)).find(m => String(m.content || '').startsWith(`The install of tree ${tree} wasn’t kept`)), { timeout: 30000, what: 'said in its chat' });
      assert.ok(told.content.startsWith(`The install of tree ${tree} wasn’t kept, and its way back is still armed: the build from before isn’t back. ${why} `), told.content);
      assert.match(told.content, /bash ~\/\.local\/share\/spark-console\/update-guard\/update-guard\.sh put-back hand.*bash ~\/\.local\/share\/spark-console\/update-guard\/update-guard\.sh disarm/);
      assert.doesNotMatch(told.content, /so the build from before is back/);
    }
  });

  // (S-4: nothing in the service looked at a way back left armed)
  test('a way back still armed after its time is on the needs-you list, with both ways on; one armed just now is not', async () => {
    const g = join(HOME, '.local', 'share', 'spark-console', 'update-guard');
    const needs = async () => (await api('/actions/fleet_status', { method: 'POST', body: {} })).json.needsOwner || [];
    const guard = at => writeFileSync(join(g, 'guard'), `tree=aaaaaaaaaaaa\nbuild=bbbbbbbbbbbb\nfrom=cccccccccccc\npgid=2147483646\nboot=x\nat=${at}\n`);
    mkdirSync(g, { recursive: true });
    try {
      guard(Math.floor(Date.now() / 1000) - 3600);
      const line = (await needs()).find(l => /way back is still armed/.test(l));
      assert.match(line || '', /^An update’s way back is still armed since \d{4}-\d\d-\d\d \d\d:\d\d: the build from before isn’t back\. On Spark 2, put it back again .*update-guard\.sh put-back hand\. Or, if it can never go back, keep the build that runs now: bash \S+update-guard\.sh disarm/, JSON.stringify(await needs()));
      guard(Math.floor(Date.now() / 1000));
      assert.ok(!(await needs()).some(l => /way back is still armed/.test(l)), 'not while its timer may still put it back');
    } finally { rmSync(g, { recursive: true, force: true }); }
  });
});

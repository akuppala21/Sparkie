// Covers: install_update (design C step 5, R58, R54): from chat, the newest tested build is installed as a dangerous
// ask. The ask is a message of its own: INSTALLS SPARK CONSOLE, the tree with the build its code is (worked out from
// the three code files, as check does), when it was tested, the files that differ, whether it changes what the brain
// reads with the eval "not run" and that Sparkie then asks before every change. No plain question comes before it.
// Nothing runs before the yes with its two digits; the yes starts pull.sh install <tree> (with ASSUME_YES=1), and the
// result pull.sh writes is told in the chat that asked (kept, refused); after a kept one the self-test is started once.
// Nothing newer: said, nothing asked. An agent's
// own call shows nothing and is told the owner asks in their own chat; the tree can't be passed in.
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
import { T, useFleet, api, call, createActKey, newChat, say, chatMessages, waitFor, auditLines, REPO } from './lib.mjs';

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
function mark(c, reads) {
  const env = { GIT_INDEX_FILE: join(WORK, `index-t${n++}`) };
  const lock = JSON.stringify({ build: buildOf(c), tree: c.tree, commit: c.commit, testedAt: '2026-11-15T10:00:00.000Z', brainReads: reads, versions: {} });
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
const ENV = { SPARK_CONSOLE_REPO_URL: GH };
useFleet({ watchMs: 60000, env: ENV, prepare: ({ dir, stateDir }) => {
  HOME = join(dir, 'home');
  STATE = stateDir;
  ENV.SPARK_CONSOLE_SECRETS_FILE = join(HOME, '.config', 'spark-console', 'secrets.json');
  const share = join(HOME, '.local', 'share', 'spark-console');
  for (const d of [join(HOME, '.config', 'spark-console'), share, join(HOME, 'spark-console-service')]) mkdirSync(d, { recursive: true, mode: 0o700 });
  writeFileSync(join(HOME, '.config', 'spark-console', 'secrets.json'), JSON.stringify({ github: { repo: REPO_NAME, token: TOKEN } }), { mode: 0o600 });
  copyFileSync(join(REPO, 'deploy', 'pull.sh'), join(share, 'pull-real.sh'));
  writeFileSync(join(share, 'pull.sh'), `#!/bin/bash
if [ "$1" = install ]; then
  printf '%s ASSUME_YES=%s\\n' "$*" "\${ASSUME_YES:-}" >> "$HOME/install.log"
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
    assert.match(text, /^INSTALLS SPARK CONSOLE on /);
    assert.match(text, new RegExp(`The tree ${c2.t12} \\(build ${buildOf(c2)}\\), tested \\d\\d:\\d\\d\\.`));
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
});

// Covers: Immutable brain images resolve both Docker image stores to a verified local configuration ID, refuse a moved
// tag, and start offline without pulling. Fresh-install desire is explicit and preserves saved Stop. Shared cache blobs
// accept readable regular files inside the trusted cache while refusing outside configuration, folders and entry links.
import './file-limit.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const source = name => readFileSync(new URL(`../service/src/${name}`, import.meta.url), 'utf8');
const main = source('13-main-model.mjs'), ground = source('01-setup.mjs');
const lift = (src, head) => { const at = src.indexOf(head); assert.ok(at >= 0, head); return src.slice(at, src.indexOf('\n}\n', at) + 2); };
const q = s => `'${String(s).replace(/'/g, `'\\''`)}'`;
const imageFns = new Function('q', `${lift(main, 'function mainImageRef(')}\n${lift(main, 'function mainImageScript(')}\nreturn { mainImageRef, mainImageScript };`)(q);
const digest = `sha256:${'a'.repeat(64)}`, config = `sha256:${'b'.repeat(64)}`, moved = `sha256:${'c'.repeat(64)}`;
const setup = { image: 'registry.example:5000/brain:current', imageId: digest };
const ref = `registry.example:5000/brain@${digest}`;
function resolveImage(metadata, cfg = setup) {
  const docker = `docker() { [ "$1 $2" = 'image inspect' ] || return 97; case "\${@: -1}" in\n${Object.entries(metadata).map(([candidate, line]) => `${q(candidate)}) printf '%s\\n' ${q(line)} ;;`).join('\n')}\n*) return 1 ;; esac; }`;
  const r = spawnSync('bash', ['-c', `${docker}\n${imageFns.mainImageScript(cfg)}\nprintf '%s' "$img"`], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
}
test('A31: both local image stores resolve by immutable metadata; a moved tag cannot substitute', () => {
  assert.equal(resolveImage({ [digest]: `${digest} ` }), digest, 'classic configuration ID');
  assert.equal(resolveImage({ [setup.image]: `${config} ${ref}` }), config, 'registry digest differs from configuration ID');
  assert.equal(resolveImage({ [ref]: `${config} ${ref}` }), config, 'local digest-addressed image');
  assert.equal(resolveImage({ [setup.image]: `${moved} registry.example:5000/brain@${moved}` }), '', 'moved tag refused');
  assert.equal(resolveImage({ [setup.image]: `${config} unrelated.example/brain@${digest}` }), '', 'unrelated repository is no evidence');
  assert.equal(imageFns.mainImageRef(setup).pull, null, 'a bare digest is not a proven registry manifest');
});
test('A31: a missing classic-store configuration ID is never guessed to be a registry manifest', () => {
  const classic = { image: 'registry.example:5000/brain:current', imageId: config };
  assert.equal(resolveImage({}, classic), '');
  assert.equal(imageFns.mainImageRef(classic).pull, null, 'no cache and no immutable registry reference');
  const pinned = { ...classic, image: ref };
  assert.equal(imageFns.mainImageRef(pinned).pull, ref, 'explicit manifest survives distinct configuration ID');
  assert.equal(resolveImage({}, pinned), '', 'absent cache still requires the immutable download');
  assert.equal(resolveImage({ [ref]: `${config} ${ref}` }, pinned), config, 'pulled image has expected configuration');
  assert.equal(resolveImage({ [ref]: `${moved} ${ref}` }, pinned), '', 'wrong configuration is refused even at named manifest');
  assert.equal(imageFns.mainImageRef({ image: ref }).pull, ref, 'manifest-only setup is pullable');
  assert.equal(resolveImage({ [ref]: `${config} ${ref}` }, { image: ref }), config);
});
test('A31: missing-cache planning refuses an unproven manifest before any GPU work or stop', async () => {
  let probes = 0;
  const plan = new Function('mainNode', 'mainStatus', 'mainImageRef', 'HttpError', 'run', 'gpuUsersScript', 'fields',
    `${lift(main, 'async function mainPlan(')}\nreturn mainPlan;`)(
      () => ({}), async () => ({ online: true, ready: { model: true, draft: true, image: false } }), imageFns.mainImageRef,
      class extends Error { constructor(status, message) { super(message); this.status = status; } },
      async () => { probes++; return { out: '' }; }, () => '', () => []);
  await assert.rejects(plan({ ...setup, imageId: config, args: [] }), /immutable image reference/);
  assert.equal(probes, 0, 'failed preflight never reaches GPU planning');
  const pinned = await plan({ ...setup, image: ref, imageId: config, args: [] });
  assert.equal(pinned.steps.find(step => step.kind === 'pull').image, ref);
});
test('A31: the run command uses the same immutable resolver and contains no mutable-tag fallback', () => {
  const run = new Function('mainSnapshots', 'mainImageScript', 'q', 'CONFIG', 'HF_HUB', 'repoOf', `${lift(main, 'function mainRunCommand(')}\nreturn mainRunCommand;`)(
    () => 'model=snapshot; draft=', imageFns.mainImageScript, q, { modelsDir: 'models' }, '"$HOME/cache"', name => String(name).replace('--', '/'));
  const command = run({ ...setup, model: 'brain', served: 'brain', store: 'hf', container: 'brain', port: 30100, engine: 'vllm', shmGiB: 16, args: [], env: {} });
  assert.ok(command.includes(imageFns.mainImageScript(setup)));
  assert.match(command, /\[ -n "\$img" \] \|\|/);
  assert.doesNotMatch(command, /docker pull/);
  assert.match(command, /'vllm' "\$img" 'serve'/);
});
test('A41: only an explicit fresh install creates desired intent; Stop survives reload', () => {
  const init = main.slice(main.indexOf('function markBrainDesired('), main.indexOf('// Where Sparkie\'s chats'));
  for (const [fresh, enabled, previous, wanted] of [
    [true, true, null, true], [true, false, null, undefined],
    [false, true, { current: 'brain', desiredRunning: false }, false],
    [false, true, { current: 'brain' }, undefined],
  ]) {
    let saved = previous;
    const desired = new Function('readKept', 'writeMainFile', 'CONFIG', 'existsSync', 'MAIN_FILE', 'MAIN', `${init}\nreturn markBrainDesired;`)(
      () => saved, value => { saved = JSON.parse(JSON.stringify(value)); }, { main: { startOnInstall: enabled } }, () => !fresh, 'main.json', {});
    assert.equal(saved?.desiredRunning, wanted);
    if (fresh && enabled) assert.ok(saved.leftDown);
    desired(false);
    assert.deepEqual([saved.desiredRunning, saved.leftDown], [false, undefined]);
  }
});

test('A41: Stop then an owner model switch replaces stopped intent after preflight', async () => {
  let saved = { current: 'old', desiredRunning: false }, stopped = 0, started = 0;
  const desiredSource = lift(main, 'function markBrainDesired(');
  const build = reject => new Function('initial', 'readKept', 'writeMainFile', 'MAIN_FILE', 'mainPlan', 'stopMain', 'startMain', 'markBrainLeftDown',
    'saveMainChoice', 'ROUTES', 'saveRoutes', 'note', 'checkBrainSoon', 'ASSISTANT_NAME',
    `let MAIN = initial; ${desiredSource}\n${lift(main, 'async function switchMain(')}\nreturn switchMain;`)(
      { title: 'Old' }, () => saved, value => { saved = JSON.parse(JSON.stringify(value)); }, 'main.json',
      async () => { if (reject) throw new Error('not available'); }, async () => { stopped++; assert.equal(saved.desiredRunning, true); },
      async () => { started++; assert.equal(saved.desiredRunning, true); }, () => {},
      choice => { saved.current = choice.id; }, {}, () => {}, () => {}, () => false, 'Sparkie');
  const next = { id: 'new', title: 'New' };
  await assert.rejects(build(true)({}, next, []), /nothing was stopped/);
  assert.equal(saved.desiredRunning, false, 'failed preflight preserves Stop');
  assert.equal(stopped, 0); assert.equal(started, 0);
  await build(false)({}, next, []);
  assert.equal(saved.desiredRunning, true, 'successful owner switch wants the newly started brain running');
  assert.equal(saved.current, 'new'); assert.equal(stopped, 1); assert.equal(started, 1);
});

const HF_HUB = '"$HOME/hub"';
const ownLine = ground.split('\n').find(line => line.startsWith('const HF_OWN = '));
const HF_OWN = new Function('HF_HUB', `${ownLine}\nreturn HF_OWN;`)(HF_HUB);
const eachFile = new Function('HF_OWN', `${lift(ground, 'function hfEachFile(')}\nreturn hfEachFile;`)(HF_OWN);
test('A42: shared cache files are readable ordinary files inside the trusted hub blobs folder', () => {
  const home = mkdtempSync(join(tmpdir(), 'brain-cache-'));
  try {
    const hub = join(home, 'hub'), entry = join(hub, 'models--brain'), snap = join(entry, 'snapshots', 'snapshot');
    mkdirSync(snap, { recursive: true }); mkdirSync(join(hub, 'blobs'));
    writeFileSync(join(hub, 'blobs', 'config'), '{}');
    const link = join(snap, 'config.json');
    symlinkSync(join(hub, 'blobs', 'config'), link);
    const check = (dir = entry) => spawnSync('bash', ['-c', `dir=${q(dir)}; ${HF_OWN}\n${eachFile('snapshots/snapshot', 'printf "%s\\n" "$t"')}`], { env: { ...process.env, HOME: home }, encoding: 'utf8' });
    assert.equal(check().status, 0, check().stderr);
    rmSync(link); writeFileSync(join(home, 'private.json'), '{}'); symlinkSync(join(home, 'private.json'), link);
    assert.notEqual(check().status, 0, 'outside configuration refused');
    rmSync(link); symlinkSync(join(hub, 'blobs'), link);
    assert.notEqual(check().status, 0, 'directory refused');
    rmSync(link); symlinkSync(join(hub, 'blobs', 'config'), link);
    const alias = join(hub, 'models--alias'); symlinkSync(entry, alias);
    assert.notEqual(check(alias).status, 0, 'entry-wide link does not authorize shared configuration');
    rmSync(link); symlinkSync(join(hub, 'blobs', 'escape'), link); symlinkSync(join(home, 'private.json'), join(hub, 'blobs', 'escape'));
    assert.notEqual(check().status, 0, 'shared blob symlink escaping the root refused');
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('A30: a diagnostic result cannot be submitted as serving-brain qualification', () => {
  const dir = mkdtempSync(join(tmpdir(), 'brain-eval-'));
  try {
    for (const record of [{ kind: 'spark-console-eval-diagnostic' }, { kind: 'spark-console-eval', serving: { verified: false } }]) {
      const file = join(dir, 'result.json'); writeFileSync(file, JSON.stringify(record));
      const result = spawnSync(process.execPath, [new URL('./eval.mjs', import.meta.url).pathname, '--store', file, '--console', 'http://127.0.0.1:1'], { encoding: 'utf8', timeout: 10000 });
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, /diagnostic run only/);
      assert.doesNotMatch(result.stderr, /doesn’t answer/, 'refused before any network submission');
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

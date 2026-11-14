// Files in a Spark's shared folder (A8, R37). `files` lists that folder or reads one text file there (the first 8,000
// characters, keys and passwords hidden, labelled as data); `save_file` writes one new small text file there and never
// replaces one. Both go through the worker's own workspace-files (the real service/worker.py runs them here, with the
// stand-in Spark's folder as its home), so hidden names, "..", absolute paths and links are refused, and key files are
// never opened. From Sparkie a save runs at once only when the owner's words name the Spark and the whole file name, as
// one word. A save is refused only for key shapes (a known token format, a private key, a setting like SECRET_KEY=<random>,
// a password in an address), and `files` hides those same shapes, not plain words. A read never makes the shared folder.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { T, useFleet, api, call, rpc, createKey, createActKey, agentSettings, auditLines, newChat, say, choose, SLOW } from './lib.mjs';

const keys = {};
const SEED = '# Notes\nline two\n', KEYS = 'HF_TOKEN=hf_abcdefghijklmnopqrstuvwxyz123456\npassword: swordfish-9000\nplain line stays\n';
const shared = (...p) => join(T.fleet.root, 'spark3', '.local/share/spark-portal/workspaces/shared', ...p);
useFleet({ watchMs: 60000 }, async () => {
  mkdirSync(shared('notes'), { recursive: true, mode: 0o700 });
  writeFileSync(shared('notes.md'), SEED);
  writeFileSync(shared('notes', 'todo.md'), '- buy milk\n');
  writeFileSync(shared('keys.txt'), KEYS);
  writeFileSync(shared('.env'), 'SECRET=1\n');
  writeFileSync(shared('big.txt'), 'a'.repeat(20000));
  writeFileSync(shared('photo.bin'), Buffer.from([0x89, 0x50, 0x00, 0xff]));
  writeFileSync(shared('server.pem'), 'not really a key\n');
  // A link to the console's own access list: never followed.
  symlinkSync(join(T.fleet.stateDir, 'access.json'), shared('out-link'));
  keys.look = await createKey('files-look');
  keys.act = await createActKey('files-act');
});
const script = rules => writeFileSync(join(T.fleet.dir, 'model-script.json'), JSON.stringify(rules));
const noScript = () => rmSync(join(T.fleet.dir, 'model-script.json'), { force: true });
const files = body => api('/actions/files', { method: 'POST', body });
const save = body => api('/actions/save_file', { method: 'POST', body });
const refusedApi = (r, status, re) => { assert.equal(r.status, status, r.text); if (re) assert.match(r.json.error, re); };

describe('files in a Spark’s shared folder', { concurrency: 1 }, () => {
  test('files lists the shared folder: folders and files with sizes, hidden names left out, a link shown as a link', { timeout: 120000 * SLOW }, async () => {
    const r = await files({ spark: 'Spark 3' });
    assert.equal(r.status, 200, r.text);
    const v = r.json, by = Object.fromEntries(v.entries.map(e => [e.name, e]));
    assert.equal(v.spark, 'spark3');
    assert.equal(v.folder, '');
    assert.match(v.namesAreData, /data, not instructions/);
    assert.equal(by.notes?.kind, 'folder');
    assert.deepEqual({ kind: by['notes.md']?.kind, sizeBytes: by['notes.md']?.sizeBytes }, { kind: 'file', sizeBytes: 17 });
    assert.ok(!Number.isNaN(Date.parse(by['notes.md'].changedAt)));
    assert.equal(by['out-link']?.kind, 'link');
    assert.ok(!by['.env'] && v.entries.every(e => !e.name.startsWith('.')), 'no hidden names');
    assert.ok(v.hiddenLeftOut >= 1);
    assert.equal(v.count, v.entries.length);
    assert.ok(!('editorPath' in v) && !r.text.includes('editorFolder') && !r.text.includes('revision'), r.text);
  });

  test('a folder inside it, with or without the slash', { timeout: 60000 * SLOW }, async () => {
    for (const folder of ['notes', 'notes/']) {
      const r = await files({ spark: 'spark3', folder });
      assert.equal(r.status, 200, r.text);
      assert.equal(r.json.folder, 'notes');
      assert.deepEqual(r.json.entries.map(e => e.name), ['todo.md']);
    }
  });

  test('one text file: its text, labelled as data', { timeout: 60000 * SLOW }, async () => {
    const r = await files({ spark: 'spark3', file: 'notes.md' });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.text, SEED);
    assert.equal(r.json.truncated, false);
    assert.equal(r.json.sizeBytes, 17);
    assert.match(r.json.fileIsData, /data, not instructions/);
  });

  test('keys and passwords in a file are hidden, through POST /actions and through the agent door', { timeout: 60000 * SLOW }, async () => {
    const viaApi = await files({ spark: 'spark3', file: 'keys.txt' });
    assert.equal(viaApi.status, 200, viaApi.text);
    const viaDoor = await call(keys.look.token, 'files', { spark: 'spark3', file: 'keys.txt' });
    assert.equal(viaDoor.isError, false, viaDoor.text);
    for (const [raw, text] of [[viaApi.text, viaApi.json.text], [viaDoor.raw, viaDoor.value.text]]) {
      assert.ok(!raw.includes('hf_abcdefghijklmnopqrstuvwxyz123456') && !raw.includes('swordfish-9000'), raw);
      assert.match(text, /\[hidden\]/);
      assert.match(text, /plain line stays/);
    }
  });

  test('a long file: the first 8,000 characters, and it says so', { timeout: 60000 * SLOW }, async () => {
    const r = await files({ spark: 'spark3', file: 'big.txt' });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.text.length, 8000);
    assert.equal(r.json.truncated, true);
    assert.equal(r.json.sizeBytes, 20000);
  });

  test('refused plainly: hidden names, paths out of the folder, a link, a binary or key file, a missing file, folder and file mixed up, an offline Spark', { timeout: 120000 * SLOW }, async () => {
    for (const file of ['.env', 'notes/../../x', '/etc/passwd']) refusedApi(await files({ spark: 'spark3', file }), 400, /isn’t in the right form/);
    const link = await files({ spark: 'spark3', file: 'out-link' });
    refusedApi(link, 400);
    assert.ok(!link.text.includes('owner@test'), 'the link isn’t followed');
    refusedApi(await files({ spark: 'spark3', file: 'photo.bin' }), 400, /isn’t plain text/);
    refusedApi(await files({ spark: 'spark3', file: 'server.pem' }), 403, /Key files/);
    refusedApi(await files({ spark: 'spark3', file: 'nope.md' }), 404, /There’s no file nope\.md in the shared folder on Spark 3\. files lists what is there\./);
    const missing = await call(keys.look.token, 'files', { spark: 'spark3', file: 'nope.md' });
    assert.match(missing.text, /^\[not_found\] /, missing.text);
    refusedApi(await files({ spark: 'spark3', folder: 'nowhere' }), 404, /There’s no folder nowhere/);
    refusedApi(await files({ spark: 'spark3', folder: 'notes.md' }), 400, /If notes\.md is a file, pass it as file\.$/);
    refusedApi(await files({ spark: 'spark3', file: 'notes' }), 400, /If notes is a folder, pass it as folder\.$/);
    refusedApi(await files({ spark: 'spark3', folder: 'notes', file: 'notes.md' }), 400, /not both/);
    refusedApi(await files({ spark: 'spark1' }), 502);
    const off = await call(keys.look.token, 'files', { spark: 'spark1' });
    assert.match(off.text, /^\[unreachable, retry later\] /, off.text);
  });

  test('save_file writes one new file, says so, and an audit line names it', { timeout: 60000 * SLOW }, async () => {
    const r = await save({ spark: 'spark3', path: 'saved.md', text: 'hello\n' });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual({ outcome: r.json.outcome, spark: r.json.spark, file: r.json.file, sizeBytes: r.json.sizeBytes }, { outcome: 'saved', spark: 'spark3', file: 'saved.md', sizeBytes: 6 });
    assert.equal(r.json.note, 'Saved saved.md in the shared folder on Spark 3 (6 bytes).');
    assert.equal(readFileSync(shared('saved.md'), 'utf8'), 'hello\n');
    assert.equal((await files({ spark: 'spark3', file: 'saved.md' })).json.text, 'hello\n');
    const lines = auditLines();
    const ran = lines.find(l => l.action === 'save_file' && l.ok && l.args?.path === 'saved.md');
    assert.deepEqual({ via: ran?.via, outcome: ran?.outcome }, { via: 'api', outcome: 'saved' });
    const named = lines.find(l => l.action === 'file-saved' && l.args?.file === 'saved.md');
    assert.ok(named?.ok, JSON.stringify(lines.slice(-3)));
    assert.equal(named.args.spark, 'spark3');
    assert.equal(named.args.sizeBytes, 6);
    assert.match(named.args.sha256, /^[a-f0-9]{64}$/);
  });

  test('a file that’s there is never replaced', { timeout: 60000 * SLOW }, async () => {
    refusedApi(await save({ spark: 'spark3', path: 'saved.md', text: 'other text\n' }), 409, /^saved\.md is already in the shared folder on Spark 3\. Nothing was written/);
    refusedApi(await save({ spark: 'spark3', path: 'notes.md', text: 'other text\n' }), 409, /already in the shared folder/);
    assert.equal(readFileSync(shared('saved.md'), 'utf8'), 'hello\n');
    assert.equal(readFileSync(shared('notes.md'), 'utf8'), SEED);
  });

  test('save refusals write nothing: hidden names, paths out of the folder, a folder that isn’t there, too big, a key in the text, empty, not text', { timeout: 120000 * SLOW }, async () => {
    for (const path of ['.bashrc', 'notes/.envrc', '../x.md', '/tmp/x.md']) refusedApi(await save({ spark: 'spark3', path, text: 'x' }), 400, /isn’t in the right form/);
    assert.ok(!existsSync(shared('.bashrc')) && !existsSync(shared('notes', '.envrc')));
    refusedApi(await save({ spark: 'spark3', path: 'nofolder/x.md', text: 'x' }), 404, /folders aren’t made from here\. Nothing was written\./);
    assert.ok(!existsSync(shared('nofolder')), 'no folder made');
    // (33,000 characters fit the argument's limit; as bytes, 2 each, they're over 64 KB)
    refusedApi(await save({ spark: 'spark3', path: 'big.md', text: 'é'.repeat(33000) }), 413, /^That’s 64\.5 KB\. A file saved from here holds at most 64 KB\.$/);
    refusedApi(await save({ spark: 'spark3', path: 'key.md', text: 'my token hf_abcdefghijklmnopqrstuvwxyz123456\n' }), 400, /key, token or password/);
    refusedApi(await save({ spark: 'spark3', path: 'empty.md', text: '   ' }), 400, /no text to save/);
    refusedApi(await save({ spark: 'spark3', path: 'nul.md', text: 'a\u0000b' }), 400, /Only plain text/);
    for (const f of ['big.md', 'key.md', 'empty.md', 'nul.md']) assert.ok(!existsSync(shared(f)), f);
  });

  test('agents: a look-only key can read but not save; one that may change things saves; pausing agents stops it', { timeout: 60000 * SLOW }, async () => {
    const no = await rpc(keys.look.token, 'tools/call', { name: 'save_file', arguments: { spark: 'spark3', path: 'look.md', text: 'x' } });
    assert.equal(no.json?.error?.code, -32602, no.text);
    assert.match(no.json.error.message, /No tool called save_file for this agent/);
    assert.equal((await call(keys.look.token, 'files', { spark: 'spark3' })).isError, false);
    assert.ok(!existsSync(shared('look.md')));
    const ok = await call(keys.act.token, 'save_file', { spark: 'spark3', path: 'agent.md', text: 'from an agent\n' });
    assert.equal(ok.value?.outcome, 'saved', ok.text);
    assert.equal(readFileSync(shared('agent.md'), 'utf8'), 'from an agent\n');
    await agentSettings({ halted: true });
    try {
      const paused = await call(keys.act.token, 'save_file', { spark: 'spark3', path: 'paused.md', text: 'x' });
      assert.match(paused.text, /^\[not_allowed\] /, paused.text);
      assert.ok(!existsSync(shared('paused.md')));
    } finally { await agentSettings({ halted: false }); }
  });

  test('Sparkie: “save this as plan.md on spark 3” saves at once', { timeout: 120000 * SLOW }, async () => {
    script([{ match: '^save this as plan\\.md on spark 3$', calls: [{ name: 'save_file', arguments: { spark: 'spark3', path: 'plan.md', text: 'the plan' } }] }]);
    try {
      const r = await say(await newChat(), 'save this as plan.md on spark 3');
      assert.ok(!r.message.choices, JSON.stringify(r.message.choices));
      assert.deepEqual(r.message.tools.map(t => [t.name, t.ok]), [['save_file', true]]);
      assert.equal(readFileSync(shared('plan.md'), 'utf8'), 'the plan');
      assert.ok(auditLines().some(l => l.action === 'save_file' && l.via === 'sparkie' && l.outcome === 'saved'));
    } finally { noScript(); }
  });

  test('Sparkie: “there” is the Spark from the message before; with none said, it’s a button', { timeout: 180000 * SLOW }, async () => {
    script([{ match: '^what is in my shared folder on spark 3\\?$', calls: [{ name: 'files', arguments: { spark: 'spark3' } }] },
      { match: '^save this as there\\.md there$', calls: [{ name: 'save_file', arguments: { spark: 'spark3', path: 'there.md', text: 'kept' } }] },
      { match: '^save this as lone\\.md there$', calls: [{ name: 'save_file', arguments: { spark: 'spark3', path: 'lone.md', text: 'kept' } }] }]);
    try {
      const chat = await newChat();
      const look = await say(chat, 'what is in my shared folder on spark 3?');
      assert.deepEqual(look.message.tools.map(t => [t.name, t.ok]), [['files', true]]);
      const r = await say(chat, 'save this as there.md there');
      assert.ok(!r.message.choices, JSON.stringify(r.message.choices));
      assert.equal(readFileSync(shared('there.md'), 'utf8'), 'kept');
      const lone = await say(await newChat(), 'save this as lone.md there');
      assert.equal(lone.message.choices?.length, 1, JSON.stringify(lone.message));
      assert.ok(!existsSync(shared('lone.md')));
    } finally { noScript(); }
  });

  test('Sparkie: a file name the owner didn’t say, a question, or another Spark is a button that names the file, the Spark and the size', { timeout: 180000 * SLOW }, async () => {
    script([{ match: '^save this on spark 3 somewhere$', calls: [{ name: 'save_file', arguments: { spark: 'spark3', path: 'sneaky.md', text: 'some text' } }] },
      { match: '^what is in notes\\.md\\?$', calls: [{ name: 'save_file', arguments: { spark: 'spark3', path: 'notes2.md', text: 'x' } }] },
      { match: '^save this as other\\.md on spark 4$', calls: [{ name: 'save_file', arguments: { spark: 'spark3', path: 'other.md', text: 'x' } }] }]);
    try {
      const chat = await newChat();
      const r = await say(chat, 'save this on spark 3 somewhere');
      assert.deepEqual(r.message.choices?.map(c => c.label), ['Save sneaky.md in the shared folder on Spark 3 (9 bytes)']);
      assert.ok(!existsSync(shared('sneaky.md')));
      const pressed = await choose(chat, r.message.choices[0].id);
      assert.equal(pressed.status, 200, pressed.text);
      assert.equal(pressed.json.outcome, 'saved');
      assert.equal(readFileSync(shared('sneaky.md'), 'utf8'), 'some text');
      const q = await say(await newChat(), 'what is in notes.md?');
      assert.equal(q.message.choices?.length, 1, JSON.stringify(q.message));
      assert.ok(!existsSync(shared('notes2.md')));
      const other = await say(await newChat(), 'save this as other.md on spark 4');
      assert.equal(other.message.choices?.length, 1, JSON.stringify(other.message));
      assert.ok(!existsSync(shared('other.md')));
    } finally { noScript(); }
  });

  test('a look at a Spark with no shared folder yet says so, and makes none', { timeout: 60000 * SLOW }, async () => {
    const folder = join(T.fleet.root, 'spark4', '.local/share/spark-portal/workspaces/shared');
    assert.ok(!existsSync(folder));
    const top = await call(keys.look.token, 'files', { spark: 'spark4' });
    assert.equal(top.isError, false, top.text);
    assert.deepEqual({ count: top.value.count, entries: top.value.entries }, { count: 0, entries: [] });
    assert.match(top.value.note, /There’s no shared folder on Spark 4 yet\. It’s made the first time a file is saved there/);
    refusedApi(await files({ spark: 'spark4', file: 'notes.md' }), 404, /There’s no shared folder on Spark 4 yet, so there’s no notes\.md in it/);
    assert.ok(!existsSync(folder), 'a read made the folder');
  });

  test('plain notes and code save as they are; key shapes are refused, and hidden when read, plain words never', { timeout: 120000 * SLOW }, async () => {
    const NOTES = '## Basic configuration\nGLM-5.3 on Spark 3: 42 tokens/s, first-token latency 0.4 s; a two-pass decode, public-key login.\nvllm serve Qwen/Qwen3 --api-key none-needed\n'
      + 'curl -H "Authorization: Bearer anything" http://spark3:8000/v1/models\ntoken = tokenizer.decode(ids)\npassword = getpass.getpass()\nOPENAI_API_KEY=unused\nMAX_TOKENS=4096\n';
    const r = await save({ spark: 'spark3', path: 'serving.md', text: NOTES });
    assert.equal(r.status, 200, r.text);
    assert.equal(readFileSync(shared('serving.md'), 'utf8'), NOTES);
    assert.equal((await files({ spark: 'spark3', file: 'serving.md' })).json.text, NOTES);
    const door = await call(keys.look.token, 'files', { spark: 'spark3', file: 'serving.md' });
    assert.match(door.value.text, /^## Basic configuration\nGLM-5\.3 on Spark 3: 42 tokens\/s, first-token latency 0\.4 s; a two-pass decode, public-key login\.\n/);
    const PGP = '-----BEGIN PGP PRIVATE KEY BLOCK-----\n\nlQOYBGZx0000BCADpgpsecretbody0123456789\n-----END PGP PRIVATE KEY BLOCK-----\n';
    for (const [path, text] of [['k1.md', PGP], ['k2.md', 'SECRET_KEY=django-insecure-abc123def456\n'], ['k3.md', '[Interface]\nPrivateKey = yAnz5TF+lXXJte14tji3zlMNq+hd2rYUIgJBgB3fBmk=\n'],
      ['k4.md', 'postgres://admin:hunter22@db:5432/x\n'], ['k5.md', 'sk-abcdefghijklmnopqrstuvwxyz0123\n'], ['k6.md', 'xoxb-1234567890-abcdefghijklmn\n'], ['k7.md', 'WEBUI_SECRET_KEY=t0ps3cretvalue12345\n']]) {
      refusedApi(await save({ spark: 'spark3', path, text }), 400, /key, token or password/);
      assert.ok(!existsSync(shared(path)), path);
    }
    writeFileSync(shared('shapes.txt'), `${PGP}SECRET_KEY=django-insecure-abc123def456\nWEBUI_SECRET_KEY=t0ps3cretvalue12345\nPrivateKey = yAnz5TF+lXXJte14tji3zlMNq+hd2rYUIgJBgB3fBmk=\nPublicKey = xTIBA5rboUvnH4htodjb6e697QjLERt1NAB4mZqp8Dg=\nplain line stays\n`);
    const viaApi = await files({ spark: 'spark3', file: 'shapes.txt' }), viaDoor = await call(keys.look.token, 'files', { spark: 'spark3', file: 'shapes.txt' });
    for (const [raw, text] of [[viaApi.text, viaApi.json.text], [viaDoor.raw, viaDoor.value.text]]) {
      for (const secret of ['lQOYBGZx0000BCADpgpsecretbody', 'django-insecure-abc123def456', 't0ps3cretvalue12345', 'yAnz5TF+lXXJte14tji3zlMNq']) assert.ok(!raw.includes(secret), `${secret} shown`);
      assert.match(text, /PublicKey = xTIBA5rboUvnH4htodjb6e697QjLERt1NAB4mZqp8Dg=\nplain line stays/);
    }
  });

  test('a key refused in a save never reaches audit.jsonl, even across the cut of the asker’s words', { timeout: 60000 * SLOW }, async () => {
    // (the second path puts the key across the 200-character cut of the words kept for the audit line)
    for (const path of ['key.md', `notes/${'a'.repeat(124)}.md`]) refusedApi(await save({ spark: 'spark3', path, text: 'my token hf_abcdefghijklmnopqrstuvwxyz123456\n' }), 400, /key, token or password/);
    const raw = readFileSync(join(T.fleet.stateDir, 'audit.jsonl'), 'utf8');
    assert.ok(!raw.includes('hf_abcdefgh'), 'a key, or the start of one, in audit.jsonl');
    assert.ok(auditLines().some(l => l.action === 'save_file' && l.ok === false && /key\.md/.test(l.request) && /\[hidden\]/.test(l.request)));
  });

  test('a saved name has no characters that don’t show or that turn it around, and its button shows it whole', { timeout: 120000 * SLOW }, async () => {
    const C = String.fromCharCode, long = `${'a'.repeat(150)}.md.sh`;
    for (const path of [`notes.md${C(0x200b)}`, `a${C(0x202e)}gnp.exe`, `${C(0xfeff)}x.md`, `x${C(0x7f)}.md`, `y${C(0x2066)}.md`]) refusedApi(await save({ spark: 'spark3', path, text: 'x' }), 400, /isn’t in the right form/);
    assert.ok(!readdirSync(shared()).some(n => n !== 'notes.md' && n.startsWith('notes.md')));
    script([{ match: '^update notes\\.md on spark 3$', calls: [{ name: 'save_file', arguments: { spark: 'spark3', path: `notes.md${C(0x200b)}`, text: 'new text' } }] },
      { match: '^save this on spark 3 under a long name$', calls: [{ name: 'save_file', arguments: { spark: 'spark3', path: long, text: 'x' } }] }]);
    try {
      const r = await say(await newChat(), 'update notes.md on spark 3');
      assert.ok(!r.message.choices, JSON.stringify(r.message.choices));
      assert.deepEqual(r.message.tools.map(t => [t.name, t.ok]), [['save_file', false]]);
      const l = await say(await newChat(), 'save this on spark 3 under a long name');
      assert.deepEqual(l.message.choices?.map(c => c.label), [`Save ${long} in the shared folder on Spark 3 (1 bytes)`]);
    } finally { noScript(); }
    assert.equal(readFileSync(shared('notes.md'), 'utf8'), SEED);
    assert.equal((await files({ spark: 'spark3', file: 'notes.md' })).status, 200);
  });

  test('Sparkie: a piece of the owner’s words, a folder they ruled out, or the Spark from the message before is a button', { timeout: 240000 * SLOW }, async () => {
    script([{ match: '^write this to a file on spark 3$', calls: [{ name: 'save_file', arguments: { spark: 'spark3', path: 'file', text: 'x' } }] },
      { match: '^save this as report-final\\.md on spark 3$', calls: [{ name: 'save_file', arguments: { spark: 'spark3', path: 'final.md', text: 'x' } }] },
      { match: '^save this as fresh\\.md on spark 3, at the top, not inside notes$', calls: [{ name: 'save_file', arguments: { spark: 'spark3', path: 'notes/fresh.md', text: 'x' } }] },
      { match: '^save this as footnotes\\.md on spark 3$', calls: [{ name: 'save_file', arguments: { spark: 'spark3', path: 'notes/footnotes.md', text: 'x' } }] },
      { match: '^what is in my shared folder on spark 4\\?$', calls: [{ name: 'files', arguments: { spark: 'spark4' } }] },
      { match: '^save this as cross\\.md on spark 3$', calls: [{ name: 'save_file', arguments: { spark: 'spark4', path: 'cross.md', text: 'x' } }] }]);
    try {
      for (const words of ['write this to a file on spark 3', 'save this as report-final.md on spark 3', 'save this as fresh.md on spark 3, at the top, not inside notes', 'save this as footnotes.md on spark 3']) {
        const r = await say(await newChat(), words);
        assert.equal(r.message.choices?.length, 1, `${words}: ${JSON.stringify(r.message)}`);
      }
      for (const f of ['file', 'final.md', 'notes/fresh.md', 'notes/footnotes.md']) assert.ok(!existsSync(shared(...f.split('/'))), f);
      const chat = await newChat();
      await say(chat, 'what is in my shared folder on spark 4?');
      const cross = await say(chat, 'save this as cross.md on spark 3');
      assert.equal(cross.message.choices?.length, 1, JSON.stringify(cross.message));
      assert.ok(!existsSync(join(T.fleet.root, 'spark4', '.local/share/spark-portal/workspaces/shared', 'cross.md')));
    } finally { noScript(); }
  });

  test('Sparkie: four file reads at once, two over the cap: the answer says it was busy and to try again', { timeout: 120000 * SLOW }, async () => {
    const read = file => ({ name: 'files', arguments: { spark: 'spark3', file } });
    script([{ match: '^show me four files on spark 3$', calls: ['notes.md', 'notes/todo.md', 'keys.txt', 'big.txt'].map(read) }]);
    try {
      const r = await say(await newChat(), 'show me four files on spark 3');
      const failed = r.message.tools.filter(t => !t.ok);
      assert.ok(failed.length >= 1 && failed.length < 4, JSON.stringify(r.message.tools));
      const said = r.text.split(' | ').filter(l => l.includes('files said: [error]'));
      assert.equal(said.length, failed.length, r.text);
      for (const l of said) assert.match(l, /Busy: \S+ wasn’t read on Spark 3, because two other file operations were going on \(at most two run at once\)\. Nothing is wrong with it: try it again\./);
    } finally { noScript(); }
  });

  test('a saved workflow can’t have a save_file step', { timeout: 60000 * SLOW }, async () => {
    const r = await call(keys.act.token, 'save_workflow', { title: 'save notes', steps: [{ action: 'save_file', args: { spark: 'spark3', path: 'wf.md', text: 'x' } }] });
    assert.equal(r.isError, true, r.text);
    assert.match(r.text, /Step 1: save_file can’t be a step in a saved workflow\./);
  });
});

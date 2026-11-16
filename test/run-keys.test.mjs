// Covers: A kept key, by its name, in one change's environment (A14b; R51, R61; design A step 14, E 2.4): run with keys
// hands each value to the root helper on its input (--stdin), and the unit's own first line puts it in the environment
// for that run only. The command gets the right value; the value is searched for exactly (as is, in base64 and
// %-encoded) in the whole stand-in fleet's folder after it ran (chats, journal with its pieces made small (256 bytes,
// a quarter held back: more than the longest form of the key), the state,
// the copies, what the stand-in brain was sent, the unit's settings as the helper gave them, which systemctl show would
// show, and the process list the command itself wrote while it ran): only the secrets file holds it, and the held
// folder that carried it is gone. A key's first use on a Spark is asked on a button that names it and the Spark; after
// the yes and the run the Spark is kept with the key, and the same plain change then runs at once. An address the key
// hasn't gone to is asked, the button naming it; the owner's own call is told so and nothing runs. A command that only
// reads, given a key, runs as a change. Refused in plain words, nothing run: a command whose own text prints the
// environment (env, printenv, set, export -p, declare -p, a shell's -x, /proc/…/environ, ps e), root, what the sorter
// calls open, a change that would run outside the plain wall after a yes, a delete that can't be put back, a script that
// changed after its ask, and a name that isn't kept, has a home of its own or is one the shell reads.
// The stand-in fleet, with the real root helper set up and proven for Spark 3 (test/rehearsal.mjs, run: true), the
// stand-ins in test/mock/bin (they build no wall: the stand-in systemd-run keeps its own copy of each unit's held folder,
// standin/ran, which a real systemd never makes; it is the one place left out of the search), and the stand-in brain
// told by a script which tools to call. Linux only: run it on a Spark with tools/test-on-spark.sh.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, chmodSync, readdirSync, lstatSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { T, useFleet, api, newChat, say, choose, chatMessages, waitFor, sleep, REPO, SLOW } from './lib.mjs';
import { rehearse } from './rehearsal.mjs';

const SECONDS = 6;
// Made-up keys, new each run: a slash, a plus and an equals sign, so their %-form is another text.
const VALUE = `kv/${randomBytes(16).toString('hex')}+Z=`, OTHER = `ko/${randomBytes(16).toString('hex')}+Q=`, LD = `kl${randomBytes(16).toString('hex')}`;
const sha = s => createHash('sha256').update(s).digest('hex');
// Every form keptHidden hides (03-secrets.mjs): as is, %-encoded, and base64 at each of the three alignments.
function forms(v) {
  const out = new Set([v, encodeURIComponent(v), Buffer.from(v).toString('base64')]), bytes = Buffer.from(v);
  for (let k = 0; k < 3; k++) {
    const b = Buffer.concat([Buffer.alloc(k), bytes]).toString('base64');
    out.add(b.slice(k ? 4 : 0, (k + bytes.length) % 3 ? b.length - 4 : b.length));
  }
  return [...out].filter(f => f.length >= 8);
}
// Every file under the fleet's folder that holds one of the forms, but the secrets file and the stand-in's own record.
function holding(v) {
  const found = [], fs = forms(v).map(f => Buffer.from(f)), skip = [T.fleet.secretsFile, join(T.fleet.root, 'standin', 'ran')];
  const walk = d => {
    for (const n of readdirSync(d)) {
      const p = join(d, n), s = lstatSync(p);
      if (skip.some(x => p === x || p.startsWith(`${x}/`))) continue;
      if (s.isDirectory()) walk(p);
      else if (s.isFile() && s.size < 64 * 2 ** 20) { const b = readFileSync(p); if (fs.some(f => b.includes(f))) found.push(p.slice(T.fleet.dir.length + 1)); }
    }
  };
  walk(T.fleet.dir);
  return found;
}

const USE = [
  'printf "%s" "$DEMO_KEY" | sha256sum | cut -d" " -f1 > notes/keysum.txt',
  // (the process list while it runs, each process's command line as ps shows it)
  'for f in /proc/[0-9]*/cmdline; do tr "\\0" " " < "$f" 2>/dev/null; echo; done > notes/ps.txt',
  'echo "as is: $DEMO_KEY"',
  'echo "base64: $(printf "%s" "$DEMO_KEY" | base64 -w0)"',
  'echo "url: $(python3 -c "import os, urllib.parse; print(urllib.parse.quote(os.environ[\'DEMO_KEY\'], safe=\'\'))")"',
  // (the key at every place across the journal's 256-byte pieces)
  'for i in $(seq 0 70); do printf "%*s%s\\n" "$i" "" "$DEMO_KEY"; done',
].join('\n');
useFleet({ env: { SPARK_CONSOLE_RUN_SECONDS: String(SECONDS), SPARK_CONSOLE_ROUTE_MS: '1000', SPARK_CONSOLE_WIDE_MS: '1', SPARK_CONSOLE_JOURNAL_PIECE: '256' },
  prepare: ({ root }) => {
    rehearse(root, 'spark3', { run: true });
    const h = join(root, 'spark3');
    const put = (p, data, mode = 0o644) => { mkdirSync(dirname(join(h, p)), { recursive: true }); writeFileSync(join(h, p), data); chmodSync(join(h, p), mode); };
    put('notes/usekey.sh', `${USE}\n`);
    put('notes/sum.sh', 'printf "%s" "$DEMO_KEY" | sha256sum | cut -d" " -f1 > notes/keysum.txt\necho summed\n');
    put('notes/other.sh', 'printf "%s" "$OTHER_KEY" | sha256sum | cut -d" " -f1 > notes/othersum.txt\n');
    put('notes/a.tmp', 'a\n');
  } }, async () => {
  // (the console's looks at the tailnet, as ladder.test.mjs waits for them: until one has read it, nothing runs at once)
  const looks = () => (existsSync(join(T.fleet.dir, 'tailscale-calls')) ? readFileSync(join(T.fleet.dir, 'tailscale-calls'), 'utf8').split('\n').filter(l => l === 'status --json').length : 0);
  const n = looks();
  await api('/status');
  await waitFor(() => looks() >= n + 2, { what: 'two looks at the tailnet after a request' });
  await sleep(300);
  const chat = await newChat();
  for (const [name, v] of [['DEMO_KEY', VALUE], ['OTHER_KEY', OTHER], ['LD_PRELOAD', LD]]) assert.match((await say(chat, `/key ${name} ${v}`)).text, new RegExp(`^Kept your key ${name}\\.`));
});

const H3 = () => join(T.fleet.root, 'spark3'), at3 = p => join(H3(), p), text = p => readFileSync(at3(p), 'utf8');
const lines = file => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
const journalLines = () => readdirSync(T.fleet.journalDir).filter(f => f.endsWith('.jsonl')).sort().flatMap(f => lines(join(T.fleet.journalDir, f)));
const script = rules => writeFileSync(join(T.fleet.dir, 'model-script.json'), JSON.stringify(rules));
const noScript = () => rmSync(join(T.fleet.dir, 'model-script.json'), { force: true });
const RUNK = (command, keys, dir = '~') => ({ name: 'run', arguments: { on: 'spark3', command, keys, ...(dir ? { dir } : {}) } });
const run = (command, keys, dir = '~') => api('/actions/run', { method: 'POST', body: { on: 'spark3', command, keys, ...(dir ? { dir } : {}) } });
async function turn(chat, words, rounds) {
  script([{ match: `^${words}$`, rounds }]);
  try {
    const r = await say(chat, words);
    return { tools: r.tools, choices: r.message.choices || [], message: r.message };
  } finally { noScript(); }
}
const sentBack = words => {
  const x = lines(join(T.fleet.dir, 'model-requests.jsonl')).filter(m => m.words === words && m.lastRole === 'tool').at(-1);
  return (x?.results || []).map(r => (String(r.content).startsWith('[error] ') ? { error: String(r.content).slice(8) } : JSON.parse(r.content)));
};
// A record's long text (its end line's, in this month's .out).
function recordText(id) {
  for (const f of readdirSync(T.fleet.journalDir).filter(x => x.endsWith('.jsonl'))) {
    const end = lines(join(T.fleet.journalDir, f)).find(x => x.id === id && x.end && Array.isArray(x.o));
    if (end) return readFileSync(join(T.fleet.journalDir, f.replace(/\.jsonl$/, '.out'))).subarray(end.o[0], end.o[0] + end.o[1]).toString();
  }
  return '';
}
const keyEntry = name => JSON.parse(readFileSync(T.fleet.secretsFile, 'utf8')).keys[name];

test('a key named on run: its first use on a Spark is asked on a button that names it; after the yes the command ran with it, and only the secrets file holds it', { timeout: 180000 * SLOW }, async () => {
  const chat = await newChat(), words = 'update the notes on spark 3 with the demo key';
  const r = await turn(chat, words, [[RUNK('bash notes/usekey.sh', ['DEMO_KEY'])]]);
  assert.equal(r.tools[0].tail, 'Asked first, with a button: nothing ran yet.', JSON.stringify(r.tools));
  const [asked] = sentBack(words);
  assert.match(asked.question, /\nAsked because it gives the key DEMO_KEY to Spark 3, where it hasn’t gone before\.\n/, asked.question);
  assert.match(asked.question, /\nIt is given the key DEMO_KEY, in its environment by name for this run only; its value is never shown\.\nDEMO_KEY hasn’t gone to Spark 3 before: after your yes and the run, that place is kept with it\./);
  assert.ok(!existsSync(at3('notes/keysum.txt')), 'nothing ran');
  assert.equal(keyEntry('DEMO_KEY').hosts, undefined);
  const p = await choose(chat, r.choices.find(c => c.label === 'Run it').id);
  assert.equal(p.status, 200, p.text);
  assert.deepEqual([p.json.outcome, p.json.message.content], ['change', 'Run it: done.'], p.text);
  assert.equal(text('notes/keysum.txt').trim(), sha(VALUE), 'the command had the right value');
  // Kept with the key: the Spark it went to.
  assert.deepEqual(keyEntry('DEMO_KEY').hosts, ['spark3']);
  // Never on a command line (the process list it wrote while it ran shows the helper, with --stdin), never in the unit's
  // settings (what the helper asked systemd for, which systemctl show would show), nor anywhere else.
  assert.match(text('notes/ps.txt'), /spark-console-root run --id [a-z0-9]+ .*--stdin --/);
  const start = journalLines().filter(x => x.k === 'cmd' && x.start && x.args?.command === 'bash notes/usekey.sh').at(-1);
  assert.deepEqual(start.keys, ['DEMO_KEY']);
  // What it printed, kept whole in the journal: masked there, piece by piece.
  assert.match(recordText(start.id), /\nas is: \[hidden\]\n/);
  const unitCall = lines(join(T.fleet.root, 'calls.log')).find(c => c[0] === 'systemd-run' && c.includes(`--unit=${start.unit}`));
  assert.ok(unitCall && !unitCall.some(a => /^Environment/.test(a)), JSON.stringify(unitCall));
  assert.ok(!existsSync(join(T.fleet.root, 'run', 'spark-console', start.unit.slice('sw-run-'.length))), 'the held folder that carried it is gone');
  assert.deepEqual(holding(VALUE), [], 'only the secrets file holds it');
});

test('the same key on the same Spark, a plain change the owner asks for: it runs at once, with no button', { timeout: 120000 * SLOW }, async () => {
  rmSync(at3('notes/keysum.txt'), { force: true });
  const chat = await newChat();
  const r = await turn(chat, 'update the notes on spark 3 with the demo key again', [[RUNK('bash notes/usekey.sh', ['DEMO_KEY'])]]);
  assert.deepEqual(r.choices, [], 'no button');
  assert.equal(r.tools[0].ok, true, JSON.stringify(r.tools));
  assert.equal(text('notes/keysum.txt').trim(), sha(VALUE));
  assert.deepEqual(holding(VALUE), []);
});

test('an address the key hasn\'t gone to is asked, the button naming the key and that address; the owner\'s own call is told so and nothing runs', { timeout: 120000 * SLOW }, async () => {
  const chat = await newChat(), words = 'update the notes on spark 3 from huggingface';
  await turn(chat, words, [[RUNK('curl -sS -o notes/hf.json https://huggingface.co/api/whoami-v2', ['DEMO_KEY'])]]);
  const [asked] = sentBack(words);
  assert.equal(asked.outcome, 'needs-ok', JSON.stringify(asked));
  assert.match(asked.question, /\nDEMO_KEY hasn’t gone to huggingface\.co before: after your yes and the run, that place is kept with it\./, asked.question);
  assert.ok(!existsSync(at3('notes/hf.json')));
  const api409 = await run('echo example.org > notes/host.txt', ['DEMO_KEY']);
  assert.equal(api409.status, 409, api409.text);
  assert.match(api409.json.error, /^Not run at once: it gives the key DEMO_KEY to example\.org, where it hasn’t gone before\. Ask for it in your chat with Sparkie/);
  assert.ok(!existsSync(at3('notes/host.txt')), 'nothing ran');
});

test('a command that only reads, given a key, runs as a change (only a change\'s wall takes input)', { timeout: 60000 * SLOW }, async () => {
  const r = await run('cat notes/keysum.txt', ['DEMO_KEY']);
  assert.equal(r.status, 200, r.text);
  assert.deepEqual([r.json.change, r.json.outcome, r.json.output.trim()], [true, 'change', sha(VALUE)]);
});

test('never into a command whose own text prints the environment: refused in plain words, nothing run', { timeout: 60000 * SLOW }, async () => {
  for (const command of ['env', 'printenv DEMO_KEY', 'set', 'export -p', 'declare -p', 'set -x; bash notes/usekey.sh', 'bash -x notes/usekey.sh',
    "bash -c 'env'", 'cat /proc/self/environ', 'ps e', 'nice env']) {
    const r = await run(command, ['DEMO_KEY']);
    assert.equal(r.status, 403, `${command}: ${r.text}`);
    assert.match(r.json.error, /^Not run: its own text (?:runs|reads|turns on).*, where the key would be, so a key is never given to it\. Use the key by its name in the command instead\. Nothing ran\.$/, command);
  }
});

test('never as root, nor into what the sorter calls open, nor a change that would run outside the plain wall after a yes (--open)', { timeout: 60000 * SLOW }, async () => {
  const root = await run('sudo bash notes/usekey.sh', ['DEMO_KEY']);
  assert.deepEqual([root.status, root.json.error], [403, 'Not run: a key is never given to a command run as root (sudo or su). Nothing ran.']);
  const open = await run('docker pull alpine', ['DEMO_KEY']);
  assert.equal(open.status, 403, open.text);
  assert.match(open.json.error, /^Not run: it needs what the plain wall keeps out \(.*Docker socket.*\), so it would run outside that wall, where every key and token in your home is open to it; a key is never given to such a command\. Nothing ran\.$/);
  const outside = await run('npm install -g left-pad', ['DEMO_KEY']);
  assert.equal(outside.status, 403, outside.text);
  assert.match(outside.json.error, /^Not run: it installs into the system’s own folders \(npm -g\), which the plain wall keeps read-only, so it would run outside the plain wall, where every key and token in your home is open to it/);
});

test('a change that would fail in the plain wall but runs with the top of the home writable (--home, the home\'s keys still hidden) is given its key after the yes', { timeout: 120000 * SLOW }, async () => {
  rmSync(at3('notes/keysum.txt'), { force: true });
  const chat = await newChat(), words = 'update the notes on spark 3 into the home';
  const r = await turn(chat, words, [[RUNK('bash notes/sum.sh > top.txt', ['DEMO_KEY'])]]);
  const [asked] = sentBack(words);
  assert.match(asked.question, /\nIt is given the key DEMO_KEY, in its environment by name for this run only; its value is never shown\./, asked.question);
  const p = await choose(chat, r.choices.find(c => c.label === 'Run it').id);
  assert.deepEqual([p.json.outcome, p.json.message.content], ['change', 'Run it: done.'], p.text);
  assert.equal(text('notes/keysum.txt').trim(), sha(VALUE));
  const start = journalLines().filter(x => x.k === 'cmd' && x.start && x.args?.command === 'bash notes/sum.sh > top.txt').at(-1);
  assert.deepEqual([start.wall, start.keys], ['home', ['DEMO_KEY']]);
  assert.equal(text('top.txt'), 'summed\n', 'it wrote at the top of the home');
  assert.deepEqual(holding(VALUE), []);
});

test('never into a delete that can\'t be put back (the dangerous ask)', { timeout: 60000 * SLOW }, async () => {
  const r = await run('rm ~/notes/*.tmp', ['DEMO_KEY']);
  assert.equal(r.status, 403, r.text);
  assert.match(r.json.error, /^Not run: it removes what can’t be put back, which is asked the dangerous way, and a key is never given to such a command/);
  assert.ok(existsSync(at3('notes/a.tmp')), 'nothing ran');
});

test('a script that changed after its ask: the press is refused, nothing ran', { timeout: 120000 * SLOW }, async () => {
  const chat = await newChat();
  const r = await turn(chat, 'update the other notes on spark 3', [[RUNK('bash notes/other.sh', ['OTHER_KEY'])]]);
  const yes = r.choices.find(c => c.label === 'Run it');
  assert.ok(yes, JSON.stringify(r.choices));
  writeFileSync(at3('notes/other.sh'), 'printf "%s" "$OTHER_KEY" > notes/othersum.txt\n');
  const p = await choose(chat, yes.id);
  assert.equal(p.status, 200, p.text);
  assert.deepEqual([p.json.outcome, p.json.message.content], ['error', 'Couldn’t do “Run it”: Not run: a script it runs changed after you were asked, and a key is never given to a script you weren’t shown. Nothing ran: ask for it again to see the script as it is now.']);
  assert.ok(!existsSync(at3('notes/othersum.txt')), 'nothing ran');
  assert.equal(keyEntry('OTHER_KEY').hosts, undefined);
  assert.ok(!(await chatMessages(chat)).some(m => m.content.includes(OTHER)));
});

test('names: one not kept, one with a home of its own, one the shell reads to decide what runs', { timeout: 60000 * SLOW }, async () => {
  const none = await run('bash notes/usekey.sh', ['NO_SUCH_KEY']);
  assert.deepEqual([none.status, none.json.error], [404, 'Not run: no key is kept as NO_SUCH_KEY. The owner gives it once in their own chat: /key NO_SUCH_KEY and then the key. Nothing ran.']);
  const gh = await run('bash notes/usekey.sh', ['GITHUB']);
  assert.deepEqual([gh.status, gh.json.error], [403, 'Not run: GITHUB has a home of its own (the install from GitHub) and is used only there. Nothing ran.']);
  const ld = await run('bash notes/usekey.sh', ['LD_PRELOAD']);
  assert.equal(ld.status, 403, ld.text);
  assert.match(ld.json.error, /^Not run: LD_PRELOAD is a name the shell or a program reads to decide what runs or loads, so no key is given under it\./);
  assert.deepEqual(holding(LD), []);
});

test('the text check reads a program only where a command starts: a word handed to a program is not that program', () => {
  const src = readFileSync(join(REPO, 'service', 'src', '21-run-keys.mjs'), 'utf8');
  const code = [/^const RUNKEY_SHELLS = .*$/m, /^const RUNKEY_RUNS = [\s\S]*?\]\);$/m, /^function runKeysPrints\(command\) \{[\s\S]*?\n\}$/m].map(re => re.exec(src)?.[0]);
  assert.ok(code.every(Boolean), 'runKeysPrints and its lists');
  const prints = new Function(`${code.join('\n')}\nreturn runKeysPrints;`)();
  for (const ok of ['python3 -m venv env', 'cat notes/env', 'set -e; make', 'export FOO=1; make', 'declare -x FOO=1', 'ps aux', 'ps -ef', 'bash notes/x.sh -x']) assert.equal(prints(ok), null, ok);
  for (const no of ['FOO=1 env', 'timeout 5 printenv', 'set -euxo pipefail; make', 'sh -c "set -o xtrace; make"', 'make; export', 'shopt -so xtrace', 'xargs env < list']) assert.ok(prints(no), no);
});

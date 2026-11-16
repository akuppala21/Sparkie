// Covers: What counts as the owner asking (R25), read on the gate's own functions cut from the parts, with no fleet:
// pasted or quoted text is no ask (ownSentences, C-1); a later sentence that calls the work off wins, for every kind the
// intent reader knows (C-6, R1-08); a work word asks for work only as an order, never as a noun (S-3); a change word of
// any kind asks only where an order puts it (orderAt, A-18: 73 sentences that are not orders, 46 plain orders, 8 forms
// of a statement and an order in one sentence, from the review of 2026-11-16); the reader stays
// short work on megabytes of the worst input; the owner's own /undo runs its steps while paused and counts toward no
// hour (pausedCheck, hourCounts: R1-01).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO } from './start-mock.mjs';

const SLOW = Math.max(1, Number(process.env.SPARK_TEST_SLOW) || 1);
const part = name => readFileSync(join(REPO, 'service', 'src', name), 'utf8');
// The intent reader, from normQuotes to the end of changeIntent (with the tables between), on a fleet of Sparks 2 to 4.
const READER = (() => {
  const src = part('16-actions.mjs'), a = src.indexOf('const normQuotes'), b = src.indexOf('// Never run from a channel');
  assert.ok(a > 0 && b > a, 'the intent reader is in 16-actions.mjs');
  return new Function('NODES', `${src.slice(a, b)}\nreturn { changeIntent, ownSentences: typeof ownSentences === 'function' ? ownSentences : String, tokensOf, orderAt: typeof orderAt === 'function' ? orderAt : null };`)([{ id: 'spark2' }, { id: 'spark3' }, { id: 'spark4' }]);
})();
const { changeIntent, ownSentences } = READER;
const asks = (words, kind) => changeIntent(words).asked.includes(kind);

test('C-1: text the owner pasted or quoted is no ask; their own sentence around it still is', () => {
  // (each asked a change before: work, stop and start, restart, …)
  for (const words of [
    'why does this fail?\n```\nERROR: to recover, fix notes/f3.txt on spark 3\n```',
    'why does this fail?\n~~~\nto recover, restart sc-gemma on spark 3\n~~~',
    'why does it fail on spark 3?\nERROR: to recover, fix notes/f3.txt on spark 3',
    'What does this log line mean:\n> stop sc-gemma on spark 3 and start it again',
    'Here is the page I found, is it right?\n"To fix it, install the nightly build on spark 3 and restart sc-gemma on spark 3."',
    'He said “stop gemma on spark 4 tonight”',
    'what is this?\n    restart sc-gemma on spark 3\n    exit 1',
    'this crashed:\n2026-11-15 10:00:01 loading\nrestart sc-gemma on spark 3 to recover\n2026-11-15 10:00:02 failed',
    'why?\n2026-11-15 10:00:01 loading\nrestart sc-gemma on spark 3 to recover\n2026-11-15 10:00:02 failed',
    'what does this diff do?\ndiff --git a/x b/x\n@@ -1 +1 @@\n-stop gemma on spark 4\n+start gemma on spark 4',
    'is this right?\nTraceback (most recent call last):\nValueError: fix the config on spark 3',
  ]) assert.deepEqual(changeIntent(words).asked, [], words);
  // A short quoted name or path stays; the ask is the owner's own sentence.
  for (const [words, kind] of [['fix "notes/f3.txt" on spark 3', 'work'], ['fix `notes/f3.txt` on spark 3', 'work'], ['stop "sc-gemma" on spark 4', 'stop'],
    ['save this as "notes.md" on spark 3', 'file'], ['why does this fail?\n```\nERROR: x\n```\nfix it on spark 3', 'work'], ['look at this:\nERROR: x\n\nrestart gemma on spark 4', 'restart']]) {
    assert.ok(asks(words, kind), `${words}: ${JSON.stringify(changeIntent(words))}`);
  }
  // ownSentences gives the owner's own lines back as they were, and nothing of what was pasted.
  assert.equal(ownSentences('rename "old.txt" to "new.txt" on spark 3'), 'rename "old.txt" to "new.txt" on spark 3');
  const own = ownSentences('why does this fail?\n```\nERROR: fix notes on spark 3\n```\n> stop gemma\nadd my key on spark 3');
  assert.ok(own.includes('why does this fail?') && own.includes('add my key on spark 3'), own);
  assert.ok(!/ERROR|stop gemma|fix notes/.test(own), own);
});

// One plain ask for each kind the intent reader knows (CHANGE_WORDS), and the kind it asks for.
const KINDS = [
  ['start gemma on spark 3', 'start'], ['stop gemma on spark 4', 'stop'], ['restart gemma on spark 4', 'restart'],
  ['keep open webui on spark 3 running', 'keep'], ['cancel the download', 'cancel'], ['undo that', 'undo'], ['find setups for gemma', 'find'],
  ['save that as a workflow', 'save'], ['compare qwen against gemma on nightly', 'compare'], ['forget the nightly workflow', 'forget'],
  ['test the changes', 'test'], ['fix yourself', 'code'], ['install the new build', 'install'], ['run the self-test', 'selftest'],
  ['save this as notes.md on spark 3', 'file'], ['shut down spark 4', 'poweroff'], ['turn on spark 3', 'poweron'],
  ['set the idle shutdown to 45 minutes', 'powerset'], ['remember that spark 3 keeps the notes', 'remember'], ['fix the notes on spark 3', 'work'],
];
test('C-6, R1-08: a later sentence that calls the work off wins, for every kind the intent reader knows', () => {
  const kinds = new Set(KINDS.map(([, k]) => k));
  assert.equal(kinds.size, 20, 'every kind');
  for (const [words, kind] of KINDS) {
    assert.ok(asks(words, kind), `${words} asks ${kind}: ${JSON.stringify(changeIntent(words))}`);
    for (const off of ['Actually don’t.', 'Actually don\'t.', 'Never mind.', 'Wait.', 'Cancel that.', 'Not yet.', 'No wait, leave it.', 'Hold on.', 'Scratch that.']) {
      const said = `${words}. ${off}`, i = changeIntent(said);
      assert.deepEqual(i.asked, [], `${said}: ${JSON.stringify(i)}`);
      assert.ok(i.negated.includes(kind), `${said}: ${JSON.stringify(i)}`);
    }
    // (and called off in its own sentence, after a dash or a comma)
    for (const said of [`${words} - no wait, leave it`, `${words}, actually no`, `${words}, never mind`]) assert.deepEqual(changeIntent(said).asked, [], said);
  }
  // A call-off before a new ask leaves the new one asked; words that only sound like one call nothing off.
  assert.deepEqual(changeIntent('Stop gemma. Never mind. Restart qwen on spark 4 instead.').asked, ['restart']);
  for (const [words, kind] of [['restart gemma on spark 3, then wait for it to load', 'restart'], ['stop it now - don\'t wait', 'stop'], ['start gemma on spark 3. Ok.', 'start'],
    ['Start gemma on spark 3 please', 'start'], ['restart gemma on spark 3, then leave it', 'restart'], ['Cancel that.', 'cancel']]) {
    assert.ok(asks(words, kind), `${words}: ${JSON.stringify(changeIntent(words))}`);
  }
});

test('S-3: a work word asks for work only as an order; words that describe or ask about a build, an update or a change ask for none', () => {
  for (const words of ['Summarize the build log on Spark 3', 'The build on Spark 3 is slow', 'I think the last update broke something on Spark 3',
    'Spark 3 seems slow. Any change since yesterday?', 'Build failed on spark 3', 'Spark 3’s update broke the notes']) {
    assert.ok(!asks(words, 'work'), `${words}: ${JSON.stringify(changeIntent(words))}`);
  }
  for (const words of ['fix the notes on spark 3', 'please clean up ~/work on spark 3', 'can you update the packages on spark 3', 'go ahead and install htop on spark 3',
    'Spark 3: set up the venv', 'stop gemma on spark 4 and then build the docs on spark 3', 'I want you to change the config on spark 3', 'second change on spark 3']) {
    assert.ok(asks(words, 'work'), `${words}: ${JSON.stringify(changeIntent(words))}`);
  }
  // ("don't fix …" still rules work out, wherever the word stands)
  assert.deepEqual(changeIntent('fix the notes on spark 3 but don\'t fix the config').mixed, ['work']);
});

// A-18 (the review of 2026-11-16): [kind, sentence, (the owner's message before it)].
const NOT_ORDERS = [
  ['Astra', 'I used to build demos on Spark 3.'],
  ['Astra', 'My colleague says to fix the model loader on Spark 3.'],
  ['Astra', 'I am documenting how we install models on Spark 3.'],
  ['Astra', "He said 'fix demo on Spark 3'."],
  ['past', 'I used to fix this by hand on Spark 3.'],
  ['past', 'Last week I had to install the drivers twice on Spark 3.'],
  ['past', 'Yesterday I tried to update the repo on Spark 3 and it hung.'],
  ['past', 'It took me an hour to build the demo on Spark 3.'],
  ['past', 'I remember having to change the port on Spark 3.'],
  ['past', 'Thanks, that helped me fix it on Spark 3.'],
  ['past', 'I managed to install it on Spark 3 myself.'],
  ['someone else', 'Raj told me to install tmux on Spark 3.'],
  ['someone else', 'The README says to build with make on Spark 3.'],
  ['someone else', 'Astra thinks we need to fix the loader on Spark 3.'],
  ['someone else', 'The error message says try again later on Spark 3.'],
  ['someone else', 'According to the docs you update it with pip on Spark 3.'],
  ['someone else', 'The vendor recommends we update the firmware on Spark 3.'],
  ['someone else', 'My colleague asked whether to change the config on Spark 3.'],
  ['a plan', 'I am going to install the new driver on Spark 3 next week.'],
  ['a plan', 'Tomorrow I will build the demo on Spark 3 myself.'],
  ['a plan', 'I plan to set up a database on Spark 3 next month.'],
  ['a plan', 'My plan is to fix it on Spark 3 after the trip.'],
  ['a plan', 'Later I will change the port on Spark 3 by hand.'],
  ['a plan', 'No need for you to do anything, I will fix Spark 3 tonight.'],
  ['a wish', 'I wish I could fix the loader on Spark 3 without downtime.'],
  ['a wish', 'It would be nice to install a GUI on Spark 3 someday.'],
  ['a wish', "I'd love to try the new model on Spark 3 someday."],
  ['a wish', 'I hope to update Spark 3 soon.'],
  ['a question', 'Spark 3 is slow - any idea how to fix it?'],
  ['a question', 'Is it safe to update the kernel on Spark 3?'],
  ['a question', 'The loader on Spark 3 is broken, do you know how to fix it?'],
  ['a question', 'So what would it take to build this on Spark 3?'],
  ['a question', 'Anyone know how to install CUDA 13 on Spark 3?'],
  ['a question', 'Spark 3 again... how long does it take to build?'],
  ['a description', 'The cron job on Spark 3 tries to update the index every night.'],
  ['a description', 'This script is meant to clean up old checkpoints on Spark 3.'],
  ['a description', 'The Makefile on Spark 3 uses clang to build the demo.'],
  ['a description', 'Spark 3 runs a watcher whose job is to fix broken symlinks.'],
  ['a description', 'My scripts fix the permissions on Spark 3 at boot.'],
  ['a description', 'Raj and I usually build it on Spark 3.'],
  ['a description', 'They always install to /opt on Spark 3.'],
  ['we should', 'We should update the drivers on Spark 3 at some point.'],
  ['we should', 'We ought to clean up Spark 3 one of these days.'],
  ['we should', 'We need to fix the loader on Spark 3 eventually.'],
  ['I might', 'I might install Open WebUI on Spark 3 later.'],
  ['I might', "Maybe I'll try a bigger model on Spark 3 next week."],
  ['I might', 'I am thinking of trying to build it on Spark 3.'],
  ['I might', 'I am thinking about whether to change the port on Spark 3.'],
  ["let's see if", "Let's see if the build passes on Spark 3 first."],
  ["let's see if", "Let's see if we can fix it on Spark 3 without a restart."],
  ["let's see if", "Let's see what happens when I install it on Spark 3."],
  ["let's see if", "Let's see how they build it upstream before touching Spark 3."],
  ['a quoted order', 'The ticket reads: fix the demo on Spark 3.'],
  ['a quoted order', "Her exact words were 'install it on Spark 3'."],
  ['a quoted order', 'The note on my desk says "fix Spark 3".'],
  ['a quoted order', 'Step 4 of the guide is "install the driver on Spark 3".'],
  ['a quoted order', 'The forum post says: just update the BIOS on Spark 3 and reboot.'],
  ['a conditional', 'If the build fails on Spark 3, fix it.'],
  ['a conditional', 'Should the disk fill up on Spark 3, clean up ~/work.'],
  ['a conditional', 'When the download ends on Spark 3, install it.'],
  ['a conditional', 'Once the model is down, I can update Spark 3.'],
  ['a conditional', 'Unless it breaks again, there is no need to fix Spark 3.'],
  ['narration', 'I am writing a guide on how to set up Docker on Spark 3.'],
  ['narration', 'For the record, the way to fix Spark 3 is a restart.'],
  ['narration', 'Note to self: update Spark 3 after the demo.'],
  ['narration', 'The trick is to install it from source on Spark 3.'],
  ['narration', 'Edit: I meant Spark 3.'],
  ['narration', 'Update: the job on Spark 3 finished.'],
  ['narration', 'Build 42 is the one that broke Spark 3.'],
  ['narration', 'Try as I might, I cannot get it to build on Spark 3.'],
  ['narration', 'Change is hard on Spark 3.'],
  ['two messages', 'I used to fix it by hand.', 'The loader on Spark 3 broke again last night.'],
  ['two messages', 'My colleague says to update it.', 'What version of Docker is on Spark 3?'],
];
const ORDERS = [
  ['fix it on spark 3'], ['Fix the model loader on Spark 3.'], ['please install htop on spark 3'], ['can you update the repo in ~/work/demo on spark 3?'],
  ['could you please set up a venv on spark 3'], ['install ripgrep on 3'], ['ok build the demo on spark 3'], ['now try the build again on spark 3'],
  ['clean up ~/work/tmp on spark 3'], ['go ahead and change the port to 8080 on spark 3'], ['Sparkie, edit config.yaml on spark 3 and set debug to false'],
  ['I want you to fix the loader on spark 3'], ["let's set up the demo on spark 3"], ['on spark 3, install jq'], ['Spark 3: update the demo repo'],
  ['hey sparkie can you fix the demo on spark 3'], ['try it again on spark 3'], ['update the repo on spark 3 and build it'], ['pull the repo on spark 3 and build it'],
  ['cd into ~/work/demo on spark 3 and install the requirements'], ['Spark 3 is slow. Fix it.'], ['yes, install it on spark 3'], ['just build it on spark 3'],
  ['then install the deps on spark 3'], ['also update the readme on spark 3'], ['I need you to clean up the old checkpoints on spark 3'],
  ['would you set up tmux on spark 3 for me'], ['set up a python venv in ~/work/rag on spark 3 and install requirements.txt'],
  ['change the batch size to 8 in ~/work/demo/config.yaml on spark 3'], ['edit ~/work/demo/run.sh on spark 3: use port 9000'], ['build the docker image in ~/work/app on spark 3'],
  ['install the requirements and try the demo on spark 3'], ['please go ahead and fix the symlinks on spark 3'], ['fix the typo in README.md on spark 3 pls'],
  ['Install uv on Spark 3, then set up the project.'], ['Kindly update pip on spark 3.'], ['you can install it on spark 3 now'], ["I'd like you to try the nightly build on spark 3"],
  ['first clean up ~/work/old on spark 3, then build'], ['spark 3 - fix the loader'], ['fix spark 3'], ['FIX IT ON SPARK 3!!'],
  ['fix it', 'The loader on spark 3 is broken.'], ['ok, try again', 'the build on spark 3 failed'], ['Thanks. Now update the readme on spark 3 too.'],
  ['Fix it on Spark 3 only if the test fails.'],
  // (said another way: an order to a person, but not in the place an order puts its word)
  ['The loader on spark 3 is broken, fix it.'], ['the demo on spark 3 is broken - please fix it'], ['I want to install htop on spark 3'],
  ['we need to update the repo on spark 3, go ahead'], ['time to update the repo on spark 3'], ['do it on spark 3: install the driver'],
  ['spark 3 needs htop, install it'], ["it's broken again on spark 3 so fix it please"],
];

const PLAIN = ORDERS.slice(0, -8), MIXED = ORDERS.slice(-8);
// A plain change on Spark 3 runs at once only when the words ask for work and name Spark 3 (this message or the one
// before: hostClear's words test).
const atOnce = (text, before = null) => { const i = changeIntent(text); return i.asked.includes('work') && READER.tokensOf([before, text].filter(Boolean).join('\n')).has('spark3'); };
test('A-18: narration, reported speech, plans, wishes and quotes ask for no change of any kind; plain orders still run at once; a statement and an order in one sentence is a button', () => {
  assert.equal(NOT_ORDERS.length, 73);
  for (const [kind, text] of NOT_ORDERS) assert.deepEqual(changeIntent(text).asked, [], `${kind}: ${text}`);
  assert.equal(PLAIN.length, 46);
  // (the one plain order the rule still asks: "you can …" is a doubt today, as before)
  const still = PLAIN.filter(([text, before]) => !atOnce(text, before)).map(([text]) => text);
  assert.deepEqual(still, ['you can install it on spark 3 now']);
  for (const [text, before] of MIXED) assert.equal(atOnce(text, before), false, text);
  // The other kinds, said as a habit, someone else's words or a plan: nothing is asked.
  for (const text of ['I used to free up spark 4 every night.', 'I used to stop gemma on Spark 3 every night.', 'My colleague says to restart sc-gemma on Spark 3.',
    'He told me to shut down Spark 4 last week.', 'I am documenting how we start qwen coder on Spark 3.', 'Raj wants to turn off Spark 4.', 'The guide says to undo the last change.',
    'I once had to cancel a download on Spark 3.', 'Thanks, that helped me deploy gemma on Spark 3.']) assert.deepEqual(changeIntent(text).asked, [], text);
  // And their orders still ask.
  for (const [text, kind] of [['free up spark 4', 'stop'], ['stop gemma on spark 3', 'stop'], ['restart sc-gemma on spark 3', 'restart'], ['shut down spark 4', 'poweroff'],
    ['please start qwen coder on spark 3', 'start'], ['turn off spark 4', 'poweroff'], ['undo the last change', 'undo'], ['cancel the download on spark 3', 'cancel'],
    ['on spark 3, deploy gemma', 'start'], ['pull the repo on spark 3 and build it', 'work'], ['read the workflows, then run night mode', 'start'], ['run the self-test', 'selftest'],
    ['as root on spark 3, clean up ~/old', 'work']]) {
    assert.ok(asks(text, kind), `${text}: ${JSON.stringify(changeIntent(text))}`);
  }
  // The same function for another reader's own verb, by its index (netAsks): an order, and not one.
  const { orderAt } = READER;
  for (const [text, word, order] of [['Add my key on spark 3', 'Add', true], ['as root on Spark 3, add a user', 'add', true], ["I can't log in to spark 3, reset my password", 'reset', false],
    ['My colleague says to open port 22 on Spark 3', 'open', false]]) assert.equal(orderAt(text, text.indexOf(word)), order, text);
});

test('the reader stays short work on megabytes of the worst input', () => {
  const n = 400000;
  for (const text of ['wait '.repeat(n), 'no wait, '.repeat(n), '`'.repeat(n), '"a '.repeat(n), '```'.repeat(n), 'a:\n'.repeat(n), '2026-11-15 10:00 x\nplain\n'.repeat(n / 10),
    'fix the build '.repeat(n / 5), "don't ".repeat(n), ', '.repeat(n) + 'wait', 'the '.repeat(n) + 'fix', '> x\n'.repeat(n), '    x\n'.repeat(n), 'File "'.repeat(n)]) {
    let best = Infinity;
    for (let i = 0; i < 3; i++) { const t0 = performance.now(); changeIntent(text); best = Math.min(best, performance.now() - t0); }
    assert.ok(best < 3000 * SLOW, `${JSON.stringify(text.slice(0, 20))}: ${Math.round(best)} ms`);
  }
});

test('R1-01: the owner\'s own /undo runs its steps while changes are paused, and counts toward no hour; an agent\'s, Sparkie\'s or Telegram\'s other changes do', () => {
  const settings = { halted: true, autoPaused: false };
  const pausedCheck = new Function('agentSettings', `${/^const pausedCheck = ctx => \{[\s\S]*?\n\};$/m.exec(part('17-changes.mjs'))?.[0]}\nreturn pausedCheck;`)(() => settings);
  assert.doesNotThrow(() => pausedCheck({ via: 'telegram', ownerWord: true }));
  assert.doesNotThrow(() => pausedCheck({ via: 'page' }));
  for (const via of ['telegram', 'sparkie', 'agent', 'sparkie-undo']) assert.throws(() => pausedCheck({ via }), /paused/, via);
  const hourCounts = new Function(`${/^const hourCounts = .*$/m.exec(part('16-actions.mjs'))?.[0]}\nreturn hourCounts;`)();
  assert.equal(hourCounts({ via: 'telegram', ownerWord: true }), false);
  for (const via of ['telegram', 'sparkie', 'agent']) assert.equal(hourCounts({ via }), true, via);
  for (const via of ['page', 'api', 'workflow', 'watcher']) assert.equal(hourCounts({ via }), false, via);
});

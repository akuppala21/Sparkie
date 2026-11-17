// Covers: What counts as the owner asking (R25), read on the gate's own functions cut from the parts, with no fleet:
// pasted or quoted text is no ask (ownSentences, C-1); a later sentence that calls the work off wins, for every kind the
// intent reader knows (C-6, R1-08); a work word asks for work only as an order, never as a noun (S-3); a change word of
// any kind asks only where an order puts it (orderAt, A-18: 73 sentences that are not orders, 46 plain orders, 8 forms
// of a statement and an order in one sentence, from the review of 2026-11-16); the final read's lists, every row (R1,
// W1, W2, Q1, C1: 246 plain orders, 249 sentences that are no order, the next spellings and phone call-offs; the net's F7
// and F8 at orderAt); a Spark said another way (S4); where a start lands and when a stop runs at once, on the target
// check cut from the parts (A-20: S1, S3, T1); the reader stays short work on megabytes of the worst input; the owner's
// own /undo runs its steps while paused and counts toward no hour (pausedCheck, hourCounts: R1-01).
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
  // (final read 2: "you can …" runs at once too, now that "can" in a request's own words is no doubt, R1)
  const still = PLAIN.filter(([text, before]) => !atOnce(text, before)).map(([text]) => text);
  assert.deepEqual(still, []);
  // (and "we need to …", "time to …" ask for the change: the net's F8, ruled 2026-11-16)
  const F8 = new Set(['we need to update the repo on spark 3, go ahead', 'time to update the repo on spark 3']);
  for (const [text, before] of MIXED) assert.equal(atOnce(text, before), F8.has(text), text);
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

// Final read 2 (2026-11-16): the lists of reviewer `words` (final2-words) and reviewer `net` (final2-net, F7 and F8),
// every row a test. Each row says the answer it must give today.
const FR2_ORDERS = [
  ['yo stop qwen on 3', 'stop'], ['pls restart it', 'restart'],
  ['ok now start gemma on spark 4', 'start'], ['then stop it', 'stop'],
  ['and restart the app', 'restart'], ['stop.', 'stop'],
  ['kill it', 'stop'], ['spark 4 off', 'poweroff', 'button'],
  ['power down spark 3 tonight', 'poweroff'], ['need gemma running on 4', 'start', 'button'],
  ['i need you to stop it', 'stop'], ['want it stopped', 'stop', 'button'],
  ['shut it down', 'stop'], ['bring up open webui', 'start'],
  ['get rid of that model on 3', 'stop', 'button'], ['swap qwen for gemma on 4', 'start'],
  ['start it again', 'start'], ['start "stop-motion-xl" on spark 4', 'start'],
  ['is gemma still up? stop it', 'stop'], ['stop qwen on 3 and start gemma on 4', 'stop,start'],
  ['gemma is hogging memory. stop it', 'stop'], ['stop gemma', 'stop'],
  ['Stop gemma pls', 'stop'], ['stop gemma on spark 3 now', 'stop'],
  ['can u stop gemma', 'stop'], ['could u restart qwen on 4', 'restart'],
  ['sparkie stop gemma', 'stop'], ['hey stop the model on 3', 'stop'],
  ['hey sparkie, kill qwen on spark 3', 'stop'], ['ok stop it', 'stop'],
  ['k stop it', 'stop'], ['kk restart gemma', 'restart'],
  ['alright shut down spark 4', 'poweroff'], ['cool, now start gemma on 4', 'start'],
  ['great now stop it', 'stop'], ['thx now stop it', 'stop'],
  ['ty. stop gemma', 'stop'], ['actually stop gemma', 'stop'],
  ['lets start gemma on 4', 'start'], ["let's run gemma on spark 4", 'start'],
  ['start gemma on spark 4 please', 'start'], ['plz start gemma', 'start'],
  ['go ahead and stop it', 'stop'], ['go ahead stop it', 'stop'],
  ['just stop it', 'stop'], ['now stop it', 'stop'],
  ['quick, stop gemma', 'stop'], ['please can you stop gemma', 'stop'],
  ['can you please kill qwen', 'stop'], ['stop gemma and qwen', 'stop'],
  ['stop everything on spark 3', 'stop'], ['stop all models on 4', 'stop'],
  ['free up spark 4', 'stop'], ['clear spark 3', 'stop'],
  ['unload gemma', 'stop'], ['take gemma down', 'stop'],
  ['turn off gemma', 'stop'], ['turn gemma off', 'stop'],
  ['turn off spark 4', 'poweroff'], ['shut down spark 4', 'poweroff'],
  ['shutdown spark 4', 'poweroff', 'button'], ['power off spark 3', 'poweroff'],
  ['switch off spark 4', 'poweroff'], ['turn spark 4 off', 'poweroff'],
  ['turn on spark 3', 'poweron'], ['wake spark 3', 'poweron'],
  ['wake up spark 4', 'poweron'], ['boot spark 3', 'poweron', 'button'],
  ['power up spark 4', 'poweron'], ['restart gemma', 'restart'],
  ['reboot qwen', 'restart'], ['bring gemma back', 'restart'],
  ['bring gemma back up', 'restart'], ['bring it up again', 'restart'],
  ['relaunch gemma on 4', 'start'], ['redeploy gemma', 'start'],
  ['deploy gemma on spark 4', 'start'], ['launch qwen coder on 3', 'start'],
  ['run gemma on 4', 'start'], ['load gemma on spark 3', 'start'],
  ['serve gemma on 4', 'start'], ['spin up gemma on 4', 'start'],
  ['fire up qwen on 3', 'start'], ['get gemma going on 4', 'start'],
  ['get gemma running on spark 4', 'start'], ['put gemma on spark 4', 'start'],
  ['switch to gemma on 4', 'start'], ['replace qwen with gemma on 4', 'start'],
  ['use gemma on spark 4', 'start'], ['undo that', 'undo'],
  ['undo', 'undo'], ['revert that', 'undo'],
  ['roll it back', 'undo', 'button'], ['cancel that download', 'cancel'],
  ['cancel it', 'cancel'], ['abort the download', 'cancel'],
  ['keep open webui running on 3', 'keep'], ['run the self test', 'selftest'],
  ['test spark 3', 'selftest'], ['install the new build', 'install'],
  ['update spark console', 'install'], ['remember that spark 3 is for coding', 'remember'],
  ['restart open webui', 'restart'], ['restart the app on 3', 'restart'],
  ['start gemma on 3 and 4', 'start'], ['start gemma across 3 and 4', 'start'],
  ['on 4, start gemma', 'start'], ['spark 4: start gemma', 'start'],
  ['on spark 4 start gemma', 'start'], ['on 4 start gemma', 'start'],
  ['spark 4 start gemma', 'start'], ['on spark 4: stop gemma', 'stop'],
  ['spark 3 - restart gemma', 'restart'], ['for spark 4 start gemma', 'start'],
  ['in spark 4 start gemma', 'start'], ['gemma on 4, start it', 'start'],
  ['first stop qwen then start gemma on 4', 'stop,start'], ['stop qwen, start gemma', 'stop,start'],
  ['stop qwen then start gemma on 4', 'stop,start'], ['stop qwen & start gemma', 'stop,start'],
  ['stop qwen + start gemma on 4', 'stop,start'], ['stop qwen on 3 start gemma on 4', 'stop,start'],
  ['stop qwen on 3 and also start gemma on 4', 'stop,start'], ['stop qwen on 3 and then start gemma', 'stop,start'],
  ['stop qwen on 3 after that start gemma', 'stop,start'], ['stop gemma. start qwen.', 'stop,start'],
  ['1. stop gemma 2. start qwen', 'stop,start'], ['1) stop gemma 2) start qwen', 'stop,start'],
  ['- stop gemma\n- start qwen', 'stop,start'], ['start gemma on 4 and stop whatever is on 3', 'start,stop'],
  ['kill qwen then bring gemma up on 3', 'stop,start'], ['restart it pls', 'restart'],
  ['RESTART GEMMA NOW', 'restart'], ['stop gemma!!!', 'stop'],
  ['start gemma on spark 4 thx', 'start'], ['hey can you start gemma on spark 4 for me', 'start'],
  ['morning! start gemma on 4', 'start'], ['morning sparkie start gemma on 4', 'start'],
  ['gm start gemma', 'start'], ['hi, start gemma on 4', 'start'],
  ['hello sparkie please start gemma on 4', 'start'], ['yo sparkie start gemma', 'start'],
  ['ok so start gemma on 4', 'start'], ['ok cool start gemma on 4', 'start'],
  ['right, stop qwen', 'stop'], ['nice. now stop it', 'stop'],
  ['perfect, stop it', 'stop'], ['thanks, stop it now', 'stop'],
  ['thank you, now restart it', 'restart'], ['also stop qwen', 'stop'],
  ['oh and stop qwen', 'stop'], ['oh also restart gemma', 'restart'],
  ['btw stop qwen on 3', 'stop'], ['and stop qwen too', 'stop'],
  ['next, start gemma', 'start'], ['finally stop qwen', 'stop'],
  ['instead start gemma on 4', 'start'], ['no, start gemma on 4', 'start'],
  ['wait, stop it', 'stop'], ['well, stop it then', 'stop'],
  ['sure, start it', 'start'], ['yeah start it', 'start'],
  ['yep go ahead and start gemma', 'start'], ['yes start gemma on 4', 'start'],
  ['yes please start it', 'start'], ['ok do it, start gemma on 4', 'start'],
  ['do me a favor and stop qwen', 'stop'], ['i want you to start gemma on 4', 'start'],
  ['i need you to restart qwen', 'restart'], ["i'd like you to stop gemma", 'stop'],
  ['id like you to stop gemma', 'stop'], ['i would like you to stop gemma', 'stop'],
  ['i want to start gemma on 4', 'start', 'button'], ['i wanna start gemma on 4', 'start', 'button'],
  ['wanna start gemma on 4', 'start', 'button'], ['want you to stop gemma', 'stop'],
  ['need you to stop gemma', 'stop'], ['you can stop gemma now', 'stop'],
  ['u can stop it now', 'stop'], ['time to stop gemma', 'stop'],
  ['gotta stop gemma', 'stop'], ['please do stop gemma', 'stop'],
  ['go stop gemma', 'stop'], ['go and stop gemma', 'stop'],
  ['can you go stop gemma', 'stop'], ['try to start gemma on 4', 'start'],
  ['kill everything', 'stop'], ['kill all on 3', 'stop'],
  ['start up gemma', 'start'], ['boot up gemma', 'start'],
  ['@sparkie stop gemma', 'stop'], ['Sparkie! Stop gemma.', 'stop'],
  ['sparkie: stop gemma', 'stop'], ['hey sparkie - stop gemma', 'stop'],
  ['hey there stop gemma', 'stop'], ['hey buddy stop gemma', 'stop'],
  ['stop gemma, thanks', 'stop'], ['stop gemma for a bit', 'stop'],
  ['thanks, can you stop gemma on spark 4', 'stop'], ['sparkie can you stop gemma', 'stop'],
  ['sparkie, can you restart qwen', 'restart'], ['alright can you start gemma on 4', 'start'],
  ['so can you start gemma', 'start'], ['now can you stop it', 'stop'],
  ['and can you restart qwen', 'restart'], ['also can you stop qwen', 'stop'],
  ['great, could you stop it', 'stop'], ['ok cool so can you stop gemma', 'stop'],
  ['hey sparkie can you stop gemma', 'stop'], ['ok can you stop gemma', 'stop'],
  ['please could you stop gemma', 'stop'], ['yes, can you start it on 4', 'start'],
  ['then could you restart it', 'restart'], ['can you stop gemma and can you start qwen', 'stop,start'],
  ['could you stop gemma and then start qwen on 4', 'stop,start'], ['will you stop gemma', 'stop'],
  ['would you kill qwen for me', 'stop'], ['(stop gemma on spark 4)', 'stop'],
  ['*stop gemma*', 'stop'], ['🛑 stop gemma', 'stop'],
  ['👋 start gemma on 4', 'start'], ['…stop gemma', 'stop'],
  ['/stop gemma', 'stop'], ['#1 stop gemma', 'stop'],
  ['todo: stop gemma', 'stop', 'button'], ['fix the venv on spark 3', 'work'],
  ['install htop on 3', 'work'], ['pls update the repo on spark 3', 'work'],
  ['clean up tmp on spark 3', 'work'], ['spark 3 install htop', 'work'],
  ['on 3 install htop', 'work'], ['yo fix it on spark 3', 'work'],
  ['k try again on spark 3', 'work'], ['retry on spark 3', 'work', 'button'],
  ['again on spark 3', 'work', 'button'], ['git pull on spark 3 then build', 'work'],
  ['mkdir demo on spark 3', 'work', 'button'], ['make a folder called demo on spark 3', 'work', 'button'],
  ['delete the old logs on spark 3', 'work', 'button'], ['rm the tmp files on spark 3', 'work', 'button'],
  ['add a cron job on spark 3', 'work', 'button'], ['write a script on spark 3 that pings me', 'work', 'button'],
  ['download the dataset on spark 3', 'work', 'button'], ['clone the repo on spark 3', 'work', 'button'],
  ['run the tests on spark 3', 'work', 'button'], ['pip install requests on spark 3', 'work'],
];
// (why each of these is a button today: a cost, never a wrong change)
const FR2_BUTTON = {
  'spark 4 off': 'no verb: a power change needs one (shut down, turn off, power off)',
  'need gemma running on 4': '"need X running" is no request form the reader knows',
  'want it stopped': 'a wish, the owner\'s to rule on, as "I want to install htop on spark 3" (A-18\'s eight)',
  'get rid of that model on 3': 'no change word for "get rid of"',
  'shutdown spark 4': '"shutdown" as one word before a Spark is no power word',
  'boot spark 3': '"boot" without "up" is no power word',
  'roll it back': '"roll back" with a word between is no undo word',
  'i want to start gemma on 4': 'a wish, the owner\'s to rule on, as "I want to install htop on spark 3" (A-18\'s eight)',
  'i wanna start gemma on 4': 'a wish, as "I want to …"',
  'wanna start gemma on 4': 'a wish, as "I want to …"',
  'todo: stop gemma': 'a note\'s heading opens no order (ruled 2026-11-16, W1)',
  'retry on spark 3': 'no work word', 'again on spark 3': 'no work word', 'mkdir demo on spark 3': 'no work word for mkdir',
  'make a folder called demo on spark 3': 'no work word for make', 'delete the old logs on spark 3': 'no work word for delete',
  'rm the tmp files on spark 3': 'no work word for rm', 'add a cron job on spark 3': 'no work word for add',
  'write a script on spark 3 that pings me': 'no work word for write', 'download the dataset on spark 3': 'no work word for download',
  'clone the repo on spark 3': 'no work word for clone', 'run the tests on spark 3': '"run" is a start word, not work',
};
// (the groups the final read's rulings close: no row in them asks; the others ask what the row says, R74's Today)
const FR2_CLOSED = new Set(['question', 'negation', 'hypothetical', 'quoting', 'to someone else', 'note', 'work noun']);
const FR2_NOT = [
  ['question', 'stop the model? no wait'], ['question', 'restart it?'],
  ['question', 'stop gemma?'], ['question', 'start gemma on 4??'],
  ['question', 'kill it or leave it?'], ['question', 'stop it or what'],
  ['question', 'should i stop it'], ['question', 'do i need to restart spark 3'],
  ['question', 'would it help to restart gemma'], ['question', 'is it ok to shut down spark 4'],
  ['question', 'what happens if i stop gemma'], ['question', 'how do i restart qwen'],
  ['question', 'why did you stop gemma'], ['question', 'did you stop gemma'],
  ['question', 'can gemma run on spark 3'], ['question', 'restart or redeploy, which is better'],
  ['question', 'stop gemma - good idea or not'], ['question', 'thoughts on restarting spark 3'],
  ['question', 'any reason not to stop gemma'], ['question', 'stop gemma yes or no'],
  ['conditional', 'if it is idle stop it'], ['conditional', 'stop it if it is idle', 'stop'],
  ['conditional', 'when its done stop it'], ['conditional', 'once it finishes, stop it'],
  ['conditional', 'after the download stop gemma'], ['conditional', 'unless its busy restart it'],
  ['conditional', 'in case it crashes restart it'], ['conditional', 'stop gemma only when i tell you', 'stop'],
  ['conditional', 'restart it tomorrow if it still fails', 'restart'], ['conditional', 'next time it crashes, restart it', 'remember'],
  ['conditional', 'stop gemma when the eval ends', 'stop'], ['conditional', 'as soon as the copy ends start gemma on 4'],
  ['conditional', 'whenever spark 3 is idle shut it down'], ['negation', "don't stop it"],
  ['negation', 'dont stop it'], ['negation', 'never restart spark 3'],
  ['negation', 'do not under any circumstances stop gemma'], ['negation', 'no need to restart it'],
  ['negation', 'please leave gemma alone'], ['negation', 'stop nothing'],
  ['negation', 'dont you dare restart qwen'], ['negation', 'i said not to stop it'],
  ['negation', 'no dont stop gemma'], ['negation', 'nope, do not start it'],
  ['negation', 'whatever you do dont shut down spark 4'], ['negation', 'hold off on restarting gemma'],
  ['negation', 'no stopping gemma today'], ['negation', 'stop? no'],
  ['negation', 'cancel nothing, leave it'], ['negation', "i don't want you to stop gemma"],
  ['negation', 'stop gemma... nah leave it'], ['negation', 'start gemma on 4 jk dont'],
  ['negation', 'kill it lol no dont'], ['hypothetical', 'i might stop gemma later'],
  ['hypothetical', 'thinking about restarting spark 3'], ['hypothetical', 'i was going to stop gemma'],
  ['hypothetical', 'maybe stop gemma'], ['hypothetical', 'probably stop gemma tonight'],
  ['hypothetical', 'i guess we could stop gemma'], ['hypothetical', 'tempted to shut down spark 4'],
  ['hypothetical', 'i will stop gemma myself'], ['hypothetical', 'ill restart it later'],
  ['hypothetical', 'im going to turn off spark 4 tonight'], ['hypothetical', 'gonna restart spark 3 in a bit'],
  ['hypothetical', 'about to stop gemma'], ['hypothetical', 'i used to stop gemma every night'],
  ['hypothetical', 'i already stopped gemma'], ['hypothetical', 'i just restarted it myself'],
  ['hypothetical', 'we stop gemma every friday'], ['hypothetical', 'normally i stop gemma first'],
  ['hypothetical', 'last time i had to kill it by hand'], ['hypothetical', 'the plan is to start gemma on 4 next week'],
  ['hypothetical', 'ideally start gemma on 4 someday'], ['hypothetical', 'later maybe restart qwen'],
  ['hypothetical', 'tomorrow stop gemma'], ['quoting', 'bob: stop the model'],
  ['quoting', 'bob says stop gemma'], ['quoting', 'bob said to restart spark 3'],
  ['quoting', 'bob wants me to stop gemma'], ['quoting', 'raj keeps telling me to restart qwen'],
  ['quoting', 'the docs say restart the container'], ['quoting', 'error says restart required'],
  ['quoting', 'it says "stop gemma"'], ['quoting', "it says 'restart now'"],
  ['quoting', 'slack msg: restart spark 3 pls'], ['quoting', 'from bob - stop gemma on 4'],
  ['quoting', 'bob asked: can you stop gemma'], ['quoting', 'my wife says turn off spark 4 its loud'],
  ['quoting', 'chatgpt told me to restart the container'], ['quoting', 'astra recommends stop gemma before the update'],
  ['quoting', 'per the readme: stop all models first'], ['quoting', 'quote: stop gemma on spark 4 unquote'],
  ['quoting', 'the alert reads restart sc-gemma on spark 3'], ['to someone else', 'hey bob, restart spark 3'],
  ['to someone else', 'hey bob can you restart spark 3'], ['to someone else', 'bob, stop gemma please'],
  ['to someone else', '@bob restart spark 3'], ['to someone else', 'raj - kill qwen when you can'],
  ['to someone else', 'ok raj could you stop gemma on 4'], ['to someone else', 'hi team, please stop using spark 3'],
  ['to someone else', 'hey siri stop'], ['to someone else', 'alexa stop'],
  ['to someone else', 'kids, turn off the tv'], ['pasted', 'Restart required'],
  ['pasted', 'Restart required to apply updates on spark 3'], ['pasted', 'Stop requested by user'],
  ['pasted', 'Start time: 10:00'], ['pasted', 'Kill signal received', 'stop'],
  ['pasted', 'Run 42 completed', 'start'], ['pasted', 'Load average: 3.2', 'start'],
  ['pasted', 'Restart count 5 for sc-gemma on spark 3', 'restart'], ['pasted', 'Restart policy unless-stopped', 'restart'],
  ['pasted', 'Stop the model on Spark 3 before upgrading', 'stop'], ['pasted', 'what does this mean\nStop the model on Spark 3 before upgrading', 'stop'],
  ['pasted', 'what does this mean\nRestart the container sc-gemma on spark 3 to apply changes', 'restart'], ['pasted', "Run 'docker run --help' for more information", 'start'],
  ['pasted', 'Unload the model before changing the context size', 'stop'], ['pasted', 'Kill the process and try again', 'stop,work'],
  ['pasted', 'look what raj sent me\nhey can you stop gemma on spark 3 tonight', 'stop'], ['pasted', '---------- Forwarded message ---------\nFrom: bob\nrestart spark 3 please', 'restart'],
  ['pasted', 'Fwd: stop the model on spark 3'], ['pasted', 'FW: restart gemma'],
  ['pasted', 'Forwarded message:\nstop gemma'], ['pasted', 'Subject: restart spark 3'],
  ['pasted', 'step 3: stop gemma on spark 4'], ['pasted', '3. Stop gemma on spark 4', 'stop'],
  ['pasted', 'Stopping sc-gemma ... done'], ['pasted', 'Started sc-gemma on spark 4'],
  ['pasted', 'Shut down by the idle timer at 02:00', 'stop'], ['pasted', 'Killed'],
  ['pasted', 'Reboot scheduled for 03:00 on spark 3'], ['pasted', 'Cancel anytime', 'cancel'],
  ['pasted', 'Undo is not available for this change'], ['note', 'things i did today: stop gemma, start qwen'],
  ['note', 'todo list\nstop gemma\nupdate docs\nbuy milk'], ['note', 'note: stop gemma before the upgrade'],
  ['note', 'note to self, stop gemma before the upgrade'], ['note', 'fyi stop gemma is broken'],
  ['note', 'fyi, restart fixed it'], ['note', 'fyi i had to restart spark 3'],
  ['note', 'reminder: restart spark 3 on friday'], ['note', 'my checklist says stop gemma then update'],
  ['note', 'agenda\n1 stop gemma\n2 demo'], ['note', 'ps restart fixed it'],
  ['note', 'tldr restart fixed it'], ['note', 'update: stop worked'],
  ['note', 'heads up, start gemma failed'], ['saying', 'great, restart it again why dont you', 'restart'],
  ['saying', 'sure, kill it, see if i care', 'stop'], ['saying', 'yeah just stop everything on spark 3 why not', 'stop'],
  ['saying', 'stop it, you are making me blush', 'stop'], ['saying', 'stop. just stop talking', 'stop'],
  ['saying', 'oh stop', 'stop'], ['saying', 'kill me now', 'stop'],
  ['saying', 'start from the top', 'start'], ['saying', 'start with the easy one', 'start'],
  ['saying', 'stop making sense is a great film'], ['saying', 'kill bill is on tonight'],
  ['saying', 'run lola run', 'start'], ['saying', 'restart.sh is broken on spark 3'],
  ['saying', 'stop.sh does nothing on spark 3'], ['saying', 'start.sh hangs on spark 3'],
  ['saying', 'run.sh fails on spark 3'], ['saying', 'load is high on spark 3'],
  ['saying', 'run time was 3h on spark 3'], ['saying', 'start-up costs are high'],
  ['saying', 'restart loop again on spark 3', 'restart'], ['saying', 'shut down unexpectedly last night'],
  ['saying', 'spark 4 - shut down by itself again', 'stop'], ['saying', 'kill switch is on'],
  ['saying', 'stop sign ahead', 'stop'], ['reply', 'Stop', 'stop'],
  ['reply', 'stop', 'stop'], ['reply', 'stop explaining', 'stop'],
  ['reply', 'stop asking me', 'stop'], ['reply', 'start over', 'start'],
  ['reply', 'lets stop here for today', 'stop'], ['reply', 'can you stop saying that', 'stop'],
  ['reply', 'restart', 'restart'], ['reply', 'cancel', 'cancel'],
  ['reply', 'undo', 'undo'], ['reply', 'kill', 'stop'],
  ['discourse', 'Remember when I had to free up spark 4 and stop gemma?'], ['discourse', 'look, i used to fix it by hand and restart sc-gemma on spark 3'],
  ['discourse', 'see, the old script would stop gemma and start qwen on spark 4 at midnight'], ['discourse', 'wait, he said to stop gemma and restart qwen'],
  ['discourse', 'ask bob to stop gemma and restart qwen'], ['discourse', 'let bob know i will stop gemma and start qwen on spark 4 tonight'],
  ['discourse', 'note to self, update spark 3 after the demo'], ['discourse', 'remember i used to stop gemma and start qwen every night', 'remember'],
  ['discourse', 'tell me what gemma does, then stop'], ['discourse', 'show me how you would stop gemma and start qwen'],
  ['discourse', 'list what would happen if i stop gemma, then restart it'], ['discourse', 'go on, i was saying bob wants to stop gemma and start qwen'],
  ['discourse', 'do note that bob will stop gemma and restart spark 3 tonight'], ['discourse', 'read this: the vendor says to stop gemma and update the firmware on spark 3'],
  ['discourse', 'give me a sec, bob is about to stop gemma and restart spark 3'], ['discourse', 'look the build on spark 3 broke and update did not help'],
  ['discourse', 'see how bob fixed it, then build it on spark 3 was his advice'], ['discourse', 'watch out, the cron job will stop gemma and start qwen at 2am'],
  ['discourse', 'find out why the script tries to stop gemma and restart it'], ['discourse', 'check whether bob wants to stop gemma and start qwen'],
  ['discourse', 'get this, bob tried to stop gemma and install drivers on spark 3'], ['discourse', 'make no mistake, bob will stop gemma and wipe spark 3'],
  ['discourse', 'keep in mind i stop gemma every night and restart it at 6', 'remember'], ['discourse', 'point is, i had to stop gemma and restart it'],
  ['discourse', 'have a look, someone had to stop gemma and restart qwen last night'], ['work noun', 'Build fails on spark 3'],
  ['work noun', 'build broken on spark 3'], ['work noun', 'builds broken on spark 3'],
  ['work noun', 'update hangs on spark 3'], ['work noun', 'update stuck on spark 3'],
  ['work noun', 'install crashes on spark 3'], ['work noun', 'install hung on spark 3 again'],
  ['work noun', 'build still failing on spark 3'], ['work noun', 'build error on spark 3'],
  ['work noun', 'build takes forever on spark 3'], ['work noun', 'build done on spark 3'],
  ['work noun', 'build finished on spark 3 btw'], ['work noun', 'update complete on spark 3'],
  ['work noun', 'fix worked on spark 3'], ['work noun', 'fix didnt work on spark 3'],
  ['work noun', 'build doesnt work on spark 3'], ['work noun', 'update isnt done on spark 3'],
  ['work noun', 'build wont finish on spark 3'], ['work noun', "build's broken on spark 3"],
  ['work noun', "update's stuck on spark 3"], ['work noun', 'spark 3: build broken'],
  ['work noun', 'spark 3: update still failing'], ['work noun', 'spark 3 - install never finishes'],
  ['work noun', 'on spark 3 build breaks with a cuda error'], ['work noun', 'build.sh is failing on spark 3'],
  ['work noun', 'install.sh fails on spark 3'], ['work noun', 'update.sh hangs on spark 3'],
  ['work noun', 'build-essential is missing on spark 3'], ['work noun', 'build/ is full on spark 3'],
  ['work noun', 'cleanup.sh deleted too much on spark 3'], ['work noun', 'try 2 on spark 3 also failed'],
  ['work noun', 'change in the config broke spark 3'], ['work noun', 'edit mode is stuck on spark 3'],
  ['work noun', 'update available on spark 3'], ['work noun', 'build times out on spark 3'],
  ['work noun', 'install went fine on spark 3'], ['work noun', 'ok build passes on spark 3 now'],
  ['work noun', 'so update worked on spark 3'], ['work noun', 'yes build works on spark 3'],
  ['work noun', 'thanks, build is green on spark 3'], ['work noun', 'great, fix landed on spark 3'],
  ['work noun', 'and update crashed spark 3 again'],
];
// The next spellings of the examples A-18 fixed, a status report first (W1, W2, Q1): [words, (what they ask today)].
const FR2_TOLD = [
  ['I used to free up spark 4 every night.'],
  ['Look, I used to log in and free up spark 4 every night.'],
  ['Remember, I used to log in and free up spark 4 every night.', 'remember'],
  ['Wait, I used to log in and free up spark 4 every night.'],
  ['See, I used to log in and free up spark 4 every night.'],
  ['Note that I used to log in and free up spark 4 every night.', 'remember'],
  ['Go figure, I used to log in and free up spark 4 every night.'],
  ['Do you know I used to log in and free up spark 4 every night.'],
  ['Ask Raj, he used to log in and free up spark 4 every night.'],
  ['Let me tell you, I used to log in and free up spark 4 every night.'],
  ['Have I told you I used to log in and free up spark 4 every night.'],
  ['Tell you what, I used to log in and free up spark 4 every night.'],
  ['Check this out, I used to log in and free up spark 4 every night.'],
  ['Get this, Raj used to log in and shut down spark 4 every night.'],
  ['Keep in mind Raj used to log in and shut down spark 4 every night.', 'remember'],
  ['Note to self: update Spark 3 after the demo.'],
  ['Note to self, update Spark 3 after the demo.'],
  ['Note to self - update Spark 3 after the demo.'],
  ['Note to self; update Spark 3 after the demo.'],
  ['My colleague says to fix the model loader on Spark 3.'],
  ['Look, my colleague says to log in and fix the model loader on Spark 3.'],
  ['Wait, my colleague says to stop it and fix the model loader on Spark 3.'],
  ['I am documenting how we install models on Spark 3.'],
  ['Read this: we pull the repo and install models on Spark 3.'],
  ['See, we pull the repo and then install models on Spark 3.'],
  ['The cron job on Spark 3 tries to update the index every night.'],
  ['Look, the cron job on Spark 3 wakes up and then tries to update the index every night.'],
  ['Look, the cron job on Spark 3 wakes up, then update the index is what it does.'],
  ['Remember the vendor said to back up first and then update the firmware on Spark 3', 'remember'],
  ['He told me to shut down Spark 4 last week.'],
  ['Wait, he told me to log off and shut down Spark 4 last week.'],
  ['The guide says to undo the last change.'],
  ['Look, the guide says to go back and undo the last change.'],
  ['Build failed on spark 3'],
  ['Build fails on spark 3'],
  ['The build fails on spark 3'],
  ['Update: build fails on spark 3'],
  ['build is failing on spark 3'],
  ['build keeps failing on spark 3'],
  ['build failing on spark 3'],
  ['Fix it on Spark 3 only if the test fails.', 'work'],
  ['stop gemma on spark 4?'],
  ['stop gemma on spark 4 ?'],
  ['so stop gemma on spark 4?'],
  ['stop gemma on spark 4, right?'],
  ['stop gemma on spark 4 or not?'],
];
// An order, then a call-off as a phone types it (C1): [words, (what they ask today)].
const FR2_OFF = [
  ['stop gemma. nah'], ['stop gemma. no'],
  ['stop gemma. no dont'], ['stop gemma nvm'],
  ['stop gemma jk'], ['stop gemma. jk'],
  ['stop gemma. nvm'], ['stop gemma, nvm'],
  ['stop gemma actually nvm'], ['stop gemma. oops no'],
  ['stop gemma. wait no'], ['stop gemma. on second thought no'],
  ['stop gemma. changed my mind'], ['stop gemma. forget it'],
  ['stop gemma. ignore that'], ['stop gemma. scrap that'],
  ['stop gemma. disregard'], ['stop gemma. my bad, dont'],
  ['stop gemma. sorry dont'], ['stop gemma. NO'],
  ['stop gemma\nno wait'], ['stop gemma\nactually no'],
  ['stop gemma\nnvm'], ['stop gemma\nnah leave it'],
  ['stop gemma. nah leave it'], ['stop gemma. leave it'],
  ['stop gemma. dont'], ['stop gemma wait', 'stop'],
  ['stop gemma no wait'], ['stop gemma actually dont'],
  ['stop gemma lol jk'], ['stop gemma. stop. dont'],
  ['stop gemma. abort', 'cancel,stop'], ['stop gemma. cancel', 'cancel,stop'],
  ['stop gemma. undo', 'stop,undo'], ['stop gemma - wait dont'],
  ['stop gemma… wait'], ['stop gemma, on second thought leave it'],
];
// Reviewer net's sentences for a lock-out change (F7, F8): [words, the verb netAsks reads, orderAt's answer there]. Its
// orders, and four that give a statement and then the order in one sentence (false, ruled at A-18); orderAt's answer
// only: netAsks's own checks (a question, "don't", the Spark, a verb it doesn't read) refuse some rows it passes.
const NET_ORDERS = [
  ['can you add my key on spark 3', 'add', true],
  ["please open port 8080 on spark 4's firewall", 'open', true],
  ['spark 3: restart tailscale', 'restart', true],
  ['on spark 4 turn the firewall off', 'turn', true],
  ["Add my laptop's SSH key on Spark 3.", 'Add', true],
  ['add my ssh key to spark 3', 'add', true],
  ["On Spark 3, add my laptop's ssh key to authorized_keys", 'add', true],
  ['hey sparkie, restart sshd on spark 3', 'restart', true],
  ['Sparkie, please restart ssh on spark 3', 'restart', true],
  ['could you open port 8002 on spark 3?', 'open', true],
  ['I need you to open port 8002 on spark 3', 'open', true],
  ['I want you to add my key on spark 3', 'add', true],
  ["I'd like you to restart tailscale on spark 3", 'restart', true],
  ['go ahead and restart tailscale on spark 3', 'restart', true],
  ["let's open port 8002 on spark 3", 'open', true],
  ['ok, open port 8002 on spark 3', 'open', true],
  ['yes, open port 8002 on spark 3', 'open', true],
  ['yes please open port 8002 on spark 3', 'open', true],
  ['open port 8002 on spark 3 please', 'open', true],
  ['for spark 3, open port 8002 in the firewall', 'open', true],
  ["in spark 3's firewall, allow port 8002", 'allow', true],
  ['spark 3 - restart tailscale', 'restart', true],
  ['Spark 3, restart tailscale.', 'restart', true],
  ['on spark 3 please disable password login for ssh', 'disable', true],
  ['as root on spark 3, open port 8002', 'open', true],
  ['as root, open port 8002 on spark 3', 'open', true],
  ['with root on spark 3, restart sshd', 'restart', true],
  ['use root to restart sshd on spark 3', 'restart', true],
  ['run as root on spark 3: ufw allow 8002', 'allow', false],
  ['just restart tailscale on spark 3', 'restart', true],
  ['now restart tailscale on spark 3', 'restart', true],
  ['then restart tailscale on spark 3', 'restart', true],
  ['next, restart tailscale on spark 3', 'restart', true],
  ['quickly restart tailscale on spark 3', 'restart', true],
  ['restart tailscale on spark 3 and tell me if it comes back', 'restart', true],
  ["My key isn't on spark 3. Add my key on spark 3.", 'Add', true],
  ['ssh is down on spark 3, restart sshd on spark 3', 'restart', false],
  ['the firewall on spark 3 is blocking 8002, open port 8002 on spark 3', 'open', false],
  ["I can't reach port 8002 on spark 3 - open port 8002 on spark 3", 'open', false],
  ['if tailscale is down on spark 3, restart tailscale on spark 3', 'restart', false],
  ["when you're done, restart tailscale on spark 3", 'restart', false],
  ['tailscale on spark 3 needs a restart, restart tailscale on spark 3', 'restart', false],
  ['Do it: restart tailscale on spark 3', 'restart', true],
  ['pls restart tailscale on spark 3', 'restart', true],
  ['plz add my key on spark 3', 'add', true],
  ['kindly add my key on spark 3', 'add', true],
  ['you can restart tailscale on spark 3', 'restart', true],
  ['you should restart tailscale on spark 3', 'restart', true],
  ['I think we should restart tailscale on spark 3', 'restart', false],
  ['we need to restart tailscale on spark 3', 'restart', true],
  ['need to restart tailscale on spark 3', 'restart', true],
  ['time to restart tailscale on spark 3', 'restart', true],
  ["remove bob's user account on spark 3", 'remove', true],
  ['make me a user called bob on spark 3', 'make', true],
  ['give bob sudo on spark 3', 'give', true],
  ['set up ssh keys for my laptop on spark 3', 'set', true],
  ['turn off the firewall on spark 3', 'turn', true],
  ['switch the firewall off on spark 3', 'switch', true],
  ['disable ufw on spark 3', 'disable', true],
  ['Can you please turn the firewall off on spark 3?', 'turn', true],
  ['would you mind restarting tailscale on spark 3?', 'restarting', false],
  ['restarting tailscale on spark 3 please', 'restarting', true],
  ['i want tailscale restarted on spark 3', 'restarted', false],
  ['get tailscale restarted on spark 3', 'restarted', false],
  ['have spark 3 restart tailscale', 'restart', false],
  ['make spark 3 restart tailscale', 'make', true],
  ['tell spark 3 to restart tailscale', 'restart', false],
  ['kill process 812 on spark 3 as root', 'kill', true],
  ['as root on spark 3, kill process 812', 'kill', true],
  ['as root on spark 3, kill the stuck apt process 4242', 'kill', true],
  ['stop the ssh process 812 on spark 3', 'stop', true],
];
// … and its sentences that are no order of the owner's (narration, someone else's words, a noun, a question).
const NET_NOT = [
  ['Reset my password on spark 3 yesterday and it still fails', 'Reset', false],
  ['Set up my ssh key on spark 3 last week, still asks for a password', 'Set', false],
  ["Put my key on spark 3 last night but it doesn't work", 'Put', false],
  ['Have a look at the logs, bob wants me to add his key on spark 3 and open port 22', 'open', false],
  ['Look, my colleague says to turn the firewall off on spark 3', 'turn', false],
  ['I used to restart tailscale on spark 3 every week.', 'restart', false],
  ['My colleague says to turn the firewall off on spark 3.', 'turn', false],
  ['The guide says: open port 22 on spark 3', 'open', false],
  ['Bob said, open port 22 on spark 3', 'open', false],
  ['the docs say to disable the firewall on spark 3', 'disable', false],
  ['Sparkie said it would restart tailscale on spark 3', 'restart', false],
  ['the log says: restart sshd on spark 3', 'restart', false],
  ['Yesterday you tried to restart tailscale on spark 3', 'restart', false],
  ['restart tailscale on spark 3? no way', 'restart', true],
  ["don't restart tailscale on spark 3", 'restart', false],
  ['never open port 22 on spark 3', 'open', false],
  ['should I open port 22 on spark 3?', 'open', false],
  ['what happens if I turn off the firewall on spark 3', 'turn', false],
  ['is it safe to restart tailscale on spark 3', 'restart', false],
  ['tell me how to add my key on spark 3', 'add', false],
  ['show me how to open port 22 on spark 3', 'open', false],
  ['explain what "ufw disable" does on spark 3', 'disable', false],
  ['Check whether someone opened port 22 on spark 3', 'opened', false],
  ['did you restart tailscale on spark 3', 'restart', false],
  ['I restarted tailscale on spark 3', 'restarted', false],
  ['open ports on spark 3 are a risk', 'open', false],
  ['Add-on keys for spark 3 arrived', 'Add', false],
  ['restart of tailscale on spark 3 took a minute', 'restart', false],
  ['Change log for spark 3: ssh keys rotated', 'Change', false],
  ['Update: firewall on spark 3 is off', 'Update', false],
  ['Fix for the ssh problem on spark 3 is in', 'Fix', false],
  ['stop. my colleague says turn the firewall off on spark 3', 'turn', false],
  ['Then my colleague told me to turn the firewall off on spark 3', 'turn', false],
  ['So bob wants to add his key on spark 3', 'add', false],
  ['ok so the guide says to add my key on spark 3', 'add', false],
  ['and then he said to reset the password on spark 3', 'reset', false],
  ['yes he said add my key on spark 3', 'add', false],
  ['Let me think about whether to open port 22 on spark 3', 'open', false],
  ['let bob add his key on spark 3', 'add', false],
  ['have bob add his key on spark 3', 'add', false],
  ['Wait for bob to add his key on spark 3, then open port 22', 'open', false],
  ['Remember when I had to reset the firewall on spark 3?', 'reset', false],
  ['Thanks, bob already opened port 22 on spark 3', 'opened', false],
  ['sure, the vendor says disable ufw on spark 3', 'disable', false],
  ['well my colleague says: disable ufw on spark 3', 'disable', false],
  ['"restart tailscale on spark 3" is what it printed', 'restart', false],
  ['it printed restart tailscale on spark 3', 'restart', false],
  ['also the agent suggested to add its key on spark 3', 'add', false],
  ['Summarise this page, then add the key it mentions on spark 3', 'add', false],
  ['read the README on spark 3 and open the port it says', 'open', true],
];
// Where a start lands (A-20, S1, S3, S4): [words, (the owner's message before), for a call naming Spark 3, Spark 4 and
// none: the Spark it starts on at once ('' when Spark Console places it), or "?" and what the button shows].
const FR2_STARTS = [
  ['start gemma on spark 4', null, 'spark4 spark4 spark4'],
  ['start gemma on spark4', null, 'spark4 spark4 spark4'],
  ['start gemma on Spark-4', null, 'spark4 spark4 spark4'],
  ['start gemma on s4', null, 'spark4 spark4 spark4'],
  ['start gemma on spark four', null, 'spark4 spark4 spark4'],
  ['start gemma on the fourth spark', null, 'spark4 spark4 spark4'],
  ['start gemma on spark #4', null, 'spark4 spark4 spark4'],
  ['start gemma on spark no 4', null, 'spark4 spark4 spark4'],
  ['start gemma on spark number 4', null, 'spark4 spark4 spark4'],
  ['start gemma on sprak 4', null, 'spark4 spark4 spark4'],
  ['start gemma on sp4', null, 'spark4 spark4 spark4'],
  ['start gemma on akspark4', null, 'spark4 spark4 spark4'],
  ['start gemma on 4', null, 'spark4 spark4 spark4'],
  ['start gemma on node 4', null, '?spark3 ?spark4 ?'],
  ['start gemma on box 4', null, '?spark3 ?spark4 ?'],
  ['start gemma on machine 4', null, '?spark3 ?spark4 ?'],
  ['start gemma on the 4th one', null, '?spark3 ?spark4 ?'],
  ['start gemma on #4', null, '?spark3 ?spark4 ?'],
  ['start gemma on spark 3 or 4', null, '?spark3 ?spark4 ?'],
  ['start gemma on either spark', null, '?spark3 ?spark4 ?'],
  ['start gemma on the other spark', null, '?spark3 ?spark4 ?'],
  ['start gemma, not on spark 3', null, '?spark3 ?spark4 ?'],
  ['start gemma on spark 4, not on spark 3', null, '?spark4 ?spark4 ?spark4'],
  ['start gemma on spark 4 not 3', null, '?spark4 ?spark4 ?spark4'],
  ['move gemma from spark 3 to spark 4', null, '?spark3 ?spark4 ?'],
  ['move it from 3 to 4', null, '?spark3 ?spark4 ?'],
  ['start gemma on spark 4 instead of spark 3', null, '?spark4 ?spark4 ?spark4'],
  ['stop qwen on spark 3 and start gemma on spark 4', null, '?spark4 ?spark4 ?spark4'],
  ['start gemma on spark 4', 'qwen on spark 3 crashed again', 'spark4 spark4 spark4'],
  ['start it on 4', 'gemma on spark 3 is slow', 'spark4 spark4 spark4'],
  ['start gemma there', 'spark 4 is free now', '?spark3 ?spark4 ?'],
  ['start gemma-3-4b on spark 3', null, 'spark3 spark3 spark3'],
  ['start gemma 3 on spark 4', null, 'spark4 spark4 spark4'],
  ['start phi 4 on spark 3', null, 'spark3 spark3 spark3'],
  ['start phi-4 on 3', null, 'spark3 spark3 spark3'],
  ['start llama 3 on 4', null, 'spark4 spark4 spark4'],
  ['start gemma3 on spark 4', null, 'spark4 spark4 spark4'],
  ['start qwen3 on 4', null, 'spark4 spark4 spark4'],
  ['start gemma with 4 bit quant on spark 3', null, 'spark3 spark3 spark3'],
  ['switch to 4 bit gemma on spark 3', null, 'spark3 spark3 spark3'],
  ['start gemma on spark 3 with context 4', null, 'spark3 spark3 spark3'],
  ['start the spark-4 tuned gemma on spark 3', null, '?spark3 ?spark3 ?spark3'],
  ['start gemma on spark 3 for 4 hours', null, 'spark3 spark3 spark3'],
  ['start gemma on spark 3 at 4', null, 'spark3 spark3 spark3'],
  ['start gemma on spark 3 at 4pm', null, 'spark3 spark3 spark3'],
  ['start gemma on spark 3 by 4', null, 'spark3 spark3 spark3'],
  ['run gemma from 3 to 4', null, '?spark4 ?spark4 ?spark4'],
  ['start gemma on spark 3. spark 4 stays free', null, '?spark3 ?spark3 ?spark3'],
  ['start gemma on spark 3 so spark 4 stays free', null, '?spark3 ?spark3 ?spark3'],
  ['start gemma anywhere but spark 3', null, '?spark3 ?spark4 ?'],
  ['start gemma on any spark except 4', null, '?spark3 ?spark4 ?'],
  ['start gemma on both sparks', null, '?spark3 ?spark4 ?'],
  ['start gemma on sparks 3 and 4', null, '?spark3 ?spark4 ?'],
  ['start gemma across both', null, '?spark3 ?spark4 ?'],
  ['start gemma on spark 3 and spark 4', null, '?spark3 ?spark4 ?'],
  ['start gemma on 3+4', null, '?spark3 ?spark4 ?'],
  ['start gemma on spark 2', null, 'spark2 spark2 spark2'],
  ['start gemma on spark 5', null, 'spark5 spark5 spark5'],
  ['start gemma on spark 34', null, 'spark34 spark34 spark34'],
];
// A stop (A-20, S3, T1): gemma runs on Spark 3 and Spark 4, qwen3-coder on Spark 4, spark-tts-4 on Spark 3. [words,
// (the message before), the call's Spark and container, at once].
const FR2_STOPS = [
  ['stop gemma', null, 'spark3', 'sc-gemma-3-12b-it', false],
  ['stop gemma', null, 'spark4', 'sc-gemma-3-12b-it', false],
  ['stop gemma on spark 4', null, 'spark3', 'sc-gemma-3-12b-it', false],
  ['stop gemma on spark 4', null, 'spark4', 'sc-gemma-3-12b-it', true],
  ['stop qwen', null, 'spark4', 'sc-qwen3-coder', true],
  ['stop qwen', null, 'spark3', 'sc-qwen3-coder', false],
  ['stop gemma on spark 3 or 4', null, 'spark3', 'sc-gemma-3-12b-it', false],
  ['stop gemma, not on spark 3', null, 'spark3', 'sc-gemma-3-12b-it', false],
  ['stop gemma on spark 4 not spark 3', null, 'spark3', 'sc-gemma-3-12b-it', false],
  ['stop gemma on the other spark', null, 'spark3', 'sc-gemma-3-12b-it', false],
  ['stop gemma on spark four', null, 'spark3', 'sc-gemma-3-12b-it', false],
  ['stop gemma on s4', null, 'spark3', 'sc-gemma-3-12b-it', false],
  ['stop gemma on either spark', null, 'spark3', 'sc-gemma-3-12b-it', false],
  ['move gemma from spark 3 to spark 4, stop the old one', null, 'spark4', 'sc-gemma-3-12b-it', false],
  ['stop the spark tts 4 model', null, 'spark3', 'sc-spark-tts-4', true],
  ['stop spark-tts-4', null, 'spark3', 'sc-spark-tts-4', true],
  ['stop spark tts on spark 3', null, 'spark3', 'sc-spark-tts-4', true],
  ['stop gemma 3 on 4', null, 'spark3', 'sc-gemma-3-12b-it', false],
  ['stop gemma-3-12b on spark 4', null, 'spark4', 'sc-gemma-3-12b-it', true],
  ['stop it', 'gemma on spark 3 is slow', 'spark4', 'sc-gemma-3-12b-it', false],
  ['stop gemma on 4', 'gemma on spark 3 is slow', 'spark3', 'sc-gemma-3-12b-it', false],
  ['stop gemma on 4', 'gemma on spark 3 is slow', 'spark4', 'sc-gemma-3-12b-it', true],
  ['stop everything on spark 3', null, 'spark4', 'sc-qwen3-coder', false],
  ['stop everything on spark 3', null, 'spark3', 'sc-gemma-3-12b-it', true],
  ['free up spark 4', null, 'spark4', 'sc-qwen3-coder', true],
  ['free up spark 4', null, 'spark3', 'sc-gemma-3-12b-it', false],
];

test('final read 2, R1: the reviewer\'s 246 plain orders, row by row: 224 run at once; each one asked has its reason', () => {
  assert.equal(FR2_ORDERS.length, 246);
  for (const [text, kinds, button] of FR2_ORDERS) {
    const i = changeIntent(text);
    assert.equal(kinds.split(',').every(k => i.asked.includes(k)), !button, `${text}: ${JSON.stringify(i)}`);
    if (button) assert.ok(FR2_BUTTON[text], `why "${text}" is a button`);
  }
  assert.equal(FR2_ORDERS.filter(r => !r[2]).length, 224);
});

test('final read 2, W1, W2, Q1, C1: the reviewer\'s 249 sentences that are no order, row by row: 202 ask nothing, none of a group the rulings close', () => {
  assert.equal(FR2_NOT.length, 249);
  for (const [group, text, today = ''] of FR2_NOT) {
    assert.equal(changeIntent(text).asked.sort().join(','), today, `${group}: ${text}`);
    if (FR2_CLOSED.has(group)) assert.equal(today, '', `${group}: ${text}`);
  }
  assert.equal(FR2_NOT.filter(r => !r[2]).length, 202);
  // The next spellings: talk first ("Wait, I used to …"), a status report ("Build fails on spark 3"), a question.
  for (const [text, today = ''] of FR2_TOLD) assert.equal(changeIntent(text).asked.sort().join(','), today, text);
  // A call-off as typed on a phone: nothing asked, the stop ruled out ("stop gemma wait" and an abort, a cancel or an
  // undo after it are read as they come, a second ask).
  for (const [text, today = ''] of FR2_OFF) {
    const i = changeIntent(text);
    assert.equal(i.asked.sort().join(','), today, text);
    if (!today) assert.ok(i.negated.includes('stop'), `${text}: ${JSON.stringify(i)}`);
  }
});

test('final read 2, the net\'s F7 and F8: each sentence\'s verb is an order where an order puts it, and no order in narration, a report or a noun', () => {
  const { orderAt } = READER;
  assert.equal(NET_ORDERS.length, 71);
  assert.equal(NET_NOT.length, 50);
  for (const [text, verb, order] of [...NET_ORDERS, ...NET_NOT]) {
    const sentence = text.split(/(?<=[?!\n;])|\.(?=\s|$)/).map(s => s.trim()).find(s => new RegExp(`\\b${verb}\\b`).test(s));
    assert.equal(orderAt(sentence, sentence.search(new RegExp(`\\b${verb}\\b`))), order, `${text} (${verb})`);
  }
  assert.equal(NET_ORDERS.filter(r => r[2]).length, 58);
});

test('S4: a Spark said another way is that Spark; a word only like one, or a model\'s own number, names none', () => {
  const sparks = t => [...READER.tokensOf(t)].filter(x => /^spark\d+$/.test(x)).sort().join(' ');
  for (const [text, named] of [['on spark four', 'spark4'], ['on s4', 'spark4'], ['on sp4', 'spark4'], ['on spark #4', 'spark4'], ['on spark no 4', 'spark4'],
    ['on spark number 4', 'spark4'], ['on the fourth spark', 'spark4'], ['on the 4th spark', 'spark4'], ['on sprak 4', 'spark4'], ['on spakr 4', 'spark4'], ['on sp4rk 4', 'spark4'],
    ['on spark three', 'spark3'], ['Spark Three, start gemma', 'spark3'], ['on spark4', 'spark4'], ['on akspark4', 'spark4'], ['on 4', 'spark4'],
    ['keep a spare 4 GB', ''], ['gemma 3 on nothing', ''], ['phi 4', ''], ['on node 4', ''], ['for 4 hours', ''], ['spark console 4', '']]) assert.equal(sparks(text), named, text);
});

// The target check, cut from the parts as text with the reader (sparkieCheck, tracesToRequest, pickContainer, sparkPlaces),
// on a fleet of Sparks 1 to 4; the stand-ins: the model is named (namesModel), no saved workflow, no memory.
const CHECK = (() => {
  const src = part('16-actions.mjs'), cut = (from, to) => { const a = src.indexOf(from), b = src.indexOf(to, a); assert.ok(a >= 0 && b > a, from); return src.slice(a, b); };
  const code = [cut('// Sparks are named the way people say them', 'const sparkList'), cut('const normQuotes', '// Never run from a channel'),
    cut('// The kinds of request (CHANGE_WORDS)', '// A typed answer to Sparkie'), cut('// Which of Spark Console\'s models on that Spark', '// A change\'s plan'),
    cut('// What Sparkie may do straight away', '// ctx says who').replace('await namesModel(out, saidText)', 'true')].join('\n');
  const knowledge = { workloads: {} };
  return { knowledge, ...new Function('NODES', 'sparkName', 'squash', 'HttpError', 'knowledge', 'memoryClear', 'findSaved', 'savedWorkflows', 'appNamed', 'powerSettingsClear', 'fromRequest', 'stepArgs',
    `${code}\nreturn { sparkieCheck, changeIntent };`)([{ id: 'spark1' }, { id: 'spark2' }, { id: 'spark3' }, { id: 'spark4' }], n => `Spark ${n.id.slice(5)}`,
    s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''), class extends Error {}, knowledge, () => false, () => null, () => [], () => false, () => false, o => o, s => s?.args || {}) };
})();
const check = (name, args, text, before = null) => CHECK.sparkieCheck(name, args, { intent: CHECK.changeIntent(text), said: [before, text].filter(Boolean).join('\n'), request: text });

test('A-20, final read 2 (S1, S3, S4): only this message names a place; one Spark named as a place, and nothing else, is where a start runs; none named, Spark Console places it; anything else is a button', async () => {
  assert.equal(FR2_STARTS.length, 59);
  for (const [text, before, want] of FR2_STARTS) {
    const got = [];
    for (const args of [{ model: 'gemma', spark: 'spark3' }, { model: 'gemma', spark: 'spark4' }, { model: 'gemma' }]) {
      const v = await check('start_model', args, text, before);
      got.push(`${v.clear ? '' : '?'}${v.input.sparks ? v.input.sparks.join('+') : v.input.spark || ''}`);
    }
    assert.equal(got.join(' '), want, `${text}${before ? ` (before: ${before})` : ''}`);
  }
  // A Spark named to keep the start off it never decides, whatever the call says (S1): a button, showing the call's Spark.
  for (const text of ['start gemma anywhere but spark 3', 'start gemma but leave spark 3 alone', 'start gemma, spark 3 is full', 'start gemma. keep spark 3 free', 'start gemma off spark 3',
    'start gemma on the spark that is not spark 3', 'start gemma somewhere other than spark 3', "start gemma, don't use spark 3"]) {
    for (const spark of ['spark3', 'spark4']) {
      const v = await check('start_model', { model: 'gemma', spark }, text);
      assert.deepEqual([v.clear, v.input.spark], [false, spark], `${text} (the call: ${spark})`);
    }
  }
  // The message before is never read for the place (R25's Today): a Spark it rules out is not remembered.
  for (const before of ["don't use spark 3 today", 'spark 3 is overheating', 'is the model on spark 3 ok?']) {
    const v = await check('start_model', { model: 'gemma', spark: 'spark3' }, 'start gemma', before);
    assert.deepEqual([v.clear, v.input.spark, v.input.sparks], [true, undefined, undefined], before);
  }
  // A start across two Sparks, both named as places as the call has them, runs at once there.
  const across = await check('start_model', { model: 'gemma', sparks: ['spark3', 'spark4'] }, 'start gemma across spark 3 and spark 4');
  assert.deepEqual([across.clear, across.input.sparks], [true, ['spark3', 'spark4']]);
});

test('A-20, final read 2 (S3, T1): a stop runs at once only on a Spark this message names and its own words settle, or, with none named, where no other Spark has a container of the console\'s that shares a word with them', async () => {
  CHECK.knowledge.workloads = Object.fromEntries([['spark3', 'sc-gemma-3-12b-it'], ['spark4', 'sc-gemma-3-12b-it'], ['spark4', 'sc-qwen3-coder'], ['spark3', 'sc-spark-tts-4']]
    .map(([spark, name], i) => [i, { byConsole: true, spark, name, running: true, state: 'running' }]));
  for (const [text, before, spark, container, clear] of FR2_STOPS) assert.equal((await check('stop_model', { spark, container }, text, before)).clear, clear, `${text}${before ? ` (before: ${before})` : ''} → ${spark}`);
  // The tie (T1): Spark 3 has two gemmas, so pickContainer picks neither there, but they share a word with "gemma": the
  // call's Spark 4 doesn't pick between three; one qwen, on one Spark, still runs.
  CHECK.knowledge.workloads = Object.fromEntries([['spark4', 'sc-gemma-3-12b-it'], ['spark3', 'sc-gemma-3-4b-it'], ['spark3', 'sc-gemma-3-27b-it'], ['spark4', 'sc-qwen3-coder']]
    .map(([s, name], i) => [i, { byConsole: true, spark: s, name, running: true, state: 'running' }]));
  for (const [text, name, args, clear] of [['stop gemma', 'stop_model', { spark: 'spark4', container: 'sc-gemma-3-12b-it' }, false],
    ['restart gemma', 'restart_model', { spark: 'spark4', container: 'sc-gemma-3-12b-it' }, false], ['stop qwen', 'stop_model', { spark: 'spark4', container: 'sc-qwen3-coder' }, true],
    ['stop gemma on spark 4', 'stop_model', { spark: 'spark4', container: 'sc-gemma-3-12b-it' }, true]]) assert.equal((await check(name, args, text)).clear, clear, `${text} → ${args.spark}`);
  CHECK.knowledge.workloads = {};
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

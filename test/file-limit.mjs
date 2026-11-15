// A test file that runs past its limit ends itself. A runner (tools/test-on-spark.sh) takes one request at a time and
// has no time limit of its own, and Node's test runner has none by default, so one test waiting for something that
// never comes (a poll with no deadline) once held two runners for hours. From the moment this module loads, a timer that
// never keeps a finished file alive (unref) waits FILE_LIMIT_MS: 40 minutes times SPARK_TEST_SLOW (the longest file
// takes about 11 minutes under load), or SPARK_TEST_FILE_LIMIT_S seconds when that is set (for tests). If the file's
// process is still there then, it prints one line on stderr (endedLine: the file, the test that was running, what that
// usually means), runs the clean-ups given to atFileLimit (test/lib.mjs gives it the fleet useFleet started) for at most
// CLEANUP_MS, and exits with ENDED_CODE, which fails the run; start-mock.mjs's exit hook then kills any stand-in fleet
// still up. A file that ends in time sees nothing of it: no output, no delay.
//
// test/lib.mjs imports it. A test file that starts a console, a fleet or a server without importing lib.mjs imports it
// itself, in one line: import './file-limit.mjs';
import { beforeEach, afterEach } from 'node:test';
import { relative } from 'node:path';

const SLOW = Math.max(1, Number(process.env.SPARK_TEST_SLOW) || 1);   // (as test/lib.mjs reads it)
const SET_S = Number(process.env.SPARK_TEST_FILE_LIMIT_S);
// (a timer longer than 2^31-1 ms would fire at once, so it is capped there)
export const FILE_LIMIT_MS = Math.min(2 ** 31 - 1, SET_S > 0 ? SET_S * 1000 : 40 * 60000 * SLOW);
export const ENDED_CODE = 124;
export const CLEANUP_MS = 5000;

const cleanups = [];
export const atFileLimit = fn => { cleanups.push(fn); };

// The tests running now (newest last), and the last one that ran past its own timeout: Node fails such a test and goes
// on, but what it was waiting for can go on waiting and keep the file alive.
const running = new Set();
let timedOut = null;
const nameOf = t => t.fullName ?? t.name;
beforeEach(t => { running.add(t); });
afterEach(t => {
  running.delete(t);
  if (t.error?.failureType === 'testTimeoutFailure') timedOut = nameOf(t);
});

const limitText = ms => (ms >= 60000 ? `${+(ms / 60000).toFixed(1)} minutes` : `${+(ms / 1000).toFixed(1)} seconds`);
export function endedLine(file, { test = null, timedOut: late = null } = {}, ms = FILE_LIMIT_MS) {
  const when = test ? ` while "${test}" was running`
    : late ? `; no test was running, but "${late}" had timed out and may still be waiting` : ' outside any test (in a hook or at its top level)';
  return `${file} ran past its limit of ${limitText(ms)} and was ended${when}. `
    + 'That usually means a test is waiting for something that never comes: give its waits a deadline.';
}

setTimeout(async () => {
  const file = process.argv[1] ? relative(process.cwd(), process.argv[1]) : 'This test file';
  const now = [...running].at(-1);
  const line = endedLine(file, { test: now ? nameOf(now) : null, timedOut });
  const bound = new Promise(r => setTimeout(r, CLEANUP_MS));
  await Promise.race([new Promise(r => process.stderr.write(`${line}\n`, () => r())), bound]);
  await Promise.race([Promise.allSettled(cleanups.map(async fn => fn())), bound]);
  process.exit(ENDED_CODE);
}, FILE_LIMIT_MS).unref();

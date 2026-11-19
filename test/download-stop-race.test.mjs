// Covers: T46 (part), a process can disappear while the download supervisor reads its Linux process record or
// sends the group a signal. The real stop check confirms the group's absence and holds any uncertain stop.
import './file-limit.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const source = readFileSync(new URL('../service/src/11-downloads.mjs', import.meta.url), 'utf8');
const supervisor = /const HF_WATCH_PY = String.raw\x60([^]*?)\x60;/.exec(source)?.[1];
assert.ok(supervisor, 'load the production download supervisor');
const LINUX = { skip: process.platform !== 'linux' && 'the supervisor reads Linux process records' };

const stopWithRace = String.raw`
import ast, errno, json, os, signal, subprocess, sys, time
from itertools import chain
from pathlib import Path
from types import SimpleNamespace

case = sys.argv[1]
functions = {'proc_stat', 'group_live', 'stop_group'}
tree = ast.parse(sys.stdin.read())
tree.body = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in functions]
assert {node.name for node in tree.body} == functions

child = subprocess.Popen(['/bin/sleep', '30'], start_new_session=True)
unrelated = None
errors = []
signals = fresh_checks = 0

def read_vanishing_stat():
    if case == 'proc-denied':
        errors.append(errno.EACCES)
        raise PermissionError(errno.EACCES, 'process record denied')
    # Open a real procfs file, then reap the process before the open file is read.
    with unrelated_stat.open() as stream:
        unrelated.terminate()
        unrelated.wait(timeout=5)
        try: return stream.read()
        except ProcessLookupError as exc:
            errors.append(exc.errno)
            raise

def proc_path(value):
    path = Path(value)
    if unrelated is not None:
        if path == Path('/proc'):
            entries = lambda: chain([unrelated_stat.parent], Path('/proc').iterdir())
            return SimpleNamespace(iterdir=entries)
        if path == unrelated_stat and unrelated.poll() is None:
            return SimpleNamespace(read_text=read_vanishing_stat)
    return path

def killpg(pgid, sig):
    global signals, fresh_checks
    if not sig:
        if signals:
            fresh_checks += 1
            if case == 'recheck-denied':
                errors.append(errno.EPERM)
                raise PermissionError(errno.EPERM, 'recheck denied')
            if case == 'recheck-io':
                errors.append(errno.EIO)
                raise OSError(errno.EIO, 'recheck failed')
        return os.killpg(pgid, sig)
    signals += 1
    if case == 'signal-denied':
        errors.append(errno.EPERM)
        raise PermissionError(errno.EPERM, 'signal denied')
    if case in ('recheck-live', 'recheck-denied', 'recheck-io'):
        errors.append(errno.ESRCH)
        raise ProcessLookupError(errno.ESRCH, 'stand-in for a process lookup failure')
    if case == 'signal-gone':
        # The group really vanishes between the scan and the supervisor's signal.
        os.killpg(pgid, signal.SIGTERM)
        child.wait(timeout=5)
    try: return os.killpg(pgid, sig)
    except ProcessLookupError as exc:
        errors.append(exc.errno)
        raise

try:
    if case in ('proc-gone', 'proc-denied'):
        unrelated = subprocess.Popen(['/bin/sleep', '30'])
        unrelated_stat = Path('/proc') / str(unrelated.pid) / 'stat'
    context = {'Path': proc_path, 'child': child, 'os': SimpleNamespace(killpg=killpg),
               'signal': signal, 'time': time}
    exec(compile(tree, 'HF_WATCH_PY', 'exec'), context)
    leader = context['proc_stat'](child.pid)
    assert leader and leader[1] == child.pid, 'the test process must lead its own group'
    if case == 'changed-leader':
        leader = (*leader[:2], str(int(leader[2]) + 1))
    context['leader'] = leader
    safe = context['stop_group']()
    names = [errno.errorcode[number] for number in errors]
    print(json.dumps({'safe': safe, 'alive': child.poll() is None,
                      'errors': names, 'signals': signals, 'freshChecks': fresh_checks}))
finally:
    for process in (child, unrelated):
        if process is None: continue
        if process.poll() is None: process.terminate()
        process.wait(timeout=5)
`;

function stopStatus(scenario) {
  const result = spawnSync('python3', ['-I', '-c', stopWithRace, scenario], {
    input: supervisor, encoding: 'utf8', timeout: 20000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('a process reaped during a stat read does not prevent the downloader from stopping', LINUX, () => {
  const got = stopStatus('proc-gone');
  assert.deepEqual(got.errors, ['ESRCH']);
  assert.equal(got.safe, true);
  assert.equal(got.alive, false);
  assert.equal(got.signals, 1);
});

test('a group reaped before its signal still needs a fresh check before the download can resume', LINUX, () => {
  assert.deepEqual(stopStatus('signal-gone'), {
    safe: true, alive: false, errors: ['ESRCH'], signals: 1, freshChecks: 1,
  });
});

test('a live group, a failed check or a changed process identity keeps the download on hold', LINUX, () => {
  for (const [scenario, errors, signals, freshChecks] of [
    ['recheck-live', ['ESRCH'], 1, 1],
    ['recheck-denied', ['ESRCH', 'EPERM'], 1, 1],
    ['recheck-io', ['ESRCH', 'EIO'], 1, 1],
    ['proc-denied', ['EACCES'], 0, 0],
    ['signal-denied', ['EPERM'], 1, 0],
    ['changed-leader', [], 0, 0],
  ]) {
    assert.deepEqual(stopStatus(scenario), { safe: false, alive: true, errors, signals, freshChecks }, scenario);
  }
});

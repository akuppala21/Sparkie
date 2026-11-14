#!/usr/bin/env python3
"""Run the unchanged update-record test file once and retain its result."""
import datetime
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time

EVIDENCE = Path(__file__).resolve().parent
REPO = Path(os.environ.get('SPARK_REVIEW_ROOT', EVIDENCE.parents[3])).resolve()
STATUS = EVIDENCE / 'updates-targeted.status.json'


def record(value):
    temporary = STATUS.with_suffix('.tmp')
    temporary.write_text(json.dumps(value, indent=2) + '\n')
    temporary.replace(STATUS)


if '--detach' in sys.argv:
    with (EVIDENCE / 'updates-targeted.driver.log').open('w') as log:
        child = subprocess.Popen([sys.executable, __file__], stdin=subprocess.DEVNULL,
                                 stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    print(json.dumps({'driverPid': child.pid, 'status': str(STATUS)}))
else:
    started = time.time()
    command = ['node', '--test', 'test/updates.test.mjs']
    source_paths = ['test/updates.test.mjs', 'service/server.mjs', 'service/src/18-workflows.mjs']
    status = {'driverPid': os.getpid(), 'state': 'running',
              'startedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'commit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=REPO, text=True).strip(),
              'strict': True, 'slowFactor': 3, 'testFiles': ['test/updates.test.mjs'],
              'command': command,
              'scope': 'Unchanged test, isolated local stand-in service; no live Spark or external network endpoint.',
              'sourceSha256': {name: hashlib.sha256((REPO / name).read_bytes()).hexdigest() for name in source_paths}}
    record(status)
    try:
        with (EVIDENCE / 'updates-targeted.log').open('w') as log:
            child = subprocess.Popen(command, cwd=REPO,
                                     env=dict(os.environ, SPARK_TEST_STRICT='1', SPARK_TEST_SLOW='3'),
                                     stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT)
            status['testPid'] = child.pid
            record(status)
            status['exitCode'] = child.wait()
        status['state'] = 'passed' if status['exitCode'] == 0 else 'failed'
    except Exception as error:
        status['state'] = 'error'
        status['error'] = str(error)
    status['elapsedSeconds'] = round(time.time() - started, 1)
    status['finishedAt'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    status['sourceUnchangedAfterRun'] = all(
        hashlib.sha256((REPO / name).read_bytes()).hexdigest() == digest
        for name, digest in status['sourceSha256'].items())
    record(status)

"""Exercise actual selector entry points, native pytest output and caller-owned JUnit."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
from tempfile import TemporaryDirectory
from xml.etree import ElementTree

source = Path(sys.argv[1]).resolve()
with TemporaryDirectory() as temp:
    root = Path(temp)
    (root / 'tools').mkdir()
    (root / 'tests').mkdir()
    shutil.copyfile(source, root / 'tools/checks.py')
    for module in ('test_native_integration', 'test_energy_integration'):
        (root / f'tests/{module}.py').write_text("def test_smoke():\n    pass\n")
    changed = 'tests/test_evidence.py'
    (root / changed).write_text(
        "def test_control():\n    assert 2 + 2 == 4\n\n"
        "def test_red():\n    assert 2 + 2 == 5\n")
    results = {}
    for case, opts, status, expected in [
        ('passing_control', '-qq -k control', 0, (1, 1, '1 passed, 3 deselected')),
        ('symptom_and_control', '-k "red or control"', 1, (2, 2, '1 failed, 1 passed, 2 deselected')),
        ('no_match', '-k missing_example', 5, (0, 0, '4 deselected')),
        ('fail_fast', '-x', 1, (4, 3, '1 failed, 2 passed')),
        ('collect_only', '--collect-only', 0, (4, 0, '4 tests collected')),
        ('docs_only', '', 0, None)
    ]:
        junit = root / f'{case}.xml'
        run = subprocess.run(
            [sys.executable, root / 'tools/checks.py', '--paths',
             'docs/overview.md' if case == 'docs_only' else changed, '--run-python'],
            cwd=temp, env=dict(os.environ, PYTEST_ADDOPTS=f'{opts} --junitxml={junit}'),
            text=True, capture_output=True, timeout=30)
        tail = json.loads(run.stdout.splitlines()[-1])
        assert run.returncode == status and not tail['release_qualified'], (case, run.stdout, run.stderr)
        result = dict(exit_code=run.returncode, final=tail)
        if expected is None:
            assert 'pytest' not in tail and not junit.exists()
        else:
            selected, starts, summary = expected
            assert tail['pytest'] == dict(target_path_count=3, selected_items=selected,
                                          item_starts=starts, native_summary=summary, exit_code=status), (case, tail)
            suite = ElementTree.parse(junit).getroot().find('testsuite')
            assert suite is not None
            result['caller_junit'] = {k: int(suite.get(k)) for k in ('tests', 'failures', 'errors', 'skipped')}
            result['junit_items'] = [c.get('name') for c in suite.findall('testcase')]
            if case == 'passing_control':
                assert result['junit_items'] == ['test_control']
            if case == 'symptom_and_control':
                assert result['junit_items'] == ['test_control', 'test_red'] and result['caller_junit']['failures'] == 1
        results[case] = result
print(json.dumps(results, indent=2))

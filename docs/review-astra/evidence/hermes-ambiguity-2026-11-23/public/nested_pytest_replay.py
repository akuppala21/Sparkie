"""Replay the public test selector with a real failing pytest item in a disposable checkout."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

CASES = [
    ("nested_prefix", "tests/components/test_reports.py", "explicit"),
    ("nested_suffix", "tests/formatting/render_test.py", "explicit"),
    ("suffix_at_root", "tests/render_test.py", "explicit"),
    ("preexisting_behavior_group", "tests/behavior/test_output.py", "explicit"),
    ("broad", "tests/components/test_reports.py", "unknown"),
    ("broad_suffix", "tests/formatting/render_test.py", "unknown"),
    ("discovered", "tests/components/test_reports.py", "git"),
    ("unrelated", "tests/components/test_reports.py", "docs"),
]
def observe(selector, cases):
    reports = {}
    for name, test_path, mode in cases:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "tools").mkdir()
            (root / "tests").mkdir()
            shutil.copyfile(selector, root / "tools/checks.py")
            for smoke in ("test_native_integration.py", "test_energy_integration.py","test_sandbox_cleanup.py"):
                (root / "tests" / smoke).write_text("def test_smoke():\n    assert True\n")
            (root / "pyproject.toml").write_text('[tool.pytest.ini_options]\ntestpaths=["tests"]\n')
            env = {**os.environ, "HOME":tmp, "GIT_CONFIG_NOSYSTEM":"1", "PYTEST_ADDOPTS":"-q -p no:cacheprovider"}
            if mode == "git":
                for cmd in (["git","init","-q"],["git","add","."],["git","-c","user.name=Fixture","-c","user.email=test@example.invalid","commit","-qm","baseline"]):
                    subprocess.run(cmd,cwd=root,env=env,check=True,stdout=subprocess.DEVNULL)
            red = root / test_path
            red.parent.mkdir(parents=True,exist_ok=True)
            red.write_text('def test_owner_reproduction():\n    raise AssertionError("nested-red-item")\n')
            args = {"explicit":["--paths",test_path], "unknown":["--paths","new_source.py"], "git":["--base","HEAD"], "docs":["--paths","docs/help.md"]}[mode]
            p=subprocess.run([sys.executable,"tools/checks.py",*args,"--run-python"], cwd=root,env=env,text=True,capture_output=True,timeout=30)
            plan=json.JSONDecoder().raw_decode(p.stdout)[0]
            assertion_returned="AssertionError: nested-red-item" in p.stdout
            if mode == "docs":
                passed=p.returncode == 0 and not plan["python_tests"] and not assertion_returned
            else:
                passed=p.returncode == 1 and assertion_returned and (mode == "unknown" or not plan["broad_qualification"])
                if name=="preexisting_behavior_group":
                    passed=passed and plan["compact_local_behavior"]
            reports[name]={"exit":p.returncode,"broad":plan["broad_qualification"],"selected":plan["python_tests"],"behavior":plan["compact_local_behavior"],"red_test_executed":assertion_returned,"met_requirement":passed}
    return reports
if __name__=="__main__":
    p=argparse.ArgumentParser();p.add_argument("selector",type=Path);p.add_argument("--reported",action="store_true");args=p.parse_args()
    results=observe(args.selector.resolve(),CASES[:1] if args.reported else CASES)
    print(json.dumps(results,indent=2))
    sys.exit(int(not all(r["met_requirement"] for r in results.values())))

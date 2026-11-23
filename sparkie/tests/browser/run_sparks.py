"""Exercise the checkout's Sparks panel in an isolated, local native dashboard."""
import argparse
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import subprocess
import sys
import tempfile
import time
from urllib.error import URLError
from urllib.request import ProxyHandler, build_opener

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]


def browser_tools():
    pin = json.loads((HERE / "package.json").read_text())["dependencies"]["playwright-core"]
    if not shutil.which("node"):
        raise SystemExit("Desktop/phone check unavailable: Node.js is missing.")
    node_env = dict(os.environ)
    cache = Path.home() / ".cache/sparkie/browser/node_modules"
    node_env["NODE_PATH"] = os.pathsep.join(filter(None, [str(cache), node_env.get("NODE_PATH")]))
    version = subprocess.run(
        ["node", "-p", "require('playwright-core/package.json').version"],
        cwd=HERE, env=node_env, text=True, capture_output=True)
    if version.returncode or version.stdout.strip() != pin:
        raise SystemExit(f"Desktop/phone check needs playwright-core@{pin}. From this extension checkout "
                         "run npm ci --prefix tests/browser --ignore-scripts --no-audit --no-fund. "
                         f"An offline worker can also use the pinned module in {cache}.")
    chrome = os.environ.get("SPARKIE_TEST_CHROME") or shutil.which("chromium")
    if not chrome:
        browsers = Path(os.environ.get("PLAYWRIGHT_BROWSERS_PATH", "/opt/playwright"))
        paths = sorted(browsers.glob("chromium_headless_shell-*/chrome-headless-shell-*/chrome-headless-shell"))
        chrome = next((str(p) for p in reversed(paths) if os.access(p, os.X_OK)), None)
    if not chrome or not os.access(chrome, os.X_OK):
        raise SystemExit("Desktop/phone check unavailable: set SPARKIE_TEST_CHROME to the workspace Chromium executable.")
    return chrome, node_env["NODE_PATH"]


def run(baseline, output):
    chrome, node_path = browser_tools()
    runtime = baseline / "hermes/.venv/bin/python"
    if not runtime.is_file() or not (baseline / "dashboard/index.html").is_file():
        raise SystemExit("Desktop/phone check unavailable: pass the extracted baseline containing Hermes and its dashboard.")
    if output is None:
        output = Path(tempfile.mkdtemp(prefix="sparkie-browser-results-"))
    else:
        output.mkdir(mode=0o700, parents=True, exist_ok=False)
    print(f"Browser results: {output}", flush=True)
    with tempfile.TemporaryDirectory(prefix="sparkie-browser-") as work:
        scratch = Path(work)
        home = scratch / "dashboard-home"
        home.mkdir()
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            port = probe.getsockname()[1]
        local_url = f"http://127.0.0.1:{port}"
        (home / "config.yaml").write_text(
            f"dashboard:\n  theme: sparkie\n  public_url: http://fixture.invalid:{port}\n"
            "plugins:\n  auto_apply: false\nplatforms:\n  telegram:\n    enabled: false\n")
        (home / "dashboard-themes").mkdir()
        shutil.copyfile(ROOT / "themes/sparkie.yaml", home / "dashboard-themes/sparkie.yaml")
        login = scratch / "login.json"
        login.write_text(json.dumps({"username": "fixture", "password": secrets.token_urlsafe(32)}))
        snapshot = scratch / "fleet.json"
        now = datetime.now(timezone.utc)
        snapshot.write_text(json.dumps({"schema": 1, "sparks": [
            {"id": f"spark{i}", "state": "online", "observed_at": now.isoformat(), "workloads": [], "network_links": []}
            for i in range(1, 5)]}))
        # Start from an isolated environment. The fixture reaches only its synthetic local service.
        env = dict(PATH=os.environ["PATH"], HOME=work, HERMES_HOME=str(home), PYTHONDONTWRITEBYTECODE="1",
                   HERMES_DISABLE_LAZY_INSTALLS="1", HERMES_ENABLE_PROJECT_PLUGINS="0", HF_HUB_OFFLINE="1",
                   HERMES_WEB_DIST=str(baseline / "dashboard"), HERMES_BUNDLED_PLUGINS=str(scratch / "plugins"),
                   HERMES_RUNTIME_DIR=str(scratch / "runtime"), NODE_PATH=node_path,
                   PYTHONPATH=os.pathsep.join([str(ROOT / "src"), str(baseline / "hermes")]),
                   SPARKIE_TEST_LOGIN=str(login), SPARKIE_TEST_MEMORY_REVIEW="1", SPARKIE_FLEET_SNAPSHOT=str(snapshot),
                   SPARKIE_ENERGY_DATABASE=str(scratch / "energy.sqlite"), SPARKIE_TEST_URL=local_url,
                   SPARKIE_TEST_CHROME=chrome, SPARKIE_BROWSER_OUTPUT=str(output))
        subprocess.run([runtime, ROOT / "tools/package_plugins.py", baseline / "hermes/plugins",
                        scratch / "plugins", "--extension", ROOT / "plugin"], env=env, check=True)
        sys.path.insert(0, str(ROOT / "src"))
        from sparkie_sparks.energy import ZONE, record
        local = now.astimezone(ZONE)
        previous = (local.replace(day=1) - timedelta(days=1)).replace(day=15)
        for start, counter, usage in [(previous, 1, .02), (previous.replace(year=previous.year - 1), 2, .03),
                                      (now - timedelta(minutes=2), 3, .01)]:
            for at, meter in [(start, counter), (start + timedelta(minutes=1), counter + usage)]:
                record(env["SPARKIE_ENERGY_DATABASE"], spark="spark2", meter="fixture", at=at, kwh=meter)
        args = [runtime, HERE / "dashboard_fixture.py", "--host", "127.0.0.1", "--port", str(port), "--no-open", "--skip-build"]
        local_http = build_opener(ProxyHandler({}))
        with (scratch / "server.log").open("w") as log:
            server = subprocess.Popen(args, env=env, cwd=scratch, stdout=log, stderr=subprocess.STDOUT)
            try:
                for _ in range(100):
                    if server.poll() is not None:
                        raise SystemExit("Native dashboard exited before startup. Browser checks did not run.")
                    try:
                        with local_http.open(local_url + "/api/status", timeout=1) as response:
                            if json.load(response).get("auth_required") is True:
                                break
                    except (URLError, TimeoutError):
                        pass
                    time.sleep(.2)
                else:
                    raise SystemExit("The isolated native dashboard did not report its authentication gate.")
                subprocess.run(["node", HERE / "sparks.mjs"], env=env, cwd=HERE, check=True, timeout=150)
                saved = (home / "memories" / "USER.md").read_text()
                assert saved.count("Paper proofs use A3 stock.") == 1
                assert "Draft note to discard." not in saved
            finally:
                server.terminate()
                try:
                    server.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    server.kill()
                    server.wait()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("baseline", type=Path, help="release path returned by spark_update_source")
    parser.add_argument("output", type=Path, nargs="?",
                        help="new directory for the browser report and screenshots (default: a fresh temporary directory)")
    args = parser.parse_args()
    run(args.baseline.resolve(), args.output.resolve() if args.output is not None else None)

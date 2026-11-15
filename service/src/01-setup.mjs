/* ───────── setup: the build id, config.json, the Sparks, test switches and shared helpers ───────── */
// Area: ground        Rules: R8, R28, R29, R30        Tests: build.test.mjs, fleet.test.mjs
// Owns: none
// Timers: none        Wakes: none
// Generated: this file is service/src/*.mjs joined in name order (node tools/build-server.mjs). Edit the parts.
// Spark Console API: live metrics, the model library and deployments across the Spark fleet.
// Runs on the portal host behind `tailscale serve --set-path=/console/api`, next to the portal.
// Every request must come from a tailnet user the portal knows; anything that changes a Spark is owner-only.
import http from 'node:http';
import https from 'node:https';
import { lookup as dnsLookup } from 'node:dns';
import { isIP, BlockList, createServer as createNetServer } from 'node:net';
import { createGunzip, createInflate, createBrotliDecompress } from 'node:zlib';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, writeFileSync, appendFileSync, renameSync, mkdirSync, statSync, unlinkSync, chmodSync, readdirSync, openSync, fsyncSync, closeSync, copyFileSync, writeSync, readSync, fstatSync } from 'node:fs';
import { homedir } from 'node:os';
import { randomBytes, createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as dig from './dig.mjs';
import * as passkey from './passkey.mjs';

const VERSION = '1.0.0';
// The service's code fingerprint (server.mjs, dig.mjs, passkey.mjs, in that order): the installer checks /health reports
// the build it just copied, or it rolls back. buildOf gives the same fingerprint for any folder holding a copy of the
// service (an install snapshot's).
const buildOf = dir => {
  const h = createHash('sha256');
  for (const f of ['server.mjs', 'dig.mjs', 'passkey.mjs']) h.update(readFileSync(`${String(dir).replace(/\/$/, '')}/${f}`));
  return h.digest('hex').slice(0, 12);
};
const BUILD = buildOf(fileURLToPath(new URL('.', import.meta.url)));
const STARTED_AT = new Date().toISOString();
const HERE = fileURLToPath(new URL('.', import.meta.url));
const readJsonFile = name => (existsSync(HERE + name) ? JSON.parse(readFileSync(HERE + name, 'utf8')) : null);

const CONFIG = {
  port: 8810,
  origin: null,
  user: process.env.USER || 'akuppala',
  nodes: [],
  modelsHost: 'spark3',
  modelsDir: 'models',
  servePort: 8000,
  images: {},
  // Where a recipe's container image may come from for it to be one click (prefixes). Anything else is listed, not run.
  imageSources: ['nvcr.io/nvidia/', 'vllm/vllm-openai', 'lmsysorg/sglang', 'ghcr.io/ggml-org/llama.cpp', 'eugr/'],
  main: null,
  // Containers the console never stops on its own (deploy plans, agents): name patterns, * matches anything. The
  // owner's qwen-recipe benchmarks by default; a container labelled spark.protect=true is always protected too.
  protect: ['qwen-recipe-*'],
  ...readJsonFile('config.json'),
};
if (process.env.PORT) CONFIG.port = Number(process.env.PORT);
// Test switches: run every Spark's commands on this machine (each with its own HOME under MOCK_ROOT),
// and accept requests without Tailscale headers as this login.
const ALL_LOCAL = process.env.SPARK_CONSOLE_ALL_LOCAL === '1';
// A stand-in identity for local test runs only; ignored on the real Sparks.
const DEV_LOGIN = ALL_LOCAL ? process.env.SPARK_CONSOLE_DEV_LOGIN || '' : '';
// Tests only: the port model servers answer on, so a stand-in can listen there.
if (ALL_LOCAL && process.env.SPARK_CONSOLE_SERVE_PORT) CONFIG.servePort = Number(process.env.SPARK_CONSOLE_SERVE_PORT);
const OFFLINE = new Set((process.env.SPARK_CONSOLE_OFFLINE || '').split(',').filter(Boolean));
const offlineNow = id => {
  if (!process.env.SPARK_CONSOLE_OFFLINE_FILE) return OFFLINE.has(id);
  try { return readFileSync(process.env.SPARK_CONSOLE_OFFLINE_FILE, 'utf8').split(/[\s,]+/).includes(id); } catch { return false; }
};
const OFFLINE_TTL = Number(process.env.SPARK_CONSOLE_OFFLINE_TTL_MS || 60000);
const NODES_TTL = Number(process.env.SPARK_CONSOLE_NODES_TTL_MS || 60000);

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const q = s => `'${String(s).replace(/'/g, `'\\''`)}'`;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
// The Sparks come from the portal (see refreshNodes), so ones it adds later show up without editing config.json.
// config.json's list is only the starting point until the portal answers.
let NODES = (CONFIG.nodes || []).map(n => ({ ...n }));
const nodeById = id => NODES.find(n => n.id === id);
const NODE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const PROTECT_RES = (Array.isArray(CONFIG.protect) ? CONFIG.protect : []).filter(x => typeof x === 'string' && x)
  .map(g => new RegExp(`^${g.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`));
const isProtected = (name, label) => label === 'true' || PROTECT_RES.some(re => re.test(String(name)));
const MODELS = `"$HOME/${CONFIG.modelsDir}"`;
// Each Spark's Hugging Face cache (where `hf download` and vLLM put models). Models there join the library as they are.
const HF_HUB = '"${HF_HUB_CACHE:-${HF_HOME:-$HOME/.cache/huggingface}/hub}"';
// Shell: set $snap to the snapshot a cache entry serves: the commit refs/main names, else the newest one
// (entries a container downloaded often have no refs/).
const hfSnap = dir => `snap=$(cat ${dir}/refs/main 2>/dev/null); { [ -n "$snap" ] && [ -d ${dir}/snapshots/"$snap" ]; } || snap=$(ls -t ${dir}/snapshots 2>/dev/null | head -1)`;
// Shell (bash, after hfSnap with $dir set): the bash array $hfmounts, how a container sees that cache entry. Normally its
// folder, read-only at /hf, where the snapshot's links into ../../blobs resolve. A copy whose files link outside that
// folder (Spark 3, 2026-11-08: its big weight blobs were links to elsewhere on the disk, so SGLang found 3 shards
// missing) gets each snapshot file mounted by itself at the same /hf/snapshots/<commit>/ path instead. --mount, not -v:
// a link to nothing fails to start rather than leaving an empty folder in its place.
function hfMounts() {
  return `hfmounts=(-v "$dir:/hf:ro"); hfreal=$(readlink -f "$dir")
if [ -n "$(cd "$dir/snapshots/$snap" 2>/dev/null && find . \\( -type l -o -type f \\) -exec readlink -f {} \\; | awk -v p="$hfreal/" 'NF && index($0, p) != 1')" ]; then
  hfmounts=()
  while IFS= read -r f; do hfmounts+=(--mount "type=bind,src=$(readlink -f "$dir/snapshots/$snap/$f"),dst=/hf/snapshots/$snap/$f,readonly"); done < <(cd "$dir/snapshots/$snap" && find . \\( -type l -o -type f \\) | sed 's#^\\./##')
fi
`;
}
const STATE_DIR = process.env.SPARK_CONSOLE_STATE_DIR || `${homedir()}/.local/state/spark-console`;
// The journal (20-journal.mjs, R43): beside the state folder, never in it, so neither the daily copy nor an install
// snapshot takes it. Under ALL_LOCAL a test names its own, else it sits next to that run's state folder.
const JOURNAL_DIR = ALL_LOCAL ? process.env.SPARK_CONSOLE_JOURNAL_DIR || `${STATE_DIR.replace(/\/+[^/]*\/*$/, '')}/journal` : `${homedir()}/.local/share/spark-console/journal`;
// The console's own commands on a Spark (R10) take their programs from FIXED_PATH, which holds no folder of the
// owner's home, and their Python and curl read nothing from the home (-I: no folder of its own, no user site; -q: no
// ~/.curlrc). A change inside the run wall may write most of the home; nothing it writes there is obeyed by them. Under
// ALL_LOCAL the tests' own PATH is kept, so the stand-ins are found.
const FIXED_PATH = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/snap/bin';
const PATH_FIRST = ALL_LOCAL ? '' : `PATH=${FIXED_PATH}; export PATH; `;
const PREAMBLE = `export PATH=${ALL_LOCAL ? '"$PATH:/usr/local/bin"' : FIXED_PATH}
python3() { command python3 -I "$@"; }
curl() { command curl -q "$@"; }
`;
// What those commands call on a Spark, every one on FIXED_PATH on a stock DGX OS. Each status round looks for them
// there (runWorker) and the needs-you list names any that is missing; deploy/path-check.sh is the same look by hand.
// (Under ALL_LOCAL the stand-in Sparks share the test machine's programs, so a test marks one missing with
// ~/.mock/no-<name> instead.)
const PATH_PROGRAMS = 'bash timeout python3 docker nvidia-smi tailscale curl tar gzip ip ss ping who sudo systemctl journalctl loginctl ps free df du find xargs readlink sed awk grep cut cat head tail tr wc sort ls mkdir rm rmdir mv ln basename paste base64 id sleep';
const PATH_CHECK = `m=; for p in ${PATH_PROGRAMS}; do ${ALL_LOCAL ? '[ ! -e "$HOME/.mock/no-$p" ]' : 'command -v "$p" >/dev/null 2>&1'} || m="$m $p"; done; printf '{"type":"path","missing":"%s"}\\n' "\${m# }"; `;
const pathMissing = new Map();

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}


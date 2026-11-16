#!/usr/bin/env bash
# Installs a tested build of Spark Console on Spark 2 from GitHub, without the Mac (design C 2.3; R29, R30). Run it on
# Spark 2, in a terminal, as the user Spark Console runs as. It needs no sudo, never calls tailscale or ssh, and uses
# no key but the GitHub read token it keeps. Every install copies it to ~/.local/share/spark-console/, once the new
# build is kept, so the build that is installed is the one that judges the next.
#
#   bash ~/.local/share/spark-console/pull.sh setup <owner>/<repository>
#       Once. Asks for a GitHub token (fine-grained, this one repository, Contents: read; not shown as you type),
#       tries it, keeps it in ~/.config/spark-console/secrets.json as github: {repo, token}, and makes the bare copy
#       ~/.local/share/spark-console/repo.git. Run it again to give a new token.
#   bash ~/.local/share/spark-console/pull.sh check
#       Fetches, then says what is installed and the newest tested build on main. Changes nothing.
#   bash ~/.local/share/spark-console/pull.sh install <tree>
#       Installs that build through its own installer (deploy/host-on-portal.sh local, with SKIP_ROUTES=1). From there
#       it is the usual install: snapshot, checks as the owner, the previous files back on any miss.
#
# install refuses, with nothing changed: a <tree> that isn't the newest commit on main with a tested/<tree> tag (the
# head of main before its full run passed, an older tested build, a tree only on another branch); one older than the
# build installed (going back is go-back.sh's job); a tag that does more than add the lock to that commit; a lock for
# another tree or another build; a tree holding a submodule, a link other than the stand-in fleet's (below), or a
# .gitattributes with export-; a second install while one runs. Each install leaves
# ~/.local/state/spark-console/update-result.json: {tree, build, result: kept | not kept | refused, why, at}; kept
# means the new build answers, the installed lock names this tree, and (when a build answered before) the real address
# answered with it.
# When a build answers now, the real address (config.json's origin) must answer with it first, or nothing changes.
# Then the way back is armed from this build, not the incoming one (update-guard.sh, beside this file): a copy of what
# an install changes and one timer in the owner's systemd that puts it back unless this script confirms the new build
# through the real address within 10 minutes of its installer ending. The incoming installer runs with tailscale, sudo,
# ssh and systemd-run refused, whatever it does with SKIP_ROUTES=1; a call to one of them means not kept. Tests may
# use SPARK_CONSOLE_DOOR_URL, SPARK_CONSOLE_UPDATE_CONFIRM_S and SPARK_CONSOLE_FETCH_S, only with
# SPARK_CONSOLE_ALL_LOCAL=1. A fetch gets 60 seconds.
# The token reaches git only through its environment, never a command line or git's config. A test may point at
# another repository with SPARK_CONSOLE_REPO_URL, only with SPARK_CONSOLE_ALL_LOCAL=1.
set -euo pipefail
STATE="$HOME/.local/state/spark-console"
SHARE="$HOME/.local/share/spark-console"
REPO="$SHARE/repo.git"
SECRETS="$HOME/.config/spark-console/secrets.json"
RESULT="$STATE/update-result.json"
LOCK_PATH=service/workflows.lock.json
ME="bash $SHARE/pull.sh"
HERE="$(cd "$(dirname "$0")" && pwd)"
WANT='' W='' DOOR='' ARMED='' ARMING=''
CONFIRM_S=600
# On the stand-in fleet the incoming installer is told so by an argument (--stand-in), not by what it inherits.
STAND_IN=''; [ "${SPARK_CONSOLE_ALL_LOCAL:-}" != 1 ] || STAND_IN=--stand-in
if [ "${SPARK_CONSOLE_ALL_LOCAL:-}" = 1 ] && [[ "${SPARK_CONSOLE_UPDATE_CONFIRM_S:-}" =~ ^[0-9]+$ ]]; then CONFIRM_S=$SPARK_CONSOLE_UPDATE_CONFIRM_S; fi
FETCH_S=60 FETCH_SETUP_S=300 FETCH_SLOW='' FETCH_ERR='' FETCH_LOCK=''
if [ "${SPARK_CONSOLE_ALL_LOCAL:-}" = 1 ] && [[ "${SPARK_CONSOLE_FETCH_S:-}" =~ ^[0-9]+$ ]]; then FETCH_S=$SPARK_CONSOLE_FETCH_S FETCH_SETUP_S=$SPARK_CONSOLE_FETCH_S; fi

die() { echo "  STOP: $*" >&2; exit 1; }
usage() {
  echo "Usage: $ME setup <owner>/<repository> | check | install <tree>   (<tree>: the 12 hex digits pull.sh check names)" >&2
  exit 2
}
# The result of this install, for the record (and, later, for the console to tell): written whole, owner-only.
result() {  # result <kept|not kept|refused> <why> [build]
  ( umask 077; mkdir -p "$STATE" ) && python3 -I -c 'import datetime, json, os, sys, tempfile
path, tree, res, why, build = sys.argv[1:6]
d = {"tree": tree, "build": build or None, "result": res, "why": why[:600],
     "at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")}
fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), prefix=".update-result.", suffix=".tmp")
with os.fdopen(fd, "w") as f: json.dump(d, f)
os.replace(tmp, path)' "$RESULT" "$WANT" "$1" "$2" "${3:-}" || echo "  NOTE: couldn't write $RESULT." >&2
}
refuse() { echo "  STOP: $1 Nothing was changed." >&2; [ -z "$WANT" ] || result refused "$1"; exit 1; }
# A question for the person at this terminal: no terminal, no yes (a test may answer from a file, only with ALL_LOCAL).
ask() {
  local a='' from=/dev/tty
  if [ "${SPARK_CONSOLE_ALL_LOCAL:-}" = 1 ] && [ -n "${SPARK_CONSOLE_TERMINAL:-}" ]; then from=$SPARK_CONSOLE_TERMINAL; fi
  printf '%s' "$1" >&2 || true
  read -r a <"$from" 2>/dev/null || a=''
  echo "$a"
}
# Stopped before the way back is armed: by the time limit of the unit an install from chat runs in, or by hand. Nothing
# of the install has changed yet (once the way back is armed, interrupted puts back and says what answers). A stop that
# lands while the way back is being armed takes this install's own back (half made, or whole with its timer), so it
# isn't left armed for its 30 minutes; another update's is never touched.
stopped() {
  set +e; trap '' PIPE
  trap - INT TERM HUP
  if [ -n "$ARMING" ] && [ -e "$SHARE/update-guard" ]; then
    local gf="$SHARE/update-guard/guard"
    if [ ! -s "$gf" ] || { [ "$(sed -n 's/^tree=//p' "$gf" | head -n 1)" = "$WANT" ] && [ "$(sed -n 's/^pgid=//p' "$gf" | head -n 1)" = "$ARMING" ]; }; then
      bash "$HERE/update-guard.sh" disarm 9>&- >/dev/null 2>&1
    fi
  fi
  echo "  The install was stopped before it changed anything." >&2
  result refused "the install was stopped before it changed anything"
  exit 130
}
# Cut off (Ctrl-C, the terminal closed) once the way back is armed: it puts back what differs, and the result says what
# answers then. (A cut at the very end, while the confirmed build's copy is being removed, leaves that build running.)
interrupted() {
  # (with the terminal gone, a line written to it fails: nothing here may stop before the put-back)
  set +e; trap '' PIPE
  trap - INT TERM HUP
  echo "  The install was interrupted." >&2
  bash "$SHARE/update-guard/update-guard.sh" put-back pull "the install was interrupted" 9>&- || true
  local now ib it ic what
  now=$(health_build)
  read -r ib it ic <<<"$(installed)"
  what="the build answering now is ${now:-none}$([ "$it" = - ] || echo ", installed from tree ${it:0:12}")"
  if [ "$now" = "$code_build" ] && [ "$it" = "$t" ]; then result kept "the install was interrupted after the new build was confirmed; $what" "$code_build"
  else result 'not kept' "the install was interrupted; $what" "$code_build"; fi
  exit 130
}

# git, on the bare copy only, with nothing from the system's or the user's git config (a rewrite to SSH, a credential
# store), no prompt, no hooks, HTTPS only, and every fetched object checked.
g() { git_safe git -C "$REPO" "$@"; }
git_safe() {  # git_safe <command…>: runs it with that environment (the command is git, or timeout in front of git)
  local proto=https
  [ "${SPARK_CONSOLE_ALL_LOCAL:-}" != 1 ] || proto=https:file
  GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null GIT_TERMINAL_PROMPT=0 GIT_ASKPASS=/bin/false SSH_ASKPASS='' \
    GIT_ALLOW_PROTOCOL="$proto" "$@"
}
need_git() {
  command -v git >/dev/null 2>&1 || die "git isn't installed on this Spark. Install it once (sudo apt install git), then run this again."
  local v; v=$(git --version 2>/dev/null | sed -n 's/^git version \([0-9]*\)\.\([0-9]*\).*/\1 \2/p')
  set -- $v
  [ $# = 2 ] && { [ "$1" -gt 2 ] || { [ "$1" = 2 ] && [ "$2" -ge 32 ]; }; } \
    || die "pull.sh needs git 2.32 or newer, and this Spark has $(git --version 2>/dev/null || echo 'an unreadable one'). Update it, then run this again."
}
# The address: github.com and the repository the secrets file names. A test's own address only with ALL_LOCAL.
url_for() {
  if [ "${SPARK_CONSOLE_ALL_LOCAL:-}" = 1 ] && [ -n "${SPARK_CONSOLE_REPO_URL:-}" ]; then echo "$SPARK_CONSOLE_REPO_URL"
  else echo "https://github.com/$1.git"; fi
}
# fetch <url> <basic credentials>: main and the tested/ tags, and nothing else. The token is in git's environment
# (GIT_CONFIG_*), for github.com only. It gets FETCH_S seconds, or the third argument's (setup's first fetch carries the
# whole history): timeout runs git in a process group of its own and ends all of it (git's https helper too), so
# nothing waits on a network for ever (FETCH_SLOW=1 then). Where there is no timeout (a Mac), there is no limit, and
# the console's own limit can end git half way: a lock it leaves in the copy is named (FETCH_LOCK), never removed here.
fetch() {
  local err code=0 cut=() limit=${3:-$FETCH_S} real
  ! command -v timeout >/dev/null 2>&1 || cut=(timeout "$limit")
  FETCH_SLOW='' FETCH_LOCK=''
  err=$(GIT_CONFIG_COUNT=4 GIT_CONFIG_KEY_0=http.https://github.com/.extraheader GIT_CONFIG_VALUE_0="Authorization: basic $2" \
    GIT_CONFIG_KEY_1=credential.helper GIT_CONFIG_VALUE_1='' GIT_CONFIG_KEY_2=core.hooksPath GIT_CONFIG_VALUE_2=/dev/null \
    GIT_CONFIG_KEY_3=fetch.fsckObjects GIT_CONFIG_VALUE_3=true \
    git_safe ${cut[@]+"${cut[@]}"} git -C "$REPO" fetch -q --no-tags --prune "$1" '+refs/heads/main:refs/heads/main' '+refs/tags/tested/*:refs/tags/tested/*' 2>&1 >/dev/null) \
    || code=$?
  [ "$code" != 0 ] || return 0
  if [ "$code" = 124 ] && [ ${#cut[@]} -gt 0 ]; then
    FETCH_SLOW=1 FETCH_ERR="the fetch from $1 didn't finish in $limit seconds"
    echo "  Couldn't fetch from $1: it didn't finish in $limit seconds." >&2
    return 1
  fi
  FETCH_ERR=$err
  # (git's own words for a lock left behind: "Unable to create '<path>.lock': File exists"; only a path in the copy)
  FETCH_LOCK=$(printf '%s\n' "$err" | sed -n "s/.*Unable to create '\([^']*\.lock\)': File exists.*/\1/p" | head -n 1) || FETCH_LOCK=''
  case "$FETCH_LOCK" in /*|'') ;; *) FETCH_LOCK="$REPO/${FETCH_LOCK#./}" ;; esac
  FETCH_LOCK=${FETCH_LOCK//\/.\//\/}
  # (git names it by the copy's real path: told as the path this script uses)
  real=$(cd "$REPO" 2>/dev/null && pwd -P) || real=$REPO
  case "$FETCH_LOCK" in "$real"/*) FETCH_LOCK="$REPO/${FETCH_LOCK#"$real"/}" ;; esac
  case "$FETCH_LOCK" in "$REPO"/*) case "$FETCH_LOCK" in */../*) FETCH_LOCK='' ;; esac ;; *) FETCH_LOCK='' ;; esac
  echo "  Couldn't fetch from $1. git said: $(printf '%s' "$err" | tail -n 2 | tr '\n' ' ')" >&2
  return 1
}
# The repository and its credentials from the secrets file: "<owner/repo> <base64 of x-access-token:token>".
from_secrets() {
  python3 -I -c 'import base64, json, re, sys
try:
    g = json.load(open(sys.argv[1])).get("github") or {}
    repo, token = g["repo"], g["token"]
except Exception:
    sys.exit(1)
if not (isinstance(repo, str) and re.fullmatch(r"[A-Za-z0-9-]+/[A-Za-z0-9._-]+", repo) and isinstance(token, str) and token):
    sys.exit(1)
print(repo, base64.b64encode(("x-access-token:" + token).encode()).decode())' "$SECRETS" 2>/dev/null
}
ready() {  # sets REPO_NAME, URL and AUTH, then fetches
  need_git
  local s
  s=$(from_secrets) && [ -d "$REPO" ] || refuse "pull.sh isn't set up on this Spark yet. Run once: $ME setup <owner>/<repository>"
  read -r REPO_NAME AUTH <<<"$s"
  URL=$(url_for "$REPO_NAME")
  if ! fetch "$URL" "$AUTH"; then
    [ -z "$FETCH_LOCK" ] || refuse "A fetch that was cut off left git's lock behind in this Spark's copy of the repository. Remove it once (rm '$FETCH_LOCK'), then run this again."
    [ -z "$FETCH_SLOW" ] || refuse "The fetch from GitHub didn't finish in $FETCH_S seconds. Try again in a while."
    refuse "GitHub couldn't be reached, or didn't accept the token (a new one: $ME setup $REPO_NAME)."
  fi
}
sha12() { if command -v sha256sum >/dev/null 2>&1; then sha256sum; else shasum -a 256; fi | cut -c1-12; }
# links_ok: reads "<path>\0<target>\0" pairs and prints the first link that isn't allowed (nothing when all are). A link
# is allowed only under test/mock/root/ (the stand-in fleet's Hugging Face caches, which only travel inside the source
# copy, where a link stays a link), and only with a relative target that, read from the link's own folder, stays under
# test/mock/root/, or an absolute target under /hf/ with no .. in it (that cache's path inside a model's container; on
# Spark 2 it points at nothing).
links_ok() {
  python3 -I -c 'import os, sys
f = sys.stdin.buffer.read().split(b"\0")
if f and f[-1] == b"": f.pop()
if len(f) % 2: print("(a link that could not be read)"); sys.exit()
for i in range(0, len(f), 2):
    p, t = f[i].decode("utf-8", "replace"), f[i + 1].decode("utf-8", "replace")
    if p.startswith("test/mock/root/") and t and "\n" not in t:
        if t.startswith("/"):
            if t.startswith("/hf/") and ".." not in t.split("/"): continue
        elif os.path.normpath(os.path.join(os.path.dirname(p), t)).startswith("test/mock/root/"):
            continue
    print(p); break'
}
# The newest commit on main whose tree has a tested/ tag: "<commit> <tree>", or nothing. Every commit main holds, in
# topological order: main moves by fast-forward, often onto a merge whose second parent is the head before, so each
# earlier head comes after every later one (first parents alone would miss them).
newest_tested() {
  local tags c t
  tags=" $(g for-each-ref --format='%(refname:lstrip=3)' refs/tags/tested/ | tr '\n' ' ') "
  while read -r c t; do
    case "$tags" in *" ${t:0:12} "*) echo "$c $t"; return 0 ;; esac
  done < <(g log --topo-order -n 5000 --format='%H %T' refs/heads/main)
}
# tag_check <commit> <tree>: tested/<tree> is that commit plus the lock and nothing else, and the lock names that tree
# (its build 12 hex digits, its tree in full; its time, if any, a time) and the build that code is, worked out from the
# three code files in git (read, never run or checked out). Sets TAG_COMMIT, TAG_BUILD and TAG_AT (the time it was
# tested, or -). On a miss it fails, with why in TAG_WHY (only this script's words and checked ids: nothing from the
# repository's text). install refuses on a miss; check doesn't offer it, so it names only what install would take.
tag_check() {
  local c=$1 t=$2 want=${2:0:12} tab lockf fields ltree p
  TAG_WHY='' TAG_COMMIT='' TAG_BUILD='' TAG_AT=-
  TAG_COMMIT=$(g rev-parse -q --verify "refs/tags/tested/$want^{commit}" 2>/dev/null) \
    || { TAG_WHY="tested/$want doesn't name a commit."; return 1; }
  tab=$(printf '\t')
  [ "$(g diff-tree -r --no-renames --name-status "$c" "$TAG_COMMIT" 2>/dev/null)" = "A${tab}$LOCK_PATH" ] \
    || { TAG_WHY="tested/$want changes more than adding $LOCK_PATH to commit ${c:0:12}."; return 1; }
  lockf=$(g cat-file -s "$TAG_COMMIT:$LOCK_PATH" 2>/dev/null || echo 0)
  [[ "$lockf" =~ ^[0-9]+$ ]] && [ "$lockf" -gt 0 ] && [ "$lockf" -le 65536 ] \
    || { TAG_WHY="The lock in tested/$want is missing or too big."; return 1; }
  fields=$(g cat-file blob "$TAG_COMMIT:$LOCK_PATH" | python3 -I -c 'import json, re, sys
d = json.loads(sys.stdin.read())
ok = lambda k, p: isinstance(d.get(k), str) and re.fullmatch(p, d[k])
if not (isinstance(d, dict) and ok("build", "[0-9a-f]{12}") and isinstance(d.get("versions"), dict)): sys.exit(1)
print(d["build"], d["tree"] if ok("tree", "[0-9a-f]{40}([0-9a-f]{24})?") else "-",
      d["testedAt"] if ok("testedAt", r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?Z") else "-")' 2>/dev/null) \
    || { TAG_WHY="The lock in tested/$want isn't one the installer can read."; return 1; }
  read -r TAG_BUILD ltree TAG_AT <<<"$fields"
  [ "$ltree" != - ] || { TAG_WHY="The lock in tested/$want names no tree."; return 1; }
  [ "$ltree" = "$t" ] || { TAG_WHY="The lock in tested/$want is for tree ${ltree:0:12}, not this tree ($want)."; return 1; }
  p=$(for p in server.mjs dig.mjs passkey.mjs; do g cat-file blob "$c:service/$p" || exit 1; done | sha12) \
    || { TAG_WHY="Tree $want has no service/server.mjs, dig.mjs or passkey.mjs."; return 1; }
  [ "$TAG_BUILD" = "$p" ] || { TAG_WHY="The lock in tested/$want is for build $TAG_BUILD, but this code is build $p."; return 1; }
  TAG_BUILD=$p
}
# The installed build, from its lock: "<build> <tree or -> <commit or ->".
installed() {
  python3 -I -c 'import json, sys
try: d = json.load(open(sys.argv[1]))
except Exception: d = {}
print(d.get("build") or "-", d.get("tree") or "-", d.get("commit") or "-")' "$HOME/spark-console-service/workflows.lock.json" 2>/dev/null || echo '- - -'
}
# The real address, the way in the owner uses: config.json's origin, as installed now (a test's own, only with ALL_LOCAL).
door_url() {
  if [ "${SPARK_CONSOLE_ALL_LOCAL:-}" = 1 ] && [ -n "${SPARK_CONSOLE_DOOR_URL:-}" ]; then echo "$SPARK_CONSOLE_DOOR_URL"; return 0; fi
  python3 -I -c 'import json, re, sys
try: o = json.load(open(sys.argv[1])).get("origin") or ""
except Exception: o = ""
if not re.fullmatch(r"https://[a-z0-9.-]+(:[0-9]{1,5})?", o): sys.exit(1)
print(o)' "$HOME/spark-console-service/config.json" 2>/dev/null
}
# door_get <path>: the status code through the real address (000: no answer at all); the body in $W/door.body.
door_get() {
  local c
  c=$(curl -q -s -m 10 --max-redirs 0 -o "$W/door.body" -w '%{http_code}' "$DOOR$1" 2>/dev/null) || true
  [[ "$c" =~ ^[0-9]{3}$ ]] || c=000
  echo "$c"
}
json_build() { python3 -I -c 'import json, sys
d = json.loads(sys.stdin.read())
print(d.get("build") or "" if d.get("ok", True) is True else "")' 2>/dev/null || true; }
# The service's build through the real address; "ok" when it answers ok but names no build (a caller that comes in
# through Funnel gets only {"ok":true}); nothing otherwise.
door_build() { [ "$(door_get /console/api/health)" = 200 ] && door_ok < "$W/door.body" || true; }
door_ok() { python3 -I -c 'import json, sys
d = json.loads(sys.stdin.read())
if d.get("ok") is True: print(d.get("build") or "ok")' 2>/dev/null || true; }
# door_page <path>: the build of the page served at <path> (its version.json), when <path> answers.
door_page() {
  [ "$(door_get "$1")" = 200 ] && [ "$(door_get "${1}version.json")" = 200 ] && json_build < "$W/door.body" || true
}
# (nothing when the page's version.json is missing or unreadable)
ui_build() { { json_build < "$HOME/spark-console/version.json"; } 2>/dev/null || true; }
span() { if [ "$1" -ge 120 ]; then echo "$(($1 / 60)) minutes"; else echo "$1 seconds"; fi; }
health_build() {
  curl -q -s -m 5 --unix-socket "$STATE/api.sock" http://localhost/health 2>/dev/null | python3 -I -c 'import json, sys
d = json.loads(sys.stdin.read())
print(d.get("build") or "" if d.get("ok") is True else "")' 2>/dev/null || true
}
# Sign-in as a visitor from the internet sees it, asked on the socket as Funnel brings one (its header, no forwarded
# address): sock_signin prints whoami's signin ("true": a passkey can sign the owner in from there; "false"), nothing
# when whoami doesn't answer so; sock_begin succeeds when a passkey sign-in begins (a challenge comes back; it is kept
# nowhere, and nothing signs in).
sock_signin() {
  curl -q -s -m 5 --unix-socket "$STATE/api.sock" -H 'Tailscale-Funnel-Request: ?1' http://localhost/whoami 2>/dev/null | python3 -I -c 'import json, sys
d = json.loads(sys.stdin.read())
if isinstance(d, dict) and "access" in d and isinstance(d.get("signin"), bool): print("true" if d["signin"] else "false")' 2>/dev/null || true
}
sock_begin() {
  curl -q -s -m 5 --unix-socket "$STATE/api.sock" -X POST -H 'Tailscale-Funnel-Request: ?1' -H 'X-Spark-Console: 1' \
    -H 'Content-Type: application/json' -d '{}' http://localhost/auth/signin/begin 2>/dev/null | python3 -I -c 'import json, sys
d = json.loads(sys.stdin.read())
sys.exit(0 if isinstance(d, dict) and isinstance(d.get("challengeId"), str) and isinstance(d.get("allow"), list) and d["allow"] else 1)' 2>/dev/null
}
onoff() { if [ "$1" = true ]; then echo on; else echo off; fi; }

setup() {
  [ $# = 1 ] && [[ "$1" =~ ^[A-Za-z0-9-]+/[A-Za-z0-9._-]+$ ]] || usage
  need_git
  local token='' auth url
  if [ -t 0 ]; then
    printf 'A GitHub token for %s (read only; it is not shown as you type): ' "$1" >&2
    IFS= read -rs token || true; echo >&2
  else
    IFS= read -r token || true
  fi
  [[ "$token" =~ ^[A-Za-z0-9_]{20,255}$ ]] || die "That isn't a GitHub token (letters, digits and _ only). Nothing was saved."
  auth=$(printf 'x-access-token:%s' "$token" | base64 | tr -d '\n')
  url=$(url_for "$1")
  # The copy first, then a fetch with the new token: it is kept only if GitHub took it.
  if [ ! -d "$REPO" ]; then
    mkdir -p "$SHARE"; chmod 700 "$SHARE" 2>/dev/null || true
    GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null git -c init.defaultBranch=main init -q --bare "$REPO"
  fi
  fetch "$url" "$auth" "$FETCH_SETUP_S" || die "GitHub didn't accept that token for $1, or couldn't be reached. Nothing was saved."
  # Into the secrets file beside Telegram's: read whole, written whole (a temporary file renamed over it, 0600). A file
  # that exists but can't be read is never written over.
  PULL_TOKEN="$token" python3 -I -c 'import json, os, sys, tempfile
path, repo = sys.argv[1], sys.argv[2]
token = os.environ.pop("PULL_TOKEN")
d = os.path.dirname(path)
os.makedirs(d, mode=0o700, exist_ok=True)
os.chmod(d, 0o700)
try:
    now = json.load(open(path))
except FileNotFoundError:
    now = {}
except Exception:
    sys.exit(3)
if not isinstance(now, dict):
    sys.exit(3)
now["github"] = {"repo": repo, "token": token}
fd, tmp = tempfile.mkstemp(dir=d, prefix="secrets.json.", suffix=".tmp")
with os.fdopen(fd, "w") as f: json.dump(now, f, indent=2)
os.replace(tmp, path)' "$SECRETS" "$1" \
    || die "$SECRETS can't be read as it is, so it wasn't written over and the token wasn't saved. Fix or move it, then run this again."
  token=''
  echo "  Saved: the token for $1 is in $SECRETS (only you can read it)."
  check_facts
}

check_facts() {
  local ib it ic head ht nt nc
  read -r ib it ic <<<"$(installed)"
  echo "  Installed: build $ib$([ "$it" = - ] || echo ", tree ${it:0:12}")$([ "$ic" = - ] || echo ", commit ${ic:0:12}")"
  read -r head ht <<<"$(g log -1 --format='%H %T' refs/heads/main 2>/dev/null || echo '- -')"
  [ "$head" != - ] || { echo "  main: not on GitHub yet."; return 0; }
  read -r nc nt <<<"$(newest_tested || true)"
  # (a tested/ tag that isn't sound is said once, where it is: on main's head or on the newest tested commit)
  local bad=''
  [ -z "${nt:-}" ] || tag_check "$nc" "$nt" || bad=$TAG_WHY
  if [ "$nc" = "$head" ] && [ -n "$bad" ]; then echo "  main: commit ${head:0:12}, tree ${ht:0:12}: its tested/ tag isn't offered: $bad"; return 0
  elif [ "$nc" = "$head" ]; then echo "  main: commit ${head:0:12}, tree ${ht:0:12}, tested."
  else echo "  main: commit ${head:0:12}, tree ${ht:0:12}, not tested yet (no tested/${ht:0:12} tag)."; fi
  [ -n "${nt:-}" ] || { echo "  Nothing on main is tested yet."; return 0; }
  [ -z "$bad" ] || { echo "  The newest tree on main with a tested/ tag (${nt:0:12}) isn't offered: $bad"; return 0; }

  if [ "$nt" = "$it" ]; then echo "  The newest tested build on main (tree ${nt:0:12}) is the one installed."; return 0; fi
  echo "  Newest tested on main: tree ${nt:0:12}, commit ${nc:0:12}."
  if [ "$ic" != - ] && g cat-file -e "$ic^{commit}" 2>/dev/null && ! g merge-base --is-ancestor "$ic" "$nc"; then
    echo "  It is not newer than the installed build (commit ${ic:0:12}), so there is nothing to install from here."
    return 0
  fi
  if [ "$ic" != - ] && g merge-base --is-ancestor "$ic" "$nc" 2>/dev/null; then
    echo "  Its commits since the installed one (subjects as written on GitHub, newest first):"
    g log --topo-order -n 10 --format='    %h %s' "$ic..$nc" | cut -c1-160
  fi
  echo "  To install it: $ME install ${nt:0:12}"
}
check() {
  [ $# = 0 ] || [ "$*" = --json ] || usage
  if [ "${1:-}" = --json ]; then check_json; return; fi
  ready; check_facts
}
# check --json: the same facts for the console (check_update, R58), one JSON object on stdout; a problem is one too:
# "no git", "not set up", "token" (GitHub refused the token: it may have expired), "slow" (not finished in FETCH_S
# seconds), "locked" (a fetch cut off left git's lock in the copy: "lock" names it) or "unreachable". The newest tested
# tree is offered only when its tag passes install's own checks (tag_check); otherwise "badTag" says why and nothing is
# offered. From the lock only shaped values come out (a build
# of 12 hex digits, a time, a hash of 64), never its text. Commit subjects and git's words ("why") are as written
# on GitHub and by git: the reader treats them as outside text.
check_json() {
  local s ib it ic ir head='' ht='' nc='' nt='' nb='' nat='' nr='' ns='' bad='' newer=false subj='' dif='' known='' problem='' why=''
  out() {  # out <problem> <why>
    printf '%s' "$subj" | python3 -I -c 'import json, re, sys
a = sys.argv[1:]
def opt(v): return None if v in ("", "-") else v
newest = None
if opt(a[9]) and not opt(a[14]):
    newest = {"commit": a[8], "tree": a[9], "build": opt(a[11]), "testedAt": opt(a[12]), "brainReads": opt(a[13]),
              "evalSet": {"version": a[18].split(" ")[0], "cases": int(a[18].split(" ")[1])} if opt(a[18]) else None}
print(json.dumps({"ok": not a[0], "problem": opt(a[0]), "why": opt(a[1]), "repo": opt(a[2]),
  "installed": {"build": opt(a[3]), "tree": opt(a[4]), "commit": opt(a[5]), "brainReads": opt(a[15])},
  "main": {"commit": opt(a[6]), "tree": opt(a[7]), "tested": bool(opt(a[6])) and a[6] == a[8] and not opt(a[14])},
  "newest": newest, "badTag": {"commit": a[8], "tree": a[9], "why": a[14]} if opt(a[14]) else None,
  "newer": a[10] == "true", "subjects": [l for l in sys.stdin.read().split("\n") if l][:10],
  "differs": [f for f in a[16].split("\n") if re.fullmatch(r"[A-Za-z0-9._/+-]{1,160}", f)][:200],
  "differsOther": len([f for f in a[16].split("\n") if f and not re.fullmatch(r"[A-Za-z0-9._/+-]{1,160}", f)]),
  "differsKnown": a[17] == "yes"}))' \
      "$1" "$2" "${REPO_NAME:-}" "${ib:--}" "${it:--}" "${ic:--}" "$head" "$ht" "$nc" "$nt" "$newer" "$nb" "$nat" "$nr" "$bad" "${ir:-}" "$dif" "$known" "$ns"
  }
  # (the stand-in fleet marks a program missing with ~/.mock/off-path-<program>, as the console's own look reads it)
  if ! command -v git >/dev/null 2>&1 || { [ "${SPARK_CONSOLE_ALL_LOCAL:-}" = 1 ] && [ -e "$HOME/.mock/off-path-git" ]; }; then
    out 'no git' "git isn't installed on Spark 2 where Spark Console looks for it."; return 0
  fi
  read -r ib it ic <<<"$(installed)"
  ir=$(reads_of "$HOME/spark-console-service/workflows.lock.json" 2>/dev/null || true)
  s=$(from_secrets) && [ -d "$REPO" ] || { out 'not set up' "The install from GitHub isn't set up on Spark 2: $ME setup <owner>/<repository>"; return 0; }
  read -r REPO_NAME AUTH <<<"$s"
  FETCH_ERR=''
  if ! fetch "$(url_for "$REPO_NAME")" "$AUTH" 2>/dev/null; then
    if [ -n "$FETCH_SLOW" ]; then out slow "$FETCH_ERR"; return 0; fi
    if [ -n "$FETCH_LOCK" ]; then out locked "$FETCH_LOCK"; return 0; fi
    why=$(printf '%s\n' "$FETCH_ERR" | grep -E '^(fatal|remote):' | tail -n 1 | cut -c1-300 || true)
    [ -n "$why" ] || why=$(printf '%s' "$FETCH_ERR" | tail -n 1 | cut -c1-300)
    case "$FETCH_ERR" in
      *[Aa]uthentication\ failed*|*[Ii]nvalid\ username*|*[Cc]ould\ not\ read\ [Uu]sername*|*[Rr]epository\ not\ found*|*" 401"*|*" 403"*) problem=token ;;
      *) problem=unreachable ;;
    esac
    out "$problem" "$why"; return 0
  fi
  read -r head ht <<<"$(g log -1 --format='%H %T' refs/heads/main 2>/dev/null || echo '- -')"
  read -r nc nt <<<"$(newest_tested || true)"
  if [ -n "${nt:-}" ] && ! tag_check "$nc" "$nt"; then bad=$TAG_WHY
  elif [ -n "${nt:-}" ]; then
    nb=$TAG_BUILD nat=$TAG_AT
    nr=$(g cat-file blob "$TAG_COMMIT:$LOCK_PATH" 2>/dev/null | head -c 65536 | reads_of /dev/stdin || true)
    ns=$(g cat-file blob "$TAG_COMMIT:$LOCK_PATH" 2>/dev/null | head -c 65536 | set_of /dev/stdin || true)
    if [ "$nt" != "$it" ] && ! { [ "$ic" != - ] && g cat-file -e "$ic^{commit}" 2>/dev/null && ! g merge-base --is-ancestor "$ic" "$nc"; }; then newer=true; fi
    # (the files that differ from the installed build: names of a plain shape only, the rest counted; data from the
    # repository, for the install's ask to list)
    # (not known when the installed build's commit isn't in this copy: one installed from the Mac before it reached main)
    if [ "$ic" != - ] && g cat-file -e "$ic^{commit}" 2>/dev/null; then dif=$(g diff --no-renames --name-only "$ic" "$nc" 2>/dev/null | head -n 1000 || true) known=yes; fi
    if [ "$ic" != - ] && g merge-base --is-ancestor "$ic" "$nc" 2>/dev/null; then subj=$(g log --topo-order -n 10 --format='%h %s' "$ic..$nc" | cut -c1-200)
    else subj=$(g log -1 --format='%h %s' "$nc" | cut -c1-200); fi
  fi
  out '' ''
}
# set_of <lock file>: the eval's case set that build was tested with (its lock's evalSet): "<version> <cases>", the
# version 64 hex digits and the count of its cases (1 to 500), else nothing.
set_of() {
  python3 -I -c 'import json, re, sys
try: s = json.load(open(sys.argv[1])).get("evalSet")
except Exception: s = None
v, c = (s.get("version"), s.get("cases")) if isinstance(s, dict) else (None, None)
print("%s %d" % (v, len(c)) if isinstance(v, str) and re.fullmatch(r"[0-9a-f]{64}", v) and isinstance(c, list) and 0 < len(c) <= 500 else "")' "$1"
}
# reads_of <lock file>: what the brain reads in that build (its lock's brainReads), only as 64 hex digits, else nothing.
reads_of() {
  python3 -I -c 'import json, re, sys
try: r = json.load(open(sys.argv[1])).get("brainReads") or ""
except Exception: r = ""
print(r if re.fullmatch(r"[0-9a-f]{64}", str(r)) else "")' "$1"
}

install() {
  [ $# = 1 ] && [[ "$1" =~ ^[0-9a-f]{12}$ ]] || usage
  # One install at a time (the lock goes with this process, however it ends).
  mkdir -p "$HOME/.cache/spark-console"
  if command -v flock >/dev/null 2>&1; then
    exec 9>"$HOME/.cache/spark-console/pull.lock"
    flock -n 9 || die "Another install from pull.sh is running. Nothing was changed."
  fi
  WANT="$1"
  trap stopped INT TERM HUP
  ready
  local c t tc lat code_build p txt note code=0 now why trees ib it ic
  read -r c t <<<"$(newest_tested || true)"
  if [ -z "${c:-}" ] || [ "${t:0:12}" != "$WANT" ]; then
    trees=$'\n'$(g log --topo-order -n 5000 --format=%T refs/heads/main)
    if [ "$(g log -1 --format=%T refs/heads/main | cut -c1-12)" = "$WANT" ]; then
      refuse "Tree $WANT, the head of main, has no tested/$WANT tag: its full run on GitHub hasn't passed (yet)."
    elif [ -n "$(g for-each-ref "refs/tags/tested/$WANT")" ] && [[ "$trees" == *$'\n'"$WANT"* ]]; then
      refuse "Tree $WANT is an older tested build. Only the newest tested build on main is installed from here: tree ${t:0:12}."
    elif [ -n "$(g for-each-ref "refs/tags/tested/$WANT")" ]; then
      refuse "Tree $WANT has a tested/ tag, but no commit on main holds it."
    elif [ -n "${c:-}" ]; then
      refuse "There is no tested/$WANT tag. The newest tested build on main is tree ${t:0:12}."
    else
      refuse "Nothing on main has a tested/ tag yet."
    fi
  fi
  # Never backwards: when the installed build's lock names a commit this copy holds, it is the one asked for or older.
  read -r ib it ic <<<"$(installed)"
  if [ "$ic" != - ] && g cat-file -e "$ic^{commit}" 2>/dev/null && ! g merge-base --is-ancestor "$ic" "$c"; then
    refuse "Tree $WANT (commit ${c:0:12}) isn't newer than the installed build (commit ${ic:0:12}). To go back a build: bash $SHARE/go-back.sh"
  fi
  # The tag: that commit plus the lock, nothing else; the lock names this tree and the build this code is.
  tag_check "$c" "$t" || refuse "$TAG_WHY"
  tc=$TAG_COMMIT lat=$TAG_AT code_build=$TAG_BUILD
  # Plain files and folders (a submodule is code from elsewhere), and no .gitattributes that changes what git archive
  # gives out. Links only where links_ok allows them (a link elsewhere could copy a secret into the page folder).
  p=$(g ls-tree -r "$tc" | awk -F'\t' '{ split($1, m, " ") } m[1] != "100644" && m[1] != "100755" && m[1] != "120000" && !n++ { print $2 }')
  [ -z "$p" ] || refuse "Tree $WANT holds something that isn't a file or a link ($p): a submodule."
  p=$(g ls-tree -r -z "$tc" | while IFS= read -r -d '' rec; do
        [[ "$rec" == "120000 "* ]] || continue
        meta=${rec%%$'\t'*}
        printf '%s\0' "${rec#*$'\t'}"; g cat-file blob "${meta##* }"; printf '\0'
      done | links_ok) || refuse "Tree $WANT's links couldn't be read."
  [ -z "$p" ] || refuse "Tree $WANT holds a link that isn't allowed ($p): only links under test/mock/root/ that point inside it, or at /hf/."
  while IFS= read -r -d '' p; do
    case "$p" in .gitattributes|*/.gitattributes)
      txt=$(g cat-file blob "$tc:$p")
      case "$txt" in *export-*) refuse "Tree $WANT has $p with export-, which would change what is installed." ;; esac ;;
    esac
  done < <(g ls-tree -r -z --name-only "$tc")
  g cat-file -e "$tc:deploy/host-on-portal.sh" 2>/dev/null || refuse "Tree $WANT has no deploy/host-on-portal.sh."

  # The files, out of git into a folder of this run's own, checked again on disk. Nothing in them has run yet.
  W=$(mktemp -d "${TMPDIR:-/tmp}/spark-console-pull.XXXXXX")
  trap 'rm -rf "$W"' EXIT
  mkdir "$W/tree"
  # (never the eval's held-out set: it tests a brain, so it is not unpacked on Spark 2 even for these minutes, R47)
  g archive --format=tar "$tc" | tar -x -C "$W/tree" -f - --exclude='test/eval/memory-held-out.json' || refuse "git archive of tested/$WANT failed."
  [ -z "$(find "$W/tree" ! -type f ! -type d ! -type l -print -quit)" ] || refuse "Tree $WANT unpacked with something that isn't a file or a link."
  p=$(cd "$W/tree" && find . -type l -print0 | while IFS= read -r -d '' f; do printf '%s\0%s\0' "${f#./}" "$(readlink "$f")"; done | links_ok) \
    || refuse "Tree $WANT's links couldn't be read after unpacking."
  [ -z "$p" ] || refuse "Tree $WANT unpacked with a link that isn't allowed ($p)."

  # When a build answers now: the real address must answer with it (else a new one couldn't be confirmed), the owner
  # is asked here if work is running, and the way back is armed from this build before the new one's code runs.
  local before pages='' pg ui busy answer signin_was=''
  before=$(health_build)
  # (a build is installed but didn't answer: asked twice more; still silent, nothing starts unguarded)
  if [ -z "$before" ] && [ -f "$HOME/spark-console-service/server.mjs" ]; then
    for pg in 1 2; do sleep 3; before=$(health_build); [ -z "$before" ] || break; done
    if [ -z "$before" ]; then
      echo "Spark Console is installed but doesn't answer on its socket, so there is no answering build to go back to: no way back can be armed."
      case "$(ask "Install the new build without a way back? [y/N] ")" in
        [yY]|[yY][eE][sS]) echo "  Going on without a way back, as you said." ;;
        *) refuse "Spark Console is installed but doesn't answer on its socket, so the way back couldn't be armed (there is no answering build to go back to), and nobody at this terminal said to go on without one. Bring it back first (~/.local/share/spark-console/RECOVERY.txt), or run this in a terminal and answer y." ;;
      esac
    fi
  fi
  if [ -n "$before" ]; then
    DOOR=$(door_url) || refuse "The real address isn't known: the installed config.json has no origin."
    pg=$(door_build)
    ui=$(ui_build)
    for answer in / /console/; do [ -z "$ui" ] || [ "$(door_page "$answer")" != "$ui" ] || pages="$pages $answer"; done
    # (through Funnel /health names no build: then the page's version.json, served there, has to name the build)
    [ "$pg" = "$before" ] || { [ "$pg" = ok ] && [ -n "$pages" ]; } \
      || refuse "The real address ($DOOR) doesn't answer with the build running now ($before; it answered ${pg:-nothing}), so a new build couldn't be confirmed through it."
    # (how sign-in answers a visitor from the internet now: the new build's has to answer the same)
    signin_was=$(sock_signin)
    busy=$(curl -q -s -m 5 --unix-socket "$STATE/api.sock" http://localhost/health 2>/dev/null | python3 -I -c 'import json, sys
d = json.loads(sys.stdin.read())
print(int(d.get("jobsRunning") or 0), int(d.get("replying") or 0))' 2>/dev/null || echo '0 0')
    if [ "$busy" != '0 0' ] && [ "${ASSUME_YES:-}" != 1 ]; then
      answer=''
      echo "Spark Console is busy: ${busy% *} job(s) running, and Sparkie is answering in ${busy#* } chat(s). Updating restarts it, which interrupts them."
      answer=$(ask "Update anyway? [y/N] ")
      case "$answer" in [yY]|[yY][eE][sS]) ;; *) refuse "Spark Console is busy, and the update wasn't confirmed (ASSUME_YES=1 updates anyway)." ;; esac
    fi
    [ -f "$HERE/update-guard.sh" ] || refuse "update-guard.sh isn't beside pull.sh ($HERE), so the way back couldn't be armed."
    # (ARMING: this process group, as the guard file names it, while the way back is being armed)
    ARMING=$(ps -o pgid= -p $$ | tr -d ' ')
    bash "$HERE/update-guard.sh" arm "$WANT" "$code_build" "$before" "$ARMING" 9>&- \
      || refuse "The way back couldn't be armed (see above), so the new build wasn't installed."
    ARMED=yes
    trap interrupted INT TERM HUP
  else
    echo "Spark Console isn't answering now, so there is no working build to go back to: the new build stays if it passes its own installer's checks."
    # (from here an install without a way back changes things: a stop is not said to have changed nothing)
    trap - INT TERM HUP
  fi
  # tailscale, sudo, ssh and systemd-run, refused for the incoming installer (SKIP_ROUTES=1 asks it not to call them).
  mkdir "$W/guard-bin"
  for pg in tailscale sudo ssh systemd-run; do
    printf '#!/bin/sh\necho "%s $*" >> %q\necho "pull.sh: an install from GitHub never runs %s; refused." >&2\nexit 1\n' "$pg" "$W/guarded.log" "$pg" > "$W/guard-bin/$pg"
    chmod 700 "$W/guard-bin/$pg"
  done

  # Its own installer, on this Spark: no routes (no tailscale, sudo or ssh), the note built here. If work is running,
  # the installer asks on this terminal first (here pull.sh has asked already when a build answers); ASSUME_YES=1
  # skips the question, and with no terminal nothing changes.
  note="Installed from GitHub with pull.sh: tree $WANT, commit ${c:0:12}$([ "$lat" = - ] || echo ", tested at $lat")."
  [ -z "${NOTE:-}" ] || note="$note ${NOTE}"
  echo "Installing tree $WANT (commit ${c:0:12}, build $code_build) with its own installer …"
  local ay="${ASSUME_YES:-}"
  [ -z "$ARMED" ] || ay=1
  ( cd "$W/tree" && export PATH="$W/guard-bin:$PATH" && NOTE="$note" SKIP_ROUTES=1 ASSUME_YES="$ay" \
      bash deploy/host-on-portal.sh local ${STAND_IN:+"$STAND_IN"} ) 9>&- 2>&1 | tee "$W/install.log" || code=$?
  now=$(health_build)
  read -r ib it ic <<<"$(installed)"
  local guarded failed='' reached='' last='' named=''
  guarded=$(cut -d' ' -f1 "$W/guarded.log" 2>/dev/null | sort -u | tr '\n' ' ' | sed 's/ $//' || true)
  # Kept by its installer only when the new build answers, the installed lock names this tree and its installer said it
  # kept it: a tree with the same service code (only the page, documents or worker.py changed) answers with the same
  # build even when its installer changed nothing or went back.
  if ! { [ "$now" = "$code_build" ] && [ "$it" = "$t" ] && grep -q "kept: build $code_build passed its checks" "$W/install.log"; }; then
    failed=$(grep -E 'STOP:|didn.t pass' "$W/install.log" | tail -n 1 | sed 's/^ *//' | cut -c1-800 || true)
    if [ -z "$failed" ] && grep -q "kept: build $code_build passed its checks" "$W/install.log"; then
      failed="its installer said it kept build $code_build, but the build answering is ${now:-none}"
    fi
    failed=${failed:-the installer ended with exit $code}
  elif [ -n "$guarded" ] && [ -n "$ARMED" ]; then
    failed="its installer ran $guarded, which an install from pull.sh never does (refused)"
  elif [ -n "$ARMED" ]; then
    # The real door: through the real address, the new service answers, and each page that was served before still is.
    echo "Checking the new build through the real address ($DOOR), for up to $(span "$CONFIRM_S") …"
    local until=$((SECONDS + CONFIRM_S)) ok='' newui hc pb signin='' sg=''
    newui=$(ui_build)
    while :; do
      hc=$(door_get /console/api/health); last='' signin=''
      [ "$hc" = 000 ] || reached=yes
      [ "$hc" != 200 ] || last=$(door_ok < "$W/door.body")
      if [ "$last" = "$code_build" ] || { [ "$last" = ok ] && [ -n "$pages" ]; }; then
        ok=yes
        for pg in $pages; do pb=$(door_page "$pg"); [ -n "$pb" ] && [ "$pb" = "$newui" ] || ok=''; done
        # (and it signs in as far as it can without a passkey: each page's script is the new page's, and the sign-in
        # answers, R30)
        if [ -n "$ok" ]; then
          for pg in $pages; do
            if [ "$(door_get "${pg%/}/app.js")" != 200 ] || ! grep -qF "const BUILD = '$newui';" "$W/door.body"; then ok='' signin="its page's script (${pg%/}/app.js) isn't the new page's"; break; fi
          done
        fi
        # (sign-in through the real address only where it can answer: through Funnel. From Spark 2 over the tailnet the
        # request carries Spark 2's own address, which the console refuses on every path but /health and /v1/)
        if [ -n "$ok" ] && [ "$last" = ok ] && { [ "$(door_get /console/api/whoami)" != 200 ] || ! grep -q '"access"' "$W/door.body"; }; then ok='' signin="its sign-in (/console/api/whoami) doesn't answer"; fi
        # (and on its socket as a visitor from the internet, on both legs: whoami's signin is what it was before the
        # install, and when a passkey can sign in, its sign-in begins)
        if [ -n "$ok" ]; then
          sg=$(sock_signin)
          if [ -z "$sg" ]; then ok='' signin="its sign-in (/whoami, asked on its socket as from the internet) doesn't answer"
          elif [ -n "$signin_was" ] && [ "$sg" != "$signin_was" ]; then ok='' signin="its passkey sign-in from the internet is $(onoff "$sg") (asked on its socket), and it was $(onoff "$signin_was") before the install"
          elif [ "$sg" = true ] && ! sock_begin; then ok='' signin="a passkey sign-in doesn't begin (/auth/signin/begin, asked on its socket as from the internet)"
          fi
        fi
        [ -z "$ok" ] || break
      fi
      [ "$SECONDS" -lt "$until" ] || break
      sleep 2
    done
    if [ -z "$ok" ] && [ -z "$reached" ]; then
      failed="the real address ($DOOR) didn't answer at all in the $(span "$CONFIRM_S") after the install. That isn't proof the new build is bad (the address itself may be down), but nothing confirmed it, so the build from before went back. Try again once the address answers"
    elif [ -z "$ok" ] && [ -n "$signin" ]; then
      failed="through the real address ($DOOR) the new build answers, but $signin in $(span "$CONFIRM_S")"
    elif [ -z "$ok" ] && [ "$last" = "$code_build" ]; then
      failed="through the real address ($DOOR) the new build answers, but its page isn't served there in $(span "$CONFIRM_S") (its version.json names ${pb:-nothing})"
    elif [ -z "$ok" ]; then
      failed="through the real address ($DOOR) the new build didn't answer as itself in $(span "$CONFIRM_S") (its service answered ${last:-nothing})"
    else
      # (through Funnel /health names no build: then a service answers there, and the page is the word on the build)
      if [ "$last" = "$code_build" ]; then named=yes; echo "  Through the real address: the new build answers$([ -z "$pages" ] || echo ", and its page is served")."
      else echo "  Through the real address: a service answers, and the new page is served."; fi
      echo "  On its socket, as from the internet: sign-in answers as before$([ "$sg" != true ] || echo ', and a passkey sign-in begins')."
    fi
  fi
  if [ -z "$failed" ] && [ -n "$ARMED" ] && ! bash "$SHARE/update-guard/update-guard.sh" disarm 9>&-; then
    failed='the way back had already put the build from before back'
  fi
  if [ -z "$failed" ]; then
    trap - INT TERM HUP
    why='it passed its checks'
    [ -z "$ARMED" ] || why="$why, and $([ -n "$named" ] && echo 'the real address answers with it' || echo 'at the real address a service answers and the new page is served')"
    [ "$code" = 0 ] || why="$why, but the installer then ended with exit $code"
    [ -z "$guarded" ] || why="$why; its installer tried to run $guarded, which was refused"
    result kept "$why" "$code_build"
    echo "  Kept: build $code_build (tree $WANT) is running."
    return 0
  fi
  echo "  Not kept: $failed." >&2 || true
  [ -z "$ARMED" ] || bash "$SHARE/update-guard/update-guard.sh" put-back pull "$failed" 9>&- || true
  trap - INT TERM HUP
  now=$(health_build)
  read -r ib it ic <<<"$(installed)"
  now="the build answering now is ${now:-none}$([ "$it" = - ] || echo ", installed from tree ${it:0:12}")"
  result 'not kept' "$failed; $now" "$code_build"
  echo "  Not kept: $now." >&2
  return 1
}

main() {
  case "${1:-}" in
    setup) shift; setup "$@" ;;
    check) shift; check "$@" ;;
    install) shift; install "$@" ;;
    *) usage ;;
  esac
}
# (one line: bash has read all of it before an install replaces this file)
main "$@"; exit

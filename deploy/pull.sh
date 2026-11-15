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
# means the new build answers and the installed lock names this tree.
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
WANT='' W=''

die() { echo "  STOP: $*" >&2; exit 1; }
usage() {
  echo "Usage: $ME setup <owner>/<repository> | check | install <tree>   (<tree>: the 12 hex digits pull.sh check names)" >&2
  exit 2
}
# The result of this install, for the record (and, later, for the console to tell): written whole, owner-only.
result() {  # result <kept|not kept|refused> <why> [build]
  ( umask 077; mkdir -p "$STATE" ) && python3 -c 'import datetime, json, os, sys, tempfile
path, tree, res, why, build = sys.argv[1:6]
d = {"tree": tree, "build": build or None, "result": res, "why": why[:600],
     "at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")}
fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), prefix=".update-result.", suffix=".tmp")
with os.fdopen(fd, "w") as f: json.dump(d, f)
os.replace(tmp, path)' "$RESULT" "$WANT" "$1" "$2" "${3:-}" || echo "  NOTE: couldn't write $RESULT." >&2
}
refuse() { echo "  STOP: $1 Nothing was changed." >&2; [ -z "$WANT" ] || result refused "$1"; exit 1; }

# git, on the bare copy only, with nothing from the system's or the user's git config (a rewrite to SSH, a credential
# store), no prompt, no hooks, HTTPS only, and every fetched object checked.
g() {
  local proto=https
  [ "${SPARK_CONSOLE_ALL_LOCAL:-}" != 1 ] || proto=https:file
  GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null GIT_TERMINAL_PROMPT=0 GIT_ASKPASS=/bin/false SSH_ASKPASS='' \
    GIT_ALLOW_PROTOCOL="$proto" git -C "$REPO" "$@"
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
# (GIT_CONFIG_*), for github.com only.
fetch() {
  local err
  err=$(GIT_CONFIG_COUNT=4 GIT_CONFIG_KEY_0=http.https://github.com/.extraheader GIT_CONFIG_VALUE_0="Authorization: basic $2" \
    GIT_CONFIG_KEY_1=credential.helper GIT_CONFIG_VALUE_1='' GIT_CONFIG_KEY_2=core.hooksPath GIT_CONFIG_VALUE_2=/dev/null \
    GIT_CONFIG_KEY_3=fetch.fsckObjects GIT_CONFIG_VALUE_3=true \
    g fetch -q --no-tags --prune "$1" '+refs/heads/main:refs/heads/main' '+refs/tags/tested/*:refs/tags/tested/*' 2>&1 >/dev/null) \
    && return 0
  echo "  Couldn't fetch from $1. git said: $(printf '%s' "$err" | tail -n 2 | tr '\n' ' ')" >&2
  return 1
}
# The repository and its credentials from the secrets file: "<owner/repo> <base64 of x-access-token:token>".
from_secrets() {
  python3 -c 'import base64, json, re, sys
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
  fetch "$URL" "$AUTH" || refuse "GitHub couldn't be reached, or didn't accept the token (a new one: $ME setup $REPO_NAME)."
}
sha12() { if command -v sha256sum >/dev/null 2>&1; then sha256sum; else shasum -a 256; fi | cut -c1-12; }
# links_ok: reads "<path>\0<target>\0" pairs and prints the first link that isn't allowed (nothing when all are). A link
# is allowed only under test/mock/root/ (the stand-in fleet's Hugging Face caches, which only travel inside the source
# copy, where a link stays a link), and only with a relative target that, read from the link's own folder, stays under
# test/mock/root/, or an absolute target under /hf/ with no .. in it (that cache's path inside a model's container; on
# Spark 2 it points at nothing).
links_ok() {
  python3 -c 'import os, sys
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
# The installed build, from its lock: "<build> <tree or -> <commit or ->".
installed() {
  python3 -c 'import json, sys
try: d = json.load(open(sys.argv[1]))
except Exception: d = {}
print(d.get("build") or "-", d.get("tree") or "-", d.get("commit") or "-")' "$HOME/spark-console-service/workflows.lock.json" 2>/dev/null || echo '- - -'
}
health_build() {
  curl -s -m 5 --unix-socket "$STATE/api.sock" http://localhost/health 2>/dev/null | python3 -c 'import json, sys
d = json.loads(sys.stdin.read())
print(d.get("build") or "" if d.get("ok") is True else "")' 2>/dev/null || true
}

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
  fetch "$url" "$auth" || die "GitHub didn't accept that token for $1, or couldn't be reached. Nothing was saved."
  # Into the secrets file beside Telegram's: read whole, written whole (a temporary file renamed over it, 0600). A file
  # that exists but can't be read is never written over.
  PULL_TOKEN="$token" python3 -c 'import json, os, sys, tempfile
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
  if [ "$nc" = "$head" ]; then echo "  main: commit ${head:0:12}, tree ${ht:0:12}, tested."
  else echo "  main: commit ${head:0:12}, tree ${ht:0:12}, not tested yet (no tested/${ht:0:12} tag)."; fi
  [ -n "${nt:-}" ] || { echo "  Nothing on main is tested yet."; return 0; }
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
check() { [ $# = 0 ] || usage; ready; check_facts; }

install() {
  [ $# = 1 ] && [[ "$1" =~ ^[0-9a-f]{12}$ ]] || usage
  # One install at a time (the lock goes with this process, however it ends).
  mkdir -p "$HOME/.cache/spark-console"
  if command -v flock >/dev/null 2>&1; then
    exec 9>"$HOME/.cache/spark-console/pull.lock"
    flock -n 9 || die "Another install from pull.sh is running. Nothing was changed."
  fi
  WANT="$1"
  ready
  local c t tc lockf tab fields lbuild ltree lat code_build p txt note code=0 now why trees ib it ic
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
  # The tag: that commit plus the lock, nothing else.
  tc=$(g rev-parse -q --verify "refs/tags/tested/$WANT^{commit}") || refuse "tested/$WANT doesn't name a commit."
  tab=$(printf '\t')
  [ "$(g diff-tree -r --no-renames --name-status "$c" "$tc")" = "A${tab}$LOCK_PATH" ] \
    || refuse "tested/$WANT changes more than adding $LOCK_PATH to commit ${c:0:12}."
  # The lock names this tree and the build this code is.
  lockf=$(g cat-file -s "$tc:$LOCK_PATH" 2>/dev/null || echo 0)
  [ "$lockf" -gt 0 ] && [ "$lockf" -le 65536 ] || refuse "The lock in tested/$WANT is missing or too big."
  fields=$(g cat-file blob "$tc:$LOCK_PATH" | python3 -c 'import json, re, sys
d = json.loads(sys.stdin.read())
ok = lambda k, p: isinstance(d.get(k), str) and re.fullmatch(p, d[k])
if not (isinstance(d, dict) and ok("build", "[0-9a-f]{12}") and isinstance(d.get("versions"), dict)): sys.exit(1)
print(d["build"], d["tree"] if ok("tree", "[0-9a-f]{40}([0-9a-f]{24})?") else "-",
      d["testedAt"] if ok("testedAt", r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z") else "-")' 2>/dev/null) \
    || refuse "The lock in tested/$WANT isn't one the installer can read."
  read -r lbuild ltree lat <<<"$fields"
  [ "$ltree" != - ] || refuse "The lock in tested/$WANT names no tree."
  [ "$ltree" = "$t" ] || refuse "The lock in tested/$WANT is for tree ${ltree:0:12}, not this tree ($WANT)."
  code_build=$(for p in server.mjs dig.mjs passkey.mjs; do g cat-file blob "$c:service/$p" || exit 1; done | sha12) \
    || refuse "Tree $WANT has no service/server.mjs, dig.mjs or passkey.mjs."
  [ "$lbuild" = "$code_build" ] || refuse "The lock in tested/$WANT is for build $lbuild, but this code is build $code_build."
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
  g archive --format=tar "$tc" | tar -x -C "$W/tree" -f - || refuse "git archive of tested/$WANT failed."
  [ -z "$(find "$W/tree" ! -type f ! -type d ! -type l -print -quit)" ] || refuse "Tree $WANT unpacked with something that isn't a file or a link."
  p=$(cd "$W/tree" && find . -type l -print0 | while IFS= read -r -d '' f; do printf '%s\0%s\0' "${f#./}" "$(readlink "$f")"; done | links_ok) \
    || refuse "Tree $WANT's links couldn't be read after unpacking."
  [ -z "$p" ] || refuse "Tree $WANT unpacked with a link that isn't allowed ($p)."

  # Its own installer, on this Spark: no routes (no tailscale, sudo or ssh), the note built here. If work is running,
  # the installer asks on this terminal first; ASSUME_YES=1 skips the question, and with no terminal nothing changes.
  note="Installed from GitHub with pull.sh: tree $WANT, commit ${c:0:12}$([ "$lat" = - ] || echo ", tested at $lat")."
  [ -z "${NOTE:-}" ] || note="$note ${NOTE}"
  echo "Installing tree $WANT (commit ${c:0:12}, build $code_build) with its own installer …"
  ( cd "$W/tree" && NOTE="$note" SKIP_ROUTES=1 bash deploy/host-on-portal.sh local ) 9>&- 2>&1 | tee "$W/install.log" || code=$?
  now=$(health_build)
  read -r ib it ic <<<"$(installed)"
  # Kept only when the new build answers, the installed lock names this tree and its installer said it kept it: a tree
  # with the same service code (only the page, documents or worker.py changed) answers with the same build even when
  # its installer changed nothing or went back.
  if [ "$now" = "$code_build" ] && [ "$it" = "$t" ] && grep -q "kept: build $code_build passed its checks" "$W/install.log"; then
    why='it passed its checks'
    [ "$code" = 0 ] || why="it passed its checks, but the installer then ended with exit $code"
    result kept "$why" "$code_build"
    echo "  Kept: build $code_build (tree $WANT) is running."
  else
    why=$(grep -E 'STOP:|didn.t pass' "$W/install.log" | tail -n 1 | sed 's/^ *//' | cut -c1-400 || true)
    now="the build answering now is ${now:-none}$([ "$it" = - ] || echo ", installed from tree ${it:0:12}")"
    result 'not kept' "${why:-the installer ended with exit $code}; $now" "$code_build"
    echo "  Not kept: $now." >&2
    return 1
  fi
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

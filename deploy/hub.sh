# The Sparks as every script under deploy/ knows them: deploy/hub.env, beside this file, read and checked here (it is
# read as text, never run). A script sources this file:   . "$(dirname "$0")/hub.sh"
# and then has these, or it stops, saying why, with nothing changed:
#   HUB (spark1)  HUB_SAYS (Spark 1)  HUB_N (1)  HUB_ADDR (its tailnet address)  HUB_NAME (its Tailscale name)  LOGIN
#   TAILNET  HUB_HOST (LOGIN@HUB_ADDR)  HUB_URL (https://HUB_NAME.TAILNET:8443, Spark Console's address)
#   SPARKS (every Spark's id, in the file's order)  COMPUTE (every one but the hub)
#   addr_of <id>   says_of <id> ("Spark 3")   spark_of <a Spark's number, id, address or name, with or without user@>
#   (prints its id; nothing, and false, for one hub.env doesn't name; a Spark's Tailscale name is ak<id>)
HUB_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/hub.env"
hub_stop() { echo "Stopped: $*. Nothing was changed." >&2; exit 2; }
[ -f "$HUB_FILE" ] || hub_stop "$HUB_FILE isn't there, and it is what says which Spark is the hub"
hub_get() { sed -n "s/^$1=//p" "$HUB_FILE" | head -n 1; }
addr_of() { hub_get "$1"; }
says_of() { echo "Spark ${1#spark}"; }
HUB=$(hub_get HUB) HUB_NAME=$(hub_get HUB_NAME) LOGIN=$(hub_get LOGIN) TAILNET=$(hub_get TAILNET)
SPARKS=$(sed -n 's/^\(spark[1-9][0-9]*\)=.*$/\1/p' "$HUB_FILE" | tr '\n' ' ')
SPARKS=${SPARKS% }
for _s in $SPARKS; do
  [[ $(addr_of "$_s") =~ ^[0-9]{1,3}[.][0-9]{1,3}[.][0-9]{1,3}[.][0-9]{1,3}$ ]] || hub_stop "$HUB_FILE gives $_s no plain address"
done
[[ $HUB =~ ^spark[1-9][0-9]*$ && " $SPARKS " == *" $HUB "* ]] || hub_stop "$HUB_FILE names no hub (HUB=) among its Sparks"
[[ $HUB_NAME =~ ^[a-z0-9-]+$ && $LOGIN =~ ^[a-z_][a-z0-9_-]*$ && $TAILNET =~ ^[a-z0-9.-]+$ ]] \
  || hub_stop "$HUB_FILE has no plain HUB_NAME, LOGIN or TAILNET"
HUB_N=${HUB#spark} HUB_SAYS=$(says_of "$HUB") HUB_ADDR=$(addr_of "$HUB")
HUB_HOST="$LOGIN@$HUB_ADDR" HUB_URL="https://$HUB_NAME.$TAILNET:8443"
COMPUTE=''
for _s in $SPARKS; do [ "$_s" = "$HUB" ] || COMPUTE="$COMPUTE $_s"; done
COMPUTE=${COMPUTE# }
spark_of() {
  local t="${1#*@}" s
  t=${t%.}
  for s in $SPARKS; do
    case "$t" in "${s#spark}"|"$s"|"spark-${s#spark}"|"$(addr_of "$s")"|"ak$s"|"ak$s".*) echo "$s"; return 0 ;; esac
  done
  case "$t" in "$HUB_NAME"|"$HUB_NAME".*) echo "$HUB"; return 0 ;; esac
  return 1
}

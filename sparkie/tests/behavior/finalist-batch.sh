#!/usr/bin/env bash
# Call under timeout --signal=TERM --kill-after=30s 40m.
# A fresh native home per variant; no retries or changes to the common screen.
set -u
source_root=$1
native_root=$2
manifest=$3
out=$4
if test -e "$out"; then
  echo 'Refusing to overwrite a finalist run.' >&2
  exit 2
fi
mkdir -m 700 "$out" || exit 2
for variant in research_1 research_2 coding_1 coding_2 memory_1 memory_2 operation_1 operation_2; do
  env PYTHONPATH="$source_root/src:$native_root" "$native_root/.venv/bin/python" \
    "$source_root/tests/behavior/finalist.py" --model-manifest "$manifest" \
    --variant "$variant" --out "$out/$variant" > "$out/$variant.log" 2>&1
  result=$?
  printf '%s\n' "$result" > "$out/$variant-exit-code"
  if test "$result" -ne 0; then
    echo "Stopped after $variant failed; later variants remain incomplete." >&2
    exit "$result"
  fi
done

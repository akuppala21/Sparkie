#!/bin/sh
# Run the qualification driver and its Docker client in one GNU timeout process group.
# Its caller owns and verifies disposal of the private sandbox on every exit.
set -eu
limit=$1
shift
exec timeout --signal=KILL "$limit" "$@"

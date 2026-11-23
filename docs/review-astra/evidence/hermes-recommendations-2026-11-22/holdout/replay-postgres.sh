#!/bin/bash
# CPU-only replay using the cached images from the earlier independent fixture.
set -euo pipefail
trial=$(cat /proc/sys/kernel/random/uuid)
for tag in 11.22-bullseye@sha256:c886a3236b3d11abc302e64309186c90a69b49e53ccff23fd8c8b057b5b4bce9 12.22-bookworm@sha256:2f2a8c2a7d10862e7fba2602e304523554f9df8244c632dafe2628ccb398fb5c; do
  image=$(docker image inspect --format '{{.Id}}' "postgres:$tag")
  echo "Image $tag"
  docker run --rm -i --init --pull never --network none --cpus 0.5 --memory 256m --cap-drop ALL \
    --security-opt no-new-privileges:true --read-only --user postgres --label "sparkie.enum.replay=$trial" \
    --tmpfs /tmp:rw,nosuid,nodev,mode=1777,size=120m \
    --tmpfs /var/lib/postgresql/data:rw,nosuid,nodev,size=1m "$image" bash -se <<'RUN'
set -euo pipefail
export LC_ALL=C PGHOST=/tmp PGDATABASE=postgres
cluster=$(mktemp -d)
initdb -D "$cluster" --no-locale --auth=trust >/dev/null
pg_ctl -D "$cluster" -l "$cluster/log" -o "-k /tmp -c listen_addresses='' -c fsync=off -c shared_buffers=16MB" -w start >/dev/null
trap 'pg_ctl -D "$cluster" -m fast -w stop >/dev/null' EXIT
psql -XAtq -v ON_ERROR_STOP=1 <<'SETUP'
SELECT version();
CREATE TYPE order_state AS ENUM ('new', 'shipped');
CREATE TABLE orders (id int PRIMARY KEY, state order_state);
INSERT INTO orders VALUES (1, 'new'), (2, 'shipped');
SETUP
psql -XAtq <<'CASES'
BEGIN;
ALTER TYPE order_state ADD VALUE 'held';
\echo SQLSTATE transaction_add :SQLSTATE
UPDATE orders SET state='held' WHERE id=1;
\echo SQLSTATE transaction_use :SQLSTATE
ROLLBACK;
ALTER TYPE order_state ADD VALUE 'held';
\echo SQLSTATE standalone_add :SQLSTATE
BEGIN;
UPDATE orders SET state='held' WHERE id=1;
\echo SQLSTATE subsequent_update :SQLSTATE
COMMIT;
ALTER TYPE order_state ADD VALUE 'held';
\echo SQLSTATE repeated_add :SQLSTATE
SELECT 'rows=' || string_agg(state::text, ',' ORDER BY id) FROM orders;
SELECT 'labels=' || enum_range(NULL::order_state)::text;
CASES
RUN
done
remaining=$(docker ps --all --quiet --filter "label=sparkie.enum.replay=$trial")
test -z "$remaining"
echo 'Remaining replay containers: 0. No published ports, persistent data volumes or custom networks were created.'

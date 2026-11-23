#!/bin/bash
# Starts two temporary local test databases in isolated Docker containers.
set -euo pipefail
for tag in 11.22-bullseye@sha256:c886a3236b3d11abc302e64309186c90a69b49e53ccff23fd8c8b057b5b4bce9 12.22-bookworm@sha256:2f2a8c2a7d10862e7fba2602e304523554f9df8244c632dafe2628ccb398fb5c; do
  docker pull --quiet --platform linux/arm64 "postgres:$tag"
  image=$(docker image inspect --format '{{.Id}}' "postgres:$tag")
  docker run --rm -i --init --pull never --network none --cpus 1 --memory 512m --cap-drop ALL \
    --security-opt no-new-privileges:true --read-only --user postgres \
    --tmpfs /tmp:rw,nosuid,nodev,mode=1777,size=196m \
    --tmpfs /var/lib/postgresql/data:rw,nosuid,nodev,size=1m "$image" bash -se <<'RUN'
set -euo pipefail
export LC_ALL=C PGHOST=/tmp PGDATABASE=postgres
p=$(mktemp -d)
initdb -D "$p" --no-locale --auth=trust >/dev/null
pg_ctl -D "$p" -l "$p/server.log" -o "-k /tmp -c listen_addresses='' -c fsync=off" -w start >/dev/null
psql -XAtqc 'select version()'
psql -X -v ON_ERROR_STOP=1 -q <<'SQL'
CREATE TYPE order_state AS ENUM ('new','shipped','archived');
CREATE TEMP TABLE setup_only (n integer);
CREATE TABLE orders(id integer primary key,state order_state);
INSERT INTO orders VALUES(1,'new'), (2,'shipped');
BEGIN;
CREATE TYPE order_state_new AS ENUM ('new','shipped','held');
ALTER TABLE orders ALTER COLUMN state TYPE order_state_new USING state::text::order_state_new;
DROP TYPE order_state;
ALTER TYPE order_state_new RENAME TO order_state;
UPDATE orders SET state='held' WHERE id=1;
COMMIT;
SQL
after=$(psql -XAtqc "select enum_range(null::order_state)::text")
test "$after" = '{new,shipped,held}'
echo "Rebuild committed. Existing unused archived label disappeared: $after"
psql -X -v ON_ERROR_STOP=1 -q <<'SQL'
CREATE TYPE delivery_state AS ENUM ('new','shipped','archived');
CREATE TABLE deliveries(id integer primary key, state delivery_state default 'new');
CREATE TABLE audit(event_state delivery_state);
INSERT INTO deliveries(id) VALUES (1), (2);
ALTER TYPE delivery_state ADD VALUE 'held';
BEGIN;
UPDATE deliveries SET state='held' WHERE id=1;
COMMIT;
SQL
correct=$(psql -XAtqc "select enum_range(null::delivery_state)::text, (select string_agg(state::text,',' order by id) from deliveries)")
test "$correct" = '{new,shipped,archived,held}|held,new'
echo "Standalone addition and later scoped update retained labels and other rows: $correct"
pg_ctl -D "$p" -m fast -w stop >/dev/null
RUN
done

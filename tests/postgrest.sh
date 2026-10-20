#!/usr/bin/env bash
# Postgres locale + PostgREST vero, con le migration dei porti e di Tourism
# Intelligence, poi tests/navigazione.postgrest.mts. Serve a provare cio' che
# PGlite non vede: embed, update con .select() sulla vista, RPC via HTTP.
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
PGRST_VERSION=${PGRST_VERSION:-v12.2.3}
BIN=${PGRST_BIN:-/tmp/postgrest-$PGRST_VERSION/postgrest}
DB=navigazione_pgrst
P="psql -h ${PGHOST:-/tmp} -p ${PGPORT:-55432} -U postgres -v ON_ERROR_STOP=1 -q"

bash "$ROOT/tests/db.sh" start
if [ ! -x "$BIN" ]; then
  mkdir -p "$(dirname "$BIN")"
  curl -sSL "https://github.com/PostgREST/postgrest/releases/download/$PGRST_VERSION/postgrest-$PGRST_VERSION-linux-static-x64.tar.xz" | tar xJ -C "$(dirname "$BIN")"
fi
$P -d postgres -c "drop database if exists $DB" -c "create database $DB" 2>&1 | grep -v NOTICE || true
$P -d $DB -f "$ROOT/tests/sql/postgrest-fixture.sql"
for m in 20260926090000_shipping_companies 20260927090000_shipping_itineraries 20260928090000_shipping_ports_world \
  20260928120000_shipping_ports_guide_priority 20261017205455_tourism_intelligence; do
  $P -d $DB -f "$ROOT/supabase/migrations/$m.sql" 2>&1 | grep -v NOTICE || true
done
# Lo stato di prima: due porti con numeri e superguida, una compagnia, un itinerario.
$P -d $DB <<'SQL' >/dev/null
begin;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
set local role authenticated;
insert into shipping_ports(id,slug,name,country,unlocode,aliases,latitude,longitude,region,destination,cruise_passengers,passengers_year,cruise_calls,stats_source,guide_status,guide_priority)
 values('aaaaaaaa-aaaa-4aaa-8aaa-000000000001','napoli','Napoli','IT','ITNAP','{Naples}',40.84,14.25,'Mediterraneo','Napoli',1600000,2025,560,'https://adsp.it','planned',1),
       ('aaaaaaaa-aaaa-4aaa-8aaa-000000000002','civitavecchia','Civitavecchia','IT','ITCVV','{Roma,Rome}',42.09,11.79,'Mediterraneo','Roma',3500000,2025,900,'https://port-of-rome.org','in_progress',1);
insert into shipping_companies(id,slug,name) values('bbbbbbbb-bbbb-4bbb-8bbb-000000000001','msc','MSC Crociere');
select save_shipping_itinerary('{"company_id":"bbbbbbbb-bbbb-4bbb-8bbb-000000000001","name":"Mediterraneo 7 notti"}'::jsonb,
  '[{"position":1,"day":1,"port_id":"aaaaaaaa-aaaa-4aaa-8aaa-000000000001","role":"embark"},{"position":2,"day":2,"port_id":"aaaaaaaa-aaaa-4aaa-8aaa-000000000002"}]'::jsonb);
commit;
SQL
for m in 20261020090000_tourism_hubs 20261020090100_tourism_hubs_absorb_ports 20261020120000_tourism_property_managers; do
  $P -d $DB -f "$ROOT/supabase/migrations/$m.sql" 2>&1 | grep -v NOTICE || true
done
CONF=$(mktemp)
cat > "$CONF" <<CFG
db-uri = "postgres://authenticator:pw@127.0.0.1:${PGPORT:-55432}/$DB"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "test-secret-test-secret-test-secret-1234"
server-port = 3901
server-host = "127.0.0.1"
CFG
"$BIN" "$CONF" >/tmp/postgrest-test.log 2>&1 &
PID=$!
trap 'kill $PID 2>/dev/null; rm -f "$CONF"' EXIT
for _ in $(seq 1 30); do curl -sf -o /dev/null http://127.0.0.1:3901/ && break; sleep 0.5; done
cd "$ROOT" && npx tsx tests/navigazione.postgrest.mts

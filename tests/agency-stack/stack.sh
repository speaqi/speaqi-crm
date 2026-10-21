#!/usr/bin/env bash
# Stack locale per provare Speaqi Agency end-to-end, senza Supabase cloud:
# Postgres 16 con TUTTE le migration del CRM, PostgREST 12, un gateway compatibile
# Supabase (auth e storage finti) e le variabili per `npm run dev` / `npm start`.
#
#   tests/agency-stack/stack.sh up      # avvia database, PostgREST e gateway
#   source <(tests/agency-stack/stack.sh env)   # variabili per Next
#   tests/agency-stack/stack.sh down
#
# Requisiti: /usr/lib/postgresql/16/bin; PostgREST si scarica da solo in $AGENCY_STACK_DIR.
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
PGDIR=${PGDIR:-/var/lib/postgresql/agencydata}
PGPORT=${PGPORT:-55433}
STATE=${AGENCY_STACK_DIR:-/tmp/agency-stack}
POSTGREST_BIN=${POSTGREST_BIN:-$STATE/postgrest}
SECRET=${JWT_SECRET:-super-secret-jwt-token-with-at-least-32-characters-long}
OWNER=${E2E_USER_ID:-11111111-1111-4111-8111-111111111111}
mkdir -p "$STATE"

jwt() {
  node -e '
    const c=require("crypto");const b=v=>Buffer.from(JSON.stringify(v)).toString("base64url");
    const h=b({alg:"HS256",typ:"JWT"}),p=b({role:process.argv[1],iss:"supabase",exp:2000000000});
    console.log(h+"."+p+"."+c.createHmac("sha256",process.argv[2]).update(h+"."+p).digest("base64url"))' "$1" "$SECRET"
}

up() {
  if [ ! -x "$POSTGREST_BIN" ]; then
    echo "scarico PostgREST 12.2.3…"
    curl -sSL https://github.com/PostgREST/postgrest/releases/download/v12.2.3/postgrest-v12.2.3-linux-static-x64.tar.xz | tar -xJ -C "$STATE"
  fi
  if ! "$PGBIN/pg_isready" -h /tmp -p "$PGPORT" >/dev/null 2>&1; then
    rm -rf "$PGDIR"; mkdir -p "$PGDIR"; chown -R postgres:postgres "$(dirname "$PGDIR")"
    su postgres -c "$PGBIN/initdb -D $PGDIR -U postgres -A trust" >/dev/null
    su postgres -c "$PGBIN/pg_ctl -D $PGDIR -o '-p $PGPORT -k /tmp -c listen_addresses=127.0.0.1' -l $PGDIR/log start" >/dev/null
    for _ in $(seq 1 30); do "$PGBIN/pg_isready" -h /tmp -p "$PGPORT" >/dev/null 2>&1 && break; sleep 0.5; done
  fi
  P="psql -h /tmp -p $PGPORT -U postgres"
  $P -q -c "drop database if exists crm" -c "create database crm" >/dev/null
  $P -d crm -q -v ON_ERROR_STOP=1 -f "$ROOT/tests/agency-stack/bootstrap.sql" >/dev/null 2>&1
  for f in "$ROOT"/supabase/migrations/*.sql; do
    $P -d crm -q -v ON_ERROR_STOP=1 -f "$f" >/dev/null 2>"$STATE/migration.err" || { echo "migration fallita: $f"; cat "$STATE/migration.err"; exit 1; }
  done
  $P -d crm -q -c "insert into auth.users(id,email) values('$OWNER','owner@example.com'),('22222222-2222-4222-8222-222222222222','other@example.com') on conflict do nothing" >/dev/null
  cat > "$STATE/postgrest.conf" <<CONF
db-uri = "postgres://authenticator:authenticator@127.0.0.1:$PGPORT/crm"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "$SECRET"
server-port = 54322
server-host = "127.0.0.1"
CONF
  pkill -f "postgrest $STATE/postgrest.conf" 2>/dev/null || true
  pkill -f "agency-stack/gateway.mjs" 2>/dev/null || true
  nohup "$POSTGREST_BIN" "$STATE/postgrest.conf" >"$STATE/postgrest.log" 2>&1 &
  STORAGE_DIR="$STATE/storage" JWT_SECRET="$SECRET" nohup node "$ROOT/tests/agency-stack/gateway.mjs" >"$STATE/gateway.log" 2>&1 &
  for _ in $(seq 1 40); do curl -s -o /dev/null http://127.0.0.1:54322/ && curl -s -o /dev/null http://127.0.0.1:54321/ && break; sleep 0.25; done
  echo "stack pronto: gateway http://127.0.0.1:54321 (utente owner@example.com / password-di-prova)"
}

env_vars() {
  echo "export NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321"
  echo "export NEXT_PUBLIC_SUPABASE_ANON_KEY=$(jwt anon)"
  echo "export SUPABASE_SERVICE_ROLE_KEY=$(jwt service_role)"
  echo "export AGENCY_RENDER_SECRET=render-secret-di-prova"
}

down() {
  pkill -f "postgrest $STATE/postgrest.conf" 2>/dev/null || true
  pkill -f "agency-stack/gateway.mjs" 2>/dev/null || true
  su postgres -c "$PGBIN/pg_ctl -D $PGDIR stop" >/dev/null 2>&1 || true
}

case "${1:-up}" in
  up) up ;;
  env) env_vars ;;
  down) down ;;
  *) echo "uso: $0 up|env|down" >&2; exit 2 ;;
esac

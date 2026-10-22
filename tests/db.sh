#!/usr/bin/env bash
# Postgres usa-e-getta: campagne e ufficio, con lock veri. Funziona anche su
# macOS senza root (Postgres.app) e non cancella mai una directory esistente.
set -euo pipefail

if [[ -z "${PGBIN:-}" ]]; then
  if command -v initdb >/dev/null 2>&1; then PGBIN=$(dirname "$(command -v initdb)")
  elif [[ -x /Applications/Postgres.app/Contents/Versions/latest/bin/initdb ]]; then PGBIN=/Applications/Postgres.app/Contents/Versions/latest/bin
  else PGBIN=/usr/lib/postgresql/16/bin; fi
fi
PGDIR=${PGDIR:-${TMPDIR:-/tmp}/speaqi-crm-pg-tests}
PGPORT=${PGPORT:-55432}
PGHOST=${PGHOST:-/tmp}
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
DB_NAME=${2:-campagne_test}
[[ "$DB_NAME" =~ ^[a-z_]+$ ]] || { echo 'Nome database non valido' >&2; exit 2; }

as_postgres() {
  if [[ $(id -u) = 0 ]]; then runuser -u postgres -- "$@"; else "$@"; fi
}

start() {
  if "$PGBIN/pg_isready" -h "$PGHOST" -p "$PGPORT" >/dev/null 2>&1; then
    existing=$("$PGBIN/psql" -h "$PGHOST" -p "$PGPORT" -U postgres -d postgres -tAc 'show data_directory')
    [[ "$existing" = "$PGDIR" ]] || { echo "La porta $PGPORT appartiene a un altro cluster: scegli PGPORT" >&2; exit 1; }
    return 0
  fi
  if [[ ! -f "$PGDIR/PG_VERSION" ]]; then
    mkdir -p "$PGDIR"
    if [[ $(id -u) = 0 ]]; then chown postgres:postgres "$PGDIR"; fi
    as_postgres "$PGBIN/initdb" -D "$PGDIR" -U postgres -A trust --locale=C >/dev/null
  fi
  as_postgres "$PGBIN/pg_ctl" -D "$PGDIR" -o "-p $PGPORT -k $PGHOST -h 127.0.0.1" -l "$PGDIR/log" start >/dev/null
}

schema() {
  "$PGBIN/psql" -h "$PGHOST" -p "$PGPORT" -U postgres -d "$1" -v ON_ERROR_STOP=1 -q \
    -f "$ROOT/tests/sql/fixture.sql" \
    -f "$ROOT/supabase/migrations/20260828180000_hospitality_outreach.sql" \
    -f "$ROOT/supabase/migrations/20260829210000_hospitality_outreach_guards.sql" \
    -f "$ROOT/supabase/migrations/20260903170000_commercial_campaigns_generic.sql" \
    -f "$ROOT/supabase/migrations/20261022160000_office_agents.sql"
}

case "${1:-reset}" in
  start) start ;;
  reset)
    start
    "$PGBIN/psql" -h "$PGHOST" -p "$PGPORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q -c "drop database if exists $DB_NAME" >/dev/null
    "$PGBIN/psql" -h "$PGHOST" -p "$PGPORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q -c "create database $DB_NAME" >/dev/null
    schema "$DB_NAME"
    ;;
  stop) as_postgres "$PGBIN/pg_ctl" -D "$PGDIR" -m fast stop >/dev/null ;;
  *) echo 'uso: tests/db.sh [start|reset|stop] [database_test]' >&2; exit 2 ;;
esac

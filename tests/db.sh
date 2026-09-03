#!/usr/bin/env bash
# Avvia un Postgres locale usa-e-getta e ci applica lo schema minimo piu le
# migration del motore campagne. Serve ai test di integrazione: senza un
# database vero, lock, trigger e vincoli non si possono verificare.
set -euo pipefail

PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
PGDIR=${PGDIR:-/var/lib/postgresql/testdata}
PGPORT=${PGPORT:-55432}
PGHOST=${PGHOST:-/tmp}
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

start() {
  if "$PGBIN/pg_isready" -h "$PGHOST" -p "$PGPORT" >/dev/null 2>&1; then return 0; fi
  rm -rf "$PGDIR"; mkdir -p "$PGDIR"; chown -R postgres:postgres "$(dirname "$PGDIR")"
  su postgres -c "$PGBIN/initdb -D $PGDIR -U postgres -A trust" >/dev/null
  su postgres -c "$PGBIN/pg_ctl -D $PGDIR -o '-p $PGPORT -k $PGHOST' -l $PGDIR/log start" >/dev/null
  for _ in $(seq 1 30); do
    "$PGBIN/pg_isready" -h "$PGHOST" -p "$PGPORT" >/dev/null 2>&1 && return 0
    sleep 0.5
  done
  echo "postgres non parte" >&2; cat "$PGDIR/log" >&2; exit 1
}

schema() {
  psql -h "$PGHOST" -p "$PGPORT" -U postgres -d "$1" -v ON_ERROR_STOP=1 -q \
    -f "$ROOT/tests/sql/fixture.sql" \
    -f "$ROOT/supabase/migrations/20260828180000_hospitality_outreach.sql" \
    -f "$ROOT/supabase/migrations/20260829210000_hospitality_outreach_guards.sql" \
    -f "$ROOT/supabase/migrations/20260903170000_commercial_campaigns_generic.sql" 2>&1 | grep -v '^psql:.*NOTICE' || true
}

case "${1:-reset}" in
  start) start ;;
  reset)
    start
    psql -h "$PGHOST" -p "$PGPORT" -U postgres -d postgres -q -c "drop database if exists campagne_test" >/dev/null
    psql -h "$PGHOST" -p "$PGPORT" -U postgres -d postgres -q -c "create database campagne_test" >/dev/null
    schema campagne_test
    ;;
  stop) su postgres -c "$PGBIN/pg_ctl -D $PGDIR -m immediate stop" >/dev/null 2>&1 || true ;;
  *) echo "uso: tests/db.sh [start|reset|stop]" >&2; exit 2 ;;
esac

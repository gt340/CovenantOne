#!/usr/bin/env bash
# Runs the Phase 18 database tests against a THROWAWAY Postgres (never production).
# Usage: DATABASE_URL=postgres://user:pass@localhost:5432/testdb bash tests/db/run.sh
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL must point at a disposable test database}"
case "$DATABASE_URL" in
  *supabase.co*|*supabase.com*|*pooler.supabase*) echo "Refusing to run against a Supabase-hosted database"; exit 2;;
esac
dir="$(cd "$(dirname "$0")" && pwd)"
migration="$(ls "$dir"/../../prisma/migrations/*_phase18_self_approval_prevention/migration.sql)"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$dir/schema_fixture.sql"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$migration"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$dir/knowledge.test.sql"

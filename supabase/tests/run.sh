#!/usr/bin/env bash
# Dockerで独立したPostgreSQLを作成し、終了時に削除。Supabaseへの接続は行わない。
set -euo pipefail
cd "$(dirname "$0")/../.."
container_name="life-partner-sql-${RANDOM}-$$"
trap 'docker rm -f "$container_name" >/dev/null 2>&1 || true' EXIT
docker run --rm -d --name "$container_name" -e POSTGRES_PASSWORD=local-test-only postgres:17-alpine >/dev/null
for attempt in {1..30}; do
  if docker exec "$container_name" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
for sql_file in supabase/tests/auth-fixture.sql supabase/schema.sql supabase/rls.sql supabase/schema.sql supabase/rls.sql supabase/tests/assertions.sql; do
  docker exec -i "$container_name" psql -U postgres -v ON_ERROR_STOP=1 < "$sql_file"
done

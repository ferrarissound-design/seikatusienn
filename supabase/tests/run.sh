#!/usr/bin/env bash
# Dockerで独立したPostgreSQLを作成し、終了時に削除。Supabaseへの接続は行わない。
set -euo pipefail
cd "$(dirname "$0")/../.."
container_name="life-partner-sql-${RANDOM}-$$"
cleanup() {
  test_status=$?
  if [[ "$test_status" -ne 0 ]]; then
    docker logs "$container_name" >&2 || true
  fi
  docker rm -f "$container_name" >/dev/null 2>&1 || true
  exit "$test_status"
}
trap cleanup EXIT
docker run --rm -d --name "$container_name" -e POSTGRES_PASSWORD=local-test-only postgres:17-alpine >/dev/null
postgres_ready=0
for attempt in {1..30}; do
  # 初期化中の一時サーバーはUnix socketのみ。最終サーバーのTCP待受を待つ。
  if docker exec "$container_name" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; then
    postgres_ready=1
    break
  fi
  sleep 1
done
if [[ "$postgres_ready" -ne 1 ]]; then
  echo 'PostgreSQL did not become ready on TCP within 30 attempts.' >&2
  exit 1
fi
for sql_file in supabase/tests/auth-fixture.sql supabase/schema.sql supabase/rls.sql supabase/schema.sql supabase/rls.sql supabase/tests/assertions.sql; do
  docker exec -i -e PGPASSWORD=local-test-only "$container_name" psql -h 127.0.0.1 -U postgres -v ON_ERROR_STOP=1 < "$sql_file"
done

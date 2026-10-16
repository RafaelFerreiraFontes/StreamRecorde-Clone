# PostgreSQL Foundation

Wave 05 Task 02 adds an inert PostgreSQL foundation. The current JSON adapters
and `StreamsRepository` remain the sole production authority until the explicit
cutover task. The API starts without connecting to PostgreSQL; connection and
migration failures are reported only when the database service is used.

## Local database

Start the normal local stack with `docker compose up -d`. PostgreSQL listens
only on `127.0.0.1:${POSTGRES_PORT:-5432}` and uses the local development
defaults documented in `compose.yml`. Set `DATABASE_URL` when running database
commands outside Compose, then apply checked-in migrations with:

```bash
pnpm --dir api db:migrate
```

The migrations are SQL files under `api/drizzle/migrations`. Drizzle tracks
applied migrations in `__drizzle_migrations`; rerunning the command is a no-op
after a successful application. `pnpm --dir api db:generate` creates a new
reviewable migration from `src/database/schema.ts` when a future scoped task
changes the schema.

## Isolated foundation validation

Run the following command from the repository root:

```bash
node scripts/test-db-foundation.mjs
```

It starts only the `streamrecorder-test-db` Compose project on port `55432`,
applies migrations, runs integrity and transaction integration tests, stops and
recreates the test database while retaining its dedicated volume, verifies persistence,
then removes that project and its `postgres_test_data` volume. It does not use
the normal database volume, `runtime-data`, or recording directories.

The schema stores metadata only. Recording media stays on the local recording
mount and is never inserted into PostgreSQL.
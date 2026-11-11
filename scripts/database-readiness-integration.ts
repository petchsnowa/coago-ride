import { currentAppTableCount, currentMigrationCount } from "@coago/db";
import assert from "node:assert/strict";
import pg from "pg";
import { testDatabaseUrl } from "./database";
import { probeDatabase } from "./database-readiness/probe";

const client = new pg.Client({ connectionString: testDatabaseUrl() });
try {
  await client.connect();
  const before = (
    await client.query("SELECT count(*)::int AS count FROM users")
  ).rows[0].count;
  const result = await probeDatabase(client);
  assert(result.postgres && result.postgis);
  assert.equal(result.appTables, currentAppTableCount);
  assert.equal(result.migrations, currentMigrationCount);
  assert.equal(
    (await client.query("SELECT count(*)::int AS count FROM users")).rows[0]
      .count,
    before,
  );
  assert.equal(
    (await client.query("SHOW transaction_read_only")).rows[0]
      .transaction_read_only,
    "off",
  );
  await client.query("BEGIN READ ONLY");
  await assert.rejects(
    client.query("CREATE TABLE coago_readonly_guard_test(id int)"),
    (error: unknown) =>
      !!error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "25006",
  );
  await client.query("ROLLBACK");
  assert.equal(
    (
      await client.query(
        "SELECT to_regclass('public.coago_readonly_guard_test') AS t",
      )
    ).rows[0].t,
    null,
  );
  console.log(
    "PASS database readiness: real PostgreSQL/PostGIS metadata, migrations count, unchanged users, read-only transaction blocks DDL and cleanup resets connection",
  );
} finally {
  await client.end();
}

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { withDatabase, systemMetadata } from "@coago/db";
import { testDatabaseUrl } from "./database";
await withDatabase(testDatabaseUrl(), async (db, client) => {
  const result = await client.query(
    "SELECT version() AS pg, PostGIS_Full_Version() AS postgis",
  );
  console.log(result.rows[0]);
  const point = await client.query(
    "SELECT ST_AsText(ST_SetSRID(ST_MakePoint(100.5018, 13.7563),4326)) AS point",
  );
  assert.equal(point.rows[0].point, "POINT(100.5018 13.7563)");
  const before = await client.query(
    "SELECT count(*) FROM drizzle.__drizzle_migrations",
  );
  const journal = JSON.parse(
    await readFile("packages/db/migrations/meta/_journal.json", "utf8"),
  );
  assert.equal(Number(before.rows[0].count), journal.entries.length);
  await db.transaction(async (tx) => {
    await tx
      .insert(systemMetadata)
      .values({ key: "integration", value: "passed" })
      .onConflictDoUpdate({
        target: systemMetadata.key,
        set: { value: "passed" },
      });
    const rows = await tx
      .select()
      .from(systemMetadata)
      .where(sql`${systemMetadata.key} = 'integration'`);
    assert.equal(rows[0]?.value, "passed");
    await tx
      .delete(systemMetadata)
      .where(sql`${systemMetadata.key} = 'integration'`);
  });
  await assert.rejects(
    client.query("INSERT INTO system_metadata(key,value) VALUES ($1,$2)", [
      "invalid",
      null,
    ]),
  );
  await assert.rejects(
    client.query("SELECT pg_sleep(10)"),
    /statement timeout|Query read timeout/,
  );
  console.log("PASS query timeout cleanup");
  console.log(
    "PASS migration history, Drizzle read/write, NOT NULL constraint and spatial query",
  );
});

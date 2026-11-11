import type pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { currentMigrationCount, currentAppTableCount } from "@coago/db";
import { probeDatabase } from "../database-readiness/probe";
export async function upgradeAdminSchema(
  client: pg.Client,
  options: { allowExistingData?: boolean; folder?: string } = {},
) {
  const folder = options.folder ?? "packages/db/migrations",
    expected = readMigrationFiles({ migrationsFolder: folder });
  if (expected.length !== currentMigrationCount || currentMigrationCount !== 10)
    throw new Error("ADMIN_MIGRATION_SET_CHANGED");
  if (
    !(await client.query("SELECT pg_try_advisory_lock(207417,6) AS locked"))
      .rows[0].locked
  )
    throw new Error("ADMIN_MIGRATION_ALREADY_RUNNING");
  try {
    const rows = (
      await client.query<{ hash: string; created_at: string }>(
        "SELECT hash,created_at FROM drizzle.__drizzle_migrations ORDER BY created_at,id",
      )
    ).rows;
    if (
      ![7, 9, 10].includes(rows.length) ||
      rows.some(
        (r, i) =>
          r.hash !== expected[i].hash ||
          Number(r.created_at) !== expected[i].folderMillis,
      )
    )
      throw new Error("ADMIN_MIGRATION_HISTORY_MISMATCH");
    const before = await probeDatabase(client);
    if (!before.postgis) throw new Error("ADMIN_POSTGIS_REQUIRED");
    const counts = (
      await client.query(
        "SELECT (SELECT count(*)::int FROM users) AS users,(SELECT count(*)::int FROM trips) AS trips,(SELECT count(*)::int FROM ride_requests) AS requests",
      )
    ).rows[0];
    if (rows.length < currentMigrationCount) {
      if (
        rows.length === 7 &&
        (before.appTables !== 8 ||
          (
            await client.query(
              "SELECT to_regclass('public.site_settings') AS s,to_regclass('public.admin_audit') AS a",
            )
          ).rows.some((r) => r.s || r.a))
      )
        throw new Error("ADMIN_UNMANAGED_SCHEMA");
      if (
        !options.allowExistingData &&
        Object.values(counts).some((n) => Number(n) > 0)
      )
        throw new Error("ADMIN_EXISTING_DATA_REVIEW_REQUIRED");
      await migrate(drizzle(client), { migrationsFolder: folder });
    }
    const after = await probeDatabase(client),
      history = (
        await client.query<{ hash: string; created_at: string }>(
          "SELECT hash,created_at FROM drizzle.__drizzle_migrations ORDER BY created_at,id",
        )
      ).rows;
    if (
      after.appTables !== currentAppTableCount ||
      after.migrations !== currentMigrationCount ||
      history.length !== expected.length ||
      history.some(
        (r, i) =>
          r.hash !== expected[i].hash ||
          Number(r.created_at) !== expected[i].folderMillis,
      )
    )
      throw new Error("ADMIN_SCHEMA_VERIFICATION_FAILED");
    const next = (
      await client.query(
        "SELECT (SELECT count(*)::int FROM users) AS users,(SELECT count(*)::int FROM trips) AS trips,(SELECT count(*)::int FROM ride_requests) AS requests",
      )
    ).rows[0];
    if (JSON.stringify(counts) !== JSON.stringify(next))
      throw new Error("ADMIN_ROW_COUNT_CHANGED");
    const settings = (
      await client.query(
        "SELECT service_open,registrations_open,version FROM site_settings WHERE id='site'",
      )
    ).rows[0];
    if (!settings) throw new Error("ADMIN_SITE_SETTINGS_MISSING");
    return {
      status:
        rows.length < currentMigrationCount ? "upgraded" : "already_upgraded",
      ...after,
      settings,
      recordCounts: next,
    };
  } finally {
    await client.query("SELECT pg_advisory_unlock(207417,6)");
  }
}

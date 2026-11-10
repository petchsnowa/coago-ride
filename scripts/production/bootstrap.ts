import type pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { databaseProbeConfig } from "../database-readiness/config";

export const productionHost =
  "ep-restless-brook-a12zmjkb.ap-southeast-1.aws.neon.tech";
const tables = [
  "auth_rate_limits",
  "auth_sessions",
  "external_identities",
  "oauth_flows",
  "ride_requests",
  "system_metadata",
  "trips",
  "users",
];
export function bootstrapConfig(env: NodeJS.ProcessEnv) {
  const config = databaseProbeConfig(env);
  if (
    config.target !== "production" ||
    config.origin.host !== productionHost ||
    config.origin.database !== "neondb"
  )
    throw new Error("BOOTSTRAP_APPROVED_TARGET_REQUIRED");
  if (
    env.COAGO_BOOTSTRAP_OPERATION !== "check" &&
    env.COAGO_BOOTSTRAP_OPERATION !== "bootstrap"
  )
    throw new Error("BOOTSTRAP_OPERATION_REQUIRED");
  return { ...config, operation: env.COAGO_BOOTSTRAP_OPERATION };
}

// Internal entry point also exercised on disposable local databases in CI.
// Production CLI always validates the approved Direct host/database before connecting.
export async function bootstrapEmptyDatabase(
  client: pg.Client,
  folder = "packages/db/migrations",
) {
  const migrations = readMigrationFiles({ migrationsFolder: folder });
  if (migrations.length !== 7)
    throw new Error("BOOTSTRAP_MIGRATION_SET_CHANGED");
  const locked = (
    await client.query("SELECT pg_try_advisory_lock(207417, 6) AS locked")
  ).rows[0].locked;
  if (!locked) throw new Error("BOOTSTRAP_ALREADY_RUNNING");
  try {
    if (
      !(
        await client.query("SELECT 1 FROM pg_extension WHERE extname='postgis'")
      ).rowCount
    )
      throw new Error("BOOTSTRAP_POSTGIS_REQUIRED");
    const relations = (
      await client.query<{ schema: string; name: string }>(`
      SELECT n.nspname AS schema,c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE c.relkind IN ('r','p','v','m','S','f') AND n.nspname !~ '^pg_' AND n.nspname<>'information_schema'
      AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype='e')
    `)
    ).rows;
    const hasJournal = !!(
      await client.query(
        "SELECT to_regclass('drizzle.__drizzle_migrations') AS t",
      )
    ).rows[0].t;
    const history = hasJournal
      ? (
          await client.query<{ hash: string; created_at: string }>(
            "SELECT hash,created_at FROM drizzle.__drizzle_migrations ORDER BY created_at,id",
          )
        ).rows
      : [];
    const isJournal = (r: { schema: string; name: string }) =>
      r.schema === "drizzle" &&
      ["__drizzle_migrations", "__drizzle_migrations_id_seq"].includes(r.name);
    if (history.length) {
      if (
        history.length !== migrations.length ||
        history.some(
          (r, i) =>
            r.hash !== migrations[i].hash ||
            Number(r.created_at) !== migrations[i].folderMillis,
        )
      )
        throw new Error("BOOTSTRAP_MIGRATION_HISTORY_MISMATCH");
      if (
        relations.some(
          (r) =>
            !isJournal(r) &&
            !(r.schema === "public" && tables.includes(r.name)),
        )
      )
        throw new Error("BOOTSTRAP_UNEXPECTED_OBJECTS");
      await verifyEmptySchema(client);
      return {
        status: "already_initialized",
        migrations: history.length,
        appTables: tables.length,
      };
    }
    if (relations.some((r) => !isJournal(r)))
      throw new Error("BOOTSTRAP_DATABASE_NOT_EMPTY");
    // Drizzle applies all seven application migrations and journal inserts in one transaction.
    // Its empty journal infrastructure can remain on failure; never drop anything to retry.
    await migrate(drizzle(client), { migrationsFolder: folder });
    const applied = (
      await client.query<{ hash: string; created_at: string }>(
        "SELECT hash,created_at FROM drizzle.__drizzle_migrations ORDER BY created_at,id",
      )
    ).rows;
    if (
      applied.length !== migrations.length ||
      applied.some(
        (r, i) =>
          r.hash !== migrations[i].hash ||
          Number(r.created_at) !== migrations[i].folderMillis,
      )
    )
      throw new Error("BOOTSTRAP_MIGRATION_HISTORY_MISMATCH");
    await verifyEmptySchema(client);
    return {
      status: "initialized",
      migrations: applied.length,
      appTables: tables.length,
    };
  } finally {
    await client.query("SELECT pg_advisory_unlock(207417, 6)");
  }
}

async function verifyEmptySchema(client: pg.Client) {
  for (const name of tables) {
    // Names come exclusively from the fixed source list above, never external input.
    if (
      !(await client.query("SELECT to_regclass($1) AS t", [`public.${name}`]))
        .rows[0].t
    )
      throw new Error("BOOTSTRAP_SCHEMA_INCOMPLETE");
    if (
      (
        await client.query(
          `SELECT EXISTS(SELECT 1 FROM public."${name}" LIMIT 1) AS populated`,
        )
      ).rows[0].populated
    )
      throw new Error("BOOTSTRAP_DATABASE_NOT_EMPTY");
  }
  const constraints = (
    await client.query(
      "SELECT conname FROM pg_constraint WHERE conrelid IN ('public.trips'::regclass,'public.ride_requests'::regclass)",
    )
  ).rows.map((r) => r.conname);
  for (const name of [
    "trips_booked_range",
    "ride_requests_status",
    "ride_requests_snapshot_object",
    "ride_requests_decision_time",
    "ride_requests_rejection_reason",
  ])
    if (!constraints.includes(name))
      throw new Error("BOOTSTRAP_SCHEMA_INCOMPLETE");
  const columns = (
    await client.query(
      "SELECT table_name,column_name,data_type,is_nullable FROM information_schema.columns WHERE table_schema='public' AND ((table_name='trips' AND column_name='seats_booked') OR (table_name='ride_requests' AND column_name='trip_snapshot'))",
    )
  ).rows;
  if (
    columns.length !== 2 ||
    columns.some(
      (r) =>
        r.is_nullable !== "NO" ||
        r.data_type !==
          (r.column_name === "seats_booked" ? "integer" : "jsonb"),
    )
  )
    throw new Error("BOOTSTRAP_SCHEMA_INCOMPLETE");
}

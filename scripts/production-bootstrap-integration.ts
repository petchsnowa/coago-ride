import assert from "node:assert/strict";
import { mkdtemp, cp, appendFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import pg from "pg";
import { testDatabaseUrl } from "./database";
import { bootstrapEmptyDatabase } from "./production/bootstrap";

const base = testDatabaseUrl(),
  admin = new pg.Client({ connectionString: base });
const prefix = `coago_bootstrap_${crypto.randomUUID().replaceAll("-", "").slice(0, 10)}`;
const created: string[] = [],
  clients: pg.Client[] = [];
const dir = await mkdtemp(join(tmpdir(), "coago-bootstrap-"));
const domain = (code: string) => (error: unknown) =>
  error instanceof Error && error.message === code;
async function database(suffix: string) {
  const name = `${prefix}_${suffix}_test`;
  assert(/^[a-z0-9_]+$/.test(name));
  await admin.query(`CREATE DATABASE "${name}"`);
  created.push(name);
  const url = new URL(base);
  url.pathname = `/${name}`;
  const client = new pg.Client({ connectionString: url.href });
  clients.push(client);
  await client.connect();
  return { client, url: url.href };
}
try {
  await admin.connect();
  const { client, url } = await database("fresh");
  await assert.rejects(
    bootstrapEmptyDatabase(client),
    domain("BOOTSTRAP_POSTGIS_REQUIRED"),
  );
  await client.query("CREATE EXTENSION postgis");
  await client.query("CREATE TABLE unrelated_data(id int)");
  await assert.rejects(
    bootstrapEmptyDatabase(client),
    domain("BOOTSTRAP_DATABASE_NOT_EMPTY"),
  );
  assert.equal(
    (
      await client.query(
        "SELECT to_regclass('drizzle.__drizzle_migrations') AS t",
      )
    ).rows[0].t,
    null,
  );
  await client.query("DROP TABLE unrelated_data");
  const other = new pg.Client({ connectionString: url });
  clients.push(other);
  await other.connect();
  await other.query("SELECT pg_advisory_lock(207417,6)");
  await assert.rejects(
    bootstrapEmptyDatabase(client),
    domain("BOOTSTRAP_ALREADY_RUNNING"),
  );
  await other.query("SELECT pg_advisory_unlock(207417,6)");
  assert.deepEqual(await bootstrapEmptyDatabase(client), {
    status: "initialized",
    migrations: 7,
    appTables: 8,
  });
  assert.deepEqual(await bootstrapEmptyDatabase(client), {
    status: "already_initialized",
    migrations: 7,
    appTables: 8,
  });
  await client.query("BEGIN");
  await client.query(
    "UPDATE drizzle.__drizzle_migrations SET hash='wrong' WHERE id=(SELECT min(id) FROM drizzle.__drizzle_migrations)",
  );
  await assert.rejects(
    bootstrapEmptyDatabase(client),
    domain("BOOTSTRAP_MIGRATION_HISTORY_MISMATCH"),
  );
  await client.query("ROLLBACK");
  const user = crypto.randomUUID();
  await client.query(
    "INSERT INTO users(id,display_name) VALUES($1,'Bootstrap fixture')",
    [user],
  );
  await assert.rejects(
    bootstrapEmptyDatabase(client),
    domain("BOOTSTRAP_DATABASE_NOT_EMPTY"),
  );
  assert.equal(
    (
      await client.query("SELECT count(*)::int AS n FROM users WHERE id=$1", [
        user,
      ])
    ).rows[0].n,
    1,
  );
  const second = (await database("rollback")).client;
  await second.query("CREATE EXTENSION postgis");
  const folder = join(dir, "migrations");
  await cp("packages/db/migrations", folder, { recursive: true });
  await appendFile(
    join(folder, "0006_uneven_butterfly.sql"),
    "\n--> statement-breakpoint\nSELECT 1/0;\n",
  );
  await assert.rejects(bootstrapEmptyDatabase(second, folder));
  assert.equal(
    (await second.query("SELECT to_regclass('public.users') AS t")).rows[0].t,
    null,
  );
  assert.equal(
    (
      await second.query(
        "SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations",
      )
    ).rows[0].n,
    0,
  );
  assert.equal((await bootstrapEmptyDatabase(second)).status, "initialized");
  assert.equal(
    (await second.query("SELECT count(*)::int AS n FROM users")).rows[0].n,
    0,
  );
  console.log(
    "PASS production bootstrap on disposable local DBs: empty-target guards, PostGIS, advisory lock, seven migrations/history/schema, idempotent repeat, rejects existing data/history drift, atomic migration rollback and safe resume; production untouched",
  );
} finally {
  for (const client of clients) await client.end().catch(() => {});
  for (const name of created)
    await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
  await admin.end();
  await rm(dir, { recursive: true, force: true });
}

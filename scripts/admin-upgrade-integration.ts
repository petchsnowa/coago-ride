import assert from "node:assert/strict";
import {
  mkdtemp,
  cp,
  readFile,
  writeFile,
  rm,
  appendFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { testDatabaseUrl } from "./database";
import { upgradeAdminSchema } from "./production/admin-upgrade";
const folder = await mkdtemp(join(tmpdir(), "coago-admin-upgrade-"));
const baseline = join(folder, "baseline"),
  broken = join(folder, "broken");
await cp("packages/db/migrations", baseline, { recursive: true });
const journal = JSON.parse(
  await readFile(join(baseline, "meta/_journal.json"), "utf8"),
);
journal.entries = journal.entries.filter((e: { idx: number }) => e.idx < 7);
await writeFile(join(baseline, "meta/_journal.json"), JSON.stringify(journal));
await cp("packages/db/migrations", broken, { recursive: true });
await appendFile(
  join(broken, "0008_ancient_zeigeist.sql"),
  "\n--> statement-breakpoint\nSELECT coago_intentional_upgrade_failure();\n",
);
const base = testDatabaseUrl(),
  admin = new pg.Client({ connectionString: base }),
  name = `coago_upgrade_${crypto.randomUUID().replaceAll("-", "").slice(0, 10)}_test`,
  url = new URL(base);
url.pathname = `/${name}`;
const client = new pg.Client({ connectionString: url.href });
let created = false;
try {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${name}"`);
  created = true;
  await client.connect();
  await migrate(drizzle(client), { migrationsFolder: baseline });
  const id = crypto.randomUUID();
  await client.query(
    "INSERT INTO users(id,display_name) VALUES($1,'Upgrade preservation')",
    [id],
  );
  await assert.rejects(
    upgradeAdminSchema(client),
    /ADMIN_EXISTING_DATA_REVIEW_REQUIRED/,
  );
  await assert.rejects(
    upgradeAdminSchema(client, { allowExistingData: true, folder: broken }),
  );
  assert.equal(
    (
      await client.query(
        "SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations",
      )
    ).rows[0].n,
    7,
  );
  assert.equal(
    (await client.query("SELECT to_regclass('public.site_settings') AS t"))
      .rows[0].t,
    null,
  );
  const result = await upgradeAdminSchema(client, { allowExistingData: true });
  assert.equal(result.status, "upgraded");
  assert.equal(result.migrations, 10);
  assert.equal(result.appTables, 10);
  assert.equal(result.settings.service_open, false);
  assert.equal(result.settings.registrations_open, false);
  assert.equal(
    (
      await client.query("SELECT display_name,status FROM users WHERE id=$1", [
        id,
      ])
    ).rows[0].status,
    "active",
  );
  await client.query("UPDATE site_settings SET service_open=true,version=2");
  const retry = await upgradeAdminSchema(client);
  assert.equal(retry.status, "already_upgraded");
  assert.equal(retry.settings.service_open, true);
  assert.equal(retry.settings.version, 2);
  await client.query(
    "UPDATE drizzle.__drizzle_migrations SET hash='drift' WHERE id=(SELECT min(id) FROM drizzle.__drizzle_migrations)",
  );
  await assert.rejects(
    upgradeAdminSchema(client),
    /ADMIN_MIGRATION_HISTORY_MISMATCH/,
  );
  const nine = join(folder, "nine");
  await cp("packages/db/migrations", nine, { recursive: true });
  const nineJournal = JSON.parse(
    await readFile(join(nine, "meta/_journal.json"), "utf8"),
  );
  nineJournal.entries = nineJournal.entries.filter(
    (e: { idx: number }) => e.idx < 9,
  );
  await writeFile(
    join(nine, "meta/_journal.json"),
    JSON.stringify(nineJournal),
  );
  // Only this randomly named disposable fixture database is reset.
  await client.query(
    "DROP SCHEMA public CASCADE; DROP SCHEMA drizzle CASCADE; CREATE SCHEMA public",
  );
  await migrate(drizzle(client), { migrationsFolder: nine });
  await client.query(
    "INSERT INTO users(id,display_name) VALUES($1,'Existing Root owner')",
    [id],
  );
  await client.query("UPDATE site_settings SET service_open=true,version=4");
  await assert.rejects(
    upgradeAdminSchema(client),
    /ADMIN_EXISTING_DATA_REVIEW_REQUIRED/,
  );
  const nineResult = await upgradeAdminSchema(client, {
    allowExistingData: true,
  });
  assert.equal(nineResult.status, "upgraded");
  assert.equal(nineResult.migrations, 10);
  assert.equal(nineResult.settings.service_open, true);
  assert.equal(nineResult.settings.version, 4);
  assert.equal(
    (await client.query("SELECT role FROM users WHERE id=$1", [id])).rows[0]
      .role,
    "user",
  );
  console.log(
    "PASS Root Admin upgrade: seven/nine-to-ten migration, preserved users, default closed, failure transaction rollback, existing-data review guard, idempotency preserves settings and history drift rejection",
  );
} finally {
  await client.end().catch(() => {});
  if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
  await admin.end();
  await rm(folder, { recursive: true, force: true });
}

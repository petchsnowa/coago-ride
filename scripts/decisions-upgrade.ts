import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  copyFile,
  rm,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { publicTripDetailSchema } from "@coago/contracts";
import { testDatabaseUrl } from "./database";
const base = testDatabaseUrl(),
  name = `coago_upgrade_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}_test`;
assert(/^[a-z0-9_]+$/.test(name));
const admin = new pg.Client({ connectionString: base }),
  url = new URL(base);
url.pathname = `/${name}`;
const fixture = new pg.Client({ connectionString: url.href }),
  dir = await mkdtemp(join(tmpdir(), "coago-upgrade-"));
let created = false;
try {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${name}"`);
  created = true;
  await fixture.connect();
  const source = "packages/db/migrations",
    journal = JSON.parse(
      await readFile(join(source, "meta/_journal.json"), "utf8"),
    );
  journal.entries = journal.entries.filter((e: { idx: number }) => e.idx <= 5);
  await mkdir(join(dir, "meta"));
  await writeFile(join(dir, "meta/_journal.json"), JSON.stringify(journal));
  for (const e of journal.entries)
    await copyFile(join(source, `${e.tag}.sql`), join(dir, `${e.tag}.sql`));
  await migrate(drizzle(fixture), { migrationsFolder: dir });
  const owner = crypto.randomUUID(),
    passenger = crypto.randomUUID(),
    trip = crypto.randomUUID(),
    request = crypto.randomUUID(),
    departure = new Date(Date.now() + 86400000).toISOString();
  await fixture.query(
    "INSERT INTO users(id,display_name) VALUES($1,'Upgrade owner'),($2,'Upgrade passenger')",
    [owner, passenger],
  );
  await fixture.query(
    "INSERT INTO trips(id,owner_id,request_id,payload_hash,origin_province,destination_province,departure_at,pickup_point,dropoff_point,seats_offered,vehicle_model,vehicle_color,contribution_satang) VALUES($1,$2,$3,'fixture','กรุงเทพมหานคร','เชียงใหม่',$4,'Original station','End station',2,'Fixture car','White',12345)",
    [trip, owner, crypto.randomUUID(), departure],
  );
  await fixture.query(
    "INSERT INTO ride_requests(id,trip_id,passenger_id,request_id,trip_version) VALUES($1,$2,$3,$4,1)",
    [request, trip, passenger, crypto.randomUUID()],
  );
  await migrate(drizzle(fixture), { migrationsFolder: source });
  const row = (
    await fixture.query(
      "SELECT r.status,r.trip_version,r.trip_snapshot,t.seats_booked FROM ride_requests r JOIN trips t ON t.id=r.trip_id WHERE r.id=$1",
      [request],
    )
  ).rows[0];
  assert.equal(row.status, "pending");
  assert.equal(row.trip_version, 1);
  assert.equal(row.seats_booked, 0);
  const snapshot = publicTripDetailSchema.parse(row.trip_snapshot);
  assert.equal(snapshot.contributionSatang, 12345);
  assert.equal(snapshot.departureAt, departure);
  assert.equal(snapshot.pickupPoint, "Original station");
  await fixture.query(
    "UPDATE trips SET contribution_satang=99999 WHERE id=$1",
    [trip],
  );
  await migrate(drizzle(fixture), { migrationsFolder: source });
  assert.deepEqual(
    (
      await fixture.query(
        "SELECT trip_snapshot FROM ride_requests WHERE id=$1",
        [request],
      )
    ).rows[0].trip_snapshot,
    row.trip_snapshot,
  );
  console.log(
    "PASS upgrade from migrations 0000–0005: existing pending record preserved, snapshot backfilled once with UTC terms, booked count zero, repeat migration immutable",
  );
} finally {
  await fixture.end().catch(() => {});
  if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
  await admin.end().catch(() => {});
  await rm(dir, { recursive: true, force: true });
}

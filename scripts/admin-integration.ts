import assert from "node:assert/strict";
import { Miniflare } from "miniflare";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { testDatabaseUrl } from "./database";
import { postgresAuthStore } from "../apps/api/src/auth/store";
import { hash } from "../apps/api/src/auth/crypto";
import { postgresAdminStore } from "../apps/api/src/admin/store";
import { postgresTripStore } from "../apps/api/src/trips/store";
import { postgresRideRequestStore } from "../apps/api/src/requests/store";
import { postgresDiscoveryStore } from "../apps/api/src/discovery/store";
import { isRoot, readSiteSettings } from "../apps/api/src/admin/access";
import { createApp } from "../apps/api/src/index";
const base = testDatabaseUrl(),
  admin = new pg.Client({ connectionString: base }),
  name = `coago_admin_${crypto.randomUUID().replaceAll("-", "").slice(0, 10)}_test`;
assert(/^[a-z0-9_]+$/.test(name));
const url = new URL(base);
url.pathname = `/${name}`;
const client = new pg.Client({ connectionString: url.href });
let created = false;
const rootSubject = "U" + "a".repeat(32),
  driverSubject = "U" + "b".repeat(32),
  passengerSubject = "U" + "c".repeat(32),
  now = new Date(),
  expires = new Date(now.getTime() + 86400000);
const token = () =>
  crypto.randomUUID().replaceAll("-", "") +
  crypto.randomUUID().replaceAll("-", "");
try {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${name}"`);
  created = true;
  await client.connect();
  await migrate(drizzle(client), {
    migrationsFolder: "packages/db/migrations",
  });
  const auth = postgresAuthStore(url.href),
    store = postgresAdminStore(url.href, rootSubject),
    trips = postgresTripStore(url.href),
    requests = postgresRideRequestStore(url.href),
    publicTrips = postgresDiscoveryStore(url.href);
  await assert.rejects(
    auth.createSession(
      { subject: driverSubject, displayName: "Driver" },
      await hash(token()),
      token(),
      expires,
      now,
      { rootSubject, enforceAccess: true },
    ),
    /REGISTRATION_CLOSED/,
  );
  assert.equal(
    (await client.query("SELECT count(*)::int AS n FROM users")).rows[0].n,
    0,
  );
  const rootToken = token(),
    rootCsrf = token();
  const root = await auth.createSession(
    { subject: rootSubject, displayName: "Root owner" },
    await hash(rootToken),
    rootCsrf,
    expires,
    now,
    { rootSubject, enforceAccess: true },
  );
  await auth.createSession(
    { subject: rootSubject, displayName: "Root owner" },
    await hash(token()),
    token(),
    expires,
    now,
    { rootSubject, enforceAccess: true },
  );
  assert.equal(
    (
      await client.query(
        "SELECT count(*)::int AS n FROM admin_audit WHERE action='root_bootstrap'",
      )
    ).rows[0].n,
    1,
  );
  assert(await isRoot(url.href, root.id, rootSubject));
  assert(!(await isRoot(url.href, root.id, undefined)));
  const driverToken = token(),
    driver = await auth.createSession(
      { subject: driverSubject, displayName: "Driver" },
      await hash(driverToken),
      token(),
      expires,
      now,
    );
  const passenger = await auth.createSession(
    { subject: passengerSubject, displayName: "Passenger" },
    await hash(token()),
    token(),
    expires,
    now,
  );
  assert(!(await isRoot(url.href, driver.id, rootSubject)));
  await assert.rejects(store.overview(driver.id), /forbidden/);
  assert.deepEqual(await readSiteSettings(url.href), {
    serviceOpen: false,
    registrationsOpen: false,
    version: 1,
  });
  const app = createApp(),
    bindings = {
      ENVIRONMENT: "production",
      APP_ORIGIN: "https://coago.space",
      LINE_CALLBACK_URL: "https://coago.space/api/auth/line/callback",
      LINE_CHANNEL_ID: "2009685358",
      LINE_CHANNEL_SECRET: "fixture-only",
      ROOT_ADMIN_LINE_SUBJECT: rootSubject,
      HYPERDRIVE: { connectionString: url.href },
    };
  const call = (path: string, method = "GET", body?: unknown) =>
    app.request(
      `https://coago.space${path}`,
      {
        method,
        headers: {
          Cookie: `__Host-coago_session=${rootToken}`,
          Origin: "https://coago.space",
          "X-CSRF-Token": rootCsrf,
          "Content-Type": "application/json",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      },
      bindings,
    );
  assert.equal(
    (
      await app.request(
        "https://coago.space/api/discovery/trips/upcoming",
        {},
        bindings,
      )
    ).status,
    503,
  );
  assert.equal((await call("/api/admin/overview")).status, 200);
  assert.equal(
    (
      await call(`/api/admin/users/${root.id}/status`, "PUT", {
        status: "suspended",
        version: 1,
        reason: "guard",
      })
    ).status,
    409,
  );
  const oldToken = token();
  await auth.createSession(
    { subject: rootSubject, displayName: "Owner legacy session" },
    await hash(oldToken),
    token(),
    expires,
    now,
  );
  const oldResponse = await app.request(
    "https://coago.space/api/admin/overview",
    { headers: { Cookie: `__Host-coago_session=${oldToken}` } },
    bindings,
  );
  assert.equal(oldResponse.status, 403);
  const runtime = new Miniflare({
    modules: true,
    scriptPath: "apps/api/dist/index.js",
    compatibilityDate: "2026-07-08",
    compatibilityFlags: ["nodejs_compat"],
    bindings,
  });
  try {
    const response = await runtime.dispatchFetch(
      "https://coago.space/api/admin/overview",
      { headers: { Cookie: `__Host-coago_session=${rootToken}` } },
    );
    assert.equal(response.status, 200);
    assert.equal(((await response.json()) as { users: number }).users, 3);
    assert.equal(
      (
        await runtime.dispatchFetch("https://coago.space/api/admin/users", {
          headers: { Cookie: `__Host-coago_session=${driverToken}` },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await runtime.dispatchFetch(
          "https://coago.space/api/discovery/trips/upcoming",
        )
      ).status,
      503,
    );
  } finally {
    await runtime.dispose();
  }
  const opened = await store.setSettings(
    root.id,
    {
      serviceOpen: true,
      registrationsOpen: true,
      version: 1,
      reason: "Owner test",
    },
    now,
  );
  assert.equal(opened.version, 2);
  const draft = {
    originProvince: "กรุงเทพมหานคร" as const,
    destinationProvince: "เชียงใหม่" as const,
    departureAt: new Date(now.getTime() + 86400000).toISOString(),
    pickupPoint: "Station",
    dropoffPoint: "End",
    seats: 2,
    vehicleModel: "Fixture car",
    vehicleColor: "White",
    contributionSatang: 10000,
    luggageNotes: "",
    conditions: "",
  };
  const trip = (
    await trips.create(
      driver.id,
      { ...draft, requestId: crypto.randomUUID() },
      now,
    )
  ).trip;
  const request = (
    await requests.create(
      passenger.id,
      { tripId: trip.id, requestId: crypto.randomUUID() },
      now,
    )
  ).request;
  await requests.decide(
    driver.id,
    request.id,
    { decision: "accept", reason: "" },
    now,
  );
  assert.equal((await publicTrips.detail(trip.id, now))?.seats, 1);
  await store.setUser(
    root.id,
    driver.id,
    { status: "suspended", version: 1, reason: "Review driver" },
    now,
  );
  assert.equal(await auth.getSession(await hash(driverToken), now), undefined);
  await assert.rejects(
    auth.createSession(
      { subject: driverSubject, displayName: "Driver" },
      await hash(token()),
      token(),
      expires,
      now,
      { rootSubject, enforceAccess: true },
    ),
    /ACCOUNT_SUSPENDED/,
  );
  assert.equal(await publicTrips.detail(trip.id, now), undefined);
  await assert.rejects(
    requests.create(
      root.id,
      { tripId: trip.id, requestId: crypto.randomUUID() },
      now,
    ),
  );
  await assert.rejects(
    store.setUser(
      root.id,
      driver.id,
      { status: "active", version: 1, reason: "stale" },
      now,
    ),
    /conflict/,
  );
  await store.setUser(
    root.id,
    driver.id,
    { status: "active", version: 2, reason: "Review complete" },
    now,
  );
  assert.equal((await publicTrips.detail(trip.id, now))?.seats, 1);
  const freshDriverToken = token();
  await auth.createSession(
    { subject: driverSubject, displayName: "Driver" },
    await hash(freshDriverToken),
    token(),
    expires,
    now,
    { rootSubject, enforceAccess: true },
  );
  await store.cancelTrip(
    root.id,
    trip.id,
    { version: 1, reason: "Moderation" },
    now,
  );
  await store.cancelTrip(
    root.id,
    trip.id,
    { version: 1, reason: "Moderation" },
    now,
  );
  assert.equal(
    (
      await client.query("SELECT seats_booked FROM trips WHERE id=$1", [
        trip.id,
      ])
    ).rows[0].seats_booked,
    0,
  );
  assert.equal(
    (
      await client.query("SELECT status FROM ride_requests WHERE id=$1", [
        request.id,
      ])
    ).rows[0].status,
    "cancelled",
  );
  assert.equal(
    (
      await client.query(
        "SELECT count(*)::int AS n FROM admin_audit WHERE action='trip_cancelled'",
      )
    ).rows[0].n,
    1,
  );
  const closed = await store.setSettings(
    root.id,
    {
      serviceOpen: false,
      registrationsOpen: false,
      version: 2,
      reason: "Maintenance test",
    },
    now,
  );
  assert.equal(closed.version, 3);
  await assert.rejects(
    store.setSettings(
      root.id,
      {
        serviceOpen: true,
        registrationsOpen: true,
        version: 2,
        reason: "stale",
      },
      now,
    ),
    /conflict/,
  );
  await client.query(
    "CREATE FUNCTION fail_admin_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture audit failure'; END $$",
  );
  await client.query(
    "CREATE TRIGGER fail_admin_audit_trigger BEFORE INSERT ON admin_audit FOR EACH ROW EXECUTE FUNCTION fail_admin_audit()",
  );
  await assert.rejects(
    store.setUser(
      root.id,
      driver.id,
      { status: "suspended", version: 3, reason: "Rollback" },
      now,
    ),
  );
  assert.equal(
    (await client.query("SELECT status FROM users WHERE id=$1", [driver.id]))
      .rows[0].status,
    "active",
  );
  assert(await auth.getSession(await hash(freshDriverToken), now));
  await assert.rejects(
    store.setSettings(
      root.id,
      {
        serviceOpen: true,
        registrationsOpen: true,
        version: 3,
        reason: "Rollback",
      },
      now,
    ),
  );
  assert.equal((await readSiteSettings(url.href)).serviceOpen, false);
  const rollbackTrip = (
      await trips.create(
        driver.id,
        { ...draft, requestId: crypto.randomUUID() },
        now,
      )
    ).trip,
    rollbackRequest = (
      await requests.create(
        passenger.id,
        { tripId: rollbackTrip.id, requestId: crypto.randomUUID() },
        now,
      )
    ).request;
  await requests.decide(
    driver.id,
    rollbackRequest.id,
    { decision: "accept", reason: "" },
    now,
  );
  await assert.rejects(
    store.cancelTrip(
      root.id,
      rollbackTrip.id,
      { version: 1, reason: "Rollback" },
      now,
    ),
  );
  assert.equal(
    (
      await client.query("SELECT status,seats_booked FROM trips WHERE id=$1", [
        rollbackTrip.id,
      ])
    ).rows[0].seats_booked,
    1,
  );
  assert.equal(
    (
      await client.query("SELECT status FROM ride_requests WHERE id=$1", [
        rollbackRequest.id,
      ])
    ).rows[0].status,
    "accepted",
  );
  await client.query("DROP TRIGGER fail_admin_audit_trigger ON admin_audit");
  await client.query("DROP FUNCTION fail_admin_audit()");
  const concurrentTrip = (
    await trips.create(
      driver.id,
      { ...draft, requestId: crypto.randomUUID() },
      now,
    )
  ).trip;
  const concurrent = await Promise.allSettled([
    requests.create(
      root.id,
      { tripId: concurrentTrip.id, requestId: crypto.randomUUID() },
      now,
    ),
    store.cancelTrip(
      root.id,
      concurrentTrip.id,
      { version: 1, reason: "Concurrent cancellation" },
      now,
    ),
  ]);
  assert.equal(concurrent[1].status, "fulfilled");
  assert.equal(
    (
      await client.query(
        "SELECT count(*)::int AS n FROM ride_requests WHERE trip_id=$1 AND status IN ('pending','accepted')",
        [concurrentTrip.id],
      )
    ).rows[0].n,
    0,
  );
  for (let i = 0; i < 23; i++)
    await client.query(
      "INSERT INTO users(id,display_name,created_at) VALUES($1,$2,$3)",
      [crypto.randomUUID(), `Pagination ${i}`, now],
    );
  const first = await store.list(root.id, "users");
  assert.equal(first.items.length, 20);
  assert(first.nextCursor);
  const cursor = JSON.parse(
      atob(first.nextCursor.replaceAll("-", "+").replaceAll("_", "/")),
    ),
    second = await store.list(root.id, "users", cursor);
  assert.equal(second.items.length, 6);
  assert(!second.items.some((r) => first.items.some((p) => p.id === r.id)));
  const payload = JSON.stringify({
    first,
    audit: await store.list(root.id, "audit"),
    requests: await store.list(root.id, "requests"),
  });
  assert(!payload.includes(rootSubject));
  assert(!payload.includes(rootToken));
  console.log(
    "PASS Root Admin real DB/API: configured LINE owner only, closed signup/service, protected root, CSRF/session roles, suspension/revocation/re-login, hidden suspended-driver trips, cancellation/refund, optimistic settings/users, audit atomic rollback, pagination and no identity/token exposure",
  );
} finally {
  await client.end().catch(() => {});
  if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
  await admin.end();
}

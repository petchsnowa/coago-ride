import assert from "node:assert/strict";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { testDatabaseUrl } from "./database";
import {
  saveWanted,
  listWanted,
  cancelWanted,
} from "../apps/api/src/community/wanted";
import {
  readJourney,
  updateJourney,
  listJourneys,
} from "../apps/api/src/community/journeys";
import { postgresTripStore } from "../apps/api/src/trips/store";
import { postgresRideRequestStore } from "../apps/api/src/requests/store";
import { postgresDiscoveryStore } from "../apps/api/src/discovery/store";
import { publicActivity } from "../apps/api/src/discovery/activity";
import { dispatchNotification } from "../apps/api/src/notifications/dispatch";
import { createApp } from "../apps/api/src/index";
import { hash, randomToken } from "../apps/api/src/auth/crypto";
const base = testDatabaseUrl(),
  admin = new pg.Client({ connectionString: base }),
  name = `coago_community_${crypto.randomUUID().replaceAll("-", "").slice(0, 10)}_test`,
  url = new URL(base);
url.pathname = `/${name}`;
const c = new pg.Client({ connectionString: url.href }),
  driver = crypto.randomUUID(),
  passenger = crypto.randomUUID(),
  other = crypto.randomUUID(),
  unverified = crypto.randomUUID(),
  car = crypto.randomUUID(),
  now = new Date(),
  soon = new Date(now.getTime() + 3600000);
let created = false;
try {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${name}"`);
  created = true;
  await c.connect();
  await migrate(drizzle(c), { migrationsFolder: "packages/db/migrations" });
  for (const id of [driver, passenger, other, unverified]) {
    await c.query(
      "INSERT INTO users(id,display_name) VALUES($1,'Synthetic member')",
      [id],
    );
    await c.query(
      "INSERT INTO external_identities(provider,subject,user_id) VALUES('line',$1,$2)",
      [`U${id.replaceAll("-", "")}`, id],
    );
    if (id !== unverified)
      await c.query(
        "INSERT INTO member_profiles(user_id,data,document_last4,status) VALUES($1,'fixture-ciphertext','1234','approved')",
        [id],
      );
  }
  await c.query(
    "INSERT INTO driver_licenses(user_id,data,document_last4,expires_on,status) VALUES($1,'fixture-ciphertext','5678','2099-12-31','approved')",
    [driver],
  );
  await c.query(
    "INSERT INTO vehicles(id,owner_id,brand,model,color,capacity,data,status) VALUES($1,$2,'Toyota','Yaris','White',4,'fixture-ciphertext','approved')",
    [car, driver],
  );
  const wanted = {
    originProvince: "กรุงเทพมหานคร" as const,
    destinationProvince: "ขอนแก่น" as const,
    departureFrom: soon.toISOString(),
    departureUntil: new Date(soon.getTime() + 3600000).toISOString(),
    seats: 2,
    budgetSatang: 30000,
    requestId: crypto.randomUUID(),
  };
  await assert.rejects(
    saveWanted(url.href, unverified, wanted),
    /member_verification_required/,
  );
  const post = await saveWanted(url.href, passenger, wanted);
  assert.equal((await saveWanted(url.href, passenger, wanted)).id, post.id);
  await assert.rejects(
    saveWanted(url.href, passenger, { ...wanted, seats: 3 }),
    /request_reused/,
  );
  await assert.rejects(
    saveWanted(url.href, other, { ...wanted, version: 1 }, post.id),
    /not_found/,
  );
  await assert.rejects(
    saveWanted(url.href, passenger, { ...wanted, version: 99 }, post.id),
    /conflict/,
  );
  const publicRows = await listWanted(url.href);
  assert.equal(publicRows.posts.length, 1);
  assert(!JSON.stringify(publicRows).includes(passenger));
  assert(!JSON.stringify(publicRows).includes("cancellationReason"));
  assert.equal(
    (await publicActivity(url.href, false, now)).totals.wantedPosts,
    1,
  );
  assert.equal(
    (await publicActivity(url.href, false, now)).wantedDestinations?.[0]
      .province,
    "ขอนแก่น",
  );
  await assert.rejects(
    listWanted(url.href, { cursor: "broken" }),
    /invalid_cursor/,
  );
  for (let i = 0; i < 4; i++)
    await saveWanted(url.href, passenger, {
      ...wanted,
      requestId: crypto.randomUUID(),
    });
  await assert.rejects(
    saveWanted(url.href, passenger, {
      ...wanted,
      requestId: crypto.randomUUID(),
    }),
    /wanted_limit/,
  );
  await cancelWanted(url.href, passenger, post.id, {
    version: 1,
    reason: "Found a ride",
  });
  assert.equal((await listWanted(url.href)).posts.length, 4);
  await c.query("UPDATE users SET status='suspended' WHERE id=$1", [passenger]);
  assert.equal((await listWanted(url.href)).posts.length, 0);
  await c.query("UPDATE users SET status='active' WHERE id=$1", [passenger]);
  // A real LINE session exercises CSRF, owner scoping and canonical-domain guards.
  const token = randomToken(),
    csrf = randomToken();
  await c.query(
    "INSERT INTO auth_sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
    [await hash(token), passenger, csrf],
  );
  const env = {
      ENVIRONMENT: "test",
      DATABASE_URL: url.href,
      APP_ORIGIN: "https://coago.space",
      LINE_CHANNEL_ID: "fixture",
      LINE_CHANNEL_SECRET: "fixture",
      LINE_CALLBACK_URL: "https://coago.space/api/auth/line/callback",
    },
    app = createApp();
  const api = (path: string, method = "GET", body?: unknown, valid = true) =>
    app.request(
      `https://coago.space${path}`,
      {
        method,
        headers: {
          Cookie: `__Host-coago_session=${token}`,
          Origin: "https://coago.space",
          "Content-Type": "application/json",
          "X-CSRF-Token": valid ? csrf : "bad",
        },
        body: body ? JSON.stringify(body) : undefined,
      },
      env,
    );
  assert.equal((await api("/api/wanted/mine")).status, 200);
  assert.equal(
    (
      await api(
        "/api/notifications",
        "PUT",
        { enabled: true, consentVersion: "2026-11-12" },
        false,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await api("/api/notifications", "PUT", {
        enabled: true,
        consentVersion: "2026-11-12",
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await api("/api/notifications", "PUT", {
        enabled: false,
        consentVersion: "2026-11-12",
      })
    ).status,
    200,
  );
  const writer = postgresTripStore(url.href),
    requests = postgresRideRequestStore(url.href),
    discovery = postgresDiscoveryStore(url.href);
  const draft = {
    originProvince: "กรุงเทพมหานคร" as const,
    destinationProvince: "ขอนแก่น" as const,
    departureAt: soon.toISOString(),
    pickupPoint: "Public station A",
    dropoffPoint: "Public station B",
    seats: 3,
    vehicleModel: "Toyota Yaris",
    vehicleColor: "White",
    contributionSatang: 20000,
    luggageNotes: "",
    conditions: "",
    safety: {
      vehicleId: car,
      vehicleVersion: 1,
      cost: {
        distanceKm: 100,
        fuelSatangPerKm: 300,
        operationsSatangPerKm: 100,
        extraSatang: 0,
        shares: 2,
      },
      origin: { lat: 13.7563, lng: 100.5018 },
      destination: { lat: 16.4419, lng: 102.835 },
      distanceSource: "manual" as const,
    },
  };
  const trip = (
    await writer.create(
      driver,
      { ...draft, requestId: crypto.randomUUID() },
      now,
    )
  ).trip;
  await c.query(
    "INSERT INTO notification_preferences(user_id,enabled,consent_version) VALUES($1,true,'2026-11-12'),($2,true,'2026-11-12') ON CONFLICT(user_id) DO UPDATE SET enabled=true",
    [driver, passenger],
  );
  const req = await requests.create(
    passenger,
    { tripId: trip.id, requestId: crypto.randomUUID() },
    now,
  );
  assert.equal(
    (await c.query("SELECT count(*)::int n FROM notification_outbox")).rows[0]
      .n,
    1,
  );
  await requests.decide(
    driver,
    req.request.id,
    { decision: "accept", reason: "" },
    now,
  );
  await assert.rejects(readJourney(url.href, other, trip.id), /not_found/);
  assert.equal(
    (await readJourney(url.href, passenger, trip.id)).canUpdate,
    false,
  );
  assert.equal((await listJourneys(url.href)).items.length, 1);
  const action = {
    requestId: crypto.randomUUID(),
    version: 0,
    status: "ready" as const,
    issue: false,
    note: "",
  };
  await assert.rejects(
    updateJourney(url.href, passenger, trip.id, action),
    /not_found/,
  );
  await assert.rejects(
    updateJourney(url.href, driver, trip.id, {
      ...action,
      status: "travelling",
    }),
    /invalid_transition/,
  );
  await c.query(
    "UPDATE driver_licenses SET expires_on='2020-01-01' WHERE user_id=$1",
    [driver],
  );
  await assert.rejects(
    updateJourney(url.href, driver, trip.id, action),
    /driver_license_required/,
  );
  await c.query(
    "UPDATE driver_licenses SET expires_on='2099-12-31' WHERE user_id=$1",
    [driver],
  );
  const ready = await updateJourney(url.href, driver, trip.id, action);
  assert.equal(ready.version, 1);
  assert.equal(
    (await updateJourney(url.href, driver, trip.id, action)).version,
    1,
  );
  assert.equal(
    (await c.query("SELECT count(*)::int n FROM journey_events")).rows[0].n,
    1,
  );
  await assert.rejects(
    updateJourney(url.href, driver, trip.id, {
      ...action,
      requestId: crypto.randomUUID(),
    }),
    /conflict/,
  );
  const issue = await updateJourney(url.href, driver, trip.id, {
    ...action,
    requestId: crypto.randomUUID(),
    version: 1,
    issue: true,
    note: "Synthetic incident",
  });
  await assert.rejects(
    updateJourney(url.href, driver, trip.id, {
      requestId: crypto.randomUUID(),
      version: issue.version,
      status: "at_pickup",
      issue: true,
      note: "Waiting",
    }),
    /resolve_issue_first/,
  );
  let state = await updateJourney(url.href, driver, trip.id, {
    ...action,
    requestId: crypto.randomUUID(),
    version: issue.version,
    note: "Issue resolved",
  });
  for (const stage of ["at_pickup", "travelling"] as const)
    state = await updateJourney(url.href, driver, trip.id, {
      requestId: crypto.randomUUID(),
      version: state.version,
      status: stage,
      issue: false,
      note: "",
    });
  await assert.rejects(
    requests.cancel(passenger, req.request.id, now),
    /cancellation_closed/,
  );
  await assert.rejects(
    writer.cancel(
      driver,
      trip.id,
      { version: trip.version, reason: "Cannot cancel underway" },
      now,
    ),
    /bookings_locked/,
  );
  assert.equal(await discovery.detail(trip.id, now), undefined);
  await c.query(
    "UPDATE driver_licenses SET expires_on='2020-01-01' WHERE user_id=$1",
    [driver],
  );
  for (const stage of ["arrived", "completed"] as const)
    state = await updateJourney(url.href, driver, trip.id, {
      requestId: crypto.randomUUID(),
      version: state.version,
      status: stage,
      issue: false,
      note: "",
    });
  assert.equal(state.canUpdate, false);
  assert.equal(state.events.length, 7);
  // No live LINE calls: all provider requests are mocked and counted.
  const messaging = {
    ...env,
    LINE_MESSAGING_ENABLED: "true",
    LINE_MESSAGING_PROVIDER_CONFIRMED: "true",
    LINE_MESSAGING_CHANNEL_ACCESS_TOKEN: "synthetic-token",
  };
  let pushes = 0;
  const fake: typeof fetch = async (input, init) => {
    const path = String(input);
    if (path.endsWith("/quota"))
      return Response.json({ type: "limited", value: 200 });
    if (path.endsWith("/consumption")) return Response.json({ totalUsage: 0 });
    assert(path.endsWith("/push"));
    assert(new Headers(init?.headers).has("X-Line-Retry-Key"));
    pushes++;
    return Response.json({});
  };
  const results = await Promise.all([
    dispatchNotification(messaging, fake),
    dispatchNotification(messaging, fake),
  ]);
  assert.deepEqual(results, ["sent", "sent"]);
  for (let i = 0; i < 8; i++) await dispatchNotification(messaging, fake);
  assert.equal(pushes, 5);
  assert.equal(await dispatchNotification(messaging, fake), "idle");
  const pending = (
    await c.query(
      "SELECT count(*)::int n FROM notification_outbox WHERE status='pending'",
    )
  ).rows[0].n;
  assert(pending > 0);
  await api("/api/notifications", "PUT", {
    enabled: false,
    consentVersion: "2026-11-12",
  });
  assert.equal(
    (
      await c.query(
        "SELECT count(*)::int n FROM notification_outbox WHERE user_id=$1 AND status='pending'",
        [passenger],
      )
    ).rows[0].n,
    0,
  );
  // Retrying an ambiguous result reuses the same retry key/body and reserves no extra job budget.
  const retryJob = (
    await c.query(
      "SELECT id,retry_key FROM notification_outbox WHERE user_id=$1 AND status='sent' LIMIT 1",
      [driver],
    )
  ).rows[0];
  await c.query(
    "UPDATE notification_outbox SET status='skipped' WHERE status='pending'",
  );
  await c.query(
    "UPDATE notification_outbox SET status='pending',attempts=0,next_attempt_at=now() WHERE id=$1",
    [retryJob.id],
  );
  const deliveryBodies: string[] = [],
    deliveryKeys: string[] = [];
  const flaky: typeof fetch = async (input, init) => {
    if (String(input).endsWith("/push")) {
      deliveryBodies.push(String(init?.body));
      deliveryKeys.push(new Headers(init?.headers).get("X-Line-Retry-Key")!);
      return new Response(null, { status: 503 });
    }
    return fake(input, init);
  };
  assert.equal(await dispatchNotification(messaging, flaky), "retry");
  await c.query(
    "UPDATE notification_outbox SET next_attempt_at=now() WHERE id=$1",
    [retryJob.id],
  );
  const accepted: typeof fetch = async (input, init) => {
    if (String(input).endsWith("/push")) {
      deliveryBodies.push(String(init?.body));
      deliveryKeys.push(new Headers(init?.headers).get("X-Line-Retry-Key")!);
      return new Response(null, {
        status: 409,
        headers: { "x-line-accepted-request-id": "fixture-accepted" },
      });
    }
    return fake(input, init);
  };
  assert.equal(await dispatchNotification(messaging, accepted), "sent");
  assert.equal(deliveryBodies[0], deliveryBodies[1]);
  assert.deepEqual(deliveryKeys, [retryJob.retry_key, retryJob.retry_key]);
  assert.equal(
    (
      await c.query("SELECT attempts FROM notification_outbox WHERE id=$1", [
        retryJob.id,
      ])
    ).rows[0].attempts,
    2,
  );
  await c.query(
    "UPDATE notification_outbox SET status='processing',claimed_at=now()-interval '6 minutes',attempts=3 WHERE id=$1",
    [retryJob.id],
  );
  assert.equal(await dispatchNotification(messaging, fake), "idle");
  assert.equal(
    (
      await c.query("SELECT status FROM notification_outbox WHERE id=$1", [
        retryJob.id,
      ])
    ).rows[0].status,
    "failed",
  );
  // Existing cancelled-trip transaction notifies passengers once, without a spurious driver cancellation alert.
  await c.query(
    "UPDATE notification_preferences SET enabled=true WHERE user_id=$1",
    [passenger],
  );
  const secondTrip = (
    await writer.create(
      driver,
      { ...draft, requestId: crypto.randomUUID() },
      now,
    )
  ).trip;
  const secondRequest = await requests.create(
    passenger,
    { tripId: secondTrip.id, requestId: crypto.randomUUID() },
    now,
  );
  await requests.decide(
    driver,
    secondRequest.request.id,
    { decision: "accept", reason: "" },
    now,
  );
  await writer.cancel(
    driver,
    secondTrip.id,
    { version: secondTrip.version, reason: "Synthetic cancellation" },
    now,
  );
  assert.equal(
    (
      await c.query(
        "SELECT count(*)::int n FROM notification_outbox WHERE trip_id=$1 AND kind='trip_cancelled'",
        [secondTrip.id],
      )
    ).rows[0].n,
    1,
  );
  assert.equal(
    (
      await c.query(
        "SELECT count(*)::int n FROM notification_outbox WHERE trip_id=$1 AND kind='request_cancelled'",
        [secondTrip.id],
      )
    ).rows[0].n,
    0,
  );
  console.log(
    "PASS community real Postgres/API: wanted ownership/approval/limits/privacy, journey transitions/participants/license/seat gates, durable opt-in outbox, duplicate protection, concurrent delivery budget, opt-out; no real LINE messages",
  );
} finally {
  await c.end().catch(() => {});
  if (created) await admin.query(`DROP DATABASE "${name}" WITH(FORCE)`);
  await admin.end();
}

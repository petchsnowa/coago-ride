import { publicActivity } from "../apps/api/src/discovery/activity";
import { postgresRideRequestStore } from "../apps/api/src/requests/store";
import { decodeDiscoveryCursor } from "../apps/api/src/discovery/cursor";
import assert from "node:assert/strict";
import { withDatabase } from "@coago/db";
import { postgresDiscoveryStore } from "../apps/api/src/discovery/store";
import { postgresTripStore } from "../apps/api/src/trips/store";
import { tripDraftSchema, type TripSearch } from "@coago/contracts";
import { testDatabaseUrl } from "./database";
const url = testDatabaseUrl(),
  owner = crypto.randomUUID(),
  passenger = crypto.randomUUID(),
  passengerTwo = crypto.randomUUID(),
  now = new Date("2030-01-01T00:00:00Z"),
  store = postgresDiscoveryStore(url),
  writer = postgresTripStore(url);
const input: TripSearch = {
  originProvince: "กรุงเทพมหานคร",
  destinationProvince: "เชียงใหม่",
  date: "2030-01-02",
};
const draft = tripDraftSchema.parse({
  originProvince: input.originProvince,
  destinationProvince: input.destinationProvince,
  departureAt: "2030-01-02T03:30:00.000Z",
  seats: 3,
  vehicleModel: "Discovery car",
  vehicleColor: "White",
  contributionSatang: 10025,
  pickupPoint: "Public station A",
  dropoffPoint: "Public station B",
  luggageNotes: "One bag",
  conditions: "Test only",
});
async function create(departureAt: string, extra = {}) {
  return (
    await writer.create(
      owner,
      { ...draft, ...extra, departureAt, requestId: crypto.randomUUID() },
      new Date("2029-01-01T00:00:00Z"),
    )
  ).trip;
}
try {
  const baseline = await publicActivity(url, false, now);
  await withDatabase(url, async (_db, c) => {
    await c.query("INSERT INTO users(id,display_name) VALUES ($1,$2)", [
      owner,
      "Private identity never in public DTO",
    ]);
  });
  const before = await create("2030-01-01T16:59:59.999Z"),
    start = await create("2030-01-01T17:00:00.000Z"),
    end = await create("2030-01-02T16:59:59.999Z"),
    after = await create("2030-01-02T17:00:00.000Z"),
    expired = await create("2029-12-31T23:59:59.000Z"),
    cancelled = await create(draft.departureAt),
    reversed = await create(draft.departureAt, {
      originProvince: input.destinationProvince,
      destinationProvince: input.originProvince,
    });
  await writer.cancel(
    owner,
    cancelled.id,
    { version: 1, reason: "Discovery cancelled fixture" },
    now,
  );
  // Same departure times exercise the id tie-breaker; 23 matches -> 20 + 3.
  for (let i = 0; i < 21; i++) await create(draft.departureAt);
  const upcoming = await store.upcoming(now);
  assert.equal(upcoming.trips.length, 6);
  assert.equal(upcoming.nextCursor, null);
  assert.equal(upcoming.trips[0].id, before.id);
  for (const trip of upcoming.trips) {
    assert(Date.parse(trip.departureAt) > now.getTime());
    assert(!("ownerId" in trip));
    assert(![cancelled.id, expired.id].includes(trip.id));
  }
  const first = await store.search(input, now);
  assert.equal(first.trips.length, 20);
  assert(first.nextCursor);
  const cursor = decodeDiscoveryCursor(first.nextCursor);
  const second = await store.search(input, now, cursor),
    all = [...first.trips, ...second.trips];
  assert.equal(all.length, 23);
  assert.equal(new Set(all.map((t) => t.id)).size, 23);
  assert.equal(second.nextCursor, null);
  assert.equal(all[0].id, start.id);
  assert.equal(all.at(-1)?.id, end.id);
  for (const trip of [before, after, expired, cancelled, reversed])
    assert(!all.some((t) => t.id === trip.id));
  for (let i = 1; i < all.length; i++)
    assert(
      `${all[i - 1].departureAt}:${all[i - 1].id}` <
        `${all[i].departureAt}:${all[i].id}`,
    );
  const detail = await store.detail(start.id, now);
  assert(detail);
  assert.equal(detail.pickupPoint, draft.pickupPoint);
  assert.equal(detail.contributionSatang, 10025);
  for (const key of [
    "ownerId",
    "requestId",
    "payloadHash",
    "version",
    "status",
    "createdAt",
    "updatedAt",
    "cancellationReason",
    "displayName",
    "subject",
  ]) {
    assert(!(key in detail));
    assert(!(key in all[0]));
  }
  assert(!("pickupPoint" in all[0]));
  assert.equal(await store.detail(cancelled.id, now), undefined);
  assert.equal(await store.detail(expired.id, now), undefined);
  assert.equal(await store.detail(crypto.randomUUID(), now), undefined);
  // Exactly at departure is unavailable, both search and direct detail.
  assert.equal(
    await store.detail(start.id, new Date(start.departureAt)),
    undefined,
  );
  assert(
    !(await store.search(input, new Date(start.departureAt))).trips.some(
      (t) => t.id === start.id,
    ),
  );
  // Cancellation between list and details must not leak a stale active record.
  await writer.cancel(
    owner,
    start.id,
    { version: 1, reason: "After listing" },
    now,
  );
  assert.equal(await store.detail(start.id, now), undefined);
  assert(!(await store.upcoming(now)).trips.some((t) => t.id === start.id));
  assert.equal(
    (await store.search({ ...input, date: "2030-01-05" }, now)).trips.length,
    0,
  );
  // One saved vehicle can have multiple trips; count it once globally.
  const car = crypto.randomUUID();
  const safety = {
    vehicleId: car,
    vehicleVersion: 1,
    origin: { lat: 13.7, lng: 100.5 },
    destination: { lat: 18.7, lng: 98.9 },
    distanceSource: "manual",
    cost: {
      distanceKm: 100,
      fuelSatangPerKm: 300,
      operationsSatangPerKm: 0,
      extraSatang: 0,
      shares: 3,
    },
  };
  await create("2030-01-09T03:30:00.000Z", { safety });
  const secondCarTrip = await create("2030-01-10T03:30:00.000Z", {
    safety,
    destinationProvince: "ขอนแก่น",
  });
  await withDatabase(url, async (_db, c) => {
    await c.query("INSERT INTO users(id,display_name) VALUES($1,$2)", [
      passenger,
      "Private passenger",
    ]);
  });
  await postgresRideRequestStore(url).create(
    passenger,
    { tripId: before.id, requestId: crypto.randomUUID() },
    now,
  );
  await withDatabase(url, async (_db, c) => {
    await c.query("INSERT INTO users(id,display_name) VALUES($1,$2)", [
      passengerTwo,
      "Another private passenger",
    ]);
  });
  await postgresRideRequestStore(url).create(
    passengerTwo,
    { tripId: before.id, requestId: crypto.randomUUID() },
    now,
  );
  const activity = await publicActivity(url, false, now);
  assert.equal(activity.totals.trips, baseline.totals.trips + 27);
  assert.equal(activity.totals.vehicles, baseline.totals.vehicles + 1);
  assert.equal(activity.totals.seats, baseline.totals.seats + 81);
  assert.equal(
    activity.totals.pendingRequests,
    baseline.totals.pendingRequests + 2,
  );
  assert(
    activity.destinations.some(
      (d) => d.province === "เชียงใหม่" && d.pendingRequests >= 1,
    ),
  );
  const serialized = JSON.stringify(activity);
  for (const secret of [
    owner,
    passenger,
    "Private passenger",
    "Private identity",
    car,
  ])
    assert(!serialized.includes(secret));
  await withDatabase(url, async (_db, c) => {
    await c.query("UPDATE users SET status='suspended' WHERE id=$1", [
      passenger,
    ]);
  });
  assert.equal(
    (await publicActivity(url, false, now)).totals.pendingRequests,
    baseline.totals.pendingRequests + 1,
  );
  await withDatabase(url, async (_db, c) => {
    await c.query("UPDATE trips SET seats_booked=seats_offered WHERE id=$1", [
      secondCarTrip.id,
    ]);
  });
  const afterFull = await publicActivity(url, false, now);
  assert.equal(afterFull.totals.trips, activity.totals.trips - 1);
  assert.equal(afterFull.totals.seats, activity.totals.seats - 3);
  assert.equal(afterFull.totals.vehicles, activity.totals.vehicles);
  assert(
    !afterFull.destinations.some((d) => d.nextTripId === secondCarTrip.id),
  );
  await withDatabase(url, async (_db, c) => {
    await c.query("UPDATE users SET status='suspended' WHERE id=$1", [owner]);
  });
  assert.deepEqual(
    (await publicActivity(url, false, now)).totals,
    baseline.totals,
  );
  const index = await withDatabase(
    url,
    async (_db, c) =>
      (
        await c.query(
          "SELECT indexdef FROM pg_indexes WHERE indexname='trips_search_active_idx'",
        )
      ).rows[0]?.indexdef,
  );
  assert(index?.includes("WHERE (status = 'active'::text)"));
  console.log(
    "PASS discovery DB: upcoming six/time/status/projection, Thai midnight boundaries, route/date/status/expiry, 20+3 keyset with equal times, public projection, stale detail/partial index, activity distinct cars/seats/pending aggregates/privacy/full/suspended exclusions",
  );
} finally {
  await withDatabase(url, async (_db, c) => {
    await c.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [
      [owner, passenger, passengerTwo],
    ]);
  });
}

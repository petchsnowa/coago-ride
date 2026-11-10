import { decodeDiscoveryCursor } from "../apps/api/src/discovery/cursor";
import assert from "node:assert/strict";
import { withDatabase } from "@coago/db";
import { postgresDiscoveryStore } from "../apps/api/src/discovery/store";
import { postgresTripStore } from "../apps/api/src/trips/store";
import { tripDraftSchema, type TripSearch } from "@coago/contracts";
import { testDatabaseUrl } from "./database";
const url = testDatabaseUrl(),
  owner = crypto.randomUUID(),
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
    "PASS discovery DB: upcoming six/time/status/projection, Thai midnight boundaries, route/date/status/expiry, 20+3 keyset with equal times, public projection, stale detail and partial index",
  );
} finally {
  await withDatabase(url, async (_db, c) => {
    await c.query("DELETE FROM users WHERE id=$1", [owner]);
  });
}

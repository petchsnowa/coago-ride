import assert from "node:assert/strict";
import { withDatabase } from "@coago/db";
import { postgresTripStore, TripError } from "../apps/api/src/trips/store";
import { tripDraftSchema, type TripCursor } from "@coago/contracts";
import { testDatabaseUrl } from "./database";
const url = testDatabaseUrl(),
  store = postgresTripStore(url),
  owner = crypto.randomUUID(),
  other = crypto.randomUUID(),
  now = new Date(),
  future = new Date(now.getTime() + 86400000).toISOString();
const draft = tripDraftSchema.parse({
  originProvince: "กรุงเทพมหานคร",
  destinationProvince: "เชียงใหม่",
  departureAt: future,
  pickupPoint: "Integration pickup",
  dropoffPoint: "Integration dropoff",
  seats: 3,
  vehicleModel: "Test car",
  vehicleColor: "White",
  contributionSatang: 10025,
});
const requestId = crypto.randomUUID();
const rejects = (code: string) => (e: unknown) =>
  e instanceof TripError && e.code === code;
try {
  await withDatabase(url, async (_db, c) => {
    await c.query("INSERT INTO users(id,display_name) VALUES ($1,$2),($3,$4)", [
      owner,
      "Trip integration A",
      other,
      "Trip integration B",
    ]);
  });
  const results = await Promise.all([
    store.create(owner, { ...draft, requestId }, now),
    store.create(owner, { ...draft, requestId }, now),
  ]);
  assert.equal(results[0].trip.id, results[1].trip.id);
  assert.equal(results.filter((r) => r.created).length, 1);
  const initial = results[0].trip;
  assert(!("ownerId" in initial));
  assert(!("payloadHash" in initial));
  await assert.rejects(
    store.create(owner, { ...draft, requestId, seats: 4 }, now),
    rejects("request_reused"),
  );
  const ownOther = await store.create(other, { ...draft, requestId }, now);
  assert.notEqual(ownOther.trip.id, initial.id);
  assert.equal((await store.list(other)).trips.length, 1);
  await assert.rejects(
    store.update(other, initial.id, { ...draft, version: 1 }, now),
    rejects("trip_not_found"),
  );
  await assert.rejects(
    store.cancel(other, initial.id, { version: 1, reason: "Denied" }, now),
    rejects("trip_not_found"),
  );
  const concurrent = await Promise.allSettled([
    store.update(owner, initial.id, { ...draft, seats: 4, version: 1 }, now),
    store.update(owner, initial.id, { ...draft, seats: 5, version: 1 }, now),
  ]);
  assert.equal(concurrent.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(
    concurrent.filter(
      (r) => r.status === "rejected" && rejects("trip_conflict")(r.reason),
    ).length,
    1,
  );
  const changed = (await store.list(owner)).trips.find(
    (t) => t.id === initial.id,
  )!;
  assert.equal(changed.version, 2);
  await withDatabase(url, async (_db, c) => {
    await assert.rejects(
      c.query("UPDATE trips SET seats_offered=0 WHERE id=$1", [initial.id]),
      /trips_seats_range/,
    );
    await assert.rejects(
      c.query(
        "UPDATE trips SET status='cancelled',cancellation_reason=NULL WHERE id=$1",
        [initial.id],
      ),
      /trips_status_reason/,
    );
  });
  const cancelled = await store.cancel(
    owner,
    initial.id,
    { version: 2, reason: "Integration cancellation" },
    now,
  );
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.version, 3);
  assert.equal(
    (
      await store.cancel(
        owner,
        initial.id,
        { version: 2, reason: "Integration cancellation" },
        now,
      )
    ).version,
    3,
  );
  await assert.rejects(
    store.update(owner, initial.id, { ...draft, version: 3 }, now),
    rejects("trip_not_editable"),
  );
  await assert.rejects(
    store.create(
      owner,
      {
        ...draft,
        departureAt: now.toISOString(),
        requestId: crypto.randomUUID(),
      },
      now,
    ),
    rejects("departure_in_past"),
  );
  const past = await store.create(
    owner,
    { ...draft, requestId: crypto.randomUUID() },
    now,
  );
  const later = new Date(now.getTime() + 172800000);
  await assert.rejects(
    store.cancel(
      owner,
      past.trip.id,
      { version: 1, reason: "too late" },
      later,
    ),
    rejects("departure_in_past"),
  );
  await assert.rejects(
    store.update(
      owner,
      past.trip.id,
      {
        ...draft,
        departureAt: new Date(later.getTime() + 86400000).toISOString(),
        version: 1,
      },
      later,
    ),
    rejects("departure_in_past"),
  );
  for (let i = 0; i < 21; i++)
    await store.create(
      owner,
      { ...draft, requestId: crypto.randomUUID() },
      now,
    );
  const first = await store.list(owner);
  assert.equal(first.trips.length, 20);
  assert(first.nextCursor);
  const cursor = JSON.parse(
    atob(first.nextCursor.replaceAll("-", "+").replaceAll("_", "/")),
  ) as TripCursor;
  const second = await store.list(owner, cursor);
  const all = [...first.trips, ...second.trips];
  assert.equal(all.length, 23);
  assert.equal(new Set(all.map((t) => t.id)).size, 23);
  assert(second.nextCursor === null);
  console.log(
    "PASS trips DB: ownership, idempotent concurrent create, optimistic updates, cancellation, expiry guards, DB constraints and cursor pagination",
  );
} finally {
  await withDatabase(url, async (_db, c) => {
    await c.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [
      [owner, other],
    ]);
  });
}

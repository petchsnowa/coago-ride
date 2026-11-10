import assert from "node:assert/strict";
import { withDatabase } from "@coago/db";
import {
  postgresRideRequestStore,
  RideRequestError,
} from "../apps/api/src/requests/store";
import { postgresTripStore, TripError } from "../apps/api/src/trips/store";
import { postgresDiscoveryStore } from "../apps/api/src/discovery/store";
import { testDatabaseUrl } from "./database";
const url = testDatabaseUrl(),
  store = postgresRideRequestStore(url),
  trips = postgresTripStore(url),
  publicStore = postgresDiscoveryStore(url),
  ids = Array.from({ length: 6 }, () => crypto.randomUUID()),
  [driver, p1, p2, p3, stranger] = ids,
  now = new Date();
const draft = {
  originProvince: "กรุงเทพมหานคร" as const,
  destinationProvince: "เชียงใหม่" as const,
  departureAt: new Date(now.getTime() + 86400000).toISOString(),
  pickupPoint: "Original pickup",
  dropoffPoint: "Original dropoff",
  seats: 1,
  vehicleModel: "Decision car",
  vehicleColor: "White",
  contributionSatang: 10025,
  luggageNotes: "One bag",
  conditions: "Original terms",
};
const domain = (code: string) => (e: unknown) =>
  e instanceof RideRequestError && e.code === code;
async function newTrip(seats = 1) {
  return (
    await trips.create(
      driver,
      { ...draft, seats, requestId: crypto.randomUUID() },
      now,
    )
  ).trip;
}
async function create(actor: string, tripId: string) {
  return (
    await store.create(actor, { tripId, requestId: crypto.randomUUID() }, now)
  ).request;
}
const accept = { decision: "accept" as const, reason: "" },
  reject = { decision: "reject" as const, reason: "Changed travel plan" };
async function invariant(tripId: string) {
  return withDatabase(url, async (_db, c) => {
    const row = (
      await c.query(
        "SELECT t.seats_offered,t.seats_booked,(SELECT count(*)::int FROM ride_requests r WHERE r.trip_id=t.id AND r.status='accepted') AS accepted FROM trips t WHERE t.id=$1",
        [tripId],
      )
    ).rows[0];
    assert(row.seats_booked >= 0 && row.seats_booked <= row.seats_offered);
    assert.equal(row.seats_booked, row.accepted);
    return row;
  });
}
try {
  await withDatabase(url, async (_db, c) => {
    for (const [i, id] of ids.entries())
      await c.query("INSERT INTO users(id,display_name) VALUES($1,$2)", [
        id,
        `Decision tester ${i}`,
      ]);
  });
  const t = await newTrip(),
    r1 = await create(p1, t.id),
    r2 = await create(p2, t.id);
  await assert.rejects(
    store.decide(stranger, r1.id, accept, now),
    domain("request_not_found"),
  );
  await assert.rejects(
    store.decide(p1, r1.id, accept, now),
    domain("request_not_found"),
  );
  const race = await Promise.allSettled([
    store.decide(driver, r1.id, accept, now),
    store.decide(driver, r2.id, accept, now),
  ]);
  assert.equal(race.filter((r) => r.status === "fulfilled").length, 1);
  for (const r of race)
    if (r.status === "rejected") assert(domain("trip_unavailable")(r.reason));
  const accepted = race.find((r) => r.status === "fulfilled")!;
  assert(accepted.status === "fulfilled");
  const winner = accepted.value,
    loser = winner.id === r1.id ? r2 : r1,
    winningPassenger = winner.id === r1.id ? p1 : p2;
  assert.equal(winner.status, "accepted");
  assert(winner.decidedAt);
  assert.equal(winner.offeredTrip.pickupPoint, "Original pickup");
  assert.equal(winner.offeredTrip.contributionSatang, 10025);
  assert.equal((await invariant(t.id)).seats_booked, 1);
  assert.equal(await publicStore.detail(t.id, now), undefined);
  const retry = await store.decide(driver, winner.id, accept, now);
  assert.equal(retry.decidedAt, winner.decidedAt);
  assert.equal((await invariant(t.id)).seats_booked, 1);
  await assert.rejects(
    store.decide(driver, winner.id, reject, now),
    domain("request_not_pending"),
  );
  await assert.rejects(
    trips.update(
      driver,
      t.id,
      { ...draft, version: 1, contributionSatang: 20000 },
      now,
    ),
    (e: unknown) => e instanceof TripError && e.code === "bookings_locked",
  );
  const released = await Promise.all([
    store.cancel(winningPassenger, winner.id, now),
    store.cancel(winningPassenger, winner.id, now),
  ]);
  assert(released.every((r) => r.status === "cancelled"));
  assert.equal((await invariant(t.id)).seats_booked, 0);
  assert.equal((await publicStore.detail(t.id, now))!.seats, 1);
  await assert.rejects(
    store.decide(driver, winner.id, accept, now),
    domain("request_not_pending"),
  );
  await store.decide(driver, loser.id, accept, now);
  assert.equal((await invariant(t.id)).seats_booked, 1);
  await trips.cancel(
    driver,
    t.id,
    { version: 1, reason: "Owner cancellation" },
    now,
  );
  assert.equal((await invariant(t.id)).seats_booked, 0);
  assert.equal(
    (await store.list(driver, "incoming")).requests.find(
      (r) => r.id === loser.id,
    )!.status,
    "cancelled",
  );
  await store.cancel(loser.id === r1.id ? p1 : p2, loser.id, now);
  assert.equal((await invariant(t.id)).seats_booked, 0);
  const rejectionTrip = await newTrip(2),
    rr = await create(p1, rejectionTrip.id);
  const rejected = await store.decide(driver, rr.id, reject, now);
  assert.equal(rejected.status, "rejected");
  assert.equal(rejected.rejectionReason, reject.reason);
  assert.equal((await invariant(rejectionTrip.id)).seats_booked, 0);
  assert.equal(
    (await store.decide(driver, rr.id, reject, now)).decidedAt,
    rejected.decidedAt,
  );
  await assert.rejects(
    store.decide(driver, rr.id, accept, now),
    domain("request_not_pending"),
  );
  assert((await store.context(p1, rejectionTrip.id, now)).canRequest);
  const resubmitted = await create(p1, rejectionTrip.id);
  assert.notEqual(resubmitted.id, rr.id);
  // Details edited after request: block acceptance and preserve immutable original terms.
  const changedTrip = await newTrip(2),
    old = await create(p1, changedTrip.id);
  await trips.update(
    driver,
    changedTrip.id,
    {
      ...draft,
      seats: 2,
      version: 1,
      contributionSatang: 20000,
      pickupPoint: "New pickup",
    },
    now,
  );
  await assert.rejects(
    store.decide(driver, old.id, accept, now),
    domain("trip_changed"),
  );
  assert.equal((await invariant(changedTrip.id)).seats_booked, 0);
  const history = (await store.list(p1, "mine")).requests.find(
    (r) => r.id === old.id,
  )!;
  assert(history.tripChanged);
  assert.equal(history.offeredTrip.pickupPoint, "Original pickup");
  assert.equal(history.offeredTrip.contributionSatang, 10025);
  await store.cancel(p1, old.id, now);
  const fresh = await create(p1, changedTrip.id);
  assert.equal(fresh.offeredTrip.pickupPoint, "New pickup");
  await store.decide(driver, fresh.id, accept, now);
  // Accepted cancellation cutoff; pending cancellation remains allowed after departure.
  const past = new Date(Date.parse(changedTrip.departureAt) + 1);
  await assert.rejects(
    store.cancel(p1, fresh.id, past),
    domain("cancellation_closed"),
  );
  await assert.rejects(
    store.decide(driver, resubmitted.id, accept, past),
    domain("trip_unavailable"),
  );
  await store.cancel(p1, resubmitted.id, past);
  // Multiple accepts on the same request consume one seat, leaving other pending terms valid.
  const shared = await newTrip(2),
    s1 = await create(p1, shared.id),
    s2 = await create(p2, shared.id);
  await Promise.all([
    store.decide(driver, s1.id, accept, now),
    store.decide(driver, s1.id, accept, now),
  ]);
  assert.equal((await invariant(shared.id)).seats_booked, 1);
  await store.decide(driver, s2.id, accept, now);
  assert.equal((await invariant(shared.id)).seats_booked, 2);
  assert.equal(
    (await store.list(p2, "mine")).requests.find((r) => r.id === s2.id)!
      .tripChanged,
    false,
  );
  // Request cancellation and acceptance serialize; final capacity matches the final status.
  const cancelRace = await newTrip(),
    cr = await create(p3, cancelRace.id);
  const outcomes = await Promise.allSettled([
    store.decide(driver, cr.id, accept, now),
    store.cancel(p3, cr.id, now),
  ]);
  assert.equal(outcomes[1].status, "fulfilled");
  if (outcomes[0].status === "rejected")
    assert(domain("request_not_pending")(outcomes[0].reason));
  assert.equal((await invariant(cancelRace.id)).seats_booked, 0);
  const closeRace = await newTrip(),
    closeRequest = await create(p3, closeRace.id);
  const closeResults = await Promise.allSettled([
    store.decide(driver, closeRequest.id, accept, now),
    trips.cancel(
      driver,
      closeRace.id,
      { version: 1, reason: "Race closure" },
      now,
    ),
  ]);
  assert.equal(closeResults[1].status, "fulfilled");
  if (closeResults[0].status === "rejected")
    assert(
      domain("request_not_pending")(closeResults[0].reason) ||
        domain("trip_unavailable")(closeResults[0].reason),
    );
  assert.equal((await invariant(closeRace.id)).seats_booked, 0);
  await withDatabase(url, async (_db, c) => {
    await assert.rejects(
      c.query("UPDATE trips SET seats_booked=seats_offered+1 WHERE id=$1", [
        shared.id,
      ]),
      /trips_booked_range/,
    );
    await assert.rejects(
      c.query("UPDATE trips SET seats_booked=-1 WHERE id=$1", [shared.id]),
      /trips_booked_range/,
    );
  });
  console.log(
    "PASS decisions DB: last-seat race, owner-only decisions, duplicate accept/reject, snapshots/stale offers, edit lock, accepted refund once/cutoff, request/trip cancellation races, capacity invariants",
  );
} finally {
  await withDatabase(url, async (_db, c) => {
    await c.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [ids]);
  });
}

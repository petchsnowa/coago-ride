import assert from "node:assert/strict";
import { withDatabase } from "@coago/db";
import {
  postgresRideRequestStore,
  RideRequestError,
} from "../apps/api/src/requests/store";
import { postgresTripStore } from "../apps/api/src/trips/store";
import { testDatabaseUrl } from "./database";
const url = testDatabaseUrl(),
  store = postgresRideRequestStore(url),
  trips = postgresTripStore(url),
  ids = Array.from({ length: 4 }, () => crypto.randomUUID()),
  [driver, passenger, stranger, passenger2] = ids,
  now = new Date(),
  future = new Date(now.getTime() + 86400000).toISOString();
const draft = {
  originProvince: "กรุงเทพมหานคร" as const,
  destinationProvince: "เชียงใหม่" as const,
  departureAt: future,
  pickupPoint: "Request test A",
  dropoffPoint: "Request test B",
  seats: 3,
  vehicleModel: "Test car",
  vehicleColor: "White",
  contributionSatang: 10025,
  luggageNotes: "",
  conditions: "",
};
const isError = (code: string) => (e: unknown) =>
  e instanceof RideRequestError && e.code === code;
try {
  await withDatabase(url, async (_db, c) => {
    for (const [i, id] of ids.entries())
      await c.query("INSERT INTO users(id,display_name) VALUES($1,$2)", [
        id,
        `Request tester ${i}`,
      ]);
  });
  const trip = (
    await trips.create(
      driver,
      { ...draft, requestId: crypto.randomUUID() },
      now,
    )
  ).trip;
  await assert.rejects(
    store.create(
      driver,
      { tripId: trip.id, requestId: crypto.randomUUID() },
      now,
    ),
    isError("own_trip"),
  );
  const key = crypto.randomUUID(),
    calls = await Promise.all([
      store.create(passenger, { tripId: trip.id, requestId: key }, now),
      store.create(passenger, { tripId: trip.id, requestId: key }, now),
    ]);
  assert.equal(calls.filter((r) => r.created).length, 1);
  assert.equal(calls[0].request.id, calls[1].request.id);
  const request = calls[0].request;
  assert.equal(request.status, "pending");
  assert.equal(request.seatsRequested, 1);
  const before = (await trips.list(driver)).trips.find(
    (t) => t.id === trip.id,
  )!;
  assert.equal(before.seats, 3);
  await assert.rejects(
    store.create(
      passenger,
      { tripId: trip.id, requestId: crypto.randomUUID() },
      now,
    ),
    isError("already_requested"),
  );
  const mine = await store.list(passenger, "mine"),
    incoming = await store.list(driver, "incoming");
  assert.equal(mine.requests.length, 1);
  assert.equal(incoming.requests[0].id, request.id);
  assert.equal(incoming.requests[0].passengerName, "Request tester 1");
  assert.equal((await store.list(stranger, "mine")).requests.length, 0);
  assert.equal((await store.list(stranger, "incoming")).requests.length, 0);
  await assert.rejects(
    store.cancel(stranger, request.id, now),
    isError("request_not_found"),
  );
  await assert.rejects(
    store.cancel(driver, request.id, now),
    isError("request_not_found"),
  );
  assert.equal((await store.context(driver, trip.id, now)).isOwner, true);
  assert.equal(
    (await store.context(passenger, trip.id, now)).canRequest,
    false,
  );
  assert.equal((await store.context(stranger, trip.id, now)).request, null);
  const changed = await trips.update(
    driver,
    trip.id,
    { ...draft, version: 1, contributionSatang: 20000 },
    now,
  );
  assert.equal(
    (await store.list(passenger, "mine")).requests[0].tripChanged,
    true,
  );
  assert.equal(
    (await store.list(passenger, "mine")).requests[0].trip.contributionSatang,
    20000,
  );
  const cancellations = await Promise.all([
    store.cancel(passenger, request.id, now),
    store.cancel(passenger, request.id, now),
  ]);
  assert(cancellations.every((r) => r.status === "cancelled"));
  assert.equal(cancellations[0].updatedAt, cancellations[1].updatedAt);
  const replay = await store.create(
    passenger,
    { tripId: trip.id, requestId: key },
    now,
  );
  assert.equal(replay.created, false);
  assert.equal(replay.request.status, "cancelled");
  assert.equal((await store.context(passenger, trip.id, now)).canRequest, true);
  const newRequest = await store.create(
    passenger,
    { tripId: trip.id, requestId: crypto.randomUUID() },
    now,
  );
  assert.notEqual(newRequest.request.id, request.id);
  assert.equal(newRequest.request.tripChanged, false);
  const another = (
    await trips.create(
      driver,
      { ...draft, requestId: crypto.randomUUID() },
      now,
    )
  ).trip;
  await assert.rejects(
    store.create(passenger, { tripId: another.id, requestId: key }, now),
    isError("request_reused"),
  );
  const competing = await Promise.allSettled([
    store.create(
      passenger2,
      { tripId: trip.id, requestId: crypto.randomUUID() },
      now,
    ),
    store.create(
      passenger2,
      { tripId: trip.id, requestId: crypto.randomUUID() },
      now,
    ),
  ]);
  assert.equal(competing.filter((r) => r.status === "fulfilled").length, 1);
  for (const outcome of competing)
    if (outcome.status === "rejected")
      assert(isError("already_requested")(outcome.reason));
  await withDatabase(url, async (_db, c) => {
    await assert.rejects(
      c.query("UPDATE ride_requests SET seats_requested=2 WHERE id=$1", [
        newRequest.request.id,
      ]),
      /ride_requests_single_seat/,
    );
    await assert.rejects(
      c.query(
        "INSERT INTO ride_requests(id,trip_id,passenger_id,request_id,trip_version) VALUES($1,$2,$3,$4,1)",
        [crypto.randomUUID(), trip.id, passenger, crypto.randomUUID()],
      ),
      /ride_requests_pending_idx/,
    );
  });
  await trips.cancel(
    driver,
    trip.id,
    { version: changed.version, reason: "Trip closed during requests" },
    now,
  );
  await assert.rejects(
    store.create(
      stranger,
      { tripId: trip.id, requestId: crypto.randomUUID() },
      now,
    ),
    isError("trip_unavailable"),
  );
  await assert.rejects(
    store.context(stranger, trip.id, now),
    isError("trip_not_found"),
  );
  assert.equal(
    (await store.list(passenger, "mine")).requests[0].trip.status,
    "cancelled",
  );
  await store.cancel(passenger, newRequest.request.id, now);
  const departed = new Date(Date.parse(another.departureAt) + 1);
  await assert.rejects(
    store.create(
      passenger,
      { tripId: another.id, requestId: crypto.randomUUID() },
      departed,
    ),
    isError("trip_unavailable"),
  );
  assert.equal(
    (await trips.list(driver)).trips.find((t) => t.id === another.id)!.seats,
    3,
  );
  // Overlap request creation with trip cancellation: a request may precede cancellation, never start after it.
  const racing = (
    await trips.create(
      driver,
      { ...draft, requestId: crypto.randomUUID() },
      now,
    )
  ).trip;
  const raceResults = await Promise.allSettled([
    store.create(
      passenger,
      { tripId: racing.id, requestId: crypto.randomUUID() },
      now,
    ),
    trips.cancel(
      driver,
      racing.id,
      { version: 1, reason: "Race fixture" },
      now,
    ),
  ]);
  assert.equal(raceResults[1].status, "fulfilled");
  if (raceResults[0].status === "rejected")
    assert(isError("trip_unavailable")(raceResults[0].reason));
  await assert.rejects(
    store.create(
      stranger,
      { tripId: racing.id, requestId: crypto.randomUUID() },
      now,
    ),
    isError("trip_unavailable"),
  );
  // Cursor pagination for both roles, including equal creation times.
  for (let i = 0; i < 20; i++) {
    await store.cancel(
      passenger,
      (
        await store.create(
          passenger,
          { tripId: another.id, requestId: crypto.randomUUID() },
          now,
        )
      ).request.id,
      now,
    );
  }
  const first = await store.list(passenger, "mine");
  assert.equal(first.requests.length, 20);
  assert(first.nextCursor);
  const cursor = JSON.parse(
    atob(first.nextCursor.replaceAll("-", "+").replaceAll("_", "/")),
  );
  const second = await store.list(passenger, "mine", cursor);
  assert(second.requests.length > 0);
  assert.equal(
    new Set([...first.requests, ...second.requests].map((r) => r.id)).size,
    first.requests.length + second.requests.length,
  );
  const inboxPage = await store.list(driver, "incoming");
  assert.equal(inboxPage.requests.length, 20);
  assert(inboxPage.nextCursor);
  const inboxCursor = JSON.parse(
    atob(inboxPage.nextCursor.replaceAll("-", "+").replaceAll("_", "/")),
  );
  const inboxMore = await store.list(driver, "incoming", inboxCursor);
  assert(inboxMore.requests.length > 0);
  assert.equal(
    new Set([...inboxPage.requests, ...inboxMore.requests].map((r) => r.id))
      .size,
    inboxPage.requests.length + inboxMore.requests.length,
  );
  for (const r of first.requests)
    for (const field of [
      "passengerId",
      "requestId",
      "ownerId",
      "subject",
      "csrfToken",
    ])
      assert(!(field in r));
  console.log(
    "PASS ride requests DB: owner/passenger isolation, same/different-key concurrency, retry after cancellation, resubmit, trip locking, state/version visibility, one-seat constraints, no seat mutation and pagination",
  );
} finally {
  await withDatabase(url, async (_db, c) => {
    await c.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [ids]);
  });
}

import assert from "node:assert/strict";
import {
  tripResponseSchema,
  tripListSchema,
  publicTripListSchema,
  publicTripResponseSchema,
  toBangkokInput,
  rideRequestResponseSchema,
  rideRequestListSchema,
  rideRequestContextSchema,
} from "@coago/contracts";
export type SmokeActor = { cookie: string; csrfToken: string };
export type SmokeRequest = (
  path: string,
  method: string,
  actor?: SmokeActor,
  body?: unknown,
  origin?: string,
) => Promise<{ status: number; json(): Promise<unknown> }>;
// Shared assertions run against real Workers HTTP/runtime and real PostgreSQL.
// Sessions belong to disposable synthetic accounts, never a real LINE identity.
export async function tripSmoke(
  request: SmokeRequest,
  a: SmokeActor,
  b: SmokeActor,
  c: SmokeActor,
) {
  const draft = {
    originProvince: "กรุงเทพมหานคร",
    destinationProvince: "เชียงใหม่",
    departureAt: new Date(Date.now() + 86400000).toISOString(),
    pickupPoint: "จุดนัดรับสำหรับทดสอบ",
    dropoffPoint: "จุดส่งสำหรับทดสอบ",
    seats: 3,
    vehicleModel: "Test vehicle",
    vehicleColor: "ขาว",
    contributionSatang: 10025,
    luggageNotes: "",
    conditions: "ข้อมูลอัตโนมัติสำหรับทดสอบเท่านั้น",
  };
  const create = { ...draft, requestId: crypto.randomUUID() };
  assert.equal((await request("/api/trips/mine", "GET")).status, 401);
  assert.equal(
    (await request("/api/trips", "POST", a, create, "https://invalid.example"))
      .status,
    403,
  );
  const first = await request("/api/trips", "POST", a, create);
  assert.equal(first.status, 201, "TRIP_CREATE_HTTP_FAILED");
  const { trip } = tripResponseSchema.parse(await first.json());
  assert.equal(trip.version, 1);
  assert.equal(trip.contributionSatang, 10025);
  const filters = new URLSearchParams({
    originProvince: draft.originProvince,
    destinationProvince: draft.destinationProvince,
    date: toBangkokInput(trip.departureAt).slice(0, 10),
  });
  const publicPath = `/api/discovery/trips?${filters}`;
  const upcomingResponse = await request(
    "/api/discovery/trips/upcoming",
    "GET",
  );
  assert.equal(upcomingResponse.status, 200);
  const upcoming = publicTripListSchema.parse(await upcomingResponse.json());
  assert(upcoming.trips.length <= 6);
  assert.equal(upcoming.nextCursor, null);
  for (let i = 1; i < upcoming.trips.length; i++)
    assert(
      `${upcoming.trips[i - 1].departureAt}:${upcoming.trips[i - 1].id}` <=
        `${upcoming.trips[i].departureAt}:${upcoming.trips[i].id}`,
    );
  console.log(
    "PASS public upcoming header list HTTP: anonymous, bounded six and ordered",
  );
  const listed = await request(publicPath, "GET");
  assert.equal(listed.status, 200, "PUBLIC_SEARCH_HTTP_FAILED");
  const publicList = publicTripListSchema.parse(await listed.json());
  // Real user trips can coexist on staging; inspect only our synthetic record.
  let publicTrip = publicList.trips.find((t) => t.id === trip.id),
    next = publicList.nextCursor;
  while (!publicTrip && next) {
    const response = await request(
      `${publicPath}&cursor=${encodeURIComponent(next)}`,
      "GET",
    );
    assert.equal(response.status, 200);
    const page = publicTripListSchema.parse(await response.json());
    publicTrip = page.trips.find((t) => t.id === trip.id);
    next = page.nextCursor;
  }
  assert(publicTrip, "SYNTHETIC_TRIP_NOT_DISCOVERABLE");
  assert.equal(publicTrip.seats, 3);
  const detailResponse = await request(
    `/api/discovery/trips/${trip.id}`,
    "GET",
  );
  assert.equal(detailResponse.status, 200);
  const publicDetail = publicTripResponseSchema.parse(
    await detailResponse.json(),
  ).trip;
  assert.equal(publicDetail.pickupPoint, draft.pickupPoint);
  for (const key of [
    "ownerId",
    "requestId",
    "payloadHash",
    "csrfToken",
    "version",
    "cancellationReason",
    "displayName",
    "subject",
  ])
    assert(!(key in publicDetail));

  const replay = await request("/api/trips", "POST", a, create);
  assert.equal(replay.status, 200);
  assert.equal(tripResponseSchema.parse(await replay.json()).trip.id, trip.id);
  const own = await request("/api/trips/mine", "GET", a);
  assert.equal(own.status, 200);
  assert.equal(
    tripListSchema.parse(await own.json()).trips.filter((t) => t.id === trip.id)
      .length,
    1,
  );
  const other = await request("/api/trips/mine", "GET", b);
  assert.equal(other.status, 200);
  assert.equal(tripListSchema.parse(await other.json()).trips.length, 0);
  const update = { ...draft, seats: 2, version: 1 };
  assert.equal(
    (await request(`/api/trips/${trip.id}`, "PUT", b, update)).status,
    404,
  );
  assert.equal(
    (
      await request(`/api/trips/${trip.id}/cancel`, "POST", b, {
        version: 1,
        reason: "ทดสอบสิทธิ์",
      })
    ).status,
    404,
  );
  const changed = await request(`/api/trips/${trip.id}`, "PUT", a, update);
  assert.equal(changed.status, 200);
  const edited = tripResponseSchema.parse(await changed.json()).trip;
  assert.equal(edited.version, 2);
  assert.equal(edited.seats, 2);
  const updatedPublic = await request(`/api/discovery/trips/${trip.id}`, "GET");
  assert.equal(updatedPublic.status, 200);
  assert.equal(
    publicTripResponseSchema.parse(await updatedPublic.json()).trip.seats,
    2,
  );
  assert.equal(
    (await request(`/api/trips/${trip.id}`, "PUT", a, update)).status,
    409,
  );

  assert.equal((await request("/api/ride-requests/mine", "GET")).status, 401);
  const rideInput = { tripId: trip.id, requestId: crypto.randomUUID() };
  assert.equal(
    (await request("/api/ride-requests", "POST", a, rideInput)).status,
    409,
  );
  assert.equal(
    (
      await request(
        "/api/ride-requests",
        "POST",
        b,
        rideInput,
        "https://invalid.example",
      )
    ).status,
    403,
  );
  const rideCreated = await request("/api/ride-requests", "POST", b, rideInput);
  assert.equal(rideCreated.status, 201);
  const ride = rideRequestResponseSchema.parse(
    await rideCreated.json(),
  ).request;
  assert.equal(ride.seatsRequested, 1);
  assert.equal(ride.status, "pending");
  const rideReplay = await request("/api/ride-requests", "POST", b, rideInput);
  assert.equal(rideReplay.status, 200);
  assert.equal(
    rideRequestResponseSchema.parse(await rideReplay.json()).request.id,
    ride.id,
  );
  assert.equal(
    (
      await request("/api/ride-requests", "POST", b, {
        tripId: trip.id,
        requestId: crypto.randomUUID(),
      })
    ).status,
    409,
  );
  const inbox = await request("/api/ride-requests/incoming", "GET", a);
  assert.equal(inbox.status, 200);
  assert(
    rideRequestListSchema
      .parse(await inbox.json())
      .requests.some((r) => r.id === ride.id),
  );
  const passengerRequests = await request("/api/ride-requests/mine", "GET", b);
  assert.equal(passengerRequests.status, 200);
  assert(
    rideRequestListSchema
      .parse(await passengerRequests.json())
      .requests.some((r) => r.id === ride.id),
  );
  const context = await request(
    `/api/ride-requests/for-trip/${trip.id}`,
    "GET",
    b,
  );
  assert.equal(context.status, 200);
  assert.equal(
    rideRequestContextSchema.parse(await context.json()).canRequest,
    false,
  );
  assert.equal(
    (await request(`/api/ride-requests/${ride.id}/cancel`, "POST", a, {}))
      .status,
    404,
  );
  const cancelledRequest = await request(
    `/api/ride-requests/${ride.id}/cancel`,
    "POST",
    b,
    {},
  );
  assert.equal(cancelledRequest.status, 200);
  assert.equal(
    rideRequestResponseSchema.parse(await cancelledRequest.json()).request
      .status,
    "cancelled",
  );
  assert.equal(
    (await request(`/api/ride-requests/${ride.id}/cancel`, "POST", b, {}))
      .status,
    200,
  );
  const rideAgain = await request("/api/ride-requests", "POST", b, {
    tripId: trip.id,
    requestId: crypto.randomUUID(),
  });
  assert.equal(rideAgain.status, 201);
  const seatsAfter = await request(`/api/discovery/trips/${trip.id}`, "GET");
  assert.equal(
    publicTripResponseSchema.parse(await seatsAfter.json()).trip.seats,
    2,
  );
  console.log(
    "PASS ride requests HTTP: authenticated one-seat request/replay, duplicates/own-trip/CSRF guards, private lists/context, cancellation/resubmit and unchanged seats",
  );

  const latestRide = rideRequestResponseSchema.parse(
    await rideAgain.json(),
  ).request;
  assert.equal(
    (
      await request(`/api/ride-requests/${latestRide.id}/decision`, "POST", b, {
        decision: "accept",
      })
    ).status,
    404,
  );
  const decided = await request(
    `/api/ride-requests/${latestRide.id}/decision`,
    "POST",
    a,
    { decision: "accept" },
  );
  assert.equal(decided.status, 200);
  const acceptedRide = rideRequestResponseSchema.parse(
    await decided.json(),
  ).request;
  assert.equal(acceptedRide.status, "accepted");
  assert(acceptedRide.decidedAt);
  assert.equal(acceptedRide.offeredTrip.pickupPoint, draft.pickupPoint);
  assert.equal(
    (
      await request(`/api/ride-requests/${latestRide.id}/decision`, "POST", a, {
        decision: "accept",
      })
    ).status,
    200,
  );
  let availability = await request(`/api/discovery/trips/${trip.id}`, "GET");
  assert.equal(
    publicTripResponseSchema.parse(await availability.json()).trip.seats,
    1,
  );
  assert.equal(
    (
      await request(`/api/trips/${trip.id}`, "PUT", a, {
        ...update,
        version: 2,
      })
    ).status,
    409,
  );
  assert.equal(
    (await request(`/api/ride-requests/${latestRide.id}/cancel`, "POST", b, {}))
      .status,
    200,
  );
  assert.equal(
    (await request(`/api/ride-requests/${latestRide.id}/cancel`, "POST", b, {}))
      .status,
    200,
  );
  availability = await request(`/api/discovery/trips/${trip.id}`, "GET");
  assert.equal(
    publicTripResponseSchema.parse(await availability.json()).trip.seats,
    2,
  );
  const rejectCreated = await request("/api/ride-requests", "POST", b, {
    tripId: trip.id,
    requestId: crypto.randomUUID(),
  });
  assert.equal(rejectCreated.status, 201);
  const rejectedId = rideRequestResponseSchema.parse(await rejectCreated.json())
    .request.id;
  const rejectedResponse = await request(
    `/api/ride-requests/${rejectedId}/decision`,
    "POST",
    a,
    { decision: "reject", reason: "Smoke rejection" },
  );
  assert.equal(rejectedResponse.status, 200);
  assert.equal(
    rideRequestResponseSchema.parse(await rejectedResponse.json()).request
      .status,
    "rejected",
  );
  assert.equal(
    (
      await request(`/api/ride-requests/${rejectedId}/decision`, "POST", a, {
        decision: "reject",
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await request(`/api/ride-requests/${rejectedId}/decision`, "POST", a, {
        decision: "accept",
      })
    ).status,
    409,
  );
  const finalRequest = await request("/api/ride-requests", "POST", b, {
    tripId: trip.id,
    requestId: crypto.randomUUID(),
  });
  assert.equal(finalRequest.status, 201);
  const finalRequestId = rideRequestResponseSchema.parse(
    await finalRequest.json(),
  ).request.id;
  assert.equal(
    (
      await request(
        `/api/ride-requests/${finalRequestId}/decision`,
        "POST",
        a,
        { decision: "accept" },
      )
    ).status,
    200,
  );

  // A second disposable trip exercises real concurrent HTTP requests for one final seat.
  const singleResponse = await request("/api/trips", "POST", a, {
    ...draft,
    seats: 1,
    requestId: crypto.randomUUID(),
  });
  assert.equal(singleResponse.status, 201);
  const single = tripResponseSchema.parse(await singleResponse.json()).trip;
  const contenderB = await request("/api/ride-requests", "POST", b, {
      tripId: single.id,
      requestId: crypto.randomUUID(),
    }),
    contenderC = await request("/api/ride-requests", "POST", c, {
      tripId: single.id,
      requestId: crypto.randomUUID(),
    });
  assert.equal(contenderB.status, 201);
  assert.equal(contenderC.status, 201);
  const rb = rideRequestResponseSchema.parse(await contenderB.json()).request,
    rc = rideRequestResponseSchema.parse(await contenderC.json()).request;
  const race = await Promise.all([
    request(`/api/ride-requests/${rb.id}/decision`, "POST", a, {
      decision: "accept",
    }),
    request(`/api/ride-requests/${rc.id}/decision`, "POST", a, {
      decision: "accept",
    }),
  ]);
  assert.deepEqual(race.map((r) => r.status).sort(), [200, 409]);
  const winning = rideRequestResponseSchema.parse(
      await race.find((r) => r.status === 200)!.json(),
    ).request,
    losing = winning.id === rb.id ? rc : rb,
    winningActor = winning.id === rb.id ? b : c;
  assert.equal(
    (await request(`/api/discovery/trips/${single.id}`, "GET")).status,
    404,
  );
  const repeatWins = await Promise.all([
    request(`/api/ride-requests/${winning.id}/decision`, "POST", a, {
      decision: "accept",
    }),
    request(`/api/ride-requests/${winning.id}/decision`, "POST", a, {
      decision: "accept",
    }),
  ]);
  assert(repeatWins.every((r) => r.status === 200));
  let ownedSeats = await request("/api/trips/mine", "GET", a);
  assert.equal(
    tripListSchema
      .parse(await ownedSeats.json())
      .trips.find((t) => t.id === single.id)!.bookedSeats,
    1,
  );
  const refunds = await Promise.all([
    request(
      `/api/ride-requests/${winning.id}/cancel`,
      "POST",
      winningActor,
      {},
    ),
    request(
      `/api/ride-requests/${winning.id}/cancel`,
      "POST",
      winningActor,
      {},
    ),
  ]);
  assert(refunds.every((r) => r.status === 200));
  ownedSeats = await request("/api/trips/mine", "GET", a);
  assert.equal(
    tripListSchema
      .parse(await ownedSeats.json())
      .trips.find((t) => t.id === single.id)!.bookedSeats,
    0,
  );
  const raceEdited = await request(`/api/trips/${single.id}`, "PUT", a, {
    ...draft,
    seats: 1,
    contributionSatang: 20000,
    version: 1,
  });
  assert.equal(raceEdited.status, 200);
  const stale = await request(
    `/api/ride-requests/${losing.id}/decision`,
    "POST",
    a,
    { decision: "accept" },
  );
  assert.equal(stale.status, 409);
  assert.equal(
    ((await stale.json()) as { error: string }).error,
    "trip_changed",
  );
  const noSeat = await request(
    `/api/ride-requests/${losing.id}/decision`,
    "POST",
    a,
    { decision: "reject", reason: "New terms require resubmission" },
  );
  assert.equal(noSeat.status, 200);
  assert.equal(
    rideRequestResponseSchema.parse(await noSeat.json()).request.offeredTrip
      .contributionSatang,
    10025,
  );
  assert.equal(
    (
      await request(`/api/trips/${single.id}/cancel`, "POST", a, {
        version: 2,
        reason: "Smoke cleanup",
      })
    ).status,
    200,
  );
  console.log(
    "PASS decisions HTTP: three actors, owner-only accept/reject, concurrent final seat, duplicate accept/refund, full-trip exclusion, stale snapshots, immutable offers and edit lock",
  );
  const cancellation = { version: 2, reason: "เสร็จสิ้นการทดสอบอัตโนมัติ" };
  const cancelled = await request(
    `/api/trips/${trip.id}/cancel`,
    "POST",
    a,
    cancellation,
  );
  assert.equal(cancelled.status, 200);
  const final = tripResponseSchema.parse(await cancelled.json()).trip;
  assert.equal(final.version, 3);
  assert.equal(final.status, "cancelled");
  assert.equal(final.cancellationReason, cancellation.reason);
  assert.equal(final.bookedSeats, 0);
  const requestHistory = await request("/api/ride-requests/mine", "GET", b);
  assert.equal(
    rideRequestListSchema
      .parse(await requestHistory.json())
      .requests.find((r) => r.id === finalRequestId)!.status,
    "cancelled",
  );
  assert.equal(
    (
      await request("/api/ride-requests", "POST", b, {
        tripId: trip.id,
        requestId: crypto.randomUUID(),
      })
    ).status,
    409,
  );
  assert.equal(
    (await request(`/api/discovery/trips/${trip.id}`, "GET")).status,
    404,
  );
  const afterCancellation = await request(publicPath, "GET");
  assert.equal(afterCancellation.status, 200);
  assert(
    !publicTripListSchema
      .parse(await afterCancellation.json())
      .trips.some((t) => t.id === trip.id),
  );
  console.log(
    "PASS anonymous discovery HTTP: route/Thai-date search, public projection, detail update visibility and cancelled detail/search exclusion",
  );
  const repeated = await request(
    `/api/trips/${trip.id}/cancel`,
    "POST",
    a,
    cancellation,
  );
  assert.equal(repeated.status, 200);
  assert.equal(tripResponseSchema.parse(await repeated.json()).trip.version, 3);
  assert.equal(
    (
      await request(`/api/trips/${trip.id}`, "PUT", a, {
        ...update,
        version: 3,
      })
    ).status,
    409,
  );
}

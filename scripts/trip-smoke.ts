import assert from "node:assert/strict";
import {
  tripResponseSchema,
  tripListSchema,
  publicTripListSchema,
  publicTripResponseSchema,
  toBangkokInput,
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

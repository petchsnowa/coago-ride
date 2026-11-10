import assert from "node:assert/strict";
import { tripResponseSchema, tripListSchema } from "@coago/contracts";
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

import { requestStatusLabel } from "../apps/web/src/rideRequestsApi";
import { beforeEach, expect, it, vi } from "vitest";
import { createApp } from "../apps/api/src/index";
import { postgresAuthStore } from "../apps/api/src/auth/store";
import {
  RideRequestError,
  type RideRequestStore,
} from "../apps/api/src/requests/store";
import { createRideRequestSchema, rideRequestSchema } from "@coago/contracts";
const actor = "123e4567-e89b-42d3-a456-426614174000",
  id = "123e4567-e89b-42d3-a456-426614174001",
  tripId = "123e4567-e89b-42d3-a456-426614174002",
  requestId = "123e4567-e89b-42d3-a456-426614174003",
  now = new Date("2030-01-01T00:00:00Z");
const request = rideRequestSchema.parse({
  id,
  status: "pending",
  seatsRequested: 1,
  passengerName: "Tester",
  tripChanged: false,
  createdAt: now.toISOString(),
  updatedAt: now.toISOString(),
  trip: {
    id: tripId,
    status: "active",
    originProvince: "กรุงเทพมหานคร",
    destinationProvince: "เชียงใหม่",
    departureAt: "2030-01-02T00:00:00.000Z",
    seats: 3,
    vehicleModel: "Test",
    vehicleColor: "White",
    contributionSatang: 10025,
  },
});
const env = {
  ENVIRONMENT: "test",
  DATABASE_URL: "test",
  APP_ORIGIN: "https://coago.test",
  LINE_CHANNEL_ID: "123456",
  LINE_CHANNEL_SECRET: "test",
  LINE_CALLBACK_URL: "https://coago.test/api/auth/line/callback",
};
const headers = {
  Cookie: `__Host-coago_session=${"a".repeat(64)}`,
  Origin: env.APP_ORIGIN,
  "X-CSRF-Token": "b".repeat(64),
  "Content-Type": "application/json",
};
let store: RideRequestStore,
  auth: ReturnType<typeof postgresAuthStore>,
  app: ReturnType<typeof createApp>;
beforeEach(() => {
  store = {
    create: vi.fn().mockResolvedValue({ request, created: true }),
    cancel: vi.fn().mockResolvedValue({ ...request, status: "cancelled" }),
    list: vi.fn().mockResolvedValue({ requests: [request], nextCursor: null }),
    context: vi
      .fn()
      .mockResolvedValue({ isOwner: false, canRequest: true, request: null }),
  };
  auth = postgresAuthStore("unused");
  auth.getSession = vi.fn().mockResolvedValue({
    user: { id: actor, displayName: "Tester" },
    csrfToken: "b".repeat(64),
  });
  app = createApp(
    undefined,
    { store: () => auth, now: () => now },
    {},
    {},
    { store: () => store },
  );
});
const call = (
  path: string,
  method = "GET",
  body?: unknown,
  custom: Record<string, string> = headers,
) =>
  app.request(
    `https://coago.test/api/ride-requests${path}`,
    {
      method,
      headers: custom,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    },
    env,
  );
it.each(["/mine", "/incoming", `/for-trip/${tripId}`])(
  "requires a session %s",
  async (path) => {
    expect((await call(path, "GET", undefined, {})).status).toBe(401);
    expect(store.list).not.toHaveBeenCalled();
  },
);
it("rejects revoked session", async () => {
  vi.mocked(auth.getSession).mockResolvedValue(undefined);
  expect((await call("/mine")).status).toBe(401);
});
it.each([
  { ...headers, Origin: "https://evil.example" },
  { ...headers, "X-CSRF-Token": "wrong" },
])("checks Origin and CSRF on writes", async (custom) => {
  expect((await call("", "POST", { tripId, requestId }, custom)).status).toBe(
    403,
  );
  expect(store.create).not.toHaveBeenCalled();
});
it("creates only for the session actor and handles a replay", async () => {
  let response = await call("", "POST", { tripId, requestId });
  expect(response.status).toBe(201);
  expect(store.create).toHaveBeenCalledWith(actor, { tripId, requestId }, now);
  vi.mocked(store.create).mockResolvedValue({ request, created: false });
  response = await call("", "POST", { tripId, requestId });
  expect(response.status).toBe(200);
});
it.each([
  { tripId, requestId, passengerId: actor },
  { tripId, requestId, seatsRequested: 2 },
  { tripId: "bad", requestId },
  { tripId },
])("rejects forged or incomplete request %j", async (body) => {
  expect(createRideRequestSchema.safeParse(body).success).toBe(false);
  expect((await call("", "POST", body)).status).toBe(400);
  expect(store.create).not.toHaveBeenCalled();
});
it("requires JSON and bounds body size", async () => {
  expect(
    (
      await call(
        "",
        "POST",
        { tripId, requestId },
        { ...headers, "Content-Type": "text/plain" },
      )
    ).status,
  ).toBe(415);
  expect(
    (await call("", "POST", { tripId, requestId, padding: "x".repeat(5000) }))
      .status,
  ).toBe(413);
});
it("cancels only for the actor with an empty body", async () => {
  expect((await call(`/${id}/cancel`, "POST", {})).status).toBe(200);
  expect(store.cancel).toHaveBeenCalledWith(actor, id, now);
  expect(
    (await call(`/${id}/cancel`, "POST", { passengerId: actor })).status,
  ).toBe(400);
});
it.each(["mine", "incoming"])(
  "filters %s by session and prevents caching",
  async (kind) => {
    const response = await call(`/${kind}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(store.list).toHaveBeenCalledWith(actor, kind, undefined);
  },
);
it("rejects invalid cursor and exposes no foreign context", async () => {
  expect((await call("/mine?cursor=!!!")).status).toBe(400);
  expect((await call("/mine?ownerId=other")).status).toBe(400);
  expect((await call(`/for-trip/${tripId}`)).status).toBe(200);
  expect(store.context).toHaveBeenCalledWith(actor, tripId, now);
  expect((await call("/for-trip/bad")).status).toBe(400);
});
it.each([
  "own_trip",
  "trip_unavailable",
  "already_requested",
  "request_reused",
] as const)("reports domain conflict %s", async (code) => {
  vi.mocked(store.create).mockRejectedValue(new RideRequestError(code));
  const response = await call("", "POST", { tripId, requestId });
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: code });
});
it("returns 404 for unauthorized ids and generic DB failures", async () => {
  vi.mocked(store.cancel).mockRejectedValue(
    new RideRequestError("request_not_found"),
  );
  expect((await call(`/${id}/cancel`, "POST", {})).status).toBe(404);
  vi.mocked(store.list).mockRejectedValue(
    new Error("private database password"),
  );
  const response = await call("/mine");
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "service_unavailable" });
});
it("rejects accidental private fields at response boundary", () => {
  expect(
    rideRequestSchema.safeParse({ ...request, passengerId: actor }).success,
  ).toBe(false);
});

it("pending history displays unavailable when the trip closes or departs", () => {
  expect(requestStatusLabel(request, now.getTime())).toBe("รอตอบรับ");
  expect(
    requestStatusLabel({ ...request, status: "cancelled" }, now.getTime()),
  ).toBe("ยกเลิกคำขอแล้ว");
  expect(
    requestStatusLabel(
      { ...request, trip: { ...request.trip, status: "cancelled" } },
      now.getTime(),
    ),
  ).toBe("เที่ยวยกเลิกแล้ว");
  expect(
    requestStatusLabel(request, Date.parse(request.trip.departureAt)),
  ).toBe("เที่ยวออกเดินทางแล้ว");
});

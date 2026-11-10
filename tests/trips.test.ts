import { beforeEach, expect, it, vi } from "vitest";
import { createApp } from "../apps/api/src/index";
import { postgresAuthStore } from "../apps/api/src/auth/store";
import { TripError, type TripStore } from "../apps/api/src/trips/store";
import {
  tripDraftSchema,
  createTripSchema,
  provinces,
  fromBangkokInput,
  toBangkokInput,
  bahtToSatang,
  satangToBaht,
  type Trip,
} from "@coago/contracts";
const owner = "123e4567-e89b-42d3-a456-426614174000",
  id = "123e4567-e89b-42d3-a456-426614174001",
  requestId = "123e4567-e89b-42d3-a456-426614174002";
const now = new Date("2030-01-01T00:00:00Z");
export const draft = tripDraftSchema.parse({
  originProvince: "กรุงเทพมหานคร",
  destinationProvince: "เชียงใหม่",
  departureAt: "2030-01-02T03:30:00Z",
  pickupPoint: "สถานีขนส่ง",
  dropoffPoint: "สถานีปลายทาง",
  seats: 2,
  vehicleModel: "Toyota Corolla",
  vehicleColor: "ขาว",
  contributionSatang: 10025,
});
const trip: Trip = {
  bookedSeats: 0,
  ...draft,
  id,
  version: 1,
  status: "active",
  cancellationReason: null,
  createdAt: now.toISOString(),
  updatedAt: now.toISOString(),
};
const env = {
  ENVIRONMENT: "test",
  DATABASE_URL: "test",
  APP_ORIGIN: "https://coago.test",
  LINE_CHANNEL_ID: "123456",
  LINE_CHANNEL_SECRET: "test-only",
  LINE_CALLBACK_URL: "https://coago.test/api/auth/line/callback",
};
const headers = {
  Cookie: `__Host-coago_session=${"a".repeat(64)}`,
  Origin: "https://coago.test",
  "X-CSRF-Token": "b".repeat(64),
  "Content-Type": "application/json",
};
let store: TripStore,
  auth: ReturnType<typeof postgresAuthStore>,
  app: ReturnType<typeof createApp>;
beforeEach(() => {
  store = {
    list: vi.fn().mockResolvedValue({ trips: [trip], nextCursor: null }),
    create: vi.fn().mockResolvedValue({ trip, created: true }),
    update: vi.fn().mockResolvedValue({ ...trip, version: 2 }),
    cancel: vi.fn().mockResolvedValue({
      ...trip,
      version: 2,
      status: "cancelled",
      cancellationReason: "ยกเลิกการทดสอบ",
    }),
  };
  auth = {
    ...postgresAuthStore("unused"),
    getSession: vi.fn().mockResolvedValue({
      user: { id: owner, displayName: "Test" },
      csrfToken: "b".repeat(64),
    }),
  };
  app = createApp(
    async () => {},
    { store: () => auth, now: () => now },
    { store: () => store },
  );
});
it("has 77 distinct Thai provinces", () => {
  expect(provinces).toHaveLength(77);
  expect(new Set(provinces).size).toBe(77);
});
it("converts Bangkok local input regardless of host timezone", () => {
  expect(fromBangkokInput("2030-01-02T10:30")).toBe("2030-01-02T03:30:00.000Z");
  expect(toBangkokInput("2030-01-02T03:30:00Z")).toBe("2030-01-02T10:30");
  expect(fromBangkokInput("2030-02-31T10:30")).toBe("");
});
it("uses exact integer satang without floating point rounding", () => {
  expect(bahtToSatang("100.25")).toBe(10025);
  expect(bahtToSatang("0.10")).toBe(10);
  expect(satangToBaht(12345)).toBe("123.45");
  for (const input of ["1e3", "-1", "10.123", ""])
    expect(Number.isNaN(bahtToSatang(input))).toBe(true);
});
it.each([
  { seats: 0 },
  { seats: 1.5 },
  { seats: 9 },
  { contributionSatang: -1 },
  { contributionSatang: 1.25 },
  { originProvince: "unknown" },
  { destinationProvince: "กรุงเทพมหานคร" },
  { pickupPoint: "   " },
  { departureAt: "invalid" },
])("rejects invalid draft %j", (bad) =>
  expect(tripDraftSchema.safeParse({ ...draft, ...bad }).success).toBe(false),
);
it("rejects client-supplied ownership or status", () => {
  expect(
    createTripSchema.safeParse({ ...draft, requestId, ownerId: owner }).success,
  ).toBe(false);
  expect(
    createTripSchema.safeParse({ ...draft, requestId, status: "cancelled" })
      .success,
  ).toBe(false);
});
it("requires a real session before listing or writing", async () => {
  expect((await app.request("/api/trips/mine", {}, env)).status).toBe(401);
  vi.mocked(auth.getSession).mockResolvedValue(undefined);
  expect((await app.request("/api/trips/mine", { headers }, env)).status).toBe(
    401,
  );
  expect(store.list).not.toHaveBeenCalled();
});
it("lists only the owner from the server-side session", async () => {
  const r = await app.request("/api/trips/mine", { headers }, env);
  expect(r.status).toBe(200);
  expect(store.list).toHaveBeenCalledWith(owner, undefined);
  expect((await r.json()).trips[0]).not.toHaveProperty("ownerId");
});
it.each([
  { ...headers, Origin: "https://evil.test" },
  { ...headers, "X-CSRF-Token": "wrong" },
])("rejects cross-origin or missing CSRF write", async (badHeaders) => {
  const r = await app.request(
    "/api/trips",
    {
      method: "POST",
      headers: badHeaders,
      body: JSON.stringify({ ...draft, requestId }),
    },
    env,
  );
  expect(r.status).toBe(403);
  expect(store.create).not.toHaveBeenCalled();
});
it("creates with inferred owner and distinguishes idempotent replay", async () => {
  const make = () =>
    app.request(
      "/api/trips",
      {
        method: "POST",
        headers,
        body: JSON.stringify({ ...draft, requestId }),
      },
      env,
    );
  expect((await make()).status).toBe(201);
  expect(store.create).toHaveBeenCalledWith(
    owner,
    expect.objectContaining({ requestId }),
    now,
  );
  vi.mocked(store.create).mockResolvedValue({ trip, created: false });
  expect((await make()).status).toBe(200);
});
it("rejects forged ownership in JSON before store mutation", async () => {
  const r = await app.request(
    "/api/trips",
    {
      method: "POST",
      headers,
      body: JSON.stringify({ ...draft, requestId, ownerId: "other" }),
    },
    env,
  );
  expect(r.status).toBe(400);
  expect(store.create).not.toHaveBeenCalled();
});
it("handles invalid JSON, non-JSON and oversized bodies without leaking details", async () => {
  expect(
    (
      await app.request(
        "/api/trips",
        { method: "POST", headers, body: "{" },
        env,
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await app.request(
        "/api/trips",
        {
          method: "POST",
          headers: { ...headers, "Content-Type": "text/plain" },
          body: "text",
        },
        env,
      )
    ).status,
  ).toBe(415);
  expect(
    (
      await app.request(
        "/api/trips",
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            ...draft,
            requestId,
            conditions: "x".repeat(17000),
          }),
        },
        env,
      )
    ).status,
  ).toBe(413);
});
it("rejects malformed cursor and UUID", async () => {
  expect(
    (await app.request("/api/trips/mine?cursor=invalid", { headers }, env))
      .status,
  ).toBe(400);
  expect(
    (
      await app.request(
        "/api/trips/not-a-uuid",
        {
          method: "PUT",
          headers,
          body: JSON.stringify({ ...draft, version: 1 }),
        },
        env,
      )
    ).status,
  ).toBe(400);
});
it("returns 404 for another owners trip and 409 for stale versions", async () => {
  vi.mocked(store.update).mockRejectedValue(new TripError("trip_not_found"));
  const request = () =>
    app.request(
      `/api/trips/${id}`,
      {
        method: "PUT",
        headers,
        body: JSON.stringify({ ...draft, version: 1 }),
      },
      env,
    );
  expect((await request()).status).toBe(404);
  vi.mocked(store.update).mockRejectedValue(new TripError("trip_conflict"));
  expect((await request()).status).toBe(409);
});
it("requires cancellation reason and passes owner/version to store", async () => {
  const request = (reason: string) =>
    app.request(
      `/api/trips/${id}/cancel`,
      { method: "POST", headers, body: JSON.stringify({ version: 1, reason }) },
      env,
    );
  expect((await request(" ")).status).toBe(400);
  expect((await request("ยกเลิกการทดสอบ")).status).toBe(200);
  expect(store.cancel).toHaveBeenCalledWith(
    owner,
    id,
    { version: 1, reason: "ยกเลิกการทดสอบ" },
    now,
  );
});
it("does not expose raw database errors", async () => {
  vi.mocked(store.list).mockRejectedValue(
    new Error("postgres://private:password@host"),
  );
  const r = await app.request("/api/trips/mine", { headers }, env);
  expect(r.status).toBe(503);
  expect(await r.json()).toEqual({ error: "service_unavailable" });
});

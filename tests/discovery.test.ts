import {
  encodeDiscoveryCursor,
  decodeDiscoveryCursor,
} from "../apps/api/src/discovery/cursor";
import { beforeEach, expect, it, vi } from "vitest";
import { createApp } from "../apps/api/src/index";
import {
  tripSearchSchema,
  bangkokDayRange,
  publicTripSummarySchema,
  publicTripDetailSchema,
  type PublicTripDetail,
} from "@coago/contracts";
import type { DiscoveryStore } from "../apps/api/src/discovery/store";
const id = "123e4567-e89b-42d3-a456-426614174001",
  now = new Date("2030-01-01T00:00:00Z");
const input = tripSearchSchema.parse({
  originProvince: "กรุงเทพมหานคร",
  destinationProvince: "เชียงใหม่",
  date: "2030-01-02",
});
const detail: PublicTripDetail = {
  id,
  originProvince: input.originProvince,
  destinationProvince: input.destinationProvince,
  departureAt: "2030-01-02T03:30:00.000Z",
  seats: 2,
  vehicleModel: "Test car",
  vehicleColor: "White",
  contributionSatang: 10025,
  pickupPoint: "Station A",
  dropoffPoint: "Station B",
  luggageNotes: "",
  conditions: "",
};
const {
  pickupPoint: _a,
  dropoffPoint: _b,
  luggageNotes: _c,
  conditions: _d,
  ...summary
} = detail;
void [_a, _b, _c, _d];
const env = { ENVIRONMENT: "test", DATABASE_URL: "test-only" };
let store: DiscoveryStore, app: ReturnType<typeof createApp>;
beforeEach(() => {
  store = {
    search: vi.fn().mockResolvedValue({ trips: [summary], nextCursor: null }),
    detail: vi.fn().mockResolvedValue(detail),
  };
  app = createApp(undefined, {}, {}, { store: () => store, now: () => now });
});
const url = (extra = "") =>
  `https://coago.test/api/discovery/trips?${new URLSearchParams(input)}${extra}`;
it("Thai day includes previous UTC evening and excludes the next Thai midnight", () => {
  const { start, end } = bangkokDayRange(input.date);
  expect(start.toISOString()).toBe("2030-01-01T17:00:00.000Z");
  expect(end.toISOString()).toBe("2030-01-02T17:00:00.000Z");
});
it.each([
  "2030-02-29",
  "2030-02-30",
  "2030-13-01",
  "2030-01-00",
  "2030-1-2",
  "",
  "9999-01-01",
])("rejects invalid date %s", (date) =>
  expect(tripSearchSchema.safeParse({ ...input, date }).success).toBe(false),
);
it("accepts leap day and rejects same province", () => {
  expect(
    tripSearchSchema.safeParse({ ...input, date: "2032-02-29" }).success,
  ).toBe(true);
  expect(
    tripSearchSchema.safeParse({
      ...input,
      destinationProvince: input.originProvince,
    }).success,
  ).toBe(false);
});
it("search works anonymously without loading an auth store and returns only summary fields", async () => {
  const response = await app.request(url(), {}, env);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({ trips: [summary], nextCursor: null });
  expect(store.search).toHaveBeenCalledWith(input, now, undefined);
});
it("details work anonymously without LINE configuration", async () => {
  const response = await app.request(
    `https://coago.test/api/discovery/trips/${id}`,
    {},
    env,
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ trip: detail });
  expect(store.detail).toHaveBeenCalledWith(id, now);
});
it.each([
  "",
  "?date=2030-01-02",
  "?originProvince=unknown&destinationProvince=เชียงใหม่&date=2030-01-02",
])("missing or invalid filters return 400 %s", async (query) => {
  expect(
    (
      await app.request(
        `https://coago.test/api/discovery/trips${query}`,
        {},
        env,
      )
    ).status,
  ).toBe(400);
  expect(store.search).not.toHaveBeenCalled();
});
it.each([
  "&limit=1000",
  "&date=2030-01-03",
  "&ownerId=test",
  "&cursor=",
  "&cursor=!!!!",
  "&cursor=" + "a".repeat(601),
])("rejects extra, duplicate or malformed query %s", async (extra) => {
  expect((await app.request(url(extra), {}, env)).status).toBe(400);
  expect(store.search).not.toHaveBeenCalled();
});
it("cursor must match the original route and travel date", async () => {
  const cursor = { ...input, departureAt: detail.departureAt, id };
  const encode = encodeDiscoveryCursor;
  expect(decodeDiscoveryCursor(encode(cursor))).toEqual(cursor);
  expect(
    (await app.request(url(`&cursor=${encode(cursor)}`), {}, env)).status,
  ).toBe(200);
  expect(store.search).toHaveBeenLastCalledWith(input, now, cursor);
  expect(
    (
      await app.request(
        url(`&cursor=${encode({ ...cursor, date: "2030-01-03" })}`),
        {},
        env,
      )
    ).status,
  ).toBe(400);
});
it("bad id returns 400 and unavailable/cancelled/missing trip returns identical 404", async () => {
  expect(
    (
      await app.request(
        "https://coago.test/api/discovery/trips/not-uuid",
        {},
        env,
      )
    ).status,
  ).toBe(400);
  vi.mocked(store.detail).mockResolvedValue(undefined);
  const response = await app.request(
    `https://coago.test/api/discovery/trips/${id}`,
    {},
    env,
  );
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: "trip_not_found" });
});
it("empty search is a successful response", async () => {
  vi.mocked(store.search).mockResolvedValue({ trips: [], nextCursor: null });
  const response = await app.request(url(), {}, env);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ trips: [], nextCursor: null });
});
it("internal failures and malformed store responses never expose private fields", async () => {
  vi.mocked(store.search).mockRejectedValueOnce(
    new Error("secret-database-password"),
  );
  let response = await app.request(url(), {}, env);
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain("password");
  vi.mocked(store.detail).mockResolvedValue({
    ...detail,
    ownerId: "private-user",
    requestId: id,
    payloadHash: "private-hash",
  } as PublicTripDetail);
  response = await app.request(
    `https://coago.test/api/discovery/trips/${id}`,
    {},
    env,
  );
  expect(response.status).toBe(503);
  expect(await response.text()).toBe('{"error":"service_unavailable"}');
});
it.each([
  "ownerId",
  "requestId",
  "payloadHash",
  "csrfToken",
  "version",
  "cancellationReason",
  "displayName",
  "subject",
  "phone",
  "lineId",
  "licensePlate",
])("public schemas reject internal/contact field %s", (key) => {
  expect(
    publicTripSummarySchema.safeParse({ ...summary, [key]: "private" }).success,
  ).toBe(false);
  expect(
    publicTripDetailSchema.safeParse({ ...detail, [key]: "private" }).success,
  ).toBe(false);
});

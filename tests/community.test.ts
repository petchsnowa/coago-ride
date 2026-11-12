import { describe, it, expect, vi } from "vitest";
import {
  wantedDraftSchema,
  driverLicenseInputSchema,
  bangkokDate,
  journeyActionSchema,
} from "@coago/contracts";
import {
  messagingReady,
  remainingQuota,
  pushNotification,
} from "../apps/api/src/notifications/provider";
import { dispatchNotification } from "../apps/api/src/notifications/dispatch";
const wanted = {
  originProvince: "กรุงเทพมหานคร",
  destinationProvince: "ขอนแก่น",
  departureFrom: "2030-01-01T03:00:00Z",
  departureUntil: "2030-01-01T05:00:00Z",
  seats: 2,
  budgetSatang: 30000,
};
describe("community input boundaries", () => {
  it("rejects reversed/long windows, same province, fractional money and extra identity fields", () => {
    expect(wantedDraftSchema.safeParse(wanted).success).toBe(true);
    for (const patch of [
      { departureUntil: "2029-12-31T00:00:00Z" },
      { departureUntil: "2030-01-03T00:00:00Z" },
      { destinationProvince: wanted.originProvince },
      { budgetSatang: 12.5 },
      { phone: "private" },
      { seats: 9 },
    ])
      expect(wantedDraftSchema.safeParse({ ...wanted, ...patch }).success).toBe(
        false,
      );
  });
  it("validates real calendar dates and Bangkok expiry boundary", () => {
    const license = {
      licenseNumber: "SYNTHETIC-12345",
      licenseClass: "private_car",
      country: "TH",
      expiresOn: "2030-02-28",
      photoId: crypto.randomUUID(),
      consentVersion: "2026-11-11",
      version: 0,
    };
    expect(driverLicenseInputSchema.safeParse(license).success).toBe(true);
    expect(
      driverLicenseInputSchema.safeParse({
        ...license,
        expiresOn: "2030-02-30",
      }).success,
    ).toBe(false);
    expect(bangkokDate("2030-01-01T17:00:00Z")).toBe("2030-01-02");
  });
  it("rejects GPS payloads and fabricated journey stages", () => {
    const action = {
      requestId: crypto.randomUUID(),
      version: 0,
      status: "ready",
      issue: false,
      note: "",
    };
    expect(journeyActionSchema.safeParse(action).success).toBe(true);
    expect(
      journeyActionSchema.safeParse({ ...action, lat: 13.7 }).success,
    ).toBe(false);
    expect(
      journeyActionSchema.safeParse({ ...action, status: "gps_verified" })
        .success,
    ).toBe(false);
  });
});
describe("LINE delivery is explicit and bounded", () => {
  it("does no HTTP or DB work while disabled or provider unconfirmed", async () => {
    const request = vi.fn();
    expect(await dispatchNotification({}, request)).toBe("disabled");
    expect(
      messagingReady({
        LINE_MESSAGING_ENABLED: "true",
        LINE_MESSAGING_CHANNEL_ACCESS_TOKEN: "synthetic",
        APP_ORIGIN: "https://coago.space",
      }),
    ).toBe(false);
    expect(request).not.toHaveBeenCalled();
  });
  it("requires a known finite quota and rejects unavailable quota", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ type: "limited", value: 200 }))
      .mockResolvedValueOnce(Response.json({ totalUsage: 199 }));
    expect(await remainingQuota("synthetic", request)).toBe(1);
    const unknown = vi
      .fn()
      .mockImplementation(async () =>
        Response.json({ type: "none", totalUsage: 0 }),
      );
    await expect(remainingQuota("synthetic", unknown)).rejects.toThrow(
      "LINE_QUOTA_UNCONFIRMED",
    );
  });
  it("keeps recipient, payload and retry key stable; never sends private documents", async () => {
    const request = vi
        .fn()
        .mockResolvedValue(new Response(null, { status: 200 })),
      key = crypto.randomUUID(),
      to = `U${"a".repeat(32)}`;
    expect(
      await pushNotification("synthetic", to, "journey_updated", key, request),
    ).toBe("sent");
    const [url, init] = request.mock.calls[0];
    expect(url).toBe("https://api.line.me/v2/bot/message/push");
    expect(init.headers["X-Line-Retry-Key"]).toBe(key);
    const body = JSON.parse(init.body);
    expect(body.to).toBe(to);
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].text).toContain("https://coago.space/#my-journeys");
    expect(
      await pushNotification("synthetic", to, "unknown", key, request),
    ).toBe("failed");
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("accepts authenticated retry acknowledgement and retries only network/5xx", async () => {
    const to = `U${"b".repeat(32)}`,
      key = crypto.randomUUID();
    for (const [response, result] of [
      [
        new Response(null, {
          status: 409,
          headers: { "x-line-accepted-request-id": "accepted" },
        }),
        "sent",
      ],
      [new Response(null, { status: 409 }), "failed"],
      [new Response(null, { status: 429 }), "failed"],
      [new Response(null, { status: 503 }), "retry"],
    ] as const)
      expect(
        await pushNotification(
          "synthetic",
          to,
          "request_created",
          key,
          vi.fn().mockResolvedValue(response),
        ),
      ).toBe(result);
    expect(
      await pushNotification(
        "synthetic",
        to,
        "request_created",
        key,
        vi.fn().mockRejectedValue(Error("timeout")),
      ),
    ).toBe("retry");
  });
});

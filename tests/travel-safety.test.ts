import { it, expect } from "vitest";
import {
  calculateTripCost,
  profileInputSchema,
  costInputSchema,
} from "@coago/contracts";
import {
  dataKey,
  seal,
  unseal,
  encode,
  decode,
} from "../apps/api/src/membership/crypto";
it("quotes fixed shares with precise satang and never reallocates missing passengers", () => {
  const input = {
    distanceKm: 100,
    fuelSatangPerKm: 300,
    operationsSatangPerKm: 100,
    extraSatang: 5000,
    shares: 3,
  };
  expect(calculateTripCost(input)).toEqual({
    fuelSatang: 30000,
    operationsSatang: 10000,
    totalSatang: 45000,
    shares: 3,
    pricePerSeatSatang: 15000,
  });
  expect(calculateTripCost({ ...input, shares: 2 }).pricePerSeatSatang).toBe(
    22500,
  );
  expect(
    calculateTripCost({
      ...input,
      distanceKm: 1,
      fuelSatangPerKm: 1,
      operationsSatangPerKm: 0,
      extraSatang: 0,
    }).pricePerSeatSatang,
  ).toBe(1);
});
it.each([
  { distanceKm: 0 },
  { shares: 0 },
  { shares: 1.5 },
  { fuelSatangPerKm: -1 },
  { distanceKm: Infinity },
])("rejects invalid cost inputs", (input) =>
  expect(
    costInputSchema.safeParse({
      distanceKm: 100,
      fuelSatangPerKm: 300,
      operationsSatangPerKm: 100,
      extraSatang: 0,
      shares: 2,
      ...input,
    }).success,
  ).toBe(false),
);
it("requires consent, owned evidence IDs at the contract and valid document format", () => {
  const valid = {
    fullName: "Synthetic Member",
    phone: "0800000000",
    documentKind: "passport",
    documentNumber: "TEST1234",
    country: "TH",
    portraitId: crypto.randomUUID(),
    documentId: crypto.randomUUID(),
    consentVersion: "2026-11-11",
    version: 0,
  };
  expect(profileInputSchema.safeParse(valid).success).toBe(true);
  expect(
    profileInputSchema.safeParse({ ...valid, consentVersion: "" }).success,
  ).toBe(false);
  expect(
    profileInputSchema.safeParse({
      ...valid,
      documentKind: "thai_id",
      documentNumber: "123",
    }).success,
  ).toBe(false);
});
it("encrypts documents with random nonces, binds ownership and detects tampering", async () => {
  const key = await dataKey(Buffer.alloc(32, 7).toString("base64")),
    value = { documentNumber: "TEST1234" },
    a = await seal(key, encode(value), "profile:owner"),
    b = await seal(key, encode(value), "profile:owner");
  expect(a).not.toContain("TEST1234");
  expect(a).not.toBe(b);
  expect(await decode(key, a, "profile:owner")).toEqual(value);
  await expect(unseal(key, a, "profile:other")).rejects.toThrow();
  await expect(
    unseal(key, a.slice(0, -3) + "AAA", "profile:owner"),
  ).rejects.toThrow();
  await expect(dataKey()).rejects.toThrow();
});
it("road distance claims require a signed matching unexpired quote", async () => {
  const { issueRoadProof, verifyRoadProof } =
    await import("../apps/api/src/membership/road-proof");
  const key = Buffer.alloc(32, 4).toString("base64"),
    origin = { lat: 13.7563, lng: 100.5018 },
    destination = { lat: 16.4419, lng: 102.835 },
    routeProof = await issueRoadProof(key, origin, destination, 100),
    safety = {
      vehicleId: crypto.randomUUID(),
      origin,
      destination,
      routeProof,
      distanceSource: "road" as const,
      cost: {
        distanceKm: 100,
        fuelSatangPerKm: 300,
        operationsSatangPerKm: 100,
        extraSatang: 0,
        shares: 2,
      },
    };
  expect(await verifyRoadProof(key, safety)).toBe(true);
  expect(
    await verifyRoadProof(key, {
      ...safety,
      cost: { ...safety.cost, distanceKm: 99 },
    }),
  ).toBe(false);
  expect(
    await verifyRoadProof(Buffer.alloc(32, 5).toString("base64"), safety),
  ).toBe(false);
  expect(await verifyRoadProof(key, { ...safety, routeProof: undefined })).toBe(
    false,
  );
});
it("rejects oversized image dimensions and disguised non-images before storage", async () => {
  const { validEvidenceImage } =
    await import("../apps/api/src/membership/image");
  const png = new Uint8Array(
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
      "base64",
    ),
  );
  expect(validEvidenceImage(png, "image/png")).toBe(true);
  expect(validEvidenceImage(png, "image/jpeg")).toBe(false);
  const huge = new Uint8Array(png);
  new DataView(huge.buffer).setUint32(16, 100000);
  expect(validEvidenceImage(huge, "image/png")).toBe(false);
  expect(
    validEvidenceImage(
      new TextEncoder().encode("<svg onload=alert(1)>"),
      "image/png",
    ),
  ).toBe(false);
});

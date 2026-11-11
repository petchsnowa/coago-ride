import { Buffer } from "node:buffer";
import type { TripDraft } from "@coago/contracts";
import { encode } from "./crypto";
async function signingKey(secret?: string) {
  if (!secret || Buffer.from(secret, "base64").length !== 32)
    throw Error("ROAD_PROOF_KEY_MISSING");
  const raw = await crypto.subtle.digest(
    "SHA-256",
    new Uint8Array(
      Buffer.concat([
        Buffer.from(secret, "base64"),
        Buffer.from("coago-road-proof-v1"),
      ]),
    ),
  );
  return crypto.subtle.importKey(
    "raw",
    raw,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}
export async function issueRoadProof(
  secret: string | undefined,
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
  distanceKm: number,
) {
  const body = encode({
      origin,
      destination,
      distanceKm,
      expiresAt: Date.now() + 15 * 60 * 1000,
    }),
    signature = await crypto.subtle.sign(
      "HMAC",
      await signingKey(secret),
      body,
    );
  return `${Buffer.from(body).toString("base64url")}.${Buffer.from(signature).toString("base64url")}`;
}
export async function verifyRoadProof(
  secret: string | undefined,
  safety: NonNullable<TripDraft["safety"]>,
) {
  try {
    const [body, signature] = safety.routeProof?.split(".") ?? [];
    if (!body || !signature || body.length > 1500) return false;
    const raw = new Uint8Array(Buffer.from(body, "base64url"));
    if (
      !(await crypto.subtle.verify(
        "HMAC",
        await signingKey(secret),
        new Uint8Array(Buffer.from(signature, "base64url")),
        raw,
      ))
    )
      return false;
    const data = JSON.parse(new TextDecoder().decode(raw));
    return (
      data.expiresAt > Date.now() &&
      data.distanceKm === safety.cost.distanceKm &&
      data.origin.lat === safety.origin.lat &&
      data.origin.lng === safety.origin.lng &&
      data.destination.lat === safety.destination.lat &&
      data.destination.lng === safety.destination.lng
    );
  } catch {
    return false;
  }
}

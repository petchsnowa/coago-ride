import { verifyRoadProof } from "./road-proof";
import { eq, and } from "drizzle-orm";
import { memberProfiles, vehicles } from "@coago/db";
import { calculateTripCost, type TripDraft } from "@coago/contracts";
import type { TripTransaction } from "../trips/store";
export class MembershipError extends Error {}
export async function approvedMember(tx: TripTransaction, user: string) {
  const [profile] = await tx
    .select()
    .from(memberProfiles)
    .where(eq(memberProfiles.userId, user))
    .for("share");
  if (profile?.status !== "approved")
    throw new MembershipError("member_verification_required");
}
export async function approvedTrip(
  tx: TripTransaction,
  user: string,
  input: TripDraft,
  key?: string,
) {
  await approvedMember(tx, user);
  if (!input.safety) throw new MembershipError("vehicle_and_route_required");
  if (
    input.safety.distanceSource === "road" &&
    !(await verifyRoadProof(key, input.safety))
  )
    throw new MembershipError("road_quote_expired");
  const [vehicle] = await tx
    .select()
    .from(vehicles)
    .where(
      and(eq(vehicles.id, input.safety.vehicleId), eq(vehicles.ownerId, user)),
    )
    .for("share");
  if (vehicle?.status !== "approved")
    throw new MembershipError("vehicle_verification_required");
  if (input.seats > vehicle.capacity)
    throw new MembershipError("vehicle_capacity_exceeded");
  if (input.safety.cost.shares < input.seats)
    throw new MembershipError("shares_below_offered_seats");
  if (input.safety.vehicleVersion !== vehicle.version)
    throw new MembershipError("vehicle_snapshot_mismatch");
  if (
    input.vehicleModel !== `${vehicle.brand} ${vehicle.model}` ||
    input.vehicleColor !== vehicle.color
  )
    throw new MembershipError("vehicle_snapshot_mismatch");
  if (
    calculateTripCost(input.safety.cost).pricePerSeatSatang !==
    input.contributionSatang
  )
    throw new MembershipError("cost_mismatch");
}

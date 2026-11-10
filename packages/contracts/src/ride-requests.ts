import { z } from "zod";
import { publicTripSummarySchema } from "./discovery";
export const createRideRequestSchema = z
  .object({ tripId: z.string().uuid(), requestId: z.string().uuid() })
  .strict();
export const rideRequestSchema = z
  .object({
    id: z.string().uuid(),
    status: z.enum(["pending", "cancelled"]),
    seatsRequested: z.literal(1),
    passengerName: z.string().min(1).max(256),
    tripChanged: z.boolean(),
    trip: publicTripSummarySchema
      .extend({ status: z.enum(["active", "cancelled"]) })
      .strict(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export const rideRequestResponseSchema = z
  .object({ request: rideRequestSchema })
  .strict();
export const rideRequestListSchema = z
  .object({
    requests: z.array(rideRequestSchema).max(20),
    nextCursor: z.string().max(300).nullable(),
  })
  .strict();
export const rideRequestContextSchema = z
  .object({
    isOwner: z.boolean(),
    canRequest: z.boolean(),
    request: rideRequestSchema.nullable(),
  })
  .strict();
export type CreateRideRequest = z.infer<typeof createRideRequestSchema>;
export type RideRequest = z.infer<typeof rideRequestSchema>;
export type RideRequestList = z.infer<typeof rideRequestListSchema>;
export type RideRequestContext = z.infer<typeof rideRequestContextSchema>;

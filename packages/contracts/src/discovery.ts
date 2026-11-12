import { pointSchema } from "./travel-cost";
import { z } from "zod";
import { provinces, tripSchema, fromBangkokInput } from "./trips";
export const travelDateSchema = z
  .string()
  .regex(/^20\d{2}-\d{2}-\d{2}$/, "กรุณาเลือกวันเดินทางให้ถูกต้อง")
  .refine(
    (value) => !!fromBangkokInput(`${value}T00:00`),
    "วันเดินทางไม่มีอยู่จริง",
  );
export const tripSearchSchema = z
  .object({
    originProvince: z.enum(provinces, { error: "กรุณาเลือกจังหวัดต้นทาง" }),
    destinationProvince: z.enum(provinces, {
      error: "กรุณาเลือกจังหวัดปลายทาง",
    }),
    date: travelDateSchema,
  })
  .strict()
  .refine((value) => value.originProvince !== value.destinationProvince, {
    message: "ต้นทางและปลายทางต้องเป็นคนละจังหวัด",
    path: ["destinationProvince"],
  });
export const publicTripSummarySchema = tripSchema
  .pick({
    id: true,
    originProvince: true,
    destinationProvince: true,
    departureAt: true,
    seats: true,
    vehicleModel: true,
    vehicleColor: true,
    contributionSatang: true,
  })
  .extend({ seats: z.number().int().min(0).max(8) });
export const publicTripDetailSchema = publicTripSummarySchema
  .extend({
    pickupPoint: tripSchema.shape.pickupPoint,
    dropoffPoint: tripSchema.shape.dropoffPoint,
    luggageNotes: tripSchema.shape.luggageNotes,
    conditions: tripSchema.shape.conditions,
    route: z
      .object({
        origin: pointSchema,
        destination: pointSchema,
        distanceKm: z.number().positive(),
        source: z.enum(["road", "manual"]),
        shares: z.number().int().positive(),
      })
      .optional(),
  })
  .strict();
export const discoveryCursorSchema = z
  .object({
    originProvince: z.enum(provinces),
    destinationProvince: z.enum(provinces),
    date: travelDateSchema,
    departureAt: z.string().datetime(),
    id: z.string().uuid(),
  })
  .strict();
export const publicTripListSchema = z
  .object({
    trips: z.array(publicTripSummarySchema).max(20),
    nextCursor: z.string().max(600).nullable(),
  })
  .strict();
export const publicTripResponseSchema = z
  .object({ trip: publicTripDetailSchema })
  .strict();
export type TripSearch = z.infer<typeof tripSearchSchema>;
export type PublicTripSummary = z.infer<typeof publicTripSummarySchema>;
export type PublicTripDetail = z.infer<typeof publicTripDetailSchema>;
export type DiscoveryCursor = z.infer<typeof discoveryCursorSchema>;
export type PublicTripList = z.infer<typeof publicTripListSchema>;
export function bangkokDayRange(date: string) {
  const start = new Date(
    fromBangkokInput(`${travelDateSchema.parse(date)}T00:00`),
  );
  return { start, end: new Date(start.getTime() + 86400000) };
}

const activityCount = z.number().int().nonnegative();
export const publicActivitySchema = z
  .object({
    updatedAt: z.string().datetime(),
    totals: z
      .object({
        trips: activityCount,
        vehicles: activityCount,
        seats: activityCount,
        pendingRequests: activityCount,
        wantedPosts: activityCount.optional(),
      })
      .strict(),
    wantedDestinations: z
      .array(
        z
          .object({
            province: z.enum(provinces),
            posts: activityCount,
            seats: activityCount,
          })
          .strict(),
      )
      .max(77)
      .optional(),
    destinations: z
      .array(
        z
          .object({
            province: z.enum(provinces),
            trips: activityCount,
            vehicles: activityCount,
            seats: activityCount,
            pendingRequests: activityCount,
            nextTripId: z.uuid(),
            nextDepartureAt: z.string().datetime(),
          })
          .strict(),
      )
      .max(77),
  })
  .strict();
export type PublicActivity = z.infer<typeof publicActivitySchema>;

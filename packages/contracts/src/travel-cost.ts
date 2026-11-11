import { z } from "zod";
export const pointSchema = z
  .object({
    lat: z.number().min(-85).max(85),
    lng: z.number().min(-180).max(180),
  })
  .strict();
export const costInputSchema = z
  .object({
    distanceKm: z.number().positive().max(3000),
    fuelSatangPerKm: z.number().int().min(0).max(10000),
    operationsSatangPerKm: z.number().int().min(0).max(10000),
    extraSatang: z.number().int().min(0).max(10000000),
    shares: z.number().int().min(1).max(9),
  })
  .strict();
export function calculateTripCost(value: z.infer<typeof costInputSchema>) {
  const v = costInputSchema.parse(value),
    fuelSatang = Math.round(v.distanceKm * v.fuelSatangPerKm),
    operationsSatang = Math.round(v.distanceKm * v.operationsSatangPerKm),
    totalSatang = fuelSatang + operationsSatang + v.extraSatang;
  return {
    fuelSatang,
    operationsSatang,
    totalSatang,
    pricePerSeatSatang: Math.ceil(totalSatang / v.shares),
    shares: v.shares,
  };
}
export const safetyTripSchema = z
  .object({
    vehicleId: z.string().uuid(),
    vehicleVersion: z.number().int().positive().optional(),
    routeProof: z.string().max(2048).optional(),
    cost: costInputSchema,
    origin: pointSchema,
    destination: pointSchema,
    distanceSource: z.enum(["road", "manual"]),
  })
  .strict();

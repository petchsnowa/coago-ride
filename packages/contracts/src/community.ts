import { z } from "zod";
import { provinces } from "./trips";
const time = z.string().datetime(),
  id = z.uuid();
export const wantedDraftSchema = z
  .object({
    originProvince: z.enum(provinces),
    destinationProvince: z.enum(provinces),
    departureFrom: time,
    departureUntil: time,
    seats: z.number().int().min(1).max(8),
    budgetSatang: z.number().int().min(0).max(1000000).nullable(),
  })
  .strict()
  .superRefine((v, c) => {
    if (v.originProvince === v.destinationProvince)
      c.addIssue({
        code: "custom",
        path: ["destinationProvince"],
        message: "ต้นทางและปลายทางต้องต่างกัน",
      });
    if (
      Date.parse(v.departureUntil) < Date.parse(v.departureFrom) ||
      Date.parse(v.departureUntil) - Date.parse(v.departureFrom) > 86400000
    )
      c.addIssue({
        code: "custom",
        path: ["departureUntil"],
        message: "ช่วงเวลาเดินทางต้องไม่เกิน24ชั่วโมงและสิ้นสุดหลังเวลาเริ่ม",
      });
  });
export const publicWantedSchema = wantedDraftSchema.safeExtend({ id });
export const wantedPostSchema = publicWantedSchema.safeExtend({
  version: z.number().int().positive(),
  status: z.enum(["active", "cancelled"]),
  cancellationReason: z.string().nullable(),
  createdAt: time,
  updatedAt: time,
});
export const publicWantedListSchema = z
  .object({
    posts: z.array(publicWantedSchema).max(20),
    nextCursor: z.string().nullable(),
  })
  .strict();
export const wantedListSchema = z
  .object({
    posts: z.array(wantedPostSchema).max(20),
    nextCursor: z.string().nullable(),
  })
  .strict();
export type WantedDraft = z.infer<typeof wantedDraftSchema>;
export const journeyStages = [
  "not_started",
  "ready",
  "at_pickup",
  "travelling",
  "arrived",
  "completed",
] as const;
export const journeyStatusSchema = z.enum(journeyStages);
export const journeyLabels: Record<(typeof journeyStages)[number], string> = {
  not_started: "ยังไม่เริ่มเดินทาง",
  ready: "เตรียมออกเดินทาง",
  at_pickup: "ถึงจุดรับ",
  travelling: "กำลังเดินทาง",
  arrived: "ถึงปลายทาง",
  completed: "จบเที่ยว",
};
export const journeyActionSchema = z
  .object({
    requestId: id,
    version: z.number().int().nonnegative(),
    status: journeyStatusSchema,
    issue: z.boolean(),
    note: z.string().trim().max(300),
  })
  .strict();
export const journeyStateSchema = z
  .object({
    tripId: id,
    status: journeyStatusSchema,
    issue: z.boolean(),
    version: z.number().int().nonnegative(),
    updatedAt: time.nullable(),
    canUpdate: z.boolean(),
    driverEligible: z.boolean(),
    trip: z.object({
      status: z.enum(["active", "cancelled"]),
      originProvince: z.string(),
      destinationProvince: z.string(),
      departureAt: time,
      pickupPoint: z.string(),
      dropoffPoint: z.string(),
      route: z
        .object({
          origin: z.object({ lat: z.number(), lng: z.number() }),
          destination: z.object({ lat: z.number(), lng: z.number() }),
        })
        .nullable(),
    }),
    events: z
      .array(
        z.object({
          id,
          status: journeyStatusSchema,
          issue: z.boolean(),
          note: z.string(),
          createdAt: time,
        }),
      )
      .max(20),
  })
  .strict();
export type JourneyState = z.infer<typeof journeyStateSchema>;

export const journeyListSchema = z
  .object({
    items: z
      .array(
        z.object({
          tripId: z.uuid(),
          ownerName: z.string(),
          originProvince: z.string(),
          destinationProvince: z.string(),
          departureAt: z.string().datetime(),
          status: journeyStatusSchema,
          issue: z.boolean(),
          updatedAt: z.string().datetime(),
        }),
      )
      .max(20),
    nextCursor: z.string().nullable(),
  })
  .strict();
export const notificationPreferenceSchema = z
  .object({
    enabled: z.boolean(),
    available: z.boolean(),
    consentVersion: z.literal("2026-11-12"),
  })
  .strict();

import { z } from "zod";
export const siteSettingsSchema = z
  .object({
    serviceOpen: z.boolean(),
    registrationsOpen: z.boolean(),
    version: z.number().int().positive(),
  })
  .strict();
export const adminReasonSchema = z.string().trim().min(1).max(300);
export const adminUserActionSchema = z
  .object({
    status: z.enum(["active", "suspended"]),
    version: z.number().int().positive(),
    reason: adminReasonSchema,
  })
  .strict();
export const adminSettingsActionSchema = siteSettingsSchema
  .extend({ reason: adminReasonSchema })
  .strict();
export const adminCancelTripSchema = z
  .object({ version: z.number().int().positive(), reason: adminReasonSchema })
  .strict();
export type SiteSettings = z.infer<typeof siteSettingsSchema>;
const id = z.string().uuid(),
  time = z.string().datetime();
export const adminRoleSchema = z
  .object({ role: z.enum(["root", "admin", "user"]) })
  .strict();
export const adminOverviewSchema = z
  .object({
    users: z.number().int().nonnegative(),
    suspended: z.number().int().nonnegative(),
    active_trips: z.number().int().nonnegative(),
    cancelled_trips: z.number().int().nonnegative(),
    pending_requests: z.number().int().nonnegative(),
    accepted_requests: z.number().int().nonnegative(),
  })
  .strict();
export const adminUserSchema = z
  .object({
    id,
    displayName: z.string(),
    status: z.enum(["active", "suspended"]),
    version: z.number().int().positive(),
    createdAt: time,
    isRoot: z.boolean(),
    role: z.enum(["user", "admin"]).default("user"),
  })
  .strict();
export const adminTripSchema = z
  .object({
    id,
    ownerId: id,
    ownerName: z.string(),
    originProvince: z.string(),
    destinationProvince: z.string(),
    departureAt: time,
    status: z.enum(["active", "cancelled"]),
    version: z.number().int().positive(),
    seats: z.number().int().min(1).max(8),
    bookedSeats: z.number().int().min(0).max(8),
    createdAt: time,
  })
  .strict();
export const adminRequestSchema = z
  .object({
    id,
    tripId: id,
    passengerId: id,
    passengerName: z.string(),
    status: z.enum(["pending", "accepted", "rejected", "cancelled"]),
    seats: z.literal(1),
    originProvince: z.string(),
    destinationProvince: z.string(),
    departureAt: time,
    createdAt: time,
  })
  .strict();
export const adminAuditSchema = z
  .object({
    id,
    actorId: id,
    actorName: z.string(),
    action: z.enum([
      "root_bootstrap",
      "user_suspended",
      "user_activated",
      "trip_cancelled",
      "settings_changed",
      "admin_granted",
      "admin_revoked",
    ]),
    targetType: z.enum(["user", "trip", "settings"]),
    targetId: z.string(),
    reason: z.string().max(300),
    details: z.record(z.string(), z.unknown()),
    createdAt: time,
  })
  .strict();
export const adminLists = {
  users: z
    .object({
      items: z.array(adminUserSchema).max(20),
      nextCursor: z.string().nullable(),
    })
    .strict(),
  trips: z
    .object({
      items: z.array(adminTripSchema).max(20),
      nextCursor: z.string().nullable(),
    })
    .strict(),
  requests: z
    .object({
      items: z.array(adminRequestSchema).max(20),
      nextCursor: z.string().nullable(),
    })
    .strict(),
  audit: z
    .object({
      items: z.array(adminAuditSchema).max(20),
      nextCursor: z.string().nullable(),
    })
    .strict(),
};
export type AdminUser = z.infer<typeof adminUserSchema>;
export type AdminTrip = z.infer<typeof adminTripSchema>;
export type AdminRequest = z.infer<typeof adminRequestSchema>;
export type AdminAudit = z.infer<typeof adminAuditSchema>;

export const adminGrantSchema = z
  .object({
    role: z.enum(["user", "admin"]),
    version: z.number().int().positive(),
    reason: adminReasonSchema,
  })
  .strict();

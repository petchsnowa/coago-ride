import { sql } from "drizzle-orm";
import {
  pgTable,
  jsonb,
  text,
  timestamp,
  uuid,
  integer,
  primaryKey,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
export const systemMetadata = pgTable("system_metadata", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey(),
  displayName: text("display_name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
export const externalIdentities = pgTable(
  "external_identities",
  {
    provider: text("provider").notNull(),
    subject: text("subject").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [primaryKey({ columns: [table.provider, table.subject] })],
);
export const oauthFlows = pgTable(
  "oauth_flows",
  {
    idHash: text("id_hash").primaryKey(),
    stateHash: text("state_hash").notNull().unique(),
    nonce: text("nonce").notNull(),
    verifier: text("verifier").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [index("oauth_flows_expiry_idx").on(table.expiresAt)],
);
export const authSessions = pgTable(
  "auth_sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    csrfToken: text("csrf_token").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("auth_sessions_expiry_idx").on(table.expiresAt)],
);
export const authRateLimits = pgTable(
  "auth_rate_limits",
  {
    bucket: text("bucket").primaryKey(),
    hits: integer("hits").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [index("auth_rate_expiry_idx").on(table.expiresAt)],
);

export const trips = pgTable(
  "trips",
  {
    id: uuid("id").primaryKey(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    requestId: uuid("request_id").notNull(),
    payloadHash: text("payload_hash").notNull(),
    originProvince: text("origin_province").notNull(),
    destinationProvince: text("destination_province").notNull(),
    departureAt: timestamp("departure_at", { withTimezone: true }).notNull(),
    pickupPoint: text("pickup_point").notNull(),
    dropoffPoint: text("dropoff_point").notNull(),
    seats: integer("seats_offered").notNull(),
    bookedSeats: integer("seats_booked").notNull().default(0),
    vehicleModel: text("vehicle_model").notNull(),
    vehicleColor: text("vehicle_color").notNull(),
    contributionSatang: integer("contribution_satang").notNull(),
    luggageNotes: text("luggage_notes").notNull().default(""),
    conditions: text("conditions").notNull().default(""),
    status: text("status").notNull().default("active"),
    version: integer("version").notNull().default(1),
    cancellationReason: text("cancellation_reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("trips_upcoming_active_idx")
      .on(t.departureAt, t.id)
      .where(sql`${t.status}='active'`),
    uniqueIndex("trips_owner_request_idx").on(t.ownerId, t.requestId),
    index("trips_owner_created_idx").on(t.ownerId, t.createdAt, t.id),
    index("trips_search_active_idx")
      .on(t.originProvince, t.destinationProvince, t.departureAt, t.id)
      .where(sql`${t.status}='active'`),
    check("trips_booked_range", sql`${t.bookedSeats} between 0 and ${t.seats}`),
    check("trips_seats_range", sql`${t.seats} between 1 and 8`),
    check(
      "trips_contribution_range",
      sql`${t.contributionSatang} between 0 and 1000000`,
    ),
    check("trips_version_positive", sql`${t.version}>0`),
    check(
      "trips_different_provinces",
      sql`${t.originProvince}<>${t.destinationProvince}`,
    ),
    check(
      "trips_status_reason",
      sql`(${t.status}='active' and ${t.cancellationReason} is null) or (${t.status}='cancelled' and ${t.cancellationReason} is not null and length(trim(${t.cancellationReason}))>0)`,
    ),
  ],
);

export const rideRequests = pgTable(
  "ride_requests",
  {
    id: uuid("id").primaryKey(),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    passengerId: uuid("passenger_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    requestId: uuid("request_id").notNull(),
    status: text("status").notNull().default("pending"),
    seatsRequested: integer("seats_requested").notNull().default(1),
    tripVersion: integer("trip_version").notNull(),
    tripSnapshot: jsonb("trip_snapshot").notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    rejectionReason: text("rejection_reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("ride_requests_passenger_key_idx").on(
      t.passengerId,
      t.requestId,
    ),
    uniqueIndex("ride_requests_active_idx")
      .on(t.passengerId, t.tripId)
      .where(sql`${t.status} in ('pending','accepted')`),
    index("ride_requests_passenger_created_idx").on(
      t.passengerId,
      t.createdAt,
      t.id,
    ),
    index("ride_requests_trip_created_idx").on(t.tripId, t.createdAt, t.id),
    check(
      "ride_requests_status",
      sql`${t.status} in ('pending','accepted','rejected','cancelled')`,
    ),
    check(
      "ride_requests_snapshot_object",
      sql`jsonb_typeof(${t.tripSnapshot})='object'`,
    ),
    check(
      "ride_requests_decision_time",
      sql`${t.status} not in ('accepted','rejected') or ${t.decidedAt} is not null`,
    ),
    check(
      "ride_requests_rejection_reason",
      sql`${t.rejectionReason} is null or (${t.status}='rejected' and length(${t.rejectionReason})<=300)`,
    ),
    check("ride_requests_single_seat", sql`${t.seatsRequested}=1`),
    check("ride_requests_trip_version", sql`${t.tripVersion}>0`),
  ],
);

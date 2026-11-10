import { sql } from "drizzle-orm";
import {
  pgTable,
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
    uniqueIndex("trips_owner_request_idx").on(t.ownerId, t.requestId),
    index("trips_owner_created_idx").on(t.ownerId, t.createdAt, t.id),
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

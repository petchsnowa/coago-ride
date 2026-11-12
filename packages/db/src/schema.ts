import { sql } from "drizzle-orm";
import {
  pgTable,
  date,
  jsonb,
  text,
  timestamp,
  uuid,
  integer,
  boolean,
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

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey(),
    displayName: text("display_name").notNull(),
    status: text("status").notNull().default("active"),
    role: text("role").notNull().default("user"),
    statusVersion: integer("status_version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    check("users_status", sql`${t.status} in ('active','suspended')`),
    check("users_role", sql`${t.role} in ('user','admin')`),
    check("users_status_version", sql`${t.statusVersion}>0`),
  ],
);
export const siteSettings = pgTable(
  "site_settings",
  {
    id: text("id").primaryKey().default("site"),
    serviceOpen: boolean("service_open").notNull().default(false),
    registrationsOpen: boolean("registrations_open").notNull().default(false),
    version: integer("version").notNull().default(1),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check("site_settings_singleton", sql`${t.id}='site'`),
    check("site_settings_version", sql`${t.version}>0`),
  ],
);
export const adminAudit = pgTable(
  "admin_audit",
  {
    id: uuid("id").primaryKey(),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    reason: text("reason").notNull(),
    details: jsonb("details").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("admin_audit_created_idx").on(t.createdAt, t.id),
    uniqueIndex("admin_root_bootstrap_idx")
      .on(t.targetId)
      .where(sql`${t.action}='root_bootstrap'`),
    check("admin_audit_reason", sql`length(${t.reason})<=300`),
    check(
      "admin_audit_action",
      sql`${t.action} in ('root_bootstrap','user_suspended','user_activated','trip_cancelled','settings_changed','admin_granted','admin_revoked','profile_reviewed','license_reviewed','vehicle_reviewed','private_document_viewed')`,
    ),
    check(
      "admin_audit_target",
      sql`${t.targetType} in ('user','trip','settings')`,
    ),
    check("admin_audit_details", sql`jsonb_typeof(${t.details})='object'`),
  ],
);
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
    adminProof: text("admin_proof"),
    rootVerified: boolean("root_verified").notNull().default(false),
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
    safety: jsonb("safety").$type<Record<string, unknown>>(),
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

export const memberProfiles = pgTable(
  "member_profiles",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id),
    data: text("data").notNull(),
    documentLast4: text("document_last4").notNull(),
    status: text("status").notNull().default("pending"),
    version: integer("version").notNull().default(1),
    reviewReason: text("review_reason"),
    reviewedBy: uuid("reviewed_by").references(() => users.id),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    check(
      "member_profile_status",
      sql`${t.status} in ('pending','approved','rejected')`,
    ),
    check("member_profile_version", sql`${t.version}>0`),
  ],
);
export const privateUploads = pgTable(
  "private_uploads",
  {
    id: uuid("id").primaryKey(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id),
    purpose: text("purpose").notNull(),
    objectKey: text("object_key").notNull().unique(),
    contentType: text("content_type").notNull(),
    size: integer("size").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    check(
      "upload_purpose",
      sql`${t.purpose} in ('portrait','document','vehicle','plate','license')`,
    ),
    check("upload_size", sql`${t.size}>0 and ${t.size}<=2097152`),
  ],
);
export const vehicles = pgTable(
  "vehicles",
  {
    id: uuid("id").primaryKey(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id),
    brand: text("brand").notNull(),
    model: text("model").notNull(),
    color: text("color").notNull(),
    capacity: integer("capacity").notNull().default(1),
    data: text("data").notNull(),
    status: text("status").notNull().default("pending"),
    version: integer("version").notNull().default(1),
    reviewReason: text("review_reason"),
    reviewedBy: uuid("reviewed_by").references(() => users.id),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("vehicles_owner_idx").on(t.ownerId),
    check(
      "vehicle_status",
      sql`${t.status} in ('pending','approved','rejected')`,
    ),
    check("vehicle_version", sql`${t.version}>0`),
  ],
);

export const driverLicenses = pgTable(
  "driver_licenses",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id),
    data: text("data").notNull(),
    documentLast4: text("document_last4").notNull(),
    expiresOn: date("expires_on").notNull(),
    status: text("status").notNull().default("pending"),
    version: integer("version").notNull().default(1),
    reviewReason: text("review_reason"),
    reviewedBy: uuid("reviewed_by").references(() => users.id),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "driver_license_status",
      sql`${t.status} in ('pending','approved','rejected')`,
    ),
    check("driver_license_version", sql`${t.version}>0`),
  ],
);
export const wantedPosts = pgTable(
  "wanted_posts",
  {
    id: uuid("id").primaryKey(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    requestId: uuid("request_id").notNull(),
    payloadHash: text("payload_hash").notNull(),
    originProvince: text("origin_province").notNull(),
    destinationProvince: text("destination_province").notNull(),
    departureFrom: timestamp("departure_from", {
      withTimezone: true,
    }).notNull(),
    departureUntil: timestamp("departure_until", {
      withTimezone: true,
    }).notNull(),
    seats: integer("seats").notNull(),
    budgetSatang: integer("budget_satang"),
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
    uniqueIndex("wanted_owner_request_idx").on(t.ownerId, t.requestId),
    index("wanted_public_route_idx")
      .on(t.originProvince, t.destinationProvince, t.departureUntil)
      .where(sql`${t.status}='active'`),
    check("wanted_seats", sql`${t.seats} between 1 and 8`),
    check(
      "wanted_budget",
      sql`${t.budgetSatang} is null or ${t.budgetSatang} between 0 and 1000000`,
    ),
    check(
      "wanted_dates",
      sql`${t.departureUntil}>=${t.departureFrom} and ${t.departureUntil}<=${t.departureFrom}+interval '24 hours'`,
    ),
    check("wanted_route", sql`${t.originProvince}<>${t.destinationProvince}`),
    check("wanted_status", sql`${t.status} in ('active','cancelled')`),
    check("wanted_version", sql`${t.version}>0`),
  ],
);
export const journeys = pgTable(
  "journeys",
  {
    tripId: uuid("trip_id")
      .primaryKey()
      .references(() => trips.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("not_started"),
    issue: boolean("issue").notNull().default(false),
    version: integer("version").notNull().default(1),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "journey_status",
      sql`${t.status} in ('not_started','ready','at_pickup','travelling','arrived','completed')`,
    ),
    check("journey_version", sql`${t.version}>0`),
  ],
);
export const journeyEvents = pgTable(
  "journey_events",
  {
    id: uuid("id").primaryKey(),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id),
    requestId: uuid("request_id").notNull(),
    payloadHash: text("payload_hash").notNull(),
    status: text("status").notNull(),
    issue: boolean("issue").notNull(),
    note: text("note").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("journey_actor_request_idx").on(t.actorId, t.requestId),
    index("journey_history_idx").on(t.tripId, t.createdAt, t.id),
  ],
);
export const notificationPreferences = pgTable("notification_preferences", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(false),
  consentVersion: text("consent_version").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const notificationOutbox = pgTable(
  "notification_outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dedupeKey: text("dedupe_key").notNull().unique(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    relatedId: uuid("related_id").notNull(),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    retryKey: uuid("retry_key").notNull().defaultRandom(),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    firstAttemptAt: timestamp("first_attempt_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    errorCode: text("error_code"),
  },
  (t) => [
    index("notification_due_idx").on(t.status, t.nextAttemptAt),
    check(
      "notification_status",
      sql`${t.status} in ('pending','processing','sent','skipped','failed')`,
    ),
    check("notification_attempts", sql`${t.attempts} between 0 and 3`),
  ],
);

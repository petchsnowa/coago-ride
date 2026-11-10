CREATE TABLE "trips" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"payload_hash" text NOT NULL,
	"origin_province" text NOT NULL,
	"destination_province" text NOT NULL,
	"departure_at" timestamp with time zone NOT NULL,
	"pickup_point" text NOT NULL,
	"dropoff_point" text NOT NULL,
	"seats_offered" integer NOT NULL,
	"vehicle_model" text NOT NULL,
	"vehicle_color" text NOT NULL,
	"contribution_satang" integer NOT NULL,
	"luggage_notes" text DEFAULT '' NOT NULL,
	"conditions" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"cancellation_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trips_seats_range" CHECK ("trips"."seats_offered" between 1 and 8),
	CONSTRAINT "trips_contribution_range" CHECK ("trips"."contribution_satang" between 0 and 1000000),
	CONSTRAINT "trips_version_positive" CHECK ("trips"."version">0),
	CONSTRAINT "trips_different_provinces" CHECK ("trips"."origin_province"<>"trips"."destination_province"),
	CONSTRAINT "trips_status_reason" CHECK (("trips"."status"='active' and "trips"."cancellation_reason" is null) or ("trips"."status"='cancelled' and "trips"."cancellation_reason" is not null and length(trim("trips"."cancellation_reason"))>0))
);
--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "trips_owner_request_idx" ON "trips" USING btree ("owner_id","request_id");--> statement-breakpoint
CREATE INDEX "trips_owner_created_idx" ON "trips" USING btree ("owner_id","created_at","id");
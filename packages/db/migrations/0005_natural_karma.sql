CREATE TABLE "ride_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"trip_id" uuid NOT NULL,
	"passenger_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"seats_requested" integer DEFAULT 1 NOT NULL,
	"trip_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ride_requests_status" CHECK ("ride_requests"."status" in ('pending','cancelled')),
	CONSTRAINT "ride_requests_single_seat" CHECK ("ride_requests"."seats_requested"=1),
	CONSTRAINT "ride_requests_trip_version" CHECK ("ride_requests"."trip_version">0)
);
--> statement-breakpoint
ALTER TABLE "ride_requests" ADD CONSTRAINT "ride_requests_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ride_requests" ADD CONSTRAINT "ride_requests_passenger_id_users_id_fk" FOREIGN KEY ("passenger_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ride_requests_passenger_key_idx" ON "ride_requests" USING btree ("passenger_id","request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ride_requests_pending_idx" ON "ride_requests" USING btree ("passenger_id","trip_id") WHERE "ride_requests"."status"='pending';--> statement-breakpoint
CREATE INDEX "ride_requests_passenger_created_idx" ON "ride_requests" USING btree ("passenger_id","created_at","id");--> statement-breakpoint
CREATE INDEX "ride_requests_trip_created_idx" ON "ride_requests" USING btree ("trip_id","created_at","id");
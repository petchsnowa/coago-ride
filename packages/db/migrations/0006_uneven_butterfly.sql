ALTER TABLE "ride_requests" DROP CONSTRAINT "ride_requests_status";--> statement-breakpoint
DROP INDEX "ride_requests_pending_idx";--> statement-breakpoint
-- Existing requests predate snapshots; backfill current terms once, preserving trip_version for stale-term checks.
ALTER TABLE "ride_requests" ADD COLUMN "trip_snapshot" jsonb;
--> statement-breakpoint
UPDATE ride_requests r SET trip_snapshot = jsonb_build_object(
'id',t.id,'originProvince',t.origin_province,'destinationProvince',t.destination_province,
'departureAt',to_char(t.departure_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
'seats',t.seats_offered,'vehicleModel',t.vehicle_model,'vehicleColor',t.vehicle_color,
'contributionSatang',t.contribution_satang,'pickupPoint',t.pickup_point,'dropoffPoint',t.dropoff_point,
'luggageNotes',t.luggage_notes,'conditions',t.conditions
) FROM trips t WHERE r.trip_id=t.id AND r.trip_snapshot IS NULL;
--> statement-breakpoint
ALTER TABLE "ride_requests" ALTER COLUMN "trip_snapshot" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "ride_requests" ADD COLUMN "decided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ride_requests" ADD COLUMN "rejection_reason" text;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "seats_booked" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ride_requests_active_idx" ON "ride_requests" USING btree ("passenger_id","trip_id") WHERE "ride_requests"."status" in ('pending','accepted');--> statement-breakpoint
ALTER TABLE "ride_requests" ADD CONSTRAINT "ride_requests_snapshot_object" CHECK (jsonb_typeof("ride_requests"."trip_snapshot")='object');--> statement-breakpoint
ALTER TABLE "ride_requests" ADD CONSTRAINT "ride_requests_decision_time" CHECK ("ride_requests"."status" not in ('accepted','rejected') or "ride_requests"."decided_at" is not null);--> statement-breakpoint
ALTER TABLE "ride_requests" ADD CONSTRAINT "ride_requests_rejection_reason" CHECK ("ride_requests"."rejection_reason" is null or ("ride_requests"."status"='rejected' and length("ride_requests"."rejection_reason")<=300));--> statement-breakpoint
ALTER TABLE "ride_requests" ADD CONSTRAINT "ride_requests_status" CHECK ("ride_requests"."status" in ('pending','accepted','rejected','cancelled'));--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_booked_range" CHECK ("trips"."seats_booked" between 0 and "trips"."seats_offered");
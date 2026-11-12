CREATE TABLE "driver_licenses" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"data" text NOT NULL,
	"document_last4" text NOT NULL,
	"expires_on" date NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"review_reason" text,
	"reviewed_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "driver_license_status" CHECK ("driver_licenses"."status" in ('pending','approved','rejected')),
	CONSTRAINT "driver_license_version" CHECK ("driver_licenses"."version">0)
);
--> statement-breakpoint
CREATE TABLE "journey_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"trip_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"payload_hash" text NOT NULL,
	"status" text NOT NULL,
	"issue" boolean NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journeys" (
	"trip_id" uuid PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'not_started' NOT NULL,
	"issue" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "journey_status" CHECK ("journeys"."status" in ('not_started','ready','at_pickup','travelling','arrived','completed')),
	CONSTRAINT "journey_version" CHECK ("journeys"."version">0)
);
--> statement-breakpoint
CREATE TABLE "notification_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dedupe_key" text NOT NULL,
	"user_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"related_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"retry_key" uuid DEFAULT gen_random_uuid() NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone,
	"first_attempt_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"error_code" text,
	CONSTRAINT "notification_outbox_dedupe_key_unique" UNIQUE("dedupe_key"),
	CONSTRAINT "notification_status" CHECK ("notification_outbox"."status" in ('pending','processing','sent','skipped','failed')),
	CONSTRAINT "notification_attempts" CHECK ("notification_outbox"."attempts" between 0 and 3)
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"consent_version" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wanted_posts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"payload_hash" text NOT NULL,
	"origin_province" text NOT NULL,
	"destination_province" text NOT NULL,
	"departure_from" timestamp with time zone NOT NULL,
	"departure_until" timestamp with time zone NOT NULL,
	"seats" integer NOT NULL,
	"budget_satang" integer,
	"status" text DEFAULT 'active' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"cancellation_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wanted_seats" CHECK ("wanted_posts"."seats" between 1 and 8),
	CONSTRAINT "wanted_budget" CHECK ("wanted_posts"."budget_satang" is null or "wanted_posts"."budget_satang" between 0 and 1000000),
	CONSTRAINT "wanted_dates" CHECK ("wanted_posts"."departure_until">="wanted_posts"."departure_from" and "wanted_posts"."departure_until"<="wanted_posts"."departure_from"+interval '24 hours'),
	CONSTRAINT "wanted_route" CHECK ("wanted_posts"."origin_province"<>"wanted_posts"."destination_province"),
	CONSTRAINT "wanted_status" CHECK ("wanted_posts"."status" in ('active','cancelled')),
	CONSTRAINT "wanted_version" CHECK ("wanted_posts"."version">0)
);
--> statement-breakpoint
ALTER TABLE "admin_audit" DROP CONSTRAINT "admin_audit_action";--> statement-breakpoint
ALTER TABLE "private_uploads" DROP CONSTRAINT "upload_purpose";--> statement-breakpoint
ALTER TABLE "driver_licenses" ADD CONSTRAINT "driver_licenses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_licenses" ADD CONSTRAINT "driver_licenses_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journey_events" ADD CONSTRAINT "journey_events_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journey_events" ADD CONSTRAINT "journey_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journeys" ADD CONSTRAINT "journeys_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wanted_posts" ADD CONSTRAINT "wanted_posts_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "journey_actor_request_idx" ON "journey_events" USING btree ("actor_id","request_id");--> statement-breakpoint
CREATE INDEX "journey_history_idx" ON "journey_events" USING btree ("trip_id","created_at","id");--> statement-breakpoint
CREATE INDEX "notification_due_idx" ON "notification_outbox" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE UNIQUE INDEX "wanted_owner_request_idx" ON "wanted_posts" USING btree ("owner_id","request_id");--> statement-breakpoint
CREATE INDEX "wanted_public_route_idx" ON "wanted_posts" USING btree ("origin_province","destination_province","departure_until") WHERE "wanted_posts"."status"='active';--> statement-breakpoint
ALTER TABLE "admin_audit" ADD CONSTRAINT "admin_audit_action" CHECK ("admin_audit"."action" in ('root_bootstrap','user_suspended','user_activated','trip_cancelled','settings_changed','admin_granted','admin_revoked','profile_reviewed','license_reviewed','vehicle_reviewed','private_document_viewed'));--> statement-breakpoint
ALTER TABLE "private_uploads" ADD CONSTRAINT "upload_purpose" CHECK ("private_uploads"."purpose" in ('portrait','document','vehicle','plate','license'));--> statement-breakpoint
-- Durable outbox: only opted-in recipients. No network calls occur in a transaction.
CREATE FUNCTION coago_enqueue_notification(recipient uuid, trip uuid, event_kind text, related uuid, event_key text) RETURNS void LANGUAGE sql AS $$
 INSERT INTO notification_outbox(dedupe_key,user_id,trip_id,kind,related_id)
 SELECT event_key,recipient,trip,event_kind,related FROM notification_preferences p
 JOIN users u ON u.id=p.user_id WHERE p.user_id=recipient AND p.enabled AND p.consent_version='2026-11-12' AND u.status='active'
 ON CONFLICT(dedupe_key) DO NOTHING;
$$;
--> statement-breakpoint
CREATE FUNCTION coago_request_notification() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE recipient uuid; event_kind text;
BEGIN
 IF TG_OP='INSERT' THEN
   SELECT owner_id INTO recipient FROM trips WHERE id=NEW.trip_id;
   event_kind := 'request_created';
 ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
   IF NEW.status='accepted' THEN event_kind := 'request_accepted'; recipient:=NEW.passenger_id;
   ELSIF NEW.status='rejected' THEN event_kind := 'request_rejected'; recipient:=NEW.passenger_id;
   ELSIF NEW.status='cancelled' THEN
     SELECT owner_id INTO recipient FROM trips WHERE id=NEW.trip_id AND status='active';
     event_kind:='request_cancelled';
   END IF;
 END IF;
 IF event_kind IS NOT NULL THEN PERFORM coago_enqueue_notification(recipient,NEW.trip_id,event_kind,NEW.id,NEW.id::text||':'||event_kind); END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER coago_request_notification_trigger AFTER INSERT OR UPDATE OF status ON ride_requests FOR EACH ROW EXECUTE FUNCTION coago_request_notification();
--> statement-breakpoint
CREATE FUNCTION coago_trip_notification() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE recipient uuid;
BEGIN
 IF NEW.status='cancelled' AND OLD.status IS DISTINCT FROM NEW.status THEN
   FOR recipient IN SELECT DISTINCT passenger_id FROM ride_requests WHERE trip_id=NEW.id AND status IN ('pending','accepted') LOOP
     PERFORM coago_enqueue_notification(recipient,NEW.id,'trip_cancelled',NEW.id,NEW.id::text||':trip_cancelled:'||recipient::text);
   END LOOP;
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER coago_trip_notification_trigger AFTER UPDATE OF status ON trips FOR EACH ROW EXECUTE FUNCTION coago_trip_notification();
--> statement-breakpoint
CREATE FUNCTION coago_journey_notification() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE recipient uuid;
BEGIN
 FOR recipient IN SELECT DISTINCT passenger_id FROM ride_requests WHERE trip_id=NEW.trip_id AND status='accepted' LOOP
   PERFORM coago_enqueue_notification(recipient,NEW.trip_id,'journey_updated',NEW.id,NEW.id::text||':journey_updated:'||recipient::text);
 END LOOP;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER coago_journey_notification_trigger AFTER INSERT ON journey_events FOR EACH ROW EXECUTE FUNCTION coago_journey_notification();

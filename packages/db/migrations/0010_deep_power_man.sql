CREATE TABLE "member_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"data" text NOT NULL,
	"document_last4" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"review_reason" text,
	"reviewed_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_profile_status" CHECK ("member_profiles"."status" in ('pending','approved','rejected')),
	CONSTRAINT "member_profile_version" CHECK ("member_profiles"."version">0)
);
--> statement-breakpoint
CREATE TABLE "private_uploads" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"object_key" text NOT NULL,
	"content_type" text NOT NULL,
	"size" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "private_uploads_object_key_unique" UNIQUE("object_key"),
	CONSTRAINT "upload_purpose" CHECK ("private_uploads"."purpose" in ('portrait','document','vehicle','plate')),
	CONSTRAINT "upload_size" CHECK ("private_uploads"."size">0 and "private_uploads"."size"<=2097152)
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid NOT NULL,
	"brand" text NOT NULL,
	"model" text NOT NULL,
	"color" text NOT NULL,
	"capacity" integer DEFAULT 1 NOT NULL,
	"data" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"review_reason" text,
	"reviewed_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicle_status" CHECK ("vehicles"."status" in ('pending','approved','rejected')),
	CONSTRAINT "vehicle_version" CHECK ("vehicles"."version">0)
);
--> statement-breakpoint
ALTER TABLE "admin_audit" DROP CONSTRAINT "admin_audit_action";--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD COLUMN "admin_proof" text;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "safety" jsonb;--> statement-breakpoint
ALTER TABLE "member_profiles" ADD CONSTRAINT "member_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_profiles" ADD CONSTRAINT "member_profiles_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_uploads" ADD CONSTRAINT "private_uploads_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vehicles_owner_idx" ON "vehicles" USING btree ("owner_id");--> statement-breakpoint
ALTER TABLE "admin_audit" ADD CONSTRAINT "admin_audit_action" CHECK ("admin_audit"."action" in ('root_bootstrap','user_suspended','user_activated','trip_cancelled','settings_changed','admin_granted','admin_revoked','profile_reviewed','vehicle_reviewed','private_document_viewed'));
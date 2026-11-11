CREATE TABLE "admin_audit" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor_id" uuid NOT NULL,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"reason" text NOT NULL,
	"details" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_audit_reason" CHECK (length("admin_audit"."reason")<=300),
	CONSTRAINT "admin_audit_action" CHECK ("admin_audit"."action" in ('root_bootstrap','user_suspended','user_activated','trip_cancelled','settings_changed')),
	CONSTRAINT "admin_audit_target" CHECK ("admin_audit"."target_type" in ('user','trip','settings')),
	CONSTRAINT "admin_audit_details" CHECK (jsonb_typeof("admin_audit"."details")='object')
);
--> statement-breakpoint
CREATE TABLE "site_settings" (
	"id" text PRIMARY KEY DEFAULT 'site' NOT NULL,
	"service_open" boolean DEFAULT false NOT NULL,
	"registrations_open" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_settings_singleton" CHECK ("site_settings"."id"='site'),
	CONSTRAINT "site_settings_version" CHECK ("site_settings"."version">0)
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "status_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "admin_audit" ADD CONSTRAINT "admin_audit_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_audit_created_idx" ON "admin_audit" USING btree ("created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "admin_root_bootstrap_idx" ON "admin_audit" USING btree ("target_id") WHERE "admin_audit"."action"='root_bootstrap';--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_status" CHECK ("users"."status" in ('active','suspended'));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_status_version" CHECK ("users"."status_version">0);--> statement-breakpoint
INSERT INTO site_settings(id,service_open,registrations_open,version) VALUES('site',false,false,1) ON CONFLICT(id) DO NOTHING;

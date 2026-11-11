ALTER TABLE "admin_audit" DROP CONSTRAINT "admin_audit_action";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "role" text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "admin_audit" ADD CONSTRAINT "admin_audit_action" CHECK ("admin_audit"."action" in ('root_bootstrap','user_suspended','user_activated','trip_cancelled','settings_changed','admin_granted','admin_revoked'));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role" CHECK ("users"."role" in ('user','admin'));
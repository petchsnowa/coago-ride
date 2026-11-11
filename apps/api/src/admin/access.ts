import { eq, sql } from "drizzle-orm";
import { withDatabase, siteSettings } from "@coago/db";
import { siteSettingsSchema, type SiteSettings } from "@coago/contracts";
import type { Bindings } from "../bindings";
export function rootSubject(env: Bindings) {
  return /^U[a-f\d]{32}$/.test(env.ROOT_ADMIN_LINE_SUBJECT ?? "")
    ? env.ROOT_ADMIN_LINE_SUBJECT
    : undefined;
}
export const accessEnforced = (env: Bindings) =>
  env.ENVIRONMENT === "production" || env.SITE_ACCESS_ENFORCED === "true";
export async function readSiteSettings(url: string): Promise<SiteSettings> {
  return withDatabase(url, async (db) => {
    const [row] = await db
      .select()
      .from(siteSettings)
      .where(eq(siteSettings.id, "site"));
    if (!row) throw new Error("SITE_SETTINGS_MISSING");
    return siteSettingsSchema.parse({
      serviceOpen: row.serviceOpen,
      registrationsOpen: row.registrationsOpen,
      version: row.version,
    });
  });
}
export async function isRoot(url: string, actor: string, subject?: string) {
  if (!subject) return false;
  return withDatabase(
    url,
    async (db) =>
      (
        await db.execute(
          sql`SELECT 1 FROM users u JOIN external_identities i ON i.user_id=u.id WHERE u.id=${actor} AND u.status='active' AND i.provider='line' AND i.subject=${subject}`,
        )
      ).rowCount === 1,
  );
}

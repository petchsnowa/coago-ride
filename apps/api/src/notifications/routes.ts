import { z } from "zod";
import { databaseUrl } from "../bindings";
import { memberApp, memberLock, transaction } from "../community/shared";
import { messagingReady, notificationConsent } from "./provider";
const preferenceSchema = z
  .object({
    enabled: z.boolean(),
    consentVersion: z.literal(notificationConsent),
  })
  .strict();
export function notificationRoutes() {
  const app = memberApp();
  app.get("/", async (c) =>
    c.json(
      await transaction(databaseUrl(c.env), async (db) => {
        const r = await db.query(
          "SELECT enabled FROM notification_preferences WHERE user_id=$1",
          [c.get("session").user.id],
        );
        return {
          enabled: r.rows[0]?.enabled === true,
          available: messagingReady(c.env),
          consentVersion: notificationConsent,
        };
      }),
    ),
  );
  app.put("/", async (c) => {
    const input = preferenceSchema.parse(await c.req.json());
    if (input.enabled && !messagingReady(c.env))
      return c.json({ error: "messaging_not_configured" }, 409);
    await transaction(databaseUrl(c.env), async (db) => {
      const user = c.get("session").user.id;
      await memberLock(db, user, false);
      await db.query(
        "INSERT INTO notification_preferences(user_id,enabled,consent_version) VALUES($1,$2,$3) ON CONFLICT(user_id) DO UPDATE SET enabled=$2,consent_version=$3,updated_at=now()",
        [user, input.enabled, input.consentVersion],
      );
      if (!input.enabled)
        await db.query(
          "UPDATE notification_outbox SET status='skipped',error_code='opted_out' WHERE user_id=$1 AND status='pending'",
          [user],
        );
    });
    return c.json({
      enabled: input.enabled,
      available: messagingReady(c.env),
      consentVersion: notificationConsent,
    });
  });
  return app;
}

import { sql, eq } from "drizzle-orm";
import {
  withDatabase,
  users,
  authSessions,
  siteSettings,
  adminAudit,
} from "@coago/db";
import { siteSettingsSchema, type SiteSettings } from "@coago/contracts";
import { cancelOwnedTrip, type TripTransaction } from "../trips/store";
type Cursor = { createdAt: string; id: string };
export class AdminError extends Error {
  constructor(
    public code: "forbidden" | "not_found" | "conflict" | "root_protected",
  ) {
    super(code);
  }
}
export interface AdminStore {
  setRole(
    actor: string,
    id: string,
    input: { role: "user" | "admin"; version: number; reason: string },
    now: Date,
  ): Promise<void>;
  overview(actor: string): Promise<Record<string, number>>;
  list(
    actor: string,
    kind: "users" | "trips" | "requests" | "audit",
    cursor?: Cursor,
  ): Promise<{ items: Record<string, unknown>[]; nextCursor: string | null }>;
  setUser(
    actor: string,
    id: string,
    input: { status: "active" | "suspended"; version: number; reason: string },
    now: Date,
  ): Promise<void>;
  cancelTrip(
    actor: string,
    id: string,
    input: { version: number; reason: string },
    now: Date,
  ): Promise<void>;
  settings(actor: string): Promise<SiteSettings>;
  setSettings(
    actor: string,
    input: SiteSettings & { reason: string },
    now: Date,
  ): Promise<SiteSettings>;
}
async function assertManager(
  tx: TripTransaction,
  actor: string,
  subject?: string,
  rootOnly = false,
) {
  if (!subject) throw new AdminError("forbidden");
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${"admin:" + actor},0))`,
  );
  const result = await tx.execute(
    sql`SELECT u.id FROM users u JOIN external_identities i ON i.user_id=u.id WHERE u.id=${actor} AND u.status='active' AND i.provider='line' AND (i.subject=${subject} OR (u.role='admin' AND ${!rootOnly}))`,
  );
  if (result.rowCount !== 1) throw new AdminError("forbidden");
}
async function audit(
  tx: TripTransaction,
  actor: string,
  action: string,
  targetType: string,
  targetId: string,
  reason: string,
  details: Record<string, unknown>,
  now: Date,
) {
  await tx.insert(adminAudit).values({
    id: crypto.randomUUID(),
    actorId: actor,
    action,
    targetType,
    targetId,
    reason,
    details,
    createdAt: now,
  });
}
export function postgresAdminStore(url: string, subject?: string): AdminStore {
  const work = <T>(
    actor: string,
    fn: (tx: TripTransaction) => Promise<T>,
    rootOnly = false,
  ) =>
    withDatabase(url, (db) =>
      db.transaction(async (tx) => {
        await assertManager(tx, actor, subject, rootOnly);
        return fn(tx);
      }),
    );
  async function target(tx: TripTransaction, actor: string, id: string) {
    const root =
      (
        await tx.execute(
          sql`SELECT 1 FROM external_identities WHERE user_id=${actor} AND provider='line' AND subject=${subject!}`,
        )
      ).rowCount === 1;
    const initial = (
      await tx.execute(sql`SELECT role FROM users WHERE id=${id}`)
    ).rows[0];
    if (!root && initial?.role === "admin") throw new AdminError("forbidden");
    const isRoot =
      (
        await tx.execute(
          sql`SELECT 1 FROM external_identities WHERE user_id=${id} AND provider='line' AND subject=${subject!}`,
        )
      ).rowCount === 1;
    if (isRoot) throw new AdminError("root_protected");
    if (root && id !== actor)
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${"admin:" + id},0))`,
      );
    const row = (
      await tx.execute(
        sql`SELECT status,status_version,role,EXISTS(SELECT 1 FROM external_identities WHERE user_id=${id} AND provider='line') AS has_identity FROM users WHERE id=${id} FOR UPDATE`,
      )
    ).rows[0];
    if (!row) throw new AdminError("not_found");
    if (!root && row.role === "admin") throw new AdminError("forbidden");
    return row;
  }
  return {
    setRole(actor, id, input, now) {
      return work(
        actor,
        async (tx) => {
          const row = await target(tx, actor, id);
          if (row.status_version !== input.version)
            throw new AdminError("conflict");
          if (row.role === input.role) return;
          if (
            input.role === "admin" &&
            (row.status !== "active" || !row.has_identity)
          )
            throw new AdminError("conflict");
          await tx
            .update(users)
            .set({ role: input.role, statusVersion: input.version + 1 })
            .where(eq(users.id, id));
          await tx.delete(authSessions).where(eq(authSessions.userId, id));
          await audit(
            tx,
            actor,
            input.role === "admin" ? "admin_granted" : "admin_revoked",
            "user",
            id,
            input.reason,
            { before: row.role, after: input.role },
            now,
          );
        },
        true,
      );
    },
    overview(actor) {
      return work(
        actor,
        async (tx) =>
          (
            await tx.execute(sql`SELECT
      (SELECT count(*)::int FROM users) AS users,
      (SELECT count(*)::int FROM users WHERE status='suspended') AS suspended,
      (SELECT count(*)::int FROM trips WHERE status='active') AS active_trips,
      (SELECT count(*)::int FROM trips WHERE status='cancelled') AS cancelled_trips,
      (SELECT count(*)::int FROM ride_requests WHERE status='pending') AS pending_requests,
      (SELECT count(*)::int FROM ride_requests WHERE status='accepted') AS accepted_requests`)
          ).rows[0] as Record<string, number>,
      );
    },
    list(actor, kind, cursor) {
      return work(actor, async (tx) => {
        const after = cursor
          ? sql`AND (t.created_at,t.id)<(${new Date(cursor.createdAt)},${cursor.id}::uuid)`
          : sql``;
        let query;
        if (kind === "users")
          query = sql`SELECT t.id,t.display_name AS "displayName",t.status,t.role,t.status_version AS version,t.created_at AS "createdAt",EXISTS(SELECT 1 FROM external_identities i WHERE i.user_id=t.id AND i.provider='line' AND i.subject=${subject!}) AS "isRoot" FROM users t WHERE true ${after} ORDER BY t.created_at DESC,t.id DESC LIMIT 21`;
        else if (kind === "trips")
          query = sql`SELECT t.id,t.owner_id AS "ownerId",u.display_name AS "ownerName",t.origin_province AS "originProvince",t.destination_province AS "destinationProvince",t.departure_at AS "departureAt",t.status,t.version,t.seats_offered AS seats,t.seats_booked AS "bookedSeats",t.created_at AS "createdAt" FROM trips t JOIN users u ON u.id=t.owner_id WHERE true ${after} ORDER BY t.created_at DESC,t.id DESC LIMIT 21`;
        else if (kind === "requests")
          query = sql`SELECT t.id,t.trip_id AS "tripId",t.passenger_id AS "passengerId",u.display_name AS "passengerName",t.status,t.seats_requested AS seats,r.origin_province AS "originProvince",r.destination_province AS "destinationProvince",r.departure_at AS "departureAt",t.created_at AS "createdAt" FROM ride_requests t JOIN users u ON u.id=t.passenger_id JOIN trips r ON r.id=t.trip_id WHERE true ${after} ORDER BY t.created_at DESC,t.id DESC LIMIT 21`;
        else
          query = sql`SELECT t.id,t.actor_id AS "actorId",u.display_name AS "actorName",t.action,t.target_type AS "targetType",t.target_id AS "targetId",t.reason,t.details,t.created_at AS "createdAt" FROM admin_audit t JOIN users u ON u.id=t.actor_id WHERE true ${after} ORDER BY t.created_at DESC,t.id DESC LIMIT 21`;
        const rows = (await tx.execute(query)).rows as Record<
          string,
          unknown
        >[];
        const items = rows
            .slice(0, 20)
            .map((row) =>
              Object.fromEntries(
                Object.entries(row).map(([k, v]) => [
                  k,
                  v instanceof Date ? v.toISOString() : v,
                ]),
              ),
            ),
          last = items.at(-1);
        return {
          items,
          nextCursor:
            rows.length > 20 && last
              ? btoa(JSON.stringify({ createdAt: last.createdAt, id: last.id }))
                  .replaceAll("+", "-")
                  .replaceAll("/", "_")
                  .replaceAll("=", "")
              : null,
        };
      });
    },
    setUser(actor, id, input, now) {
      return work(actor, async (tx) => {
        const row = await target(tx, actor, id);
        if (row.status_version !== input.version)
          throw new AdminError("conflict");
        if (row.status === input.status) return;
        await tx
          .update(users)
          .set({ status: input.status, statusVersion: input.version + 1 })
          .where(eq(users.id, id));
        if (input.status === "suspended")
          await tx.delete(authSessions).where(eq(authSessions.userId, id));
        await audit(
          tx,
          actor,
          input.status === "suspended" ? "user_suspended" : "user_activated",
          "user",
          id,
          input.reason,
          { before: row.status, after: input.status },
          now,
        );
      });
    },
    cancelTrip(actor, id, input, now) {
      return work(actor, async (tx) => {
        const row = (
          await tx.execute(
            sql`SELECT owner_id,status FROM trips WHERE id=${id} FOR UPDATE`,
          )
        ).rows[0];
        if (!row) throw new AdminError("not_found");
        await cancelOwnedTrip(tx, String(row.owner_id), id, input, now);
        if (row.status !== "cancelled")
          await audit(
            tx,
            actor,
            "trip_cancelled",
            "trip",
            id,
            input.reason,
            { before: row.status, after: "cancelled" },
            now,
          );
      });
    },
    settings(actor) {
      return work(
        actor,
        async (tx) => {
          const [r] = await tx
            .select()
            .from(siteSettings)
            .where(eq(siteSettings.id, "site"));
          if (!r) throw new Error("SITE_SETTINGS_MISSING");
          return siteSettingsSchema.parse({
            serviceOpen: r.serviceOpen,
            registrationsOpen: r.registrationsOpen,
            version: r.version,
          });
        },
        true,
      );
    },
    setSettings(actor, input, now) {
      return work(
        actor,
        async (tx) => {
          const [before] = await tx
            .select()
            .from(siteSettings)
            .where(eq(siteSettings.id, "site"))
            .for("update");
          if (!before || before.version !== input.version)
            throw new AdminError("conflict");
          if (
            before.serviceOpen === input.serviceOpen &&
            before.registrationsOpen === input.registrationsOpen
          )
            return siteSettingsSchema.parse({
              serviceOpen: input.serviceOpen,
              registrationsOpen: input.registrationsOpen,
              version: input.version,
            });
          const next = {
            serviceOpen: input.serviceOpen,
            registrationsOpen: input.registrationsOpen,
            version: input.version + 1,
          };
          await tx
            .update(siteSettings)
            .set({ ...next, updatedAt: now })
            .where(eq(siteSettings.id, "site"));
          await audit(
            tx,
            actor,
            "settings_changed",
            "settings",
            "site",
            input.reason,
            {
              before: {
                serviceOpen: before.serviceOpen,
                registrationsOpen: before.registrationsOpen,
              },
              after: next,
            },
            now,
          );
          return next;
        },
        true,
      );
    },
  };
}

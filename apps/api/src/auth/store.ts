import { and, eq, gt, lte, sql } from "drizzle-orm";
import { withDatabase } from "@coago/db";
import {
  users,
  externalIdentities,
  oauthFlows,
  authSessions,
  authRateLimits,
} from "@coago/db";
import type { LineIdentity } from "./line";
export type User = { id: string; displayName: string };
export type Flow = {
  idHash: string;
  stateHash: string;
  nonce: string;
  verifier: string;
  expiresAt: Date;
};
export type Session = { user: User; csrfToken: string };
export interface AuthStore {
  allowStart(key: string, now: Date): Promise<boolean>;
  saveFlow(flow: Flow): Promise<void>;
  takeFlow(
    idHash: string,
    stateHash: string,
    now: Date,
  ): Promise<Flow | undefined>;
  createSession(
    identity: LineIdentity,
    tokenHash: string,
    csrfToken: string,
    expiresAt: Date,
    now: Date,
  ): Promise<User>;
  getSession(tokenHash: string, now: Date): Promise<Session | undefined>;
  deleteSession(tokenHash: string): Promise<void>;
}
export function postgresAuthStore(url: string): AuthStore {
  return {
    async allowStart(key, now) {
      return withDatabase(url, async (db) => {
        await db.delete(oauthFlows).where(lte(oauthFlows.expiresAt, now));
        await db.delete(authSessions).where(lte(authSessions.expiresAt, now));
        await db
          .delete(authRateLimits)
          .where(lte(authRateLimits.expiresAt, now));
        const bucket = `${key}:${Math.floor(now.getTime() / 600000)}`;
        const rows = await db
          .insert(authRateLimits)
          .values({
            bucket,
            hits: 1,
            expiresAt: new Date(now.getTime() + 600000),
          })
          .onConflictDoUpdate({
            target: authRateLimits.bucket,
            set: { hits: sql`${authRateLimits.hits} + 1` },
          })
          .returning({ hits: authRateLimits.hits });
        return rows[0].hits <= 20;
      });
    },
    async saveFlow(flow) {
      await withDatabase(url, async (db) => {
        await db.insert(oauthFlows).values(flow);
      });
    },
    async takeFlow(idHash, stateHash, now) {
      return withDatabase(url, async (db) => {
        const rows = await db
          .delete(oauthFlows)
          .where(
            and(
              eq(oauthFlows.idHash, idHash),
              eq(oauthFlows.stateHash, stateHash),
              gt(oauthFlows.expiresAt, now),
            ),
          )
          .returning();
        return rows[0];
      });
    },
    async createSession(identity, tokenHash, csrfToken, expiresAt, now) {
      return withDatabase(url, async (db) =>
        db.transaction(async (tx) => {
          // Serializes simultaneous first logins for this verified LINE identity.
          await tx.execute(
            sql`SELECT pg_advisory_xact_lock(hashtextextended(${"line:" + identity.subject},0))`,
          );
          const existing = await tx
            .select({ userId: externalIdentities.userId })
            .from(externalIdentities)
            .where(
              and(
                eq(externalIdentities.provider, "line"),
                eq(externalIdentities.subject, identity.subject),
              ),
            );
          const userId = existing[0]?.userId ?? crypto.randomUUID();
          if (!existing[0]) {
            await tx
              .insert(users)
              .values({
                id: userId,
                displayName: identity.displayName,
                createdAt: now,
              });
            await tx
              .insert(externalIdentities)
              .values({
                provider: "line",
                subject: identity.subject,
                userId,
                createdAt: now,
              });
          } else {
            await tx
              .update(users)
              .set({ displayName: identity.displayName })
              .where(eq(users.id, userId));
          }
          await tx
            .insert(authSessions)
            .values({
              tokenHash,
              userId,
              csrfToken,
              expiresAt,
              createdAt: now,
            });
          return { id: userId, displayName: identity.displayName };
        }),
      );
    },
    async getSession(tokenHash, now) {
      return withDatabase(url, async (db) => {
        const rows = await db
          .select({
            id: users.id,
            displayName: users.displayName,
            csrfToken: authSessions.csrfToken,
          })
          .from(authSessions)
          .innerJoin(users, eq(authSessions.userId, users.id))
          .where(
            and(
              eq(authSessions.tokenHash, tokenHash),
              gt(authSessions.expiresAt, now),
            ),
          );
        return rows[0]
          ? {
              user: { id: rows[0].id, displayName: rows[0].displayName },
              csrfToken: rows[0].csrfToken,
            }
          : undefined;
      });
    },
    async deleteSession(tokenHash) {
      await withDatabase(url, async (db) => {
        await db
          .delete(authSessions)
          .where(eq(authSessions.tokenHash, tokenHash));
      });
    },
  };
}

import type { Bindings } from "../bindings";
import { databaseUrl } from "../bindings";
import { postgresAuthStore } from "../auth/store";
import { hash } from "../auth/crypto";
import { dataKey, decode } from "../membership/crypto";
import { providerSession } from "./provider";
import { withDatabase, externalIdentities } from "@coago/db";
import { and, eq } from "drizzle-orm";
export const adminCookie = (env: Bindings) =>
  env.NEON_ADMIN_AUTH_URL ? "__Host-coago_admin" : "__Host-coago_session";
export async function managedAdminSession(env: Bindings, token: string) {
  const tokenHash = await hash(token),
    store = postgresAuthStore(databaseUrl(env)),
    session = await store.getSession(tokenHash, new Date());
  if (!session?.adminProof) return undefined;
  try {
    const proof = await decode<{
        cookie: string;
        email: string;
        providerId: string;
      }>(
        await dataKey(env.MEMBER_DATA_KEY),
        session.adminProof,
        `admin:${tokenHash}`,
      ),
      verified = await providerSession(env, proof.cookie);
    if (
      verified.user.email !== proof.email ||
      verified.user.id !== proof.providerId
    )
      throw Error();
    const valid = await withDatabase(
      databaseUrl(env),
      async (db) =>
        (
          await db
            .select()
            .from(externalIdentities)
            .where(
              and(
                eq(externalIdentities.userId, session.user.id),
                eq(externalIdentities.provider, "admin_email"),
                eq(externalIdentities.subject, proof.email),
              ),
            )
        ).length === 1,
    );
    if (!valid) throw Error();
    return session;
  } catch {
    await store.deleteSession(tokenHash);
    return undefined;
  }
}

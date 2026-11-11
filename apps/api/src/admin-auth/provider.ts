import type { Bindings } from "../bindings";
import { z } from "zod";
export const verifiedAdminUser = z.object({
  id: z.string().min(1).max(100),
  email: z.email().transform((v) => v.toLowerCase()),
  emailVerified: z.literal(true),
  name: z.string().max(120).optional(),
});
export function adminProvider(env: Bindings) {
  const url = new URL(env.NEON_ADMIN_AUTH_URL ?? "https://invalid.invalid");
  if (
    url.protocol !== "https:" ||
    !url.hostname.endsWith(".neon.tech") ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !env.ROOT_ADMIN_EMAIL
  )
    throw Error("ADMIN_AUTH_NOT_CONFIGURED");
  return url.href.replace(/\/$/, "");
}
export async function upstream(
  env: Bindings,
  path: string,
  body?: unknown,
  cookie?: string,
) {
  const response = await fetch(`${adminProvider(env)}${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      Origin: env.APP_ORIGIN!,
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
    signal: AbortSignal.timeout(12000),
  });
  if (response.status >= 300 && response.status < 400)
    throw Error("ADMIN_AUTH_REDIRECT_REJECTED");
  return response;
}
export async function providerSession(env: Bindings, cookie: string) {
  const r = await upstream(env, "/get-session", undefined, cookie);
  if (!r.ok) throw Error("ADMIN_SESSION_INVALID");
  const data = (await r.json()) as {
    user: unknown;
    session?: { expiresAt: string };
  };
  if (!data || !(data.user as { emailVerified?: boolean })?.emailVerified)
    throw Error("ADMIN_EMAIL_UNVERIFIED");
  const user = verifiedAdminUser.parse(data.user);
  if (!data.session || Date.parse(data.session.expiresAt) <= Date.now())
    throw Error("ADMIN_SESSION_INVALID");
  return { user, expiresAt: new Date(data.session.expiresAt) };
}
export function providerCookies(response: Response) {
  const values = response.headers.getSetCookie();
  const allowed = values
    .map((v) => v.split(";")[0])
    .filter((v) => /^__Secure-neon-auth\.session_token=/.test(v));
  if (allowed.length !== 1 || allowed[0].length > 4096)
    throw Error("ADMIN_SESSION_INVALID");
  return allowed[0];
}

import { z } from "zod";
import type { Bindings } from "../bindings";
export type LineConfig = {
  channelId: string;
  secret: string;
  callback: string;
  origin: string;
};
export type LineIdentity = { subject: string; displayName: string };
export function lineConfig(env: Bindings): LineConfig {
  if (
    !env.APP_ORIGIN ||
    !env.LINE_CHANNEL_ID ||
    !env.LINE_CHANNEL_SECRET ||
    !env.LINE_CALLBACK_URL
  )
    throw new Error("LINE_CONFIGURATION_MISSING");
  const origin = new URL(env.APP_ORIGIN);
  const callback = new URL(env.LINE_CALLBACK_URL);
  const local =
    ["local", "test"].includes(env.ENVIRONMENT ?? "") &&
    ["localhost", "127.0.0.1"].includes(origin.hostname);
  if (
    !/^\d+$/.test(env.LINE_CHANNEL_ID) ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash ||
    !(origin.protocol === "https:" || (local && origin.protocol === "http:")) ||
    callback.href !== `${origin.origin}/api/auth/line/callback`
  )
    throw new Error("LINE_CONFIGURATION_INVALID");
  return {
    channelId: env.LINE_CHANNEL_ID,
    secret: env.LINE_CHANNEL_SECRET,
    callback: callback.href,
    origin: origin.origin,
  };
}
const verifiedSchema = z.object({
  iss: z.literal("https://access.line.me"),
  sub: z.string().regex(/^U[\da-f]{32}$/i),
  aud: z.string(),
  exp: z.number().int(),
  iat: z.number().int(),
  nonce: z.string(),
  name: z.string().min(1).max(256).optional(),
});
export async function exchangeIdentity(
  config: LineConfig,
  code: string,
  verifier: string,
  nonce: string,
  now: Date,
  request: typeof fetch = fetch,
): Promise<LineIdentity> {
  const response = await request("https://api.line.me/oauth2/v2.1/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: config.callback,
      client_id: config.channelId,
      client_secret: config.secret,
      code_verifier: verifier,
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error("LINE_TOKEN_EXCHANGE_FAILED");
  const token = z
    .object({ id_token: z.string().min(1).max(16384) })
    .parse(await response.json());
  const verify = await request("https://api.line.me/oauth2/v2.1/verify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      id_token: token.id_token,
      client_id: config.channelId,
      nonce,
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!verify.ok) throw new Error("LINE_TOKEN_VERIFICATION_FAILED");
  const claims = verifiedSchema.parse(await verify.json());
  const seconds = Math.floor(now.getTime() / 1000);
  if (
    claims.aud !== config.channelId ||
    claims.nonce !== nonce ||
    claims.exp <= seconds ||
    claims.iat > seconds + 60 ||
    claims.exp <= claims.iat
  )
    throw new Error("LINE_CLAIMS_INVALID");
  return { subject: claims.sub, displayName: claims.name ?? "ผู้ใช้ COAGO" };
}
